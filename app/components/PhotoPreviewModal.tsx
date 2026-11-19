"use client";

import Image from "next/image";

interface PhotoPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  photo: {
    src: string;
    title: string;
    event: string;
  } | null;
}

export default function PhotoPreviewModal({
  isOpen,
  onClose,
  photo,
}: PhotoPreviewModalProps) {
  if (!isOpen || !photo) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-dark/70 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[1000px] overflow-hidden rounded-xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-7 pt-4 pb-2">
          <p className="text-[15px] font-semibold text-dark">{photo.title}</p>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-bg transition-colors hover:bg-border"
          >
            <Image
              src="/images/close.svg"
              alt="Close"
              width={20}
              height={20}
            />
          </button>
        </div>

        {/* Photo */}
        <div className="relative mx-6 aspect-[952/594] overflow-hidden rounded-md">
          <Image
            src={photo.src}
            alt={photo.title}
            fill
            className="object-contain"
          />
        </div>

        {/* Footer */}
        <div className="flex items-end justify-between px-7 py-4">
          <div>
            <p className="text-[14px] font-medium text-dark">{photo.event}</p>
            <p className="text-[11px] text-muted">Original resolution</p>
          </div>
          <a
            href={photo.src}
            download
            className="flex items-center gap-2 rounded-lg bg-brand px-5 py-3 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            <Image
              src="/images/download-white.svg"
              alt=""
              width={18}
              height={18}
            />
            Download photo
          </a>
        </div>
      </div>
    </div>
  );
}
