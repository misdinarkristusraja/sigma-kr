-- ================================================================
-- SIGMA Migration 012: Misa Besar + Latihan Wajib System
-- Jalankan di Supabase SQL Editor
-- ================================================================

-- ── 1. Tambah kolom is_misa_besar ke events ──────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_misa_besar BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. Tabel sesi latihan per event ──────────────────────────
-- Setiap Misa Besar bisa punya 1-N sesi latihan
CREATE TABLE IF NOT EXISTS event_latihan (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tanggal         DATE NOT NULL,
  jam             VARCHAR(10) NOT NULL DEFAULT '07.00',
  lokasi          TEXT,
  catatan         TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_latihan_event ON event_latihan(event_id);
CREATE INDEX IF NOT EXISTS idx_event_latihan_tanggal ON event_latihan(tanggal);

-- ── 3. Kehadiran latihan (dari scan atau admin manual) ────────
CREATE TABLE IF NOT EXISTS event_latihan_attendance (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  latihan_id      UUID NOT NULL REFERENCES event_latihan(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hadir           BOOLEAN NOT NULL DEFAULT TRUE,
  scan_record_id  UUID REFERENCES scan_records(id),  -- link ke scan jika ada
  marked_by       UUID REFERENCES users(id),          -- admin yang manual mark
  marked_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(latihan_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ela_latihan ON event_latihan_attendance(latihan_id);
CREATE INDEX IF NOT EXISTS idx_ela_user    ON event_latihan_attendance(user_id);

-- ── 4. Self-report ketidakhadiran oleh petugas ────────────────
-- PostgreSQL tidak support CREATE TYPE IF NOT EXISTS — pakai DO block
DO $$ BEGIN
  CREATE TYPE alasan_absen_enum AS ENUM (
    'sakit',
    'tugas_sekolah',
    'acara_keluarga_urgent',
    'acara_keluarga_non_urgent',
    'lupa',
    'tidak_ada_transportasi',
    'alasan_lain'
  );
EXCEPTION WHEN duplicate_object THEN NULL; -- sudah ada, skip
END $$;

CREATE TABLE IF NOT EXISTS event_latihan_absence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  latihan_id      UUID NOT NULL REFERENCES event_latihan(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alasan          alasan_absen_enum NOT NULL DEFAULT 'alasan_lain',
  keterangan      TEXT,
  submitted_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(latihan_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ela_abs_latihan ON event_latihan_absence(latihan_id);
CREATE INDEX IF NOT EXISTS idx_ela_abs_user    ON event_latihan_absence(user_id);

-- ── 5. Tabel notifikasi threshold latihan ─────────────────────
-- Catat siapa sudah dinotif agar tidak double-notif
CREATE TABLE IF NOT EXISTS latihan_threshold_notified (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notified_at TIMESTAMPTZ DEFAULT NOW(),
  reason      TEXT,  -- 'pct_below_threshold' | 'consecutive_absen'
  UNIQUE(event_id, user_id)
);

-- ── 6. RLS Policies ───────────────────────────────────────────
ALTER TABLE event_latihan              ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_latihan_attendance   ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_latihan_absence      ENABLE ROW LEVEL SECURITY;
ALTER TABLE latihan_threshold_notified ENABLE ROW LEVEL SECURITY;

-- event_latihan: semua bisa lihat, hanya staff yang bisa ubah
CREATE POLICY ela_read   ON event_latihan FOR SELECT USING (TRUE);
CREATE POLICY ela_write  ON event_latihan FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus','Pelatih')));

-- attendance: semua bisa lihat, staff bisa ubah
CREATE POLICY elat_read  ON event_latihan_attendance FOR SELECT USING (TRUE);
CREATE POLICY elat_write ON event_latihan_attendance FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus','Pelatih')));

-- absence: user bisa insert/update untuk diri sendiri, staff bisa semua
CREATE POLICY elab_read  ON event_latihan_absence FOR SELECT USING (TRUE);
CREATE POLICY elab_self  ON event_latihan_absence FOR INSERT
  WITH CHECK (user_id = auth.uid());
CREATE POLICY elab_self_update ON event_latihan_absence FOR UPDATE
  USING (user_id = auth.uid());
CREATE POLICY elab_staff ON event_latihan_absence FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus','Pelatih')));

CREATE POLICY ltn_read   ON latihan_threshold_notified FOR SELECT USING (TRUE);
CREATE POLICY ltn_write  ON latihan_threshold_notified FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus')));

-- ── 7. Verifikasi ─────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('event_latihan','event_latihan_attendance','event_latihan_absence','latihan_threshold_notified');
