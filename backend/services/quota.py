"""무료 quota 서비스 — 월별 사용량 카운터.

원칙:
- year_month는 UTC 기준 'YYYY-MM' (한국시간 자정 == UTC 15시. UTC 기준 사용해 KST 09:00 리셋).
- device_id 우회 방지를 위해 IP 기준 사용량과 비교 — 둘 중 큰 값을 기준으로 차단.
- increment_usage는 PostgreSQL ON CONFLICT (UPSERT) 로 race condition 안전.
"""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Usage


def current_year_month() -> str:
    """UTC 기준 'YYYY-MM' 반환.

    사용자 결정: 한국시간 자정(KST 00:00) == UTC 15시. UTC 기준이면 매월 1일 KST 09:00에 리셋됨.
    이는 의도된 동작 (글로벌 서비스 일관성).
    """
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m")


def _mask_ip_for_query(ip: Optional[str]) -> Optional[str]:
    """IP 정규화 — 빈 문자열을 None으로."""
    if not ip:
        return None
    return ip.strip() or None


async def get_monthly_usage(
    db: AsyncSession,
    device_id: str,
    ip: Optional[str] = None,
) -> int:
    """현재 월 사용량 — device_id 기준과 IP 기준 SUM 중 큰 값 반환.

    이유: 동일 IP 에서 device_id 만 갈아끼우는 우회 시도 방지.
    IP는 보조 지표이므로 None 이면 device_id 만으로 결정.
    """
    ym = current_year_month()

    # device 사용량
    device_stmt = select(Usage.count).where(
        Usage.device_id == device_id,
        Usage.year_month == ym,
    )
    device_result = await db.execute(device_stmt)
    device_count = device_result.scalar_one_or_none() or 0

    # IP 사용량 (device_id 와 무관하게 동일 IP 의 모든 device 합산)
    ip_norm = _mask_ip_for_query(ip)
    if ip_norm is None:
        return device_count

    ip_stmt = select(func.coalesce(func.sum(Usage.count), 0)).where(
        Usage.last_ip == ip_norm,
        Usage.year_month == ym,
    )
    ip_result = await db.execute(ip_stmt)
    ip_count = int(ip_result.scalar_one() or 0)

    return max(device_count, ip_count)


async def increment_usage(
    db: AsyncSession,
    device_id: str,
    ip: Optional[str] = None,
) -> int:
    """사용량 +1 (atomic UPSERT). 갱신 후 count 반환.

    PostgreSQL ON CONFLICT 사용 — race condition 안전.
    """
    ym = current_year_month()
    ip_norm = _mask_ip_for_query(ip)

    stmt = pg_insert(Usage).values(
        device_id=device_id,
        year_month=ym,
        count=1,
        last_ip=ip_norm,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[Usage.device_id, Usage.year_month],
        set_={
            "count": Usage.__table__.c.count + 1,
            "last_ip": ip_norm if ip_norm is not None else Usage.__table__.c.last_ip,
            "updated_at": func.now(),
        },
    ).returning(Usage.count)

    result = await db.execute(stmt)
    new_count = int(result.scalar_one())
    await db.commit()
    return new_count
