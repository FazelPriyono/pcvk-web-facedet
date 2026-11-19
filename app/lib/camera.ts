/**
 * Helper kamera untuk halaman register & check-in.
 */

/** Terjemahkan error getUserMedia menjadi pesan yang bisa ditindaklanjuti. */
export function describeCameraError(err: unknown): string {
  if (!(err instanceof DOMException)) {
    return "Kamera tidak dapat diakses. Pastikan izin kamera diberikan di browser, lalu coba lagi.";
  }

  switch (err.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Izin kamera ditolak. Klik ikon kamera/gembok di address bar browser, pilih Allow, lalu muat ulang halaman.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "Tidak ada kamera yang terdeteksi. Gunakan opsi upload foto sebagai gantinya.";
    case "NotReadableError":
    case "TrackStartError":
      return "Kamera sedang dipakai aplikasi lain (Zoom/Meet/Teams/OBS). Tutup aplikasi tersebut, lalu coba lagi.";
    case "OverconstrainedError":
      return "Resolusi kamera tidak didukung browser. Coba lagi atau gunakan upload foto.";
    case "AbortError":
      return "Akses kamera dibatalkan. Coba klik tombol kamera sekali lagi.";
    default:
      return `Kamera tidak dapat diakses (${err.name}). Gunakan opsi upload foto bila tetap gagal.`;
  }
}

/**
 * getUserMedia hanya tersedia di secure context (HTTPS atau localhost).
 * Mengakses dev server lewat IP LAN (mis. http://192.168.1.5:3000) akan memblokir kamera.
 */
export function cameraSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices !== "undefined" &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

export const INSECURE_CONTEXT_MESSAGE =
  "Kamera diblokir browser karena halaman tidak dibuka lewat HTTPS atau localhost. " +
  "Buka http://localhost:3000, atau gunakan opsi upload foto.";
