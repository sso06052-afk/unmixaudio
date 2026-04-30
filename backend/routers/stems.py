"""Stem separation router."""
import shutil
import tempfile
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import get_db
from backend.schemas.stems import StemJobResponse, StemJobResult, StemResult
from backend.services.demucs import separate_stems
from backend.services.denoise import denoise_stems
from backend.services.license import verify_license
from backend.services.quota import (
    current_year_month,
    get_monthly_usage,
    increment_usage,
)
from backend.services.replicate_stems import (
    download_replicate_stems,
    separate_stems_replicate,
)

router = APIRouter()

FREE_MONTHLY_QUOTA = 5
UPGRADE_URL = "https://unmixaudio.lemonsqueezy.com/"

ALLOWED_MODELS = {"htdemucs", "htdemucs_6s", "htdemucs_ft"}

_jobs: dict[str, dict] = {}

TMP_DIR = Path(tempfile.gettempdir()) / "unmixaudio-stems"
TMP_DIR.mkdir(parents=True, exist_ok=True)

JOB_TTL_SEC = 3600


def _cleanup_old_jobs() -> None:
    now = time.time()
    expired = [
        jid for jid, j in _jobs.items()
        if j["status"] in ("complete", "failed") and now - j.get("created_at", now) > JOB_TTL_SEC
    ]
    for jid in expired:
        job_dir = TMP_DIR / jid
        if job_dir.exists():
            shutil.rmtree(job_dir, ignore_errors=True)
        del _jobs[jid]


@router.post("/extract-stems", response_model=StemJobResponse)
async def create_stem_job(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    model: str = Form("htdemucs"),
    denoise: bool = Form(False),
    x_device_id: str = Header(..., alias="X-Device-Id"),
    x_license_key: Optional[str] = Header(default=None, alias="X-License-Key"),
    db: AsyncSession = Depends(get_db),
):
    if model not in ALLOWED_MODELS:
        raise HTTPException(400, f"Invalid model. Allowed: {sorted(ALLOWED_MODELS)}")

    if not x_device_id or len(x_device_id) > 36:
        raise HTTPException(400, "X-Device-Id header is required (max 36 chars)")

    # 클라이언트 IP — proxy 환경 고려해 X-Forwarded-For 우선
    fwd = request.headers.get("X-Forwarded-For", "")
    client_ip = (fwd.split(",")[0].strip() if fwd else None) or (
        request.client.host if request.client else None
    )

    # 1) 라이선스 우선 검증
    pro_active = False
    if x_license_key:
        lic = await verify_license(db, x_license_key)
        pro_active = lic is not None

    # 2) Free 사용자면 quota 검증
    quota_remaining: Optional[int] = None
    if not pro_active:
        used = await get_monthly_usage(db, x_device_id, client_ip)
        if used >= FREE_MONTHLY_QUOTA:
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Monthly free quota exceeded. Upgrade to Pro at {UPGRADE_URL}"
                ),
            )
        # quota 통과 — 즉시 +1 (atomic UPSERT)
        new_count = await increment_usage(db, x_device_id, client_ip)
        quota_remaining = max(0, FREE_MONTHLY_QUOTA - new_count)

    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    content = await file.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(413, f"File exceeds {settings.max_upload_size_mb} MB limit")

    _cleanup_old_jobs()

    job_id = str(uuid.uuid4())
    job_dir = TMP_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(file.filename or "upload.webm").suffix or ".webm"
    input_path = str(job_dir / f"input{suffix}")
    with open(input_path, "wb") as f:
        f.write(content)

    base_url = str(request.base_url).rstrip("/")

    _jobs[job_id] = {
        "status": "processing", "stems": None, "local_paths": None, "error": None,
        "model": model, "created_at": time.time(),
    }

    background_tasks.add_task(_process_job, job_id, input_path, str(job_dir), model, denoise, base_url)
    # quota_remaining: Pro면 None, Free면 5 - 현재사용
    # year_month 는 디버깅/UI 표시용
    return StemJobResponse(
        job_id=job_id,
        status="processing",
        quota_remaining=quota_remaining,
        year_month=current_year_month() if not pro_active else None,
    )


@router.get("/extract-stems/{job_id}", response_model=StemJobResult)
async def get_stem_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    stems_obj = None
    if job["status"] == "complete" and job["stems"]:
        stems_obj = StemResult(**job["stems"])

    return StemJobResult(
        job_id=job_id,
        status=job["status"],
        stems=stems_obj,
        error=job.get("error"),
    )


@router.get("/extract-stems/{job_id}/download/{stem_name}")
async def download_stem_file(job_id: str, stem_name: str):
    """로컬 분리 결과 파일을 직접 스트리밍 — Supabase 없이 Railway에서 서빙."""
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job["status"] != "complete":
        raise HTTPException(409, "Job not complete yet")

    local_paths: dict = job.get("local_paths") or {}
    path = local_paths.get(stem_name)
    if not path or not Path(path).exists():
        raise HTTPException(404, "Stem file not found")

    return FileResponse(
        path,
        media_type="audio/wav",
        filename=f"{stem_name}.wav",
        headers={"Content-Disposition": f'attachment; filename="{stem_name}.wav"'},
    )


@router.delete("/extract-stems/{job_id}/cleanup")
async def cleanup_stem_job(job_id: str):
    """클라이언트 다운로드 완료 후 호출 — 임시 파일 및 job 메타 즉시 삭제."""
    if job_id not in _jobs:
        raise HTTPException(404, "Job not found")
    job_dir = TMP_DIR / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)
    del _jobs[job_id]
    return {"status": "cleaned"}


async def _process_job(
    job_id: str, input_path: str, job_dir: str, model: str, denoise: bool, base_url: str
):
    """Background task: Demucs 분리 → 로컬 서빙 (Supabase 없음)."""
    import os
    try:
        use_replicate = bool(settings.replicate_api_token)

        if use_replicate:
            os.environ["REPLICATE_API_TOKEN"] = settings.replicate_api_token
            replicate_urls = await separate_stems_replicate(input_path, model)

            if denoise:
                # Replicate URL → 로컬 다운로드 → noisereduce → 로컬 서빙
                download_dir = str(Path(job_dir) / "downloaded")
                local_paths = await download_replicate_stems(replicate_urls, download_dir)
                local_paths = await denoise_stems(local_paths)
                stem_urls = {
                    name: f"{base_url}/api/v1/extract-stems/{job_id}/download/{name}"
                    for name in local_paths
                }
            else:
                # Replicate CDN URL을 그대로 클라이언트에 전달 (즉시 다운로드 가능)
                local_paths = None
                stem_urls = replicate_urls

        else:
            # 로컬 CPU — 분리 결과를 Railway에서 직접 서빙
            output_dir = str(Path(job_dir) / "output")
            local_paths = await separate_stems(input_path, job_id, output_dir, model)
            if denoise:
                local_paths = await denoise_stems(local_paths)
            stem_urls = {
                name: f"{base_url}/api/v1/extract-stems/{job_id}/download/{name}"
                for name in local_paths
            }

        _jobs[job_id]["stems"] = stem_urls
        _jobs[job_id]["local_paths"] = local_paths
        _jobs[job_id]["status"] = "complete"

    except Exception as exc:
        _jobs[job_id]["status"] = "failed"
        _jobs[job_id]["error"] = str(exc)
        job_dir_path = Path(job_dir)
        if job_dir_path.exists():
            shutil.rmtree(job_dir_path, ignore_errors=True)
