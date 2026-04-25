-- ================================================================
-- SIGMA Migration 020: Definitive Fix — auth.users + auth.identities
--
-- KENAPA MIGRATION SEBELUMNYA GAGAL:
--   019: Menggunakan DO block + EXECUTE $SQL$ yang membuat scope
--        terpisah. Search_path dan extensions tidak diwarisi.
--        gen_random_uuid() gagal resolve. JOIN auth.users menghasilkan
--        0 rows jika auth.users kosong → INSERT 0 rows tanpa error.
--   018: auth.identities.id diasumsikan TEXT padahal UUID (GoTrue baru).
--
-- SOLUSI INI:
--   1. Tidak ada DO block, tidak ada EXECUTE — semua SQL langsung.
--   2. STEP 1: UPSERT auth.users (defensive — handle jika kosong).
--   3. STEP 2: INSERT auth.identities untuk GoTrue baru (id=UUID auto).
--   4. STEP 3: Rebuild RPC dengan pola yang sudah terbukti benar.
--   5. Verifikasi bertingkat di setiap step.
--
-- CARA MENJALANKAN:
--   Supabase Dashboard → SQL Editor → paste semua → Run
-- ================================================================


-- ================================================================
-- DIAGNOSA AWAL — jalankan ini untuk lihat kondisi sekarang
-- ================================================================
SELECT
  'public.users (active/pending non-admin)' AS tabel,
  COUNT(*)                                   AS jumlah
FROM public.users
WHERE status IN ('Active','Pending') AND role::TEXT != 'Administrator'

UNION ALL SELECT
  'auth.users (matched to public.users)',
  COUNT(*)
FROM auth.users au
JOIN public.users pu ON pu.id = au.id
WHERE pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator'

UNION ALL SELECT
  'auth.identities (email provider)',
  COUNT(*)
FROM auth.identities
WHERE provider = 'email';


-- ================================================================
-- STEP 1: UPSERT auth.users
-- Menggunakan pola identik dengan migration 010 yang sudah terbukti
-- bekerja di Supabase SQL Editor (crypt/gen_salt tanpa prefix).
-- Idempotent: aman dijalankan berulang kali.
-- ================================================================
WITH src AS (
  SELECT
    pu.id,
    pu.email,
    pu.nickname,
    pu.nama_panggilan,
    (SELECT instance_id FROM auth.users LIMIT 1) AS inst_id
  FROM public.users pu
  WHERE pu.status    IN ('Active', 'Pending')
    AND pu.role::TEXT != 'Administrator'
    AND pu.email IS NOT NULL
    AND trim(pu.email) != ''
)
INSERT INTO auth.users (
  id, instance_id, email,
  encrypted_password,
  email_confirmed_at, created_at, updated_at,
  aud, role,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin,
  confirmation_token, email_change_token_new, recovery_token
)
SELECT
  src.id,
  COALESCE(src.inst_id, '00000000-0000-0000-0000-000000000000'::UUID),
  src.email,
  -- crypt/gen_salt tanpa prefix: bekerja di Supabase SQL Editor
  -- karena extensions sudah di search_path default session
  crypt('sigma' || substring(src.id::text, 1, 8), gen_salt('bf', 10)),
  NOW(), NOW(), NOW(),
  'authenticated', 'authenticated',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  false, '', '', ''
FROM src
ON CONFLICT (id) DO UPDATE SET
  -- Jika sudah ada: update metadata agar bersih, JANGAN ubah password
  -- (password sudah di-set via admin_provision_all sebelumnya)
  email              = EXCLUDED.email,
  updated_at         = NOW(),
  email_confirmed_at = COALESCE(auth.users.email_confirmed_at, NOW()),
  aud                = 'authenticated',
  role               = 'authenticated',
  banned_until       = NULL,
  confirmation_token     = '',
  recovery_token         = '',
  email_change_token_new = '';

-- Verifikasi STEP 1
SELECT
  'STEP 1 — auth.users setelah UPSERT' AS check_point,
  COUNT(*)                              AS jumlah
FROM auth.users au
JOIN public.users pu ON pu.id = au.id
WHERE pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator';


-- ================================================================
-- STEP 2: INSERT auth.identities untuk GoTrue baru (2023+)
--
-- Schema GoTrue baru:
--   id          UUID  → gen_random_uuid() (native PG, tanpa extension)
--   provider_id TEXT  → email address
--   provider    TEXT  → 'email'
--   UNIQUE      (provider_id, provider)
--
-- ON CONFLICT DO NOTHING: paling aman karena tidak perlu tahu
-- nama constraint pasti — jika sudah ada, skip.
-- ================================================================
INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),         -- UUID auto, native PG 13+, tidak butuh extension
  au.id,
  jsonb_build_object(
    'sub',            au.id::text,
    'email',          au.email,
    'email_verified', true,   -- true agar tidak perlu konfirmasi email
    'phone_verified', false
  ),
  'email',
  au.email,                  -- provider_id = email untuk email provider
  NOW(),
  NOW(),
  NOW()
FROM auth.users au
JOIN public.users pu ON pu.id = au.id
WHERE pu.status    IN ('Active', 'Pending')
  AND pu.role::TEXT != 'Administrator'
  AND au.email IS NOT NULL
  AND au.email != ''
  -- Hanya insert jika belum ada identity untuk user ini
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities ai
    WHERE ai.user_id = au.id AND ai.provider = 'email'
  )
ON CONFLICT DO NOTHING;    -- aman untuk semua versi constraint naming

-- Verifikasi STEP 2
SELECT
  'STEP 2 — auth.identities setelah INSERT' AS check_point,
  COUNT(*)                                   AS jumlah
FROM auth.identities ai
JOIN public.users pu ON pu.id = ai.user_id
WHERE ai.provider = 'email'
  AND pu.status IN ('Active','Pending')
  AND pu.role::TEXT != 'Administrator';


-- ================================================================
-- STEP 3: Rebuild admin_provision_all
-- Pola: crypt/gen_salt tanpa prefix (SET search_path include extensions)
--       gen_random_uuid() native (tidak butuh extension)
--       ON CONFLICT DO NOTHING untuk identities (aman semua versi)
-- ================================================================
CREATE OR REPLACE FUNCTION admin_provision_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- search_path: extensions dulu agar crypt/gen_salt tersedia tanpa prefix
SET search_path = extensions, public, auth
AS $$
DECLARE
  v_caller_role TEXT;
  v_member      RECORD;
  v_password    TEXT;
  v_found       BOOLEAN;
  v_inst_id     UUID;
  v_results     jsonb := '[]'::jsonb;
  v_success     INT   := 0;
  v_fail        INT   := 0;
BEGIN
  -- ── Cek caller harus Administrator ────────────────────────────
  SELECT role::TEXT INTO v_caller_role
  FROM public.users WHERE id = auth.uid() LIMIT 1;

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED',
      'message', 'Tidak ada session yang valid. Login ulang.');
  END IF;
  IF v_caller_role != 'Administrator' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_ADMIN',
      'message', 'Hanya Administrator yang boleh provision password massal.');
  END IF;

  -- ── Ambil instance_id ──────────────────────────────────────────
  SELECT instance_id INTO v_inst_id FROM auth.users LIMIT 1;
  v_inst_id := COALESCE(v_inst_id, '00000000-0000-0000-0000-000000000000'::UUID);

  -- ── Loop semua user Active/Pending kecuali Administrator ───────
  FOR v_member IN
    SELECT
      pu.id, pu.nickname, pu.nama_panggilan,
      pu.lingkungan, pu.hp_ortu, pu.hp_anak, pu.email
    FROM public.users pu
    WHERE pu.status    IN ('Active', 'Pending')
      AND pu.role::TEXT != 'Administrator'
    ORDER BY pu.nama_panggilan
  LOOP
    v_found    := FALSE;
    v_password := generate_random_password(10);

    BEGIN
      -- Validasi email wajib ada
      IF v_member.email IS NULL OR trim(v_member.email) = '' THEN
        v_fail    := v_fail + 1;
        v_results := v_results || jsonb_build_object(
          'ok', false, 'nickname', v_member.nickname, 'nama', v_member.nama_panggilan,
          'lingkungan', COALESCE(v_member.lingkungan,''),
          'hp_ortu', COALESCE(v_member.hp_ortu,''), 'hp_anak', COALESCE(v_member.hp_anak,''),
          'password', NULL, 'error', 'Email kosong — isi email di data anggota dulu'
        );
        CONTINUE;
      END IF;

      -- ── A: UPSERT auth.users ─────────────────────────────────
      UPDATE auth.users
      SET
        encrypted_password     = crypt(v_password, gen_salt('bf', 10)),
        email                  = v_member.email,
        updated_at             = NOW(),
        email_confirmed_at     = COALESCE(email_confirmed_at, NOW()),
        confirmation_token     = '',
        recovery_token         = '',
        email_change_token_new = '',
        aud                    = 'authenticated',
        role                   = 'authenticated',
        banned_until           = NULL
      WHERE id = v_member.id
      RETURNING TRUE INTO v_found;

      -- Jika belum ada di auth.users → INSERT
      IF NOT v_found THEN
        INSERT INTO auth.users (
          id, instance_id, email, encrypted_password,
          email_confirmed_at, created_at, updated_at,
          aud, role, raw_app_meta_data, raw_user_meta_data,
          is_super_admin, confirmation_token, email_change_token_new, recovery_token
        ) VALUES (
          v_member.id, v_inst_id, v_member.email,
          crypt(v_password, gen_salt('bf', 10)),
          NOW(), NOW(), NOW(), 'authenticated', 'authenticated',
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
          false, '', '', ''
        )
        ON CONFLICT (id) DO UPDATE SET
          encrypted_password = crypt(v_password, gen_salt('bf', 10)),
          email              = v_member.email,
          updated_at         = NOW(),
          email_confirmed_at = COALESCE(auth.users.email_confirmed_at, NOW()),
          banned_until       = NULL;
      END IF;

      -- ── B: UPSERT auth.identities ────────────────────────────
      -- ON CONFLICT DO NOTHING: jika sudah ada → skip (aman semua versi GoTrue)
      -- Kalau belum ada → INSERT dengan schema GoTrue baru (id=UUID, provider_id=email)
      INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),   -- UUID native PG 13+
        v_member.id,
        jsonb_build_object(
          'sub',            v_member.id::text,
          'email',          v_member.email,
          'email_verified', true,
          'phone_verified', false
        ),
        'email',
        v_member.email,      -- provider_id = email
        NOW(), NOW(), NOW()
      )
      ON CONFLICT DO NOTHING;

      -- ── C: Tandai must_change_password ───────────────────────
      UPDATE public.users
      SET must_change_password = TRUE, updated_at = NOW()
      WHERE id = v_member.id;

      v_success := v_success + 1;
      v_results := v_results || jsonb_build_object(
        'ok', true,
        'nickname',   v_member.nickname,
        'nama',       v_member.nama_panggilan,
        'lingkungan', COALESCE(v_member.lingkungan,''),
        'hp_ortu',    COALESCE(v_member.hp_ortu,''),
        'hp_anak',    COALESCE(v_member.hp_anak,''),
        'password',   v_password,
        'action',     CASE WHEN v_found THEN 'updated' ELSE 'created' END
      );

    EXCEPTION WHEN OTHERS THEN
      v_fail    := v_fail + 1;
      v_results := v_results || jsonb_build_object(
        'ok', false,
        'nickname',   v_member.nickname,
        'nama',       v_member.nama_panggilan,
        'lingkungan', COALESCE(v_member.lingkungan,''),
        'hp_ortu',    COALESCE(v_member.hp_ortu,''),
        'hp_anak',    COALESCE(v_member.hp_anak,''),
        'password',   NULL,
        'error',      SQLERRM || ' [' || SQLSTATE || ']'
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

GRANT EXECUTE ON FUNCTION admin_provision_all()  TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_provision_all() FROM anon;


-- ================================================================
-- STEP 4: Rebuild admin_reset_password (satu user)
-- ================================================================
CREATE OR REPLACE FUNCTION admin_reset_password(
  p_user_id      UUID,
  p_new_password TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public, auth
AS $$
DECLARE
  v_caller_role TEXT;
  v_email       TEXT;
  v_found       BOOLEAN;
  v_inst_id     UUID;
BEGIN
  SELECT role::TEXT INTO v_caller_role
  FROM public.users WHERE id = auth.uid() LIMIT 1;

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED',
      'message', 'Tidak ada session. Login ulang.');
  END IF;
  IF v_caller_role != 'Administrator' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_ADMIN',
      'message', 'Hanya Administrator. Role kamu: ' || v_caller_role);
  END IF;
  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PASSWORD_TOO_SHORT',
      'message', 'Password minimal 6 karakter');
  END IF;

  SELECT email INTO v_email FROM public.users WHERE id = p_user_id;
  IF v_email IS NULL OR trim(v_email) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_EMAIL',
      'message', 'Email tidak ditemukan untuk user ini.');
  END IF;

  SELECT instance_id INTO v_inst_id FROM auth.users LIMIT 1;
  v_inst_id := COALESCE(v_inst_id, '00000000-0000-0000-0000-000000000000'::UUID);

  -- UPSERT auth.users
  UPDATE auth.users
  SET
    encrypted_password     = crypt(p_new_password, gen_salt('bf', 10)),
    email                  = v_email,
    updated_at             = NOW(),
    email_confirmed_at     = COALESCE(email_confirmed_at, NOW()),
    confirmation_token     = '',
    recovery_token         = '',
    email_change_token_new = '',
    aud                    = 'authenticated',
    role                   = 'authenticated',
    banned_until           = NULL
  WHERE id = p_user_id
  RETURNING TRUE INTO v_found;

  IF NOT v_found THEN
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      aud, role, raw_app_meta_data, raw_user_meta_data,
      is_super_admin, confirmation_token, email_change_token_new, recovery_token
    ) VALUES (
      p_user_id, v_inst_id, v_email,
      crypt(p_new_password, gen_salt('bf', 10)),
      NOW(), NOW(), NOW(), 'authenticated', 'authenticated',
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      false, '', '', ''
    )
    ON CONFLICT (id) DO UPDATE SET
      encrypted_password = crypt(p_new_password, gen_salt('bf', 10)),
      email              = v_email,
      updated_at         = NOW(),
      email_confirmed_at = COALESCE(auth.users.email_confirmed_at, NOW()),
      banned_until       = NULL;
  END IF;

  -- UPSERT auth.identities
  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_user_id,
    jsonb_build_object(
      'sub',            p_user_id::text,
      'email',          v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email', v_email,
    NOW(), NOW(), NOW()
  )
  ON CONFLICT DO NOTHING;

  UPDATE public.users
  SET must_change_password = TRUE, updated_at = NOW()
  WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_reset_password(UUID, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_reset_password(UUID, TEXT) FROM anon;


-- ================================================================
-- VERIFIKASI FINAL BERTINGKAT
-- Semua angka harus SAMA (tidak ada yang 0 kecuali MISSING)
-- ================================================================
SELECT
  'public.users aktif (non-admin)'          AS label,
  COUNT(*)                                   AS jumlah
FROM public.users
WHERE status IN ('Active','Pending') AND role::TEXT != 'Administrator'

UNION ALL SELECT
  'auth.users (matched)',
  COUNT(*)
FROM auth.users au
JOIN public.users pu ON pu.id = au.id
WHERE pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator'

UNION ALL SELECT
  'auth.identities (email provider)',
  COUNT(*)
FROM auth.identities ai
JOIN public.users pu ON pu.id = ai.user_id
WHERE ai.provider = 'email'
  AND pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator'

UNION ALL SELECT
  '⚠ auth.users MISSING',
  COUNT(*)
FROM public.users pu
LEFT JOIN auth.users au ON au.id = pu.id
WHERE pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator'
  AND au.id IS NULL

UNION ALL SELECT
  '⚠ auth.identities MISSING',
  COUNT(*)
FROM public.users pu
LEFT JOIN auth.identities ai ON ai.user_id = pu.id AND ai.provider = 'email'
WHERE pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator'
  AND ai.user_id IS NULL

ORDER BY label;
