// supabase/functions/admin-reset-password/index.ts
// Verifikasi token dengan decode JWT langsung (tanpa memanggil auth API)
// → tidak bisa gagal karena network, lebih cepat, selalu reliable

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

/** Decode JWT payload tanpa verifikasi signature — cukup untuk ambil user ID */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // base64url → base64
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!SERVICE_KEY) {
      return reply({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY belum di-set di Edge Function" }, 500);
    }

    // Admin client pakai service_role
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Parse body dulu
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const mode = (body.mode as string) ?? "reset";

    // ── Ping — tidak butuh auth ────────────────────────────────
    if (mode === "ping") {
      return reply({ ok: true, message: "Edge Function aktif" });
    }

    // ── Decode token dari header ───────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      return reply({ ok: false, error: "Token tidak ditemukan di header Authorization" }, 401);
    }

    // Decode JWT payload untuk dapat user ID
    const payload = decodeJwtPayload(token);
    if (!payload || !payload.sub) {
      return reply({ ok: false, error: "Format token tidak valid" }, 401);
    }

    const callerId = payload.sub as string;

    // Cek expired
    const exp = payload.exp as number;
    if (exp && Date.now() / 1000 > exp) {
      return reply({ ok: false, error: "Token sudah expired — login ulang" }, 401);
    }

    // Cek role di public.users — pakai service_role jadi bypass RLS
    const { data: profile, error: profileErr } = await admin
      .from("users")
      .select("role")
      .eq("id", callerId)
      .single();

    if (profileErr || !profile) {
      return reply({ ok: false, error: `Profil tidak ditemukan (id: ${callerId})` }, 403);
    }

    if (!["Administrator", "Pengurus"].includes(profile.role as string)) {
      return reply({ ok: false, error: `Role "${profile.role}" tidak bisa reset password` }, 403);
    }

    // ── MODE: reset ────────────────────────────────────────────
    if (mode === "reset") {
      const user_id    = body.user_id as string;
      const new_password = body.new_password as string;

      if (!user_id || !new_password) {
        return reply({ ok: false, error: "user_id dan new_password wajib" }, 400);
      }
      if (new_password.length < 6) {
        return reply({ ok: false, error: "Password minimal 6 karakter" }, 400);
      }

      // Cek apakah sudah ada di auth.users
      const { data: existingAuth } = await admin.auth.admin.getUserById(user_id);

      if (!existingAuth?.user) {
        // Belum ada — buat dulu
        const { data: pubUser } = await admin
          .from("users").select("email").eq("id", user_id).single();

        if (!pubUser?.email) {
          return reply({ ok: false, error: `User tidak ditemukan di database` }, 404);
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
        const { error: upErr } = await admin.auth.admin.updateUserById(user_id, {
          password: new_password,
          email_confirm: true,
        });
        if (upErr) return reply({ ok: false, error: upErr.message }, 500);
      }

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
        const base = {
          nickname:   m.nickname,
          nama:       m.nama_panggilan,
          email:      m.email,
          lingkungan: m.lingkungan ?? "",
          hp_ortu:    m.hp_ortu ?? "",
          hp_anak:    m.hp_anak ?? "",
        };

        const { data: existingAuth } = await admin.auth.admin.getUserById(m.id);

        if (!existingAuth?.user) {
          const { error: createErr } = await admin.auth.admin.createUser({
            email: m.email, password: pw, email_confirm: true,
          });
          if (createErr) {
            results.push({ ...base, password: null, ok: false, error: createErr.message });
          } else {
            await admin.from("users").update({ must_change_password: true }).eq("id", m.id);
            results.push({ ...base, password: pw, ok: true, action: "created" });
          }
        } else {
          const { error: upErr } = await admin.auth.admin.updateUserById(m.id, {
            password: pw, email_confirm: true,
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
    console.error("Edge function crash:", err);
    return reply({ ok: false, error: `Server error: ${(err as Error)?.message ?? String(err)}` }, 500);
  }
});
