-- ============================================================
-- SIGMA — Migration 002: Fix update_rekap_poin function
-- Bug fixes:
--   1. DATE - INTEGER * INTERVAL returns TIMESTAMP, not DATE
--      → gunakan (v_week_start + n) dengan integer arithmetic
--   2. EXTRACT(HOUR FROM DATE) selalu 0 — periode Sabtu 07:00
--      harus dihitung dari TIMESTAMPTZ scan asli, bukan scan_date
--   3. Enum comparison: scan_type & tipe_event perlu ::text cast
--   4. v_week_end dideklarasi DATE tapi diisi TIMESTAMPTZ result
-- ============================================================

CREATE OR REPLACE FUNCTION update_rekap_poin()
RETURNS void AS $$
DECLARE
  r             RECORD;
  v_dow         INTEGER;
  v_week_start  DATE;
  v_week_end    DATE;
  v_poin        INTEGER;
  v_kondisi     VARCHAR(5);
  v_dijadwalkan BOOLEAN;
  v_hadir_tugas BOOLEAN;
  v_hadir_latihan BOOLEAN;
  v_walk_in     BOOLEAN;
  v_suspend_threshold INTEGER;
BEGIN

  -- Ambil threshold suspend dari config
  SELECT value::INTEGER
  INTO   v_suspend_threshold
  FROM   system_config
  WHERE  key = 'max_absen_before_suspend';

  -- Untuk setiap user yang punya scan_record baru dalam 2 hari terakhir
  FOR r IN
    SELECT DISTINCT
      sr.user_id,
      -- Konversi ke DATE di timezone WIB
      (sr.timestamp AT TIME ZONE 'Asia/Jakarta')::DATE AS scan_date,
      -- Simpan juga jam WIB untuk cek periode Sabtu 07:00
      EXTRACT(DOW  FROM sr.timestamp AT TIME ZONE 'Asia/Jakarta')::INTEGER AS dow,
      EXTRACT(HOUR FROM sr.timestamp AT TIME ZONE 'Asia/Jakarta')::INTEGER AS hour_wib
    FROM scan_records sr
    WHERE sr.timestamp >= NOW() - INTERVAL '2 days'
  LOOP

    v_dow := r.dow;  -- 0=Minggu, 1=Senin, ..., 6=Sabtu

    -- ── Hitung week_start: Sabtu 07:00 WIB ──────────────────
    -- Jika scan hari Sabtu DAN jam >= 07:00 → scan_date itu sendiri adalah week_start
    -- Jika scan hari Sabtu tapi jam < 07:00 → masih masuk minggu sebelumnya
    IF v_dow = 6 AND r.hour_wib >= 7 THEN
      v_week_start := r.scan_date;
    ELSIF v_dow = 6 AND r.hour_wib < 7 THEN
      -- Sabtu tapi sebelum jam 7 → week_start = Sabtu SEBELUMNYA (7 hari lalu)
      v_week_start := r.scan_date - 7;
    ELSE
      -- Hari lain → mundur ke Sabtu sebelumnya
      -- DOW: 0=Minggu(1 hari setelah Sabtu), 1=Senin, ..., 5=Jumat, 6=Sabtu
      -- Jarak dari hari ini ke Sabtu terdekat sebelumnya:
      -- Minggu(0)→1, Senin(1)→2, Selasa(2)→3, Rabu(3)→4, Kamis(4)→5, Jumat(5)→6
      v_week_start := r.scan_date - CASE v_dow
        WHEN 0 THEN 1
        WHEN 1 THEN 2
        WHEN 2 THEN 3
        WHEN 3 THEN 4
        WHEN 4 THEN 5
        WHEN 5 THEN 6
        ELSE 0
      END;
    END IF;

    -- week_end = Sabtu berikutnya (7 hari kemudian dikurang 1 hari = Jumat)
    -- tapi secara logis: periode berakhir Sabtu 06:59:59 WIB berikutnya
    -- Untuk query DATE BETWEEN, gunakan hari Jumat sebagai batas inklusif
    -- (scan Sabtu < 07:00 sudah masuk minggu sebelumnya via logika di atas)
    v_week_end := v_week_start + 6;  -- DATE arithmetic: +6 hari (Jumat)

    -- ── Cek dijadwalkan ──────────────────────────────────────
    SELECT EXISTS (
      SELECT 1
      FROM   assignments a
      JOIN   events e ON a.event_id = e.id
      WHERE  a.user_id = r.user_id
        AND  e.tanggal_tugas BETWEEN v_week_start AND v_week_start + 7
        AND  e.tipe_event::TEXT != 'Misa_Harian'
    ) INTO v_dijadwalkan;

    -- ── Cek hadir tugas ──────────────────────────────────────
    SELECT EXISTS (
      SELECT 1
      FROM   scan_records
      WHERE  user_id   = r.user_id
        AND  scan_type::TEXT IN ('tugas', 'walkin_tugas')
        AND  (timestamp AT TIME ZONE 'Asia/Jakarta')::DATE
             BETWEEN v_week_start AND v_week_end
    ) INTO v_hadir_tugas;

    -- ── Cek hadir latihan ────────────────────────────────────
    SELECT EXISTS (
      SELECT 1
      FROM   scan_records
      WHERE  user_id   = r.user_id
        AND  scan_type::TEXT IN ('latihan', 'walkin_latihan')
        AND  (timestamp AT TIME ZONE 'Asia/Jakarta')::DATE
             BETWEEN v_week_start AND v_week_end
    ) INTO v_hadir_latihan;

    -- ── Cek walk-in ──────────────────────────────────────────
    SELECT EXISTS (
      SELECT 1
      FROM   scan_records
      WHERE  user_id    = r.user_id
        AND  is_walk_in = TRUE
        AND  (timestamp AT TIME ZONE 'Asia/Jakarta')::DATE
             BETWEEN v_week_start AND v_week_end
    ) INTO v_walk_in;

    -- ── Hitung poin (6 kondisi) ──────────────────────────────
    SELECT p.poin, p.kondisi
    INTO   v_poin, v_kondisi
    FROM   hitung_poin_kondisi(
             v_dijadwalkan,
             v_hadir_tugas,
             v_hadir_latihan,
             v_walk_in
           ) p;

    -- ── Upsert rekap_poin_mingguan ───────────────────────────
    INSERT INTO rekap_poin_mingguan (
      user_id, week_start, week_end,
      is_dijadwalkan, is_hadir_tugas, is_hadir_latihan, is_walk_in,
      poin, kondisi, last_updated
    ) VALUES (
      r.user_id, v_week_start, v_week_end,
      v_dijadwalkan, v_hadir_tugas, v_hadir_latihan, v_walk_in,
      COALESCE(v_poin, 0), v_kondisi, NOW()
    )
    ON CONFLICT (user_id, week_start) DO UPDATE SET
      week_end         = EXCLUDED.week_end,
      is_dijadwalkan   = EXCLUDED.is_dijadwalkan,
      is_hadir_tugas   = EXCLUDED.is_hadir_tugas,
      is_hadir_latihan = EXCLUDED.is_hadir_latihan,
      is_walk_in       = EXCLUDED.is_walk_in,
      poin             = EXCLUDED.poin,
      kondisi          = EXCLUDED.kondisi,
      last_updated     = NOW();

  END LOOP;

  -- ── Update rekap_poin_harian ─────────────────────────────
  -- Hitung jumlah kehadiran Misa Harian per bulan per user
  INSERT INTO rekap_poin_harian (
    user_id, tahun, bulan, count_hadir_harian, poin_harian, last_updated
  )
  SELECT
    sr.user_id,
    EXTRACT(YEAR  FROM sr.timestamp AT TIME ZONE 'Asia/Jakarta')::INTEGER AS tahun,
    EXTRACT(MONTH FROM sr.timestamp AT TIME ZONE 'Asia/Jakarta')::INTEGER AS bulan,
    COUNT(*)   AS count_hadir_harian,
    COUNT(*)   AS poin_harian,   -- +1 per kehadiran harian
    NOW()
  FROM scan_records sr
  JOIN events e ON sr.event_id = e.id
  WHERE e.tipe_event::TEXT = 'Misa_Harian'
    AND sr.scan_type::TEXT IN ('tugas', 'walkin_tugas')
    AND sr.timestamp >= DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Jakarta')
  GROUP BY sr.user_id, tahun, bulan
  ON CONFLICT (user_id, tahun, bulan) DO UPDATE SET
    count_hadir_harian = EXCLUDED.count_hadir_harian,
    poin_harian        = EXCLUDED.poin_harian,
    last_updated       = NOW();

  -- ── Suspend check: K6 berturut-turut ────────────────────
  UPDATE users u
  SET
    is_suspended    = TRUE,
    suspended_until = (NOW() + INTERVAL '30 days')::DATE
  WHERE
    u.is_suspended = FALSE
    AND (
      SELECT COUNT(*)
      FROM (
        SELECT 1
        FROM   rekap_poin_mingguan rpm
        WHERE  rpm.user_id = u.id
          AND  rpm.kondisi = 'K6'
        ORDER  BY rpm.week_start DESC
        LIMIT  v_suspend_threshold
      ) sub
    ) >= v_suspend_threshold;

  -- ── Unsuspend: jika sudah lewat suspended_until ──────────
  UPDATE users
  SET
    is_suspended    = FALSE,
    suspended_until = NULL
  WHERE
    is_suspended    = TRUE
    AND suspended_until IS NOT NULL
    AND suspended_until < CURRENT_DATE;

END;
$$ LANGUAGE plpgsql;

-- ── Quick test: panggil fungsi sekarang ───────────────────────
-- SELECT update_rekap_poin();
-- (uncomment baris di atas untuk langsung test setelah run migration ini)
