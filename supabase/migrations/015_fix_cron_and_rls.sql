-- ================================================================
-- SIGMA Migration 015: Fix Cron K6 + RLS Self-Reference
-- Jalankan di: Supabase Dashboard → SQL Editor
-- Catatan: Jalankan SETELAH semua migrasi 001-014.
-- ================================================================

-- ================================================================
-- BAGIAN 1 — FIX BUG-010: RLS Self-Reference
-- ================================================================
-- MASALAH: Policy seperti "EXISTS (SELECT 1 FROM users WHERE id = auth.uid()...)"
-- melakukan query ke tabel users dari dalam policy tabel users sendiri.
-- Ini menyebabkan recursive RLS evaluation dan overhead performa.
--
-- SOLUSI: Buat fungsi SECURITY DEFINER yang membaca role sekali (bypass RLS),
-- lalu gunakan fungsi ini di semua policy yang butuh cek role.
-- SECURITY DEFINER = fungsi berjalan sebagai DB owner, bukan caller,
-- sehingga tidak perlu evaluasi RLS untuk membaca tabel users.
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role::TEXT FROM users WHERE id = auth.uid() LIMIT 1;
$$;

COMMENT ON FUNCTION get_current_user_role() IS
  'Baca role user saat ini tanpa recursive RLS. Dipakai oleh semua policy tabel.';

GRANT EXECUTE ON FUNCTION get_current_user_role() TO authenticated;

-- ── Perbarui policy tabel: users ─────────────────────────────
DROP POLICY IF EXISTS users_admin   ON users;
DROP POLICY IF EXISTS users_select  ON users;
DROP POLICY IF EXISTS users_update_self ON users;

-- Semua user login bisa melihat user list (untuk typeahead nama, dll.)
CREATE POLICY users_select ON users FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- User hanya bisa update data diri sendiri
CREATE POLICY users_update_self ON users FOR UPDATE
  USING (auth.uid() = id);

-- Admin/Pengurus bisa semua (menggunakan fungsi, bukan subquery rekursif)
CREATE POLICY users_admin ON users FOR ALL
  USING (get_current_user_role() IN ('Administrator', 'Pengurus'));

-- ── Perbarui policy tabel: events ────────────────────────────
DROP POLICY IF EXISTS events_write ON events;

CREATE POLICY events_write ON events FOR ALL
  USING (get_current_user_role() IN ('Administrator', 'Pengurus'));

-- ── Perbarui policy tabel: assignments ───────────────────────
DROP POLICY IF EXISTS assign_write ON assignments;

CREATE POLICY assign_write ON assignments FOR ALL
  USING (get_current_user_role() IN ('Administrator', 'Pengurus'));

-- ── Perbarui policy tabel: scan_records ──────────────────────
DROP POLICY IF EXISTS scan_insert ON scan_records;
DROP POLICY IF EXISTS scan_read   ON scan_records;

CREATE POLICY scan_insert ON scan_records FOR INSERT
  WITH CHECK (get_current_user_role() IN ('Administrator', 'Pengurus', 'Pelatih'));

CREATE POLICY scan_read ON scan_records FOR SELECT
  USING (get_current_user_role() IN ('Administrator', 'Pengurus', 'Pelatih'));

-- ── Perbarui policy tabel: swap_requests ─────────────────────
DROP POLICY IF EXISTS swap_update ON swap_requests;

CREATE POLICY swap_update ON swap_requests FOR UPDATE
  USING (
    auth.uid() = requester_id
    OR get_current_user_role() IN ('Administrator', 'Pengurus')
  );

-- ── Perbarui policy tabel: system_config ─────────────────────
DROP POLICY IF EXISTS config_write ON system_config;

CREATE POLICY config_write ON system_config FOR ALL
  USING (get_current_user_role() = 'Administrator');

-- ── Perbarui policy tabel: registrations (dari migration 014) ─
DROP POLICY IF EXISTS registrations_read   ON registrations;
DROP POLICY IF EXISTS registrations_update ON registrations;

CREATE POLICY registrations_read ON registrations FOR SELECT
  USING (get_current_user_role() IN ('Administrator', 'Pengurus'));

CREATE POLICY registrations_update ON registrations FOR UPDATE
  USING (get_current_user_role() IN ('Administrator', 'Pengurus'));


-- ================================================================
-- BAGIAN 2 — FIX BUG-008: Cron K6 tidak ter-apply ke user absen
-- ================================================================
-- MASALAH: update_rekap_poin() hanya loop user yang punya SCAN RECORDS
-- dalam 2 hari terakhir. User yang dijadwalkan tapi absen total (K6)
-- tidak punya scan records → tidak masuk loop → tidak pernah dapat K6 (-1)
-- → sistem suspend tidak berjalan untuk user absen.
--
-- SOLUSI: Sumber loop diubah ke UNION antara:
--   (A) User dengan scan records baru (2 hari terakhir) — perilaku lama
--   (B) User dengan assignments dalam 7 hari terakhir — K6 candidates baru
-- Ini menjamin semua user terjadwal dievaluasi, termasuk yang absen total.
-- ----------------------------------------------------------------

DROP FUNCTION IF EXISTS update_rekap_poin();

CREATE OR REPLACE FUNCTION update_rekap_poin()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r               RECORD;
  v_dow           INTEGER;
  v_hour_wib      INTEGER;
  v_week_start    DATE;
  v_week_end      DATE;
  v_poin          INTEGER;
  v_kondisi       VARCHAR(5);
  v_dijadwalkan   BOOLEAN;
  v_hadir_tugas   BOOLEAN;
  v_hadir_latihan BOOLEAN;
  v_walk_in       BOOLEAN;
  v_threshold     INTEGER := 3;
  v_processed     INTEGER := 0;
BEGIN

  -- Ambil threshold suspend dari system_config
  SELECT COALESCE(value::INTEGER, 3)
  INTO   v_threshold
  FROM   system_config
  WHERE  key = 'max_absen_before_suspend'
  LIMIT  1;

  IF v_threshold IS NULL THEN
    v_threshold := 3;
  END IF;

  -- ── Loop sumber gabungan: scan baru + assignments minggu ini ─
  -- FIX BUG-008: Sebelumnya hanya FROM scan_records (user absen tidak masuk).
  -- Sekarang UNION dengan assignments agar user dijadwalkan yang absen total
  -- juga dievaluasi dan mendapat kondisi K6 (-1).
  FOR r IN
    -- (A) User yang punya scan records 2 hari terakhir (perilaku lama)
    SELECT DISTINCT
      sr.user_id,
      (sr.timestamp AT TIME ZONE 'Asia/Jakarta')::DATE  AS ref_date,
      EXTRACT(DOW  FROM sr.timestamp AT TIME ZONE 'Asia/Jakarta')::INTEGER AS dow,
      EXTRACT(HOUR FROM sr.timestamp AT TIME ZONE 'Asia/Jakarta')::INTEGER AS hour_wib
    FROM scan_records sr
    WHERE sr.timestamp >= NOW() - INTERVAL '2 days'

    UNION

    -- (B) User yang dijadwalkan dalam 7 hari terakhir (K6 candidates)
    -- Ini mencakup user yang absen total dan tidak punya scan records sama sekali.
    SELECT DISTINCT
      a.user_id,
      e.tanggal_tugas AS ref_date,
      EXTRACT(DOW  FROM e.tanggal_tugas::TIMESTAMPTZ AT TIME ZONE 'Asia/Jakarta')::INTEGER AS dow,
      7 AS hour_wib  -- default: anggap Sabtu >= 07:00 WIB untuk tanggal tugas
    FROM assignments a
    JOIN events e ON a.event_id = e.id
    WHERE e.tanggal_tugas >= (NOW() AT TIME ZONE 'Asia/Jakarta')::DATE - 7
      AND e.tanggal_tugas <= (NOW() AT TIME ZONE 'Asia/Jakarta')::DATE
      AND e.tipe_event::TEXT != 'Misa_Harian'
  LOOP
    v_dow      := r.dow;
    v_hour_wib := r.hour_wib;

    -- Hitung week_start: Sabtu 07:00 WIB
    IF v_dow = 6 AND v_hour_wib >= 7 THEN
      v_week_start := r.ref_date;
    ELSIF v_dow = 6 AND v_hour_wib < 7 THEN
      v_week_start := r.ref_date - 7;
    ELSE
      v_week_start := r.ref_date - CASE v_dow
        WHEN 0 THEN 1 WHEN 1 THEN 2 WHEN 2 THEN 3
        WHEN 3 THEN 4 WHEN 4 THEN 5 WHEN 5 THEN 6
        ELSE 7
      END;
    END IF;
    v_week_end := v_week_start + 6;

    -- Dijadwalkan di minggu ini?
    SELECT EXISTS (
      SELECT 1 FROM assignments a
      JOIN events e ON a.event_id = e.id
      WHERE a.user_id        = r.user_id
        AND e.tanggal_tugas  BETWEEN v_week_start AND (v_week_start + 7)
        AND e.tipe_event::TEXT != 'Misa_Harian'
    ) INTO v_dijadwalkan;

    -- Hadir tugas di minggu ini?
    SELECT EXISTS (
      SELECT 1 FROM scan_records
      WHERE user_id       = r.user_id
        AND scan_type::TEXT IN ('tugas','walkin_tugas')
        AND (timestamp AT TIME ZONE 'Asia/Jakarta')::DATE
            BETWEEN v_week_start AND v_week_end
    ) INTO v_hadir_tugas;

    -- Hadir latihan di minggu ini?
    SELECT EXISTS (
      SELECT 1 FROM scan_records
      WHERE user_id       = r.user_id
        AND scan_type::TEXT IN ('latihan','walkin_latihan')
        AND (timestamp AT TIME ZONE 'Asia/Jakarta')::DATE
            BETWEEN v_week_start AND v_week_end
    ) INTO v_hadir_latihan;

    -- Walk-in di minggu ini?
    SELECT EXISTS (
      SELECT 1 FROM scan_records
      WHERE user_id    = r.user_id
        AND is_walk_in = TRUE
        AND (timestamp AT TIME ZONE 'Asia/Jakarta')::DATE
            BETWEEN v_week_start AND v_week_end
    ) INTO v_walk_in;

    -- Hitung poin dengan formula 6 kondisi
    SELECT p.poin, p.kondisi INTO v_poin, v_kondisi
    FROM hitung_poin_kondisi(
      v_dijadwalkan, v_hadir_tugas, v_hadir_latihan, v_walk_in
    ) p;

    -- Upsert rekap mingguan
    INSERT INTO rekap_poin_mingguan (
      user_id, week_start, week_end,
      is_dijadwalkan, is_hadir_tugas, is_hadir_latihan, is_walk_in,
      poin, kondisi, last_updated
    ) VALUES (
      r.user_id, v_week_start, v_week_end,
      COALESCE(v_dijadwalkan,   FALSE),
      COALESCE(v_hadir_tugas,   FALSE),
      COALESCE(v_hadir_latihan, FALSE),
      COALESCE(v_walk_in,       FALSE),
      COALESCE(v_poin, 0),
      v_kondisi,
      NOW()
    )
    ON CONFLICT (user_id, week_start) DO UPDATE SET
      week_end          = EXCLUDED.week_end,
      is_dijadwalkan    = EXCLUDED.is_dijadwalkan,
      is_hadir_tugas    = EXCLUDED.is_hadir_tugas,
      is_hadir_latihan  = EXCLUDED.is_hadir_latihan,
      is_walk_in        = EXCLUDED.is_walk_in,
      poin              = EXCLUDED.poin,
      kondisi           = EXCLUDED.kondisi,
      last_updated      = NOW();

    v_processed := v_processed + 1;
  END LOOP;

  -- ── Rekap harian (Misa Harian) ────────────────────────────
  BEGIN
    INSERT INTO rekap_poin_harian (
      user_id, tahun, bulan,
      count_hadir_harian, poin_harian, last_updated
    )
    SELECT
      sr.user_id,
      EXTRACT(YEAR  FROM sr.timestamp AT TIME ZONE 'Asia/Jakarta')::INTEGER,
      EXTRACT(MONTH FROM sr.timestamp AT TIME ZONE 'Asia/Jakarta')::INTEGER,
      COUNT(*),
      COUNT(*),
      NOW()
    FROM scan_records sr
    JOIN events e ON sr.event_id = e.id
    WHERE e.tipe_event::TEXT  = 'Misa_Harian'
      AND sr.scan_type::TEXT IN ('tugas', 'walkin_tugas')
      AND sr.timestamp >= DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Jakarta')
    GROUP BY
      sr.user_id,
      EXTRACT(YEAR  FROM sr.timestamp AT TIME ZONE 'Asia/Jakarta'),
      EXTRACT(MONTH FROM sr.timestamp AT TIME ZONE 'Asia/Jakarta')
    ON CONFLICT (user_id, tahun, bulan) DO UPDATE SET
      count_hadir_harian = EXCLUDED.count_hadir_harian,
      poin_harian        = EXCLUDED.poin_harian,
      last_updated       = NOW();
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'rekap harian skip: %', SQLERRM;
  END;

  -- ── Suspend check: K6 berturut-turut ─────────────────────
  BEGIN
    UPDATE users u
    SET
      is_suspended    = TRUE,
      suspended_until = (NOW() + INTERVAL '30 days')::DATE
    WHERE u.is_suspended = FALSE
      AND u.status = 'Active'
      AND (
        SELECT COUNT(*) FROM (
          SELECT 1 FROM rekap_poin_mingguan rpm
          WHERE rpm.user_id = u.id
            AND rpm.kondisi = 'K6'
          ORDER BY rpm.week_start DESC
          LIMIT v_threshold
        ) sub
      ) = v_threshold;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'suspend check skip: %', SQLERRM;
  END;

  -- ── Auto-unsuspend ────────────────────────────────────────
  UPDATE users
  SET is_suspended = FALSE, suspended_until = NULL
  WHERE is_suspended = TRUE
    AND suspended_until IS NOT NULL
    AND suspended_until < CURRENT_DATE;

  -- ── Expire swap requests ──────────────────────────────────
  UPDATE swap_requests
  SET status = 'Expired'
  WHERE status = 'Pending'
    AND expires_at < NOW();

  RETURN jsonb_build_object(
    'ok',        TRUE,
    'processed', v_processed,
    'threshold', v_threshold,
    'timestamp', NOW()
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok',    FALSE,
    'error', SQLERRM,
    'detail', SQLSTATE
  );
END;
$$;

-- Grant execute
GRANT EXECUTE ON FUNCTION update_rekap_poin() TO authenticated;
GRANT EXECUTE ON FUNCTION update_rekap_poin() TO service_role;
GRANT EXECUTE ON FUNCTION update_rekap_poin() TO anon;

-- ── Verifikasi langsung (aman dijalankan kapan saja) ──────────
SELECT update_rekap_poin();
