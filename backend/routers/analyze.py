"""analyze.py — Real-time BPM & Key detection via WebSocket
PCM Float32 청크(10초 링버퍼)를 수신 → Essentia로 분석 → JSON 반환
"""
import json
import struct
import asyncio
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

# essentia import — Linux(Railway)에서는 정상, macOS에서는 실패해도 괜찮음
try:
    import essentia.standard as _es  # type: ignore
    _ESSENTIA_OK = True
except Exception:
    _es = None
    _ESSENTIA_OK = False

# CPU-heavy 분석을 스레드풀에서 실행 (이벤트 루프 비블로킹)
_executor = ThreadPoolExecutor(max_workers=2)


def _analyze(pcm: np.ndarray, sample_rate: int) -> dict:
    if not _ESSENTIA_OK or _es is None:
        return {"error": "essentia not available"}

    result: dict = {}

    # ── Key ──────────────────────────────────────────────────────
    try:
        key_extractor = _es.KeyExtractor(
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
        bpm_estimator = _es.PercivalBpmEstimator(
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
        await websocket.send_text(json.dumps({"error": "essentia not available"}))
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
            pcm = np.frombuffer(data, dtype="<f4", offset=4).copy()

            if len(pcm) < sample_rate:  # 최소 1초 데이터
                await websocket.send_text(json.dumps({"error": "insufficient audio"}))
                continue

            result = await loop.run_in_executor(_executor, _analyze, pcm, sample_rate)
            await websocket.send_text(json.dumps(result))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_text(json.dumps({"error": str(e)}))
        except Exception:
            pass
