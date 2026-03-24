-- ═══════════════════════════════════════════════════════════════
-- Migration 008: Notifikasi, Streak, Latihan Multi-waktu
-- ═══════════════════════════════════════════════════════════════

-- 1. Tabel notifikasi in-app
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         VARCHAR(50) NOT NULL, -- 'jadwal_reminder','swap_request','streak','laporan','info'
  title        VARCHAR(200) NOT NULL,
  body         TEXT,
  is_read      BOOLEAN NOT NULL DEFAULT FALSE,
  link         VARCHAR(200), -- optional deep link path
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, created_at DESC);

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "User sees own notifs" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "User marks own read" ON notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admin can insert" ON notifications FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus'))
  OR auth.uid() = user_id
);
CREATE POLICY "Service role full" ON notifications FOR ALL TO service_role USING (true);

-- 2. Tabel streak
CREATE TABLE IF NOT EXISTS streaks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  current_streak    INTEGER NOT NULL DEFAULT 0, -- berapa minggu berturut-turut K1
  longest_streak    INTEGER NOT NULL DEFAULT 0,
  last_k1_week      DATE,    -- week_start tanggal K1 terakhir
  streak_broken_at  DATE,    -- kapan streak putus
  is_published      BOOLEAN NOT NULL DEFAULT FALSE, -- false = hidden until April 15
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE streaks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "User sees own streak" ON streaks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full" ON streaks FOR ALL TO service_role USING (true);
CREATE POLICY "Admin sees all" ON streaks FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus','Pelatih'))
);

-- 3. Kolom latihan_times untuk misa khusus (array jam latihan)
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS latihan_times  TEXT[],  -- ['08.00','10.00','17.30']
  ADD COLUMN IF NOT EXISTS latihan_notes  TEXT;    -- catatan tambahan jadwal latihan

-- 4. Function: hitung dan update streak semua user
CREATE OR REPLACE FUNCTION recalculate_streaks()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user RECORD;
  v_weeks DATE[];
  v_streak INT;
  v_longest INT;
  v_last_k1 DATE;
  v_prev_week DATE;
  v_cur_week DATE;
  i INT;
BEGIN
  FOR v_user IN SELECT id FROM users WHERE status='Active' AND role IN ('Misdinar_Aktif','Misdinar_Retired') LOOP
    -- Get sorted K1 week_starts (from rekap_poin_mingguan where kondisi=K1 or K2)
    SELECT ARRAY_AGG(week_start ORDER BY week_start)
    INTO v_weeks
    FROM rekap_poin_mingguan
    WHERE user_id = v_user.id
      AND kondisi IN ('K1','K2','K3') -- K1+K2+K3 = hadir (tidak absen)
      AND tanggal_tugas <= CURRENT_DATE;

    v_streak := 0; v_longest := 0; v_last_k1 := NULL;

    IF v_weeks IS NOT NULL AND array_length(v_weeks, 1) > 0 THEN
      v_streak := 1;
      v_last_k1 := v_weeks[array_length(v_weeks,1)];
      FOR i IN 2..array_length(v_weeks,1) LOOP
        v_prev_week := v_weeks[i-1];
        v_cur_week  := v_weeks[i];
        -- Consecutive = prev + 7 days
        IF v_cur_week = v_prev_week + INTERVAL '7 days' THEN
          v_streak := v_streak + 1;
        ELSE
          v_longest := GREATEST(v_longest, v_streak);
          v_streak := 1;
        END IF;
      END LOOP;
      v_longest := GREATEST(v_longest, v_streak);
    END IF;

    INSERT INTO streaks(user_id, current_streak, longest_streak, last_k1_week, updated_at)
    VALUES (v_user.id, v_streak, v_longest, v_last_k1, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      current_streak = EXCLUDED.current_streak,
      longest_streak = EXCLUDED.longest_streak,
      last_k1_week   = EXCLUDED.last_k1_week,
      updated_at     = NOW();
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION recalculate_streaks() TO service_role;
