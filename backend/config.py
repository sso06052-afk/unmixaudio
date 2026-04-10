from pathlib import Path
from pydantic_settings import BaseSettings

# config.py 위치 기준으로 .env 경로를 절대경로로 지정
_ENV_FILE = Path(__file__).parent / ".env"


class Settings(BaseSettings):
    supabase_url: str = ""
    supabase_key: str = ""
    supabase_bucket: str = "stems"
    max_upload_size_mb: int = 200
    extension_id: str = ""  # 프로덕션: Chrome 웹 스토어 extension ID (32자 소문자)
    replicate_api_token: str = ""  # Replicate API 토큰 — 설정 시 Demucs를 Replicate GPU로 실행

    class Config:
        env_file = str(_ENV_FILE)


settings = Settings()
