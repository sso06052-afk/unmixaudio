from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings

# config.py 위치 기준으로 .env 경로를 절대경로로 지정
_ENV_FILE = Path(__file__).parent / ".env"


class Settings(BaseSettings):
    # 기존
    max_upload_size_mb: int = 200
    extension_id: str = ""
    replicate_api_token: str = ""

    # 결제/DB — 빈 값 허용하되 assert_payment_env() 에서 명시 검증 (fail-fast)
    database_url: str = Field(default="", description="Supabase Postgres connection string")
    ls_api_key: str = Field(default="", description="Lemon Squeezy API key")
    ls_webhook_secret: str = Field(default="", description="Lemon Squeezy webhook signing secret")
    ls_store_id: str = Field(default="", description="Lemon Squeezy store ID")

    class Config:
        env_file = str(_ENV_FILE)
        extra = "ignore"


settings = Settings()


def assert_payment_env() -> None:
    """결제 기능 활성화 환경에서 필수 env 가 모두 설정되었는지 명시 검증.

    main.py 기동 시 호출. 누락이면 RuntimeError 로 fail-fast.
    """
    missing = []
    if not settings.database_url:
        missing.append("DATABASE_URL")
    if not settings.ls_webhook_secret:
        missing.append("LS_WEBHOOK_SECRET")
    # ls_api_key 와 ls_store_id 는 webhook 처리에는 필수 아님 (수동 발급/조회 용도)
    if missing:
        raise RuntimeError(
            f"Missing required env vars for payment system: {', '.join(missing)}. "
            "Set these in backend/.env or environment."
        )
