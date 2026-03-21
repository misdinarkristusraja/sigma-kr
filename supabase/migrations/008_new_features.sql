-- ============================================================
-- SIGMA Migration 008: Fitur Baru v1.3
-- 1. Notifikasi In-App  2. Laporan Bulanan
-- 3. Latihan Misa Khusus Multi-Slot  4. Streak & Gamifikasi
-- ============================================================

-- 1. NOTIFIKASI IN-APP
CREATE TABLE IF NOT EXISTS in_app_notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'pengumuman',
  data        JSONB DEFAULT '{}',
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_user_unread ON in_app_notifications(user_id, is_read, created_at DESC);
ALTER TABLE in_app_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_select" ON in_app_notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notif_update" ON in_app_notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "notif_insert" ON in_app_notifications FOR INSERT WITH CHECK (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus'))
  )
);
GRANT ALL ON in_app_notifications TO authenticated, service_role;

-- 2. LAPORAN BULANAN
CREATE TABLE IF NOT EXISTS monthly_reports (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bulan        INTEGER NOT NULL CHECK (bulan BETWEEN 1 AND 12),
  tahun        INTEGER NOT NULL,
  generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_snapshot JSONB NOT NULL DEFAULT '{}',
  catatan      TEXT,
  UNIQUE (bulan, tahun)
);
ALTER TABLE monthly_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "laporan_rw" ON monthly_reports USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus'))
);
GRANT ALL ON monthly_reports TO authenticated, service_role;

-- 3. LATIHAN MISA KHUSUS MULTI-SLOT
CREATE TABLE IF NOT EXISTS special_mass_sessions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nama_acara VARCHAR(200) NOT NULL,
  deskripsi  TEXT,
  jenis      VARCHAR(50)  NOT NULL DEFAULT 'Misa Khusus',
  tanggal    DATE         NOT NULL,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS special_mass_slots (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id    UUID NOT NULL REFERENCES special_mass_sessions(id) ON DELETE CASCADE,
  nama_slot     VARCHAR(100) NOT NULL,
  tanggal       DATE         NOT NULL,
  waktu_mulai   TIME         NOT NULL,
  waktu_selesai TIME,
  lokasi        VARCHAR(200) DEFAULT 'Gereja Kristus Raja Solo Baru',
  keterangan    TEXT,
  is_wajib      BOOLEAN      NOT NULL DEFAULT FALSE,
  urutan        INTEGER      NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS special_mass_attendance (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slot_id      UUID NOT NULL REFERENCES special_mass_slots(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hadir        BOOLEAN NOT NULL DEFAULT FALSE,
  keterangan   TEXT,
  dicatat_oleh UUID REFERENCES users(id),
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (slot_id, user_id)
);
ALTER TABLE special_mass_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sms_sel"   ON special_mass_sessions FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "sms_write" ON special_mass_sessions FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus','Pelatih')));
ALTER TABLE special_mass_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "smsl_sel"   ON special_mass_slots FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "smsl_write" ON special_mass_slots FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus','Pelatih')));
ALTER TABLE special_mass_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "smat_sel"   ON special_mass_attendance FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "smat_write" ON special_mass_attendance FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus','Pelatih')));
GRANT ALL ON special_mass_sessions   TO authenticated, service_role;
GRANT ALL ON special_mass_slots      TO authenticated, service_role;
GRANT ALL ON special_mass_attendance TO authenticated, service_role;

-- 4. STREAK & GAMIFIKASI (hidden by default)
INSERT INTO system_config (key, value, description) VALUES
  ('streak_feature_enabled', 'false', 'Tampilkan fitur streak ke anggota (aktifkan pertengahan April)')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_streaks (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_streak      INTEGER NOT NULL DEFAULT 0,
  longest_streak      INTEGER NOT NULL DEFAULT 0,
  last_attended_date  DATE,
  total_hadir_wajib   INTEGER NOT NULL DEFAULT 0,
  streak_broken_count INTEGER NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);
CREATE TABLE IF NOT EXISTS streak_badges (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kode         VARCHAR(30) UNIQUE NOT NULL,
  nama         VARCHAR(100) NOT NULL,
  deskripsi    TEXT,
  icon         VARCHAR(10),
  syarat_type  VARCHAR(20) NOT NULL,
  syarat_nilai INTEGER NOT NULL,
  warna_bg     VARCHAR(30) DEFAULT 'bg-yellow-100',
  warna_text   VARCHAR(30) DEFAULT 'text-yellow-800',
  urutan       INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS user_badges (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id    UUID NOT NULL REFERENCES streak_badges(id) ON DELETE CASCADE,
  diraih_pada TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, badge_id)
);
ALTER TABLE user_streaks  ENABLE ROW LEVEL SECURITY;
CREATE POLICY "str_sel" ON user_streaks  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "str_wrt" ON user_streaks  FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus')));
ALTER TABLE streak_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sbdg_sel" ON streak_badges FOR SELECT USING (auth.uid() IS NOT NULL);
ALTER TABLE user_badges   ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ubdg_sel" ON user_badges   FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "ubdg_wrt" ON user_badges   FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus')));
GRANT ALL ON user_streaks    TO authenticated, service_role;
GRANT ALL ON streak_badges   TO authenticated, service_role;
GRANT ALL ON user_badges     TO authenticated, service_role;

INSERT INTO streak_badges (kode, nama, deskripsi, icon, syarat_type, syarat_nilai, warna_bg, warna_text, urutan) VALUES
  ('streak_2',  'Taat Pemula',      '2 minggu hadir berturut-turut',     '🔥','streak',      2,  'bg-orange-100','text-orange-800',1),
  ('streak_4',  'Pelayan Setia',    '4 minggu hadir berturut-turut',     '⭐','streak',      4,  'bg-yellow-100','text-yellow-800',2),
  ('streak_8',  'Misdinar Andalan', '8 minggu hadir berturut-turut',     '🏆','streak',      8,  'bg-amber-100', 'text-amber-800', 3),
  ('streak_12', 'Dedikasi Penuh',   '12 minggu hadir berturut-turut',    '👑','streak',      12, 'bg-red-100',   'text-red-800',   4),
  ('streak_26', 'Separuh Tahun',    '26 minggu hadir berturut-turut',    '💎','streak',      26, 'bg-purple-100','text-purple-800',5),
  ('hadir_10',  'Aktif',            '10 kali hadir tugas/latihan wajib', '✅','total_hadir', 10, 'bg-green-100', 'text-green-800', 6),
  ('hadir_25',  'Rajin',            '25 kali hadir tugas/latihan wajib', '🌟','total_hadir', 25, 'bg-blue-100',  'text-blue-800',  7),
  ('hadir_50',  'Veteran Misdinar', '50 kali hadir tugas/latihan wajib', '🎖️','total_hadir',50, 'bg-indigo-100','text-indigo-800',8)
ON CONFLICT (kode) DO NOTHING;

-- Fungsi hitung ulang streak (dipanggil manual dari AdminPage)
CREATE OR REPLACE FUNCTION recalculate_all_streaks()
RETURNS TEXT AS $$
DECLARE
  v_user RECORD; v_dates DATE[]; v_current INT; v_longest INT;
  v_total INT; v_broken INT; v_last DATE; i INT; v_count INT := 0;
BEGIN
  FOR v_user IN SELECT id FROM users WHERE status='Active' AND role LIKE 'Misdinar%' LOOP
    SELECT ARRAY_AGG(DISTINCT tgl ORDER BY tgl) INTO v_dates FROM (
      SELECT r.week_start::DATE AS tgl FROM rekap_poin_mingguan r
        WHERE r.user_id = v_user.id AND r.is_hadir_tugas = TRUE
      UNION ALL
      SELECT sl.tanggal AS tgl FROM special_mass_attendance sma
        JOIN special_mass_slots sl ON sl.id = sma.slot_id
        WHERE sma.user_id = v_user.id AND sma.hadir = TRUE AND sl.is_wajib = TRUE
    ) x;
    v_current:=0; v_longest:=0; v_broken:=0; v_total:=0; v_last:=NULL;
    IF v_dates IS NOT NULL THEN
      v_total := array_length(v_dates,1);
      FOR i IN 1..array_length(v_dates,1) LOOP
        IF v_last IS NULL THEN v_current:=1;
        ELSIF v_dates[i]-v_last<=14 THEN v_current:=v_current+1;
        ELSE IF v_current>0 THEN v_broken:=v_broken+1; END IF; v_current:=1;
        END IF;
        IF v_current>v_longest THEN v_longest:=v_current; END IF;
        v_last:=v_dates[i];
      END LOOP;
    END IF;
    INSERT INTO user_streaks(user_id,current_streak,longest_streak,last_attended_date,total_hadir_wajib,streak_broken_count,updated_at)
    VALUES(v_user.id,v_current,v_longest,v_last,v_total,v_broken,NOW())
    ON CONFLICT(user_id) DO UPDATE SET
      current_streak=EXCLUDED.current_streak, longest_streak=EXCLUDED.longest_streak,
      last_attended_date=EXCLUDED.last_attended_date, total_hadir_wajib=EXCLUDED.total_hadir_wajib,
      streak_broken_count=EXCLUDED.streak_broken_count, updated_at=NOW();
    -- Award badges
    INSERT INTO user_badges(user_id,badge_id)
    SELECT v_user.id,sb.id FROM streak_badges sb
    WHERE (sb.syarat_type='streak' AND sb.syarat_nilai<=v_longest)
       OR (sb.syarat_type='total_hadir' AND sb.syarat_nilai<=v_total)
    ON CONFLICT(user_id,badge_id) DO NOTHING;
    v_count := v_count+1;
  END LOOP;
  RETURN 'Streak diperbarui untuk '||v_count||' anggota';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION recalculate_all_streaks() TO authenticated, service_role;
