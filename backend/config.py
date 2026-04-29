from pathlib import Path
from pydantic_settings import BaseSettings

# config.py 위치 기준으로 .env 경로를 절대경로로 지정
_ENV_FILE = Path(__file__).parent / ".env"


class Settings(BaseSettings):
    max_upload_size_mb: int = 200
    extension_id: str = ""
    replicate_api_token: str = ""

    class Config:
        env_file = str(_ENV_FILE)


settings = Settings()
