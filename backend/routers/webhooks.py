"""Lemon Squeezy webhook 라우터.

이벤트:
- order_created — 신규 라이선스 발급 (license_key 는 LS API 별도 조회로 획득)
- subscription_payment_success — 만료일 연장 (subscription_id 로 라이선스 lookup)
- subscription_cancelled — status='cancelled' (만료까지 사용 가능)
- subscription_expired — status='expired'

보안:
- X-Signature 헤더 HMAC SHA256 검증 (LS_WEBHOOK_SECRET).
- 검증 실패 시 401.
- 처리 중 내부 에러도 200 OK 반환 (LS 재시도 폭주 방지) — 로깅만.

주의:
- LS 의 order_created webhook payload 에는 license_key 가 들어 있지 않다.
  반드시 LS API (/v1/license-keys?filter[order_id]=...) 로 조회해서 가져온다.
- subscription_payment_success 에는 license_key 가 없으므로 subscription_id 로 lookup.
"""
import hashlib
import hmac
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import get_db
from backend.models import License
from backend.schemas.payment import LicenseCreatePayload
from backend.services.license import (
    create_license,
    fetch_license_key_for_order,
    fetch_subscription_id_for_order,
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


def _mask_key(key: Optional[str]) -> str:
    """로그 노출용 — license_key 의 마지막 4자만 표시."""
    if not key:
        return "<none>"
    return f"...{key[-4:]}" if len(key) >= 4 else "<short>"


async def _handle_order_created(db: AsyncSession, data: dict) -> None:
    """신규 주문 — 라이선스 발급.

    LS webhook payload 에 license_key 가 없으므로 LS API 로 별도 조회.
    """
    attrs = data.get("attributes", {}) or {}
    first_order = (attrs.get("first_order_item") or {})

    email = attrs.get("user_email") or attrs.get("customer_email")
    order_id = str(data.get("id") or "")
    plan = _extract_plan(first_order or attrs)

    if not email or not order_id:
        logger.error(
            "order_created missing required fields: email=%s order_id=%s",
            email, order_id,
        )
        return

    if not settings.ls_api_key:
        logger.error(
            "order_created cannot fetch license_key — LS_API_KEY not configured "
            "(order_id=%s email=%s). Skipping.",
            order_id, email,
        )
        return

    # LS API 로 진짜 license_key 조회 (webhook 에는 포함되지 않음)
    license_key = await fetch_license_key_for_order(order_id)
    if not license_key:
        logger.error(
            "order_created: LS API returned no license_key for order_id=%s email=%s. "
            "License will NOT be created.",
            order_id, email,
        )
        return

    # subscription_id 별도 조회 (one-time product 면 None 정상)
    subscription_id = await fetch_subscription_id_for_order(order_id)

    logger.info(
        "order_created resolved: order_id=%s email=%s plan=%s key=%s sub_id=%s",
        order_id, email, plan, _mask_key(license_key), subscription_id or "<none>",
    )

    payload = LicenseCreatePayload(
        license_key=license_key,
        email=email,
        ls_order_id=order_id,
        ls_subscription_id=subscription_id,
        plan=plan,  # type: ignore[arg-type]
        status="active",
        expires_at=_initial_expires_at(plan),
    )
    await create_license(db, payload)


async def _handle_subscription_payment_success(db: AsyncSession, data: dict) -> None:
    """구독 결제 성공 — 만료일 연장.

    payload 에는 license_key 가 없고 subscription_id 만 있으므로 그것으로 lookup.
    """
    attrs = data.get("attributes", {}) or {}
    sub_id_raw = attrs.get("subscription_id") or data.get("id")
    if not sub_id_raw:
        logger.warning("subscription_payment_success missing subscription_id")
        return
    subscription_id = str(sub_id_raw)

    stmt = select(License).where(License.ls_subscription_id == subscription_id)
    result = await db.execute(stmt)
    lic = result.scalar_one_or_none()
    if lic is None:
        logger.warning(
            "subscription_payment_success: license not found for subscription_id=%s",
            subscription_id,
        )
        return

    new_expiry = _extended_expires_at(lic.expires_at, lic.plan)
    await update_license_status(
        db, lic.license_key, status="active", expires_at=new_expiry,
    )
    logger.info(
        "subscription_payment_success applied: subscription_id=%s key=%s new_expiry=%s",
        subscription_id, _mask_key(lic.license_key), new_expiry.isoformat(),
    )


async def _handle_subscription_cancelled(db: AsyncSession, data: dict) -> None:
    """구독 취소 — status='cancelled', 만료일은 유지 (만료까지 사용 가능)."""
    attrs = data.get("attributes", {}) or {}
    sub_id_raw = attrs.get("subscription_id") or data.get("id")
    if not sub_id_raw:
        logger.warning("subscription_cancelled missing subscription_id")
        return
    subscription_id = str(sub_id_raw)

    stmt = select(License).where(License.ls_subscription_id == subscription_id)
    result = await db.execute(stmt)
    lic = result.scalar_one_or_none()
    if lic is None:
        logger.warning(
            "subscription_cancelled: license not found for subscription_id=%s",
            subscription_id,
        )
        return

    await update_license_status(db, lic.license_key, status="cancelled")
    logger.info(
        "subscription_cancelled applied: subscription_id=%s key=%s",
        subscription_id, _mask_key(lic.license_key),
    )


async def _handle_subscription_expired(db: AsyncSession, data: dict) -> None:
    """구독 만료 — status='expired'."""
    attrs = data.get("attributes", {}) or {}
    sub_id_raw = attrs.get("subscription_id") or data.get("id")
    if not sub_id_raw:
        logger.warning("subscription_expired missing subscription_id")
        return
    subscription_id = str(sub_id_raw)

    stmt = select(License).where(License.ls_subscription_id == subscription_id)
    result = await db.execute(stmt)
    lic = result.scalar_one_or_none()
    if lic is None:
        logger.warning(
            "subscription_expired: license not found for subscription_id=%s",
            subscription_id,
        )
        return

    await update_license_status(db, lic.license_key, status="expired")
    logger.info(
        "subscription_expired applied: subscription_id=%s key=%s",
        subscription_id, _mask_key(lic.license_key),
    )


@router.post("/webhooks/lemonsqueezy")
async def lemonsqueezy_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """LS webhook 진입점."""
    raw_body = await request.body()
    signature = request.headers.get("X-Signature")

    if not _verify_signature(raw_body, signature):
        sig_prefix = (signature or "")[:8]
        logger.warning("Webhook signature mismatch: received=%s...", sig_prefix)
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

    logger.info("LS webhook event=%s data_id=%s", event_name, data.get("id"))

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
