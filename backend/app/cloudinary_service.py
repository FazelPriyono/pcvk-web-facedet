"""Integrasi Cloudinary untuk foto registrasi, foto check-in, dan model SVM."""

from __future__ import annotations

import io
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import cloudinary
import cloudinary.api
import cloudinary.uploader
import cloudinary.utils
import requests

from .config import settings

logger = logging.getLogger(__name__)


class CloudinaryError(Exception):
    """Kegagalan umum saat berkomunikasi dengan Cloudinary."""


class CloudinaryNotConfiguredError(CloudinaryError):
    """Kredensial Cloudinary belum lengkap di .env."""


class _NamedBytesIO(io.BytesIO):
    """BytesIO dengan atribut `name` agar requests mengirim ekstensi file."""

    def __init__(self, data: bytes, name: str) -> None:
        super().__init__(data)
        self.name = name


def _detect_format(data: bytes) -> str:
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data.startswith(b"BM"):
        return "bmp"
    return "jpg"


def _safe_public_id(raw: str, fallback: str = "file") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "_", (raw or "").strip())
    cleaned = cleaned.strip("_")
    return cleaned or fallback


class CloudinaryService:
    """Helper upload/download aset ke Cloudinary."""

    def __init__(self) -> None:
        self.cloud_name = settings.CLOUDINARY_CLOUD_NAME
        self.api_key = settings.CLOUDINARY_API_KEY
        self.api_secret = settings.CLOUDINARY_API_SECRET
        self.base_folder = (settings.CLOUDINARY_BASE_FOLDER or "pcvk-kelompok5").strip("/")

        self.enabled = bool(self.cloud_name and self.api_key and self.api_secret)
        if self.enabled:
            cloudinary.config(
                cloud_name=self.cloud_name,
                api_key=self.api_key,
                api_secret=self.api_secret,
                secure=True,
            )
        else:
            logger.warning(
                "Kredensial Cloudinary belum lengkap. Endpoint yang membutuhkan "
                "Cloudinary akan mengembalikan HTTP 503."
            )

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------
    def _folder(self, sub_folder: str) -> str:
        return f"{self.base_folder}/{sub_folder}"

    def _ensure_configured(self) -> None:
        if not self.enabled:
            raise CloudinaryNotConfiguredError(
                "Cloudinary belum dikonfigurasi. Lengkapi CLOUDINARY_CLOUD_NAME, "
                "CLOUDINARY_API_KEY, dan CLOUDINARY_API_SECRET di backend/.env."
            )

    def ping(self) -> bool:
        """Cek kredensial Cloudinary (read-only, tanpa upload)."""
        if not self.enabled:
            return False
        try:
            result = cloudinary.api.ping()
            return result.get("status") == "ok"
        except Exception as exc:
            logger.warning("Ping Cloudinary gagal (cek kredensial di .env): %s", exc)
            return False

    def _upload_image(
        self,
        image_bytes: bytes,
        folder: str,
        public_id: str,
    ) -> Dict[str, str]:
        self._ensure_configured()
        fmt = _detect_format(image_bytes)
        if len(image_bytes) > 10 * 1024 * 1024:
            raise CloudinaryError("Ukuran gambar melebihi batas 10 MB.")

        stream = _NamedBytesIO(image_bytes, f"{public_id}.{fmt}")
        try:
            result = cloudinary.uploader.upload(
                stream,
                folder=folder,
                public_id=public_id,
                overwrite=True,
                unique_filename=False,
                use_filename=False,
                resource_type="image",
                invalidate=True,
            )
        except Exception as exc:  # cloudinary.exceptions.Error dan error jaringan
            logger.exception("Upload gambar ke Cloudinary gagal")
            raise CloudinaryError(f"Upload ke Cloudinary gagal: {exc}") from exc

        secure_url = result.get("secure_url")
        returned_id = result.get("public_id")
        if not secure_url or not returned_id:
            raise CloudinaryError("Respons Cloudinary tidak berisi secure_url/public_id.")

        return {
            "secure_url": secure_url,
            "public_id": returned_id,
            "format": fmt,
            "bytes": int(result.get("bytes", len(image_bytes))),
        }

    # ------------------------------------------------------------------
    # Foto registrasi & check-in
    # ------------------------------------------------------------------
    def upload_registration_photo(self, image_bytes: bytes, bib_number: str) -> Dict[str, str]:
        public_id = f"participant_{_safe_public_id(bib_number, 'unknown')}"
        return self._upload_image(
            image_bytes,
            folder=self._folder("registrations"),
            public_id=public_id,
        )

    def upload_checkin_photo(
        self,
        image_bytes: bytes,
        bib_number: Optional[str] = None,
    ) -> Dict[str, str]:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        bib_part = _safe_public_id(bib_number or "anon", "anon")
        public_id = f"checkin_{bib_part}_{timestamp}"
        return self._upload_image(
            image_bytes,
            folder=self._folder("checkins"),
            public_id=public_id,
        )

    # ------------------------------------------------------------------
    # Model SVM (resource_type="raw")
    # ------------------------------------------------------------------
    def upload_model_file(self, local_path: str, version_name: str) -> Dict[str, str]:
        self._ensure_configured()
        public_id = f"{_safe_public_id(version_name, 'svm_model')}.pkl"
        try:
            with open(local_path, "rb") as model_file:
                result = cloudinary.uploader.upload(
                    model_file,
                    folder=self._folder("models"),
                    public_id=public_id,
                    overwrite=True,
                    unique_filename=False,
                    use_filename=False,
                    resource_type="raw",
                    invalidate=True,
                )
        except Exception as exc:
            logger.exception("Upload model .pkl ke Cloudinary gagal")
            raise CloudinaryError(f"Upload model ke Cloudinary gagal: {exc}") from exc

        secure_url = result.get("secure_url")
        returned_id = result.get("public_id")
        if not secure_url or not returned_id:
            raise CloudinaryError("Respons Cloudinary tidak berisi secure_url/public_id.")

        return {"secure_url": secure_url, "public_id": returned_id}

    def download_raw_file(self, url: str, timeout: int = 60) -> bytes:
        if not url:
            raise CloudinaryError("URL file model kosong.")
        try:
            response = requests.get(url, timeout=timeout)
            response.raise_for_status()
        except requests.RequestException as exc:
            logger.exception("Download file dari Cloudinary gagal: %s", url)
            raise CloudinaryError(f"Download file dari Cloudinary gagal: {exc}") from exc
        return response.content

    def delete_raw_file(self, public_id: str) -> bool:
        self._ensure_configured()
        try:
            result: Dict[str, Any] = cloudinary.uploader.destroy(
                public_id,
                resource_type="raw",
                invalidate=True,
            )
            return result.get("result") == "ok"
        except Exception:
            logger.warning("Gagal menghapus file raw Cloudinary: %s", public_id, exc_info=True)
            return False


cloudinary_service = CloudinaryService()
