/**
 * Client API untuk backend FastAPI PCVK.
 *
 * Base URL diambil dari NEXT_PUBLIC_API_URL (file .env.local), dengan fallback
 * ke http://localhost:8000 untuk development.
 */

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface ApiParticipant {
  id: number;
  bib_number: string;
  full_name: string;
  email: string;
  phone_number: string | null;
  race_category: string;
  registration_photo_url: string;
  cloudinary_public_id: string;
  is_enrolled: boolean;
  created_at: string | null;
  face_vector_count: number;
  has_centroid: boolean;
}

export interface RegisterResponse {
  message: string;
  participant: ApiParticipant;
  vector_dimension: number;
  feature_method: string;
}

export interface VerifyParticipant {
  id: number;
  bib_number: string;
  full_name: string;
  race_category: string | null;
  photo_url: string | null;
}

export interface VerifyResponse {
  status: "VERIFIED" | "REJECTED";
  message: string;
  verification_mode: "1:1" | "1:N";
  input_bib_number: string | null;
  participant: VerifyParticipant | null;
  participant_photo_url: string | null;
  svm_probability: number;
  similarity_score: number;
  euclidean_distance: number;
  processing_time_ms: number;
  threshold_probability: number;
  threshold_distance: number;
  checkin_photo_url: string | null;
  cloudinary_checkin_id: string | null;
  attendance_log_id: number | null;
  checked_in_at: string | null;
}

export interface AttendanceLog {
  id: number;
  participant_id: number | null;
  participant_bib_number: string | null;
  participant_name: string | null;
  participant_race_category: string | null;
  participant_photo_url: string | null;
  input_bib_number: string | null;
  checkin_photo_url: string | null;
  verification_mode: string;
  similarity_score: number;
  euclidean_distance: number;
  processing_time_ms: number | null;
  status: "VERIFIED" | "REJECTED";
  checked_in_at: string | null;
}

interface RegisterInput {
  bibNumber: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  raceCategory: string;
  photo: Blob;
}

interface VerifyInput {
  photo: Blob;
  mode: "1:1" | "1:N";
  bibNumber?: string;
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.detail === "string") return data.detail;
    if (Array.isArray(data?.detail)) {
      return data.detail
        .map((item: { msg?: string }) => item?.msg ?? JSON.stringify(item))
        .join("; ");
    }
  } catch {
    // respons bukan JSON
  }
  return `Permintaan gagal (HTTP ${response.status}).`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    throw new ApiError(
      `Tidak dapat terhubung ke backend (${API_BASE_URL}). Pastikan server FastAPI sedang berjalan.`
    );
  }

  if (!response.ok) {
    throw new ApiError(await extractErrorMessage(response), response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** Transparansi status backend untuk ditampilkan di UI. */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function registerParticipant(
  input: RegisterInput
): Promise<RegisterResponse> {
  const form = new FormData();
  form.append("bib_number", input.bibNumber);
  form.append("full_name", input.fullName);
  form.append("email", input.email);
  if (input.phoneNumber.trim()) {
    form.append("phone_number", input.phoneNumber.trim());
  }
  form.append("race_category", input.raceCategory);
  form.append("photo", input.photo, "registration.jpg");

  return request<RegisterResponse>("/api/register", {
    method: "POST",
    body: form,
  });
}

export async function verifyAttendance(
  input: VerifyInput
): Promise<VerifyResponse> {
  const form = new FormData();
  form.append("photo", input.photo, "checkin.jpg");
  form.append("verification_mode", input.mode);
  if (input.bibNumber) {
    form.append("bib_number", input.bibNumber);
  }

  return request<VerifyResponse>("/api/verify", {
    method: "POST",
    body: form,
  });
}

export async function getAttendanceLogs(options?: {
  limit?: number;
  status?: "VERIFIED" | "REJECTED";
}): Promise<AttendanceLog[]> {
  const params = new URLSearchParams();
  params.set("limit", String(options?.limit ?? 50));
  if (options?.status) {
    params.set("status", options.status);
  }
  return request<AttendanceLog[]>(`/api/attendance-logs?${params.toString()}`, {
    cache: "no-store",
  });
}

export async function getParticipants(options?: {
  limit?: number;
  search?: string;
}): Promise<ApiParticipant[]> {
  const params = new URLSearchParams();
  params.set("limit", String(options?.limit ?? 100));
  if (options?.search) {
    params.set("search", options.search);
  }
  return request<ApiParticipant[]>(`/api/participants?${params.toString()}`, {
    cache: "no-store",
  });
}

/** Data URL (hasil canvas/FileReader) -> Blob untuk FormData. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = /data:([^;]+);base64/.exec(header);
  const mime = mimeMatch?.[1] ?? "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

/** "21K Half Marathon" -> "21K" agar sesuai kolom race_category. */
export function toApiRaceCategory(category: string): string {
  if (category.startsWith("21K")) return "21K";
  if (category.startsWith("42K")) return "42K";
  if (category.startsWith("10K")) return "10K";
  return "5K";
}

export function formatCheckInTime(value: string | null): string {
  if (!value) return "Baru saja";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Baru saja";
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
