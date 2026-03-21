// supabase/functions/admin-reset-password/index.ts
// Handle 2 mode:
//   1. reset   → update password user yang sudah ada di auth.users
//   2. provision → buat auth.users baru untuk anggota yang belum punya akun
//
// Semua operasi pakai Supabase Admin API (GoTrue) — BUKAN pgcrypto SQL
// sehingga bcrypt hash selalu kompatibel dan login selalu berhasil.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Generate password acak 10 karakter, mudah dibaca
function genPassword(len = 10): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let result = "";
  const arr  = new Uint8Array(len);
  crypto.getRandomValues(arr);
  for (const b of arr) result += chars[b % chars.length];
  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // ── Verifikasi caller ───────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const supabaseCaller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user: caller } } = await supabaseCaller.auth.getUser();
    if (!caller) return json({ ok: false, error: "Token tidak valid" }, 401);

    const { data: callerProfile } = await supabaseAdmin
      .from("users").select("role").eq("id", caller.id).single();
    if (!["Administrator", "Pengurus"].includes(callerProfile?.role)) {
      return json({ ok: false, error: "Hanya Administrator/Pengurus" }, 403);
    }

    // ── Parse payload ───────────────────────────────────────────
    const body = await req.json();
    const mode = body.mode || "reset"; // "reset" | "provision" | "provision_all"

    // ── MODE: reset — update password 1 user ───────────────────
    if (mode === "reset") {
      const { user_id, new_password } = body;
      if (!user_id || !new_password) {
        return json({ ok: false, error: "user_id dan new_password wajib" }, 400);
      }
      if (new_password.length < 6) {
        return json({ ok: false, error: "Password minimal 6 karakter" }, 400);
      }
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
        password:      new_password,
        email_confirm: true,
      });
      if (error) return json({ ok: false, error: error.message }, 500);

      await supabaseAdmin.from("users")
        .update({ must_change_password: true, updated_at: new Date().toISOString() })
        .eq("id", user_id);

      return json({ ok: true });
    }

    // ── MODE: provision_all — buat akun untuk semua yang missing ─
    if (mode === "provision_all") {
      // Ambil semua anggota aktif yang belum punya auth.users
      const { data: members } = await supabaseAdmin
        .from("users")
        .select("id, nickname, email, nama_panggilan, hp_ortu, hp_anak")
        .in("status", ["Active", "Pending"]);

      if (!members?.length) return json({ ok: true, results: [], total: 0 });

      const results = [];

      for (const m of members) {
        // Cek apakah auth user sudah ada
        const { data: existing } = await supabaseAdmin.auth.admin.getUserById(m.id);

        const pw = genPassword(10);

        if (!existing?.user) {
          // Belum ada — buat baru
          const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            email:        m.email,
            password:     pw,
            email_confirm: true,
            user_metadata: {},
          });

          if (createErr) {
            results.push({ nickname: m.nickname, nama: m.nama_panggilan,
              email: m.email, password: null, ok: false, error: createErr.message });
            continue;
          }

          // Pastikan id di auth.users = id di public.users
          // (Supabase createUser biasanya buat UUID baru — perlu update)
          if (created.user.id !== m.id) {
            // Update referensi id di public.users
            await supabaseAdmin.from("users")
              .update({ id: created.user.id })
              .eq("id", m.id);
          }

          await supabaseAdmin.from("users")
            .update({ must_change_password: true, updated_at: new Date().toISOString() })
            .eq("id", created.user.id);

          results.push({ nickname: m.nickname, nama: m.nama_panggilan,
            email: m.email, password: pw, ok: true, action: "created" });
        } else {
          // Sudah ada — hanya reset password
          const { error: resetErr } = await supabaseAdmin.auth.admin.updateUserById(
            m.id, { password: pw, email_confirm: true },
          );
          await supabaseAdmin.from("users")
            .update({ must_change_password: true })
            .eq("id", m.id);

          results.push({ nickname: m.nickname, nama: m.nama_panggilan,
            email: m.email, password: pw, ok: !resetErr,
            action: "reset", error: resetErr?.message });
        }
      }

      const ok = results.filter(r => r.ok).length;
      return json({ ok: true, results, total: results.length, success: ok });
    }

    return json({ ok: false, error: `Mode tidak dikenal: ${mode}` }, 400);

  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
