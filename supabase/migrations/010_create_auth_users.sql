-- ================================================================
-- SIGMA Migration 010: Buat auth.users untuk semua anggota
-- + Password auto-generate acak
--
-- MASALAH: 131 anggota ada di public.users tapi TIDAK ADA
-- di auth.users → tidak ada yang bisa login
--
-- FIX: INSERT ke auth.users, password acak per anggota
-- Anggota lama: data nickname/MyID TIDAK diubah
-- ================================================================

-- ── STEP 1: Helper function generate password acak ─────────────
-- Karakter: huruf kecil + angka, skip 0/O/l/I agar mudah dibaca
CREATE OR REPLACE FUNCTION _sigma_gen_password(len INT DEFAULT 10)
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'abcdefghjkmnpqrstuvwxyz23456789';
  result TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..len LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;


-- ── STEP 2: Buat tabel sementara untuk simpan password ─────────
-- (Supaya bisa ditampilkan setelah INSERT)
CREATE TEMP TABLE _pw_results (
  nickname      TEXT,
  nama_panggilan TEXT,
  email         TEXT,
  password_baru TEXT,
  hp_ortu       TEXT
);


-- ── STEP 3: INSERT ke auth.users + catat password ──────────────
DO $$
DECLARE
  r       RECORD;
  pw      TEXT;
  inst_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
  FOR r IN
    SELECT pu.id, pu.email, pu.nickname, pu.nama_panggilan, pu.hp_ortu, pu.hp_anak
    FROM public.users pu
    WHERE NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = pu.id)
      AND pu.status IN ('Active', 'Pending')
    ORDER BY pu.nama_panggilan
  LOOP
    pw := _sigma_gen_password(10);

    INSERT INTO auth.users (
      id, instance_id, email,
      encrypted_password,
      email_confirmed_at, created_at, updated_at,
      aud, role,
      raw_app_meta_data, raw_user_meta_data,
      is_super_admin,
      confirmation_token, email_change_token_new, recovery_token
    ) VALUES (
      r.id, inst_id, r.email,
      crypt(pw, gen_salt('bf', 10)),
      NOW(), NOW(), NOW(),
      'authenticated', 'authenticated',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      false, '', '', ''
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO _pw_results VALUES (
      r.nickname, r.nama_panggilan, r.email, pw,
      COALESCE(r.hp_ortu, r.hp_anak, '')
    );
  END LOOP;
END;
$$;


-- ── STEP 4: Tandai semua wajib ganti password ──────────────────
UPDATE public.users
SET must_change_password = TRUE, updated_at = NOW()
WHERE status = 'Active';


-- ── STEP 5: Tampilkan daftar username + password baru ──────────
-- SCREENSHOT INI — kirimkan ke masing-masing anggota via WA

SELECT
  nickname        AS username,
  nama_panggilan  AS nama,
  email,
  password_baru   AS password,
  hp_ortu         AS hp
FROM _pw_results
ORDER BY nama_panggilan;


-- ── STEP 6: Verifikasi akhir ────────────────────────────────────
SELECT
  'Berhasil dibuat'  AS status,
  COUNT(*)           AS jumlah
FROM _pw_results
UNION ALL
SELECT
  'Masih missing',
  COUNT(*)
FROM public.users pu
LEFT JOIN auth.users au ON au.id = pu.id
WHERE pu.status = 'Active' AND au.id IS NULL;


-- ── CLEANUP ─────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS _sigma_gen_password(INT);
