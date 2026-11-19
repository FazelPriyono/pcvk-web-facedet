"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import Navbar from "@/app/components/Navbar";
import Footer from "@/app/components/Footer";
import {
  generateBibNumber,
  saveRunner,
  Runner,
} from "@/app/lib/runnerStore";

const CATEGORIES: Runner["category"][] = [
  "5K",
  "10K",
  "21K Half Marathon",
  "42K Full Marathon",
];

export default function RegisterPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState<Runner["category"]>("10K");
  const [bloodType, setBloodType] = useState("O");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [bibNumber, setBibNumber] = useState("");

  // Camera & photo states
  const [cameraActive, setCameraActive] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Success modal state
  const [registeredRunner, setRegisteredRunner] = useState<Runner | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Generate initial BIB on mount / category change
  useEffect(() => {
    setBibNumber(generateBibNumber(category));
  }, [category]);

  // Start webcam
  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err: unknown) {
      console.error(err);
      setCameraError(
        "Kamera tidak dapat diakses. Pastikan izin kamera telah diberikan di browser."
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

  // Cleanup camera when leaving
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Capture photo from video feed
  const capturePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Flip horizontally to match mirror preview
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setPhotoDataUrl(dataUrl);
    stopCamera();
  };

  // Fallback file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setPhotoDataUrl(event.target.result as string);
          stopCamera();
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRetakePhoto = () => {
    setPhotoDataUrl(null);
    startCamera();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName || !email || !phone) {
      alert("Mohon lengkapi semua kolom biodata wajib.");
      return;
    }
    if (!photoDataUrl) {
      alert("Mohon ambil atau upload foto wajah untuk verifikasi absensi.");
      return;
    }

    setIsSubmitting(true);
    const newRunner: Runner = {
      id: `run-${Date.now()}`,
      bib: bibNumber,
      fullName,
      email,
      phone,
      category,
      bloodType,
      emergencyContact,
      registeredAt: new Date().toLocaleString("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
      photoUrl: photoDataUrl,
      checkedIn: false,
    };

    saveRunner(newRunner);
    setRegisteredRunner(newRunner);
    setIsSubmitting(false);
  };

  const handleResetForm = () => {
    setRegisteredRunner(null);
    setFullName("");
    setEmail("");
    setPhone("");
    setEmergencyContact("");
    setPhotoDataUrl(null);
    setBibNumber(generateBibNumber(category));
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#f8f9fa]">
      <Navbar active="register" />

      <main className="mx-auto w-full max-w-[1000px] flex-1 px-6 pb-16 pt-8 md:pt-12">
        {/* Header */}
        <div className="text-center md:text-left">
          <p className="text-[11px] font-semibold uppercase tracking-[1.54px] text-[#356bff]">
            PELAYON RACE REGISTRATION
          </p>
          <h1 className="mt-2 text-[32px] font-bold tracking-[-1.5px] text-[#172337] md:text-[42px]">
            Registrasi Peserta Event Lari
          </h1>
          <p className="mt-2 text-[15px] text-[#667085]">
            Lengkapi data diri dan ambil foto wajah untuk penerbitan nomor BIB otomatis serta sistem absensi hari-H.
          </p>
        </div>

        {/* Registration Form Grid */}
        <form onSubmit={handleSubmit} className="mt-8 grid gap-8 lg:grid-cols-12">
          {/* Left Column: Biodata & Event (7 cols) */}
          <div className="space-y-6 lg:col-span-7">
            {/* Step 1: Kategori & Nomor BIB */}
            <div className="rounded-xl border border-[#e3e7ed] bg-white p-6 shadow-xs">
              <div className="flex items-center gap-2">
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[#eaf0ff] text-[11px] font-semibold text-[#356bff]">
                  01
                </span>
                <h2 className="text-[15px] font-semibold text-[#172337]">
                  Pilih Kategori & Nomor BIB Otomatis
                </h2>
              </div>

              {/* Kategori selection */}
              <div className="mt-4">
                <label className="text-[13px] font-medium text-[#172337]">
                  Kategori Lari
                </label>
                <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {CATEGORIES.map((cat) => (
                    <button
                      type="button"
                      key={cat}
                      onClick={() => setCategory(cat)}
                      className={`rounded-lg border px-3 py-2.5 text-center text-[13px] font-medium transition-all ${
                        category === cat
                          ? "border-[#356bff] bg-[#eaf0ff] text-[#356bff] shadow-xs"
                          : "border-[#e3e7ed] bg-white text-[#172337] hover:border-gray-300"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live BIB badge preview */}
              <div className="mt-5 rounded-lg border border-dashed border-[#bacaf3] bg-[#fbfcff] p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#356bff]">
                      NOMOR BIB RESMI PESERTA
                    </span>
                    <p className="font-mono text-[24px] font-bold tracking-wider text-[#172337]">
                      {bibNumber}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="inline-block rounded bg-[#356bff] px-2.5 py-1 text-[11px] font-semibold text-white">
                      {category}
                    </span>
                    <p className="mt-1 text-[11px] text-[#667085]">City Marathon 2026</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2: Form Biodata */}
            <div className="rounded-xl border border-[#e3e7ed] bg-white p-6 shadow-xs">
              <div className="flex items-center gap-2">
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[#eaf0ff] text-[11px] font-semibold text-[#356bff]">
                  02
                </span>
                <h2 className="text-[15px] font-semibold text-[#172337]">
                  Biodata Lengkap Peserta
                </h2>
              </div>

              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-[#172337]">
                    Nama Lengkap <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Contoh: Dimas Pratama"
                    className="mt-1.5 w-full rounded-lg border border-[#e3e7ed] bg-[#f8f9fa] px-4 py-2.5 text-[14px] text-[#172337] outline-hidden transition-colors focus:border-[#356bff] focus:bg-white"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-[13px] font-medium text-[#172337]">
                      Email Aktif <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="nama@email.com"
                      className="mt-1.5 w-full rounded-lg border border-[#e3e7ed] bg-[#f8f9fa] px-4 py-2.5 text-[14px] text-[#172337] outline-hidden transition-colors focus:border-[#356bff] focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[13px] font-medium text-[#172337]">
                      No. WhatsApp / Telp <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="081234567890"
                      className="mt-1.5 w-full rounded-lg border border-[#e3e7ed] bg-[#f8f9fa] px-4 py-2.5 text-[14px] text-[#172337] outline-hidden transition-colors focus:border-[#356bff] focus:bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-[13px] font-medium text-[#172337]">
                      Golongan Darah
                    </label>
                    <select
                      value={bloodType}
                      onChange={(e) => setBloodType(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-[#e3e7ed] bg-[#f8f9fa] px-4 py-2.5 text-[14px] text-[#172337] outline-hidden transition-colors focus:border-[#356bff] focus:bg-white"
                    >
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="AB">AB</option>
                      <option value="O">O</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[13px] font-medium text-[#172337]">
                      Kontak Darurat (Nama & Telp)
                    </label>
                    <input
                      type="text"
                      value={emergencyContact}
                      onChange={(e) => setEmergencyContact(e.target.value)}
                      placeholder="Contoh: Budi (Istri) - 081298765432"
                      className="mt-1.5 w-full rounded-lg border border-[#e3e7ed] bg-[#f8f9fa] px-4 py-2.5 text-[14px] text-[#172337] outline-hidden transition-colors focus:border-[#356bff] focus:bg-white"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Foto Wajah Kamera (5 cols) */}
          <div className="space-y-6 lg:col-span-5">
            <div className="rounded-xl border border-[#e3e7ed] bg-white p-6 shadow-xs">
              <div className="flex items-center gap-2">
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[#eaf0ff] text-[11px] font-semibold text-[#356bff]">
                  03
                </span>
                <h2 className="text-[15px] font-semibold text-[#172337]">
                  Pengambilan Foto Wajah
                </h2>
              </div>
              <p className="mt-1 text-[13px] text-[#667085]">
                Wajah Anda akan digunakan sebagai rujukan pencocokan absensi biometrik pada hari lomba.
              </p>

              {/* Camera Preview Area */}
              <div className="relative mt-4 aspect-4/3 w-full overflow-hidden rounded-xl border border-[#e3e7ed] bg-[#172337]">
                {/* When photo is captured */}
                {photoDataUrl ? (
                  <div className="relative h-full w-full">
                    <img
                      src={photoDataUrl}
                      alt="Foto Wajah Terambil"
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute top-3 right-3 rounded-full bg-emerald-500 px-3 py-1 text-[11px] font-semibold text-white shadow-xs">
                      ✓ Foto Siap
                    </div>
                  </div>
                ) : cameraActive ? (
                  /* Live Camera Feed */
                  <div className="relative h-full w-full">
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      className="h-full w-full object-cover -scale-x-100"
                    />
                    {/* Face oval outline guide */}
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="h-44 w-36 rounded-full border-2 border-dashed border-[#356bff] opacity-80" />
                    </div>
                    <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1 text-[11px] text-white">
                      Posisikan wajah di dalam garis oval
                    </span>
                  </div>
                ) : (
                  /* Camera Off State */
                  <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white">
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
                          strokeWidth={2}
                          d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                    </div>
                    <p className="mt-3 text-[13px] font-medium text-white">
                      Kamera Belum Aktif
                    </p>
                    <p className="mt-1 text-[11px] text-gray-300">
                      Klik tombol di bawah untuk mengaktifkan webcam Anda
                    </p>
                  </div>
                )}
              </div>

              {cameraError && (
                <p className="mt-2 text-[12px] text-red-500">{cameraError}</p>
              )}

              {/* Camera Actions */}
              <div className="mt-4 flex flex-col gap-2">
                {!photoDataUrl ? (
                  !cameraActive ? (
                    <button
                      type="button"
                      onClick={startCamera}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#356bff] py-2.5 text-[14px] font-semibold text-white hover:bg-blue-600 transition-colors"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                      Buka Kamera Webcam
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={capturePhoto}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-[14px] font-semibold text-white hover:bg-emerald-700 transition-colors"
                      >
                        Ambil Foto Wajah
                      </button>
                      <button
                        type="button"
                        onClick={stopCamera}
                        className="rounded-lg border border-[#e3e7ed] bg-white px-3 py-2.5 text-[13px] text-[#172337] hover:bg-gray-50"
                      >
                        Batal
                      </button>
                    </div>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={handleRetakePhoto}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#e3e7ed] bg-white py-2.5 text-[13px] font-medium text-[#172337] hover:border-[#356bff] transition-colors"
                  >
                    Foto Ulang
                  </button>
                )}

                {/* File Upload Option */}
                <div className="relative mt-2 text-center">
                  <span className="text-[11px] text-[#667085]">
                    Atau upload foto langsung:
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="mt-1 block w-full text-[12px] text-gray-500 file:mr-2 file:rounded-md file:border-0 file:bg-[#eaf0ff] file:px-3 file:py-1 file:text-[12px] file:font-semibold file:text-[#356bff] hover:file:bg-blue-100"
                  />
                </div>
              </div>
            </div>

            {/* Privacy note */}
            <div className="flex items-start gap-2.5 px-2">
              <Image
                src="/images/privacy-lock.svg"
                alt=""
                width={15}
                height={15}
                className="mt-0.5 shrink-0"
              />
              <p className="text-[11px] leading-[1.45] text-[#667085]">
                Foto wajah hanya digunakan untuk sistem deteksi wajah dan absensi hari-H lomba. Tidak akan disalahgunakan atau dibagikan ke pihak ketiga.
              </p>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-[#356bff] py-4 text-center text-[15px] font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-50"
            >
              {isSubmitting ? "Memproses Registrasi..." : "Selesaikan Pendaftaran & Terbitkan BIB"}
            </button>
          </div>
        </form>
      </main>

      <Footer />

      {/* Success Modal / E-BIB Confirmation */}
      {registeredRunner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#172337]/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-[500px] overflow-hidden rounded-2xl bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="bg-[#356bff] p-6 text-white text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-white">
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
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="mt-3 text-[20px] font-bold">
                Pendaftaran Berhasil!
              </h3>
              <p className="mt-1 text-[13px] text-white/80">
                E-BIB dan data biometrik wajah Anda telah tersimpan.
              </p>
            </div>

            {/* E-BIB Card Design */}
            <div className="p-6">
              <div className="rounded-xl border-2 border-[#172337] bg-white p-5 shadow-xs">
                {/* Event Name */}
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <span className="text-[12px] font-bold uppercase tracking-wider text-[#356bff]">
                    CITY MARATHON 2026
                  </span>
                  <span className="rounded bg-[#172337] px-2 py-0.5 text-[11px] font-bold text-white">
                    {registeredRunner.category}
                  </span>
                </div>

                {/* BIB & Photo */}
                <div className="mt-4 flex items-center justify-between gap-4">
                  <div>
                    <span className="text-[10px] uppercase text-[#667085]">
                      Nomor BIB Resmi
                    </span>
                    <p className="font-mono text-[32px] font-black tracking-tight text-[#172337]">
                      {registeredRunner.bib}
                    </p>
                    <p className="mt-1 text-[14px] font-semibold text-[#172337]">
                      {registeredRunner.fullName}
                    </p>
                    <p className="text-[12px] text-[#667085]">
                      Gol. Darah: {registeredRunner.bloodType}
                    </p>
                  </div>
                  <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-lg border border-[#e3e7ed] bg-gray-100">
                    <img
                      src={registeredRunner.photoUrl}
                      alt={registeredRunner.fullName}
                      className="h-full w-full object-cover"
                    />
                  </div>
                </div>

                {/* Mock Barcode */}
                <div className="mt-5 border-t border-dashed border-gray-300 pt-3 text-center">
                  <div className="mx-auto flex h-8 w-4/5 items-center justify-between opacity-80">
                    {Array.from({ length: 42 }).map((_, i) => (
                      <span
                        key={i}
                        className={`h-full bg-black ${
                          i % 3 === 0 ? "w-1" : i % 2 === 0 ? "w-0.5" : "w-1.5"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="mt-1 font-mono text-[9px] text-[#667085]">
                    {registeredRunner.id}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-6 flex flex-col gap-2.5">
                <Link
                  href="/check-in"
                  className="w-full rounded-xl bg-[#356bff] py-3 text-center text-[14px] font-semibold text-white hover:bg-blue-600 transition-colors"
                >
                  Buka Absensi Check-in Hari-H →
                </Link>
                <button
                  onClick={handleResetForm}
                  className="w-full rounded-xl border border-[#e3e7ed] bg-white py-3 text-center text-[14px] font-medium text-[#172337] hover:bg-gray-50"
                >
                  Daftarkan Peserta Lain
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
