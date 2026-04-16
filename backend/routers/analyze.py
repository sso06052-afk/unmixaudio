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

# 접속당 누적 버퍼 최대 크기: 60초 @ 48000Hz
MAX_ACCUM_SAMPLES = 48000 * 60


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


def _analyze(pcm: np.ndarray, sample_rate: int) -> dict:
    if not _load_essentia() or _es is None:
        return {"error": "essentia not available"}

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
        rhythm = _es.RhythmExtractor2013(
            maxTempo=220, minTempo=50,
            method="multifeature",
        )
        bpm, _, _, _, _ = rhythm(pcm)
        result["bpm"] = float(bpm)
    except Exception as e:
        result["bpmError"] = str(e)
        print(f"[essentia] RhythmExtractor error: {e}", flush=True)

    return result


@router.websocket("/ws/analyze")
async def analyze_ws(websocket: WebSocket):
    await websocket.accept()
    print("[ws] connected", flush=True)
    loop = asyncio.get_event_loop()

    # 접속별 누적 버퍼 (곡이 바뀌면 재연결로 리셋)
    accum: list[np.ndarray] = []
    accum_len = 0
    sample_rate_ref = 0

    try:
        while True:
            data = await websocket.receive_bytes()
            if len(data) < 8:
                await websocket.send_text(json.dumps({"error": "packet too small"}))
                continue

            sr = struct.unpack_from("<I", data, 0)[0]
            chunk = np.frombuffer(data[4:], dtype="<f4")

            if len(chunk) < sr:
                await websocket.send_text(json.dumps({"error": "insufficient audio"}))
                continue

            # sample rate가 바뀌면 버퍼 리셋
            if sr != sample_rate_ref:
                accum.clear()
                accum_len = 0
                sample_rate_ref = sr

            # 청크 누적 (최대 60초 유지 — 오래된 것부터 제거)
            accum.append(chunk.copy())
            accum_len += len(chunk)
            while accum_len > MAX_ACCUM_SAMPLES and accum:
                removed = accum.pop(0)
                accum_len -= len(removed)

            pcm = np.concatenate(accum)
            dur = len(pcm) / sr
            print(f"[ws] analyzing {len(pcm)} samples ({dur:.1f}s) @ {sr}Hz", flush=True)

            result = await loop.run_in_executor(_executor, _analyze, pcm, sr)
            result["accumSec"] = round(dur, 1)
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
