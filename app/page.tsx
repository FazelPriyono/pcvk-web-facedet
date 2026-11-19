import Image from "next/image";
import Link from "next/link";
import Navbar from "@/app/components/Navbar";
import Footer from "@/app/components/Footer";

const steps = [
  {
    num: "01",
    title: "Pilih Kategori Lari",
    desc: "Tentukan jarak lomba yang Anda ikuti: 5K, 10K, 21K Half Marathon, atau 42K Full Marathon.",
  },
  {
    num: "02",
    title: "Registrasi & Foto Wajah",
    desc: "Isi biodata dan ambil foto wajah via webcam untuk penerbitan nomor BIB resmi otomatis.",
  },
  {
    num: "03",
    title: "Absensi Wajah Hari-H",
    desc: "Lakukan check-in presensi di venue lomba secara instan melalui pemindaian biometrik wajah live.",
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#f8f9fa]">
      <Navbar active="home" />

      {/* Hero Section */}
      <main className="mx-auto w-full max-w-[1248px] flex-1 px-6 md:px-0">
        <section className="pb-12 pt-8 md:pt-14">
          {/* Two-column layout on desktop */}
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            {/* Left content */}
            <div className="max-w-[620px]">
              <p className="text-[11px] font-semibold uppercase tracking-[1.54px] text-[#356bff]">
                EVERY FINISH HAS A STORY
              </p>

              <h1 className="mt-6 text-[42px] font-semibold leading-[1.06] tracking-[-3.8px] text-[#172337] md:mt-8 md:text-[76px]">
                Your Race.
                <br />
                Your Moments.
              </h1>

              <p className="mt-5 max-w-[510px] text-[15px] leading-[1.45] text-[#667085] md:mt-6 md:text-[17px]">
                Sistem registrasi peserta event lari maraton dan absensi presensi cerdas berbasis pengenalan wajah biometrik (HOG + LBPH & SVM).
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3 md:mt-10">
                <Link
                  href="/register"
                  className="inline-flex items-center gap-3 rounded-lg bg-[#356bff] px-6 py-4 text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
                >
                  Registrasi Peserta Sekarang
                  <Image
                    src="/images/arrow-right.svg"
                    alt=""
                    width={20}
                    height={20}
                  />
                </Link>
                <Link
                  href="/check-in"
                  className="inline-flex items-center gap-2 rounded-lg border border-[#e3e7ed] bg-white px-5 py-4 text-[15px] font-medium text-[#172337] transition-colors hover:border-[#356bff]"
                >
                  Absensi Check-in Hari-H
                </Link>
              </div>

              <p className="mt-4 text-[12px] text-[#667085]">
                Penerbitan nomor BIB otomatis · Verifikasi biometrik wajah real-time
              </p>
            </div>

            {/* Right image */}
            <div className="relative w-full overflow-hidden rounded-xl lg:w-[608px]">
              <div className="relative aspect-[608/480]">
                <Image
                  src="/images/marathon-hero.png"
                  alt="Marathon on the city streets"
                  fill
                  className="rounded-xl object-cover"
                  priority
                />
              </div>
              {/* Caption bar */}
              <div className="absolute bottom-4 left-4 right-4 rounded-md bg-white px-4 py-3 shadow-xs">
                <p className="text-[13px] font-medium text-[#172337]">
                  City Marathon 2026 — For the miles you&apos;ll never forget.
                </p>
              </div>
            </div>
          </div>

          {/* How it works */}
          <div className="mt-14 md:mt-20">
            <h2 className="text-[22px] font-semibold tracking-[-0.84px] text-[#172337] md:text-[28px]">
              Alur Registrasi & Presensi Event Lari
            </h2>

            <div className="mt-8 grid gap-6 sm:grid-cols-3 md:mt-10 md:gap-7">
              {steps.map((step) => (
                <div key={step.num} className="flex gap-3 sm:flex-col sm:gap-0">
                  <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[15px] bg-[#eaf0ff]">
                    <span className="text-[11px] font-semibold text-[#356bff]">
                      {step.num}
                    </span>
                  </div>
                  <div className="sm:mt-4">
                    <p className="text-[16px] font-semibold text-[#172337]">
                      {step.title}
                    </p>
                    <p className="mt-1 text-[14px] leading-relaxed text-[#667085]">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
