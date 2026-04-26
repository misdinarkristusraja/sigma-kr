-- ================================================================
-- SIGMA Migration 022: Definitive Auth Fix (supabase_auth_admin)
--
-- ROOT CAUSE SEMUA ERROR SEBELUMNYA:
--
--   auth.users dan auth.identities DIMILIKI oleh role 'supabase_auth_admin'.
--   SQL Editor berjalan sebagai 'postgres'.
--   SECURITY DEFINER functions dibuat oleh 'postgres' → berjalan sebagai 'postgres'.
--
--   ON CONFLICT DO UPDATE pada tabel yang dimiliki orang lain membutuhkan
--   OWNERSHIP (bukan sekedar INSERT privilege) → error 42501.
--
-- SOLUSI DEFINITIF:
--
--   1. Migration SQL: SET LOCAL ROLE supabase_auth_admin dalam transaction
--      → semua operasi auth.* berjalan sebagai owner → tidak ada ownership error
--
--   2. SECURITY DEFINER functions: di-create SEBAGAI supabase_auth_admin
--      → SET ROLE supabase_auth_admin; CREATE FUNCTION; RESET ROLE;
--      → function berjalan sebagai owner saat dipanggil via supabase.rpc()
--
--   Ini adalah pola RESMI yang didokumentasikan Supabase untuk operasi
--   yang membutuhkan akses ke auth schema.
--
-- CARA MENJALANKAN:
--   Supabase Dashboard → SQL Editor → paste semua → Run
-- ================================================================


-- ================================================================
-- BAGIAN 1: DIAGNOSA
-- Jalankan ini untuk melihat kondisi data sebelum diproses
-- ================================================================
SELECT
  'public.users aktif (non-admin)'           AS label,
  COUNT(*)                                    AS jumlah
FROM public.users
WHERE status IN ('Active','Pending') AND role::TEXT != 'Administrator'

UNION ALL SELECT
  'auth.users sudah ada (matched by id)',
  COUNT(*)
FROM auth.users au
JOIN public.users pu ON pu.id = au.id
WHERE pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator'

UNION ALL SELECT
  'auth.identities sudah ada',
  COUNT(*)
FROM auth.identities ai
JOIN public.users pu ON pu.id = ai.user_id
WHERE ai.provider = 'email'
  AND pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator'

UNION ALL SELECT
  'Email konflik (auth.users punya UUID berbeda)',
  COUNT(*)
FROM public.users pu
JOIN auth.users au ON LOWER(au.email) = LOWER(pu.email) AND au.id != pu.id
WHERE pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator'

ORDER BY label;


-- ================================================================
-- BAGIAN 2: POPULATE auth.users + auth.identities
-- Menggunakan SET LOCAL ROLE supabase_auth_admin agar operasi
-- berjalan sebagai pemilik tabel → tidak ada ownership error
-- ================================================================
BEGIN;
  SET LOCAL ROLE supabase_auth_admin;

  -- ── STEP A: INSERT auth.users ──────────────────────────────
  -- Hanya untuk user yang:
  -- (a) belum ada di auth.users (NOT EXISTS by id)
  -- (b) emailnya belum dipakai auth.users dengan UUID berbeda
  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    aud,
    role,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    confirmation_token,
    email_change_token_new,
    recovery_token
  )
  SELECT
    pu.id,
    COALESCE(
      (SELECT instance_id FROM auth.users LIMIT 1),
      '00000000-0000-0000-0000-000000000000'::UUID
    ),
    pu.email,
    -- Password sementara: 'sigma' + 8 karakter pertama UUID
    -- Admin WAJIB run admin_provision_all setelah ini untuk set password sesungguhnya
    crypt('sigma' || substring(pu.id::text, 1, 8), gen_salt('bf', 10)),
    NOW(),
    NOW(),
    NOW(),
    'authenticated',
    'authenticated',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    false,
    '',
    '',
    ''
  FROM public.users pu
  WHERE pu.status    IN ('Active', 'Pending')
    AND pu.role::TEXT != 'Administrator'
    AND pu.email IS NOT NULL
    AND trim(pu.email) != ''
    -- Belum ada di auth.users dengan id yang sama
    AND NOT EXISTS (
      SELECT 1 FROM auth.users au WHERE au.id = pu.id
    )
    -- Emailnya belum dipakai auth.users dengan id BERBEDA
    AND NOT EXISTS (
      SELECT 1 FROM auth.users au
      WHERE LOWER(au.email) = LOWER(pu.email) AND au.id != pu.id
    );

  -- ── STEP B: UPDATE auth.users yang sudah ada ───────────────
  -- Bersihkan metadata, pastikan email_confirmed_at, aud, role benar
  -- TIDAK mengubah email (untuk menghindari constraint violation)
  -- TIDAK mengubah encrypted_password (password dari admin_provision_all tetap valid)
  UPDATE auth.users au
  SET
    updated_at             = NOW(),
    email_confirmed_at     = COALESCE(au.email_confirmed_at, NOW()),
    aud                    = 'authenticated',
    role                   = 'authenticated',
    banned_until           = NULL,
    confirmation_token     = '',
    recovery_token         = '',
    email_change_token_new = ''
  FROM public.users pu
  WHERE au.id = pu.id
    AND pu.status    IN ('Active', 'Pending')
    AND pu.role::TEXT != 'Administrator';

  -- ── STEP C: INSERT auth.identities ─────────────────────────
  -- GoTrue baru (2023+): id=UUID, provider_id=email, UNIQUE(provider_id, provider)
  -- ON CONFLICT DO NOTHING: skip jika sudah ada (tidak ada error)
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
    gen_random_uuid(),
    au.id,
    jsonb_build_object(
      'sub',            au.id::text,
      'email',          au.email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    au.email,
    NOW(),
    NOW(),
    NOW()
  FROM auth.users au
  JOIN public.users pu ON pu.id = au.id
  WHERE pu.status    IN ('Active', 'Pending')
    AND pu.role::TEXT != 'Administrator'
    AND au.email IS NOT NULL
    AND au.email != ''
    AND NOT EXISTS (
      SELECT 1 FROM auth.identities ai
      WHERE ai.user_id = au.id AND ai.provider = 'email'
    )
  ON CONFLICT DO NOTHING;

COMMIT;


-- ================================================================
-- BAGIAN 3: REBUILD FUNCTIONS sebagai supabase_auth_admin
-- Function yang di-CREATE oleh supabase_auth_admin → SECURITY DEFINER
-- → berjalan sebagai supabase_auth_admin saat dipanggil via RPC
-- → punya full ownership atas auth.users → tidak ada error 42501
-- ================================================================

-- Switch ke supabase_auth_admin untuk CREATE FUNCTION
SET ROLE supabase_auth_admin;


-- ── Fungsi helper: generate password acak ────────────────────
CREATE OR REPLACE FUNCTION public.generate_random_password(p_length INT DEFAULT 10)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public
AS $$
DECLARE
  v_charset TEXT  := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_len     INT   := length('abcdefghjkmnpqrstuvwxyz23456789');
  v_result  TEXT  := '';
  v_bytes   BYTEA := gen_random_bytes(p_length * 2);
  i         INT;
BEGIN
  FOR i IN 1..p_length LOOP
    v_result := v_result || substr(v_charset, (get_byte(v_bytes, i-1) % v_len) + 1, 1);
  END LOOP;
  RETURN v_result;
END;
$$;


-- ── admin_provision_all ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_provision_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- search_path: extensions → crypt/gen_salt/gen_random_bytes tersedia tanpa prefix
-- public       → public.users
-- auth         → auth.users, auth.identities
SET search_path = extensions, public, auth
AS $$
DECLARE
  v_caller_role TEXT;
  v_member      RECORD;
  v_password    TEXT;
  v_found       BOOLEAN;
  v_inst_id     UUID;
  v_email_taken BOOLEAN;
  v_results     jsonb := '[]'::jsonb;
  v_success     INT   := 0;
  v_fail        INT   := 0;
  v_skipped     INT   := 0;
BEGIN
  -- ── 1. Cek caller harus Administrator ─────────────────────
  SELECT role::TEXT INTO v_caller_role
  FROM public.users WHERE id = auth.uid() LIMIT 1;

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'NOT_AUTHENTICATED',
      'message', 'Tidak ada session yang valid. Login ulang.'
    );
  END IF;

  IF v_caller_role != 'Administrator' THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'NOT_ADMIN',
      'message', 'Hanya Administrator yang boleh provision password massal.'
    );
  END IF;

  -- ── 2. instance_id ────────────────────────────────────────
  SELECT instance_id INTO v_inst_id FROM auth.users LIMIT 1;
  v_inst_id := COALESCE(v_inst_id, '00000000-0000-0000-0000-000000000000'::UUID);

  -- ── 3. Loop ───────────────────────────────────────────────
  FOR v_member IN
    SELECT
      pu.id, pu.nickname, pu.nama_panggilan,
      pu.lingkungan, pu.hp_ortu, pu.hp_anak, pu.email
    FROM public.users pu
    WHERE pu.status    IN ('Active', 'Pending')
      AND pu.role::TEXT != 'Administrator'
    ORDER BY pu.nama_panggilan
  LOOP
    v_found      := FALSE;
    v_email_taken := FALSE;
    v_password   := generate_random_password(10);

    BEGIN

      -- Validasi email
      IF v_member.email IS NULL OR trim(v_member.email) = '' THEN
        v_fail    := v_fail + 1;
        v_results := v_results || jsonb_build_object(
          'ok', false,
          'nickname',   v_member.nickname,
          'nama',       v_member.nama_panggilan,
          'lingkungan', COALESCE(v_member.lingkungan, ''),
          'hp_ortu',    COALESCE(v_member.hp_ortu, ''),
          'hp_anak',    COALESCE(v_member.hp_anak, ''),
          'password',   NULL,
          'error',      'Email kosong — isi email di data anggota dulu'
        );
        CONTINUE;
      END IF;

      -- Cek email konflik
      SELECT EXISTS (
        SELECT 1 FROM auth.users
        WHERE LOWER(email) = LOWER(v_member.email) AND id != v_member.id
      ) INTO v_email_taken;

      IF v_email_taken THEN
        v_skipped := v_skipped + 1;
        v_results := v_results || jsonb_build_object(
          'ok', false,
          'nickname',   v_member.nickname,
          'nama',       v_member.nama_panggilan,
          'lingkungan', COALESCE(v_member.lingkungan, ''),
          'hp_ortu',    COALESCE(v_member.hp_ortu, ''),
          'hp_anak',    COALESCE(v_member.hp_anak, ''),
          'password',   NULL,
          'error',      'Email sudah dipakai akun auth lain (UUID berbeda). Hapus akun duplikat di Supabase Dashboard → Authentication → Users.'
        );
        CONTINUE;
      END IF;

      -- ── UPDATE auth.users (jika sudah ada) ────────────────
      UPDATE auth.users
      SET
        encrypted_password     = crypt(v_password, gen_salt('bf', 10)),
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

      -- ── INSERT auth.users (jika belum ada) ────────────────
      IF NOT v_found THEN
        INSERT INTO auth.users (
          id, instance_id, email, encrypted_password,
          email_confirmed_at, created_at, updated_at,
          aud, role, raw_app_meta_data, raw_user_meta_data,
          is_super_admin, confirmation_token, email_change_token_new, recovery_token
        ) VALUES (
          v_member.id, v_inst_id, v_member.email,
          crypt(v_password, gen_salt('bf', 10)),
          NOW(), NOW(), NOW(),
          'authenticated', 'authenticated',
          '{"provider":"email","providers":["email"]}'::jsonb,
          '{}'::jsonb,
          false, '', '', ''
        )
        ON CONFLICT DO NOTHING;

        -- Konfirmasi berhasil
        SELECT EXISTS (
          SELECT 1 FROM auth.users WHERE id = v_member.id
        ) INTO v_found;

        IF NOT v_found THEN
          v_fail    := v_fail + 1;
          v_results := v_results || jsonb_build_object(
            'ok', false,
            'nickname', v_member.nickname, 'nama', v_member.nama_panggilan,
            'lingkungan', COALESCE(v_member.lingkungan, ''),
            'hp_ortu', COALESCE(v_member.hp_ortu, ''), 'hp_anak', COALESCE(v_member.hp_anak, ''),
            'password', NULL,
            'error', 'INSERT ke auth.users gagal (conflict tidak terduga)'
          );
          CONTINUE;
        END IF;
      END IF;

      -- ── INSERT auth.identities ─────────────────────────────
      INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        v_member.id,
        jsonb_build_object(
          'sub',            v_member.id::text,
          'email',          v_member.email,
          'email_verified', true,
          'phone_verified', false
        ),
        'email',
        v_member.email,
        NOW(), NOW(), NOW()
      )
      ON CONFLICT DO NOTHING;

      -- ── Tandai must_change_password ────────────────────────
      UPDATE public.users
      SET must_change_password = TRUE, updated_at = NOW()
      WHERE id = v_member.id;

      v_success := v_success + 1;
      v_results := v_results || jsonb_build_object(
        'ok',         true,
        'nickname',   v_member.nickname,
        'nama',       v_member.nama_panggilan,
        'lingkungan', COALESCE(v_member.lingkungan, ''),
        'hp_ortu',    COALESCE(v_member.hp_ortu, ''),
        'hp_anak',    COALESCE(v_member.hp_anak, ''),
        'password',   v_password,
        'action',     CASE WHEN v_found THEN 'updated' ELSE 'created' END
      );

    EXCEPTION WHEN OTHERS THEN
      v_fail    := v_fail + 1;
      v_results := v_results || jsonb_build_object(
        'ok', false,
        'nickname',   v_member.nickname,
        'nama',       v_member.nama_panggilan,
        'lingkungan', COALESCE(v_member.lingkungan, ''),
        'hp_ortu',    COALESCE(v_member.hp_ortu, ''),
        'hp_anak',    COALESCE(v_member.hp_anak, ''),
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
    'fail',    v_fail,
    'skipped', v_skipped
  );
END;
$$;


-- ── admin_reset_password ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reset_password(
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
  v_email_taken BOOLEAN;
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

  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE LOWER(email) = LOWER(v_email) AND id != p_user_id
  ) INTO v_email_taken;

  IF v_email_taken THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMAIL_CONFLICT',
      'message', 'Email ' || v_email || ' sudah dipakai akun lain. Hapus akun duplikat di Supabase Dashboard → Authentication → Users.');
  END IF;

  SELECT instance_id INTO v_inst_id FROM auth.users LIMIT 1;
  v_inst_id := COALESCE(v_inst_id, '00000000-0000-0000-0000-000000000000'::UUID);

  UPDATE auth.users
  SET
    encrypted_password     = crypt(p_new_password, gen_salt('bf', 10)),
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
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_user_id,
    jsonb_build_object(
      'sub', p_user_id::text, 'email', v_email,
      'email_verified', true, 'phone_verified', false
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


-- Kembalikan role ke postgres
RESET ROLE;


-- ── Grant execute ke authenticated (dilakukan sebagai postgres) ──
GRANT EXECUTE ON FUNCTION public.generate_random_password(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_provision_all()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_password(UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_provision_all()           FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_reset_password(UUID, TEXT) FROM anon;


-- ================================================================
-- VERIFIKASI FINAL BERTINGKAT
-- Jalankan ini terakhir untuk konfirmasi semua berjalan benar
-- ================================================================
SELECT label, jumlah FROM (

  SELECT 1 AS ord,
    'public.users aktif (non-admin)'      AS label,
    COUNT(*)                               AS jumlah
  FROM public.users
  WHERE status IN ('Active','Pending') AND role::TEXT != 'Administrator'

  UNION ALL SELECT 2,
    'auth.users matched (by id)',
    COUNT(*)
  FROM auth.users au
  JOIN public.users pu ON pu.id = au.id
  WHERE pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator'

  UNION ALL SELECT 3,
    'auth.identities (email provider)',
    COUNT(*)
  FROM auth.identities ai
  JOIN public.users pu ON pu.id = ai.user_id
  WHERE ai.provider = 'email'
    AND pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator'

  UNION ALL SELECT 4,
    '⚠ auth.users MISSING',
    COUNT(*)
  FROM public.users pu
  LEFT JOIN auth.users au ON au.id = pu.id
  WHERE pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator'
    AND au.id IS NULL

  UNION ALL SELECT 5,
    '⚠ auth.identities MISSING',
    COUNT(*)
  FROM public.users pu
  LEFT JOIN auth.identities ai ON ai.user_id = pu.id AND ai.provider = 'email'
  WHERE pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator'
    AND ai.user_id IS NULL

  UNION ALL SELECT 6,
    '⚠ Email konflik (perlu fix manual)',
    COUNT(*)
  FROM public.users pu
  JOIN auth.users au ON LOWER(au.email) = LOWER(pu.email) AND au.id != pu.id
  WHERE pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator'

) t ORDER BY ord;
