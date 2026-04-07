-- ================================================================
-- SIGMA Migration 014: Fix Policies for Standard Users & RLS
-- Jalankan kode ini di: Supabase Dashboard -> SQL Editor
-- ================================================================

-- ── 1. Perbaiki Kebijakan (Policy) system_config ──────────────
-- MASALAH: Sebelumnya, hanya Administrator yang bisa melalukan SELECT 
-- ke tabel system_config. Ini menyebabkan "Akun Biasa / Reguler" tidak
-- mendapatkan variabel global seperti window_optin_harian, memaksa 
-- Front-End me-fallback nilainya ke *null/undefined*.
-- SOLUSI: Mengizinkan semua user yang sudah *Login* untuk me-SELECT config.
-- (Edit/INSERT/DELETE tetap terkunci hanya untuk Administrator).

DROP POLICY IF EXISTS config_read ON system_config;

CREATE POLICY config_read ON system_config FOR SELECT
  USING (auth.uid() IS NOT NULL);


-- ── 2. Lapisan Keamanan Ekstra untuk "registrations" ──────────
-- Di skema awal, registrations belum diaktifkan RLS-nya. Hal ini rentan 
-- mengizinkan publik tak terotorisasi melihat/mengubah database pendaftar.

ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

-- Izinkan publik (Anon/Tidak login) membuat formulir pendaftaran baru:
DROP POLICY IF EXISTS registrations_insert ON registrations;
CREATE POLICY registrations_insert ON registrations FOR INSERT
  WITH CHECK (TRUE);

-- Hanya Administrator dan Pengurus yang boleh melihat (SELECT) daftar pelamar:
DROP POLICY IF EXISTS registrations_read ON registrations;
CREATE POLICY registrations_read ON registrations FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus')));

-- Hanya Administrator dan Pengurus yang boleh me-Reject / Approve pelamar (UPDATE):
DROP POLICY IF EXISTS registrations_update ON registrations;
CREATE POLICY registrations_update ON registrations FOR UPDATE
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus')));

-- ================================================================
-- ✅ Selesai, kebijakan RLS diperketat dan disesuaikan.
-- ================================================================
