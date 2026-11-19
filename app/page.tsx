import Image from "next/image";
import Link from "next/link";
import Navbar from "@/app/components/Navbar";
import Footer from "@/app/components/Footer";

const steps = [
  {
    num: "01",
    title: "Choose Event",
    desc: "Select the race you took part in.",
  },
  {
    num: "02",
    title: "Upload Selfie",
    desc: "A clear selfie is all you need.",
  },
  {
    num: "03",
    title: "Find Photos",
    desc: "View, download, and relive it.",
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <Navbar active="home" />

      {/* Hero Section */}
      <main className="mx-auto w-full max-w-[1248px] flex-1 px-6 md:px-0">
        <section className="pb-12 pt-8 md:pt-14">
          {/* Two-column layout on desktop */}
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            {/* Left content */}
            <div className="max-w-[620px]">
              <p className="text-[11px] font-semibold uppercase tracking-[1.54px] text-brand">
                EVERY FINISH HAS A STORY
              </p>

              <h1 className="mt-6 text-[42px] font-semibold leading-[1.06] tracking-[-3.8px] text-dark md:mt-8 md:text-[76px]">
                Your Race.
                <br />
                Your Moments.
              </h1>

              <p className="mt-5 max-w-[510px] text-[15px] leading-[1.45] text-muted md:mt-6 md:text-[17px]">
                You ran the race. Relive every moment.
                <br />
                Find your event photos with just a selfie.
              </p>

              <Link
                href="/search"
                className="mt-7 inline-flex items-center gap-3 rounded-lg bg-brand px-5 py-4 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 md:mt-10"
              >
                Find My Photos
                <Image
                  src="/images/arrow-right.svg"
                  alt=""
                  width={20}
                  height={20}
                />
              </Link>

              <p className="mt-4 text-[12px] text-muted">
                One event. One selfie. All your moments.
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
              <div className="absolute bottom-4 left-4 right-4 rounded-md bg-white px-4 py-3">
                <p className="text-[13px] font-medium text-dark">
                  For the miles you&apos;ll never forget.
                </p>
              </div>
            </div>
          </div>

          {/* How it works */}
          <div className="mt-14 md:mt-20">
            <h2 className="text-[22px] font-semibold tracking-[-0.84px] text-dark md:text-[28px]">
              From finish line to camera roll.
            </h2>

            <div className="mt-8 grid gap-6 sm:grid-cols-3 md:mt-10 md:gap-7">
              {steps.map((step) => (
                <div key={step.num} className="flex gap-3 sm:flex-col sm:gap-0">
                  <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[15px] bg-brand-light">
                    <span className="text-[11px] font-semibold text-brand">
                      {step.num}
                    </span>
                  </div>
                  <div className="sm:mt-4">
                    <p className="text-[16px] font-semibold text-dark">
                      {step.title}
                    </p>
                    <p className="mt-1 text-[14px] text-muted">{step.desc}</p>
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
