-- ================================================================
-- SIGMA Migration 018: Fix auth.identities — Fix "Invalid login credentials"
--
-- ROOT CAUSE:
--   Supabase GoTrue (auth server) menggunakan tabel auth.identities
--   sebagai sumber kebenaran untuk provider login. Ketika user mencoba
--   login dengan email+password, GoTrue melakukan 3 langkah:
--     1. Cari email di auth.users                → ✅ (sudah ada dari migration 017)
--     2. Verifikasi password hash (bcrypt)        → ✅ (hash sudah benar)
--     3. Cari identity di auth.identities
--        WHERE provider='email' AND user_id=X    → ❌ TIDAK ADA → "Invalid login credentials"
--
--   Migration 010, 016, 017 semuanya INSERT ke auth.users tapi
--   TIDAK SATU PUN yang mengisi auth.identities → login selalu gagal.
--
-- SOLUSI:
--   1. Populate auth.identities untuk semua user yang sudah ada di auth.users
--   2. Update admin_provision_all + admin_reset_password agar selalu
--      mengisi auth.identities bersamaan dengan auth.users
--
-- CARA MENJALANKAN:
--   Supabase Dashboard → SQL Editor → paste semua → Run
-- ================================================================


-- ================================================================
-- BAGIAN 1: Populate auth.identities untuk user yang SUDAH ADA
-- di auth.users tapi belum punya identity record
-- ================================================================
INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
SELECT
  au.email,                        -- id = email (standar GoTrue untuk email provider)
  au.id,                           -- user_id
  jsonb_build_object(
    'sub',            au.id::text, -- 'sub' = subject identifier (wajib ada)
    'email',          au.email,
    'email_verified', true,
    'phone_verified', false
  ),
  'email',                         -- provider
  NOW(),
  NOW(),
  NOW()
FROM auth.users au
-- Hanya user yang ada di public.users dan belum punya identity
JOIN public.users pu ON pu.id = au.id
WHERE NOT EXISTS (
  SELECT 1 FROM auth.identities ai
  WHERE ai.user_id = au.id AND ai.provider = 'email'
)
  AND au.email IS NOT NULL
  AND au.email != ''
ON CONFLICT (provider, id) DO UPDATE SET
  user_id       = EXCLUDED.user_id,
  identity_data = EXCLUDED.identity_data,
  updated_at    = NOW();

-- Tampilkan hasil
SELECT
  'Identities berhasil dibuat/diupdate' AS status,
  COUNT(*) AS jumlah
FROM auth.identities ai
JOIN public.users pu ON pu.id = ai.user_id
WHERE ai.provider = 'email';


-- ================================================================
-- BAGIAN 2: Update admin_reset_password — sertakan auth.identities
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
  -- Cek caller harus Administrator
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

  -- Ambil email
  SELECT email INTO v_email FROM public.users WHERE id = p_user_id;
  IF v_email IS NULL OR trim(v_email) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_EMAIL',
      'message', 'Email tidak ditemukan untuk user ini.');
  END IF;

  -- instance_id
  SELECT instance_id INTO v_inst_id FROM auth.users LIMIT 1;
  v_inst_id := COALESCE(v_inst_id, '00000000-0000-0000-0000-000000000000'::UUID);

  -- UPSERT auth.users
  UPDATE auth.users
  SET
    encrypted_password     = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
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
      extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
      NOW(), NOW(), NOW(), 'authenticated', 'authenticated',
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      false, '', '', ''
    )
    ON CONFLICT (id) DO UPDATE SET
      encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
      email              = v_email,
      updated_at         = NOW(),
      email_confirmed_at = COALESCE(auth.users.email_confirmed_at, NOW()),
      banned_until       = NULL;
  END IF;

  -- UPSERT auth.identities — KUNCI agar login bisa bekerja
  INSERT INTO auth.identities (
    id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    v_email,
    p_user_id,
    jsonb_build_object(
      'sub',            p_user_id::text,
      'email',          v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    NOW(), NOW(), NOW()
  )
  ON CONFLICT (provider, id) DO UPDATE SET
    user_id       = EXCLUDED.user_id,
    identity_data = EXCLUDED.identity_data,
    updated_at    = NOW();

  -- Tandai harus ganti password
  UPDATE public.users
  SET must_change_password = TRUE, updated_at = NOW()
  WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_reset_password(UUID, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_reset_password(UUID, TEXT) FROM anon;


-- ================================================================
-- BAGIAN 3: Update admin_provision_all — sertakan auth.identities
-- ================================================================
CREATE OR REPLACE FUNCTION admin_provision_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
  -- Cek caller
  SELECT role::TEXT INTO v_caller_role
  FROM public.users WHERE id = auth.uid() LIMIT 1;

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED',
      'message', 'Tidak ada session. Login ulang.');
  END IF;
  IF v_caller_role != 'Administrator' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_ADMIN',
      'message', 'Hanya Administrator yang boleh provision semua password.');
  END IF;

  -- Ambil instance_id
  SELECT instance_id INTO v_inst_id FROM auth.users LIMIT 1;
  v_inst_id := COALESCE(v_inst_id, '00000000-0000-0000-0000-000000000000'::UUID);

  -- Loop semua user Active/Pending kecuali Administrator
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
      -- Validasi email
      IF v_member.email IS NULL OR trim(v_member.email) = '' THEN
        v_fail    := v_fail + 1;
        v_results := v_results || jsonb_build_object(
          'ok', false, 'nickname', v_member.nickname, 'nama', v_member.nama_panggilan,
          'lingkungan', COALESCE(v_member.lingkungan, ''),
          'hp_ortu', COALESCE(v_member.hp_ortu, ''), 'hp_anak', COALESCE(v_member.hp_anak, ''),
          'password', NULL, 'error', 'Email kosong — isi email di data anggota dulu'
        );
        CONTINUE;
      END IF;

      -- STEP 1: UPSERT auth.users
      UPDATE auth.users
      SET
        encrypted_password     = extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
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

      -- Jika belum ada → INSERT
      IF NOT v_found THEN
        INSERT INTO auth.users (
          id, instance_id, email, encrypted_password,
          email_confirmed_at, created_at, updated_at,
          aud, role, raw_app_meta_data, raw_user_meta_data,
          is_super_admin, confirmation_token, email_change_token_new, recovery_token
        ) VALUES (
          v_member.id, v_inst_id, v_member.email,
          extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
          NOW(), NOW(), NOW(), 'authenticated', 'authenticated',
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
          false, '', '', ''
        )
        ON CONFLICT (id) DO UPDATE SET
          encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
          email              = v_member.email,
          updated_at         = NOW(),
          email_confirmed_at = COALESCE(auth.users.email_confirmed_at, NOW()),
          banned_until       = NULL;
      END IF;

      -- STEP 2: UPSERT auth.identities
      -- INI ADALAH KUNCI UTAMA yang menyebabkan "Invalid login credentials".
      -- GoTrue WAJIB menemukan baris ini sebelum memverifikasi password.
      -- Tanpa baris ini, login selalu gagal terlepas dari apapun.
      INSERT INTO auth.identities (
        id, user_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        v_member.email,              -- id = email untuk provider 'email'
        v_member.id,
        jsonb_build_object(
          'sub',            v_member.id::text,
          'email',          v_member.email,
          'email_verified', true,    -- true agar tidak perlu konfirmasi email
          'phone_verified', false
        ),
        'email',
        NOW(), NOW(), NOW()
      )
      ON CONFLICT (provider, id) DO UPDATE SET
        user_id       = EXCLUDED.user_id,
        identity_data = EXCLUDED.identity_data,
        updated_at    = NOW();

      -- STEP 3: Tandai harus ganti password
      UPDATE public.users
      SET must_change_password = TRUE, updated_at = NOW()
      WHERE id = v_member.id;

      v_success := v_success + 1;
      v_results := v_results || jsonb_build_object(
        'ok', true, 'nickname', v_member.nickname, 'nama', v_member.nama_panggilan,
        'lingkungan', COALESCE(v_member.lingkungan, ''),
        'hp_ortu', COALESCE(v_member.hp_ortu, ''), 'hp_anak', COALESCE(v_member.hp_anak, ''),
        'password', v_password,
        'action', CASE WHEN v_found THEN 'updated' ELSE 'created' END
      );

    EXCEPTION WHEN OTHERS THEN
      v_fail    := v_fail + 1;
      v_results := v_results || jsonb_build_object(
        'ok', false, 'nickname', v_member.nickname, 'nama', v_member.nama_panggilan,
        'lingkungan', COALESCE(v_member.lingkungan, ''),
        'hp_ortu', COALESCE(v_member.hp_ortu, ''), 'hp_anak', COALESCE(v_member.hp_anak, ''),
        'password', NULL,
        'error', SQLERRM || ' [' || SQLSTATE || ']'
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', TRUE, 'results', v_results,
    'total', jsonb_array_length(v_results),
    'success', v_success, 'fail', v_fail
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_provision_all()   TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_provision_all()  FROM anon;


-- ================================================================
-- VERIFIKASI AKHIR — jalankan setelah Run untuk konfirmasi
-- ================================================================
SELECT
  CASE
    WHEN ai.user_id IS NULL THEN '❌ MISSING auth.identities'
    ELSE '✅ auth.identities OK'
  END                                         AS status,
  COUNT(*)                                    AS jumlah
FROM public.users pu
LEFT JOIN auth.identities ai ON ai.user_id = pu.id AND ai.provider = 'email'
WHERE pu.status IN ('Active', 'Pending')
  AND pu.role::TEXT != 'Administrator'
GROUP BY 1
ORDER BY 1;
