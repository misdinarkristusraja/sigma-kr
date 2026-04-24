// supabase/functions/admin-reset-password/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
// BEST PRACTICE: Pin versi supabase-js agar tidak crash/timeout saat cold start di Edge
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

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

// Helper untuk chunk array (mencegah timeout saat reset ratusan user)
const chunkArray = <T>(arr: T[], size: number): T[][] => {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );
};

serve(async (req: Request) => {
  // 1. TANGANI CORS PREFLIGHT PALING AWAL
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return reply({ ok: false, error: "ENV_ERROR", message: "Konfigurasi server bermasalah." }, 500);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const mode = (body.mode as string) ?? "reset";

    if (mode === "ping") {
      return reply({ ok: true, status: "aktif", timestamp: new Date().toISOString() });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) return reply({ ok: false, error: "MISSING_TOKEN", message: "Belum login" }, 401);

    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) return reply({ ok: false, error: "INVALID_TOKEN", message: "Token expired" }, 401);

    const { data: profile, error: profileErr } = await admin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileErr || profile?.role !== "Administrator") {
      return reply({ ok: false, error: "NOT_ADMIN", message: "Akses ditolak." }, 403);
    }

    // MODE: provision_all (Batching System)
    if (mode === "provision_all") {
      const { data: members, error: me } = await admin
        .from("users")
        .select("id, email, nickname, nama_panggilan, lingkungan, hp_ortu, hp_anak")
        .in("status", ["Active", "Pending"])
        .neq("role", "Administrator");

      if (me) return reply({ ok: false, error: "FETCH_FAILED", message: me.message }, 500);
      if (!members?.length) return reply({ ok: true, results: [], total: 0, success: 0 });

      const results: any[] = [];
      const chunks = chunkArray(members, 10);

      for (const chunk of chunks) {
        const chunkPromises = chunk.map(async (m) => {
          const base = {
            nickname: m.nickname, nama: m.nama_panggilan,
            lingkungan: m.lingkungan ?? "", hp_ortu: m.hp_ortu ?? "", hp_anak: m.hp_anak ?? "",
          };

          if (!m.email) return { ...base, ok: false, error: "Email kosong" };

          const pw = randPassword(10);
          const { data: ea } = await admin.auth.admin.getUserById(m.id);

          if (!ea?.user) return { ...base, ok: false, error: "Data Auth hilang" };

          const { error: ue } = await admin.auth.admin.updateUserById(m.id, {
            password: pw, email_confirm: true, ban_duration: "none",
          });

          if (ue) return { ...base, ok: false, error: ue.message };

          await admin.from("users").update({ must_change_password: true }).eq("id", m.id);
          return { ...base, password: pw, ok: true };
        });

        const chunkResults = await Promise.all(chunkPromises);
        results.push(...chunkResults);
      }

      return reply({
        ok: true,
        results,
        total: results.length,
        success: results.filter((r) => r.ok).length,
      });
    }

    return reply({ ok: false, error: "UNKNOWN_MODE" }, 400);

  } catch (err) {
    // Tangkap SEMUA error agar function tetap merespons dengan header CORS
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Function Error:", msg);
    return reply({ ok: false, error: "SERVER_CRASH", message: msg }, 500);
  }
});