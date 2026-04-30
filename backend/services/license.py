"""라이선스 서비스 — DB CRUD 및 만료 검증.

verify_license는 DB 조회 + status/expires_at 만으로 결정.
LS API 호출 헬퍼는 webhook 핸들러에서 license_key / subscription_id 를 조회할 때 사용.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.models import License
from backend.schemas.payment import LicenseCreatePayload

logger = logging.getLogger(__name__)

LS_API_BASE = "https://api.lemonsqueezy.com/v1"
LS_API_TIMEOUT_SECONDS = 10.0


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


# ---- LS API 호출 헬퍼 ----
#
# LS 의 order_created webhook 은 license_key 를 포함하지 않는다.
# 별도 LS API ( /v1/license-keys?filter[order_id]=... ) 를 호출해야 진짜 발급 키를 얻을 수 있다.
# subscription_id 도 동일하게 /v1/subscriptions?filter[order_id]=... 로 조회.


async def _ls_get(path: str, params: dict) -> Optional[dict]:
    """LS API GET 헬퍼. 실패 시 None 반환 (에러 로깅 포함)."""
    api_key = settings.ls_api_key
    if not api_key:
        logger.error("LS_API_KEY is not configured; cannot call LS API path=%s", path)
        return None

    url = f"{LS_API_BASE}{path}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/vnd.api+json",
    }
    try:
        async with httpx.AsyncClient(timeout=LS_API_TIMEOUT_SECONDS) as client:
            resp = await client.get(url, headers=headers, params=params)
        if resp.status_code != 200:
            logger.error(
                "LS API non-200 path=%s status=%s body=%s",
                path, resp.status_code, resp.text[:300],
            )
            return None
        return resp.json()
    except httpx.HTTPError:
        logger.exception("LS API call failed path=%s params=%s", path, params)
        return None


async def fetch_license_key_for_order(ls_order_id: str) -> Optional[str]:
    """order_id 로 LS API 조회해서 license_key 문자열 반환. 없으면 None."""
    if not ls_order_id:
        return None
    body = await _ls_get("/license-keys", {"filter[order_id]": ls_order_id})
    if not body:
        return None
    data = body.get("data") or []
    if not data:
        logger.error("LS license-keys lookup empty for order_id=%s", ls_order_id)
        return None
    attrs = (data[0] or {}).get("attributes") or {}
    key = attrs.get("key")
    if not key:
        logger.error("LS license-keys missing 'key' attribute for order_id=%s", ls_order_id)
        return None
    return str(key)


async def fetch_subscription_id_for_order(ls_order_id: str) -> Optional[str]:
    """order_id 로 LS API 조회해서 subscription_id 문자열 반환. 없으면 None.

    one-time product 인 경우 subscription 이 없을 수 있으므로 None 은 정상 케이스.
    """
    if not ls_order_id:
        return None
    body = await _ls_get("/subscriptions", {"filter[order_id]": ls_order_id})
    if not body:
        return None
    data = body.get("data") or []
    if not data:
        # one-time product 면 자연스러운 케이스. info 레벨로만.
        logger.info("LS subscriptions lookup empty for order_id=%s (one-time product?)", ls_order_id)
        return None
    sub_id = (data[0] or {}).get("id")
    if not sub_id:
        return None
    return str(sub_id)
