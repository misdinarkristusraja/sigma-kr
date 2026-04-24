-- ================================================================
-- SIGMA Migration 017: Fix admin_provision_all — UPSERT auth.users
--
-- MASALAH YANG DIPERBAIKI:
--   Migration 010 memanggil crypt() dan gen_salt() tanpa prefix
--   'extensions.' → fungsi tidak ditemukan di search_path → DO block
--   gagal diam-diam → 0 baris terbuat di auth.users.
--
--   Migration 016 admin_provision_all hanya melakukan UPDATE.
--   Ketika tidak ada baris di auth.users, UPDATE tidak menemukan
--   target → semua 131 user gagal dengan error "Akun belum ada".
--
-- SOLUSI:
--   Ganti admin_provision_all dengan pola UPSERT:
--   - Coba UPDATE dulu
--   - Jika tidak ditemukan (v_found=FALSE) → INSERT baris baru
--   - Gunakan extensions.crypt() dan extensions.gen_salt() yang benar
--
-- CARA MENJALANKAN:
--   Supabase Dashboard → SQL Editor → paste dan Run
-- ================================================================

-- ── Pastikan pgcrypto tersedia ────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- ── Helper password ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_random_password(p_length INT DEFAULT 10)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public
AS $$
DECLARE
  v_charset TEXT  := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_len     INT   := length('abcdefghjkmnpqrstuvwxyz23456789');
  v_bytes   BYTEA := extensions.gen_random_bytes(p_length * 2);
  v_result  TEXT  := '';
  i         INT;
BEGIN
  FOR i IN 1..p_length LOOP
    v_result := v_result || substr(
      v_charset,
      (get_byte(v_bytes, i - 1) % v_len) + 1,
      1
    );
  END LOOP;
  RETURN v_result;
END;
$$;


-- ================================================================
-- admin_reset_password (satu user) — tetap sama tapi search_path fix
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

  -- Ambil email dari public.users
  SELECT email INTO v_email FROM public.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_EMAIL',
      'message', 'Email tidak ditemukan di public.users untuk user ini.');
  END IF;

  -- Ambil instance_id dari auth.users yang sudah ada
  SELECT instance_id INTO v_inst_id FROM auth.users LIMIT 1;
  IF v_inst_id IS NULL THEN
    v_inst_id := '00000000-0000-0000-0000-000000000000'::UUID;
  END IF;

  -- Coba UPDATE dulu
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

  -- Jika tidak ada di auth.users → INSERT baru
  IF NOT v_found THEN
    INSERT INTO auth.users (
      id, instance_id, email,
      encrypted_password,
      email_confirmed_at, created_at, updated_at,
      aud, role,
      raw_app_meta_data, raw_user_meta_data,
      is_super_admin,
      confirmation_token, email_change_token_new, recovery_token
    ) VALUES (
      p_user_id, v_inst_id, v_email,
      extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
      NOW(), NOW(), NOW(),
      'authenticated', 'authenticated',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      false, '', '', ''
    )
    ON CONFLICT (id) DO UPDATE SET
      encrypted_password     = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
      email                  = v_email,
      updated_at             = NOW(),
      email_confirmed_at     = COALESCE(auth.users.email_confirmed_at, NOW()),
      banned_until           = NULL;
  END IF;

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
-- admin_provision_all — UPSERT (INSERT jika belum ada, UPDATE jika ada)
-- ================================================================
CREATE OR REPLACE FUNCTION admin_provision_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public, auth
AS $$
DECLARE
  v_caller_role  TEXT;
  v_member       RECORD;
  v_password     TEXT;
  v_found        BOOLEAN;
  v_inst_id      UUID;
  v_results      jsonb := '[]'::jsonb;
  v_success      INT   := 0;
  v_fail         INT   := 0;
BEGIN
  -- ── 1. Cek caller ─────────────────────────────────────────────
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

  -- ── 2. Ambil instance_id dari auth.users yang sudah ada ────────
  -- Supabase hosted selalu memakai '00000000-0000-0000-0000-000000000000'
  -- tapi kita baca dari DB agar aman jika ada konfigurasi khusus.
  SELECT instance_id INTO v_inst_id FROM auth.users LIMIT 1;
  IF v_inst_id IS NULL THEN
    v_inst_id := '00000000-0000-0000-0000-000000000000'::UUID;
  END IF;

  -- ── 3. Loop semua user Active/Pending kecuali Administrator ────
  FOR v_member IN
    SELECT
      pu.id,
      pu.nickname,
      pu.nama_panggilan,
      pu.lingkungan,
      pu.hp_ortu,
      pu.hp_anak,
      pu.email
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
          'ok', false,
          'nickname', v_member.nickname,
          'nama',     v_member.nama_panggilan,
          'lingkungan', COALESCE(v_member.lingkungan, ''),
          'hp_ortu',  COALESCE(v_member.hp_ortu, ''),
          'hp_anak',  COALESCE(v_member.hp_anak, ''),
          'password', NULL,
          'error',    'Email kosong di public.users — isi email dulu'
        );
        CONTINUE;
      END IF;

      -- ── Coba UPDATE auth.users dulu ──────────────────────────
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

      -- ── Jika belum ada → INSERT baru ─────────────────────────
      -- Ini adalah kasus utama yang sebelumnya menyebabkan 131/131 gagal.
      -- Migration 010 gagal membuat auth.users karena crypt() dipanggil
      -- tanpa prefix 'extensions.' — sehingga tidak ada baris di auth.users.
      IF NOT v_found THEN
        INSERT INTO auth.users (
          id, instance_id, email,
          encrypted_password,
          email_confirmed_at, created_at, updated_at,
          aud, role,
          raw_app_meta_data, raw_user_meta_data,
          is_super_admin,
          confirmation_token, email_change_token_new, recovery_token
        ) VALUES (
          v_member.id,
          v_inst_id,
          v_member.email,
          extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
          NOW(), NOW(), NOW(),
          'authenticated', 'authenticated',
          '{"provider":"email","providers":["email"]}'::jsonb,
          '{}'::jsonb,
          false, '', '', ''
        )
        -- ON CONFLICT sebagai safety net — jika ada race condition
        ON CONFLICT (id) DO UPDATE SET
          encrypted_password     = extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
          email                  = v_member.email,
          updated_at             = NOW(),
          email_confirmed_at     = COALESCE(auth.users.email_confirmed_at, NOW()),
          banned_until           = NULL;
      END IF;

      -- ── Tandai harus ganti password ──────────────────────────
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
        'ok',       false,
        'nickname', v_member.nickname,
        'nama',     v_member.nama_panggilan,
        'lingkungan', COALESCE(v_member.lingkungan, ''),
        'hp_ortu',  COALESCE(v_member.hp_ortu, ''),
        'hp_anak',  COALESCE(v_member.hp_anak, ''),
        'password', NULL,
        'error',    SQLERRM || ' [' || SQLSTATE || ']'
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

GRANT EXECUTE ON FUNCTION admin_provision_all() TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_provision_all() FROM anon;


-- ================================================================
-- VERIFIKASI LANGSUNG
-- Jalankan SELECT ini untuk memastikan fungsi terdaftar dengan benar
-- ================================================================
SELECT
  routine_name,
  security_type,
  routine_definition IS NOT NULL AS has_body
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'admin_reset_password',
    'admin_provision_all',
    'generate_random_password'
  )
ORDER BY routine_name;

-- ================================================================
-- DIAGNOSA: Berapa user yang sudah/belum ada di auth.users?
-- Jalankan ini untuk konfirmasi kondisi sebelum reset
-- ================================================================
SELECT
  CASE WHEN au.id IS NULL THEN 'MISSING dari auth.users'
       ELSE 'ADA di auth.users' END            AS status,
  COUNT(*)                                      AS jumlah
FROM public.users pu
LEFT JOIN auth.users au ON au.id = pu.id
WHERE pu.status IN ('Active', 'Pending')
  AND pu.role::TEXT != 'Administrator'
GROUP BY 1
ORDER BY 1;
