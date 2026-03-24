-- ================================================================
-- SIGMA Migration 013: Mode Latihan Misa Besar (Gabung / Terpisah)
-- ================================================================

-- ── 1. Kolom mode_latihan di events ──────────────────────────
-- 'gabung'   = satu scan mencatat kehadiran di SEMUA sesi latihan event
-- 'terpisah' = satu scan hanya mencatat sesi yang sedang berlangsung
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS mode_latihan VARCHAR(10) NOT NULL DEFAULT 'gabung'
    CHECK (mode_latihan IN ('terpisah', 'gabung'));

-- ── 2. FK latihan_id di scan_records ─────────────────────────
-- Nullable: hanya diisi jika scan terjadi dalam konteks event_latihan
ALTER TABLE scan_records
  ADD COLUMN IF NOT EXISTS latihan_id UUID REFERENCES event_latihan(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scan_latihan ON scan_records(latihan_id)
  WHERE latihan_id IS NOT NULL;

-- ── 3. Fungsi atomik: process_misa_besar_scan ─────────────────
-- Dipanggil setelah scan_records berhasil di-insert.
-- Tugas: update event_latihan_attendance sesuai mode_latihan.
--
-- Kembalikan JSON berisi jumlah session yang ditandai:
--   { "mode": "gabung"|"terpisah", "marked": N, "latihan_ids": [...] }

CREATE OR REPLACE FUNCTION process_misa_besar_scan(
  p_scan_record_id  UUID,     -- ID scan yang baru diinsert
  p_event_id        UUID,     -- events.id
  p_user_id         UUID,     -- user yang discan
  p_scanner_id      UUID,     -- user yang melakukan scan
  p_latihan_id      UUID      -- NULL = gabung auto-resolve, filled = terpisah
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode        VARCHAR(10);
  v_today       DATE := CURRENT_DATE;
  v_row         RECORD;
  v_ids         UUID[] := '{}';
  v_marked      INTEGER := 0;
BEGIN
  -- Ambil mode event
  SELECT mode_latihan INTO v_mode
  FROM events WHERE id = p_event_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event tidak ditemukan');
  END IF;

  IF v_mode = 'gabung' THEN
    -- Gabung: tandai SEMUA sesi latihan pada hari ini untuk event ini
    FOR v_row IN
      SELECT id FROM event_latihan
      WHERE event_id = p_event_id
        AND tanggal = v_today
    LOOP
      INSERT INTO event_latihan_attendance (latihan_id, user_id, hadir, marked_by)
        VALUES (v_row.id, p_user_id, TRUE, p_scanner_id)
        ON CONFLICT (latihan_id, user_id)
        DO UPDATE SET hadir = TRUE, marked_by = p_scanner_id, marked_at = NOW();

      v_ids    := array_append(v_ids, v_row.id);
      v_marked := v_marked + 1;
    END LOOP;

    -- Update scan_record dengan latihan_id pertama (representatif)
    IF array_length(v_ids, 1) > 0 THEN
      UPDATE scan_records
        SET latihan_id = v_ids[1]
      WHERE id = p_scan_record_id;
    END IF;

  ELSE
    -- Terpisah: hanya tandai sesi yang diberikan (p_latihan_id)
    IF p_latihan_id IS NULL THEN
      -- Auto-resolve: cari sesi terdekat waktunya hari ini
      SELECT id INTO v_row
      FROM event_latihan
      WHERE event_id = p_event_id
        AND tanggal = v_today
      ORDER BY jam ASC
      LIMIT 1;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tidak ada sesi latihan hari ini');
      END IF;

      INSERT INTO event_latihan_attendance (latihan_id, user_id, hadir, marked_by)
        VALUES (v_row.id, p_user_id, TRUE, p_scanner_id)
        ON CONFLICT (latihan_id, user_id)
        DO UPDATE SET hadir = TRUE, marked_by = p_scanner_id, marked_at = NOW();

      v_ids    := ARRAY[v_row.id];
      v_marked := 1;

      UPDATE scan_records SET latihan_id = v_row.id WHERE id = p_scan_record_id;

    ELSE
      -- latihan_id eksplisit diberikan
      INSERT INTO event_latihan_attendance (latihan_id, user_id, hadir, marked_by)
        VALUES (p_latihan_id, p_user_id, TRUE, p_scanner_id)
        ON CONFLICT (latihan_id, user_id)
        DO UPDATE SET hadir = TRUE, marked_by = p_scanner_id, marked_at = NOW();

      v_ids    := ARRAY[p_latihan_id];
      v_marked := 1;

      UPDATE scan_records SET latihan_id = p_latihan_id WHERE id = p_scan_record_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',          true,
    'mode',        v_mode,
    'marked',      v_marked,
    'latihan_ids', to_jsonb(v_ids)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION process_misa_besar_scan(UUID,UUID,UUID,UUID,UUID) TO authenticated;

-- ── 4. Verifikasi ──────────────────────────────────────────────
SELECT
  column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'events'
  AND column_name = 'mode_latihan';

SELECT
  column_name
FROM information_schema.columns
WHERE table_name = 'scan_records'
  AND column_name = 'latihan_id';
