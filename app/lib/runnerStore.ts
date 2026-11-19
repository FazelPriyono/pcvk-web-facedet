export interface Runner {
  id: string;
  bib: string;
  fullName: string;
  email: string;
  phone: string;
  category: "5K" | "10K" | "21K Half Marathon" | "42K Full Marathon";
  bloodType: string;
  emergencyContact: string;
  registeredAt: string;
  photoUrl: string;
  checkedIn: boolean;
  checkedInAt?: string;
}

const STORAGE_KEY = "pelayon_registered_runners";

// Initial sample data so check-in can be tested right away
const INITIAL_RUNNERS: Runner[] = [
  {
    id: "run-1",
    bib: "PLY-10K-0142",
    fullName: "Dimas Pratama",
    email: "dimas.pratama@example.com",
    phone: "081234567890",
    category: "10K",
    bloodType: "O",
    emergencyContact: "081298765432 (Istri)",
    registeredAt: "2026-11-18 09:30",
    photoUrl: "/images/race-photo-1.png",
    checkedIn: false,
  },
  {
    id: "run-2",
    bib: "PLY-21K-089",
    fullName: "Siti Rahmawati",
    email: "siti.rahma@example.com",
    phone: "081398765432",
    category: "21K Half Marathon",
    bloodType: "A",
    emergencyContact: "081311223344 (Kakak)",
    registeredAt: "2026-11-18 10:15",
    photoUrl: "/images/race-photo-2.png",
    checkedIn: false,
  },
  {
    id: "run-3",
    bib: "PLY-42K-0027",
    fullName: "Budi Santoso",
    email: "budi.santoso@example.com",
    phone: "081765432109",
    category: "42K Full Marathon",
    bloodType: "B",
    emergencyContact: "081799887766 (Ibu)",
    registeredAt: "2026-11-18 11:00",
    photoUrl: "/images/race-photo-3.png",
    checkedIn: false,
  },
];

export function getRunners(): Runner[] {
  if (typeof window === "undefined") return INITIAL_RUNNERS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_RUNNERS));
      return INITIAL_RUNNERS;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_RUNNERS;
  }
}

export function saveRunner(runner: Runner): void {
  if (typeof window === "undefined") return;
  const runners = getRunners();
  runners.unshift(runner);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(runners));
}

export function markRunnerCheckIn(bibOrId: string): Runner | null {
  if (typeof window === "undefined") return null;
  const runners = getRunners();
  const target = runners.find(
    (r) =>
      r.bib.toLowerCase() === bibOrId.toLowerCase() ||
      r.id.toLowerCase() === bibOrId.toLowerCase()
  );
  if (!target) return null;

  target.checkedIn = true;
  target.checkedInAt = new Date().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  localStorage.setItem(STORAGE_KEY, JSON.stringify(runners));
  return target;
}

export function generateBibNumber(category: Runner["category"]): string {
  const prefix = category.includes("5K")
    ? "5K"
    : category.includes("10K")
    ? "10K"
    : category.includes("21K")
    ? "21K"
    : "42K";
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `PLY-${prefix}-${randomNum}`;
}
