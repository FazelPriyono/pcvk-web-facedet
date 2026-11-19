"""Model SQLAlchemy untuk Sistem Presensi Event Lari PCVK (Kelompok 5).

Empat tabel utama:
    - participants
    - face_vectors
    - attendance_logs
    - model_artifacts
"""

from __future__ import annotations

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import relationship

from .database import Base

# Dimensi vektor fitur wajah: HOG (8.100) + LBPH (640).
FEATURE_DIMENSION = 8740
FEATURE_METHOD = "HOG+LBPH"


class Participant(Base):
    __tablename__ = "participants"

    id = Column(Integer, primary_key=True, autoincrement=True)
    bib_number = Column(String(50), unique=True, nullable=False, index=True)
    full_name = Column(String(150), nullable=False)
    email = Column(String(150), unique=True, nullable=False, index=True)
    phone_number = Column(String(30), nullable=True)
    race_category = Column(String(20), nullable=False, default="5K", server_default=text("'5K'"))
    registration_photo_url = Column(Text, nullable=False)
    cloudinary_public_id = Column(String(255), nullable=False)
    is_enrolled = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    face_vectors = relationship(
        "FaceVector",
        back_populates="participant",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    attendance_logs = relationship(
        "AttendanceLog",
        back_populates="participant",
        passive_deletes=True,
    )

    def __repr__(self) -> str:  # pragma: no cover - bantuan debugging
        return (
            f"<Participant id={self.id} bib={self.bib_number!r} "
            f"name={self.full_name!r} enrolled={self.is_enrolled}>"
        )


class FaceVector(Base):
    __tablename__ = "face_vectors"

    id = Column(Integer, primary_key=True, autoincrement=True)
    participant_id = Column(
        Integer,
        ForeignKey("participants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Vektor fitur 8.740 dimensi (HOG + LBPH).
    feature_vector = Column(ARRAY(Float), nullable=False)
    vector_dimension = Column(Integer, nullable=False, default=FEATURE_DIMENSION, server_default=text("8740"))
    feature_method = Column(
        String(50),
        nullable=False,
        default=FEATURE_METHOD,
        server_default=text("'HOG+LBPH'"),
    )
    is_centroid = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    participant = relationship("Participant", back_populates="face_vectors")

    def __repr__(self) -> str:  # pragma: no cover - bantuan debugging
        return (
            f"<FaceVector id={self.id} participant_id={self.participant_id} "
            f"dim={self.vector_dimension} centroid={self.is_centroid}>"
        )


class AttendanceLog(Base):
    __tablename__ = "attendance_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    participant_id = Column(
        Integer,
        ForeignKey("participants.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    input_bib_number = Column(String(50), nullable=True)
    checkin_photo_url = Column(Text, nullable=True)
    cloudinary_checkin_id = Column(String(255), nullable=True)
    verification_mode = Column(
        String(10),
        nullable=False,
        default="1:1",
        server_default=text("'1:1'"),
    )
    # Skala persen 0.00 - 100.00
    similarity_score = Column(Numeric(5, 2), nullable=False)
    euclidean_distance = Column(Numeric(6, 4), nullable=False)
    processing_time_ms = Column(Numeric(8, 2), nullable=True)
    status = Column(String(20), nullable=False, index=True)  # VERIFIED / REJECTED
    checked_in_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )

    participant = relationship("Participant", back_populates="attendance_logs")

    def __repr__(self) -> str:  # pragma: no cover - bantuan debugging
        return (
            f"<AttendanceLog id={self.id} participant_id={self.participant_id} "
            f"status={self.status!r} score={self.similarity_score}>"
        )


class ModelArtifact(Base):
    __tablename__ = "model_artifacts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    version_name = Column(String(100), nullable=False, unique=True)
    model_file_url = Column(Text, nullable=False)
    cloudinary_model_id = Column(String(255), nullable=False)
    baseline_accuracy = Column(Numeric(5, 2), nullable=True)
    modified_accuracy = Column(Numeric(5, 2), nullable=True)
    best_c_param = Column(Numeric(6, 2), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"), index=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    def __repr__(self) -> str:  # pragma: no cover - bantuan debugging
        return (
            f"<ModelArtifact id={self.id} version={self.version_name!r} "
            f"active={self.is_active}>"
        )
