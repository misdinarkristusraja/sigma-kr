// supabase/functions/admin-reset-password/index.ts
//
// !! PENTING SAAT DEPLOY !!
// Di Supabase Dashboard → Edge Functions → admin-reset-password → Settings
// → NONAKTIFKAN "Enforce JWT Verification" (atau centang "No JWT verification")
// Tanpa ini, Supabase blok semua request SEBELUM kode ini jalan → selalu 401
//
// Auth kita pakai SIGMA_SECRET di body — lebih simple dan reliable

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return reply({ ok: false, error: "Environment variables Supabase belum lengkap" }, 500);
    }

    // 1. Verifikasi JWT pemanggil (Caller)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return reply({ ok: false, error: "Missing Authorization header" }, 401);
    }

    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user) {
      return reply({ ok: false, error: "Invalid JWT Token" }, 401);
    }

    // 2. Cek Role Administrator
    const { data: profile } = await authClient
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "Administrator") {
      return reply({ ok: false, error: "Akses ditolak: Hanya Administrator" }, 403);
    }

    // 3. Setup Admin Client
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const mode = (body.mode as string) ?? "reset";

    if (mode === "ping") {
      return reply({ ok: true, status: "aktif", jwt_verified: true });
    }

    // ── MODE: reset ───────────────────────────────────────────
    if (mode === "reset") {
      const target_user_id = body.user_id as string;
      const new_password   = body.new_password as string;

      if (!target_user_id || !new_password) {
        return reply({ ok: false, error: "user_id dan new_password wajib disediakan" }, 400);
      }

      // Pastikan user ada di identity auth Supabase
      const { data: existingAuth } = await admin.auth.admin.getUserById(target_user_id);

      if (!existingAuth?.user) {
        // Jika belum masuk ke auth.users, create manual (misal user dari legacy)
        const { data: pubUser } = await admin
          .from("users").select("email").eq("id", target_user_id).single();
          
        if (!pubUser?.email) {
          return reply({ ok: false, error: "User tidak ditemukan di tabel public.users" }, 404);
        }
        const { error: ce } = await admin.auth.admin.createUser({
          email: pubUser.email, password: new_password, email_confirm: true,
        });
        if (ce) return reply({ ok: false, error: "Gagal Create User: " + ce.message }, 500);
      } else {
        // Jika sudah ada, tinggal update
        const { error: ue } = await admin.auth.admin.updateUserById(target_user_id, {
          password: new_password, email_confirm: true,
        });
        if (ue) return reply({ ok: false, error: "Gagal Update User: " + ue.message }, 500);
      }

      // Tandai mereka wajib ganti password
      await admin.from("users")
        .update({ must_change_password: true, updated_at: new Date().toISOString() })
        .eq("id", target_user_id);

      return reply({ ok: true });
    }

    // ── MODE: provision_all ───────────────────────────────────
    if (mode === "provision_all") {
      const { data: members, error: me } = await admin
        .from("users")
        .select("id, email, nickname, nama_panggilan, lingkungan, hp_ortu, hp_anak")
        .in("status", ["Active", "Pending"]);

      if (me) return reply({ ok: false, error: me.message }, 500);
      if (!members?.length) return reply({ ok: true, results: [], total: 0 });

      const results = [];
      for (const m of members) {
        const pw   = randPassword(10);
        const base = {
          nickname: m.nickname, nama: m.nama_panggilan, email: m.email,
          lingkungan: m.lingkungan ?? "", hp_ortu: m.hp_ortu ?? "", hp_anak: m.hp_anak ?? "",
        };
        const { data: ea } = await admin.auth.admin.getUserById(m.id);
        
        if (!ea?.user) {
          const { error: ce } = await admin.auth.admin.createUser({
            email: m.email, password: pw, email_confirm: true,
          });
          if (ce) results.push({ ...base, password: null, ok: false, error: ce.message });
          else {
            await admin.from("users").update({ must_change_password: true }).eq("id", m.id);
            results.push({ ...base, password: pw, ok: true, action: "created" });
          }
        } else {
          const { error: ue } = await admin.auth.admin.updateUserById(m.id, {
            password: pw, email_confirm: true,
          });
          await admin.from("users").update({ must_change_password: true }).eq("id", m.id);
          results.push({ ...base, password: pw, ok: !ue, action: "reset", error: ue?.message });
        }
      }

      return reply({ ok: true, results, total: results.length, success: results.filter(r => r.ok).length });
    }

    return reply({ ok: false, error: `Mode tidak dikenal: "${mode}"` }, 400);

  } catch (err) {
    console.error("Crash:", err);
    return reply({ ok: false, error: `Server error: ${(err as Error)?.message ?? String(err)}` }, 500);
  }
});
