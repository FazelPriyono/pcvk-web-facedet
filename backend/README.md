# PCVK Backend - Sistem Presensi Event Lari (Kelompok 5)

Backend API berbasis **Python FastAPI** untuk registrasi peserta, verifikasi wajah
(1:1 dan 1:N), serta pengelolaan model SVM `HOG + LBPH` 8.740 dimensi.

> Branch: `backend-pcvk` · Database: Neon PostgreSQL · Storage: Cloudinary

---

## 1. Struktur Folder

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py               # Inisialisasi FastAPI, CORS, startup, seluruh endpoint
│   ├── config.py             # Loader .env (python-dotenv) + validasi konfigurasi
│   ├── database.py           # Engine SQLAlchemy Neon, SessionLocal, get_db, init_db
│   ├── models.py             # participants, face_vectors, attendance_logs, model_artifacts
│   ├── schemas.py            # Skema Pydantic request/response
│   ├── cloudinary_service.py # Upload foto registrasi/check-in + model .pkl (raw)
│   └── pcvk_engine.py        # CLAHE + Face Alignment, HOG+LBPH, SVM, Euclidean distance
├── requirements.txt
├── .env.example
└── README.md
```

---

## 2. Persiapan

### 2.1 Prasyarat

- **Python 3.11 / 3.12** (disarankan). Hindari Python 3.14 karena wheel
  `opencv-python`/`scikit-image` belum tentu tersedia.
- Database Neon PostgreSQL yang sudah aktif.
- Akun Cloudinary (cloud name, API key, API secret).

### 2.2 Install dependency

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1        # Windows PowerShell
# source venv/bin/activate         # Linux / macOS
pip install --upgrade pip
pip install -r requirements.txt
```

### 2.3 Konfigurasi `.env`

```powershell
Copy-Item .env.example .env
```

Isi `backend/.env`:

```env
DATABASE_URL=postgresql://user:password@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require

CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
CLOUDINARY_BASE_FOLDER=pcvk-kelompok5

SVM_PROBABILITY_THRESHOLD=0.45
MAX_EUCLIDEAN_DISTANCE=0.65
```

Jika `sslmode=require` belum ada pada `DATABASE_URL`, aplikasi menambahkannya
otomatis untuk host non-localhost.

### 2.4 Menjalankan server

```powershell
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- Swagger UI: <http://localhost:8000/docs>
- ReDoc: <http://localhost:8000/redoc>
- Health check: <http://localhost:8000/health>

Tabel database dibuat otomatis saat startup (`Base.metadata.create_all`), dan
model SVM aktif dimuat dari tabel `model_artifacts` (Cloudinary) bila tersedia.

> **Catatan model:** file `.pkl` dilatih di notebook **Colab terpisah**, bukan
> oleh backend ini. Backend hanya *mengonsumsi* model: memuat versi aktif saat
> startup atau menerima unggahan lewat `POST /api/model/sync`. Tidak ada
> training otomatis saat aplikasi dijalankan.

---

## 3. Skema Database

| Tabel | Kolom penting |
|---|---|
| `participants` | `id`, `bib_number` (unique), `full_name`, `email` (unique), `phone_number`, `race_category` (default `5K`), `registration_photo_url`, `cloudinary_public_id`, `is_enrolled` (default `false`), `created_at` |
| `face_vectors` | `id`, `participant_id` (FK `ON DELETE CASCADE`), `feature_vector` `ARRAY(Float)` 8.740 dim, `vector_dimension` (default `8740`), `feature_method` (default `HOG+LBPH`), `is_centroid` (default `true`), `created_at` |
| `attendance_logs` | `id`, `participant_id` (FK `ON DELETE SET NULL`, nullable), `input_bib_number`, `checkin_photo_url`, `cloudinary_checkin_id`, `verification_mode` (default `1:1`), `similarity_score` `NUMERIC(5,2)` 0-100, `euclidean_distance` `NUMERIC(6,4)`, `processing_time_ms` `NUMERIC(8,2)`, `status` (`VERIFIED`/`REJECTED`), `checked_in_at` |
| `model_artifacts` | `id`, `version_name`, `model_file_url`, `cloudinary_model_id`, `baseline_accuracy`, `modified_accuracy`, `best_c_param`, `is_active` (default `true`), `created_at` |

---

## 4. Pipeline Computer Vision (`app/pcvk_engine.py`)

1. **Decode** gambar (JPG/PNG/WEBP) dan deteksi wajah dengan Haar Cascade.
2. **Face Alignment** — rotasi gambar berdasarkan sudut garis dua mata
   (`haarcascade_eye.xml`); fallback tanpa rotasi bila mata tidak terdeteksi.
3. **Preprocessing** — crop dengan margin 12%, resize `96x96`, lalu **CLAHE**
   (`clipLimit=2.0`, `tileGridSize=(8,8)`).
4. **Ekstraksi fitur 8.740 dimensi**:
   - **HOG** — `orientations=9`, `pixels_per_cell=(8,8)`,
     `cells_per_block=(3,3)`, `block_norm="L2-Hys"`
     → `10 × 10 × (3·3) × 9 = 8.100` fitur.
   - **LBPH** — uniform LBP (`P=8`, `R=1`) dengan grid spasial `8×8` dan
     `10` bin per sel → `8 × 8 × 10 = 640` fitur.
   - Total **8.740** fitur, lalu **L2-normalisasi** agar Euclidean Distance
     berada pada skala `0..2` (threshold `0.65` menjadi bermakna).
5. **SVM** — `SVC(kernel="rbf", probability=True, class_weight="balanced")`.
   Grid search `C ∈ {0.1, 1, 10, 100}` dengan cross-validation; `baseline_accuracy`
   memakai `C=1.0`, `modified_accuracy` memakai `C` terbaik. Jika jumlah sampel
   per kelas < 5, data di-duplikasi + jitter kecil agar kalibrasi probabilitas
   SVC valid (wajib minimal 2 peserta).
6. **Keputusan**: `VERIFIED` hanya jika
   `svm_probability >= SVM_PROBABILITY_THRESHOLD` **dan**
   `euclidean_distance <= MAX_EUCLIDEAN_DISTANCE`.

---

## 5. Endpoint API

### `POST /api/register` — multipart/form-data

| Field | Tipe | Wajib |
|---|---|---|
| `bib_number` | string | ya |
| `full_name` | string | ya |
| `email` | string | ya |
| `phone_number` | string | tidak |
| `race_category` | string | tidak (default `5K`) |
| `photo` | file gambar | ya |

Alur: cek duplikasi BIB/email → ekstraksi vektor (tolak `400` bila wajah tidak
terdeteksi) → upload Cloudinary (`registrations/`) → simpan `participants` +
`face_vectors` (`is_centroid=True`).

```powershell
curl.exe -X POST http://localhost:8000/api/register `
  -F "bib_number=B001" -F "full_name=Budi Santoso" `
  -F "email=budi@example.com" -F "race_category=5K" `
  -F "photo=@budi.jpg"
```

### `POST /api/verify` — multipart/form-data

| Field | Tipe | Wajib |
|---|---|---|
| `photo` | file gambar | ya |
| `verification_mode` | string (`1:1` / `1:N`) | tidak (default `1:1`) |
| `bib_number` | string | wajib untuk `1:1` |

- **1:1** — ambil centroid peserta berdasarkan BIB, hitung probabilitas SVM
  kelas peserta tersebut + Euclidean distance.
- **1:N** — bandingkan dengan seluruh centroid peserta `is_enrolled=True`,
  ambil probabilitas SVM tertinggi.
- Foto check-in diunggah ke `checkins/`; hasil selalu disimpan ke
  `attendance_logs` (termasuk yang `REJECTED`, untuk audit).
- `similarity_score` = `svm_probability × 100` (skala `0.00 - 100.00`).

### `POST /api/model/sync` — sinkronisasi model `.pkl` dari Colab

Unggah file model yang sudah dilatih di luar backend (multipart/form-data):

| Field | Tipe | Wajib |
|---|---|---|
| `model_file` | file `.pkl` | ya |
| `version_name` | string | tidak |
| `baseline_accuracy` | float 0-100 | tidak |
| `modified_accuracy` | float 0-100 | tidak |
| `best_c_param` | float | tidak |

Alur: validasi bundle (SVC + `predict_proba`, 8.740 dimensi) → upload ke
Cloudinary (`models/`, `resource_type="raw"`) → nonaktifkan versi lama → simpan
`model_artifacts` baru (`is_active=True`) → set `is_enrolled=True` untuk peserta
yang ada di kelas model → aktifkan langsung di memori. Endpoint ini **tidak
melakukan training**.

```powershell
curl.exe -X POST http://localhost:8000/api/model/sync `
  -F "model_file=@svm_pcvk_colab.pkl" -F "version_name=svm_colab_v1" `
  -F "modified_accuracy=96.50" -F "best_c_param=10"
```

### `POST /api/model/retrain` (opsional)

Mengambil seluruh `face_vectors`, melatih ulang SVM, mengunggah `.pkl` ke
Cloudinary (`resource_type="raw"`, folder `models/`), menonaktifkan versi lama,
mencatat versi baru di `model_artifacts` (`is_active=True`), mengubah
`is_enrolled=True` untuk peserta terkait, dan langsung memuat model baru tanpa
restart. Butuh minimal **2 peserta**.

### `GET /api/participants`

Query: `skip`, `limit`, `search`. Mengembalikan daftar peserta beserta
`is_enrolled`, `face_vector_count`, dan `has_centroid`.

### `GET /api/attendance-logs`

Query: `skip`, `limit`, `status` (`VERIFIED`/`REJECTED`), `participant_id`.
Diurutkan berdasarkan `checked_in_at DESC`.

### Endpoint tambahan

- `GET /api/model/status` — status model di memori + artifact aktif di database.
- `GET /health` — status database, Cloudinary, dan model SVM.

---

## 6. Contoh Alur Demo

1. `POST /api/register` untuk minimal 2 peserta.
2. Aktifkan model: `POST /api/model/sync` dengan `.pkl` dari Colab
   (atau `POST /api/model/retrain` bila ingin melatih dari data backend)
   → `is_enrolled=True`.
3. `POST /api/verify` mode `1:1` dengan BIB + foto webcam.
4. `POST /api/verify` mode `1:N` tanpa BIB.
5. Cek hasil di `GET /api/attendance-logs`.

---

## 7. Catatan Keamanan & Git

`.gitignore` root sudah mengecualikan:

- `venv/`, `.venv/`, `__pycache__/`, `*.pyc`
- `*.pkl`, `*.joblib`, `*.h5`, `*.onnx`
- `.env`, `.env.*` (kecuali `.env.example`)
- `node_modules/`, `.next/` (artefak frontend)

Jangan pernah commit `backend/.env` atau file model `.pkl` — keduanya berisi
kredensial/artefak biner yang tidak cocok untuk Git.
