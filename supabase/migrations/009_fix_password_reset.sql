-- ============================================================
-- SIGMA Migration 009: Fix admin_reset_password
-- 
-- Root cause:
--   1. email_confirmed_at = NULL → Supabase tolak login
--      ("Invalid login credentials") meski password benar
--   2. cost factor gen_salt('bf') = 8, Supabase default = 10
--
-- Jalankan di Supabase SQL Editor
-- ============================================================

-- ── Fix fungsi admin_reset_password ───────────────────────────
CREATE OR REPLACE FUNCTION admin_reset_password(
  p_user_id     UUID,
  p_new_password TEXT
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  v_found BOOLEAN;
BEGIN
  IF length(p_new_password) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Password minimal 6 karakter');
  END IF;

  UPDATE auth.users
  SET
    -- Hash password, cost 10 sesuai Supabase default
    encrypted_password    = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
    updated_at            = NOW(),
    -- KUNCI: pastikan akun sudah terkonfirmasi
    -- Tanpa ini, login selalu gagal "Invalid login credentials"
    email_confirmed_at    = COALESCE(email_confirmed_at, NOW()),
    -- Bersihkan token lama
    confirmation_token    = '',
    recovery_token        = '',
    email_change_token_new = '',
    -- Pastikan role & aud benar
    aud                   = COALESCE(NULLIF(aud, ''), 'authenticated'),
    role                  = COALESCE(NULLIF(role, ''), 'authenticated'),
    -- Cabut banned jika ada
    banned_until          = NULL
  WHERE id = p_user_id
  RETURNING TRUE INTO v_found;

  IF NOT v_found THEN
    RETURN jsonb_build_object('ok', false, 'error', 'User tidak ditemukan di auth.users');
  END IF;

  -- Tandai harus ganti password di tabel public.users
  UPDATE public.users
  SET must_change_password = TRUE,
      updated_at           = NOW()
  WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_reset_password(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_reset_password(UUID, TEXT) TO service_role;

-- ── Fix juga fungsi change_my_password (untuk user ganti sendiri) ─
CREATE OR REPLACE FUNCTION change_my_password(p_new_password TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authenticated');
  END IF;
  IF length(p_new_password) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Password minimal 6 karakter');
  END IF;

  UPDATE auth.users
  SET
    encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
    updated_at         = NOW(),
    email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
    recovery_token     = ''
  WHERE id = v_uid;

  UPDATE public.users
  SET must_change_password = FALSE,
      updated_at           = NOW()
  WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION change_my_password(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION change_my_password(TEXT) TO service_role;

-- ── Fix existing users: pastikan email_confirmed_at tidak NULL ──
-- Ini fix untuk semua akun yang sudah ada dan mungkin NULL
UPDATE auth.users
SET
  email_confirmed_at = NOW(),
  aud                = COALESCE(NULLIF(aud, ''), 'authenticated'),
  role               = COALESCE(NULLIF(role, ''), 'authenticated')
WHERE
  email_confirmed_at IS NULL
  AND id IN (SELECT id FROM public.users WHERE status = 'Active');

-- ── Verifikasi: tampilkan jumlah akun yang masih NULL ─────────
SELECT
  COUNT(*) FILTER (WHERE au.email_confirmed_at IS NULL) AS masih_null,
  COUNT(*) FILTER (WHERE au.email_confirmed_at IS NOT NULL) AS sudah_confirmed,
  COUNT(*) AS total
FROM auth.users au
JOIN public.users pu ON pu.id = au.id
WHERE pu.status = 'Active';
