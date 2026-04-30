"""Lemon Squeezy webhook 라우터.

이벤트:
- order_created — 신규 라이선스 발급
- subscription_payment_success — 만료일 연장
- subscription_cancelled — status='cancelled' (만료까지 사용 가능)
- subscription_expired — status='expired'

보안:
- X-Signature 헤더 HMAC SHA256 검증 (LS_WEBHOOK_SECRET).
- 검증 실패 시 401.
- 처리 중 내부 에러도 200 OK 반환 (LS 재시도 폭주 방지) — 로깅만.
"""
import hashlib
import hmac
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import get_db
from backend.schemas.payment import LicenseCreatePayload
from backend.services.license import (
    create_license,
    update_license_status,
)

logger = logging.getLogger(__name__)
router = APIRouter()


PLAN_DURATION_DAYS = {
    "monthly": 31,
    "annual": 366,
}


def _verify_signature(raw_body: bytes, signature_header: Optional[str]) -> bool:
    """HMAC SHA256 서명 검증 (constant-time)."""
    if not signature_header or not settings.ls_webhook_secret:
        return False
    digest = hmac.new(
        settings.ls_webhook_secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(digest, signature_header.strip())


def _extract_plan(attrs: dict) -> str:
    """variant name 또는 product name 으로부터 'monthly' / 'annual' 결정.

    LS 대시보드 variant 이름에 'annual' 또는 'year' 포함되면 annual, 아니면 monthly.
    """
    variant_name = (attrs.get("variant_name") or "").lower()
    product_name = (attrs.get("product_name") or "").lower()
    blob = f"{variant_name} {product_name}"
    if "annual" in blob or "year" in blob or "yearly" in blob:
        return "annual"
    return "monthly"


def _generate_license_key() -> str:
    """LS 가 license_key 를 보내지 않는 product 를 위한 fallback 생성기.

    실제로는 LS license API product 사용 시 webhook attrs.license_key 를 그대로 사용.
    """
    return secrets.token_urlsafe(32)[:64]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _initial_expires_at(plan: str) -> datetime:
    days = PLAN_DURATION_DAYS.get(plan, 31)
    return _utcnow() + timedelta(days=days)


def _extended_expires_at(current: Optional[datetime], plan: str) -> datetime:
    """기존 만료일 기준으로 연장. 이미 만료되었으면 now 기준."""
    days = PLAN_DURATION_DAYS.get(plan, 31)
    base = current if current and current > _utcnow() else _utcnow()
    return base + timedelta(days=days)


async def _handle_order_created(db: AsyncSession, data: dict) -> None:
    """신규 주문 — 라이선스 발급."""
    attrs = data.get("attributes", {}) or {}
    first_order = (attrs.get("first_order_item") or {})

    license_key = attrs.get("license_key") or first_order.get("license_key") or _generate_license_key()
    email = attrs.get("user_email") or attrs.get("customer_email")
    order_id = str(data.get("id") or attrs.get("order_id") or "")
    subscription_id = attrs.get("subscription_id")
    plan = _extract_plan(first_order or attrs)

    if not email or not order_id:
        logger.warning("order_created missing required fields: email=%s order_id=%s", email, order_id)
        return

    payload = LicenseCreatePayload(
        license_key=license_key,
        email=email,
        ls_order_id=order_id,
        ls_subscription_id=str(subscription_id) if subscription_id else None,
        plan=plan,  # type: ignore[arg-type]
        status="active",
        expires_at=_initial_expires_at(plan),
    )
    await create_license(db, payload)


async def _handle_subscription_payment_success(db: AsyncSession, data: dict) -> None:
    """구독 결제 성공 — 만료일 연장."""
    attrs = data.get("attributes", {}) or {}
    license_key = attrs.get("license_key")
    if not license_key:
        logger.warning("subscription_payment_success missing license_key")
        return

    # plan 정보가 webhook 에 없을 수 있어 기존 라이선스의 plan 으로 연장
    from backend.services.license import verify_license  # 지연 import (순환 방지)
    from sqlalchemy import select
    from backend.models import License

    stmt = select(License).where(License.license_key == license_key)
    result = await db.execute(stmt)
    lic = result.scalar_one_or_none()
    if lic is None:
        logger.warning("subscription_payment_success: license not found %s", license_key)
        return

    new_expiry = _extended_expires_at(lic.expires_at, lic.plan)
    await update_license_status(
        db, license_key, status="active", expires_at=new_expiry,
    )


async def _handle_subscription_cancelled(db: AsyncSession, data: dict) -> None:
    """구독 취소 — status='cancelled', 만료일은 유지 (만료까지 사용 가능)."""
    attrs = data.get("attributes", {}) or {}
    license_key = attrs.get("license_key")
    if not license_key:
        logger.warning("subscription_cancelled missing license_key")
        return
    await update_license_status(db, license_key, status="cancelled")


async def _handle_subscription_expired(db: AsyncSession, data: dict) -> None:
    """구독 만료 — status='expired'."""
    attrs = data.get("attributes", {}) or {}
    license_key = attrs.get("license_key")
    if not license_key:
        logger.warning("subscription_expired missing license_key")
        return
    await update_license_status(db, license_key, status="expired")


@router.post("/webhooks/lemonsqueezy")
async def lemonsqueezy_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """LS webhook 진입점."""
    raw_body = await request.body()
    signature = request.headers.get("X-Signature")

    if not _verify_signature(raw_body, signature):
        # 서명 검증 실패는 401 — LS 가 재시도하지 않아도 됨 (잘못된 secret 일 가능성)
        raise HTTPException(status_code=401, detail="Invalid signature")

    try:
        body = json.loads(raw_body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        logger.exception("Webhook body parse failed")
        return {"status": "ok"}  # 200 OK — 재시도 폭주 방지

    meta = body.get("meta") or {}
    data = body.get("data") or {}
    event_name = meta.get("event_name") or ""

    try:
        if event_name == "order_created":
            await _handle_order_created(db, data)
        elif event_name == "subscription_payment_success":
            await _handle_subscription_payment_success(db, data)
        elif event_name == "subscription_cancelled":
            await _handle_subscription_cancelled(db, data)
        elif event_name == "subscription_expired":
            await _handle_subscription_expired(db, data)
        else:
            logger.info("Unhandled LS event: %s", event_name)
    except Exception:
        # 내부 에러도 200 OK 반환 — LS 무한 재시도 폭주 방지. 로깅만.
        logger.exception("Webhook handler failed for event=%s", event_name)

    return {"status": "ok"}
