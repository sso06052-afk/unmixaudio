"""라이선스 서비스 — DB CRUD 및 만료 검증.

LS API 호출은 webhook 으로 push 되는 정보만 사용 (외부 API 호출 stub만 유지).
verify_license는 DB 조회 + status/expires_at 만으로 결정.
"""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import License
from backend.schemas.payment import LicenseCreatePayload


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def verify_license(db: AsyncSession, license_key: str) -> Optional[License]:
    """라이선스 키 검증.

    - DB에 존재 + status == 'active' or 'cancelled' (취소되었으나 만료까지 사용 가능)
    - expires_at > now (UTC)
    위 조건을 모두 만족하면 License 반환, 그 외에는 None.

    'cancelled' 상태도 expires_at 까지는 active 와 동일하게 사용 허용 (LS 결제 정책).
    만료된 cancelled는 자동으로 'expired'로 전환되지 않으므로 만료 시점만 검증.
    """
    if not license_key:
        return None

    stmt = select(License).where(License.license_key == license_key)
    result = await db.execute(stmt)
    lic = result.scalar_one_or_none()

    if lic is None:
        return None

    if lic.status == "expired":
        return None

    if lic.expires_at <= _utcnow():
        return None

    # 'active' 또는 'cancelled' 이면서 아직 만료 전
    return lic


async def create_license(
    db: AsyncSession, payload: LicenseCreatePayload
) -> License:
    """webhook 의 order_created 처리 — 라이선스 신규 발급.

    동일 license_key 가 이미 존재하면 idempotent 하게 기존 row 반환 (LS 재시도 대응).
    """
    existing = await db.execute(
        select(License).where(License.license_key == payload.license_key)
    )
    found = existing.scalar_one_or_none()
    if found is not None:
        return found

    lic = License(
        license_key=payload.license_key,
        email=str(payload.email),
        ls_order_id=payload.ls_order_id,
        ls_subscription_id=payload.ls_subscription_id,
        plan=payload.plan,
        status=payload.status,
        expires_at=payload.expires_at,
    )
    db.add(lic)
    await db.commit()
    await db.refresh(lic)
    return lic


async def update_license_status(
    db: AsyncSession,
    license_key: str,
    status: Optional[str] = None,
    expires_at: Optional[datetime] = None,
) -> Optional[License]:
    """라이선스 상태/만료일 갱신 — webhook 의 갱신/취소/만료 이벤트 처리용.

    license_key 미존재 시 None 반환 (webhook 재시도 폭주 방지).
    """
    stmt = select(License).where(License.license_key == license_key)
    result = await db.execute(stmt)
    lic = result.scalar_one_or_none()

    if lic is None:
        return None

    if status is not None:
        lic.status = status
    if expires_at is not None:
        lic.expires_at = expires_at

    await db.commit()
    await db.refresh(lic)
    return lic


# ---- LS API 호출 stub (현재 미사용; 필요 시 확장) ----

async def fetch_license_from_ls(license_key: str) -> Optional[dict]:
    """Lemon Squeezy License API 호출 stub.

    현재는 webhook push 만으로 라이선스 상태를 동기화하므로 미구현.
    필요 시 httpx.AsyncClient 로 https://api.lemonsqueezy.com/v1/licenses/validate 호출.
    """
    return None
