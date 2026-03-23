// supabase/functions/admin-reset-password/index.ts
// Versi: simpel, robust, tanpa TypeScript strict types
// Deploy: Supabase Dashboard → Edge Functions → New Function → nama: admin-reset-password

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
    // ── 1. Ambil token dari header ─────────────────────────────
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return reply({ ok: false, error: "Token kosong — pastikan sudah login" }, 401);

    // ── 2. Buat dua client ─────────────────────────────────────
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!SERVICE_KEY) return reply({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY tidak tersedia" }, 500);

    // Admin client — pakai service_role, bypass semua RLS
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Caller client — verifikasi token user yang memanggil
    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    // ── 3. Verifikasi caller ───────────────────────────────────
    const { data: { user: callerUser }, error: authErr } = await caller.auth.getUser();
    if (authErr || !callerUser) {
      return reply({ ok: false, error: "Token tidak valid atau sudah kadaluarsa — login ulang" }, 401);
    }

    const { data: profile } = await admin
      .from("users").select("role").eq("id", callerUser.id).single();

    if (!profile || !["Administrator", "Pengurus"].includes(profile.role)) {
      return reply({ ok: false, error: `Role "${profile?.role}" tidak punya izin reset password` }, 403);
    }

    // ── 4. Parse body ──────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "reset";

    // ── MODE: reset — update password 1 user ──────────────────
    if (mode === "reset") {
      const { user_id, new_password } = body;
      if (!user_id)     return reply({ ok: false, error: "user_id wajib diisi" }, 400);
      if (!new_password)return reply({ ok: false, error: "new_password wajib diisi" }, 400);
      if (new_password.length < 6) return reply({ ok: false, error: "Password minimal 6 karakter" }, 400);

      // Cek dulu apakah user ada di auth.users
      const { data: existingAuth, error: getErr } = await admin.auth.admin.getUserById(user_id);

      if (getErr || !existingAuth?.user) {
        // User belum ada di auth.users — perlu dibuat dulu
        // Ambil data dari public.users
        const { data: pubUser, error: pubErr } = await admin
          .from("users").select("email, nickname").eq("id", user_id).single();

        if (pubErr || !pubUser) {
          return reply({ ok: false, error: `User ${user_id} tidak ditemukan di database` }, 404);
        }

        // Buat auth user baru dengan ID yang sama
        const { error: createErr } = await admin.auth.admin.createUser({
          email:         pubUser.email,
          password:      new_password,
          email_confirm: true,
          // Supabase v2 Admin API tidak support custom UUID saat createUser
          // Akan generate UUID baru — kita perlu update public.users
        });

        // Jika email sudah ada tapi id beda, coba updateUserByEmail
        if (createErr) {
          // Fallback: cari by email
          const { data: byEmail } = await admin.auth.admin.listUsers();
          const found = byEmail?.users?.find(u => u.email === pubUser.email);
          if (found) {
            const { error: upErr } = await admin.auth.admin.updateUserById(found.id, {
              password: new_password, email_confirm: true,
            });
            if (upErr) return reply({ ok: false, error: `Reset via email: ${upErr.message}` }, 500);

            // Sync id jika beda
            if (found.id !== user_id) {
              await admin.from("users").update({ id: found.id }).eq("id", user_id);
            }
            await admin.from("users").update({ must_change_password: true }).eq("id", found.id);
            return reply({ ok: true, note: "Reset via email (id sync)" });
          }
          return reply({ ok: false, error: `Gagal buat auth user: ${createErr.message}` }, 500);
        }

        await admin.from("users").update({ must_change_password: true }).eq("id", user_id);
        return reply({ ok: true, note: "Auth user dibuat baru" });
      }

      // User sudah ada — update password saja
      const { error: upErr } = await admin.auth.admin.updateUserById(user_id, {
        password:      new_password,
        email_confirm: true,
      });
      if (upErr) return reply({ ok: false, error: upErr.message }, 500);

      await admin.from("users")
        .update({ must_change_password: true, updated_at: new Date().toISOString() })
        .eq("id", user_id);

      return reply({ ok: true });
    }

    // ── MODE: provision_all ────────────────────────────────────
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
        const { data: existingAuth } = await admin.auth.admin.getUserById(m.id);

        if (!existingAuth?.user) {
          // Belum ada — buat baru
          const { data: created, error: createErr } = await admin.auth.admin.createUser({
            email: m.email, password: pw, email_confirm: true,
          });

          if (createErr) {
            // Mungkin email sudah ada dengan ID berbeda
            const { data: listData } = await admin.auth.admin.listUsers({ perPage: 1000 });
            const found = listData?.users?.find(u => u.email?.toLowerCase() === m.email?.toLowerCase());
            if (found) {
              await admin.auth.admin.updateUserById(found.id, { password: pw, email_confirm: true });
              if (found.id !== m.id) {
                await admin.from("users").update({ id: found.id }).eq("id", m.id);
              }
              await admin.from("users").update({ must_change_password: true }).eq("id", found.id);
              results.push({ nickname: m.nickname, nama: m.nama_panggilan, email: m.email, lingkungan: m.lingkungan??"", hp_ortu: m.hp_ortu??"", hp_anak: m.hp_anak??"", password: pw, ok: true, action: "synced" });
            } else {
              results.push({ nickname: m.nickname, nama: m.nama_panggilan, email: m.email, lingkungan: m.lingkungan??"", hp_ortu: m.hp_ortu??"", hp_anak: m.hp_anak??"", password: null, ok: false, error: createErr.message });
            }
            continue;
          }

          await admin.from("users").update({ must_change_password: true }).eq("id", created.user.id);
          results.push({ nickname: m.nickname, nama: m.nama_panggilan, email: m.email, lingkungan: m.lingkungan??"", hp_ortu: m.hp_ortu??"", hp_anak: m.hp_anak??"", password: pw, ok: true, action: "created" });
        } else {
          // Sudah ada — reset password
          const { error: upErr } = await admin.auth.admin.updateUserById(m.id, { password: pw, email_confirm: true });
          await admin.from("users").update({ must_change_password: true }).eq("id", m.id);
          results.push({ nickname: m.nickname, nama: m.nama_panggilan, email: m.email, lingkungan: m.lingkungan??"", hp_ortu: m.hp_ortu??"", hp_anak: m.hp_anak??"", password: pw, ok: !upErr, action: "reset", error: upErr?.message });
        }
      }

      const okCount = results.filter(r => r.ok).length;
      return reply({ ok: true, results, total: results.length, success: okCount });
    }

    return reply({ ok: false, error: `Mode tidak dikenal: "${mode}"` }, 400);

  } catch (err) {
    console.error("Edge function crash:", err);
    return reply({ ok: false, error: `Server error: ${err?.message || String(err)}` }, 500);
  }
});
