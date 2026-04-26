-- ================================================================
-- SIGMA Migration 021: Fix Duplicate Email Constraint
--
-- KENAPA MIGRATION 020 GAGAL:
--   STEP 1 menggunakan: ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
--   Ketika UPDATE ini dieksekusi, PostgreSQL harus memastikan hasilnya
--   tidak melanggar constraint LAIN — termasuk:
--   users_email_partial_key: UNIQUE INDEX ON auth.users(email)
--                            WHERE is_sso_user = false
--
--   Error terjadi karena salah satu dari kondisi berikut:
--   A) Email felisitabeauty@gmail.com sudah ada di auth.users dengan UUID
--      BERBEDA dari public.users (mungkin dibuat manual atau via signup)
--   B) Dua baris di public.users berbagi email yang sama
--   C) UPDATE email pada baris yang sudah ada menabrak baris lain
--
-- SOLUSI INI:
--   1. DIAGNOSA dulu — tampilkan semua email bermasalah
--   2. Skip email yang sudah dipakai auth.users dengan UUID berbeda
--   3. Hapus 'email = EXCLUDED.email' dari ON CONFLICT DO UPDATE
--   4. Deduplikasi email dari public.users sebelum INSERT
--   5. Laporan akhir: berhasil vs dilewati (bukan error)
--
-- CARA MENJALANKAN:
--   Supabase Dashboard → SQL Editor → paste semua → Run
-- ================================================================


-- ================================================================
-- DIAGNOSA: Tampilkan semua email bermasalah sebelum proses
-- Baca output ini untuk memahami kondisi datamu
-- ================================================================
SELECT
  'Email konflik: public.users vs auth.users (UUID berbeda)' AS masalah,
  pu.nickname,
  pu.email,
  pu.id           AS id_di_public_users,
  au.id           AS id_di_auth_users
FROM public.users pu
JOIN auth.users au ON LOWER(au.email) = LOWER(pu.email) AND au.id != pu.id
WHERE pu.status IN ('Active','Pending')
  AND pu.role::TEXT != 'Administrator'

UNION ALL

SELECT
  'Email duplikat di public.users',
  pu.nickname,
  pu.email,
  pu.id,
  NULL
FROM public.users pu
WHERE pu.status IN ('Active','Pending')
  AND pu.role::TEXT != 'Administrator'
  AND pu.email IN (
    SELECT email FROM public.users
    WHERE status IN ('Active','Pending')
      AND role::TEXT != 'Administrator'
    GROUP BY email HAVING COUNT(*) > 1
  )
ORDER BY masalah, email;


-- ================================================================
-- STEP 1: UPSERT auth.users — skip email yang sudah konflik
-- ================================================================
WITH

-- Deduplikasi email di public.users (ambil yang terlama = paling valid)
dedup AS (
  SELECT DISTINCT ON (LOWER(email))
    id, email, nickname, nama_panggilan
  FROM public.users
  WHERE status IN ('Active','Pending')
    AND role::TEXT != 'Administrator'
    AND email IS NOT NULL
    AND trim(email) != ''
  ORDER BY LOWER(email), created_at ASC NULLS LAST
),

-- Skip email yang sudah dipakai auth.users dengan UUID berbeda
-- (ini penyebab users_email_partial_key violation)
safe AS (
  SELECT d.*,
    (SELECT instance_id FROM auth.users LIMIT 1) AS inst_id
  FROM dedup d
  WHERE NOT EXISTS (
    SELECT 1 FROM auth.users au
    WHERE LOWER(au.email) = LOWER(d.email)
      AND au.id != d.id
  )
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
  safe.id,
  COALESCE(safe.inst_id, '00000000-0000-0000-0000-000000000000'::UUID),
  safe.email,
  crypt('sigma' || substring(safe.id::text, 1, 8), gen_salt('bf', 10)),
  NOW(), NOW(), NOW(),
  'authenticated', 'authenticated',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  false, '', '', ''
FROM safe
ON CONFLICT (id) DO UPDATE SET
  -- JANGAN update email — ini yang menyebabkan constraint violation
  -- Email di auth.users tidak boleh diubah via migration
  updated_at             = NOW(),
  email_confirmed_at     = COALESCE(auth.users.email_confirmed_at, NOW()),
  aud                    = 'authenticated',
  role                   = 'authenticated',
  banned_until           = NULL,
  confirmation_token     = '',
  recovery_token         = '',
  email_change_token_new = '';

-- Verifikasi STEP 1
SELECT
  'STEP 1 done'              AS step,
  COUNT(*)                   AS berhasil_di_auth_users
FROM auth.users au
JOIN public.users pu ON pu.id = au.id
WHERE pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator';


-- ================================================================
-- STEP 2: INSERT auth.identities
-- ON CONFLICT DO NOTHING: aman untuk semua versi GoTrue
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
  NOW(), NOW(), NOW()
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

-- Verifikasi STEP 2
SELECT
  'STEP 2 done'              AS step,
  COUNT(*)                   AS berhasil_di_auth_identities
FROM auth.identities ai
JOIN public.users pu ON pu.id = ai.user_id
WHERE ai.provider = 'email'
  AND pu.status IN ('Active','Pending')
  AND pu.role::TEXT != 'Administrator';


-- ================================================================
-- STEP 3: Rebuild admin_provision_all — fix email conflict handling
-- ================================================================
CREATE OR REPLACE FUNCTION admin_provision_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public, auth
AS $$
DECLARE
  v_caller_role   TEXT;
  v_member        RECORD;
  v_password      TEXT;
  v_found         BOOLEAN;
  v_inst_id       UUID;
  v_email_taken   BOOLEAN;
  v_results       jsonb := '[]'::jsonb;
  v_success       INT   := 0;
  v_fail          INT   := 0;
  v_skipped       INT   := 0;
BEGIN
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

  SELECT instance_id INTO v_inst_id FROM auth.users LIMIT 1;
  v_inst_id := COALESCE(v_inst_id, '00000000-0000-0000-0000-000000000000'::UUID);

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
          'ok', false, 'nickname', v_member.nickname, 'nama', v_member.nama_panggilan,
          'lingkungan', COALESCE(v_member.lingkungan,''),
          'hp_ortu', COALESCE(v_member.hp_ortu,''), 'hp_anak', COALESCE(v_member.hp_anak,''),
          'password', NULL, 'error', 'Email kosong — isi email di data anggota dulu'
        );
        CONTINUE;
      END IF;

      -- Cek apakah email sudah dipakai auth.users dengan UUID berbeda
      SELECT EXISTS (
        SELECT 1 FROM auth.users au
        WHERE LOWER(au.email) = LOWER(v_member.email)
          AND au.id != v_member.id
      ) INTO v_email_taken;

      IF v_email_taken THEN
        -- Lewati user ini — email conflict, tidak bisa diproses otomatis
        -- Admin harus fix secara manual di Supabase Auth dashboard
        v_skipped := v_skipped + 1;
        v_results := v_results || jsonb_build_object(
          'ok', false, 'nickname', v_member.nickname, 'nama', v_member.nama_panggilan,
          'lingkungan', COALESCE(v_member.lingkungan,''),
          'hp_ortu', COALESCE(v_member.hp_ortu,''), 'hp_anak', COALESCE(v_member.hp_anak,''),
          'password', NULL,
          'error', 'Email ' || v_member.email || ' sudah dipakai akun auth lain. Hapus akun duplikat di Supabase Auth Dashboard dulu.'
        );
        CONTINUE;
      END IF;

      -- UPSERT auth.users
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
        -- TIDAK update email: bisa melanggar users_email_partial_key
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
          crypt(v_password, gen_salt('bf', 10)),
          NOW(), NOW(), NOW(), 'authenticated', 'authenticated',
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
          false, '', '', ''
        )
        ON CONFLICT DO NOTHING;

        -- Cek apakah INSERT berhasil (bisa DO NOTHING karena constraint lain)
        SELECT EXISTS (
          SELECT 1 FROM auth.users WHERE id = v_member.id
        ) INTO v_found;

        IF NOT v_found THEN
          v_fail    := v_fail + 1;
          v_results := v_results || jsonb_build_object(
            'ok', false, 'nickname', v_member.nickname, 'nama', v_member.nama_panggilan,
            'lingkungan', COALESCE(v_member.lingkungan,''),
            'hp_ortu', COALESCE(v_member.hp_ortu,''), 'hp_anak', COALESCE(v_member.hp_anak,''),
            'password', NULL, 'error', 'Insert ke auth.users gagal tanpa error detail (constraint conflict)'
          );
          CONTINUE;
        END IF;
      END IF;

      -- UPSERT auth.identities
      INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), v_member.id,
        jsonb_build_object(
          'sub', v_member.id::text, 'email', v_member.email,
          'email_verified', true, 'phone_verified', false
        ),
        'email', v_member.email,
        NOW(), NOW(), NOW()
      )
      ON CONFLICT DO NOTHING;

      -- Tandai must_change_password
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
    'fail',    v_fail,
    'skipped', v_skipped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_provision_all()  TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_provision_all() FROM anon;


-- ================================================================
-- STEP 4: Rebuild admin_reset_password — fix email conflict handling
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

  -- Cek email conflict
  SELECT EXISTS (
    SELECT 1 FROM auth.users WHERE LOWER(email) = LOWER(v_email) AND id != p_user_id
  ) INTO v_email_taken;

  IF v_email_taken THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMAIL_CONFLICT',
      'message', 'Email ' || v_email || ' sudah dipakai akun auth lain. Hapus akun duplikat di Supabase Dashboard → Authentication → Users.');
  END IF;

  SELECT instance_id INTO v_inst_id FROM auth.users LIMIT 1;
  v_inst_id := COALESCE(v_inst_id, '00000000-0000-0000-0000-000000000000'::UUID);

  -- UPSERT auth.users (tanpa update email)
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

  -- UPSERT auth.identities
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

GRANT EXECUTE ON FUNCTION admin_reset_password(UUID, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_reset_password(UUID, TEXT) FROM anon;


-- ================================================================
-- VERIFIKASI FINAL — semua angka harus 131/131/131 dan 0/0
-- ================================================================
SELECT
  label, jumlah
FROM (
  SELECT 1 AS ord, 'public.users aktif (non-admin)'    AS label, COUNT(*) AS jumlah
  FROM public.users
  WHERE status IN ('Active','Pending') AND role::TEXT != 'Administrator'

  UNION ALL
  SELECT 2, 'auth.users berhasil (matched)', COUNT(*)
  FROM auth.users au
  JOIN public.users pu ON pu.id = au.id
  WHERE pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator'

  UNION ALL
  SELECT 3, 'auth.identities berhasil', COUNT(*)
  FROM auth.identities ai
  JOIN public.users pu ON pu.id = ai.user_id
  WHERE ai.provider = 'email'
    AND pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator'

  UNION ALL
  SELECT 4, '⚠ auth.users MISSING', COUNT(*)
  FROM public.users pu
  LEFT JOIN auth.users au ON au.id = pu.id
  WHERE pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator'
    AND au.id IS NULL

  UNION ALL
  SELECT 5, '⚠ auth.identities MISSING', COUNT(*)
  FROM public.users pu
  LEFT JOIN auth.identities ai ON ai.user_id = pu.id AND ai.provider = 'email'
  WHERE pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator'
    AND ai.user_id IS NULL

  UNION ALL
  SELECT 6, '⚠ Email konflik (dilewati)', COUNT(*)
  FROM public.users pu
  JOIN auth.users au ON LOWER(au.email) = LOWER(pu.email) AND au.id != pu.id
  WHERE pu.status IN ('Active','Pending') AND pu.role::TEXT != 'Administrator'
) t
ORDER BY ord;
