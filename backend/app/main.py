"""Aplikasi FastAPI - Sistem Presensi Event Lari PCVK (Kelompok 5).

Menjalankan server (dari folder `backend/`):
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

Dokumentasi interaktif:
    http://localhost:8000/docs
"""

from __future__ import annotations

import logging
import os
import re
import tempfile
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, or_, text as sql_text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from .cloudinary_service import (
    CloudinaryError,
    CloudinaryNotConfiguredError,
    cloudinary_service,
)
from .config import settings
from .database import SessionLocal, get_db, init_db
from .models import (
    FEATURE_DIMENSION,
    FEATURE_METHOD,
    AttendanceLog,
    FaceVector,
    ModelArtifact,
    Participant,
)
from .pcvk_engine import (
    FaceNotDetectedError,
    InvalidImageError,
    ModelNotTrainedError,
    PCVKError,
    engine as pcvk_engine,
)
from .schemas import (
    AttendanceLogOut,
    HealthResponse,
    ModelStatusResponse,
    ParticipantOut,
    ParticipantSummary,
    RegisterResponse,
    RetrainResponse,
    VerifyResponse,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger("pcvk.main")

MAX_UPLOAD_BYTES = 8 * 1024 * 1024  # 8 MB
MAX_MODEL_BYTES = 200 * 1024 * 1024  # 200 MB (file .pkl dari Colab)
EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ALLOWED_MODES = {"1:1", "1:N"}
ALLOWED_STATUSES = {"VERIFIED", "REJECTED"}


# ---------------------------------------------------------------------------
# Startup: muat model SVM aktif dari tabel model_artifacts
# ---------------------------------------------------------------------------
def load_active_model() -> None:
    """Mengunduh dan memuat model SVM aktif dari Cloudinary (jika ada)."""
    db = SessionLocal()
    try:
        artifact = (
            db.query(ModelArtifact)
            .filter(ModelArtifact.is_active.is_(True))
            .order_by(ModelArtifact.created_at.desc(), ModelArtifact.id.desc())
            .first()
        )
        if artifact is None:
            logger.warning(
                "Belum ada model SVM aktif di model_artifacts. "
                "Endpoint /api/verify akan mengembalikan HTTP 503 sampai "
                "POST /api/model/sync (model dari Colab) atau "
                "POST /api/model/retrain dijalankan."
            )
            return

        model_bytes = cloudinary_service.download_raw_file(artifact.model_file_url)
        bundle = pcvk_engine.load_model_bytes(model_bytes)
        pcvk_engine.set_model_bundle(bundle)
        logger.info(
            "Model SVM aktif dimuat: version=%s (%s vektor, %s kelas)",
            artifact.version_name,
            bundle.get("samples"),
            len(bundle.get("classes", [])),
        )
    except CloudinaryNotConfiguredError:
        logger.warning("Cloudinary belum dikonfigurasi; model SVM tidak dimuat saat startup.")
    except Exception:
        logger.exception("Gagal memuat model SVM aktif saat startup")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("Memulai aplikasi PCVK Backend...")
    try:
        init_db()
    except Exception:
        logger.exception(
            "Inisialisasi database gagal. Periksa DATABASE_URL. "
            "Aplikasi tetap berjalan agar /health dapat melaporkan masalah."
        )

    load_active_model()
    logger.info(
        "Threshold SVM=%s | Max Euclidean Distance=%s",
        settings.SVM_PROBABILITY_THRESHOLD,
        settings.MAX_EUCLIDEAN_DISTANCE,
    )
    yield
    logger.info("Aplikasi PCVK Backend berhenti.")


app = FastAPI(
    title="PCVK - Sistem Presensi Event Lari (Kelompok 5)",
    description=(
        "Backend API untuk registrasi peserta, verifikasi wajah (1:1 / 1:N), "
        "dan re-training model SVM HOG+LBPH 8.740 dimensi."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------
def _read_image_upload(photo: UploadFile, field_name: str = "photo") -> bytes:
    if photo is None or not getattr(photo, "filename", None):
        raise HTTPException(status_code=400, detail=f"File '{field_name}' wajib diunggah.")

    content_type = (photo.content_type or "").lower()
    if content_type and not content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail=f"File '{field_name}' harus berupa gambar (image/*).",
        )

    try:
        data = photo.file.read()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Gagal membaca file '{field_name}'.") from exc
    finally:
        try:
            photo.file.close()
        except Exception:
            pass

    if not data:
        raise HTTPException(status_code=400, detail=f"File '{field_name}' kosong.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Ukuran file '{field_name}' melebihi batas 8 MB.",
        )
    return data


def _clean_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _normalize_status_filter(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    normalized = value.strip().upper()
    if normalized not in ALLOWED_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="Parameter 'status' harus VERIFIED atau REJECTED.",
        )
    return normalized


def _participant_out(
    participant: Participant,
    vector_count: int = 0,
    has_centroid: bool = False,
) -> ParticipantOut:
    return ParticipantOut(
        id=participant.id,
        bib_number=participant.bib_number,
        full_name=participant.full_name,
        email=participant.email,
        phone_number=participant.phone_number,
        race_category=participant.race_category or "5K",
        registration_photo_url=participant.registration_photo_url,
        cloudinary_public_id=participant.cloudinary_public_id,
        is_enrolled=bool(participant.is_enrolled),
        created_at=participant.created_at,
        face_vector_count=vector_count,
        has_centroid=has_centroid,
    )


def _participant_summary(participant: Optional[Participant]) -> Optional[ParticipantSummary]:
    if participant is None:
        return None
    return ParticipantSummary(
        id=participant.id,
        bib_number=participant.bib_number,
        full_name=participant.full_name,
        race_category=participant.race_category or "5K",
    )


def _latest_centroid(db: Session, participant_id: int) -> Optional[FaceVector]:
    return (
        db.query(FaceVector)
        .filter(
            FaceVector.participant_id == participant_id,
            FaceVector.is_centroid.is_(True),
        )
        .order_by(FaceVector.created_at.desc(), FaceVector.id.desc())
        .first()
    )


def _enrolled_centroids(db: Session) -> Dict[int, np.ndarray]:
    """Mengambil centroid terbaru tiap peserta terdaftar: participant_id -> vektor."""
    rows = (
        db.query(FaceVector)
        .join(Participant, FaceVector.participant_id == Participant.id)
        .filter(
            Participant.is_enrolled.is_(True),
            FaceVector.is_centroid.is_(True),
        )
        .order_by(FaceVector.created_at.asc(), FaceVector.id.asc())
        .all()
    )

    centroids: Dict[int, np.ndarray] = {}
    for row in rows:
        vector = row.feature_vector
        if not vector or len(vector) != FEATURE_DIMENSION:
            logger.warning(
                "Melewati centroid participant_id=%s karena dimensi tidak valid (%s).",
                row.participant_id,
                len(vector) if vector else 0,
            )
            continue
        centroids[int(row.participant_id)] = np.asarray(vector, dtype=np.float64)
    return centroids


def _numeric_distance(value: float) -> float:
    """Pastikan nilai muat di kolom NUMERIC(6,4)."""
    return min(max(round(float(value), 4), 0.0), 99.9999)


# ---------------------------------------------------------------------------
# Root & health
# ---------------------------------------------------------------------------
@app.get("/", tags=["Info"])
def root() -> Dict[str, Any]:
    return {
        "app": "PCVK - Sistem Presensi Event Lari (Kelompok 5)",
        "version": "1.0.0",
        "docs": "/docs",
        "endpoints": {
            "register": "POST /api/register",
            "verify": "POST /api/verify",
            "retrain": "POST /api/model/retrain",
            "sync_model": "POST /api/model/sync",
            "participants": "GET /api/participants",
            "attendance_logs": "GET /api/attendance-logs",
            "model_status": "GET /api/model/status",
            "health": "GET /health",
        },
        "thresholds": {
            "svm_probability": settings.SVM_PROBABILITY_THRESHOLD,
            "max_euclidean_distance": settings.MAX_EUCLIDEAN_DISTANCE,
        },
    }


@app.get("/health", response_model=HealthResponse, tags=["Info"])
def health(db: Session = Depends(get_db)) -> HealthResponse:
    database_status = "ok"
    try:
        db.execute(sql_text("SELECT 1"))
    except SQLAlchemyError:
        logger.exception("Health check database gagal")
        database_status = "error"

    cloudinary_status = "not_configured"
    if cloudinary_service.enabled:
        cloudinary_status = "ok" if cloudinary_service.ping() else "error"

    return HealthResponse(
        status="ok" if database_status == "ok" and cloudinary_status != "error" else "degraded",
        database=database_status,
        cloudinary=cloudinary_status,
        svm_model="loaded" if pcvk_engine.is_model_ready else "not_loaded",
        timestamp=datetime.now(timezone.utc),
    )


# ---------------------------------------------------------------------------
# 1. Registrasi peserta
# ---------------------------------------------------------------------------
@app.post(
    "/api/register",
    response_model=RegisterResponse,
    status_code=201,
    tags=["Peserta"],
)
def register_participant(
    bib_number: str = Form(..., description="Nomor BIB unik peserta"),
    full_name: str = Form(..., description="Nama lengkap peserta"),
    email: str = Form(..., description="Email unik peserta"),
    phone_number: Optional[str] = Form(None, description="Nomor telepon (opsional)"),
    race_category: str = Form("5K", description="Kategori lomba, default 5K"),
    photo: UploadFile = File(..., description="Foto registrasi wajah (JPG/PNG)"),
    db: Session = Depends(get_db),
) -> RegisterResponse:
    bib = (bib_number or "").strip().upper()
    name = (full_name or "").strip()
    email_clean = (email or "").strip().lower()
    category = ((race_category or "5K").strip().upper()) or "5K"

    if not bib:
        raise HTTPException(status_code=400, detail="bib_number wajib diisi.")
    if len(bib) > 50:
        raise HTTPException(status_code=400, detail="bib_number maksimal 50 karakter.")
    if not name:
        raise HTTPException(status_code=400, detail="full_name wajib diisi.")
    if len(name) > 150:
        raise HTTPException(status_code=400, detail="full_name maksimal 150 karakter.")
    if not EMAIL_REGEX.match(email_clean):
        raise HTTPException(status_code=400, detail="Format email tidak valid.")
    if len(email_clean) > 150:
        raise HTTPException(status_code=400, detail="email maksimal 150 karakter.")
    if len(category) > 20:
        raise HTTPException(status_code=400, detail="race_category maksimal 20 karakter.")
    if phone_number and len(phone_number.strip()) > 30:
        raise HTTPException(status_code=400, detail="phone_number maksimal 30 karakter.")

    duplicate = (
        db.query(Participant)
        .filter(
            or_(
                Participant.bib_number == bib,
                func.lower(Participant.email) == email_clean,
            )
        )
        .first()
    )
    if duplicate is not None:
        if duplicate.bib_number == bib:
            raise HTTPException(
                status_code=409,
                detail=f"bib_number '{bib}' sudah terdaftar atas nama {duplicate.full_name}.",
            )
        raise HTTPException(
            status_code=409,
            detail=f"email '{email_clean}' sudah terdaftar.",
        )

    image_bytes = _read_image_upload(photo, "photo")

    # Ekstraksi vektor wajah (8.740 dimensi) sebelum menyentuh database/Cloudinary.
    try:
        feature_vector = pcvk_engine.extract_feature_vector(image_bytes)
    except FaceNotDetectedError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except InvalidImageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PCVKError as exc:
        logger.exception("Ekstraksi fitur gagal saat registrasi")
        raise HTTPException(status_code=500, detail=f"Gagal memproses wajah: {exc}") from exc

    try:
        uploaded = cloudinary_service.upload_registration_photo(image_bytes, bib)
    except CloudinaryNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except CloudinaryError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    participant = Participant(
        bib_number=bib,
        full_name=name,
        email=email_clean,
        phone_number=_clean_text(phone_number),
        race_category=category,
        registration_photo_url=uploaded["secure_url"],
        cloudinary_public_id=uploaded["public_id"],
        is_enrolled=False,
    )
    db.add(participant)
    db.flush()  # dapatkan participant.id

    face_vector = FaceVector(
        participant_id=participant.id,
        feature_vector=feature_vector.astype(float).tolist(),
        vector_dimension=int(feature_vector.size),
        feature_method=FEATURE_METHOD,
        is_centroid=True,
    )
    db.add(face_vector)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        logger.warning("Integritas data registrasi dilanggar: %s", exc)
        raise HTTPException(
            status_code=409,
            detail="bib_number atau email sudah digunakan oleh peserta lain.",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Gagal menyimpan peserta")
        raise HTTPException(status_code=500, detail="Gagal menyimpan data peserta.") from exc

    db.refresh(participant)

    return RegisterResponse(
        message=(
            "Peserta berhasil didaftarkan. Peserta akan berstatus is_enrolled=True "
            "setelah POST /api/model/retrain dijalankan."
        ),
        participant=_participant_out(participant, vector_count=1, has_centroid=True),
        vector_dimension=int(feature_vector.size),
        feature_method=FEATURE_METHOD,
    )


# ---------------------------------------------------------------------------
# 2. Verifikasi wajah / presensi
# ---------------------------------------------------------------------------
@app.post("/api/verify", response_model=VerifyResponse, tags=["Presensi"])
def verify_attendance(
    photo: UploadFile = File(..., description="Foto tangkapan webcam saat check-in"),
    verification_mode: str = Form("1:1", description="'1:1' atau '1:N'"),
    bib_number: Optional[str] = Form(None, description="Wajib untuk mode 1:1"),
    db: Session = Depends(get_db),
) -> VerifyResponse:
    started_at = time.perf_counter()

    mode = (verification_mode or "1:1").strip().upper()
    if mode not in ALLOWED_MODES:
        raise HTTPException(
            status_code=400,
            detail="verification_mode harus '1:1' atau '1:N'.",
        )

    bib = (bib_number or "").strip().upper() or None
    if mode == "1:1" and not bib:
        raise HTTPException(
            status_code=400,
            detail="bib_number wajib diisi untuk verification_mode '1:1'.",
        )

    image_bytes = _read_image_upload(photo, "photo")

    try:
        feature_vector = pcvk_engine.extract_feature_vector(image_bytes)
    except FaceNotDetectedError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except InvalidImageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PCVKError as exc:
        logger.exception("Ekstraksi fitur gagal saat verifikasi")
        raise HTTPException(status_code=500, detail=f"Gagal memproses wajah: {exc}") from exc

    participant: Optional[Participant] = None
    candidate_id: Optional[int] = None
    svm_probability = 0.0
    distance = float("inf")

    try:
        if mode == "1:1":
            participant = (
                db.query(Participant)
                .filter(func.upper(Participant.bib_number) == bib)
                .first()
            )
            if participant is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Peserta dengan bib_number '{bib}' tidak ditemukan.",
                )
            if not participant.is_enrolled:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Peserta '{participant.bib_number}' belum terdaftar dalam model SVM. "
                        "Sinkronkan model dari Colab lewat POST /api/model/sync terlebih dahulu."
                    ),
                )

            centroid_row = _latest_centroid(db, participant.id)
            if centroid_row is None or not centroid_row.feature_vector:
                raise HTTPException(
                    status_code=400,
                    detail=f"Vektor centroid wajah peserta '{participant.bib_number}' tidak ditemukan.",
                )

            centroid = np.asarray(centroid_row.feature_vector, dtype=np.float64)
            distance = pcvk_engine.euclidean_distance(feature_vector, centroid)
            svm_probability = pcvk_engine.predict_probability_for(feature_vector, participant.id)
            candidate_id = participant.id

        else:  # 1:N
            centroids = _enrolled_centroids(db)
            if not centroids:
                raise HTTPException(
                    status_code=404,
                    detail="Belum ada peserta terdaftar (is_enrolled=True) untuk pencocokan 1:N.",
                )

            probabilities = pcvk_engine.predict_all(feature_vector)
            enrolled_probabilities = {
                pid: prob for pid, prob in probabilities.items() if pid in centroids
            }

            if enrolled_probabilities:
                candidate_id, svm_probability = max(
                    enrolled_probabilities.items(), key=lambda item: item[1]
                )
            else:
                candidate_id = None
                svm_probability = 0.0

            distances = {
                pid: pcvk_engine.euclidean_distance(feature_vector, centroid)
                for pid, centroid in centroids.items()
            }

            if candidate_id is None or candidate_id not in centroids:
                # Model tidak mengenali kelas yang terdaftar -> pakai kandidat terdekat.
                candidate_id = min(distances, key=distances.get)
                svm_probability = 0.0

            distance = distances[candidate_id]
            participant = db.get(Participant, candidate_id)

    except ModelNotTrainedError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if distance == float("inf"):
        raise HTTPException(
            status_code=500,
            detail="Perhitungan jarak Euclidean gagal (centroid tidak tersedia).",
        )

    status_value, reasons = pcvk_engine.evaluate_match(svm_probability, distance)

    if status_value == "VERIFIED" and participant is not None:
        message = (
            f"Verifikasi BERHASIL untuk {participant.full_name} "
            f"({participant.bib_number}) - {participant.race_category}."
        )
    elif participant is not None:
        message = "Verifikasi GAGAL untuk kandidat " f"{participant.bib_number}: " + "; ".join(reasons)
    else:
        message = "Verifikasi GAGAL: " + "; ".join(reasons)

    # Upload foto check-in.
    try:
        uploaded = cloudinary_service.upload_checkin_photo(
            image_bytes,
            bib or (participant.bib_number if participant else None),
        )
    except CloudinaryNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except CloudinaryError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    processing_time_ms = (time.perf_counter() - started_at) * 1000.0
    checked_in_at = datetime.now(timezone.utc)
    similarity_score = round(max(0.0, min(svm_probability, 1.0)) * 100.0, 2)

    # Untuk 1:N yang ditolak, peserta tidak dikaitkan agar statistik tetap bersih.
    log_participant_id: Optional[int] = None
    if mode == "1:1":
        log_participant_id = participant.id if participant else None
    elif status_value == "VERIFIED" and participant is not None:
        log_participant_id = participant.id

    attendance_log = AttendanceLog(
        participant_id=log_participant_id,
        input_bib_number=bib,
        checkin_photo_url=uploaded["secure_url"],
        cloudinary_checkin_id=uploaded["public_id"],
        verification_mode=mode,
        similarity_score=similarity_score,
        euclidean_distance=_numeric_distance(distance),
        processing_time_ms=round(processing_time_ms, 2),
        status=status_value,
        checked_in_at=checked_in_at,
    )
    db.add(attendance_log)

    try:
        db.commit()
        db.refresh(attendance_log)
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Gagal menyimpan attendance_log")
        raise HTTPException(
            status_code=500,
            detail="Verifikasi selesai tetapi gagal menyimpan riwayat presensi.",
        ) from exc

    return VerifyResponse(
        status=status_value,
        message=message,
        verification_mode=mode,
        input_bib_number=bib,
        participant=_participant_summary(participant),
        svm_probability=round(float(svm_probability), 4),
        similarity_score=similarity_score,
        euclidean_distance=round(float(distance), 4),
        processing_time_ms=round(processing_time_ms, 2),
        threshold_probability=settings.SVM_PROBABILITY_THRESHOLD,
        threshold_distance=settings.MAX_EUCLIDEAN_DISTANCE,
        checkin_photo_url=uploaded["secure_url"],
        cloudinary_checkin_id=uploaded["public_id"],
        attendance_log_id=attendance_log.id,
        checked_in_at=checked_in_at,
    )


# ---------------------------------------------------------------------------
# 3. Re-training / sinkronisasi model SVM
# ---------------------------------------------------------------------------
@app.post("/api/model/retrain", response_model=RetrainResponse, tags=["Model"])
def retrain_model(db: Session = Depends(get_db)) -> RetrainResponse:
    rows = (
        db.query(FaceVector)
        .order_by(FaceVector.participant_id.asc(), FaceVector.created_at.asc(), FaceVector.id.asc())
        .all()
    )
    if not rows:
        raise HTTPException(
            status_code=400,
            detail="Belum ada face_vectors di database. Daftarkan peserta terlebih dahulu.",
        )

    vectors: List[List[float]] = []
    labels: List[int] = []
    for row in rows:
        vector = row.feature_vector
        if not vector:
            logger.warning("Melewati face_vector id=%s karena kosong.", row.id)
            continue
        if len(vector) != FEATURE_DIMENSION:
            logger.warning(
                "Melewati face_vector id=%s karena dimensi %s != %s.",
                row.id,
                len(vector),
                FEATURE_DIMENSION,
            )
            continue
        vectors.append(vector)
        labels.append(int(row.participant_id))

    if not vectors:
        raise HTTPException(
            status_code=400,
            detail=f"Tidak ada face_vector valid berukuran {FEATURE_DIMENSION} dimensi.",
        )
    if len(set(labels)) < 2:
        raise HTTPException(
            status_code=400,
            detail=(
                "Minimal 2 peserta dengan vektor wajah diperlukan untuk melatih SVM. "
                f"Saat ini hanya ada {len(set(labels))} peserta."
            ),
        )

    try:
        bundle, metrics = pcvk_engine.train(vectors=vectors, labels=labels)
    except PCVKError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Training SVM gagal")
        raise HTTPException(status_code=500, detail=f"Training SVM gagal: {exc}") from exc

    version_name: str = metrics["version"]
    classes: List[int] = [int(c) for c in bundle["classes"]]

    temp_path: Optional[str] = None
    try:
        file_descriptor, temp_path = tempfile.mkstemp(prefix=f"{version_name}_", suffix=".pkl")
        os.close(file_descriptor)
        pcvk_engine.dump_model_bundle(bundle, temp_path)

        try:
            uploaded_model = cloudinary_service.upload_model_file(temp_path, version_name)
        except CloudinaryNotConfiguredError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except CloudinaryError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                logger.warning("Gagal menghapus file model sementara: %s", temp_path)

    try:
        # Nonaktifkan versi lama, lalu simpan versi baru sebagai aktif.
        db.query(ModelArtifact).filter(ModelArtifact.is_active.is_(True)).update(
            {ModelArtifact.is_active: False},
            synchronize_session=False,
        )

        artifact = ModelArtifact(
            version_name=version_name,
            model_file_url=uploaded_model["secure_url"],
            cloudinary_model_id=uploaded_model["public_id"],
            baseline_accuracy=metrics.get("baseline_accuracy"),
            modified_accuracy=metrics.get("modified_accuracy"),
            best_c_param=metrics.get("best_c_param"),
            is_active=True,
        )
        db.add(artifact)
        db.flush()

        enrolled = (
            db.query(Participant)
            .filter(Participant.id.in_(classes))
            .update({Participant.is_enrolled: True}, synchronize_session=False)
        )

        db.commit()
        db.refresh(artifact)
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Gagal menyimpan model_artifacts")
        raise HTTPException(
            status_code=500,
            detail="Model berhasil dilatih tetapi gagal disimpan ke database.",
        ) from exc

    # Aktifkan model baru di memori tanpa restart server.
    pcvk_engine.set_model_bundle(bundle)

    return RetrainResponse(
        message=(
            "Model SVM berhasil dilatih ulang, diunggah ke Cloudinary, "
            "dan diaktifkan."
        ),
        version_name=version_name,
        model_file_url=uploaded_model["secure_url"],
        cloudinary_model_id=uploaded_model["public_id"],
        participants_enrolled=int(enrolled),
        total_vectors=int(metrics["total_vectors"]),
        classes=int(metrics["classes"]),
        baseline_accuracy=metrics.get("baseline_accuracy"),
        modified_accuracy=metrics.get("modified_accuracy"),
        best_c_param=metrics.get("best_c_param"),
        is_active=True,
        created_at=artifact.created_at,
    )


# ---------------------------------------------------------------------------
# 3b. Sinkronisasi model .pkl hasil training eksternal (Colab)
# ---------------------------------------------------------------------------
@app.post("/api/model/sync", response_model=RetrainResponse, tags=["Model"])
def sync_model_artifact(
    model_file: UploadFile = File(..., description="File .pkl hasil training (mis. dari Colab)"),
    version_name: Optional[str] = Form(None, description="Nama versi (opsional)"),
    baseline_accuracy: Optional[float] = Form(None, description="Akurasi baseline 0-100 (opsional)"),
    modified_accuracy: Optional[float] = Form(None, description="Akurasi model final 0-100 (opsional)"),
    best_c_param: Optional[float] = Form(None, description="Nilai C terbaik (opsional)"),
    db: Session = Depends(get_db),
) -> RetrainResponse:
    """Mengunggah model yang sudah dilatih di luar backend (Colab) tanpa training ulang.

    Model harus berisi objek SVC dengan `predict_proba` dan vektor 8.740 dimensi
    (format bundle yang sama dengan hasil `/api/model/retrain`).
    """
    filename = (model_file.filename or "").strip()
    if not filename.lower().endswith(".pkl"):
        raise HTTPException(status_code=400, detail="model_file harus berformat .pkl.")

    try:
        data = model_file.file.read()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Gagal membaca file model.") from exc
    finally:
        try:
            model_file.file.close()
        except Exception:
            pass

    if not data:
        raise HTTPException(status_code=400, detail="File model kosong.")
    if len(data) > MAX_MODEL_BYTES:
        raise HTTPException(status_code=413, detail="Ukuran file model melebihi batas 200 MB.")

    try:
        bundle = pcvk_engine.load_model_bytes(data)
    except PCVKError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    dimension = int(bundle.get("feature_dimension") or FEATURE_DIMENSION)
    if dimension != FEATURE_DIMENSION:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Dimensi fitur model ({dimension}) tidak sesuai skema "
                f"({FEATURE_DIMENSION})."
            ),
        )

    model = bundle.get("model")
    if model is None or not hasattr(model, "predict_proba"):
        raise HTTPException(
            status_code=400,
            detail="Model .pkl harus berisi classifier SVM dengan predict_proba.",
        )

    classes = [int(c) for c in getattr(model, "classes_", [])]
    if not classes:
        raise HTTPException(status_code=400, detail="Model tidak memiliki kelas peserta.")

    for label, value in (
        ("baseline_accuracy", baseline_accuracy),
        ("modified_accuracy", modified_accuracy),
    ):
        if value is not None and not 0.0 <= value <= 100.0:
            raise HTTPException(status_code=400, detail=f"{label} harus berada di 0-100.")
    if best_c_param is not None and not 0.0 <= best_c_param <= 9999.99:
        raise HTTPException(status_code=400, detail="best_c_param harus berada di 0-9999.99.")

    version = (version_name or bundle.get("version") or "").strip()
    if not version:
        version = f"svm_pcvk_{datetime.now(timezone.utc):%Y%m%d_%H%M%S}"
    if db.query(ModelArtifact).filter(ModelArtifact.version_name == version).first():
        version = f"{version}_{datetime.now(timezone.utc):%Y%m%d_%H%M%S}"
    bundle["version"] = version

    temp_path: Optional[str] = None
    try:
        file_descriptor, temp_path = tempfile.mkstemp(prefix=f"{version}_", suffix=".pkl")
        os.close(file_descriptor)
        with open(temp_path, "wb") as temp_file:
            temp_file.write(data)

        try:
            uploaded_model = cloudinary_service.upload_model_file(temp_path, version)
        except CloudinaryNotConfiguredError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except CloudinaryError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                logger.warning("Gagal menghapus file model sementara: %s", temp_path)

    try:
        db.query(ModelArtifact).filter(ModelArtifact.is_active.is_(True)).update(
            {ModelArtifact.is_active: False},
            synchronize_session=False,
        )
        artifact = ModelArtifact(
            version_name=version,
            model_file_url=uploaded_model["secure_url"],
            cloudinary_model_id=uploaded_model["public_id"],
            baseline_accuracy=baseline_accuracy,
            modified_accuracy=modified_accuracy,
            best_c_param=best_c_param,
            is_active=True,
        )
        db.add(artifact)
        db.flush()

        enrolled = (
            db.query(Participant)
            .filter(Participant.id.in_(classes))
            .update({Participant.is_enrolled: True}, synchronize_session=False)
        )

        db.commit()
        db.refresh(artifact)
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Gagal menyimpan model hasil sinkronisasi")
        raise HTTPException(
            status_code=500,
            detail="Model berhasil diunggah tetapi gagal disimpan ke database.",
        ) from exc

    pcvk_engine.set_model_bundle(bundle)

    return RetrainResponse(
        message=(
            "Model .pkl eksternal berhasil disinkronkan ke Cloudinary, "
            "dicatat di model_artifacts, dan langsung diaktifkan."
        ),
        version_name=version,
        model_file_url=uploaded_model["secure_url"],
        cloudinary_model_id=uploaded_model["public_id"],
        participants_enrolled=int(enrolled),
        total_vectors=int(bundle.get("samples") or 0),
        classes=len(classes),
        baseline_accuracy=baseline_accuracy,
        modified_accuracy=modified_accuracy,
        best_c_param=best_c_param,
        is_active=True,
        created_at=artifact.created_at,
    )


# ---------------------------------------------------------------------------
# 4a. Daftar peserta
# ---------------------------------------------------------------------------
@app.get(
    "/api/participants",
    response_model=List[ParticipantOut],
    tags=["Peserta"],
)
def list_participants(
    skip: int = Query(0, ge=0, description="Offset pagination"),
    limit: int = Query(100, ge=1, le=500, description="Jumlah data (maks 500)"),
    search: Optional[str] = Query(None, description="Cari berdasarkan BIB, nama, atau email"),
    db: Session = Depends(get_db),
) -> List[ParticipantOut]:
    query = db.query(Participant)

    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Participant.bib_number.ilike(term),
                Participant.full_name.ilike(term),
                Participant.email.ilike(term),
            )
        )

    participants = (
        query.order_by(Participant.created_at.desc(), Participant.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    if not participants:
        return []

    participant_ids = [p.id for p in participants]

    vector_counts: Dict[int, int] = dict(
        db.query(FaceVector.participant_id, func.count(FaceVector.id))
        .filter(FaceVector.participant_id.in_(participant_ids))
        .group_by(FaceVector.participant_id)
        .all()
    )
    centroid_ids = {
        int(pid)
        for (pid,) in db.query(FaceVector.participant_id)
        .filter(
            FaceVector.participant_id.in_(participant_ids),
            FaceVector.is_centroid.is_(True),
        )
        .distinct()
        .all()
    }

    return [
        _participant_out(
            participant,
            vector_count=int(vector_counts.get(participant.id, 0)),
            has_centroid=participant.id in centroid_ids,
        )
        for participant in participants
    ]


# ---------------------------------------------------------------------------
# 4b. Riwayat presensi
# ---------------------------------------------------------------------------
@app.get(
    "/api/attendance-logs",
    response_model=List[AttendanceLogOut],
    tags=["Presensi"],
)
def list_attendance_logs(
    skip: int = Query(0, ge=0, description="Offset pagination"),
    limit: int = Query(100, ge=1, le=500, description="Jumlah data (maks 500)"),
    status: Optional[str] = Query(None, description="Filter: VERIFIED atau REJECTED"),
    participant_id: Optional[int] = Query(None, description="Filter berdasarkan peserta"),
    db: Session = Depends(get_db),
) -> List[AttendanceLogOut]:
    status_filter = _normalize_status_filter(status)

    query = db.query(AttendanceLog).options(joinedload(AttendanceLog.participant))
    if status_filter:
        query = query.filter(AttendanceLog.status == status_filter)
    if participant_id is not None:
        query = query.filter(AttendanceLog.participant_id == participant_id)

    logs = (
        query.order_by(AttendanceLog.checked_in_at.desc(), AttendanceLog.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )

    return [
        AttendanceLogOut(
            id=log.id,
            participant_id=log.participant_id,
            participant_bib_number=log.participant.bib_number if log.participant else log.input_bib_number,
            participant_name=log.participant.full_name if log.participant else None,
            input_bib_number=log.input_bib_number,
            checkin_photo_url=log.checkin_photo_url,
            cloudinary_checkin_id=log.cloudinary_checkin_id,
            verification_mode=log.verification_mode,
            similarity_score=float(log.similarity_score) if log.similarity_score is not None else 0.0,
            euclidean_distance=float(log.euclidean_distance) if log.euclidean_distance is not None else 0.0,
            processing_time_ms=(
                float(log.processing_time_ms) if log.processing_time_ms is not None else None
            ),
            status=log.status,
            checked_in_at=log.checked_in_at,
        )
        for log in logs
    ]


# ---------------------------------------------------------------------------
# Status model SVM
# ---------------------------------------------------------------------------
@app.get("/api/model/status", response_model=ModelStatusResponse, tags=["Model"])
def model_status(db: Session = Depends(get_db)) -> ModelStatusResponse:
    artifact = (
        db.query(ModelArtifact)
        .filter(ModelArtifact.is_active.is_(True))
        .order_by(ModelArtifact.created_at.desc(), ModelArtifact.id.desc())
        .first()
    )
    model_info = pcvk_engine.describe_model()

    return ModelStatusResponse(
        is_ready=pcvk_engine.is_model_ready,
        message=(
            "Model SVM siap digunakan."
            if pcvk_engine.is_model_ready
            else "Model SVM belum dimuat. Sinkronkan .pkl dari Colab lewat "
            "POST /api/model/sync (atau POST /api/model/retrain)."
        ),
        feature_dimension=FEATURE_DIMENSION,
        feature_method=FEATURE_METHOD,
        probability_threshold=settings.SVM_PROBABILITY_THRESHOLD,
        max_euclidean_distance=settings.MAX_EUCLIDEAN_DISTANCE,
        model=model_info,
        active_artifact=(
            {
                "id": artifact.id,
                "version_name": artifact.version_name,
                "model_file_url": artifact.model_file_url,
                "cloudinary_model_id": artifact.cloudinary_model_id,
                "baseline_accuracy": (
                    float(artifact.baseline_accuracy)
                    if artifact.baseline_accuracy is not None
                    else None
                ),
                "modified_accuracy": (
                    float(artifact.modified_accuracy)
                    if artifact.modified_accuracy is not None
                    else None
                ),
                "best_c_param": (
                    float(artifact.best_c_param) if artifact.best_c_param is not None else None
                ),
                "is_active": bool(artifact.is_active),
                "created_at": artifact.created_at,
            }
            if artifact is not None
            else None
        ),
    )


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
