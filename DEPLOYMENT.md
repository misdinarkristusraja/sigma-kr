# 🚀 SIGMA — Panduan Deployment (Vercel UI, Tanpa CLI)
## Sistem Informasi Penjadwalan & Manajemen Misdinar
### Paroki Kristus Raja Solo Baru | v1.2 Final

> **Mode deployment: Vercel GitHub Integration (full UI, nol CLI)**
> Setiap `git push main` → Vercel otomatis build & deploy. Tidak perlu token, tidak perlu CLI.

---

## 📋 Stack & Biaya

| Komponen | Teknologi | Biaya |
|----------|-----------|-------|
| Frontend | React.js + Vite + Tailwind CSS | Gratis |
| Database + Auth + Storage | Supabase Free Tier | **Gratis** |
| Hosting + Auto-Deploy | Vercel Free Tier | **Gratis** |
| CI (build check) | GitHub Actions | **Gratis** |
| **Total** | | **Rp 0/bulan** |

---

## TAHAP 1 — SETUP SUPABASE

### 1.1 Buat Project

1. Buka **[supabase.com](https://supabase.com)** → **New Project**
2. Isi:
   - **Name**: `sigma-krsoba`
   - **Database Password**: buat yang kuat, **simpan di tempat aman**
   - **Region**: `Southeast Asia (Singapore)`
3. Tunggu ±2 menit hingga siap

### 1.2 Ambil API Keys

**Project Settings** (ikon ⚙️) → **API**:
- Catat **Project URL** → `https://xxxxx.supabase.co`
- Catat **anon public** key → `eyJhbG...`

### 1.3 Jalankan Migrasi Database

1. **SQL Editor** → **New query**
2. Buka file `supabase/migrations/001_initial_schema.sql`
3. Copy semua isi → Paste → klik **Run**
4. Pastikan: `Success. No rows returned`

### 1.4 Buat Storage Buckets

Jalankan di SQL Editor:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('documents',      'documents',      false, 2097152,  ARRAY['application/pdf']),
  ('exports',        'exports',        false, 10485760, ARRAY['image/png','application/pdf']),
  ('profile-photos', 'profile-photos', false, 1048576,  ARRAY['image/jpeg','image/png','image/webp']);

-- Policy: user yang login bisa upload
CREATE POLICY "auth upload documents"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id IN ('documents','exports','profile-photos') AND auth.uid() IS NOT NULL);

CREATE POLICY "auth read documents"
  ON storage.objects FOR SELECT
  USING (bucket_id IN ('documents','exports','profile-photos') AND auth.uid() IS NOT NULL);
```

### 1.5 Buat Akun Admin Pertama

1. **Authentication** → **Users** → **Add user**
2. Isi email & password admin → **Create user**
3. Copy **User UID** yang muncul
4. Jalankan SQL berikut (ganti nilainya):

```sql
INSERT INTO users (
  id, nickname, myid, nama_lengkap, nama_panggilan,
  lingkungan, email, role, status
) VALUES (
  'PASTE-USER-UID-DISINI',
  'admin',
  'ADMIN00001',
  'Administrator SIGMA',
  'Admin',
  'Administratif',
  'PASTE-EMAIL-DISINI',
  'Administrator',
  'Active'
);
```

---

## TAHAP 2 — PUSH KE GITHUB

### 2.1 Buat Repository

1. **[github.com](https://github.com)** → **New repository**
2. Nama: `sigma-krsoba` | **Private**
3. **Jangan** centang "Initialize with README"

### 2.2 Push Code

```bash
# Di folder sigma-app
git init
git add .
git commit -m "feat: SIGMA v1.2 initial commit"
git remote add origin https://github.com/USERNAME/sigma-krsoba.git
git branch -M main
git push -u origin main
```

---

## TAHAP 3 — CONNECT VERCEL (FULL UI)

### 3.1 Import Project ke Vercel

1. Buka **[vercel.com](https://vercel.com)** → login dengan GitHub
2. Klik **Add New Project**
3. Pilih repo `sigma-krsoba` → klik **Import**
4. Vercel otomatis deteksi framework: **Vite** ✓

### 3.2 Set Environment Variables di Vercel

Ini langkah **paling penting**. Di halaman import (sebelum deploy pertama):

Klik **Environment Variables** lalu tambahkan **satu per satu**:

| Name | Value |
|------|-------|
| `VITE_SUPABASE_URL` | `https://xxxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbG...` (anon key dari Supabase) |
| `VITE_APP_URL` | `https://sigma-krsoba.vercel.app` (bisa diubah setelah dapat URL) |
| `VITE_MYID_SALT` | buat string acak panjang, contoh: `krsoba-sigma-2026-xK9mP3rQwZ` |
| `VITE_ENV` | `production` |

> ⚠️ **`VITE_MYID_SALT` JANGAN PERNAH DIUBAH** setelah ada data anggota. Salt ini dipakai untuk generate MyID/CheckSum semua anggota.

### 3.3 Deploy Pertama

Klik **Deploy**. Vercel akan:
1. Clone repo dari GitHub
2. Jalankan `npm install`
3. Jalankan `npm run build` dengan env vars yang sudah diset
4. Deploy ke CDN global

Tunggu ±1-2 menit. Selesai! ✅

### 3.4 Cara Kerja Auto-Deploy Selanjutnya

```
Kamu edit kode → git push main → Vercel otomatis detect push 
→ build ulang → deploy → selesai dalam ~1 menit
```

**Tidak perlu action manual apapun.**

### 3.5 Custom Domain (Opsional)

1. Vercel Dashboard → project → **Settings** → **Domains**
2. Tambah: `sigma.krsoba.id`
3. Di DNS provider (Cloudflare/Niagahoster), tambahkan:
   ```
   Type : CNAME
   Name : sigma
   Value: cname.vercel-dns.com
   ```
4. Vercel otomatis provisioning SSL (Let's Encrypt)
5. Update env var `VITE_APP_URL` ke `https://sigma.krsoba.id`

---

## TAHAP 4 — SETUP CRON JOBS (Rekap Poin Harian)

Karena tidak pakai CLI, cron dihandle oleh **GitHub Actions** secara otomatis.

### 4.1 Tambah Secrets di GitHub

**GitHub repo** → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret | Nilai |
|--------|-------|
| `VITE_SUPABASE_URL` | URL Supabase |
| `VITE_SUPABASE_ANON_KEY` | Anon key |
| `VITE_APP_URL` | URL produksi |
| `VITE_MYID_SALT` | Salt yang sama |
| `SUPABASE_SERVICE_ROLE_KEY` | **Service role key** dari Supabase Settings → API → service_role (**RAHASIA!**) |

### 4.2 Deploy Edge Functions ke Supabase

> **Cara termudah tanpa CLI**: Pakai Supabase Dashboard → **Edge Functions** → **New Function**

Untuk setiap fungsi di folder `supabase/functions/`:

1. **Edge Functions** → **New Function**
2. Nama: `cron-rekap` (lalu ulangi untuk `fetch-gcatholic` dan `supabase-ping`)
3. Copy-paste isi file TypeScript-nya → **Deploy**

Atau jika mau pakai CLI sekali saja:
```bash
npx supabase@latest functions deploy cron-rekap --project-ref YOUR_PROJECT_REF
npx supabase@latest functions deploy fetch-gcatholic --project-ref YOUR_PROJECT_REF
npx supabase@latest functions deploy supabase-ping --project-ref YOUR_PROJECT_REF
```
> `YOUR_PROJECT_REF` = bagian setelah `https://` di URL Supabase, contoh: `abcdefghijklmn`

### 4.3 Cron Otomatis via GitHub Actions

File `.github/workflows/cron.yml` sudah ada di project. Setelah secrets diisi, cron akan:
- **Setiap hari 19:00 WIB** → update rekap poin semua anggota
- **Setiap 3 hari** → ping Supabase agar project tidak di-pause

Bisa juga trigger manual: **GitHub** → **Actions** → **SIGMA — Cron Jobs** → **Run workflow**

---

## TAHAP 5 — MIGRASI DATA HISTORIS

1. Login ke aplikasi sebagai Administrator
2. Buka menu **Migrasi Data**
3. Urutan import yang benar:
   1. **Anggota** (Member Management.xlsx)
   2. **Registrasi** (responses.xlsx sheet resp_regis)
   3. **Absensi** (responses.xlsx sheet resp_absen)
   4. **Tukar Jadwal** (responses.xlsx sheet resp_swap)
4. **SELALU jalankan Dry Run** sebelum import!
5. Download error report jika ada baris yang gagal

---

## TAHAP 6 — CHECKLIST SEBELUM GO-LIVE

- [ ] Login berhasil dengan akun admin
- [ ] Halaman publik `/jadwal` bisa diakses tanpa login
- [ ] Halaman `/daftar` bisa diakses tanpa login
- [ ] Scan QR berfungsi di Chrome Android & Safari iOS (butuh HTTPS ✓)
- [ ] Generate kartu anggota berhasil (PNG merah & krem)
- [ ] Migrasi data historis selesai tanpa error
- [ ] Cron job rekap bisa di-trigger manual
- [ ] Storage buckets aktif (test upload PDF surat pernyataan)
- [ ] Backup manual berhasil dari halaman Admin

---

## TROUBLESHOOTING

### Build gagal di Vercel

**Cek di**: Vercel Dashboard → project → **Deployments** → klik deployment merah → lihat **Build Logs**

Penyebab umum:
| Error | Solusi |
|-------|--------|
| `VITE_SUPABASE_URL is not defined` | Set env var di Vercel Dashboard |
| `Cannot find module '...'` | Hapus `node_modules`, push ulang |
| `Build exceeded size limit` | Normal jika < 100MB — abaikan warning |
| `SyntaxError in ...` | Ada typo di kode, cek baris yang disebutkan |

### Auto-deploy tidak jalan

1. Vercel Dashboard → project → **Settings** → **Git**
2. Pastikan **Connected Git Repository** sudah menunjuk repo yang benar
3. Pastikan **Production Branch** = `main`
4. Coba **Redeploy** secara manual dari Deployments tab

### Supabase free tier di-pause

Tanda: API semua return 503 / koneksi timeout

Solusi:
1. Buka Supabase Dashboard → project kamu → klik **Restore** jika ada tombol
2. Pastikan cron GitHub Actions berjalan (cek tab Actions)
3. Atau upgrade ke Supabase Pro ($25/bln) untuk production serius

### QR scan tidak bisa di HP

- Wajib **HTTPS** — Vercel otomatis provide SSL ✓
- Izinkan akses kamera di browser saat muncul prompt
- Gunakan **Chrome** di Android atau **Safari** di iPhone
- Jika di Safari iOS: Settings → Safari → Camera → Allow

---

## STRUKTUR FILE PROJECT

```
sigma-app/
├── src/
│   ├── App.jsx                    # Routing utama + ProtectedRoute
│   ├── main.jsx                   # Entry point React
│   ├── index.css                  # Global styles + Tailwind utilities
│   ├── contexts/
│   │   └── AuthContext.jsx        # Auth state (login, role, profile)
│   ├── lib/
│   │   ├── supabase.js            # Supabase client
│   │   └── utils.js               # Helper: poin formula, QR parser, date
│   ├── components/
│   │   ├── layout/Layout.jsx      # Sidebar + mobile topbar
│   │   └── ui/LoadingScreen.jsx   # Loading spinner
│   └── pages/
│       ├── LoginPage.jsx          # Login username/email
│       ├── RegisterPage.jsx       # Form daftar publik + typeahead sekolah
│       ├── DashboardPage.jsx      # Home: stats, jadwal, swap board
│       ├── MembersPage.jsx        # CRUD anggota + approve registrasi
│       ├── MemberDetailPage.jsx   # Profil detail 1 anggota
│       ├── ScheduleWeeklyPage.jsx # Generate jadwal mingguan + WA template
│       ├── ScheduleDailyPage.jsx  # Jadwal harian + opt-in window
│       ├── ScanPage.jsx           # QR scanner + auto-return 3 detik
│       ├── SwapPage.jsx           # Tukar jadwal + papan penawaran
│       ├── RecapPage.jsx          # Rekap poin 6 kondisi + grafik
│       ├── LeaderboardPage.jsx    # Ranking podium mingguan & harian
│       ├── CardsPage.jsx          # Generator kartu merah + krem
│       ├── MigrationPage.jsx      # Import Excel + dry run + error report
│       └── AdminPage.jsx          # Config sistem + role + audit log
│
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql # Semua tabel, RLS, fungsi PostgreSQL
│   └── functions/
│       ├── cron-rekap/            # Update poin harian 19:00 WIB
│       ├── fetch-gcatholic/       # Proxy fetch liturgi gcatholic.org
│       └── supabase-ping/         # Anti-pause free tier
│
├── .github/workflows/
│   ├── deploy.yml                 # Build check (deploy = Vercel otomatis)
│   └── cron.yml                   # Trigger cron rekap & ping
│
├── vercel.json                    # SPA routing + security headers
├── vite.config.js                 # Build config + PWA + chunk splitting
├── tailwind.config.js             # Tema warna brand-800 = #8B0000
├── eslint.config.js               # ESLint rules
├── package.json                   # Dependencies
└── .env.example                   # Template env vars
```

---

*SIGMA v1.2 | Paroki Kristus Raja Solo Baru | 16 Maret 2026*
*"Serve the Lord with Gladness"*
