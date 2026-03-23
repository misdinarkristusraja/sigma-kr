-- ================================================================
-- SIGMA Migration 011: Fix get_my_profile + auth issues
-- Jalankan di Supabase SQL Editor
-- ================================================================

-- ── 1. Buat fungsi get_my_profile yang hilang / fix return type ─
DROP FUNCTION IF EXISTS get_my_profile();

CREATE OR REPLACE FUNCTION get_my_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_row  users%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_row FROM users WHERE id = v_uid LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_profile() TO authenticated, anon;

-- ── 2. Pastikan semua akun auth.users punya email_confirmed_at ─

UPDATE auth.users au
SET
  email_confirmed_at = COALESCE(au.email_confirmed_at, NOW()),
  aud                = 'authenticated',
  role               = 'authenticated',
  updated_at         = NOW()
FROM public.users pu
WHERE pu.id = au.id
  AND pu.status IN ('Active', 'Pending');

-- ── 3. Verifikasi ──────────────────────────────────────────────
SELECT
  'get_my_profile exists' AS check_name,
  COUNT(*) > 0             AS ok
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_my_profile';

SELECT
  COUNT(*) FILTER (WHERE au.email_confirmed_at IS NULL) AS masih_null,
  COUNT(*)                                               AS total
FROM auth.users au
JOIN public.users pu ON pu.id = au.id
WHERE pu.status = 'Active';
