// supabase/functions/cron-rekap/index.ts
// Dipanggil setiap hari jam 19:00 WIB via pg_cron atau Supabase Cron
// Setup di Supabase: Database → Extensions → pg_cron, lalu:
// SELECT cron.schedule('rekap-poin-harian', '0 12 * * *', 'SELECT net.http_post(...)');
// (12:00 UTC = 19:00 WIB)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  // Auth check — hanya boleh dari Supabase service role
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    console.log('[cron-rekap] Starting rekap update...');

    // 1. Update rekap poin mingguan & harian
    const { error } = await supabase.rpc('update_rekap_poin');
    if (error) throw error;

    // 2. Expire swap requests past deadline
    const { error: swapErr } = await supabase
      .from('swap_requests')
      .update({ status: 'Expired' })
      .eq('status', 'Pending')
      .lt('expires_at', new Date().toISOString());
    if (swapErr) console.error('[cron-rekap] swap expire error:', swapErr);

    // 3. Auto-update event status
    const today = new Date().toISOString().split('T')[0];
    await supabase.from('events')
      .update({ status_event: 'Sudah_Lewat' })
      .eq('status_event', 'Akan_Datang')
      .lt('tanggal_tugas', today);

    console.log('[cron-rekap] Done');
    return new Response(JSON.stringify({ ok: true, time: new Date().toISOString() }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('[cron-rekap] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
