// supabase/functions/admin-reset-password/index.ts
// Reset password via Supabase Admin API (auth.admin.updateUserById)
// INI satu-satunya cara yang benar — pgcrypto SQL tidak kompatibel
// dengan bcrypt implementation milik GoTrue (engine auth Supabase)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Verifikasi caller adalah admin/pengurus yang sudah login
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Buat admin client dengan service_role key
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // 3. Verifikasi token caller & cek role-nya
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user: caller }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !caller) {
      return new Response(
        JSON.stringify({ ok: false, error: "Token tidak valid" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cek apakah caller adalah Administrator atau Pengurus
    const { data: callerProfile } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", caller.id)
      .single();

    if (!["Administrator", "Pengurus"].includes(callerProfile?.role)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Hanya Administrator/Pengurus yang bisa reset password" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Ambil payload
    const { user_id, new_password } = await req.json();

    if (!user_id || !new_password) {
      return new Response(
        JSON.stringify({ ok: false, error: "user_id dan new_password wajib diisi" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (new_password.length < 6) {
      return new Response(
        JSON.stringify({ ok: false, error: "Password minimal 6 karakter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Reset password via Admin API — ini cara resmi Supabase
    //    GoTrue akan hash password dengan bcrypt yang benar
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
      user_id,
      {
        password: new_password,
        email_confirm: true,   // pastikan email sudah confirmed
      }
    );

    if (updateErr) {
      console.error("updateUserById error:", updateErr);
      return new Response(
        JSON.stringify({ ok: false, error: updateErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Tandai must_change_password = true di public.users
    await supabaseAdmin
      .from("users")
      .update({ must_change_password: true, updated_at: new Date().toISOString() })
      .eq("id", user_id);

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
