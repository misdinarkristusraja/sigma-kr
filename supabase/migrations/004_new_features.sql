-- ============================================================
-- SIGMA Migration 004: New Features
-- 1. Kolom is_draft di events (draft/publish workflow)
-- 2. Tabel re_registration (daftar ulang)
-- 3. Fungsi login by nickname (get email from nickname)
-- 4. Tambah nilai enum untuk re_reg status
-- ============================================================

-- 1. Tambah kolom is_draft ke tabel events
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES users(id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS draft_note TEXT;

-- Update event yang sudah ada (bukan draft lagi)
UPDATE events SET is_draft = FALSE WHERE status_event IN ('Berlangsung', 'Sudah_Lewat');
UPDATE events SET is_draft = TRUE  WHERE status_event = 'Akan_Datang' AND gcatholic_fetched = FALSE;

-- 2. Tabel re_registration (daftar ulang)
CREATE TABLE IF NOT EXISTS re_registrations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tahun           INTEGER NOT NULL,
  -- Data yang diperbarui saat daftar ulang
  sekolah_baru    VARCHAR(200),
  pendidikan_baru VARCHAR(10),
  hp_anak_baru    TEXT,
  hp_ortu_baru    TEXT,
  alamat_baru     VARCHAR(500),
  alasan_lanjut   TEXT,
  sampai_kapan    TEXT,
  -- Status
  status          VARCHAR(20) NOT NULL DEFAULT 'Pending',  -- Pending, Approved, Rejected
  catatan_admin   TEXT,
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tahun)  -- 1 daftar ulang per user per tahun
);

-- RLS re_registration
ALTER TABLE re_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rereg: user can insert own" ON re_registrations
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "rereg: user can read own" ON re_registrations
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() IS NOT NULL);
CREATE POLICY "rereg: admin can update" ON re_registrations
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Grant
GRANT ALL ON re_registrations TO authenticated, service_role;

-- 3. Konfigurasi window daftar ulang
INSERT INTO system_config (key, value, description) VALUES
  ('rereg_open_date',  '2026-07-01', 'Tanggal buka daftar ulang (YYYY-MM-DD)'),
  ('rereg_close_date', '2026-07-31', 'Tanggal tutup daftar ulang (YYYY-MM-DD)'),
  ('rereg_tahun',      '2026',       'Tahun periode daftar ulang aktif')
ON CONFLICT (key) DO NOTHING;

-- 4. Fungsi: get email dari nickname (untuk login pakai username)
CREATE OR REPLACE FUNCTION get_email_by_nickname(p_nickname TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email FROM users
  WHERE LOWER(nickname) = LOWER(p_nickname)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_email_by_nickname(TEXT) TO authenticated, anon, service_role;

-- 5. Fungsi: cek apakah window daftar ulang terbuka
CREATE OR REPLACE FUNCTION is_rereg_open()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CURRENT_DATE BETWEEN
    (SELECT value::DATE FROM system_config WHERE key = 'rereg_open_date')
    AND
    (SELECT value::DATE FROM system_config WHERE key = 'rereg_close_date');
$$;

GRANT EXECUTE ON FUNCTION is_rereg_open() TO authenticated, anon, service_role;

-- 6. Index baru untuk performa
CREATE INDEX IF NOT EXISTS idx_events_draft    ON events (is_draft);
CREATE INDEX IF NOT EXISTS idx_rereg_user      ON re_registrations (user_id);
CREATE INDEX IF NOT EXISTS idx_rereg_status    ON re_registrations (status);
CREATE INDEX IF NOT EXISTS idx_scanrec_type    ON scan_records (scan_type);
CREATE INDEX IF NOT EXISTS idx_scanrec_walkin  ON scan_records (is_walk_in);

-- Verifikasi
SELECT 'Migration 004 selesai' AS status;
SELECT COUNT(*) AS total_events, SUM(CASE WHEN is_draft THEN 1 ELSE 0 END) AS draft FROM events;
