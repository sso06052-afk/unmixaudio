"""Demucs stem separation service.

Demucs 4.0.1 + PyTorch 2.x 호환 버그를 피하기 위해
subprocess로 별도 프로세스에서 실행합니다.

지원 입력 포맷: WAV, MP3, FLAC, WebM, M4A (ffmpeg로 자동 변환)

지원 모델:
  htdemucs    — 4 stems (vocals / drums / bass / other)
  htdemucs_6s — 6 stems (vocals / drums / bass / guitar / piano / other)
"""
import asyncio
import sys
from pathlib import Path

_STEMS_4 = ("vocals", "drums", "bass", "other")
_STEMS_6 = ("vocals", "drums", "bass", "guitar", "piano", "other")

# Demucs가 직접 읽을 수 있는 포맷
_NATIVE_EXTS = {".wav", ".mp3", ".flac", ".aiff", ".aif"}


def _ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


async def _to_wav(input_path: str) -> str:
    """WebM/M4A 등을 WAV로 변환. 이미 WAV면 그대로 반환."""
    if Path(input_path).suffix.lower() in _NATIVE_EXTS:
        return input_path

    wav_path = str(Path(input_path).with_suffix(".wav"))
    proc = await asyncio.create_subprocess_exec(
        _ffmpeg_exe(),
        "-y", "-i", input_path,
        "-ar", "44100", "-ac", "1",
        "-acodec", "pcm_s16le",
        wav_path,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg 변환 실패:\n{stderr.decode()[-400:]}")
    return wav_path


async def separate_stems(
    input_path: str,
    _job_id: str,
    output_dir: str,
    model: str = "htdemucs",
) -> dict:
    """Run Demucs via subprocess and return local file paths for each stem."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # WebM 등 비표준 포맷이면 WAV로 먼저 변환
    wav_path = await _to_wav(input_path)

    cmd = [
        sys.executable, "-m", "demucs",
        "-n", model,
        "--device", "cpu",
        "-o", output_dir,
        wav_path,
    ]

    DEMUCS_TIMEOUT = 900  # 15분 — GPU 없는 CPU 서버 기준 상한

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=DEMUCS_TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        raise RuntimeError(f"Demucs timed out after {DEMUCS_TIMEOUT}s")

    if proc.returncode != 0:
        err = (stderr.decode() + stdout.decode()).strip()[-600:]
        raise RuntimeError(f"Demucs failed:\n{err}")

    stem_names = _STEMS_6 if model == "htdemucs_6s" else _STEMS_4
    stem_dir = Path(output_dir) / model / Path(wav_path).stem
    stems = {}

    for name in stem_names:
        for ext in (".wav", ".mp3", ".flac"):
            candidate = stem_dir / f"{name}{ext}"
            if candidate.exists():
                stems[name] = str(candidate)
                break

    missing = [n for n in stem_names if n not in stems]
    if missing:
        raise RuntimeError(f"Demucs output missing: {missing}. stem_dir={stem_dir}")

    return stems
