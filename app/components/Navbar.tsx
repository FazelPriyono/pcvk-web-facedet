import Link from "next/link";

interface NavbarProps {
  /** Which nav item is currently active */
  active?: "home" | "register" | "checkin";
}

export default function Navbar({ active = "home" }: NavbarProps) {
  return (
    <nav className="w-full bg-[#f8f9fa] border-b border-[#e3e7ed]">
      <div className="mx-auto flex h-[76px] max-w-[1248px] items-center justify-between px-6 md:h-[88px] md:px-0">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-1 group">
          <span className="text-[24px] font-bold tracking-[-1.4px] text-[#172337] md:text-[28px]">
            Playon
          </span>
          <span className="mt-4 h-[5px] w-[5px] rounded-full bg-[#356bff]" />
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-4 sm:gap-6 text-[13px] md:text-[14px]">
          <Link
            href="/"
            className={
              active === "home"
                ? "font-semibold text-[#172337]"
                : "text-[#667085] hover:text-[#172337] transition-colors"
            }
          >
            Home
          </Link>
          <Link
            href="/register"
            className={
              active === "register"
                ? "font-semibold text-[#356bff]"
                : "text-[#667085] hover:text-[#172337] transition-colors"
            }
          >
            Registrasi Peserta
          </Link>
          <Link
            href="/check-in"
            className={`px-3.5 py-1.5 rounded-lg transition-colors text-[13px] md:text-[14px] ${
              active === "checkin"
                ? "bg-[#356bff] text-white font-medium"
                : "bg-white border border-[#e3e7ed] text-[#172337] hover:border-[#356bff]"
            }`}
          >
            Check-in Hari-H
          </Link>
        </div>
      </div>
    </nav>
  );
}
