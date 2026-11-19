"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import Navbar from "@/app/components/Navbar";
import Footer from "@/app/components/Footer";
import {
  ApiError,
  dataUrlToBlob,
  formatCheckInTime,
  getAttendanceLogs,
  verifyAttendance,
  type VerifyResponse,
} from "@/app/lib/api";

type ScanState = "idle" | "scanning" | "verified" | "rejected";

interface VerifiedRunnerView {
  id: number;
  bib: string;
  fullName: string;
  category: string;
  photoUrl: string | null;
  checkedInAt: string;
  matchScore: number;
  distance: number;
  mode: string;
}

interface RecentLogView {
  id: number;
  bib: string;
  fullName: string;
  category: string | null;
  photoUrl: string | null;
  checkedInAt: string;
}

export default function CheckInPage() {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [autoScan, setAutoScan] = useState(false);

  // Result state
  const [verifiedRunner, setVerifiedRunner] = useState<VerifiedRunnerView | null>(
    null
  );
  const [capturedSnapshot, setCapturedSnapshot] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>("");
  const [matchScore, setMatchScore] = useState<number>(0);
  const [thresholdProbability, setThresholdProbability] = useState<number>(45);

  // Recent logs
  const [recentLogs, setRecentLogs] = useState<RecentLogView[]>([]);

  // Manual fallback search
  const [manualBib, setManualBib] = useState("");
  const [showManualModal, setShowManualModal] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Load recent verified check-ins dari backend
  const refreshLogs = useCallback(async () => {
    try {
      const logs = await getAttendanceLogs({ limit: 10, status: "VERIFIED" });
      setRecentLogs(
        logs.map((log) => ({
          id: log.id,
          bib: log.participant_bib_number ?? log.input_bib_number ?? "-",
          fullName: log.participant_name ?? "Peserta",
          category: log.participant_race_category,
          photoUrl: log.checkin_photo_url ?? log.participant_photo_url,
          checkedInAt: formatCheckInTime(log.checked_in_at),
        }))
      );
    } catch {
      // Backend belum siap / offline: biarkan daftar kosong.
      setRecentLogs([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    getAttendanceLogs({ limit: 10, status: "VERIFIED" })
      .then((logs) => {
        if (cancelled) return;
        setRecentLogs(
          logs.map((log) => ({
            id: log.id,
            bib: log.participant_bib_number ?? log.input_bib_number ?? "-",
            fullName: log.participant_name ?? "Peserta",
            category: log.participant_race_category,
            photoUrl: log.checkin_photo_url ?? log.participant_photo_url,
            checkedInAt: formatCheckInTime(log.checked_in_at),
          }))
        );
      })
      .catch(() => {
        // Backend belum siap / offline: biarkan daftar kosong.
        if (!cancelled) setRecentLogs([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Start webcam
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraError(null);
      setCameraActive(true);
    } catch (err: unknown) {
      console.error(err);
      setCameraError(
        "Kamera tidak dapat diakses. Mohon izinkan akses webcam pada browser untuk menjalankan absensi."
      );
      setCameraActive(false);
    }
  };

  // Stop webcam
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Auto start camera on page load if permitted
  useEffect(() => {
    // Ditunda satu microtask supaya setState kamera tidak berjalan sinkron
    // di dalam effect (menghindari cascading render).
    queueMicrotask(() => {
      void startCamera();
    });
    // startCamera hanya didefinisikan ulang tiap render; cukup dijalankan sekali.
  }, []);

  // Ambil frame dari video webcam -> data URL + Blob untuk dikirim ke API
  const captureFrame = useCallback((): { dataUrl: string; blob: Blob } | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Mirror agar sama dengan preview kamera.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { dataUrl, blob: dataUrlToBlob(dataUrl) };
  }, []);

  const applyVerificationResult = useCallback(
    (result: VerifyResponse) => {
      setMatchScore(result.similarity_score);
      setThresholdProbability(Math.round(result.threshold_probability * 100));

      if (result.status === "VERIFIED" && result.participant) {
        setVerifiedRunner({
          id: result.participant.id,
          bib: result.participant.bib_number,
          fullName: result.participant.full_name,
          category: result.participant.race_category ?? "-",
          photoUrl:
            result.participant_photo_url ?? result.participant.photo_url ?? null,
          checkedInAt: formatCheckInTime(result.checked_in_at),
          matchScore: result.similarity_score,
          distance: result.euclidean_distance,
          mode: result.verification_mode,
        });
        setScanState("verified");
        void refreshLogs();
      } else {
        setScanState("rejected");
        setRejectionReason(result.message);
      }
    },
    [refreshLogs]
  );

  // Perform face recognition scan (mode 1:N ke backend)
  const triggerScan = useCallback(async () => {
    if (scanState === "scanning") return;

    setVerifiedRunner(null);
    setCapturedSnapshot(null);
    setRejectionReason("");
    setScanState("scanning");

    const frame = captureFrame();
    if (!frame) {
      setScanState("rejected");
      setRejectionReason(
        "Kamera belum aktif. Nyalakan kamera lalu coba scan ulang."
      );
      setMatchScore(0);
      return;
    }

    setCapturedSnapshot(frame.dataUrl);

    try {
      const result = await verifyAttendance({
        photo: frame.blob,
        mode: "1:N",
      });
      applyVerificationResult(result);
    } catch (err) {
      setScanState("rejected");
      setRejectionReason(
        err instanceof ApiError
          ? err.message
          : "Verifikasi wajah gagal diproses oleh server."
      );
    }
  }, [scanState, captureFrame, applyVerificationResult]);

  // Auto scan interval loop
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (autoScan && cameraActive && scanState === "idle") {
      interval = setInterval(() => {
        triggerScan();
      }, 3500);
    }
    return () => clearInterval(interval);
  }, [autoScan, cameraActive, scanState, triggerScan]);

  const resetToIdle = () => {
    setScanState("idle");
    setVerifiedRunner(null);
    setCapturedSnapshot(null);
  };

  const handleManualCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const bib = manualBib.trim().toUpperCase();
    if (!bib) return;

    const frame = captureFrame();
    if (!frame) {
      alert(
        "Nyalakan kamera terlebih dahulu. Foto webcam tetap diperlukan untuk verifikasi biometrik."
      );
      return;
    }

    setShowManualModal(false);
    setManualBib("");
    setVerifiedRunner(null);
    setRejectionReason("");
    setCapturedSnapshot(frame.dataUrl);
    setScanState("scanning");

    try {
      const result = await verifyAttendance({
        photo: frame.blob,
        mode: "1:1",
        bibNumber: bib,
      });
      applyVerificationResult(result);
    } catch (err) {
      setScanState("rejected");
      setRejectionReason(
        err instanceof ApiError
          ? err.message
          : `BIB "${bib}" gagal diverifikasi.`
      );
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#f8f9fa]">
      <Navbar active="checkin" />

      <main className="mx-auto w-full max-w-[1248px] flex-1 px-6 pb-16 pt-8 md:pt-12">
        {/* Top Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-[11px] font-semibold uppercase tracking-[1.54px] text-[#356bff]">
                LIVE RACE DAY FACE RECOGNITION
              </p>
            </div>
            <h1 className="mt-1 text-[28px] font-bold tracking-[-1.5px] text-[#172337] md:text-[38px]">
              Absensi Check-in Hari-H
            </h1>
            <p className="text-[14px] text-[#667085]">
              Arahkan wajah peserta ke webcam untuk verifikasi otomatis nomor BIB dan pengambilan race pack.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowManualModal(true)}
              className="rounded-lg border border-[#e3e7ed] bg-white px-4 py-2.5 text-[13px] font-medium text-[#172337] hover:border-[#356bff] transition-colors"
            >
              Manual Check-in via BIB
            </button>
            <Link
              href="/register"
              className="rounded-lg bg-[#356bff] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-600 transition-colors"
            >
              + Registrasi Peserta Baru
            </Link>
          </div>
        </div>

        {/* Main Scanner Section */}
        <div className="mt-8 grid gap-8 lg:grid-cols-12">
          {/* Left Column: Live Webcam Scanner (7 cols) */}
          <div className="space-y-4 lg:col-span-7">
            <div className="relative aspect-4/3 w-full overflow-hidden rounded-2xl border-2 border-[#172337] bg-[#0d1522] shadow-lg">
              {/* Camera Video Feed */}
              {cameraActive ? (
                <div className="relative h-full w-full">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className="h-full w-full object-cover -scale-x-100"
                  />

                  {/* Corner scanning brackets */}
                  <div className="pointer-events-none absolute inset-8 flex flex-col justify-between">
                    <div className="flex justify-between">
                      <div className="h-10 w-10 border-t-4 border-l-4 border-[#356bff] rounded-tl-lg" />
                      <div className="h-10 w-10 border-t-4 border-r-4 border-[#356bff] rounded-tr-lg" />
                    </div>
                    {/* Face target oval / guide */}
                    <div className="mx-auto h-52 w-44 rounded-full border-2 border-dashed border-white/60 flex items-center justify-center">
                      {scanState === "scanning" && (
                        <div className="h-44 w-36 rounded-full border-2 border-[#356bff] animate-ping opacity-60" />
                      )}
                    </div>
                    <div className="flex justify-between">
                      <div className="h-10 w-10 border-b-4 border-l-4 border-[#356bff] rounded-bl-lg" />
                      <div className="h-10 w-10 border-b-4 border-r-4 border-[#356bff] rounded-br-lg" />
                    </div>
                  </div>

                  {/* Laser Scanning Line Animation */}
                  {scanState === "scanning" && (
                    <div className="pointer-events-none absolute inset-x-8 top-12 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_15px_#22d3ee] animate-bounce duration-700" />
                  )}

                  {/* Top Bar Info */}
                  <div className="absolute top-4 inset-x-4 flex items-center justify-between pointer-events-none">
                    <div className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-[11px] font-medium text-white backdrop-blur-xs">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                      WEBCAM ACTIVE
                    </div>
                    <span className="rounded-full bg-black/60 px-3 py-1 font-mono text-[11px] text-white backdrop-blur-xs">
                      FPS: 30 · 720p
                    </span>
                  </div>

                  {/* Bottom Guide Text */}
                  <div className="absolute bottom-4 inset-x-0 text-center pointer-events-none">
                    <span className="rounded-full bg-black/70 px-4 py-1.5 text-[12px] font-medium text-white backdrop-blur-xs">
                      {scanState === "scanning"
                        ? "Mengekstraksi fitur wajah & biometrik..."
                        : "Posisikan wajah tegak lurus menghadap kamera"}
                    </span>
                  </div>
                </div>
              ) : (
                /* Camera Disabled State */
                <div className="flex h-full flex-col items-center justify-center p-8 text-center text-white">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-8 w-8 text-gray-300"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.657a9 9 0 01-2.121-5.657m14.85-5.657a9 9 0 00-12.728 0m12.728 0l-2.829 2.829"
                      />
                    </svg>
                  </div>
                  <p className="mt-4 text-[16px] font-semibold">
                    Webcam Belum Terhubung
                  </p>
                  <p className="mt-1 text-[13px] text-gray-400">
                    Nyalakan kamera untuk memulai proses pemindaian wajah peserta.
                  </p>
                  <button
                    onClick={startCamera}
                    className="mt-5 rounded-lg bg-[#356bff] px-6 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-600 transition-colors"
                  >
                    Nyalakan Kamera
                  </button>
                </div>
              )}
            </div>

            {cameraError && (
              <p className="text-[12px] text-red-500">{cameraError}</p>
            )}

            {/* Scanner Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e3e7ed] bg-white p-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={!cameraActive || scanState === "scanning"}
                  onClick={triggerScan}
                  className="flex items-center gap-2 rounded-lg bg-[#356bff] px-6 py-3 text-[14px] font-semibold text-white shadow-xs hover:bg-blue-600 transition-all disabled:opacity-50"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                    />
                  </svg>
                  {scanState === "scanning"
                    ? "Menganalisis Wajah..."
                    : "Scan Wajah Sekarang"}
                </button>

                {cameraActive && (
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="rounded-lg border border-[#e3e7ed] px-3.5 py-3 text-[13px] font-medium text-[#667085] hover:text-[#172337]"
                  >
                    Matikan Kamera
                  </button>
                )}
              </div>

              {/* Auto Scan Toggle */}
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#172337]">
                <input
                  type="checkbox"
                  checked={autoScan}
                  onChange={(e) => setAutoScan(e.target.checked)}
                  className="h-4 w-4 rounded text-[#356bff] focus:ring-[#356bff]"
                />
                <span className="font-medium">Auto-Scan Tiap 3.5 Detik</span>
              </label>
            </div>
          </div>

          {/* Right Column: Decision Panel & Recent Logs (5 cols) */}
          <div className="space-y-6 lg:col-span-5">
            {/* Decision Result Card */}
            <div className="rounded-2xl border border-[#e3e7ed] bg-white p-6 shadow-xs">
              <h2 className="text-[14px] font-bold uppercase tracking-wider text-[#667085]">
                Status Keputusan Verifikasi
              </h2>

              {/* State 1: Idle */}
              {scanState === "idle" && (
                <div className="mt-5 rounded-xl border border-dashed border-[#e3e7ed] bg-[#f8f9fa] p-8 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#eaf0ff] text-[#356bff]">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-7 w-7"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                  <p className="mt-3 text-[15px] font-semibold text-[#172337]">
                    Menunggu Pemindaian
                  </p>
                  <p className="mt-1 text-[13px] text-[#667085]">
                    Arahkan peserta ke depan webcam lalu tekan tombol <strong>Scan Wajah Sekarang</strong>.
                  </p>
                </div>
              )}

              {/* State 2: Scanning */}
              {scanState === "scanning" && (
                <div className="mt-5 rounded-xl border border-[#356bff]/30 bg-[#fbfcff] p-8 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#eaf0ff] text-[#356bff] animate-spin">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-7 w-7"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v8H4z"
                      />
                    </svg>
                  </div>
                  <p className="mt-3 text-[15px] font-semibold text-[#172337]">
                    Menganalisis Wajah Peserta...
                  </p>
                  <p className="mt-1 text-[12px] text-[#667085]">
                    Mencocokkan biometric encoding dengan data pendaftar.
                  </p>
                </div>
              )}

              {/* State 3: VERIFIED (Green) */}
              {scanState === "verified" && verifiedRunner && (
                <div className="mt-4 space-y-4 animate-in fade-in duration-300">
                  {/* Verified Header Badge */}
                  <div className="flex items-center gap-3 rounded-xl bg-emerald-500 p-4 text-white shadow-xs">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-6 w-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2.5}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-100">
                        STATUS KEPUTUSAN
                      </span>
                      <h3 className="text-[18px] font-black leading-tight">
                        VERIFIED · LOLOS CHECK-IN
                      </h3>
                    </div>
                  </div>

                  {/* Face comparison preview */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="overflow-hidden rounded-lg border border-[#e3e7ed] bg-gray-50 text-center">
                      <div className="relative aspect-square w-full">
                        {capturedSnapshot ? (
                          <img
                            src={capturedSnapshot}
                            alt="Live Snapshot"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="h-full w-full bg-gray-200" />
                        )}
                      </div>
                      <p className="py-1.5 text-[11px] font-medium text-[#667085]">
                        Live Webcam
                      </p>
                    </div>

                    <div className="overflow-hidden rounded-lg border border-[#e3e7ed] bg-gray-50 text-center">
                      <div className="relative aspect-square w-full">
                        {verifiedRunner.photoUrl ? (
                          <img
                            src={verifiedRunner.photoUrl}
                            alt="Database Photo"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gray-200 text-[11px] text-gray-500">
                            Foto tidak tersedia
                          </div>
                        )}
                      </div>
                      <p className="py-1.5 text-[11px] font-medium text-emerald-600 font-semibold">
                        Database ({matchScore}% Match)
                      </p>
                    </div>
                  </div>

                  {/* Participant Details */}
                  <div className="rounded-xl border border-[#e3e7ed] bg-[#f8f9fa] p-4 space-y-2 text-[13px]">
                    <div className="flex justify-between border-b border-gray-200/60 pb-2">
                      <span className="text-[#667085]">Nomor BIB:</span>
                      <span className="font-mono text-[16px] font-bold text-[#172337]">
                        {verifiedRunner.bib}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-gray-200/60 pb-2">
                      <span className="text-[#667085]">Nama Peserta:</span>
                      <span className="font-semibold text-[#172337]">
                        {verifiedRunner.fullName}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-gray-200/60 pb-2">
                      <span className="text-[#667085]">Kategori:</span>
                      <span className="rounded bg-[#356bff] px-2 py-0.5 text-[11px] font-semibold text-white">
                        {verifiedRunner.category}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-gray-200/60 pb-2">
                      <span className="text-[#667085]">Jarak Euclidean:</span>
                      <span className="font-mono text-[12px] font-semibold text-[#172337]">
                        {verifiedRunner.distance.toFixed(4)}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-gray-200/60 pb-2">
                      <span className="text-[#667085]">Waktu Absen:</span>
                      <span className="font-medium text-[#172337]">
                        {verifiedRunner.checkedInAt || "Baru saja"}
                      </span>
                    </div>
                    <div className="flex justify-between pt-1">
                      <span className="text-[#667085]">Race Pack / Medali:</span>
                      <span className="font-semibold text-emerald-600">
                        Siap Diberikan ✓
                      </span>
                    </div>
                  </div>

                  {/* Action */}
                  <button
                    onClick={resetToIdle}
                    className="w-full rounded-xl bg-[#172337] py-3 text-center text-[14px] font-semibold text-white hover:bg-black transition-colors"
                  >
                    Check-in Peserta Berikutnya →
                  </button>
                </div>
              )}

              {/* State 4: REJECTED (Red) */}
              {scanState === "rejected" && (
                <div className="mt-4 space-y-4 animate-in fade-in duration-300">
                  {/* Rejected Header Badge */}
                  <div className="flex items-center gap-3 rounded-xl bg-red-600 p-4 text-white shadow-xs">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-6 w-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2.5}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold tracking-wider text-red-100">
                        STATUS KEPUTUSAN
                      </span>
                      <h3 className="text-[18px] font-black leading-tight">
                        REJECTED · TIDAK TERVERIFIKASI
                      </h3>
                    </div>
                  </div>

                  {/* Rejected snapshot */}
                  {capturedSnapshot && (
                    <div className="mx-auto max-w-[160px] overflow-hidden rounded-lg border-2 border-red-300">
                      <img
                        src={capturedSnapshot}
                        alt="Unrecognized Face"
                        className="aspect-square w-full object-cover"
                      />
                    </div>
                  )}

                  <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-[13px] text-red-800">
                    <p className="font-semibold">Penyebab Kegagalan:</p>
                    <p className="mt-1 text-[12px] leading-relaxed">
                      {rejectionReason}
                    </p>
                    <p className="mt-2 text-[11px] text-red-600 font-mono">
                      Skor Biometrik: {matchScore}% (Di bawah batas {thresholdProbability}%)
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={triggerScan}
                      className="flex-1 rounded-xl bg-[#356bff] py-2.5 text-[13px] font-semibold text-white hover:bg-blue-600"
                    >
                      Coba Scan Ulang
                    </button>
                    <button
                      onClick={() => setShowManualModal(true)}
                      className="flex-1 rounded-xl border border-[#e3e7ed] bg-white py-2.5 text-[13px] font-medium text-[#172337] hover:bg-gray-50"
                    >
                      Input BIB Manual
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Recent Check-in Logs List */}
            <div className="rounded-2xl border border-[#e3e7ed] bg-white p-6 shadow-xs">
              <div className="flex items-center justify-between">
                <h3 className="text-[14px] font-bold text-[#172337]">
                  Riwayat Absensi Hari Ini
                </h3>
                <span className="rounded-full bg-[#eaf0ff] px-2.5 py-0.5 text-[11px] font-bold text-[#356bff]">
                  {recentLogs.length} Peserta
                </span>
              </div>

              <div className="mt-4 divide-y divide-gray-100 max-h-[280px] overflow-y-auto">
                {recentLogs.length === 0 ? (
                  <p className="py-6 text-center text-[13px] text-[#667085]">
                    Belum ada peserta yang check-in hari ini.
                  </p>
                ) : (
                  recentLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between py-2.5"
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-gray-200">
                          <img
                            src={log.photoUrl ?? "/images/race-photo-1.png"}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div>
                          <p className="text-[13px] font-semibold text-[#172337]">
                            {log.fullName}
                          </p>
                          <p className="font-mono text-[11px] text-[#667085]">
                            {log.bib} · {log.category ?? "-"}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                          VERIFIED
                        </span>
                        <p className="mt-0.5 text-[10px] text-[#667085]">
                          {log.checkedInAt || "Hari ini"}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />

      {/* Manual Check-in Modal */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#172337]/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-[18px] font-bold text-[#172337]">
              Check-in Manual via BIB
            </h3>
            <p className="mt-1 text-[13px] text-[#667085]">
              Gunakan opsi ini jika wajah peserta tidak terbaca atau terjadi kendala pada kamera.
            </p>

            <form onSubmit={handleManualCheckIn} className="mt-4 space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-[#172337]">
                  Nomor BIB Peserta
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="Contoh: PLY-10K-0142"
                  value={manualBib}
                  onChange={(e) => setManualBib(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[#e3e7ed] bg-[#f8f9fa] px-4 py-2.5 font-mono text-[14px] uppercase text-[#172337] outline-hidden focus:border-[#356bff] focus:bg-white"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-[#356bff] py-2.5 text-[13px] font-semibold text-white hover:bg-blue-600"
                >
                  Verifikasi BIB
                </button>
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="rounded-xl border border-[#e3e7ed] px-4 py-2.5 text-[13px] font-medium text-[#172337] hover:bg-gray-50"
                >
                  Batal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
