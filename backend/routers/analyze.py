"""analyze.py — Real-time BPM & Key detection via WebSocket
PCM Float32 청크(10초 링버퍼)를 수신 → Essentia로 분석 → JSON 반환
"""
import json
import struct
import asyncio
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

# ── Essentia 가용성 체크 (서버 시작 시 1회)
# subprocess로 실행 → macOS Rosetta hang도 타임아웃으로 처리
def _check_essentia() -> bool:
    try:
        r = subprocess.run(
            [sys.executable, "-c", "import essentia.standard; print('ok')"],
            capture_output=True,
            timeout=8,
        )
        return r.returncode == 0 and b"ok" in r.stdout
    except (subprocess.TimeoutExpired, Exception):
        return False


_ESSENTIA_OK: bool = _check_essentia()
# CPU-heavy 분석은 별도 프로세스에서 실행 (essentia가 이벤트 루프 블로킹 방지)
_executor = ProcessPoolExecutor(max_workers=1) if _ESSENTIA_OK else None


def _analyze_worker(pcm_bytes: bytes, sample_rate: int) -> dict:
    """워커 프로세스에서 실행 — essentia import + 분석"""
    import essentia.standard as es  # type: ignore

    pcm = np.frombuffer(pcm_bytes, dtype="<f4")
    result: dict = {}

    # ── Key ──────────────────────────────────────────────────────
    try:
        key_extractor = es.KeyExtractor(
            averageDetuningCorrection=True,
            frameSize=4096,
            hopSize=4096,
            hpcpSize=12,
            maxFrequency=3500,
            minFrequency=25,
            maximumSpectralPeaks=60,
            pcpThreshold=0.2,
            profileType="bgate",
            sampleRate=float(sample_rate),
            spectralPeaksThreshold=0.0001,
            tuningFrequency=440.0,
            weightType="cosine",
            windowType="hann",
        )
        key, scale, strength = key_extractor(pcm)
        result["key"] = f"{key} {scale.capitalize()}"
        result["keyRoot"] = key
        result["keyScale"] = scale
        result["keyStrength"] = float(strength)
    except Exception as e:
        result["keyError"] = str(e)

    # ── BPM ──────────────────────────────────────────────────────
    try:
        bpm_estimator = es.PercivalBpmEstimator(
            frameSize=1024,
            frameSizeOSS=2048,
            hopSize=128,
            hopSizeOSS=128,
            maxBPM=220,
            minBPM=50,
            sampleRate=float(sample_rate),
        )
        bpm = bpm_estimator(pcm)
        result["bpm"] = float(bpm)
    except Exception as e:
        result["bpmError"] = str(e)

    return result


@router.websocket("/ws/analyze")
async def analyze_ws(websocket: WebSocket):
    """
    프로토콜:
    - client → server: binary frame = 4바이트 sample_rate (uint32 LE) + Float32LE PCM samples
    - server → client: JSON text frame = {"key": "A Minor", "bpm": 90.0, "keyStrength": 0.82}
    """
    await websocket.accept()

    if not _ESSENTIA_OK:
        await websocket.send_text(json.dumps({"error": "essentia not available on this server"}))
        await websocket.close()
        return

    loop = asyncio.get_event_loop()
    try:
        while True:
            data = await websocket.receive_bytes()
            if len(data) < 8:
                await websocket.send_text(json.dumps({"error": "packet too small"}))
                continue

            sample_rate = struct.unpack_from("<I", data, 0)[0]
            # pcm bytes 그대로 워커에 전달 (ndarray는 pickling 비용 큼)
            pcm_bytes = data[4:]

            if len(pcm_bytes) < sample_rate * 4:  # 최소 1초 (float32 = 4바이트)
                await websocket.send_text(json.dumps({"error": "insufficient audio"}))
                continue

            result = await loop.run_in_executor(_executor, _analyze_worker, pcm_bytes, sample_rate)
            await websocket.send_text(json.dumps(result))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_text(json.dumps({"error": str(e)}))
        except Exception:
            pass
