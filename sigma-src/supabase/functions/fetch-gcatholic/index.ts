// supabase/functions/fetch-gcatholic/index.ts
// Proxy fetch data liturgi dari gcatholic.org untuk menghindari CORS

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Mapping gcatholic color codes to our system
const COLOR_MAP: Record<string, string> = {
  'G': 'Hijau',   'green': 'Hijau',
  'R': 'Merah',   'red': 'Merah',
  'W': 'Putih',   'white': 'Putih',
  'V': 'Ungu',    'violet': 'Ungu', 'purple': 'Ungu',
  'P': 'MerahMuda', 'rose': 'MerahMuda', 'pink': 'MerahMuda',
  'B': 'Hitam',   'black': 'Hitam',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { year, month } = await req.json();
    const url = `https://gcatholic.org/calendar/${year}/ID-id`;

    console.log(`[fetch-gcatholic] Fetching: ${url}`);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (SIGMA App; contact: it@krsoba.id)' }
    });

    if (!res.ok) throw new Error(`gcatholic returned ${res.status}`);
    const html = await res.text();

    // Parse HTML table
    const doc  = new DOMParser().parseFromString(html, 'text/html');
    const rows = doc?.querySelectorAll('table tr') || [];

    const result: Array<{date: string, name: string, color: string, type: string}> = [];
    const targetMonth = String(month).padStart(2, '0');

    rows.forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) return;
      const dateText = cells[0]?.textContent?.trim() || '';
      const name     = cells[1]?.textContent?.trim() || '';

      // Try to parse date (format varies: "1 Mar" or "01/03")
      const dateMatch = dateText.match(/(\d{1,2})[\/\s-]?(\w+)?/);
      if (!dateMatch) return;

      const day    = dateMatch[1].padStart(2, '0');
      const fullDate = `${year}-${targetMonth}-${day}`;

      // Get color from class or text
      const className  = (row.getAttribute('class') || '').toLowerCase();
      let liturgyColor = 'Hijau';
      for (const [k, v] of Object.entries(COLOR_MAP)) {
        if (className.includes(k)) { liturgyColor = v; break; }
      }

      // Detect if feast day
      const isHariRaya = name.toLowerCase().includes('hari raya') || name.toLowerCase().includes('solemnity');

      if (name && day) {
        result.push({
          date:  fullDate,
          name:  name.replace(/\s+/g, ' ').trim(),
          color: liturgyColor,
          type:  isHariRaya ? 'HR' : 'HS',
        });
      }
    });

    // Filter to requested month only
    const monthData = result.filter(r => r.date.startsWith(`${year}-${targetMonth}`));

    console.log(`[fetch-gcatholic] Found ${monthData.length} entries for ${year}-${targetMonth}`);

    return new Response(JSON.stringify(monthData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('[fetch-gcatholic] Error:', err);
    // Return empty array as fallback — scheduler will use manual input
    return new Response(JSON.stringify([]), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
