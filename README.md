This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## PCVK — Sistem Presensi Event Lari

Repo ini menggabungkan frontend dan backend dalam satu branch `integration`:

- `app/` — frontend Next.js (halaman register, check-in, riwayat absensi).
- `backend/` — API FastAPI + Neon PostgreSQL + Cloudinary (lihat `backend/README.md`).

### Menjalankan backend

```bash
cd backend
python -m venv venv          # sekali saja
venv\Scripts\activate        # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Salin `backend/.env.example` menjadi `backend/.env`, lalu isi `DATABASE_URL` dan tiga kredensial `CLOUDINARY_*` dari environment yang sama. Cek `GET http://localhost:8000/health`.

### Menjalankan frontend

```bash
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:8000

npm install
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000). Backend harus berjalan agar registrasi dan check-in tersimpan ke database.


## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
