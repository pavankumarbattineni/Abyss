from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from config import config

_db = config["DB"]

USERNAME = _db["username"]
PASSWORD = _db["password"]
IP_ADDRESS = _db["ip_address"]
PORT = _db["port"]
DATABASE = _db["database"]
POOL_SIZE = _db.get("pool_size", 40)
MAX_OVERFLOW = _db.get("max_overflow", 10)
POOL_TIMEOUT = _db.get("pool_timeout", 30)
POOL_RECYCLE = _db.get("pool_recycle", 1800)

DATABASE_URL = f"postgresql+asyncpg://{USERNAME}:{PASSWORD}@{IP_ADDRESS}:{PORT}/{DATABASE}"


class Base(DeclarativeBase):
    pass


engine = create_async_engine(
    DATABASE_URL,
    pool_size=POOL_SIZE,
    max_overflow=MAX_OVERFLOW,
    pool_timeout=POOL_TIMEOUT,
    pool_recycle=POOL_RECYCLE,
    pool_pre_ping=True,
)

async_session_maker = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    autoflush=False,
)


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session
