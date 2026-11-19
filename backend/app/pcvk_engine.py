"""Mesin computer vision PCVK.

Pipeline:
    1. Decode gambar + deteksi wajah (Haar Cascade).
    2. Face alignment berbasis posisi dua mata (rotasi).
    3. Resize ke 96x96 + CLAHE (Contrast Limited Adaptive Histogram Equalization).
    4. Ekstraksi fitur HOG (8.100 dimensi) + LBPH (640 dimensi) = 8.740 dimensi.
    5. L2-normalisasi vektor agar Euclidean Distance berada pada skala 0..2.
    6. Klasifikasi probabilitas dengan SVM (scikit-learn SVC, probability=True).

Komposisi dimensi (harus konsisten dengan skema database 8.740):
    HOG  : 96x96, pixels_per_cell=(8,8) -> 12x12 sel,
           cells_per_block=(3,3) -> 10x10 blok,
           10 * 10 * (3*3) * 9 orientasi = 8.100 fitur.
    LBPH : grid 8x8 sel, 10 bin (uniform P=8) = 640 fitur.
"""

from __future__ import annotations

import io
import logging
import threading
import warnings
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import cv2
import joblib
import numpy as np
from skimage.feature import hog, local_binary_pattern
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.svm import SVC

from .config import settings

logger = logging.getLogger(__name__)

# scikit-learn 1.9 menandai `probability=True` sebagai deprecated (dihapus di 1.11).
# Proyek ini sengaja memakai parameter tersebut (sesuai spesifikasi) dan
# requirements membatasi scikit-learn < 1.11, jadi warning-nya tidak perlu spam log.
warnings.filterwarnings(
    "ignore",
    message=r"The `probability` parameter was deprecated.*",
    category=FutureWarning,
)

# ---------------------------------------------------------------------------
# Konstanta pipeline
# ---------------------------------------------------------------------------
FEATURE_DIMENSION = 8740
FEATURE_METHOD = "HOG+LBPH"

FACE_SIZE: Tuple[int, int] = (96, 96)
FACE_MARGIN_RATIO = 0.12

HOG_ORIENTATIONS = 9
HOG_PIXELS_PER_CELL = (8, 8)
HOG_CELLS_PER_BLOCK = (3, 3)

LBP_POINTS = 8
LBP_RADIUS = 1
LBP_GRID = (8, 8)  # (baris, kolom)
LBP_BINS = LBP_POINTS + 2  # metode "uniform" skimage: 10 nilai (0..9)

SVM_C_CANDIDATES: Tuple[float, ...] = (0.1, 1.0, 10.0, 100.0)
SVM_MIN_SAMPLES_PER_CLASS = 5  # syarat kalibrasi probabilitas internal SVC


class PCVKError(Exception):
    """Base exception untuk pipeline PCVK."""


class InvalidImageError(PCVKError):
    """File yang diunggah bukan gambar yang bisa dibaca."""


class FaceNotDetectedError(PCVKError):
    """Wajah tidak terdeteksi pada gambar."""


class ModelNotTrainedError(PCVKError):
    """Model SVM belum tersedia / belum dilatih."""


class PCVKEngine:
    """Pipeline preprocessing, ekstraksi fitur, dan klasifikasi SVM."""

    def __init__(
        self,
        probability_threshold: float = 0.45,
        max_euclidean_distance: float = 0.65,
    ) -> None:
        self.probability_threshold = float(probability_threshold)
        self.max_euclidean_distance = float(max_euclidean_distance)

        self._lock = threading.RLock()
        self._bundle: Optional[Dict[str, Any]] = None

        self._face_cascade: Optional[cv2.CascadeClassifier] = None
        self._eye_cascade: Optional[cv2.CascadeClassifier] = None
        self._clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        self._load_cascades()

    # ------------------------------------------------------------------
    # Inisialisasi resource OpenCV
    # ------------------------------------------------------------------
    def _load_cascades(self) -> None:
        try:
            face_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
            eye_path = cv2.data.haarcascades + "haarcascade_eye.xml"
            self._face_cascade = cv2.CascadeClassifier(face_path)
            self._eye_cascade = cv2.CascadeClassifier(eye_path)

            if self._face_cascade.empty():
                logger.error("Gagal memuat Haar Cascade wajah: %s", face_path)
                self._face_cascade = None
            if self._eye_cascade.empty():
                logger.warning("Gagal memuat Haar Cascade mata: %s", eye_path)
                self._eye_cascade = None
        except Exception:  # pragma: no cover - bergantung instalasi OpenCV
            logger.exception("Gagal menginisialisasi Haar Cascade")
            self._face_cascade = None
            self._eye_cascade = None

    # ------------------------------------------------------------------
    # Preprocessing
    # ------------------------------------------------------------------
    @staticmethod
    def _decode_image(image_bytes: bytes) -> np.ndarray:
        if not image_bytes:
            raise InvalidImageError("File gambar kosong.")

        buffer = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
        if image is None:
            raise InvalidImageError(
                "Gambar tidak dapat dibaca. Gunakan format JPG, PNG, atau WEBP."
            )
        if image.shape[0] < 60 or image.shape[1] < 60:
            raise InvalidImageError("Resolusi gambar terlalu kecil (minimal 60x60 piksel).")
        return image

    def _detect_face(self, gray: np.ndarray) -> Tuple[int, int, int, int]:
        cascade = self._face_cascade
        if cascade is None:
            raise FaceNotDetectedError("Detektor wajah tidak tersedia di server.")

        faces = cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(60, 60),
        )
        if faces is None or len(faces) == 0:
            raise FaceNotDetectedError(
                "Wajah tidak terdeteksi. Pastikan pencahayaan cukup dan wajah menghadap kamera."
            )

        # Ambil wajah terbesar (asumsi objek utama).
        return tuple(int(v) for v in max(faces, key=lambda rect: int(rect[2]) * int(rect[3])))

    def _align_face(self, face_gray: np.ndarray) -> np.ndarray:
        """Rotasi wajah agar garis mata horizontal (fallback: tanpa rotasi)."""
        if self._eye_cascade is None:
            return face_gray

        try:
            eyes = self._eye_cascade.detectMultiScale(face_gray, scaleFactor=1.1, minNeighbors=5)
            if eyes is None or len(eyes) < 2:
                return face_gray

            eyes = sorted(eyes, key=lambda e: (int(e[0]), int(e[1])))[:2]
            (x1, y1, w1, h1), (x2, y2, w2, h2) = eyes
            c1 = (float(x1) + w1 / 2.0, float(y1) + h1 / 2.0)
            c2 = (float(x2) + w2 / 2.0, float(y2) + h2 / 2.0)

            dx = c2[0] - c1[0]
            dy = c2[1] - c1[1]
            if dx == 0:
                return face_gray

            angle = float(np.degrees(np.arctan2(dy, dx)))
            if abs(angle) > 35.0:
                return face_gray  # terlalu miring, kemungkinan false positive

            center = ((c1[0] + c2[0]) / 2.0, (c1[1] + c2[1]) / 2.0)
            matrix = cv2.getRotationMatrix2D(center, angle, scale=1.0)
            h, w = face_gray.shape[:2]
            return cv2.warpAffine(
                face_gray,
                matrix,
                (w, h),
                flags=cv2.INTER_LINEAR,
                borderMode=cv2.BORDER_REPLICATE,
            )
        except Exception:  # pragma: no cover - alignment bersifat opsional
            logger.debug("Face alignment dilewati karena error", exc_info=True)
            return face_gray

    def preprocess(self, image_bytes: bytes) -> np.ndarray:
        """Decode + deteksi + alignment + resize + CLAHE."""
        image = self._decode_image(image_bytes)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        x, y, w, h = self._detect_face(gray)

        # Crop dengan margin agar area wajah tidak terpotong.
        margin_x = int(w * FACE_MARGIN_RATIO)
        margin_y = int(h * FACE_MARGIN_RATIO)
        x0 = max(0, x - margin_x)
        y0 = max(0, y - margin_y)
        x1 = min(gray.shape[1], x + w + margin_x)
        y1 = min(gray.shape[0], y + h + margin_y)

        face = gray[y0:y1, x0:x1]
        if face.size == 0:
            raise FaceNotDetectedError("Area wajah tidak valid.")

        face = self._align_face(face)
        face = cv2.resize(face, FACE_SIZE, interpolation=cv2.INTER_AREA)
        return self._clahe.apply(face)

    # ------------------------------------------------------------------
    # Ekstraksi fitur
    # ------------------------------------------------------------------
    @staticmethod
    def _hog_features(face_gray: np.ndarray) -> np.ndarray:
        features = hog(
            face_gray,
            orientations=HOG_ORIENTATIONS,
            pixels_per_cell=HOG_PIXELS_PER_CELL,
            cells_per_block=HOG_CELLS_PER_BLOCK,
            block_norm="L2-Hys",
            feature_vector=True,
        )
        return np.asarray(features, dtype=np.float64)

    @staticmethod
    def _lbph_features(face_gray: np.ndarray) -> np.ndarray:
        lbp = local_binary_pattern(
            face_gray,
            P=LBP_POINTS,
            R=LBP_RADIUS,
            method="uniform",
        )

        rows, cols = LBP_GRID
        height, width = face_gray.shape[:2]
        cell_h = height // rows
        cell_w = width // cols

        histograms = np.zeros((rows * cols, LBP_BINS), dtype=np.float64)
        for r in range(rows):
            for c in range(cols):
                cell = lbp[r * cell_h : (r + 1) * cell_h, c * cell_w : (c + 1) * cell_w]
                hist, _ = np.histogram(cell, bins=LBP_BINS, range=(0, LBP_BINS))
                histograms[r * cols + c] = hist

        # Normalisasi per sel agar tidak bias terhadap area dengan kontras tinggi.
        histograms /= histograms.sum(axis=1, keepdims=True) + 1e-6
        return histograms.ravel()

    def extract_feature_vector(self, image_bytes: bytes) -> np.ndarray:
        """Menghasilkan vektor float32 berukuran tepat 8.740 dimensi."""
        face = self.preprocess(image_bytes)
        features = np.concatenate(
            [self._hog_features(face), self._lbph_features(face)]
        ).astype(np.float64)

        if features.size != FEATURE_DIMENSION:  # pragma: no cover - pengaman versi library
            features = self._fit_dimension(features)

        # L2-normalisasi: Euclidean Distance menjadi 0..2 sehingga threshold
        # MAX_EUCLIDEAN_DISTANCE (default 0.65) bermakna.
        norm = float(np.linalg.norm(features))
        if norm > 0:
            features = features / norm

        return features.astype(np.float32)

    @staticmethod
    def _fit_dimension(features: np.ndarray) -> np.ndarray:
        """Paksa vektor tepat 8.740 dimensi (pad/truncate) demi kompatibilitas DB."""
        if features.size > FEATURE_DIMENSION:
            return features[:FEATURE_DIMENSION]
        if features.size < FEATURE_DIMENSION:
            return np.pad(features, (0, FEATURE_DIMENSION - features.size), mode="constant")
        return features

    # ------------------------------------------------------------------
    # Euclidean distance & keputusan
    # ------------------------------------------------------------------
    @staticmethod
    def euclidean_distance(vector_a: Sequence[float], vector_b: Sequence[float]) -> float:
        arr_a = np.asarray(vector_a, dtype=np.float64)
        arr_b = np.asarray(vector_b, dtype=np.float64)
        if arr_a.size != arr_b.size:
            raise PCVKError(
                f"Dimensi vektor tidak sama: {arr_a.size} vs {arr_b.size}."
            )
        return float(np.linalg.norm(arr_a - arr_b))

    def evaluate_match(self, svm_probability: float, distance: float) -> Tuple[str, List[str]]:
        """Menentukan status VERIFIED/REJECTED beserta alasan penolakan."""
        reasons: List[str] = []
        if svm_probability < self.probability_threshold:
            reasons.append(
                f"probabilitas SVM {svm_probability:.4f} < threshold {self.probability_threshold:.4f}"
            )
        if distance > self.max_euclidean_distance:
            reasons.append(
                f"jarak Euclidean {distance:.4f} > batas {self.max_euclidean_distance:.4f}"
            )
        return ("REJECTED" if reasons else "VERIFIED"), reasons

    # ------------------------------------------------------------------
    # Training SVM
    # ------------------------------------------------------------------
    @staticmethod
    def _cv_accuracy(X: np.ndarray, y: np.ndarray, c_param: float, splits: int) -> Optional[float]:
        if splits < 2:
            return None
        try:
            classifier = SVC(C=c_param, kernel="rbf", gamma="scale", probability=False)
            cv = StratifiedKFold(n_splits=splits, shuffle=True, random_state=42)
            scores = cross_val_score(classifier, X, y, cv=cv, scoring="accuracy")
            return float(np.mean(scores) * 100.0)
        except Exception:
            logger.warning("Cross-validation gagal untuk C=%s", c_param, exc_info=True)
            return None

    @staticmethod
    def _balance_samples(
        X: np.ndarray,
        y: np.ndarray,
        min_samples: int = SVM_MIN_SAMPLES_PER_CLASS,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Duplikasi + jitter kecil agar kalibrasi probabilitas SVC memenuhi syarat."""
        rng = np.random.default_rng(42)
        extra_X: List[np.ndarray] = []
        extra_y: List[np.ndarray] = []

        for label in np.unique(y):
            indices = np.where(y == label)[0]
            missing = min_samples - indices.size
            if missing <= 0:
                continue
            picks = rng.choice(indices, size=missing, replace=True)
            noise = rng.normal(0.0, 1e-5, size=(missing, X.shape[1]))
            extra_X.append(X[picks] + noise)
            extra_y.append(np.full(missing, label))

        if not extra_X:
            return X, y
        return np.vstack([X, *extra_X]), np.concatenate([y, *extra_y])

    def train(
        self,
        vectors: Sequence[Sequence[float]],
        labels: Sequence[int],
        version: Optional[str] = None,
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """Melatih ulang SVM dan mengembalikan (bundle model, metrik)."""
        if len(vectors) != len(labels):
            raise PCVKError("Jumlah vektor dan label tidak sama.")
        if len(vectors) == 0:
            raise PCVKError("Tidak ada vektor fitur untuk dilatih.")

        X = np.asarray(vectors, dtype=np.float64)
        y = np.asarray(labels, dtype=np.int64)

        if X.ndim != 2:
            raise PCVKError("Data vektor harus berupa matriks 2 dimensi.")
        if X.shape[1] != FEATURE_DIMENSION:
            raise PCVKError(
                f"Dimensi fitur {X.shape[1]} tidak sesuai. Diharapkan {FEATURE_DIMENSION}."
            )

        classes, counts = np.unique(y, return_counts=True)
        if classes.size < 2:
            raise PCVKError(
                "Minimal dibutuhkan 2 peserta dengan vektor wajah untuk melatih SVM."
            )

        splits = int(min(5, counts.min()))
        if splits < 2:
            splits = 0

        baseline_accuracy = self._cv_accuracy(X, y, c_param=1.0, splits=splits)

        best_c = 1.0
        best_accuracy: Optional[float] = None
        for c_param in SVM_C_CANDIDATES:
            accuracy = self._cv_accuracy(X, y, c_param=c_param, splits=splits)
            if accuracy is None:
                continue
            if best_accuracy is None or accuracy > best_accuracy:
                best_accuracy, best_c = accuracy, c_param

        X_fit, y_fit = self._balance_samples(X, y)

        classifier = SVC(
            C=best_c,
            kernel="rbf",
            gamma="scale",
            probability=True,
            class_weight="balanced",
            random_state=42,
        )
        classifier.fit(X_fit, y_fit)

        if best_accuracy is None:
            # Fallback bila CV tidak memungkinkan (dataset terlalu kecil).
            train_predictions = classifier.predict(X)
            best_accuracy = float(np.mean(train_predictions == y) * 100.0)
            baseline_accuracy = best_accuracy
            best_c = 1.0

        version_name = version or f"svm_pcvk_{datetime.now(timezone.utc):%Y%m%d_%H%M%S}"

        bundle: Dict[str, Any] = {
            "version": version_name,
            "feature_dimension": int(X.shape[1]),
            "feature_method": FEATURE_METHOD,
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "samples": int(X.shape[0]),
            "classes": [int(c) for c in classifier.classes_],
            "model": classifier,
        }
        metrics: Dict[str, Any] = {
            "version": version_name,
            "total_vectors": int(X.shape[0]),
            "classes": int(classes.size),
            "baseline_accuracy": (
                round(float(baseline_accuracy), 2) if baseline_accuracy is not None else None
            ),
            "modified_accuracy": round(float(best_accuracy), 2),
            "best_c_param": round(float(best_c), 2),
        }
        return bundle, metrics

    # ------------------------------------------------------------------
    # Manajemen model (in-memory)
    # ------------------------------------------------------------------
    @property
    def is_model_ready(self) -> bool:
        with self._lock:
            return self._bundle is not None

    def set_model_bundle(self, bundle: Dict[str, Any]) -> None:
        model = bundle.get("model") if isinstance(bundle, dict) else None
        if model is None or not hasattr(model, "predict_proba"):
            raise PCVKError("File model tidak valid: objek SVC tidak ditemukan.")

        classes = list(getattr(model, "classes_", []))
        if not classes:
            raise PCVKError("Model SVM tidak memiliki kelas peserta.")

        with self._lock:
            self._bundle = bundle
        logger.info(
            "Model SVM dimuat: version=%s classes=%s",
            bundle.get("version", "unknown"),
            classes,
        )

    def clear_model(self) -> None:
        with self._lock:
            self._bundle = None

    def describe_model(self) -> Optional[Dict[str, Any]]:
        with self._lock:
            if self._bundle is None:
                return None
            model = self._bundle.get("model")
            return {
                "version": self._bundle.get("version"),
                "feature_dimension": self._bundle.get("feature_dimension", FEATURE_DIMENSION),
                "feature_method": self._bundle.get("feature_method", FEATURE_METHOD),
                "trained_at": self._bundle.get("trained_at"),
                "samples": self._bundle.get("samples"),
                "classes": [int(c) for c in getattr(model, "classes_", [])],
            }

    @staticmethod
    def dump_model_bundle(bundle: Dict[str, Any], destination: str) -> str:
        joblib.dump(bundle, destination, compress=3)
        return destination

    @staticmethod
    def load_model_bytes(data: bytes) -> Dict[str, Any]:
        if not data:
            raise PCVKError("File model kosong.")
        try:
            loaded = joblib.load(io.BytesIO(data))
        except Exception as exc:
            raise PCVKError(f"Gagal membaca file model .pkl: {exc}") from exc

        # Dukungan kompatibilitas jika file berisi objek SVC langsung.
        if isinstance(loaded, SVC):
            return {
                "version": "legacy",
                "feature_dimension": FEATURE_DIMENSION,
                "feature_method": FEATURE_METHOD,
                "trained_at": None,
                "samples": None,
                "classes": [int(c) for c in loaded.classes_],
                "model": loaded,
            }

        if not isinstance(loaded, dict) or "model" not in loaded:
            raise PCVKError("Struktur file model tidak dikenali.")
        return loaded

    # ------------------------------------------------------------------
    # Prediksi
    # ------------------------------------------------------------------
    def _get_model(self) -> SVC:
        with self._lock:
            bundle = self._bundle
        if bundle is None:
            raise ModelNotTrainedError(
                "Model SVM belum tersedia. Sinkronkan .pkl dari Colab lewat "
                "POST /api/model/sync atau jalankan POST /api/model/retrain."
            )
        return bundle["model"]

    def predict_all(self, vector: Sequence[float]) -> Dict[int, float]:
        """Probabilitas SVM untuk setiap kelas peserta (id -> probabilitas)."""
        model = self._get_model()
        sample = np.asarray(vector, dtype=np.float64).reshape(1, -1)
        if sample.shape[1] != FEATURE_DIMENSION:
            raise PCVKError(
                f"Dimensi vektor {sample.shape[1]} tidak sesuai ({FEATURE_DIMENSION})."
            )

        probabilities = model.predict_proba(sample)[0]
        return {
            int(label): float(probability)
            for label, probability in zip(model.classes_, probabilities)
        }

    def predict_best(self, vector: Sequence[float]) -> Tuple[int, float]:
        probabilities = self.predict_all(vector)
        if not probabilities:
            raise ModelNotTrainedError("Model SVM tidak memiliki kelas peserta.")
        participant_id, probability = max(probabilities.items(), key=lambda item: item[1])
        return participant_id, probability

    def predict_probability_for(self, vector: Sequence[float], participant_id: int) -> float:
        probabilities = self.predict_all(vector)
        return float(probabilities.get(int(participant_id), 0.0))


# Singleton yang dipakai oleh endpoint FastAPI.
engine = PCVKEngine(
    probability_threshold=settings.SVM_PROBABILITY_THRESHOLD,
    max_euclidean_distance=settings.MAX_EUCLIDEAN_DISTANCE,
)
