-- ══════════════════════════════════════════════════════
-- JALANKAN INI di Supabase SQL Editor (Admin > SQL Editor)
-- ══════════════════════════════════════════════════════

-- 1. Aktifkan pgcrypto (butuh untuk hash password)
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- 2. Buat/Update fungsi reset password admin
CREATE OR REPLACE FUNCTION admin_reset_password(
  p_user_id     UUID,
  p_new_password TEXT
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
BEGIN
  IF length(p_new_password) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Password minimal 6 karakter');
  END IF;

  UPDATE auth.users
  SET encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      updated_at = NOW()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'User tidak ditemukan');
  END IF;

  UPDATE public.users
  SET must_change_password = TRUE,
      updated_at = NOW()
  WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_reset_password(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_reset_password(UUID, TEXT) TO service_role;

-- 3. Update change_my_password juga (untuk user ganti sendiri)
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
  SET encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      updated_at = NOW()
  WHERE id = v_uid;
  UPDATE public.users
  SET must_change_password = FALSE,
      updated_at = NOW()
  WHERE id = v_uid;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION change_my_password(TEXT) TO authenticated;
