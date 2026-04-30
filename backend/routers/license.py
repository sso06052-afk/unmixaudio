"""라이선스 검증 라우터 — 익스텐션 클라이언트가 키 입력 시 호출.

엔드포인트:
- POST /api/v1/license/verify
  - body: { "license_key": str }
  - 200: { "valid": true, "plan": "monthly"|"annual", "expires_at": ISO8601 }
  - 404: 키 없음
  - 410: 만료됨 (status=expired 또는 expires_at 경과)

보안:
- license_key 자체는 응답에 포함하지 않는다.
- 클라이언트는 본인이 보낸 키만 알면 충분하므로 valid/plan/expires_at만 회신.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models import License
from backend.schemas.payment import PlanLiteral

router = APIRouter()


class LicenseVerifyRequest(BaseModel):
    license_key: str = Field(..., min_length=1, max_length=64)


class LicenseVerifyResponse(BaseModel):
    valid: bool
    plan: PlanLiteral
    expires_at: datetime


@router.post("/license/verify", response_model=LicenseVerifyResponse)
async def verify_license_endpoint(
    payload: LicenseVerifyRequest,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(License).where(License.license_key == payload.license_key)
    result = await db.execute(stmt)
    lic = result.scalar_one_or_none()

    if lic is None:
        # 클라이언트는 404를 "키 없음"으로 해석 (sidepanel.js 계약)
        raise HTTPException(status_code=404, detail="License key not found")

    now = datetime.now(timezone.utc)
    if lic.status == "expired" or lic.expires_at <= now:
        # 410: 만료/취소되어 더 이상 유효하지 않음
        raise HTTPException(status_code=410, detail="License expired")

    # 'active' 또는 'cancelled' 이면서 만료 전 — 사용 가능
    return LicenseVerifyResponse(
        valid=True,
        plan=lic.plan,
        expires_at=lic.expires_at,
    )
