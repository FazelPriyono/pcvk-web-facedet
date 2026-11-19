"""Koneksi database PostgreSQL (Neon) dengan SQLAlchemy."""

from __future__ import annotations

import logging
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings

logger = logging.getLogger(__name__)

# `pool_pre_ping` penting untuk Neon (serverless) yang memutus koneksi idle.
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=300,
    pool_size=5,
    max_overflow=10,
    pool_timeout=30,
    future=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    future=True,
)

Base = declarative_base()


def get_db() -> Generator:
    """Dependency FastAPI: satu session database per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Membuat tabel yang belum ada (idempotent)."""
    # Import di dalam fungsi agar seluruh model terdaftar di metadata Base.
    from . import models  # noqa: F401  (side effect: registrasi model)

    Base.metadata.create_all(bind=engine)
    logger.info("Skema database siap (create_all selesai).")
