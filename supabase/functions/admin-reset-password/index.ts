// supabase/functions/admin-reset-password/index.ts
//
// CARA DEPLOY (wajib, hanya sekali):
//   supabase functions deploy admin-reset-password --no-verify-jwt
//
// PENGATURAN SUPABASE DASHBOARD (wajib):
//   Dashboard → Edge Functions → admin-reset-password → Settings
//   → "Enforce JWT Verification" = OFF (pastikan tidak dicentang)
//
// Auth dilakukan MANUAL di dalam kode menggunakan pola resmi Supabase:
//   admin.auth.getUser(token) — bukan authClient.auth.getUser()

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function randPassword(len = 10): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // ── Ambil env vars (otomatis tersedia di Supabase Edge Functions) ──
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return reply({
        ok: false,
        error: "SERVER_CONFIG_ERROR",
        message: "Environment variables SUPABASE_URL atau SERVICE_ROLE_KEY belum tersedia di edge function. Re-deploy function.",
      }, 500);
    }

    // ── Admin client (service role, bypass RLS) ──────────────────────
    // Dibuat sekali di sini karena dipakai untuk: verifikasi JWT, cek role, dan operasi user.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Parse body ────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const mode = (body.mode as string) ?? "reset";

    // ── MODE: ping ────────────────────────────────────────────────────
    // FIX: Ping di-handle SEBELUM auth verification agar bisa mendeteksi
    // apakah edge function aktif, terlepas dari status JWT pemanggil.
    // Ping tidak butuh auth — hanya mengecek apakah function berjalan.
    if (mode === "ping") {
      return reply({
        ok: true,
        status: "aktif",
        env_ok: true,
        timestamp: new Date().toISOString(),
      });
    }

    // ── Auth: Verifikasi JWT pemanggil ────────────────────────────────
    // FIX: Gunakan admin.auth.getUser(token) — pola resmi Supabase untuk
    // memvalidasi JWT di edge function. Lebih reliable daripada membuat
    // authClient baru dengan ANON_KEY + global header override, yang bisa
    // gagal karena konflik antara apikey dan Authorization header.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      return reply({
        ok: false,
        error: "MISSING_TOKEN",
        message: "Authorization header tidak ada. Pastikan kamu sudah login.",
      }, 401);
    }

    const { data: { user }, error: authErr } = await admin.auth.getUser(token);

    if (authErr || !user) {
      return reply({
        ok: false,
        error: "INVALID_TOKEN",
        message: `JWT tidak valid atau sudah expired: ${authErr?.message ?? "user null"}. Logout lalu login kembali.`,
      }, 401);
    }

    // ── Cek Role Administrator ────────────────────────────────────────
    // Gunakan admin client (service role) agar query tidak terhalang RLS.
    const { data: profile, error: profileErr } = await admin
      .from("users")
      .select("role, status")
      .eq("id", user.id)
      .single();

    if (profileErr || !profile) {
      return reply({
        ok: false,
        error: "PROFILE_NOT_FOUND",
        message: `Profil user tidak ditemukan di database: ${profileErr?.message ?? "null"}. Pastikan akun sudah diapprove.`,
      }, 403);
    }

    if (profile.role !== "Administrator") {
      return reply({
        ok: false,
        error: "NOT_ADMIN",
        message: `Akses ditolak. Role kamu: "${profile.role}". Hanya Administrator yang boleh menggunakan fitur ini.`,
      }, 403);
    }

    // ── MODE: reset (satu user) ───────────────────────────────────────
    if (mode === "reset") {
      const target_user_id = body.user_id as string;
      const new_password   = body.new_password as string;

      if (!target_user_id || !new_password) {
        return reply({ ok: false, error: "MISSING_PARAMS", message: "user_id dan new_password wajib disediakan" }, 400);
      }

      if (new_password.length < 6) {
        return reply({ ok: false, error: "PASSWORD_TOO_SHORT", message: "Password minimal 6 karakter" }, 400);
      }

      // Ambil email dari public.users
      const { data: pubUser, error: pubErr } = await admin
        .from("users")
        .select("email")
        .eq("id", target_user_id)
        .single();

      if (pubErr || !pubUser?.email) {
        return reply({
          ok: false,
          error: "TARGET_NOT_FOUND",
          message: `User target tidak ditemukan: ${pubErr?.message ?? "email kosong"}`,
        }, 404);
      }

      // Cek apakah sudah ada di auth.users
      const { data: existingAuth } = await admin.auth.admin.getUserById(target_user_id);

      if (!existingAuth?.user) {
        // Belum ada di auth.users → buat baru
        const { error: ce } = await admin.auth.admin.createUser({
          email: pubUser.email,
          password: new_password,
          email_confirm: true,
        });
        if (ce) {
          return reply({ ok: false, error: "CREATE_FAILED", message: `Gagal buat auth user: ${ce.message}` }, 500);
        }
      } else {
        // Sudah ada → update password, pastikan tidak ter-ban
        const { error: ue } = await admin.auth.admin.updateUserById(target_user_id, {
          email: pubUser.email,
          password: new_password,
          email_confirm: true,
          ban_duration: "none",
        });
        if (ue) {
          return reply({ ok: false, error: "UPDATE_FAILED", message: `Gagal update auth user: ${ue.message}` }, 500);
        }
      }

      // Tandai wajib ganti password
      await admin
        .from("users")
        .update({ must_change_password: true, updated_at: new Date().toISOString() })
        .eq("id", target_user_id);

      return reply({ ok: true });
    }

    // ── MODE: provision_all (semua user aktif, satu call) ─────────────
    if (mode === "provision_all") {
      // Ambil semua user Active/Pending kecuali Administrator
      const { data: members, error: me } = await admin
        .from("users")
        .select("id, email, nickname, nama_panggilan, lingkungan, hp_ortu, hp_anak, role")
        .in("status", ["Active", "Pending"])
        .neq("role", "Administrator");

      if (me) {
        return reply({ ok: false, error: "FETCH_MEMBERS_FAILED", message: me.message }, 500);
      }
      if (!members?.length) {
        return reply({ ok: true, results: [], total: 0, success: 0 });
      }

      const results = [];

      for (const m of members) {
        if (!m.email) {
          results.push({
            nickname: m.nickname, nama: m.nama_panggilan,
            lingkungan: m.lingkungan ?? "", hp_ortu: m.hp_ortu ?? "", hp_anak: m.hp_anak ?? "",
            password: null, ok: false, error: "Email kosong di database",
          });
          continue;
        }

        const pw = randPassword(10);
        const base = {
          nickname: m.nickname, nama: m.nama_panggilan,
          lingkungan: m.lingkungan ?? "", hp_ortu: m.hp_ortu ?? "", hp_anak: m.hp_anak ?? "",
        };

        const { data: ea } = await admin.auth.admin.getUserById(m.id);

        if (!ea?.user) {
          const { error: ce } = await admin.auth.admin.createUser({
            email: m.email, password: pw, email_confirm: true,
          });
          if (ce) {
            results.push({ ...base, password: null, ok: false, error: ce.message });
          } else {
            await admin.from("users").update({ must_change_password: true }).eq("id", m.id);
            results.push({ ...base, password: pw, ok: true, action: "created" });
          }
        } else {
          const { error: ue } = await admin.auth.admin.updateUserById(m.id, {
            password: pw, email_confirm: true, ban_duration: "none",
          });
          await admin.from("users").update({ must_change_password: true }).eq("id", m.id);
          results.push({
            ...base, password: pw,
            ok: !ue, action: "reset",
            error: ue?.message,
          });
        }
      }

      const successCount = results.filter((r) => r.ok).length;
      return reply({
        ok: true,
        results,
        total: results.length,
        success: successCount,
        fail: results.length - successCount,
      });
    }

    return reply({ ok: false, error: "UNKNOWN_MODE", message: `Mode tidak dikenal: "${mode}"` }, 400);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Edge function crash:", msg);
    return reply({ ok: false, error: "SERVER_CRASH", message: `Server error: ${msg}` }, 500);
  }
});
