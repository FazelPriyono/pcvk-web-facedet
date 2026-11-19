"""Skema Pydantic untuk request/response API PCVK."""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Peserta
# ---------------------------------------------------------------------------
class ParticipantOut(BaseModel):
    id: int
    bib_number: str
    full_name: str
    email: str
    phone_number: Optional[str] = None
    race_category: str
    registration_photo_url: str
    cloudinary_public_id: str
    is_enrolled: bool
    created_at: Optional[datetime] = None
    face_vector_count: int = 0
    has_centroid: bool = False


class ParticipantSummary(BaseModel):
    id: int
    bib_number: str
    full_name: str
    race_category: Optional[str] = None
    photo_url: Optional[str] = None


class RegisterResponse(BaseModel):
    message: str
    participant: ParticipantOut
    vector_dimension: int
    feature_method: str


# ---------------------------------------------------------------------------
# Verifikasi / presensi
# ---------------------------------------------------------------------------
class VerifyResponse(BaseModel):
    status: str = Field(description="VERIFIED atau REJECTED")
    message: str
    verification_mode: str
    input_bib_number: Optional[str] = None
    participant: Optional[ParticipantSummary] = None
    participant_photo_url: Optional[str] = None
    svm_probability: float
    similarity_score: float = Field(description="Probabilitas SVM dalam persen (0.00-100.00)")
    euclidean_distance: float
    processing_time_ms: float
    threshold_probability: float
    threshold_distance: float
    checkin_photo_url: Optional[str] = None
    cloudinary_checkin_id: Optional[str] = None
    attendance_log_id: Optional[int] = None
    checked_in_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Log presensi
# ---------------------------------------------------------------------------
class AttendanceLogOut(BaseModel):
    id: int
    participant_id: Optional[int] = None
    participant_bib_number: Optional[str] = None
    participant_name: Optional[str] = None
    participant_race_category: Optional[str] = None
    participant_photo_url: Optional[str] = None
    input_bib_number: Optional[str] = None
    checkin_photo_url: Optional[str] = None
    cloudinary_checkin_id: Optional[str] = None
    verification_mode: str
    similarity_score: float
    euclidean_distance: float
    processing_time_ms: Optional[float] = None
    status: str
    checked_in_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Model SVM
# ---------------------------------------------------------------------------
class RetrainResponse(BaseModel):
    message: str
    version_name: str
    model_file_url: str
    cloudinary_model_id: str
    participants_enrolled: int
    total_vectors: int
    classes: int
    baseline_accuracy: Optional[float] = None
    modified_accuracy: Optional[float] = None
    best_c_param: Optional[float] = None
    is_active: bool
    created_at: Optional[datetime] = None


class ModelStatusResponse(BaseModel):
    is_ready: bool
    message: str
    feature_dimension: int
    feature_method: str
    probability_threshold: float
    max_euclidean_distance: float
    model: Optional[dict] = None
    active_artifact: Optional[dict] = None


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
class HealthResponse(BaseModel):
    status: str
    database: str
    cloudinary: str
    svm_model: str
    timestamp: datetime


class MessageResponse(BaseModel):
    message: str
    detail: Optional[List[str]] = None
