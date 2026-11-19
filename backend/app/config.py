"""Konfigurasi aplikasi PCVK.

Semua nilai dibaca dari file `.env` (python-dotenv) yang berada di root
folder `backend/`, atau dari environment variable sistem.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# backend/app/config.py -> parents[1] == backend/
BASE_DIR = Path(__file__).resolve().parents[1]

# File .env di folder backend/ diprioritaskan, environment variable OS tetap
# bisa menimpa nilainya (load_dotenv tidak menimpa nilai yang sudah ada).
load_dotenv(BASE_DIR / ".env", override=False)
load_dotenv(override=False)


def _get_str(name: str, default: Optional[str] = None, required: bool = False) -> Optional[str]:
    value = os.getenv(name, default)
    if value is not None:
        value = value.strip()
    if required and not value:
        raise RuntimeError(
            f"Environment variable '{name}' belum diisi. "
            f"Salin backend/.env.example menjadi backend/.env lalu lengkapi nilainya."
        )
    return value


def _get_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return float(str(raw).strip())
    except ValueError as exc:
        raise RuntimeError(f"Environment variable '{name}' harus berupa angka, ditemukan: {raw!r}") from exc


def _normalize_database_url(url: str) -> str:
    """Normalisasi URL PostgreSQL agar kompatibel dengan SQLAlchemy + Neon.

    Driver `psycopg2` dipaksa secara eksplisit karena SQLAlchemy 2.1+ memilih
    `psycopg` (v3) sebagai default untuk skema `postgresql://`, sementara
    dependency proyek ini adalah `psycopg2-binary`.
    """
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]

    if url.startswith("postgresql://"):
        url = "postgresql+psycopg2://" + url[len("postgresql://") :]

    if "sslmode=" in url:
        return url

    lowered = url.lower()
    is_local = "localhost" in lowered or "127.0.0.1" in lowered or "@db:" in lowered
    if is_local:
        return url

    separator = "&" if "?" in url else "?"
    return f"{url}{separator}sslmode=require"


class Settings:
    """Objek konfigurasi tunggal untuk seluruh aplikasi."""

    # Database
    DATABASE_URL: str

    # Cloudinary
    CLOUDINARY_CLOUD_NAME: Optional[str]
    CLOUDINARY_API_KEY: Optional[str]
    CLOUDINARY_API_SECRET: Optional[str]
    CLOUDINARY_BASE_FOLDER: str

    # Parameter verifikasi
    SVM_PROBABILITY_THRESHOLD: float
    MAX_EUCLIDEAN_DISTANCE: float

    def __init__(self) -> None:
        database_url = _get_str("DATABASE_URL", required=True)
        assert database_url is not None  # dipastikan oleh _get_str(required=True)
        self.DATABASE_URL = _normalize_database_url(database_url)

        self.CLOUDINARY_CLOUD_NAME = _get_str("CLOUDINARY_CLOUD_NAME")
        self.CLOUDINARY_API_KEY = _get_str("CLOUDINARY_API_KEY")
        self.CLOUDINARY_API_SECRET = _get_str("CLOUDINARY_API_SECRET")
        self.CLOUDINARY_BASE_FOLDER = (
            _get_str("CLOUDINARY_BASE_FOLDER", "pcvk-kelompok5") or "pcvk-kelompok5"
        ).strip("/")

        self.SVM_PROBABILITY_THRESHOLD = _get_float("SVM_PROBABILITY_THRESHOLD", 0.45)
        self.MAX_EUCLIDEAN_DISTANCE = _get_float("MAX_EUCLIDEAN_DISTANCE", 0.65)

        if not 0.0 <= self.SVM_PROBABILITY_THRESHOLD <= 1.0:
            logger.warning(
                "SVM_PROBABILITY_THRESHOLD=%s berada di luar rentang 0.0-1.0",
                self.SVM_PROBABILITY_THRESHOLD,
            )
        if self.MAX_EUCLIDEAN_DISTANCE <= 0:
            logger.warning(
                "MAX_EUCLIDEAN_DISTANCE=%s tidak valid (harus > 0)",
                self.MAX_EUCLIDEAN_DISTANCE,
            )

    @property
    def cloudinary_configured(self) -> bool:
        return all(
            [
                self.CLOUDINARY_CLOUD_NAME,
                self.CLOUDINARY_API_KEY,
                self.CLOUDINARY_API_SECRET,
            ]
        )


settings = Settings()
