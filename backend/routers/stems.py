"""Stem separation router."""
import shutil
import tempfile
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks

from backend.schemas.stems import StemJobResponse, StemJobResult, StemResult
from backend.services.demucs import separate_stems
from backend.services.denoise import denoise_stems
from backend.services.replicate_stems import separate_stems_replicate, download_replicate_stems
from backend.services.storage import upload_to_supabase
from backend.config import settings

router = APIRouter()

ALLOWED_MODELS = {"htdemucs", "htdemucs_6s", "htdemucs_ft"}

# In-memory job store (replace with DB for production)
_jobs: dict[str, dict] = {}

TMP_DIR = Path(tempfile.gettempdir()) / "unmixaudio-stems"
TMP_DIR.mkdir(parents=True, exist_ok=True)

JOB_TTL_SEC = 3600  # 1시간 후 job 메타 + 임시 파일 정리


def _cleanup_old_jobs() -> None:
    """완료/실패 후 TTL 초과 job의 메타데이터와 임시 파일을 제거."""
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
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    model: str = Form("htdemucs"),
    denoise: bool = Form(False),
):
    """Accept an audio file upload and queue stem separation."""
    if model not in ALLOWED_MODELS:
        raise HTTPException(400, f"Invalid model. Allowed: {sorted(ALLOWED_MODELS)}")

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

    _jobs[job_id] = {
        "status": "processing", "stems": None, "error": None,
        "model": model, "created_at": time.time(),
    }

    background_tasks.add_task(_process_job, job_id, input_path, str(job_dir), model, denoise)
    return StemJobResponse(job_id=job_id, status="processing")


@router.get("/extract-stems/{job_id}", response_model=StemJobResult)
async def get_stem_job(job_id: str):
    """Poll job status and retrieve stem URLs when complete."""
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


async def _process_job(job_id: str, input_path: str, job_dir: str, model: str, denoise: bool = False):
    """Background task: Demucs (Replicate GPU 또는 로컬 CPU) → optional denoise → Supabase 업로드."""
    import os
    try:
        use_replicate = bool(settings.replicate_api_token)

        if use_replicate:
            # ── Replicate 클라우드 GPU 경로 ────────────────────────────────
            os.environ["REPLICATE_API_TOKEN"] = settings.replicate_api_token
            stem_urls = await separate_stems_replicate(input_path, model)

            if denoise:
                # Replicate URL → 로컬 다운로드 → noisereduce → Supabase 업로드
                download_dir = str(Path(job_dir) / "downloaded")
                local_paths = await download_replicate_stems(stem_urls, download_dir)
                local_paths = await denoise_stems(local_paths)
                stem_urls = {}
                for stem_name, local_path in local_paths.items():
                    storage_path = f"{job_id}/{stem_name}.wav"
                    stem_urls[stem_name] = await upload_to_supabase(local_path, storage_path)
        else:
            # ── 로컬 CPU 경로 (fallback) ───────────────────────────────────
            output_dir = str(Path(job_dir) / "output")
            local_paths = await separate_stems(input_path, job_id, output_dir, model)

            if denoise:
                local_paths = await denoise_stems(local_paths)

            stem_urls = {}
            for stem_name, local_path in local_paths.items():
                ext = Path(local_path).suffix
                storage_path = f"{job_id}/{stem_name}{ext}"
                stem_urls[stem_name] = await upload_to_supabase(local_path, storage_path)

        _jobs[job_id]["stems"] = stem_urls
        _jobs[job_id]["status"] = "complete"

    except Exception as exc:
        _jobs[job_id]["status"] = "failed"
        _jobs[job_id]["error"] = str(exc)
