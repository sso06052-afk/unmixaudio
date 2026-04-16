"""analyze.py — Real-time BPM & Key detection via WebSocket"""
import json
import struct
import asyncio
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

_executor = ThreadPoolExecutor(max_workers=1)

# essentia lazy import
_es = None
_essentia_loaded = False


def _load_essentia():
    global _es, _essentia_loaded
    if _essentia_loaded:
        return _es is not None
    _essentia_loaded = True
    try:
        import essentia.standard as mod  # type: ignore
        _es = mod
        print("[essentia] loaded OK", flush=True)
        return True
    except Exception as e:
        print(f"[essentia] load FAILED: {e}", flush=True)
        return False


def _analyze(pcm_bytes: bytes, sample_rate: int) -> dict:
    if not _load_essentia() or _es is None:
        return {"error": "essentia not available"}

    pcm = np.frombuffer(pcm_bytes, dtype="<f4")
    result: dict = {}

    try:
        ke = _es.KeyExtractor(
            averageDetuningCorrection=True,
            frameSize=4096, hopSize=4096,
            hpcpSize=12, maxFrequency=3500, minFrequency=25,
            maximumSpectralPeaks=60, pcpThreshold=0.2,
            profileType="bgate", sampleRate=float(sample_rate),
            spectralPeaksThreshold=0.0001, tuningFrequency=440.0,
            weightType="cosine", windowType="hann",
        )
        key, scale, strength = ke(pcm)
        result["key"] = f"{key} {scale.capitalize()}"
        result["keyRoot"] = key
        result["keyScale"] = scale
        result["keyStrength"] = float(strength)
    except Exception as e:
        result["keyError"] = str(e)
        print(f"[essentia] KeyExtractor error: {e}", flush=True)

    try:
        bpm_est = _es.PercivalBpmEstimator(
            frameSize=int(1024), frameSizeOSS=int(2048),
            hopSize=int(128), hopSizeOSS=int(128),
            maxBPM=float(220), minBPM=float(50),
            sampleRate=float(sample_rate),
        )
        bpm = bpm_est(pcm)
        result["bpm"] = float(bpm)
    except Exception as e:
        result["bpmError"] = str(e)
        print(f"[essentia] BpmEstimator error: {e}", flush=True)

    return result


@router.websocket("/ws/analyze")
async def analyze_ws(websocket: WebSocket):
    await websocket.accept()
    print("[ws] connected", flush=True)
    loop = asyncio.get_event_loop()

    try:
        while True:
            data = await websocket.receive_bytes()
            if len(data) < 8:
                await websocket.send_text(json.dumps({"error": "packet too small"}))
                continue

            sample_rate = struct.unpack_from("<I", data, 0)[0]
            pcm_bytes = data[4:]

            if len(pcm_bytes) < sample_rate * 4:
                await websocket.send_text(json.dumps({"error": "insufficient audio"}))
                continue

            print(f"[ws] analyzing {len(pcm_bytes)//4} samples @ {sample_rate}Hz", flush=True)
            result = await loop.run_in_executor(_executor, _analyze, pcm_bytes, sample_rate)
            print(f"[ws] result: {result}", flush=True)
            await websocket.send_text(json.dumps(result))

    except WebSocketDisconnect:
        print("[ws] disconnected", flush=True)
    except Exception as e:
        print(f"[ws] error: {e}", flush=True)
        try:
            await websocket.send_text(json.dumps({"error": str(e)}))
        except Exception:
            pass
