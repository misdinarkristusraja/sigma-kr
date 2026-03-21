-- ============================================================
-- SIGMA — Supabase PostgreSQL Migration
-- v1.2 Final | Paroki Kristus Raja Solo Baru
-- Run di: Supabase Dashboard → SQL Editor
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUM TYPES
-- ============================================================
CREATE TYPE user_role   AS ENUM ('Administrator','Pengurus','Pelatih','Misdinar_Aktif','Misdinar_Retired');
CREATE TYPE user_status AS ENUM ('Active','Pending','Retired','Suspended');
CREATE TYPE event_type  AS ENUM ('Mingguan','Jumper','Sabtu_Imam','Misa_Khusus','Misa_Harian','Latihan');
CREATE TYPE event_status AS ENUM ('Akan_Datang','Berlangsung','Sudah_Lewat');
CREATE TYPE scan_type_enum AS ENUM ('tugas','latihan','walkin_tugas','walkin_latihan');
CREATE TYPE swap_status AS ENUM ('Pending','Approved_PIC','Rejected_PIC','Replaced','Offered','Expired');
CREATE TYPE optin_status AS ENUM ('Bisa','Tidak_Bisa','Pas_Libur');
CREATE TYPE qr_version  AS ENUM ('legacy','new');

-- ============================================================
-- TABLE: users
-- ============================================================
CREATE TABLE users (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nickname             VARCHAR(50)  NOT NULL UNIQUE,
  myid                 VARCHAR(10)  NOT NULL UNIQUE,
  nama_lengkap         VARCHAR(200) NOT NULL,
  nama_panggilan       VARCHAR(100) NOT NULL,
  tanggal_lahir        DATE,
  pendidikan           VARCHAR(10)  CHECK (pendidikan IN ('SD','SMP','SMA','SMK','Lulus')),
  sekolah              VARCHAR(200),
  is_tarakanita        BOOLEAN NOT NULL DEFAULT FALSE,
  wilayah              VARCHAR(100),
  lingkungan           VARCHAR(100) NOT NULL DEFAULT '',
  email                VARCHAR(200) NOT NULL UNIQUE,
  password_hash        VARCHAR(255),
  hp_anak              TEXT,    -- encrypted in application layer
  hp_ortu              TEXT,    -- encrypted in application layer
  nama_ayah            VARCHAR(200),
  nama_ibu             VARCHAR(200),
  alamat               VARCHAR(500),
  alasan_masuk         TEXT,
  sampai_kapan         TEXT,
  role                 user_role   NOT NULL DEFAULT 'Misdinar_Aktif',
  status               user_status NOT NULL DEFAULT 'Pending',
  is_suspended         BOOLEAN NOT NULL DEFAULT FALSE,
  suspended_until      DATE,
  surat_pernyataan_url TEXT,
  foto_url             TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_nickname  ON users (nickname);
CREATE INDEX idx_users_myid      ON users (myid);
CREATE INDEX idx_users_lingkungan ON users (lingkungan);
CREATE INDEX idx_users_status    ON users (status);

-- ============================================================
-- TABLE: registrations (pending sign-ups before approval)
-- ============================================================
CREATE TABLE registrations (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nickname             VARCHAR(50)  NOT NULL UNIQUE,
  nama_lengkap         VARCHAR(200) NOT NULL,
  tanggal_lahir        DATE,
  alamat               VARCHAR(500),
  lingkungan           VARCHAR(100),
  wilayah              VARCHAR(100),
  pendidikan           VARCHAR(10),
  sekolah              VARCHAR(200),
  is_tarakanita        BOOLEAN NOT NULL DEFAULT FALSE,
  hp_anak              TEXT,
  hp_ortu              TEXT,
  hp_milik             VARCHAR(20),
  nama_ayah            VARCHAR(200),
  nama_ibu             VARCHAR(200),
  alasan_masuk         TEXT,
  sampai_kapan         TEXT,
  surat_pernyataan_url TEXT,
  email                VARCHAR(200),
  status               VARCHAR(20) NOT NULL DEFAULT 'Pending',
  approved_at          TIMESTAMPTZ,
  rejected_at          TIMESTAMPTZ,
  reject_reason        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: events
-- ============================================================
CREATE TABLE events (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nama_event           VARCHAR(200) NOT NULL,
  tipe_event           event_type   NOT NULL,
  tanggal_tugas        DATE         NOT NULL,
  tanggal_latihan      DATE,
  hari                 VARCHAR(10),
  perayaan             VARCHAR(300),
  warna_liturgi        VARCHAR(20)  CHECK (warna_liturgi IN ('Hijau','Merah','Putih','Ungu','MerahMuda','Hitam')),
  jumlah_misa          INTEGER NOT NULL DEFAULT 4,
  status_event         event_status NOT NULL DEFAULT 'Akan_Datang',
  -- PIC pasangan (nickname)
  pic_slot_1a          VARCHAR(50),
  pic_slot_1b          VARCHAR(50),
  pic_hp_slot_1a       VARCHAR(20),
  pic_hp_slot_1b       VARCHAR(20),
  pic_slot_2a          VARCHAR(50),
  pic_slot_2b          VARCHAR(50),
  pic_hp_slot_2a       VARCHAR(20),
  pic_hp_slot_2b       VARCHAR(20),
  pic_slot_3a          VARCHAR(50),
  pic_slot_3b          VARCHAR(50),
  pic_hp_slot_3a       VARCHAR(20),
  pic_hp_slot_3b       VARCHAR(20),
  pic_slot_4a          VARCHAR(50),
  pic_slot_4b          VARCHAR(50),
  pic_hp_slot_4a       VARCHAR(20),
  pic_hp_slot_4b       VARCHAR(20),
  pic_harian           VARCHAR(50),
  gcatholic_fetched    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_tanggal  ON events (tanggal_tugas);
CREATE INDEX idx_events_tipe     ON events (tipe_event);
CREATE INDEX idx_events_status   ON events (status_event);

-- ============================================================
-- TABLE: assignments
-- ============================================================
CREATE TABLE assignments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  slot_number  INTEGER CHECK (slot_number BETWEEN 1 AND 4),
  position     INTEGER DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX idx_assignments_event ON assignments (event_id);
CREATE INDEX idx_assignments_user  ON assignments (user_id);

-- ============================================================
-- TABLE: misa_harian_availability
-- ============================================================
CREATE TABLE misa_harian_availability (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tahun               INTEGER NOT NULL,
  bulan               INTEGER NOT NULL CHECK (bulan BETWEEN 1 AND 12),
  status              optin_status NOT NULL DEFAULT 'Tidak_Bisa',
  tanggal_tidak_bisa  TEXT[],
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tahun, bulan)
);

-- ============================================================
-- TABLE: scan_records
-- ============================================================
CREATE TABLE scan_records (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id         UUID REFERENCES events(id) ON DELETE SET NULL,
  scanner_user_id  UUID NOT NULL REFERENCES users(id),
  scan_type        scan_type_enum NOT NULL,
  is_walk_in       BOOLEAN NOT NULL DEFAULT FALSE,
  walkin_reason    VARCHAR(100),
  timestamp        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  qr_version       qr_version NOT NULL DEFAULT 'new',
  raw_qr_value     TEXT,
  is_anomaly       BOOLEAN NOT NULL DEFAULT FALSE,
  anomaly_reason   TEXT
);

CREATE INDEX idx_scan_user      ON scan_records (user_id);
CREATE INDEX idx_scan_timestamp ON scan_records (timestamp);
CREATE INDEX idx_scan_event     ON scan_records (event_id);

-- ============================================================
-- TABLE: swap_requests
-- ============================================================
CREATE TABLE swap_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_id   UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  alasan          TEXT NOT NULL,
  pic_user_id     UUID REFERENCES users(id),
  pic_wa_link     TEXT,
  status          swap_status NOT NULL DEFAULT 'Pending',
  pengganti_id    UUID REFERENCES users(id),
  pic_approved_at TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL,
  is_penawaran    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_swap_requester  ON swap_requests (requester_id);
CREATE INDEX idx_swap_status     ON swap_requests (status);
CREATE INDEX idx_swap_penawaran  ON swap_requests (is_penawaran) WHERE is_penawaran = TRUE;

-- ============================================================
-- TABLE: rekap_poin_mingguan
-- ============================================================
CREATE TABLE rekap_poin_mingguan (
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start        DATE NOT NULL,
  week_end          DATE NOT NULL,
  is_dijadwalkan    BOOLEAN NOT NULL DEFAULT FALSE,
  is_hadir_tugas    BOOLEAN NOT NULL DEFAULT FALSE,
  is_hadir_latihan  BOOLEAN NOT NULL DEFAULT FALSE,
  is_walk_in        BOOLEAN NOT NULL DEFAULT FALSE,
  poin              INTEGER NOT NULL DEFAULT 0,
  kondisi           VARCHAR(5),
  last_updated      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, week_start)
);

CREATE INDEX idx_rekap_user     ON rekap_poin_mingguan (user_id);
CREATE INDEX idx_rekap_week     ON rekap_poin_mingguan (week_start);

-- ============================================================
-- TABLE: rekap_poin_harian
-- ============================================================
CREATE TABLE rekap_poin_harian (
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bulan              INTEGER NOT NULL CHECK (bulan BETWEEN 1 AND 12),
  tahun              INTEGER NOT NULL,
  count_hadir_harian INTEGER NOT NULL DEFAULT 0,
  poin_harian        INTEGER NOT NULL DEFAULT 0,
  last_updated       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, tahun, bulan)
);

-- ============================================================
-- TABLE: system_config
-- ============================================================
CREATE TABLE system_config (
  key          VARCHAR(100) PRIMARY KEY,
  value        TEXT NOT NULL,
  description  VARCHAR(300),
  updated_by   UUID REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default configs
INSERT INTO system_config (key, value, description) VALUES
  ('window_optin_harian_start', '10',  'Tanggal mulai window opt-in Misa Harian per bulan'),
  ('window_optin_harian_end',   '20',  'Tanggal akhir window opt-in'),
  ('max_absen_before_suspend',  '3',   'Absen berturut sebelum suspend'),
  ('suspend_duration_days',     '30',  'Durasi suspend dalam hari'),
  ('prioritas_sma_smk_interval','3',   'Setiap N bulan ada 1 minggu prioritas SMA/SMK'),
  ('swap_expire_hours',         '24',  'Jam deadline PIC approve request tukar'),
  ('gcatholic_url',             'https://gcatholic.org/calendar/{YEAR}/ID-id', 'URL gcatholic.org'),
  ('max_hari_tanpa_jadwal',     '60',  'Maks hari tanpa jadwal sebelum wajib masuk bulan berikutnya');

-- ============================================================
-- TABLE: audit_logs
-- ============================================================
CREATE TABLE audit_logs (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id   UUID REFERENCES users(id),
  action     VARCHAR(50) NOT NULL,
  target_id  UUID,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_actor  ON audit_logs (actor_id);
CREATE INDEX idx_audit_action ON audit_logs (action);
CREATE INDEX idx_audit_time   ON audit_logs (created_at);

-- ============================================================
-- UPDATED_AT trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated  BEFORE UPDATE ON users  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_events_updated BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- FUNCTION: Hitung Poin (6 kondisi)
-- ============================================================
CREATE OR REPLACE FUNCTION hitung_poin_kondisi(
  p_dijadwalkan BOOLEAN,
  p_hadir_tugas BOOLEAN,
  p_hadir_latihan BOOLEAN,
  p_walk_in BOOLEAN
) RETURNS TABLE(poin INTEGER, kondisi VARCHAR) AS $$
BEGIN
  IF p_dijadwalkan AND p_hadir_tugas AND p_hadir_latihan THEN RETURN QUERY SELECT 2, 'K1'::VARCHAR;
  ELSIF NOT p_dijadwalkan AND p_walk_in AND p_hadir_latihan THEN RETURN QUERY SELECT 3, 'K2'::VARCHAR;
  ELSIF p_dijadwalkan AND p_hadir_tugas AND NOT p_hadir_latihan THEN RETURN QUERY SELECT 1, 'K3'::VARCHAR;
  ELSIF NOT p_dijadwalkan AND p_walk_in AND NOT p_hadir_latihan THEN RETURN QUERY SELECT 2, 'K4'::VARCHAR;
  ELSIF NOT p_dijadwalkan AND NOT p_walk_in AND p_hadir_latihan THEN RETURN QUERY SELECT 1, 'K5'::VARCHAR;
  ELSIF p_dijadwalkan AND NOT p_hadir_tugas THEN RETURN QUERY SELECT -1, 'K6'::VARCHAR;
  ELSE RETURN QUERY SELECT 0, NULL::VARCHAR;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCTION: Update rekap poin harian (dipanggil cron 19:00)
-- ============================================================
CREATE OR REPLACE FUNCTION update_rekap_poin()
RETURNS void AS $$
DECLARE
  r RECORD;
  v_week_start DATE;
  v_week_end   DATE;
  v_poin       INTEGER;
  v_kondisi    VARCHAR;
  v_dijadwalkan BOOLEAN;
  v_hadir_tugas BOOLEAN;
  v_hadir_latihan BOOLEAN;
  v_walk_in    BOOLEAN;
BEGIN
  -- For each user with scan records since yesterday
  FOR r IN
    SELECT DISTINCT sr.user_id,
      DATE_TRUNC('day', sr.timestamp AT TIME ZONE 'Asia/Jakarta')::DATE as scan_date
    FROM scan_records sr
    WHERE sr.timestamp >= NOW() - INTERVAL '2 days'
  LOOP
    -- Get week period (Saturday 07:00 WIB)
    v_week_start := r.scan_date - ((EXTRACT(DOW FROM r.scan_date)::INTEGER + 1) % 7) * INTERVAL '1 day';
    IF EXTRACT(DOW FROM r.scan_date) = 6 AND
       EXTRACT(HOUR FROM r.scan_date::TIMESTAMPTZ AT TIME ZONE 'Asia/Jakarta') >= 7 THEN
      v_week_start := r.scan_date;
    END IF;
    v_week_end := v_week_start + INTERVAL '7 days' - INTERVAL '1 second';

    -- Check if dijadwalkan
    SELECT EXISTS (
      SELECT 1 FROM assignments a
      JOIN events e ON a.event_id = e.id
      WHERE a.user_id = r.user_id
        AND e.tanggal_tugas BETWEEN v_week_start AND v_week_start + INTERVAL '7 days'
        AND e.tipe_event != 'Misa_Harian'
    ) INTO v_dijadwalkan;

    -- Check hadir tugas
    SELECT EXISTS (
      SELECT 1 FROM scan_records
      WHERE user_id = r.user_id
        AND scan_type IN ('tugas','walkin_tugas')
        AND timestamp BETWEEN v_week_start AND v_week_end
    ) INTO v_hadir_tugas;

    -- Check hadir latihan
    SELECT EXISTS (
      SELECT 1 FROM scan_records
      WHERE user_id = r.user_id
        AND scan_type IN ('latihan','walkin_latihan')
        AND timestamp BETWEEN v_week_start AND v_week_end
    ) INTO v_hadir_latihan;

    -- Check walk-in
    SELECT EXISTS (
      SELECT 1 FROM scan_records
      WHERE user_id = r.user_id
        AND is_walk_in = TRUE
        AND timestamp BETWEEN v_week_start AND v_week_end
    ) INTO v_walk_in;

    -- Calculate poin
    SELECT p.poin, p.kondisi INTO v_poin, v_kondisi
    FROM hitung_poin_kondisi(v_dijadwalkan, v_hadir_tugas, v_hadir_latihan, v_walk_in) p;

    -- Upsert rekap_poin_mingguan
    INSERT INTO rekap_poin_mingguan (user_id, week_start, week_end, is_dijadwalkan, is_hadir_tugas, is_hadir_latihan, is_walk_in, poin, kondisi, last_updated)
    VALUES (r.user_id, v_week_start, v_week_end::DATE, v_dijadwalkan, v_hadir_tugas, v_hadir_latihan, v_walk_in, v_poin, v_kondisi, NOW())
    ON CONFLICT (user_id, week_start) DO UPDATE SET
      is_dijadwalkan  = EXCLUDED.is_dijadwalkan,
      is_hadir_tugas  = EXCLUDED.is_hadir_tugas,
      is_hadir_latihan = EXCLUDED.is_hadir_latihan,
      is_walk_in      = EXCLUDED.is_walk_in,
      poin            = EXCLUDED.poin,
      kondisi         = EXCLUDED.kondisi,
      last_updated    = NOW();
  END LOOP;

  -- Update suspend check: K6 berturut-turut
  UPDATE users u SET
    is_suspended   = TRUE,
    suspended_until = (NOW() + INTERVAL '30 days')::DATE
  WHERE (
    SELECT COUNT(*) FROM (
      SELECT 1 FROM rekap_poin_mingguan rpm
      WHERE rpm.user_id = u.id AND rpm.kondisi = 'K6'
      ORDER BY rpm.week_start DESC LIMIT 3
    ) x
  ) >= (SELECT value::INTEGER FROM system_config WHERE key = 'max_absen_before_suspend');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RLS: Row Level Security
-- ============================================================
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE swap_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rekap_poin_mingguan ENABLE ROW LEVEL SECURITY;
ALTER TABLE rekap_poin_harian  ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE misa_harian_availability ENABLE ROW LEVEL SECURITY;

-- Users: lihat semua aktif, edit diri sendiri, admin bisa semua
CREATE POLICY users_select ON users FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY users_update_self ON users FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY users_admin ON users FOR ALL
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus'))
  );

-- Events: read all, write = pengurus+
CREATE POLICY events_read ON events FOR SELECT USING (TRUE);
CREATE POLICY events_write ON events FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus')));

-- Assignments: read all, write = pengurus+
CREATE POLICY assign_read  ON assignments FOR SELECT USING (TRUE);
CREATE POLICY assign_write ON assignments FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus')));

-- Scan records: pelatih+ bisa insert, admin bisa semua
CREATE POLICY scan_insert ON scan_records FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus','Pelatih')));
CREATE POLICY scan_read ON scan_records FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus','Pelatih')));

-- Swap requests: user bisa lihat semua, insert sendiri
CREATE POLICY swap_select ON swap_requests FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY swap_insert ON swap_requests FOR INSERT WITH CHECK (auth.uid() = requester_id);
CREATE POLICY swap_update ON swap_requests FOR UPDATE
  USING (auth.uid() = requester_id OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus')));

-- Rekap: semua bisa baca, sistem yang nulis (via service role)
CREATE POLICY rekap_read ON rekap_poin_mingguan FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY rekap_harian_read ON rekap_poin_harian FOR SELECT USING (auth.uid() IS NOT NULL);

-- System config: admin only
CREATE POLICY config_read  ON system_config FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'Administrator'));
CREATE POLICY config_write ON system_config FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'Administrator'));

-- Availability: user bisa lihat & edit sendiri, pengurus bisa semua
CREATE POLICY avail_self ON misa_harian_availability FOR ALL USING (auth.uid() = user_id);
CREATE POLICY avail_pengurus ON misa_harian_availability FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('Administrator','Pengurus')));

-- ============================================================
-- Supabase Storage buckets
-- ============================================================
-- Run in Dashboard or via API:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', FALSE);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('exports', 'exports', FALSE);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('profile-photos', 'profile-photos', FALSE);
