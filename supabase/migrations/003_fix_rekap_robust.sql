-- ============================================================
-- SIGMA Migration 003: Robust update_rekap_poin
-- Fix: NULL threshold, SECURITY DEFINER, defensive error handling
-- ============================================================

-- Drop versi lama
DROP FUNCTION IF EXISTS update_rekap_poin();

-- Buat ulang dengan SECURITY DEFINER agar bypass RLS saat dipanggil
-- via REST API, dan defensive terhadap NULL values
CREATE OR REPLACE FUNCTION update_rekap_poin()
RETURNS jsonb   -- return jsonb agar mudah debug hasilnya
LANGUAGE plpgsql
SECURITY DEFINER  -- jalankan sebagai DB owner, bypass RLS
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
  v_threshold     INTEGER := 3;  -- default 3, jangan NULL
  v_processed     INTEGER := 0;
BEGIN

  -- Ambil threshold dengan fallback ke 3 jika tidak ada
  SELECT COALESCE(value::INTEGER, 3)
  INTO   v_threshold
  FROM   system_config
  WHERE  key = 'max_absen_before_suspend'
  LIMIT  1;

  -- Jika tabel system_config kosong, pakai default
  IF v_threshold IS NULL THEN
    v_threshold := 3;
  END IF;

  -- ── Loop user yang punya scan baru (2 hari terakhir) ─────
  FOR r IN
    SELECT DISTINCT
      sr.user_id,
      (sr.timestamp AT TIME ZONE 'Asia/Jakarta')::DATE AS scan_date,
      EXTRACT(DOW  FROM sr.timestamp AT TIME ZONE 'Asia/Jakarta')::INTEGER AS dow,
      EXTRACT(HOUR FROM sr.timestamp AT TIME ZONE 'Asia/Jakarta')::INTEGER AS hour_wib
    FROM scan_records sr
    WHERE sr.timestamp >= NOW() - INTERVAL '2 days'
  LOOP
    v_dow      := r.dow;
    v_hour_wib := r.hour_wib;

    -- Hitung week_start: Sabtu 07:00 WIB
    IF v_dow = 6 AND v_hour_wib >= 7 THEN
      v_week_start := r.scan_date;
    ELSIF v_dow = 6 AND v_hour_wib < 7 THEN
      v_week_start := r.scan_date - 7;
    ELSE
      v_week_start := r.scan_date - CASE v_dow
        WHEN 0 THEN 1 WHEN 1 THEN 2 WHEN 2 THEN 3
        WHEN 3 THEN 4 WHEN 4 THEN 5 WHEN 5 THEN 6
        ELSE 7
      END;
    END IF;
    v_week_end := v_week_start + 6;

    -- Dijadwalkan?
    SELECT EXISTS (
      SELECT 1 FROM assignments a
      JOIN events e ON a.event_id = e.id
      WHERE a.user_id        = r.user_id
        AND e.tanggal_tugas  BETWEEN v_week_start AND (v_week_start + 7)
        AND e.tipe_event::TEXT != 'Misa_Harian'
    ) INTO v_dijadwalkan;

    -- Hadir tugas?
    SELECT EXISTS (
      SELECT 1 FROM scan_records
      WHERE user_id       = r.user_id
        AND scan_type::TEXT IN ('tugas','walkin_tugas')
        AND (timestamp AT TIME ZONE 'Asia/Jakarta')::DATE
            BETWEEN v_week_start AND v_week_end
    ) INTO v_hadir_tugas;

    -- Hadir latihan?
    SELECT EXISTS (
      SELECT 1 FROM scan_records
      WHERE user_id       = r.user_id
        AND scan_type::TEXT IN ('latihan','walkin_latihan')
        AND (timestamp AT TIME ZONE 'Asia/Jakarta')::DATE
            BETWEEN v_week_start AND v_week_end
    ) INTO v_hadir_latihan;

    -- Walk-in?
    SELECT EXISTS (
      SELECT 1 FROM scan_records
      WHERE user_id    = r.user_id
        AND is_walk_in = TRUE
        AND (timestamp AT TIME ZONE 'Asia/Jakarta')::DATE
            BETWEEN v_week_start AND v_week_end
    ) INTO v_walk_in;

    -- Hitung poin
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
      COALESCE(v_dijadwalkan, FALSE),
      COALESCE(v_hadir_tugas, FALSE),
      COALESCE(v_hadir_latihan, FALSE),
      COALESCE(v_walk_in, FALSE),
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

  -- ── Rekap harian (hanya jika ada tabel events) ───────────
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
    -- Jika rekap harian gagal, lanjutkan saja (jangan crash keseluruhan)
    RAISE NOTICE 'rekap harian skip: %', SQLERRM;
  END;

  -- ── Suspend check ────────────────────────────────────────
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
      ) = v_threshold;  -- SEMUA v_threshold minggu terakhir K6
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'suspend check skip: %', SQLERRM;
  END;

  -- ── Auto-unsuspend ───────────────────────────────────────
  UPDATE users
  SET is_suspended = FALSE, suspended_until = NULL
  WHERE is_suspended = TRUE
    AND suspended_until IS NOT NULL
    AND suspended_until < CURRENT_DATE;

  -- ── Expire swap requests ─────────────────────────────────
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
  -- Tangkap error apapun dan return detail untuk debugging
  RETURN jsonb_build_object(
    'ok',    FALSE,
    'error', SQLERRM,
    'detail', SQLSTATE
  );
END;
$$;

-- Grant execute ke authenticated users dan service role
GRANT EXECUTE ON FUNCTION update_rekap_poin() TO authenticated;
GRANT EXECUTE ON FUNCTION update_rekap_poin() TO service_role;
GRANT EXECUTE ON FUNCTION update_rekap_poin() TO anon;

-- ── Test langsung ─────────────────────────────────────────
SELECT update_rekap_poin();
