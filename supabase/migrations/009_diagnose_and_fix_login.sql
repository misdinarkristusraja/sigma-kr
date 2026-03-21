-- ================================================================
-- SIGMA — DIAGNOSTIK & FIX LOGIN "Invalid login credentials"
-- Jalankan SELURUH script ini di Supabase SQL Editor
-- Baca output tiap bagian dengan teliti
-- ================================================================

-- ── BAGIAN 1: DIAGNOSTIK ────────────────────────────────────────
-- Lihat kondisi auth.users untuk SEMUA anggota aktif
-- Cari kolom yang NULL atau aneh

SELECT
  pu.nickname,
  pu.nama_panggilan,
  pu.email                                     AS email_di_public,
  au.email                                     AS email_di_auth,
  au.email_confirmed_at IS NULL                AS email_belum_confirmed,
  au.encrypted_password IS NULL                AS password_null,
  LEFT(au.encrypted_password, 7)               AS hash_prefix,  -- harusnya '$2a$10' atau '$2b$10'
  au.aud,
  au.role                                      AS auth_role,
  au.banned_until,
  au.deleted_at IS NOT NULL                    AS sudah_deleted,
  pu.status                                    AS status_anggota,
  pu.must_change_password
FROM public.users pu
LEFT JOIN auth.users au ON au.id = pu.id
WHERE pu.status = 'Active'
ORDER BY pu.nickname;

-- ── BAGIAN 2: CARI MASALAH SPESIFIK ────────────────────────────

SELECT 'email_confirmed_at NULL'  AS masalah,
       COUNT(*) AS jumlah
FROM public.users pu JOIN auth.users au ON au.id = pu.id
WHERE pu.status = 'Active' AND au.email_confirmed_at IS NULL

UNION ALL

SELECT 'Email beda antara public vs auth',
       COUNT(*)
FROM public.users pu JOIN auth.users au ON au.id = pu.id
WHERE pu.status = 'Active'
  AND LOWER(pu.email) != LOWER(au.email)

UNION ALL

SELECT 'Tidak ada record di auth.users',
       COUNT(*)
FROM public.users pu
LEFT JOIN auth.users au ON au.id = pu.id
WHERE pu.status = 'Active'
  AND au.id IS NULL

UNION ALL

SELECT 'aud bukan authenticated',
       COUNT(*)
FROM public.users pu JOIN auth.users au ON au.id = pu.id
WHERE pu.status = 'Active'
  AND (au.aud IS NULL OR au.aud != 'authenticated')

UNION ALL

SELECT 'Password hash bukan bcrypt ($2)',
       COUNT(*)
FROM public.users pu JOIN auth.users au ON au.id = pu.id
WHERE pu.status = 'Active'
  AND (au.encrypted_password IS NULL
    OR au.encrypted_password NOT LIKE '$2%');


-- ── BAGIAN 3: FIX SEMUA MASALAH SEKALIGUS ─────────────────────
-- Jalankan ini setelah melihat hasil diagnosa di atas

-- 3a. Fix email_confirmed_at + aud + role untuk semua akun aktif
UPDATE auth.users au
SET
  email_confirmed_at  = COALESCE(au.email_confirmed_at, NOW()),
  aud                 = 'authenticated',
  role                = 'authenticated',
  banned_until        = NULL,
  deleted_at          = NULL,
  updated_at          = NOW()
FROM public.users pu
WHERE pu.id = au.id
  AND pu.status = 'Active';

SELECT 'Fix email_confirmed_at: ' || COUNT(*) || ' baris diupdate' AS hasil
FROM auth.users au
JOIN public.users pu ON pu.id = au.id
WHERE pu.status = 'Active' AND au.email_confirmed_at IS NOT NULL;


-- 3b. Sync email: pastikan email di auth.users == email di public.users
--     Beda email = login selalu gagal karena username lookup pakai email dari public
UPDATE auth.users au
SET email = pu.email,
    updated_at = NOW()
FROM public.users pu
WHERE pu.id = au.id
  AND LOWER(pu.email) != LOWER(au.email);

SELECT 'Sync email: ' || COUNT(*) || ' email disamakan' AS hasil
FROM auth.users au
JOIN public.users pu ON pu.id = au.id
WHERE pu.status = 'Active';


-- ── BAGIAN 4: SET PASSWORD TEST UNTUK 1 AKUN ──────────────────
-- Ganti 'nickname_test' dengan nickname anggota yang mau ditest
-- Ganti 'password_baru_123' dengan password yang mau dicoba
-- Jalankan ini, lalu langsung coba login

DO $$
DECLARE
  v_uid   UUID;
  v_email TEXT;
BEGIN
  -- Ganti nilai di bawah ini:
  SELECT id, email INTO v_uid, v_email
  FROM public.users
  WHERE nickname = 'GANTI_NICKNAME_ANGGOTA_DISINI'  -- <-- ganti ini
  LIMIT 1;

  IF v_uid IS NULL THEN
    RAISE NOTICE 'Nickname tidak ditemukan!';
    RETURN;
  END IF;

  UPDATE auth.users
  SET
    encrypted_password = crypt('GANTI_PASSWORD_DISINI', gen_salt('bf', 10)),  -- <-- ganti ini
    email_confirmed_at = NOW(),
    aud                = 'authenticated',
    role               = 'authenticated',
    banned_until       = NULL,
    updated_at         = NOW()
  WHERE id = v_uid;

  RAISE NOTICE 'Password direset untuk: % (email: %)', v_uid, v_email;
  RAISE NOTICE 'Coba login dengan email: % dan password yang baru.';
END;
$$;


-- ── BAGIAN 5: VERIFIKASI AKHIR ──────────────────────────────────
-- Semua kolom kritis harus OK setelah fix di atas

SELECT
  pu.nickname,
  CASE WHEN au.email_confirmed_at IS NOT NULL THEN '✅' ELSE '❌ NULL' END AS confirmed,
  CASE WHEN au.aud = 'authenticated' THEN '✅' ELSE '❌ ' || au.aud END   AS aud,
  CASE WHEN au.encrypted_password LIKE '$2%' THEN '✅' ELSE '❌ hash salah' END AS hash,
  CASE WHEN au.banned_until IS NULL THEN '✅' ELSE '❌ banned' END        AS not_banned,
  CASE WHEN LOWER(au.email) = LOWER(pu.email) THEN '✅' ELSE '❌ beda' END AS email_sync
FROM public.users pu
JOIN auth.users au ON au.id = pu.id
WHERE pu.status = 'Active'
ORDER BY pu.nickname;
