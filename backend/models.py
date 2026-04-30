"""SQLAlchemy 선언적 모델.

PIPA/GDPR 주석:
- email은 라이선스 발급 및 결제 검증 외 용도로 사용하지 않음.
- last_ip는 부정 사용 방지(quota 우회) 목적에만 사용. 마케팅/분석 용도 사용 금지.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import CHAR, DateTime, Integer, String, func
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column

from backend.database import Base


class License(Base):
    """라이선스 — Lemon Squeezy 결제 webhook 으로 발급/갱신."""
    __tablename__ = "licenses"

    license_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    ls_order_id: Mapped[str] = mapped_column(String(64), nullable=False)
    ls_subscription_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    plan: Mapped[str] = mapped_column(String(16), nullable=False)        # 'monthly' | 'annual'
    status: Mapped[str] = mapped_column(String(16), nullable=False)      # 'active' | 'expired' | 'cancelled'
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
    )


class Usage(Base):
    """월별 사용량 카운터 — Free 사용자의 quota 추적.

    복합 PK: (device_id, year_month)
    매월 1일 UTC 자정 == 한국시간 09:00에 새 row 생성됨 (year_month 변경)
    """
    __tablename__ = "usage"

    device_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    year_month: Mapped[str] = mapped_column(CHAR(7), primary_key=True)  # 'YYYY-MM'
    count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_ip: Mapped[Optional[str]] = mapped_column(INET, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )
