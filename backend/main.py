"""UnmixAudio — FastAPI Backend"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routers import stems
from backend.config import settings

app = FastAPI(
    title="UnmixAudio API",
    description="Audio stem separation backend for UnmixAudio Chrome Extension",
    version="0.1.0",
)

# 프로덕션: EXTENSION_ID 환경변수에 Chrome 웹 스토어에서 발급받은 실제 ID를 설정
# 예) EXTENSION_ID=abcdefghijklmnopabcdefghijklmnop
# 미설정 시 개발 편의를 위해 모든 chrome-extension:// 허용 (배포 전 반드시 설정)
_ext_id = settings.extension_id
_origin_regex = (
    rf"^chrome-extension://{_ext_id}$" if _ext_id
    else r"^chrome-extension://.*$"
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=_origin_regex,
    allow_origins=["http://localhost:3000"],  # for local dev/testing
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(stems.router, prefix="/api/v1", tags=["stems"])


@app.get("/health")
async def health():
    return {"status": "ok"}
