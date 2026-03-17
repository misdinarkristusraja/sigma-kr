# 🚀 SIGMA — Panduan Deployment Lengkap
## Sistem Informasi Penjadwalan & Manajemen Misdinar
### Paroki Kristus Raja Solo Baru | v1.2 Final

---

## 📋 RINGKASAN STACK

| Komponen | Teknologi | Biaya |
|----------|-----------|-------|
| Frontend | React.js + Vite + Tailwind CSS | Gratis |
| Backend/DB | Supabase (PostgreSQL + Auth + Storage) | **Gratis (Free Tier)** |
| Hosting | Vercel | **Gratis (Free Tier)** |
| CI/CD | GitHub Actions | **Gratis** |
| QR Scanner | jsQR (browser-based) | Gratis |
| Export | html-to-image + jsPDF + SheetJS | Gratis |
| **Total** | | **Rp 0/bulan** |

---

## 📦 PRASYARAT

Sebelum memulai, pastikan kamu sudah install:
- **Node.js** v18+ → [nodejs.org](https://nodejs.org)
- **Git** → [git-scm.com](https://git-scm.com)
- **npm** (sudah termasuk dengan Node.js)
- **Supabase CLI** (opsional, untuk deploy Edge Functions)

```bash
# Cek versi Node.js
node --version   # harus v18+
npm --version    # harus v9+
```

---

## TAHAP 1 — SETUP SUPABASE

### 1.1 Buat Akun & Project Supabase

1. Buka **[supabase.com](https://supabase.com)** → klik **Start your project**
2. Sign up dengan GitHub atau email
3. Klik **New Project**:
   - **Organization**: pilih organisasi kamu
   - **Name**: `sigma-krsoba`
   - **Database Password**: buat password kuat dan **simpan baik-baik!**
   - **Region**: pilih `Southeast Asia (Singapore)` — paling dekat
4. Tunggu ±2 menit hingga project siap

### 1.2 Ambil API Keys

Setelah project siap:
1. Buka **Project Settings** (ikon gear di sidebar kiri)
2. Klik **API**
3. Catat dua nilai ini:
   - **Project URL** → contoh: `https://abcdefgh.supabase.co`
   - **anon public key** → string panjang diawali `eyJhbG...`

> ⚠️ **Jangan share service_role key ke siapapun!**

### 1.3 Jalankan Migrasi Database

1. Di Supabase Dashboard → klik **SQL Editor** (ikon database)
2. Klik **New query**
3. Buka file `supabase/migrations/001_initial_schema.sql` dari project ini
4. **Copy semua isinya** dan paste ke SQL Editor
5. Klik **Run** (Ctrl+Enter)
6. Pastikan muncul pesan: `Success. No rows returned`

> ✅ Semua tabel, RLS, fungsi, dan konfigurasi default sudah terbuat.

### 1.4 Buat Storage Buckets

Masih di SQL Editor, jalankan query ini:

```sql
-- Buat storage buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('documents',      'documents',      FALSE, 2097152,  ARRAY['application/pdf']),
  ('exports',        'exports',        FALSE, 10485760, ARRAY['image/png','application/pdf']),
  ('profile-photos', 'profile-photos', FALSE, 1048576,  ARRAY['image/jpeg','image/png','image/webp']);

-- Storage policies
CREATE POLICY "Authenticated users can upload documents"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'documents' AND auth.uid() IS NOT NULL);

CREATE POLICY "Users can read own documents"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'documents' AND auth.uid() IS NOT NULL);

CREATE POLICY "Admin can read all documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents' AND
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus'))
  );
```

### 1.5 Setup pg_cron (Rekap Harian 19:00 WIB)

```sql
-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Jadwal rekap poin setiap hari jam 19:00 WIB (12:00 UTC)
SELECT cron.schedule(
  'sigma-rekap-harian',
  '0 12 * * *',
  $$
  SELECT
    net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/cron-rekap',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Jadwal ping anti-pause setiap 3 hari jam 08:00 WIB (01:00 UTC)
SELECT cron.schedule(
  'sigma-ping',
  '0 1 */3 * *',
  $$SELECT net.http_post(url := current_setting('app.supabase_url') || '/functions/v1/supabase-ping', headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')), body := '{}'::jsonb);$$
);
```

> 📌 Jika pg_cron tidak tersedia di Free Tier, gunakan **GitHub Actions** sebagai alternatif (lihat Tahap 4.3).

### 1.6 Deploy Edge Functions

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link project (ganti dengan Project ID kamu)
supabase link --project-ref SUPABASE_PROJECT_ID

# Deploy semua Edge Functions
supabase functions deploy cron-rekap
supabase functions deploy fetch-gcatholic
supabase functions deploy supabase-ping
```

### 1.7 Buat Akun Admin Pertama

1. Di Supabase Dashboard → **Authentication** → **Users** → **Add user**
2. Isi email admin dan password kuat
3. Copy **User ID** (format UUID)
4. Buka SQL Editor dan jalankan:

```sql
-- Ganti nilai UUID dan email sesuai akun yang kamu buat
INSERT INTO users (
  id, nickname, myid, nama_lengkap, nama_panggilan,
  lingkungan, email, role, status
) VALUES (
  'UUID-DARI-AUTH-USER',    -- ganti dengan UUID dari step 2
  'admin',
  'ADMIN00001',
  'Administrator SIGMA',
  'Admin',
  'Administratif',
  'admin@sigma.krsoba.id',  -- ganti dengan email kamu
  'Administrator',
  'Active'
);
```

---

## TAHAP 2 — SETUP PROJECT LOKAL

### 2.1 Clone / Setup Project

Jika dari repo GitHub:
```bash
git clone https://github.com/YOUR_ORG/sigma-krsoba.git
cd sigma-krsoba
```

Atau jika dari folder ini langsung:
```bash
cd sigma-app
```

### 2.2 Install Dependencies

```bash
npm install
```

> Proses ini menginstall semua library: React, Supabase client, jsQR, html-to-image, dll.

### 2.3 Buat File Environment

```bash
# Salin template
cp .env.example .env.local

# Edit dengan text editor
nano .env.local
# atau
code .env.local
```

Isi nilai-nilainya:

```env
VITE_SUPABASE_URL=https://NAMAPROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_APP_URL=https://sigma.krsoba.id
VITE_MYID_SALT=buat-string-acak-panjang-rahasia-2026
VITE_ENV=development
```

> ⚠️ **PENTING**: `VITE_MYID_SALT` harus string acak yang kamu buat sendiri dan tidak boleh diganti setelah ada data. Salt ini digunakan untuk generate MyID/CheckSum.

### 2.4 Jalankan Development Server

```bash
npm run dev
```

Buka browser: **[http://localhost:5173](http://localhost:5173)**

Login dengan akun admin yang kamu buat di Tahap 1.7.

### 2.5 Test Fitur Utama

Sebelum deploy, test minimal:
- [ ] Login dengan akun admin
- [ ] Buka halaman Anggota
- [ ] Test halaman Scan QR (izinkan kamera)
- [ ] Coba generate kartu anggota
- [ ] Buka halaman publik `/jadwal`

---

## TAHAP 3 — PUSH KE GITHUB

### 3.1 Buat Repository GitHub

1. Buka **[github.com](https://github.com)** → klik **New repository**
2. Nama: `sigma-krsoba`
3. **Private** (disarankan untuk keamanan data)
4. Jangan centang "Initialize with README"
5. Klik **Create repository**

### 3.2 Push Code

```bash
# Di folder sigma-app
git init
git add .
git commit -m "feat: SIGMA v1.2 initial commit"

# Ganti dengan URL repo kamu
git remote add origin https://github.com/USERNAME/sigma-krsoba.git
git branch -M main
git push -u origin main
```

### 3.3 Setup GitHub Secrets (untuk CI/CD)

Di GitHub → repo kamu → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret Name | Nilai |
|-------------|-------|
| `VITE_SUPABASE_URL` | URL Supabase project kamu |
| `VITE_SUPABASE_ANON_KEY` | Anon key Supabase |
| `VITE_APP_URL` | Domain produksi: `https://sigma.krsoba.id` |
| `VITE_MYID_SALT` | Salt yang sama dengan .env.local |
| `VERCEL_TOKEN` | (diisi setelah setup Vercel — Tahap 4) |
| `VERCEL_ORG_ID` | (diisi setelah setup Vercel) |
| `VERCEL_PROJECT_ID` | (diisi setelah setup Vercel) |

---

## TAHAP 4 — DEPLOY KE VERCEL

### 4.1 Buat Akun Vercel

1. Buka **[vercel.com](https://vercel.com)** → **Sign up with GitHub**
2. Authorize Vercel untuk akses GitHub

### 4.2 Import Project

1. Di Vercel Dashboard → klik **Add New Project**
2. Pilih repository `sigma-krsoba` dari GitHub
3. Framework: **Vite** (Vercel biasanya auto-detect)
4. **Environment Variables** — tambahkan semua dari .env.local:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_APP_URL`
   - `VITE_MYID_SALT`
5. Klik **Deploy**

Vercel akan build dan deploy otomatis. Tunggu ±1-2 menit.

Setelah selesai, kamu akan mendapat URL seperti: `sigma-krsoba.vercel.app`

### 4.3 Setup Custom Domain (Opsional)

1. Di Vercel → project kamu → **Settings** → **Domains**
2. Tambahkan domain: `sigma.krsoba.id`
3. Di DNS provider (Cloudflare/Niagahoster/dll), tambahkan:
   ```
   Type: CNAME
   Name: sigma
   Value: cname.vercel-dns.com
   ```
4. Tunggu propagasi DNS (5-30 menit)

### 4.4 Ambil Vercel IDs untuk GitHub Actions

```bash
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Link project
cd sigma-app
vercel link

# Ambil project info
cat .vercel/project.json
```

Isi `VERCEL_ORG_ID` dan `VERCEL_PROJECT_ID` di GitHub Secrets.

Untuk `VERCEL_TOKEN`:
- Buka [vercel.com/account/tokens](https://vercel.com/account/tokens)
- Buat token baru → copy dan isi di GitHub Secrets

### 4.5 Alternatif Cron: GitHub Actions (jika pg_cron tidak tersedia)

Buat file `.github/workflows/cron.yml`:

```yaml
name: SIGMA Cron Jobs

on:
  schedule:
    # Setiap hari jam 19:00 WIB = 12:00 UTC
    - cron: '0 12 * * *'
    # Ping Supabase setiap 3 hari jam 08:00 WIB = 01:00 UTC
    - cron: '0 1 */3 * *'

jobs:
  rekap-harian:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger rekap poin
        run: |
          curl -X POST \
            "${{ secrets.VITE_SUPABASE_URL }}/functions/v1/cron-rekap" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
            -H "Content-Type: application/json"

  supabase-ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping Supabase
        run: |
          curl -X POST \
            "${{ secrets.VITE_SUPABASE_URL }}/functions/v1/supabase-ping" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}"
```

Tambahkan `SUPABASE_SERVICE_ROLE_KEY` ke GitHub Secrets.

---

## TAHAP 5 — KONFIGURASI PASCA DEPLOYMENT

### 5.1 Update Supabase Auth Settings

Di Supabase → **Authentication** → **URL Configuration**:

```
Site URL: https://sigma.krsoba.id
Additional Redirect URLs:
  https://sigma.krsoba.id/**
  https://sigma-krsoba.vercel.app/**
  http://localhost:5173/**
```

### 5.2 Test Production

1. Buka `https://sigma.krsoba.id`
2. Login dengan akun admin
3. Test scan QR di mobile (Chrome/Safari)
4. Test generate kartu anggota
5. Test export PNG jadwal

### 5.3 Tambah Anggota Pertama

Minta misdinar untuk daftar di: `https://sigma.krsoba.id/daftar`

Atau buat manual via Admin:
1. Login sebagai Administrator
2. Buka `/admin` → **User & Role** → tambah
3. Atau buka SQL Editor di Supabase dan insert langsung

### 5.4 Import Data Historis

1. Login sebagai Administrator
2. Buka menu **Migrasi Data**
3. Pilih jenis migrasi (mulai dari **Anggota**)
4. Upload file Excel sesuai format
5. **Selalu jalankan Dry Run** terlebih dahulu!
6. Download error report jika ada masalah
7. Jalankan Import setelah yakin

Urutan yang disarankan:
1. Anggota (Member Management.xlsx)
2. Registrasi (responses.xlsx - resp_regis)
3. Absensi (responses.xlsx - resp_absen)
4. Tukar Jadwal (responses.xlsx - resp_swap)

---

## TAHAP 6 — MAINTENANCE

### 6.1 Backup Manual (Wajib tiap 90 hari)

1. Login sebagai Administrator
2. Buka **Admin & Config**
3. Klik **Backup Manual**
4. File JSON akan terdownload
5. Upload ke Google Drive paroki

Atau via SQL (lebih lengkap):
```bash
# Di terminal, gunakan supabase CLI
supabase db dump -f sigma-backup-$(date +%Y%m%d).sql
```

### 6.2 Monitor Penggunaan Free Tier

Cek secara berkala di Supabase Dashboard:
- **Storage**: target < 800MB (limit 1GB)
- **Database**: target < 400MB (limit 500MB)
- **Edge Function invocations**: target < 400K/bulan (limit 500K)

Jika mendekati limit, hapus file PNG/PDF lama dari storage:
```sql
-- Lihat file terbesar di storage
SELECT name, metadata->>'size' as size
FROM storage.objects
WHERE bucket_id = 'exports'
ORDER BY metadata->>'size' DESC
LIMIT 20;
```

### 6.3 Update Aplikasi

Setiap update kode di branch `main` akan otomatis deploy ke Vercel melalui GitHub Actions.

```bash
# Development → staging (PR)
git checkout -b feature/nama-fitur
# ... kerjakan fitur ...
git add .
git commit -m "feat: tambah fitur X"
git push origin feature/nama-fitur
# Buat Pull Request di GitHub

# Setelah review → merge ke main → auto-deploy!
```

### 6.4 Troubleshooting Umum

| Masalah | Solusi |
|---------|--------|
| Supabase project di-pause | Cek ping cron, atau upgrade ke Pro |
| QR scan tidak bisa | Pastikan HTTPS aktif, izinkan kamera di browser |
| Login gagal | Cek Supabase Auth URL configuration |
| gcatholic.org tidak bisa diakses | Perayaan bisa diisi manual di draft |
| Export PNG gagal | Coba di Chrome desktop, disable ad-blocker |
| Upload PDF gagal | Pastikan ukuran < 2MB, format PDF valid |
| Rekap tidak update | Cek status cron job di Supabase atau GitHub Actions |

---

## 📁 STRUKTUR FILE PROJECT

```
sigma-app/
├── src/
│   ├── components/
│   │   ├── layout/          # Layout, Sidebar, Topbar
│   │   └── ui/              # LoadingScreen, dll
│   ├── contexts/
│   │   └── AuthContext.jsx  # Auth state & helpers
│   ├── lib/
│   │   ├── supabase.js      # Supabase client
│   │   └── utils.js         # Helper functions, formula poin
│   └── pages/
│       ├── LoginPage.jsx
│       ├── RegisterPage.jsx      # Form daftar publik
│       ├── DashboardPage.jsx     # Home dengan stats
│       ├── MembersPage.jsx       # Manajemen anggota
│       ├── MemberDetailPage.jsx  # Detail 1 anggota
│       ├── ScheduleWeeklyPage.jsx # Jadwal mingguan + generate + WA
│       ├── ScheduleDailyPage.jsx  # Jadwal harian + opt-in
│       ├── ScanPage.jsx          # QR scanner + auto-return
│       ├── SwapPage.jsx          # Tukar jadwal + papan penawaran
│       ├── RecapPage.jsx         # Rekap poin + grafik
│       ├── LeaderboardPage.jsx   # Leaderboard podium
│       ├── CardsPage.jsx         # Generator kartu anggota
│       ├── MigrationPage.jsx     # Import Excel
│       └── AdminPage.jsx         # Config + user management
│
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql  # SEMUA tabel + RLS + functions
│   └── functions/
│       ├── cron-rekap/          # Update poin 19:00 WIB
│       ├── fetch-gcatholic/     # Proxy liturgi gcatholic.org
│       └── supabase-ping/       # Anti-pause free tier
│
├── .github/workflows/
│   └── deploy.yml               # CI/CD ke Vercel
│
├── vercel.json                  # Vercel routing + headers
├── vite.config.js               # Vite + PWA config
├── tailwind.config.js           # Tema warna SIGMA
├── .env.example                 # Template environment vars
└── DEPLOYMENT.md                # File ini
```

---

## 🔐 CHECKLIST KEAMANAN

Sebelum go-live, pastikan:

- [ ] `VITE_MYID_SALT` sudah di-set dengan string acak yang kuat (min 32 karakter)
- [ ] Supabase RLS sudah aktif di semua tabel (jalankan migration SQL)
- [ ] Storage buckets diset `public: false` (private)
- [ ] Custom domain menggunakan HTTPS (otomatis di Vercel)
- [ ] Tidak ada `console.log` yang mencetak data sensitif di production
- [ ] `.env.local` tidak di-commit ke GitHub (sudah ada di `.gitignore`)
- [ ] Akun Administrator menggunakan password kuat (min 12 karakter)
- [ ] Audit Log aktif untuk semua operasi admin

---

## 📞 KONTAK & SUPPORT

Jika ada masalah teknis:
- **Pendamping IT Paroki**: hubungi via WhatsApp grup pengurus
- **Dokumentasi Supabase**: [supabase.com/docs](https://supabase.com/docs)
- **Dokumentasi Vercel**: [vercel.com/docs](https://vercel.com/docs)

---

*SIGMA v1.2 | Paroki Kristus Raja Solo Baru | 16 Maret 2026*
*"Serve the Lord with Gladness"*
