"""analyze.py — Real-time BPM & Key detection via WebSocket"""
import json
import struct
import asyncio
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

_executor = ThreadPoolExecutor(max_workers=1)

# essentia lazy import
_es = None
_essentia_loaded = False

# 접속당 누적 버퍼 최대 크기: 60초 @ 48000Hz
MAX_ACCUM_SAMPLES = 48000 * 300  # 최대 5분


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


def _normalize_rms(pcm: np.ndarray, target_rms: float = 0.1) -> np.ndarray:
    """RMS 정규화 — 볼륨 차이로 인한 분석 오차 제거"""
    rms = float(np.sqrt(np.mean(pcm ** 2)))
    if rms < 1e-6:
        return pcm
    return (pcm * (target_rms / rms)).astype(np.float32)


# 음이름 룩업 테이블 (MIDI note % 12 → 음이름)
_NOTE_NAMES: list[str] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# 관계조 쌍 (장조 근음 index → 단조 근음 index)
# 예: C Major ↔ A Minor (C=0, A=9)
_RELATIVE_MAP: dict[int, int] = {
    0: 9, 1: 10, 2: 11, 3: 0, 4: 1, 5: 2,
    6: 3, 7: 4, 8: 5, 9: 6, 10: 7, 11: 8,
}


def _detect_bass_tonic(pcm: np.ndarray, sr: int) -> int:
    """100~350Hz 대역 HPS(Harmonic Product Spectrum)로 베이스 근음 검출.

    Returns:
        MIDI note index (C=0 … B=11), 검출 실패 시 -1
    """
    try:
        from scipy.signal import butter, sosfilt  # type: ignore

        nyq = sr / 2.0
        low = 100.0 / nyq
        high = 350.0 / nyq
        # 주파수 범위가 유효한지 확인 (0 < low < high < 1)
        if not (0 < low < high < 1.0):
            return -1

        sos = butter(4, [low, high], btype="band", output="sos")
        filtered: np.ndarray = sosfilt(sos, pcm)

        N = 4096
        if len(filtered) >= N:
            segment = filtered[:N]
        else:
            segment = np.pad(filtered, (0, N - len(filtered)))

        window = np.hanning(N)
        fft = np.abs(np.fft.rfft(segment.astype(np.float64) * window))
        freqs = np.fft.rfftfreq(N, d=1.0 / sr)

        # HPS — 3차 배음까지 다운샘플 곱
        hps = fft.copy()
        for h in range(2, 4):
            decimated = fft[::h]
            hps[: len(decimated)] *= decimated

        # 100~350Hz 범위만 탐색
        mask = (freqs >= 100.0) & (freqs <= 350.0)
        if not np.any(mask):
            return -1

        hps_masked = hps * mask
        peak_idx = int(np.argmax(hps_masked))
        peak_hz = float(freqs[peak_idx])
        if peak_hz <= 0.0:
            return -1

        midi = round(12.0 * np.log2(peak_hz / 440.0) + 69.0)
        return int(midi % 12)
    except Exception as e:
        print(f"[analyze] _detect_bass_tonic error: {e}", flush=True)
        return -1


def _run_key_extractor(
    pcm: np.ndarray,
    sample_rate: int,
    profile: str,
) -> tuple[str, str, float]:
    """단일 프로파일로 KeyExtractor 실행.

    Returns:
        (key, scale, strength)
    """
    assert _es is not None
    ke = _es.KeyExtractor(
        averageDetuningCorrection=True,
        frameSize=4096,
        hopSize=2048,
        hpcpSize=36,
        maxFrequency=3500,
        minFrequency=500,   # 808 배음(258Hz, 387Hz) 차단
        maximumSpectralPeaks=60,
        pcpThreshold=0.2,
        profileType=profile,
        sampleRate=float(sample_rate),
        spectralPeaksThreshold=0.0001,
        tuningFrequency=440.0,
        weightType="cosine",
        windowType="hann",
    )
    key, scale, strength = ke(pcm)
    return str(key), str(scale), float(strength)


def _analyze(pcm: np.ndarray, sample_rate: int) -> dict:
    if not _load_essentia() or _es is None:
        return {"error": "essentia not available"}

    result: dict = {}

    # 전처리: RMS 정규화
    pcm_norm = _normalize_rms(pcm)

    # ── Key 검출 ──────────────────────────────────────────────────────────
    try:
        # Stage 1 — Bass tonic 검출 (100~350Hz HPS)
        bass_tonic_idx: int = _detect_bass_tonic(pcm_norm, sample_rate)
        bass_tonic_note: str = _NOTE_NAMES[bass_tonic_idx] if bass_tonic_idx >= 0 else ""

        # Stage 2 — 3 프로파일 다수결 (minFrequency=500 로 808 배음 차단)
        profiles = ["bgate", "edma", "krumhansl"]
        votes: list[tuple[str, str, float]] = []
        for profile in profiles:
            try:
                k, s, st = _run_key_extractor(pcm_norm, sample_rate, profile)
                votes.append((k, s, st))
            except Exception as e:
                print(f"[essentia] KeyExtractor({profile}) error: {e}", flush=True)

        key_root: str = ""
        scale: str = ""
        strength: float = 0.0

        if votes:
            # 동일 (key, scale) 조합이 2개 이상이면 채택
            tally: Counter = Counter((k, s) for k, s, _ in votes)
            majority = tally.most_common(1)[0]
            if majority[1] >= 2:
                key_root, scale = majority[0]
                # strength는 해당 프로파일 결과 중 최고값
                strength = max(st for k, s, st in votes if (k, s) == (key_root, scale))
            else:
                # 전부 다르면 strength 최고값 채택
                best = max(votes, key=lambda x: x[2])
                key_root, scale, strength = best

        # Stage 3 — Bass tonic override
        # bassTonic이 검출됐고 stage2 결과가 유효할 때만 판단
        if bass_tonic_idx >= 0 and key_root:
            stage2_root_idx = _NOTE_NAMES.index(key_root) if key_root in _NOTE_NAMES else -1

            # bassTonic이 stage2 결과의 관계조 근음인지 확인
            # 예: stage2 = C Major → 관계조 단조 근음 = A
            #     stage2 = A Minor → 관계조 장조 근음 = C
            is_relative: bool = False
            if stage2_root_idx >= 0:
                if scale == "major":
                    rel_minor_idx = _RELATIVE_MAP.get(stage2_root_idx, -1)
                    is_relative = (bass_tonic_idx == rel_minor_idx)
                else:  # minor
                    # minor → 관계 장조 근음 (역방향 조회)
                    inv_map = {v: k for k, v in _RELATIVE_MAP.items()}
                    rel_major_idx = inv_map.get(stage2_root_idx, -1)
                    is_relative = (bass_tonic_idx == rel_major_idx)

            # bassTonic이 관계조가 아닌 독립적인 근음일 때만 override
            if not is_relative and len(votes) >= 2:
                key_root = bass_tonic_note
                # scale은 stage2 결과 유지

        if key_root:
            result["keyRoot"] = key_root
            result["keyScale"] = scale
            result["key"] = f"{key_root} {scale.capitalize()}"
            result["keyStrength"] = round(strength, 4)
            result["bassTonic"] = bass_tonic_note
            result["keyMethod"] = "backend-essentia-3profile"
        else:
            result["keyError"] = "no valid key result from any profile"

    except Exception as e:
        result["keyError"] = str(e)
        print(f"[analyze] key detection error: {e}", flush=True)

    # ── BPM 검출 (기존 유지) ─────────────────────────────────────────────
    try:
        rhythm = _es.RhythmExtractor2013(
            maxTempo=220, minTempo=50,
            method="multifeature",
        )
        bpm_raw, _, _, _, _ = rhythm(pcm_norm)
        result["bpm"] = round(float(bpm_raw), 1)
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
    cycle_count = 0  # 수신 사이클 수
    ANALYZE_EVERY = 15  # 30초마다 분석 (2초 * 15 = 30초)

    try:
        while True:
            msg = await websocket.receive()

            if msg.get("type") == "websocket.disconnect":
                print("[ws] disconnected", flush=True)
                break

            # 텍스트 메시지: 제어 커맨드 (reset 등)
            if "text" in msg:
                try:
                    cmd = json.loads(msg["text"])
                    if cmd.get("type") == "reset":
                        accum.clear()
                        accum_len = 0
                        sample_rate_ref = 0
                        print("[ws] accum reset", flush=True)
                    elif cmd.get("type") == "ping":
                        pass  # keepalive, 응답 불필요
                except Exception:
                    pass
                continue

            data = msg.get("bytes") or b""
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

            # 롤링 버퍼에서 마지막 2초(새 오디오)만 추출해서 누적
            # 10초 버퍼 전체를 누적하면 8초씩 겹쳐 artificial discontinuity 발생 → BPM 오염
            new_samples = sr * 2
            new_chunk = chunk[-new_samples:].copy()
            accum.append(new_chunk)
            accum_len += len(new_chunk)
            while accum_len > MAX_ACCUM_SAMPLES and accum:
                removed = accum.pop(0)
                accum_len -= len(removed)

            cycle_count += 1
            dur = accum_len / sr

            # 10초 이상 쌓인 후 첫 분석, 이후 30초마다 — 분석 시간이 누적량에 비례하므로 매 사이클 금지
            if not (cycle_count == 5 or cycle_count % ANALYZE_EVERY == 0):
                continue

            pcm = np.concatenate(accum)
            print(f"[ws] analyzing {len(pcm)} samples ({dur:.1f}s) @ {sr}Hz", flush=True)

            result = await loop.run_in_executor(_executor, _analyze, pcm, sr)
            result["accumSec"] = round(dur, 1)
            print(f"[ws] result: {result}", flush=True)
            if websocket.client_state.value == 1:  # CONNECTED
                await websocket.send_text(json.dumps(result))

    except WebSocketDisconnect:
        print("[ws] disconnected", flush=True)
    except Exception as e:
        print(f"[ws] error: {e}", flush=True)
        try:
            await websocket.send_text(json.dumps({"error": str(e)}))
        except Exception:
            pass
