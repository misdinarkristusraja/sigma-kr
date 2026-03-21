-- ============================================================
-- SIGMA Migration 004: Feature additions
-- 1. Tabel reregistrations (daftar ulang)
-- 2. Kolom is_draft & published_at di events
-- 3. RLS untuk tabel baru
-- ============================================================

-- ── 1. Tambah kolom is_draft ke events (jika belum ada) ─────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_draft     BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_note   TEXT;

-- Event yang sudah ada dianggap published (bukan draft)
UPDATE events SET is_draft = FALSE WHERE is_draft = TRUE AND status_event = 'Sudah_Lewat';

-- ── 2. Tabel reregistrations ──────────────────────────────────
CREATE TABLE IF NOT EXISTS reregistrations (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tahun           INTEGER     NOT NULL,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_snapshot   JSONB,
  verified_by     UUID REFERENCES users(id),
  verified_at     TIMESTAMPTZ,
  UNIQUE (user_id, tahun)
);

ALTER TABLE reregistrations ENABLE ROW LEVEL SECURITY;

-- User bisa insert & lihat milik sendiri
CREATE POLICY "rereg: user can insert own"
  ON reregistrations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "rereg: user can read own"
  ON reregistrations FOR SELECT
  USING (auth.uid() = user_id);

-- Pengurus bisa lihat semua
CREATE POLICY "rereg: pengurus read all"
  ON reregistrations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
        AND role IN ('Administrator','Pengurus')
    )
  );

GRANT ALL ON reregistrations TO authenticated, service_role;

-- ── 3. Index tambahan ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_events_draft ON events (is_draft);
CREATE INDEX IF NOT EXISTS idx_rereg_user   ON reregistrations (user_id);
CREATE INDEX IF NOT EXISTS idx_rereg_tahun  ON reregistrations (tahun);

-- ── 4. Pastikan scan_records punya policy yang benar ─────────
-- (service_role harus bisa insert untuk cron rekap)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'scan_records' AND policyname = 'scan: service write'
  ) THEN
    CREATE POLICY "scan: service write"
      ON scan_records FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- ── 5. Grant service_role ke semua tabel ──────────────────────
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ── 6. Verifikasi ─────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM events WHERE is_draft IS NOT NULL) AS events_with_draft,
  (SELECT COUNT(*) FROM reregistrations) AS reregistrations_count;
