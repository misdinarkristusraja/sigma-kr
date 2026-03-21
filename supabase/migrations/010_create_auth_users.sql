-- ================================================================
-- SIGMA Migration 010: Buat auth.users untuk semua anggota
-- 
-- MASALAH: 131 anggota ada di public.users tapi TIDAK ADA di
-- auth.users → tidak ada yang bisa login sama sekali
--
-- FIX: INSERT ke auth.users untuk semua anggota yang missing
-- Password default: sigma + 6 digit pertama MyID
-- Contoh: MyID = "A1B2C3D4E5" → password = "sigmaA1B2C3"
--
-- Jalankan SELURUH script ini di Supabase SQL Editor
-- ================================================================

-- ── STEP 1: Buat auth.users untuk semua anggota yang missing ───

INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  aud,
  role,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  confirmation_token,
  email_change_token_new,
  recovery_token
)
SELECT
  pu.id,
  '00000000-0000-0000-0000-000000000000'::uuid,
  pu.email,
  -- Password default: "sigma" + 6 karakter pertama MyID
  -- Contoh MyID "A1B2C3D4E5" → password "sigmaA1B2C3"
  crypt('sigma' || LEFT(pu.myid, 6), gen_salt('bf', 10)),
  NOW(),    -- email_confirmed_at: langsung confirmed
  NOW(),
  NOW(),
  'authenticated',
  'authenticated',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  false,
  '',
  '',
  ''
FROM public.users pu
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users au WHERE au.id = pu.id
)
AND pu.status IN ('Active', 'Pending');

-- Lihat hasilnya
SELECT 'Akun dibuat: ' || COUNT(*) AS hasil
FROM auth.users au
JOIN public.users pu ON pu.id = au.id
WHERE pu.status IN ('Active', 'Pending');


-- ── STEP 2: Verifikasi semua sudah ada ─────────────────────────

SELECT
  COUNT(*) FILTER (WHERE au.id IS NULL)       AS masih_missing,
  COUNT(*) FILTER (WHERE au.id IS NOT NULL)   AS sudah_ada,
  COUNT(*)                                     AS total_anggota
FROM public.users pu
LEFT JOIN auth.users au ON au.id = pu.id
WHERE pu.status IN ('Active', 'Pending');

-- Kalau masih_missing = 0 → semua sudah dibuat ✅


-- ── STEP 3: Tampilkan daftar password default per anggota ──────
-- Screenshot ini untuk arsip / kirim ke anggota

SELECT
  pu.nickname,
  pu.nama_panggilan,
  pu.email,
  'sigma' || LEFT(pu.myid, 6) AS password_default,
  pu.myid
FROM public.users pu
WHERE pu.status = 'Active'
ORDER BY pu.nama_panggilan;


-- ── STEP 4: Tandai semua anggota wajib ganti password ──────────

UPDATE public.users
SET must_change_password = TRUE,
    updated_at = NOW()
WHERE status = 'Active';

SELECT 'must_change_password=true: ' || COUNT(*) || ' anggota' AS hasil
FROM public.users WHERE must_change_password = TRUE;


-- ── STEP 5: Test 1 akun manual ─────────────────────────────────
-- Cek apakah hash password akun 'satrio' sudah benar

SELECT
  pu.nickname,
  pu.email,
  LEFT(pu.myid, 6)                        AS myid_prefix,
  'sigma' || LEFT(pu.myid, 6)             AS password_default,
  au.email_confirmed_at IS NOT NULL       AS confirmed,
  au.encrypted_password IS NOT NULL       AS has_password,
  LEFT(au.encrypted_password, 7)          AS hash_prefix
FROM public.users pu
JOIN auth.users au ON au.id = pu.id
WHERE pu.nickname = 'satrio';
