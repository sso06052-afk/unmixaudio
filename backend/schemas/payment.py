"""결제/라이선스/사용량 관련 Pydantic v2 스키마.

요청/응답 명확히 분리. license_key는 응답에 절대 포함하지 않음 (보안).
"""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field


PlanLiteral = Literal["monthly", "annual"]
LicenseStatusLiteral = Literal["active", "expired", "cancelled"]


# ---- 내부 라이선스 발급 페이로드 (webhook → service 계층) ----

class LicenseCreatePayload(BaseModel):
    """webhook 핸들러 → license service 로 전달되는 발급 페이로드."""
    license_key: str = Field(..., max_length=64)
    email: EmailStr
    ls_order_id: str = Field(..., max_length=64)
    ls_subscription_id: Optional[str] = Field(default=None, max_length=64)
    plan: PlanLiteral
    status: LicenseStatusLiteral = "active"
    expires_at: datetime


# ---- 응답 스키마 (license_key 절대 미포함) ----

class LicenseInfoResponse(BaseModel):
    """라이선스 메타 정보. license_key 자체는 노출하지 않는다."""
    email: EmailStr
    plan: PlanLiteral
    status: LicenseStatusLiteral
    expires_at: datetime


class QuotaStatusResponse(BaseModel):
    """현재 무료 quota 사용 현황."""
    used: int
    limit: int
    remaining: int
    year_month: str


# ---- Lemon Squeezy webhook 입력 (느슨한 검증; 알 수 없는 키 허용) ----

class LemonSqueezyMeta(BaseModel):
    event_name: str
    custom_data: Optional[dict] = None

    model_config = {"extra": "allow"}


class LemonSqueezyWebhookPayload(BaseModel):
    """LS 가 보내는 웹훅 바디 — 최소 필드만 명시, 나머지는 raw dict로 처리."""
    meta: LemonSqueezyMeta
    data: dict

    model_config = {"extra": "allow"}
