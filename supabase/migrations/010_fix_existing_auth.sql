-- ================================================================
-- SIGMA Migration 010: Fix existing auth.users records
--
-- PENTING: Untuk MEMBUAT akun baru → gunakan tombol
-- "🚀 Provision Semua Akun" di AdminPage → tab Users
-- (menggunakan Supabase Admin API yang benar)
--
-- Script ini hanya fix record yang SUDAH ADA di auth.users:
-- - email_confirmed_at NULL
-- - aud/role salah
-- ================================================================

-- Fix akun yang sudah ada tapi email belum confirmed
UPDATE auth.users au
SET
  email_confirmed_at = COALESCE(au.email_confirmed_at, NOW()),
  aud                = 'authenticated',
  role               = 'authenticated',
  banned_until       = NULL,
  updated_at         = NOW()
FROM public.users pu
WHERE pu.id = au.id
  AND pu.status IN ('Active', 'Pending');

-- Verifikasi
SELECT
  COUNT(*) FILTER (WHERE au.email_confirmed_at IS NULL) AS masih_null,
  COUNT(*) FILTER (WHERE au.email_confirmed_at IS NOT NULL) AS sudah_confirmed,
  COUNT(*) FILTER (WHERE au.id IS NULL) AS tidak_punya_auth
FROM public.users pu
LEFT JOIN auth.users au ON au.id = pu.id
WHERE pu.status = 'Active';

-- Catatan: Kolom "tidak_punya_auth" yang > 0 berarti anggota tsb
-- belum punya akun login. Gunakan tombol "Provision Semua Akun"
-- di AdminPage untuk membuat akun mereka.
