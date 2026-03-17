// supabase/functions/supabase-ping/index.ts
// Prevent free tier pause by pinging every 3 days
// Setup: cron every 3 days at 08:00 WIB (01:00 UTC)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Simple lightweight query
  const { data } = await supabase.from('system_config').select('key').limit(1);
  console.log('[ping] Supabase is alive:', !!data);

  return new Response(JSON.stringify({ ok: true, ts: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
