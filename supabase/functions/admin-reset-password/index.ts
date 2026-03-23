// supabase/functions/admin-reset-password/index.ts
// Verifikasi role pakai service_role langsung — lebih reliable

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function randPassword(len = 10) {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!SERVICE_KEY) {
      return reply({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY tidak tersedia di edge function" }, 500);
    }

    // ── Ping — cek apakah EF aktif, tidak butuh auth ──────────────
    const bodyPing = await req.clone().json().catch(() => ({}));
    if (bodyPing.mode === "ping") {
      return reply({ ok: true, message: "Edge Function admin-reset-password aktif" });
    }

    // Admin client — service_role, bypass semua RLS
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Verifikasi token ──────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      return reply({ ok: false, error: "Authorization header kosong" }, 401);
    }

    // Pakai admin.auth.getUser(token) — ini cara paling reliable
    const { data: { user: callerUser }, error: tokenErr } = await admin.auth.getUser(token);

    if (tokenErr || !callerUser) {
      console.error("Token error:", tokenErr?.message);
      return reply({
        ok: false,
        error: `Token error: ${tokenErr?.message ?? "user null"} — coba logout & login ulang`,
      }, 401);
    }

    // Cek role di public.users
    const { data: profile, error: profileErr } = await admin
      .from("users")
      .select("role")
      .eq("id", callerUser.id)
      .single();

    if (profileErr || !profile) {
      return reply({ ok: false, error: "Profil tidak ditemukan di database" }, 403);
    }

    if (!["Administrator", "Pengurus"].includes(profile.role)) {
      return reply({ ok: false, error: `Role "${profile.role}" tidak bisa reset password` }, 403);
    }

    // ── Parse body ────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const mode = body.mode ?? "reset";

    // ─────────────────────────────────────────────────────────────
    // MODE: reset — update password 1 user
    // ─────────────────────────────────────────────────────────────
    if (mode === "reset") {
      const { user_id, new_password } = body;
      if (!user_id || !new_password) {
        return reply({ ok: false, error: "user_id dan new_password wajib" }, 400);
      }
      if (new_password.length < 6) {
        return reply({ ok: false, error: "Password minimal 6 karakter" }, 400);
      }

      // Cek apakah ada di auth.users
      const { data: existingAuth } = await admin.auth.admin.getUserById(user_id);

      if (!existingAuth?.user) {
        // Belum ada di auth.users — ambil data dan buat
        const { data: pubUser } = await admin
          .from("users")
          .select("email, nickname")
          .eq("id", user_id)
          .single();

        if (!pubUser?.email) {
          return reply({ ok: false, error: `User ${user_id} tidak ditemukan` }, 404);
        }

        const { error: createErr } = await admin.auth.admin.createUser({
          email: pubUser.email,
          password: new_password,
          email_confirm: true,
        });

        if (createErr) {
          return reply({ ok: false, error: `Gagal buat akun: ${createErr.message}` }, 500);
        }
      } else {
        // Sudah ada — update password
        const { error: upErr } = await admin.auth.admin.updateUserById(user_id, {
          password: new_password,
          email_confirm: true,
        });
        if (upErr) {
          return reply({ ok: false, error: upErr.message }, 500);
        }
      }

      await admin.from("users")
        .update({ must_change_password: true, updated_at: new Date().toISOString() })
        .eq("id", user_id);

      return reply({ ok: true });
    }

    // ─────────────────────────────────────────────────────────────
    // MODE: provision_all — buat/reset akun untuk semua anggota
    // ─────────────────────────────────────────────────────────────
    if (mode === "provision_all") {
      const { data: members, error: membErr } = await admin
        .from("users")
        .select("id, email, nickname, nama_panggilan, lingkungan, hp_ortu, hp_anak")
        .in("status", ["Active", "Pending"]);

      if (membErr) return reply({ ok: false, error: membErr.message }, 500);
      if (!members?.length) return reply({ ok: true, results: [], total: 0 });

      const results = [];

      for (const m of members) {
        const pw = randPassword(10);
        const base = {
          nickname: m.nickname,
          nama: m.nama_panggilan,
          email: m.email,
          lingkungan: m.lingkungan ?? "",
          hp_ortu: m.hp_ortu ?? "",
          hp_anak: m.hp_anak ?? "",
        };

        const { data: existingAuth } = await admin.auth.admin.getUserById(m.id);

        if (!existingAuth?.user) {
          const { error: createErr } = await admin.auth.admin.createUser({
            email: m.email,
            password: pw,
            email_confirm: true,
          });
          if (createErr) {
            results.push({ ...base, password: null, ok: false, error: createErr.message });
          } else {
            await admin.from("users").update({ must_change_password: true }).eq("id", m.id);
            results.push({ ...base, password: pw, ok: true, action: "created" });
          }
        } else {
          const { error: upErr } = await admin.auth.admin.updateUserById(m.id, {
            password: pw,
            email_confirm: true,
          });
          await admin.from("users").update({ must_change_password: true }).eq("id", m.id);
          results.push({ ...base, password: pw, ok: !upErr, action: "reset", error: upErr?.message });
        }
      }

      const okCount = results.filter(r => r.ok).length;
      return reply({ ok: true, results, total: results.length, success: okCount });
    }

    return reply({ ok: false, error: `Mode tidak dikenal: "${mode}"` }, 400);

  } catch (err) {
    console.error("Crash:", err);
    return reply({ ok: false, error: `Server crash: ${err?.message ?? String(err)}` }, 500);
  }
});
