-- ================================================================
-- SIGMA Migration 019: Fix auth.identities — Schema-aware
--
-- ROOT CAUSE ERROR SEBELUMNYA:
--   Migration 018 mengasumsikan auth.identities.id bertipe TEXT (email).
--   Ternyata project ini menggunakan GoTrue versi baru (2023+) dimana:
--     - id         = UUID (auto-generated, bukan email)
--     - provider_id = TEXT (kolom baru = email untuk email provider)
--     - UNIQUE constraint: (provider_id, provider) — bukan (provider, id)
--
-- SOLUSI:
--   DO block mendeteksi schema GoTrue secara runtime sebelum INSERT,
--   lalu memilih pola yang tepat. Aman untuk semua versi Supabase.
--
-- CARA MENJALANKAN:
--   Supabase Dashboard → SQL Editor → paste semua → Run
-- ================================================================

-- ================================================================
-- STEP 1: Deteksi schema & populate auth.identities untuk semua
-- user yang sudah ada di auth.users tapi belum punya identity
-- ================================================================
DO $$
DECLARE
  v_has_provider_id BOOLEAN;
BEGIN
  -- Deteksi apakah kolom 'provider_id' ada (GoTrue baru 2023+)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name   = 'identities'
      AND column_name  = 'provider_id'
  ) INTO v_has_provider_id;

  RAISE NOTICE 'GoTrue schema: provider_id column exists = %', v_has_provider_id;

  IF v_has_provider_id THEN
    -- ── GoTrue BARU (Supabase 2023+) ─────────────────────────
    -- id          = UUID auto (gen_random_uuid())
    -- provider_id = TEXT (= email untuk email provider)
    -- UNIQUE: (provider_id, provider)
    EXECUTE $SQL$
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
        extensions.gen_random_uuid(),
        au.id,
        jsonb_build_object(
          'sub',            au.id::text,
          'email',          au.email,
          'email_verified', true,
          'phone_verified', false
        ),
        'email',
        au.email,
        NOW(), NOW(), NOW()
      FROM auth.users au
      JOIN public.users pu ON pu.id = au.id
      WHERE au.email IS NOT NULL AND au.email != ''
        AND NOT EXISTS (
          SELECT 1 FROM auth.identities ai
          WHERE ai.user_id = au.id AND ai.provider = 'email'
        )
      ON CONFLICT (provider_id, provider) DO UPDATE SET
        user_id       = EXCLUDED.user_id,
        identity_data = EXCLUDED.identity_data,
        updated_at    = NOW()
    $SQL$;

  ELSE
    -- ── GoTrue LAMA ──────────────────────────────────────────
    -- id = UUID (= user_id, bukan TEXT/email)
    -- PRIMARY KEY: (provider, id)
    EXECUTE $SQL$
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
        au.id,
        au.id,
        jsonb_build_object(
          'sub',            au.id::text,
          'email',          au.email,
          'email_verified', true,
          'phone_verified', false
        ),
        'email',
        NOW(), NOW(), NOW()
      FROM auth.users au
      JOIN public.users pu ON pu.id = au.id
      WHERE au.email IS NOT NULL AND au.email != ''
        AND NOT EXISTS (
          SELECT 1 FROM auth.identities ai
          WHERE ai.user_id = au.id AND ai.provider = 'email'
        )
      ON CONFLICT (provider, id) DO UPDATE SET
        identity_data = EXCLUDED.identity_data,
        updated_at    = NOW()
    $SQL$;
  END IF;

END $$;


-- ================================================================
-- STEP 2: Rebuild admin_provision_all dengan schema detection
-- ================================================================
CREATE OR REPLACE FUNCTION admin_provision_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public, auth
AS $$
DECLARE
  v_caller_role     TEXT;
  v_member          RECORD;
  v_password        TEXT;
  v_found           BOOLEAN;
  v_inst_id         UUID;
  v_has_provider_id BOOLEAN;
  v_results         jsonb := '[]'::jsonb;
  v_success         INT   := 0;
  v_fail            INT   := 0;
BEGIN
  -- ── Cek caller ────────────────────────────────────────────────
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

  -- ── Deteksi GoTrue schema (sekali, di luar loop) ──────────────
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name   = 'identities'
      AND column_name  = 'provider_id'
  ) INTO v_has_provider_id;

  -- ── instance_id ───────────────────────────────────────────────
  SELECT instance_id INTO v_inst_id FROM auth.users LIMIT 1;
  v_inst_id := COALESCE(v_inst_id, '00000000-0000-0000-0000-000000000000'::UUID);

  -- ── Loop ─────────────────────────────────────────────────────
  FOR v_member IN
    SELECT pu.id, pu.nickname, pu.nama_panggilan,
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
          'lingkungan', COALESCE(v_member.lingkungan,''),
          'hp_ortu', COALESCE(v_member.hp_ortu,''), 'hp_anak', COALESCE(v_member.hp_anak,''),
          'password', NULL, 'error', 'Email kosong — isi email di data anggota dulu'
        );
        CONTINUE;
      END IF;

      -- ── STEP A: UPSERT auth.users ────────────────────────────
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

      -- ── STEP B: UPSERT auth.identities (schema-aware) ────────
      IF v_has_provider_id THEN
        -- GoTrue baru: id=UUID auto, provider_id=email, UNIQUE(provider_id, provider)
        INSERT INTO auth.identities (
          id, user_id, identity_data, provider, provider_id,
          last_sign_in_at, created_at, updated_at
        ) VALUES (
          extensions.gen_random_uuid(),
          v_member.id,
          jsonb_build_object(
            'sub', v_member.id::text, 'email', v_member.email,
            'email_verified', true, 'phone_verified', false
          ),
          'email',
          v_member.email,
          NOW(), NOW(), NOW()
        )
        ON CONFLICT (provider_id, provider) DO UPDATE SET
          user_id       = EXCLUDED.user_id,
          identity_data = EXCLUDED.identity_data,
          updated_at    = NOW();

      ELSE
        -- GoTrue lama: id=user_id UUID, PRIMARY KEY(provider, id)
        INSERT INTO auth.identities (
          id, user_id, identity_data, provider,
          last_sign_in_at, created_at, updated_at
        ) VALUES (
          v_member.id,
          v_member.id,
          jsonb_build_object(
            'sub', v_member.id::text, 'email', v_member.email,
            'email_verified', true, 'phone_verified', false
          ),
          'email',
          NOW(), NOW(), NOW()
        )
        ON CONFLICT (provider, id) DO UPDATE SET
          identity_data = EXCLUDED.identity_data,
          updated_at    = NOW();
      END IF;

      -- ── STEP C: Tandai must_change_password ──────────────────
      UPDATE public.users
      SET must_change_password = TRUE, updated_at = NOW()
      WHERE id = v_member.id;

      v_success := v_success + 1;
      v_results := v_results || jsonb_build_object(
        'ok', true, 'nickname', v_member.nickname, 'nama', v_member.nama_panggilan,
        'lingkungan', COALESCE(v_member.lingkungan,''),
        'hp_ortu', COALESCE(v_member.hp_ortu,''), 'hp_anak', COALESCE(v_member.hp_anak,''),
        'password', v_password,
        'action', CASE WHEN v_found THEN 'updated' ELSE 'created' END
      );

    EXCEPTION WHEN OTHERS THEN
      v_fail    := v_fail + 1;
      v_results := v_results || jsonb_build_object(
        'ok', false, 'nickname', v_member.nickname, 'nama', v_member.nama_panggilan,
        'lingkungan', COALESCE(v_member.lingkungan,''),
        'hp_ortu', COALESCE(v_member.hp_ortu,''), 'hp_anak', COALESCE(v_member.hp_anak,''),
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

GRANT EXECUTE ON FUNCTION admin_provision_all()  TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_provision_all() FROM anon;


-- ================================================================
-- STEP 3: Rebuild admin_reset_password dengan schema detection
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
  v_caller_role     TEXT;
  v_email           TEXT;
  v_found           BOOLEAN;
  v_inst_id         UUID;
  v_has_provider_id BOOLEAN;
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

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'identities' AND column_name = 'provider_id'
  ) INTO v_has_provider_id;

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

  -- UPSERT auth.identities (schema-aware)
  IF v_has_provider_id THEN
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      extensions.gen_random_uuid(), p_user_id,
      jsonb_build_object('sub', p_user_id::text, 'email', v_email,
        'email_verified', true, 'phone_verified', false),
      'email', v_email,
      NOW(), NOW(), NOW()
    )
    ON CONFLICT (provider_id, provider) DO UPDATE SET
      user_id       = EXCLUDED.user_id,
      identity_data = EXCLUDED.identity_data,
      updated_at    = NOW();
  ELSE
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      p_user_id, p_user_id,
      jsonb_build_object('sub', p_user_id::text, 'email', v_email,
        'email_verified', true, 'phone_verified', false),
      'email',
      NOW(), NOW(), NOW()
    )
    ON CONFLICT (provider, id) DO UPDATE SET
      identity_data = EXCLUDED.identity_data,
      updated_at    = NOW();
  END IF;

  UPDATE public.users
  SET must_change_password = TRUE, updated_at = NOW()
  WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_reset_password(UUID, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_reset_password(UUID, TEXT) FROM anon;


-- ================================================================
-- VERIFIKASI AKHIR
-- ================================================================

-- 1. Lihat schema GoTrue yang aktif
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'auth'
  AND table_name   = 'identities'
ORDER BY ordinal_position;

-- 2. Cek hasilnya
SELECT
  CASE
    WHEN ai.user_id IS NULL THEN '❌ MISSING auth.identities'
    ELSE '✅ auth.identities OK'
  END          AS status,
  COUNT(*)     AS jumlah
FROM public.users pu
LEFT JOIN auth.identities ai
  ON ai.user_id = pu.id AND ai.provider = 'email'
WHERE pu.status IN ('Active','Pending')
  AND pu.role::TEXT != 'Administrator'
GROUP BY 1
ORDER BY 1;
