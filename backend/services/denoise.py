"""Post-processing noise reduction for separated stems."""
import asyncio
from pathlib import Path

import numpy as np
import soundfile as sf

# Stem-specific spectral gating params
# vocals: aggressive — Demucs bleed/hiss 제거
# drums: conservative — 트랜지언트(attack) 보존 우선
# bass: moderate — 저역대 아티팩트 제거
_PARAMS: dict[str, dict] = {
    "vocals": {"prop_decrease": 0.85, "freq_mask_smooth_hz": 500},
    "drums":  {"prop_decrease": 0.35},
    "bass":   {"prop_decrease": 0.55},
    "other":  {"prop_decrease": 0.65},
    "guitar": {"prop_decrease": 0.65},
    "piano":  {"prop_decrease": 0.60},
}


def _reduce_noise_sync(audio: np.ndarray, sr: int, params: dict) -> np.ndarray:
    """Run noisereduce in a thread (CPU-bound, blocking)."""
    import noisereduce as nr  # lazy import — optional dependency

    if audio.ndim == 1:
        return nr.reduce_noise(y=audio, sr=sr, **params)

    # stereo: process each channel independently
    channels = [
        nr.reduce_noise(y=audio[:, ch], sr=sr, **params)
        for ch in range(audio.shape[1])
    ]
    return np.stack(channels, axis=1)


async def denoise_stems(stem_paths: dict[str, str]) -> dict[str, str]:
    """Denoise each stem file in-place (writes *_clean.wav next to original).

    Returns a new dict with paths pointing to the cleaned files.
    Silently skips a stem if noisereduce is not installed or denoising fails.
    """
    result: dict[str, str] = {}
    loop = asyncio.get_running_loop()

    for name, path in stem_paths.items():
        params = _PARAMS.get(name, {"prop_decrease": 0.60})
        clean_path = str(Path(path).with_stem(Path(path).stem + "_clean"))
        try:
            audio, sr = sf.read(path)
            cleaned = await loop.run_in_executor(
                None, _reduce_noise_sync, audio, sr, params
            )
            sf.write(clean_path, cleaned, sr, subtype="PCM_16")
            result[name] = clean_path
        except Exception:
            # fallback: return original path if denoise fails
            result[name] = path

    return result
