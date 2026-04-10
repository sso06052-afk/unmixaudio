from pydantic import BaseModel
from typing import Optional


class StemJobResponse(BaseModel):
    job_id: str
    status: str  # "queued" | "processing" | "complete" | "failed"


class StemResult(BaseModel):
    vocals: Optional[str] = None
    drums: Optional[str] = None
    bass: Optional[str] = None
    other: Optional[str] = None
    # htdemucs_6s only
    guitar: Optional[str] = None
    piano: Optional[str] = None


class StemJobResult(BaseModel):
    job_id: str
    status: str
    stems: Optional[StemResult] = None
    error: Optional[str] = None
