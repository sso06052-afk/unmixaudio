"""SQLAlchemy 2.0 비동기 엔진 + asyncpg.

Supabase Postgres 연결을 관리. FastAPI dependency로 async session 제공.

DATABASE_URL 환경변수가 비어있으면 (로컬 dev with DISABLE_PAYMENT_ENV_CHECK=1) import 시점에
엔진을 생성하지 않고, 실제 호출 시점에 명확한 에러를 던진다 — 그렇게 해야 익스텐션 통합 테스트
용으로 stems endpoint 외 부분은 부팅된다.
"""
from typing import AsyncGenerator, Optional

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from backend.config import settings


class Base(DeclarativeBase):
    """SQLAlchemy 2.0 declarative base."""
    pass


def _normalize_dsn(dsn: str) -> str:
    """Supabase가 제공하는 postgres:// 또는 postgresql:// DSN을 asyncpg 드라이버용으로 정규화."""
    if dsn.startswith("postgres://"):
        dsn = dsn.replace("postgres://", "postgresql://", 1)
    if dsn.startswith("postgresql://") and "+asyncpg" not in dsn:
        dsn = dsn.replace("postgresql://", "postgresql+asyncpg://", 1)
    return dsn


_engine: Optional[AsyncEngine] = None
_session_maker: Optional[async_sessionmaker] = None


def _get_engine() -> AsyncEngine:
    """엔진 lazy 초기화. DATABASE_URL 미설정이면 명시적 에러."""
    global _engine, _session_maker
    if _engine is not None:
        return _engine
    if not settings.database_url:
        raise RuntimeError(
            "DATABASE_URL not configured — "
            "결제/라이선스 기능을 사용하려면 backend/.env 의 DATABASE_URL 을 설정해야 함."
        )
    # Supabase pooler(Supavisor) 호환: prepared statement 비활성화
    # — pooler.supabase.com 경유 시 prepared statement 충돌 회피
    dsn = _normalize_dsn(settings.database_url)
    connect_args = {}
    if "pooler.supabase.com" in dsn:
        connect_args["statement_cache_size"] = 0
        connect_args["prepared_statement_cache_size"] = 0

    # Railway free tier 고려: pool_size=10, max_overflow=0
    _engine = create_async_engine(
        dsn,
        pool_size=10,
        max_overflow=0,
        pool_pre_ping=True,
        echo=False,
        connect_args=connect_args,
    )
    _session_maker = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )
    return _engine


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency — async session 생성/정리."""
    _get_engine()  # 첫 호출 시 엔진/세션 메이커 초기화
    assert _session_maker is not None  # _get_engine 후 보장됨
    async with _session_maker() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
