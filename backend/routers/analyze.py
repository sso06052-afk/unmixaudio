"""analyze.py — Real-time BPM & Key detection via WebSocket
PCM Float32 청크(10초 링버퍼)를 수신 → Essentia로 분석 → JSON 반환
essentia는 ProcessPoolExecutor 워커 프로세스에서 격리 실행
— segfault 발생해도 메인 서버 프로세스 보호
"""
import json
import struct
import asyncio
import concurrent.futures
from concurrent.futures import ProcessPoolExecutor

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

# 워커 프로세스 풀 (essentia segfault 격리)
_executor: ProcessPoolExecutor | None = ProcessPoolExecutor(max_workers=1)


def _analyze_isolated(pcm_bytes: bytes, sample_rate: int) -> dict:
    """워커 프로세스에서 실행 — essentia import + 분석"""
    import essentia.standard as es  # type: ignore
    import numpy as np

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


def _get_executor() -> ProcessPoolExecutor:
    """executor가 죽었으면 새로 생성"""
    global _executor
    if _executor is None or _executor._broken:  # type: ignore[attr-defined]
        _executor = ProcessPoolExecutor(max_workers=1)
    return _executor


@router.websocket("/ws/analyze")
async def analyze_ws(websocket: WebSocket):
    """
    프로토콜:
    - client → server: binary frame = 4바이트 sample_rate (uint32 LE) + Float32LE PCM samples
    - server → client: JSON text frame = {"key": "A Minor", "bpm": 90.0, "keyStrength": 0.82}
    """
    await websocket.accept()
    loop = asyncio.get_event_loop()

    try:
        while True:
            data = await websocket.receive_bytes()
            if len(data) < 8:
                await websocket.send_text(json.dumps({"error": "packet too small"}))
                continue

            sample_rate = struct.unpack_from("<I", data, 0)[0]
            pcm_bytes = data[4:]

            if len(pcm_bytes) < sample_rate * 4:  # 최소 1초
                await websocket.send_text(json.dumps({"error": "insufficient audio"}))
                continue

            try:
                executor = _get_executor()
                result = await loop.run_in_executor(
                    executor, _analyze_isolated, pcm_bytes, sample_rate
                )
            except concurrent.futures.process.BrokenProcessPool:
                # 워커 crash → executor 재생성, 이번 요청은 에러 반환
                global _executor
                _executor = ProcessPoolExecutor(max_workers=1)
                result = {"error": "worker crashed, will retry next request"}
            except Exception as e:
                result = {"error": str(e)}

            await websocket.send_text(json.dumps(result))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_text(json.dumps({"error": str(e)}))
        except Exception:
            pass
