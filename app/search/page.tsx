"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Navbar from "@/app/components/Navbar";
import Footer from "@/app/components/Footer";

export default function SearchPage() {
  const router = useRouter();
  const [selectedEvent, setSelectedEvent] = useState("City Marathon 2026");
  const [eventMenuOpen, setEventMenuOpen] = useState(false);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const events = [
    "City Marathon 2026",
    "Sunrise Run 2026",
    "Mountain Trail 2026",
  ];

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;
      if (file.size > 10 * 1024 * 1024) return; // 10MB limit
      setSelfieFile(file);
      const url = URL.createObjectURL(file);
      setSelfiePreview(url);
    },
    []
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleBrowse = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) handleFileSelect(file);
    };
    input.click();
  };

  const removeSelfie = () => {
    setSelfieFile(null);
    if (selfiePreview) URL.revokeObjectURL(selfiePreview);
    setSelfiePreview(null);
  };

  const handleSearch = () => {
    router.push("/results");
  };

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <Navbar active="find-photos" />

      <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col px-6 pb-12 pt-8 md:pt-14">
        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-1.52px] text-dark md:text-[38px]">
          Find Your Race Moments.
        </h1>
        <p className="mt-4 text-[14px] text-muted md:mt-5 md:text-[16px]">
          Choose your event. Add a selfie. That&apos;s it.
        </p>

        {/* Search card */}
        <div className="mt-6 rounded-xl border border-border bg-white p-6 md:mt-8 md:p-8">
          {/* Step 1 - Event */}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-brand">01</span>
              <span className="text-[15px] font-semibold text-dark">
                Choose your event
              </span>
            </div>

            <div className="relative mt-3">
              <button
                onClick={() => setEventMenuOpen(!eventMenuOpen)}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-white px-4 py-4 text-left transition-colors hover:border-brand"
              >
                <div className="flex items-center gap-3">
                  <Image
                    src="/images/calendar.svg"
                    alt=""
                    width={20}
                    height={20}
                  />
                  <span className="text-[14px] font-medium text-dark">
                    {selectedEvent}
                  </span>
                </div>
                <Image
                  src="/images/chevron-down.svg"
                  alt=""
                  width={20}
                  height={20}
                  className={`transition-transform ${eventMenuOpen ? "rotate-180" : ""}`}
                />
              </button>

              {eventMenuOpen && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-border bg-white shadow-lg">
                  {events.map((event) => (
                    <button
                      key={event}
                      onClick={() => {
                        setSelectedEvent(event);
                        setEventMenuOpen(false);
                      }}
                      className={`w-full px-4 py-3 text-left text-[14px] transition-colors hover:bg-bg ${
                        event === selectedEvent
                          ? "font-medium text-brand"
                          : "text-dark"
                      }`}
                    >
                      {event}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Step 2 - Selfie */}
          <div className="mt-6">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-brand">02</span>
              <span className="text-[15px] font-semibold text-dark">
                Upload your selfie
              </span>
            </div>
            <p className="mt-1 text-[13px] text-muted">
              Use a clear, front-facing photo of just you.
            </p>

            {/* Drop zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={handleBrowse}
              className={`mt-3 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 transition-colors md:py-7 ${
                isDragging
                  ? "border-brand bg-brand-light"
                  : "border-upload-border bg-upload-bg hover:border-brand"
              }`}
            >
              <Image
                src="/images/upload.svg"
                alt=""
                width={24}
                height={24}
              />
              <p className="mt-3 text-center text-[14px] font-medium text-dark">
                Drop your selfie here, or browse
              </p>
              <p className="mt-1 text-center text-[11px] text-muted">
                JPG or PNG · Max 10 MB
              </p>
            </div>

            {/* Selfie preview */}
            {selfieFile && selfiePreview && (
              <div className="mt-3 flex items-center gap-3 rounded-lg bg-bg p-3">
                <div className="relative h-14 w-12 shrink-0 overflow-hidden rounded-md">
                  <Image
                    src={selfiePreview}
                    alt="Selfie preview"
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="flex-1">
                  <p className="text-[12px] font-medium text-dark">
                    {selfieFile.name}
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleBrowse();
                    }}
                    className="text-[11px] font-medium text-brand hover:underline"
                  >
                    Replace
                  </button>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSelfie();
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-border"
                >
                  <Image
                    src="/images/remove.svg"
                    alt="Remove"
                    width={20}
                    height={20}
                  />
                </button>
              </div>
            )}
          </div>

          {/* Search button */}
          <button
            onClick={handleSearch}
            className="mt-6 w-full rounded-lg bg-brand py-4 text-center text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Search My Photos
          </button>
        </div>

        {/* Privacy notice */}
        <div className="mt-6 flex items-start gap-3 md:mt-8">
          <Image
            src="/images/privacy-lock.svg"
            alt=""
            width={15}
            height={15}
            className="mt-0.5 shrink-0"
          />
          <p className="text-[11px] leading-[1.45] text-muted">
            Your selfie is only used to find your photos.
            <br />
            Never shared. Never used for anything else.
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
