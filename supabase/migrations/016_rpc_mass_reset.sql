-- ================================================================
-- SIGMA Migration 016: RPC Mass Reset (tanpa Edge Function)
--
-- Jalankan di: Supabase Dashboard → SQL Editor
-- Jalankan SETELAH migration 001-015.
--
-- Kenapa solusi ini benar:
--   supabase.rpc() = HTTP POST ke /rest/v1/rpc/<nama>
--   Request dikirim dengan Bearer token user yang login.
--   SECURITY DEFINER memungkinkan fungsi mengakses auth.users
--   tanpa SERVICE_ROLE_KEY di frontend.
--   Tidak ada CORS karena ini endpoint Supabase yang sama
--   dengan semua query lainnya.
-- ================================================================

-- ── Pastikan pgcrypto tersedia ────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- ── Helper: generate password acak (10 karakter, lowercase+angka) ─
-- Gunakan gen_random_bytes untuk entropi kriptografis yang baik.
-- Karakter yang dipakai: a-z dan 2-9 (hindari huruf/angka ambigu: 0,1,l,i,o).
CREATE OR REPLACE FUNCTION generate_random_password(p_length INT DEFAULT 10)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public
AS $$
DECLARE
  v_charset TEXT    := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_len     INT     := array_length(string_to_array(v_charset, NULL), 1);
  v_bytes   BYTEA   := extensions.gen_random_bytes(p_length * 2);
  v_result  TEXT    := '';
  v_byte    INT;
  i         INT;
BEGIN
  FOR i IN 1..p_length LOOP
    v_byte   := get_byte(v_bytes, i - 1) % v_len + 1;
    v_result := v_result || substring(v_charset FROM v_byte FOR 1);
  END LOOP;
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION generate_random_password(INT) IS
  'Generate password acak yang aman secara kriptografis. Hanya untuk fungsi internal.';

-- Tidak di-grant ke public — hanya dipanggil dari SECURITY DEFINER functions


-- ================================================================
-- admin_reset_password (fix: tambah role check)
-- Dipanggil dari AdminPage untuk reset satu user.
-- ================================================================
CREATE OR REPLACE FUNCTION admin_reset_password(
  p_user_id     UUID,
  p_new_password TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  v_caller_role TEXT;
  v_found       BOOLEAN;
BEGIN
  -- ── 1. Cek caller: harus Administrator ───────────────────────
  -- auth.uid() mengembalikan UUID user yang memanggil via Supabase JWT.
  -- Query ke public.users (bukan auth.users) untuk baca role.
  SELECT role::TEXT INTO v_caller_role
  FROM public.users
  WHERE id = auth.uid()
  LIMIT 1;

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'NOT_AUTHENTICATED',
      'message', 'Tidak ada session yang valid. Login ulang.'
    );
  END IF;

  IF v_caller_role != 'Administrator' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'NOT_ADMIN',
      'message', 'Hanya Administrator yang boleh reset password anggota. Role kamu: ' || v_caller_role
    );
  END IF;

  -- ── 2. Validasi password ──────────────────────────────────────
  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'PASSWORD_TOO_SHORT',
      'message', 'Password minimal 6 karakter'
    );
  END IF;

  -- ── 3. Update auth.users (akses via SECURITY DEFINER) ─────────
  UPDATE auth.users
  SET
    -- Hash bcrypt cost=10 sesuai default Supabase
    encrypted_password     = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
    updated_at             = NOW(),
    -- Pastikan email sudah terkonfirmasi (tanpa ini login gagal "Invalid login credentials")
    email_confirmed_at     = COALESCE(email_confirmed_at, NOW()),
    -- Bersihkan semua token lama
    confirmation_token     = '',
    recovery_token         = '',
    email_change_token_new = '',
    -- Pastikan aud dan role sudah benar (Supabase requirement)
    aud                    = COALESCE(NULLIF(aud, ''), 'authenticated'),
    role                   = COALESCE(NULLIF(role::TEXT, ''), 'authenticated'),
    -- Cabut banned jika ada
    banned_until           = NULL
  WHERE id = p_user_id
  RETURNING TRUE INTO v_found;

  IF NOT v_found THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'USER_NOT_IN_AUTH',
      'message', 'User tidak ditemukan di auth.users. Akun mungkin belum dibuat di sistem auth.'
    );
  END IF;

  -- ── 4. Tandai harus ganti password ───────────────────────────
  UPDATE public.users
  SET
    must_change_password = TRUE,
    updated_at           = NOW()
  WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION admin_reset_password(UUID, TEXT) IS
  'Reset password satu user. Hanya bisa dipanggil oleh Administrator. SECURITY DEFINER.';

-- Hanya authenticated yang boleh memanggil
-- (pengecekan role Administrator dilakukan di dalam fungsi)
GRANT EXECUTE ON FUNCTION admin_reset_password(UUID, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_reset_password(UUID, TEXT) FROM anon;


-- ================================================================
-- admin_provision_all
-- Reset password SEMUA user aktif dalam satu panggilan.
-- Dipanggil dari AdminPage untuk "Reset Semua" tanpa Edge Function.
-- ================================================================
CREATE OR REPLACE FUNCTION admin_provision_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  v_caller_role  TEXT;
  v_member       RECORD;
  v_password     TEXT;
  v_found        BOOLEAN;
  v_results      jsonb := '[]'::jsonb;
  v_success      INT   := 0;
  v_fail         INT   := 0;
BEGIN
  -- ── 1. Cek caller: harus Administrator ───────────────────────
  SELECT role::TEXT INTO v_caller_role
  FROM public.users
  WHERE id = auth.uid()
  LIMIT 1;

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'NOT_AUTHENTICATED',
      'message', 'Tidak ada session. Login ulang.'
    );
  END IF;

  IF v_caller_role != 'Administrator' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'NOT_ADMIN',
      'message', 'Hanya Administrator yang boleh provision semua password.'
    );
  END IF;

  -- ── 2. Loop semua user Active/Pending (kecuali Administrator) ─
  FOR v_member IN
    SELECT
      pu.id,
      pu.nickname,
      pu.nama_panggilan,
      pu.lingkungan,
      pu.hp_ortu,
      pu.hp_anak,
      au.email
    FROM public.users pu
    LEFT JOIN auth.users au ON au.id = pu.id
    WHERE pu.status    IN ('Active', 'Pending')
      AND pu.role::TEXT != 'Administrator'
    ORDER BY pu.nama_panggilan
  LOOP
    v_found    := FALSE;
    v_password := generate_random_password(10);

    BEGIN
      -- Update auth.users untuk user ini
      UPDATE auth.users
      SET
        encrypted_password     = extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
        updated_at             = NOW(),
        email_confirmed_at     = COALESCE(email_confirmed_at, NOW()),
        confirmation_token     = '',
        recovery_token         = '',
        email_change_token_new = '',
        aud                    = COALESCE(NULLIF(aud, ''), 'authenticated'),
        role                   = COALESCE(NULLIF(role::TEXT, ''), 'authenticated'),
        banned_until           = NULL
      WHERE id = v_member.id
      RETURNING TRUE INTO v_found;

      IF v_found THEN
        -- Tandai harus ganti password
        UPDATE public.users
        SET must_change_password = TRUE, updated_at = NOW()
        WHERE id = v_member.id;

        v_success := v_success + 1;
        v_results := v_results || jsonb_build_object(
          'ok',           true,
          'nickname',     v_member.nickname,
          'nama',         v_member.nama_panggilan,
          'lingkungan',   COALESCE(v_member.lingkungan, ''),
          'hp_ortu',      COALESCE(v_member.hp_ortu, ''),
          'hp_anak',      COALESCE(v_member.hp_anak, ''),
          'password',     v_password
        );
      ELSE
        -- User ada di public.users tapi TIDAK di auth.users
        -- Ini terjadi pada akun yang belum pernah disetup di Supabase Auth
        v_fail   := v_fail + 1;
        v_results := v_results || jsonb_build_object(
          'ok',       false,
          'nickname', v_member.nickname,
          'nama',     v_member.nama_panggilan,
          'password', NULL,
          'error',    'Akun belum ada di auth.users. Jalankan migration 010_create_auth_users.sql terlebih dahulu.'
        );
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_fail    := v_fail + 1;
      v_results := v_results || jsonb_build_object(
        'ok',       false,
        'nickname', v_member.nickname,
        'nama',     v_member.nama_panggilan,
        'password', NULL,
        'error',    SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',      TRUE,
    'results', v_results,
    'total',   jsonb_array_length(v_results),
    'success', v_success,
    'fail',    v_fail
  );
END;
$$;

COMMENT ON FUNCTION admin_provision_all() IS
  'Reset password semua user aktif sekaligus. Hanya Administrator. SECURITY DEFINER.';

GRANT EXECUTE ON FUNCTION admin_provision_all() TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_provision_all() FROM anon;

-- ── Verifikasi: pastikan fungsi terdaftar ─────────────────────
SELECT
  routine_name,
  security_type,
  routine_definition IS NOT NULL AS has_body
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('admin_reset_password', 'admin_provision_all', 'generate_random_password', 'change_my_password')
ORDER BY routine_name;
