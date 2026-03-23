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
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const SIGMA_SECRET = Deno.env.get("SIGMA_SECRET") ?? "";

    if (!SERVICE_KEY) {
      return reply({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY belum di-set di Edge Function secrets" }, 500);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const mode = (body.mode as string) ?? "reset";

    // Ping — tidak butuh secret, hanya cek EF aktif
    if (mode === "ping") {
      return reply({ ok: true, status: "aktif", jwt_disabled: true });
    }

    // Verifikasi secret
    const secret = (body.secret as string) ?? "";
    if (!SIGMA_SECRET) {
      return reply({ ok: false, error: "SIGMA_SECRET belum di-set di Edge Function secrets" }, 500);
    }
    if (secret !== SIGMA_SECRET) {
      return reply({ ok: false, error: "Secret key salah" }, 403);
    }

    // ── MODE: reset ───────────────────────────────────────────
    if (mode === "reset") {
      const user_id      = body.user_id as string;
      const new_password = body.new_password as string;

      if (!user_id || !new_password) {
        return reply({ ok: false, error: "user_id dan new_password wajib" }, 400);
      }

      const { data: existingAuth } = await admin.auth.admin.getUserById(user_id);

      if (!existingAuth?.user) {
        const { data: pubUser } = await admin
          .from("users").select("email").eq("id", user_id).single();
        if (!pubUser?.email) {
          return reply({ ok: false, error: "User tidak ditemukan di database" }, 404);
        }
        const { error: ce } = await admin.auth.admin.createUser({
          email: pubUser.email, password: new_password, email_confirm: true,
        });
        if (ce) return reply({ ok: false, error: ce.message }, 500);
      } else {
        const { error: ue } = await admin.auth.admin.updateUserById(user_id, {
          password: new_password, email_confirm: true,
        });
        if (ue) return reply({ ok: false, error: ue.message }, 500);
      }

      await admin.from("users")
        .update({ must_change_password: true, updated_at: new Date().toISOString() })
        .eq("id", user_id);

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
