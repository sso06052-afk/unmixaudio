"""Replicate-backed stem separation (GPU cloud).

모델: cjwbw/demucs — Replicate 공식 Demucs 호스팅
처리 시간: 3분짜리 곡 기준 약 30~60초 (T4 GPU)
과금: ~$0.01~0.05 / 곡

출력: Replicate CDN URL dict { vocals, drums, bass, other, [guitar, piano] }
      denoise=True 이면 로컬 다운로드 → noisereduce → Supabase 재업로드
"""
import asyncio
from pathlib import Path

import httpx

_REPLICATE_MODEL = "ryan5453/demucs:5a7041cc9b82e5a558fea6b3d7b12dea89625e89da33f0447bd727c2d0ab9e77"

_STEMS_4 = ("vocals", "drums", "bass", "other")
_STEMS_6 = ("vocals", "drums", "bass", "guitar", "piano", "other")


def _stem_names(model: str) -> tuple:
    return _STEMS_6 if model == "htdemucs_6s" else _STEMS_4


def _parse_output(output, model: str) -> dict[str, str]:
    """ryan5453/demucs output → { stem_name: url } dict.

    출력 형태: { "vocals": FileOutput, "drums": FileOutput, ... }
    FileOutput은 str()로 URL 추출 가능
    """
    names = set(_stem_names(model))

    if isinstance(output, dict):
        return {k: str(v) for k, v in output.items() if k in names}

    # 리스트 형태 fallback (순서: vocals, drums, bass, other, [guitar, piano])
    if hasattr(output, "__iter__"):
        ordered = list(_stem_names(model))
        items = list(output)
        return {ordered[i]: str(item) for i, item in enumerate(items) if i < len(ordered)}

    raise ValueError(f"Unexpected Replicate output type: {type(output)}")


async def separate_stems_replicate(
    input_path: str,
    model: str = "htdemucs",
) -> dict[str, str]:
    """Run Demucs on Replicate GPU and return stem URLs."""
    import replicate  # lazy — optional dependency

    import io
    with open(input_path, "rb") as f:
        audio_bytes = io.BytesIO(f.read())
        audio_bytes.name = Path(input_path).name  # replicate가 파일명 참고

    def _run():
        return replicate.run(
            _REPLICATE_MODEL,
            input={
                "audio": audio_bytes,
                "model": model,
                "stem": "none",
                "output_format": "wav",
                "wav_format": "int24",
            },
        )

    output = await asyncio.get_event_loop().run_in_executor(None, _run)

    return _parse_output(output, model)


async def _download_stem(url: str, dest_path: str) -> None:
    """Replicate URL → 로컬 파일 다운로드."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            with open(dest_path, "wb") as f:
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    f.write(chunk)


async def download_replicate_stems(
    stem_urls: dict[str, str],
    job_dir: str,
) -> dict[str, str]:
    """Replicate URL들을 로컬로 다운로드. denoise 후처리 또는 Supabase 업로드 전에 사용."""
    Path(job_dir).mkdir(parents=True, exist_ok=True)
    local_paths: dict[str, str] = {}

    await asyncio.gather(*[
        _download_task(name, url, job_dir, local_paths)
        for name, url in stem_urls.items()
    ])
    return local_paths


async def _download_task(name: str, url: str, job_dir: str, result: dict) -> None:
    dest = str(Path(job_dir) / f"{name}.wav")
    await _download_stem(url, dest)
    result[name] = dest
