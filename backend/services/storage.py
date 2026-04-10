"""Supabase Storage integration via REST API (httpx).

supabase-py 최신 버전이 Python 3.9에서 pyroaring 빌드 오류를 일으켜
Storage REST API를 직접 호출하는 방식으로 구현합니다.
"""
from pathlib import Path

import httpx
from backend.config import settings

_bucket_ensured = False


def _headers() -> dict:
    return {
        "apikey": settings.supabase_key,
        "Authorization": f"Bearer {settings.supabase_key}",
    }


def _storage_url(path: str = "") -> str:
    return f"{settings.supabase_url}/storage/v1{path}"


async def ensure_bucket() -> None:
    """stems 버킷이 없으면 public 버킷으로 자동 생성."""
    global _bucket_ensured
    if _bucket_ensured:
        return

    async with httpx.AsyncClient() as client:
        # 버킷 목록 조회
        res = await client.get(_storage_url("/bucket"), headers=_headers())
        if res.status_code == 200:
            names = [b["name"] for b in res.json()]
            if settings.supabase_bucket not in names:
                await client.post(
                    _storage_url("/bucket"),
                    headers={**_headers(), "Content-Type": "application/json"},
                    json={"id": settings.supabase_bucket, "name": settings.supabase_bucket, "public": True},
                )
    _bucket_ensured = True


async def upload_to_supabase(local_path: str, storage_path: str) -> str:
    """Upload file to Supabase Storage and return public URL."""
    if not settings.supabase_url or not settings.supabase_key:
        return f"file://{local_path}"

    await ensure_bucket()

    with open(local_path, "rb") as f:
        data = f.read()

    upload_url = _storage_url(f"/object/{settings.supabase_bucket}/{storage_path}")

    async with httpx.AsyncClient() as client:
        ext = Path(local_path).suffix.lower()
        content_type = {
            ".wav": "audio/wav",
            ".mp3": "audio/mpeg",
            ".flac": "audio/flac",
        }.get(ext, "audio/webm")
        res = await client.post(
            upload_url,
            headers={**_headers(), "Content-Type": content_type, "x-upsert": "true"},
            content=data,
            timeout=120.0,
        )
        res.raise_for_status()

    public_url = f"{settings.supabase_url}/storage/v1/object/public/{settings.supabase_bucket}/{storage_path}"
    return public_url
