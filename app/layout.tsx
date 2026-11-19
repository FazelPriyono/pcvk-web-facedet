import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pelayon — Find Your Race Moments",
  description:
    "You ran the race. Relive every moment. Find your event photos with just a selfie.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="antialiased">
      <body className="min-h-screen flex flex-col bg-[#f8f9fa] text-[#172337] font-sans">
        {children}
      </body>
    </html>
  );
}
