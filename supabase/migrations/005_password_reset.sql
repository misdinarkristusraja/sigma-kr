-- ── Tambah kolom must_change_password ke tabel users ──────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Fungsi RPC: admin reset password (via service_role) ───────
-- Dipanggil jika supabase.auth.admin.updateUserById tidak tersedia di frontend
CREATE OR REPLACE FUNCTION admin_reset_password(
  p_user_id     UUID,
  p_new_password TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Update password di auth.users
  UPDATE auth.users
  SET encrypted_password = crypt(p_new_password, gen_salt('bf'))
  WHERE id = p_user_id;

  -- Tandai harus ganti password
  UPDATE public.users
  SET must_change_password = TRUE,
      updated_at = NOW()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_reset_password(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_reset_password(UUID, TEXT) TO service_role;

-- ── Set migrated users untuk wajib ganti password ─────────────
-- Jalankan manual setelah migrasi selesai:
-- UPDATE users SET must_change_password = TRUE
-- WHERE created_at < '2026-01-01'  -- atau tanggal deploy SIGMA
--   AND status = 'Active';

-- ── Verifikasi ────────────────────────────────────────────────
SELECT
  COUNT(*) FILTER (WHERE must_change_password = TRUE)  AS wajib_ganti,
  COUNT(*) FILTER (WHERE must_change_password = FALSE) AS sudah_ok,
  COUNT(*) AS total
FROM users;
