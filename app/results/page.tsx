"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Navbar from "@/app/components/Navbar";
import Footer from "@/app/components/Footer";
import PhotoPreviewModal from "@/app/components/PhotoPreviewModal";

const photos = [
  {
    id: 1,
    src: "/images/race-photo-1.png",
    title: "Race moment 01",
    event: "City Marathon 2026",
  },
  {
    id: 2,
    src: "/images/race-photo-2.png",
    title: "Race moment 02",
    event: "City Marathon 2026",
  },
  {
    id: 3,
    src: "/images/race-photo-3.png",
    title: "Race moment 03",
    event: "City Marathon 2026",
  },
];

export default function ResultsPage() {
  const [selectedPhoto, setSelectedPhoto] = useState<
    (typeof photos)[number] | null
  >(null);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <Navbar active="find-photos" />

      <main className="mx-auto w-full max-w-[1248px] flex-1 px-6 pb-12 pt-8 md:pt-14 md:px-0">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-1.68px] text-dark md:text-[42px]">
              Your Race Moments
            </h1>
            <p className="mt-4 text-[16px] font-medium text-dark">
              City Marathon 2026
            </p>
            <p className="mt-1 text-[13px] text-muted">
              {photos.length} photos found
            </p>
          </div>

          <Link
            href="/search"
            className="flex w-fit items-center gap-2 rounded-lg border border-border bg-white px-4 py-3 text-[13px] font-medium text-dark transition-colors hover:border-brand"
          >
            <Image
              src="/images/search-again.svg"
              alt=""
              width={18}
              height={18}
            />
            Search again
          </Link>
        </div>

        {/* Photo grid */}
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 md:mt-10">
          {photos.map((photo) => (
            <div key={photo.id} className="overflow-hidden rounded-lg">
              {/* Clickable photo */}
              <button
                onClick={() => setSelectedPhoto(photo)}
                className="relative block w-full overflow-hidden rounded-lg transition-opacity hover:opacity-95"
              >
                <div className="relative aspect-[400/478]">
                  <Image
                    src={photo.src}
                    alt={photo.title}
                    fill
                    className="rounded-lg object-cover"
                  />
                </div>
              </button>

              {/* Info row */}
              <div className="mt-3 flex items-center justify-between">
                <p className="text-[13px] font-medium text-dark">
                  {photo.title}
                </p>
                <a
                  href={photo.src}
                  download
                  className="flex items-center gap-1.5 rounded-md border border-border bg-white px-3 py-2 text-[12px] font-medium text-dark transition-colors hover:border-brand"
                >
                  <Image
                    src="/images/download.svg"
                    alt=""
                    width={17}
                    height={17}
                  />
                  Download
                </a>
              </div>
            </div>
          ))}
        </div>
      </main>

      <Footer />

      {/* Photo preview modal */}
      <PhotoPreviewModal
        isOpen={!!selectedPhoto}
        onClose={() => setSelectedPhoto(null)}
        photo={selectedPhoto}
      />
    </div>
  );
}
