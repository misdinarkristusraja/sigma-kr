import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getLiturgiMinggu as getStaticLiturgi, getLiturgiByMonth, HARI_RAYA_NO_HARIAN } from '../lib/liturgiData2026';
import { supabase } from '../lib/supabase';
import { formatDate, getLiturgyClass, tagDuplicateNames } from '../lib/utils';
import { toPng } from 'html-to-image';
import {
  Calendar, Download, Send, Edit2, Check, X,
  ChevronLeft, ChevronRight, Zap, AlertTriangle, Trash2,
  FileEdit, Globe, Lock, UserCheck, RefreshCw, CalendarPlus,
} from 'lucide-react';
import { exportToGCal, exportToICS } from '../lib/calendarExport';
import toast from 'react-hot-toast';

// ─── Konstanta ─────────────────────────────────────────────────────────────
const SLOT_INFO = {
  1: { time: 'Sabtu 17:30',  label: 'Sabtu Sore',    jam: '17.30' },
  2: { time: 'Minggu 06:00', label: 'Minggu Pagi I',  jam: '06.00' },
  3: { time: 'Minggu 08:00', label: 'Minggu Pagi II', jam: '08.00' },
  4: { time: 'Minggu 17:30', label: 'Minggu Sore',   jam: '17.30' },
};
const MONTHS         = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

// Parse draft_note untuk Misa_Khusus: "Slot 1: 07.00|2026-04-02 | Slot 2: 09.00|2026-04-03"
// Returns: [{ slot:1, jam:'07.00', tanggal:'2026-04-02' }, ...]
// Backward-compat: juga handle format lama "Slot 1: 07.00 | Slot 2: 09.00" tanpa tanggal
function parseSlotSchedule(draftNote, fallbackTanggal) {
  if (!draftNote) return [];
  const raw = draftNote.replace(/^Jam:\s*/i, '');
  return raw.split('|').map(part => {
    // Handle " | Slot N: jam|tanggal" splits
    const m = part.trim().match(/Slot\s+(\d+):\s*([\d.]+)(?:\|(\d{4}-\d{2}-\d{2}))?/i);
    if (!m) return null;
    return {
      slot:    Number(m[1]),
      jam:     m[2] || '07.00',
      tanggal: m[3] || fallbackTanggal || '',
    };
  }).filter(Boolean);
}
const MONTHS_UPPER   = MONTHS.map(m => m.toUpperCase());
const WARNA_OPTIONS  = ['Hijau','Merah','Putih','Ungu','MerahMuda','Hitam'];
const PETUGAS_PER_SLOT = 8; // petugas per slot/misa

// ─── Date helpers (hindari timezone shift dari toISOString) ────────────────
function toLocalISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekends(y, m) {
  const result = [];
  const d = new Date(y, m - 1, 1);
  while (d.getMonth() === m - 1) {
    if (d.getDay() === 0) { // Minggu
      // Sabtu = hari sebelumnya, gunakan local date agar tidak shift timezone
      const sat = new Date(y, m - 1, d.getDate() - 1);
      result.push({
        saturday: toLocalISO(sat),
        sunday:   toLocalISO(d),
      });
    }
    d.setDate(d.getDate() + 1);
  }
  return result;
}

// ─── Sumber Data Liturgi ──────────────────────────────────────────────────
// UTAMA: data statis dari Jadwal_2026.pdf (jadwal resmi paroki)
// FALLBACK: gcatholic.org (jika tahun bukan 2026)

async function fetchLiturgi(year, month) {
  // Gunakan data statis untuk 2026 (sumber: Jadwal_2026.pdf)
  if (year === 2026) {
    const data = getLiturgiByMonth(year, month);
    return data; // sudah dalam format {date, name, color, isMinggu, isHariRaya}
  }
  // Untuk tahun lain: coba gcatholic.org
  return await fetchGcatholic(year, month);
}

// Fallback: fetch gcatholic (untuk tahun selain 2026)
const gcatholicCache = {};
async function fetchGcatholic(year, month) {
  const key = `${year}-${month}`;
  if (gcatholicCache[key]?.length) return gcatholicCache[key];
  const targetUrl = `https://gcatholic.org/calendar/${year}/ID-id`;
  const proxies = [
    `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
  ];
  let html = '';
  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const json = await res.json().catch(() => null);
      html = json?.contents || json?.body || '';
      if (html.includes('feast1')) break;
    } catch { continue; }
  }
  const parsed = html ? parseLiturgiHTML(html, year) : [];
  gcatholicCache[key] = parsed;
  return parsed;
}

// Parser gcatholic HTML (untuk tahun non-2026)
const COLOR_MAP = { v:'Ungu', r:'Merah', w:'Putih', g:'Hijau', p:'MerahMuda', b:'Hitam' };
function parseLiturgiHTML(html, year) {
  const results = [];
  const trRegex = /<tr[^>]*\sid="(\d{4})"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRegex.exec(html)) !== null) {
    const month = parseInt(m[1].slice(0,2),10);
    const day   = parseInt(m[1].slice(2,4),10);
    if (!month||!day) continue;
    const row = m[2];
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    const dow = tds[1]?.[1]?.replace(/<[^>]+>/g,'').trim()||'';
    const colorSpan = row.match(/<span\s+class="feast([a-z])"\s*>/i);
    const color = colorSpan ? (COLOR_MAP[colorSpan[1]]||'Hijau') : 'Hijau';
    const nameSpan = row.match(/<span\s+class="feast\d[^"]*">([\s\S]*?)<\/span>/i);
    if (!nameSpan) continue;
    const name = nameSpan[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    if (name.length < 3) continue;
    results.push({
      date: `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,
      name, color,
      isMinggu: /minggu/i.test(dow),
      isSabtu:  /sabtu/i.test(dow),
      isHariRaya: /hari raya/i.test(name),
    });
  }
  return results;
}

// ─── Export PNG template (format tabel seperti contoh) ─────────────────────
function buildExportHTML(ev, assignments, pelatihOptions = []) {
  const isMisaKhusus = ev.tipe_event === 'Misa_Khusus';
  // Parse slot schedule dari draft_note (tanggal+jam per slot)
  const schedule = isMisaKhusus ? parseSlotSchedule(ev.draft_note, ev.tanggal_tugas) : [];
  const nSlots   = isMisaKhusus ? Math.max(ev.jumlah_misa || 1, schedule.length) : 4;

  const bySlot = {};
  for (let s = 1; s <= nSlots; s++) bySlot[s] = assignments.filter(a => a.slot_number === s);

  const perayaan = ev.perayaan || ev.nama_event || 'MISA MINGGUAN';

  function fmtTglIndo(dateStr) {
    if (!dateStr) return '';
    const [y, mo, d] = dateStr.split('-').map(Number);
    const HARI_UPPER = ['MINGGU','SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU'];
    const dt = new Date(y, mo - 1, d);
    return `${HARI_UPPER[dt.getDay()]} ${d} ${MONTHS_UPPER[mo - 1]} ${y}`;
  }

  // No 4: Subtitle menampilkan rentang tanggal semua misa
  let subtitleTgl;
  if (isMisaKhusus) {
    const firstTgl = schedule[0]?.tanggal || ev.tanggal_tugas;
    const lastTgl  = ev.tanggal_tugas;
    subtitleTgl = firstTgl === lastTgl
      ? fmtTglIndo(lastTgl)
      : `${fmtTglIndo(firstTgl)} — ${fmtTglIndo(lastTgl)}`;
  } else {
    subtitleTgl = ev.tanggal_latihan
      ? `${fmtTglIndo(ev.tanggal_latihan)} s/d ${fmtTglIndo(ev.tanggal_tugas)}`
      : fmtTglIndo(ev.tanggal_tugas);
  }

  let rows = '';
  for (let slot = 1; slot <= nSlots; slot++) {
    const info    = SLOT_INFO[slot] || SLOT_INFO[1];
    const people  = bySlot[slot] || [];
    const picA    = ev[`pic_slot_${slot}a`] || '—';
    const picB    = ev[`pic_slot_${slot}b`] || '—';
    const hpA     = ev[`pic_hp_slot_${slot}a`] || '';
    // No 2: Tanggal per slot dari schedule
    const sc      = schedule.find(s => s.slot === slot);
    const tglSlot = isMisaKhusus
      ? fmtTglIndo(sc?.tanggal || ev.tanggal_tugas)
      : (slot === 1 && ev.tanggal_latihan ? fmtTglIndo(ev.tanggal_latihan) : fmtTglIndo(ev.tanggal_tugas));
    const rowspan = Math.max(people.length, 1);

    const jamLabel = isMisaKhusus
      ? `MISA ${slot} (${sc?.jam || '07.00'})`
      : info.label.toUpperCase();
    const jamRow  = isMisaKhusus ? '' : `JAM (${sc?.jam || info.jam})<br>`;
    // No 6: HP PIC tampil di PNG
    const hp = hpA ? `HP PIC: ${hpA}` : '';

    const tanggalCell = `
      <td rowspan="${rowspan}" style="
        border:1px solid #333; padding:8px 10px; vertical-align:middle;
        text-align:center; font-size:11px; font-weight:bold; line-height:1.6;
        min-width:160px; background:#f9f9f9;">
        ${jamLabel}<br>
        ${tglSlot}<br>
        ${jamRow}
        PIC: ${picA.toUpperCase()}${picB !== '—' ? ' &amp; ' + picB.toUpperCase() : ''}<br>
        <span style="font-weight:normal;font-size:10px;color:#555;">${hp}</span>
      </td>`;

    if (people.length === 0) {
      rows += `<tr>${tanggalCell}
        <td style="border:1px solid #333;padding:6px 10px;font-size:11px;">—</td>
        <td style="border:1px solid #333;padding:6px 10px;font-size:11px;">—</td>
        <td style="border:1px solid #333;padding:6px 10px;font-size:11px;">—</td>
      </tr>`;
    } else {
      people.forEach((a, i) => {
        const u = a.users || {};
        rows += `<tr>
          ${i === 0 ? tanggalCell : ''}
          <td style="border:1px solid #333;padding:5px 10px;font-size:11px;">${u.nama_lengkap || '—'}</td>
          <td style="border:1px solid #333;padding:5px 10px;font-size:11px;">${u.nama_panggilan || '—'}</td>
          <td style="border:1px solid #333;padding:5px 10px;font-size:11px;">${u.lingkungan || '—'}</td>
        </tr>`;
      });
    }
  }

  // ── Pelatih Piket — tampil di bawah tabel ─────────────────
  const pelatihNicks = [ev.pelatih_slot_1, ev.pelatih_slot_2, ev.pelatih_slot_3].filter(Boolean);
  let pelatihSection = '';
  if (pelatihNicks.length > 0) {
    const pelatihCells = pelatihNicks.map((nick, i) => {
      const found = pelatihOptions.find(p => p.nickname === nick);
      const nama  = found?.nama_panggilan || nick;
      const hp    = found?.hp_anak || found?.hp_ortu || '';
      return `
        <td style="
          border:1px solid #bbb; padding:8px 14px; text-align:center;
          font-size:11px; background:#f0f7ff; width:${Math.floor(100/pelatihNicks.length)}%;">
          <div style="font-weight:bold; font-size:12px; color:#1a3a5c;">${nama.toUpperCase()}</div>
          <div style="color:#555; font-size:10px; margin-top:2px;">@${nick}${hp ? ' · ' + hp : ''}</div>
        </td>`;
    }).join('');

    // Pad empty cells jika pelatih < 3
    const emptyCount = 3 - pelatihNicks.length;
    const emptyCells = Array(emptyCount).fill('')
      .map(() => `<td style="border:1px solid #bbb;padding:8px;background:#f0f7ff;"></td>`)
      .join('');

    pelatihSection = `
      <table style="width:100%; border-collapse:collapse; border:2px solid #333; margin-top:10px;">
        <thead>
          <tr>
            <th colspan="3" style="
              border:2px solid #333; padding:8px 12px; text-align:center;
              font-size:12px; font-weight:bold; letter-spacing:0.5px;
              background:#1a3a5c; color:#fff;">
              PELATIH PIKET
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>${pelatihCells}${emptyCells}</tr>
        </tbody>
      </table>`;
  }

  return `
    <div style="font-family:'Arial',sans-serif; width:900px; padding:20px; background:white;">
      <table style="width:100%; border-collapse:collapse; border:2px solid #333;">
        <thead>
          <tr>
            <th colspan="4" style="
              border:2px solid #333; padding:10px 12px; text-align:center;
              font-size:16px; font-weight:bold; letter-spacing:1px;">
              ${perayaan.toUpperCase()}
              <div style="font-size:11px;font-weight:normal;color:#555;margin-top:3px;">${subtitleTgl}</div>
            </th>
          </tr>
          <tr>
            <th style="border:1px solid #333;padding:8px;font-size:12px;background:#eee;min-width:160px;">TANGGAL</th>
            <th style="border:1px solid #333;padding:8px;font-size:12px;background:#eee;">NAMA LENGKAP</th>
            <th style="border:1px solid #333;padding:8px;font-size:12px;background:#eee;">PANGGILAN</th>
            <th style="border:1px solid #333;padding:8px;font-size:12px;background:#eee;">LINGKUNGAN</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${pelatihSection}
    </div>`;
}

// ─── Main Component ────────────────────────────────────────────────────────
export default function ScheduleWeeklyPage() {
  const [events,     setEvents]     = useState([]);
  const [month,      setMonth]      = useState(new Date().getMonth() + 1);
  const [year,       setYear]       = useState(new Date().getFullYear());
  const [loading,    setLoading]    = useState(true);
  const [generating, setGenerating] = useState(false);
  const [editEvent,  setEditEvent]  = useState(null);
  const [waText,     setWaText]     = useState('');
  const [showWA,     setShowWA]     = useState(false);
  const [deleteConf, setDeleteConf] = useState(null);
  const [picOptions, setPicOptions] = useState([]);
  const exportRef    = useRef(null);
  const [activeTab,  setActiveTab]  = useState('jadwal'); // 'jadwal' | 'pic' | 'monitor'
  const [monitorData, setMonitorData]= useState([]);   // priority monitor data
  const [monitorLoad, setMonitorLoad]= useState(false);
  // Quick PIC state: { [eventId]: { slot: { a, b, hpA, hpB } } }
  const [picBatch,        setPicBatch]        = useState({});
  const [savingPIC,       setSavingPIC]       = useState(false);
  const [pelatihBatch,    setPelatihBatch]    = useState({});
  const [savingPelatih,   setSavingPelatih]   = useState(false);
  const [showAddMisa, setShowAddMisa] = useState(false);
  const INIT_MISA_FORM = {
    tipe:            'Misa_Khusus',  // 'Misa_Khusus' | 'Mingguan_HariRaya'
    tanggal_tugas:   '',             // tanggal misa terakhir (H-day)
    tanggal_latihan: '',             // untuk Mingguan_HariRaya: tanggal Sabtu latihan
    perayaan:        '',
    warna_liturgi:   'Putih',
    jumlah_misa:     1,
    // Jam dan tanggal per slot (Misa_Khusus)
    // slot_schedule[i] = { tanggal: 'YYYY-MM-DD', jam: 'HH.mm' }
    slot_schedule:   [{ tanggal: '', jam: '07.00' }],
    is_misa_besar:   false,
  };
  const [addMisaForm, setAddMisaForm] = useState({...INIT_MISA_FORM});

  // ── Load events ────────────────────────────────────────────
  const loadEvents = useCallback(async () => {
    setLoading(true);
    const padM    = String(month).padStart(2,'0');
    const start   = `${year}-${padM}-01`;
    // Hari terakhir bulan yang benar (hindari 2026-04-31 dll)
    const lastDay = new Date(year, month, 0).getDate(); // month=0-indexed+1 → hari terakhir
    const end     = `${year}-${padM}-${String(lastDay).padStart(2,'0')}`;
    const { data, error } = await supabase
      .from('events')
      .select(`
        id, nama_event, tipe_event, tanggal_tugas, tanggal_latihan,
        perayaan, warna_liturgi, jumlah_misa, status_event, is_draft,
        published_at, draft_note, is_misa_besar,
        pic_slot_1a, pic_hp_slot_1a, pic_slot_1b, pic_hp_slot_1b,
        pelatih_slot_1, pelatih_slot_2, pelatih_slot_3,
        pic_slot_2a, pic_hp_slot_2a, pic_slot_2b, pic_hp_slot_2b,
        pic_slot_3a, pic_hp_slot_3a, pic_slot_3b, pic_hp_slot_3b,
        pic_slot_4a, pic_hp_slot_4a, pic_slot_4b, pic_hp_slot_4b,
        assignments(id, slot_number, position, user_id,
          users(nama_panggilan, nama_lengkap, pendidikan, lingkungan))
      `)
      .gte('tanggal_tugas', start)
      .lte('tanggal_tugas', end)
      .not('tipe_event', 'eq', 'Misa_Harian')
      .order('tanggal_tugas');
    if (error) toast.error('Gagal load: ' + error.message);
    setEvents(data || []);
    setLoading(false);
  }, [month, year]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // ── Load PIC options ───────────────────────────────────────
  useEffect(() => {
    supabase.from('users')
      .select('id, nickname, nama_panggilan, role, hp_anak, hp_ortu')
      .in('role', ['Administrator','Pengurus','Pelatih'])
      .eq('status', 'Active')
      .order('nama_panggilan')
      .then(({ data }) => setPicOptions(data || []));
  }, []);

  // ── Generate jadwal ────────────────────────────────────────
  async function generateSchedule() {
    setGenerating(true);
    const tid = 'gen';
    try {
      toast.loading('Mengambil kalender liturgi gcatholic.org...', { id: tid });
      const liturgyData = await fetchLiturgi(year, month);

      if (year === 2026) {
        toast.loading(`✅ Data liturgi dari jadwal paroki (${liturgyData.length} entri). Menghitung...`, { id: tid });
      } else if (liturgyData.length === 0) {
        toast.loading('⚠️ Data liturgi tidak tersedia — nama diisi manual', { id: tid });
      } else {
        toast.loading(`✅ ${liturgyData.length} entri liturgi. Menghitung jadwal...`, { id: tid });
      }

      // Pool anggota aktif — HANYA Misdinar_Aktif dan Misdinar_Retired
      // Admin/Pengurus/Pelatih TIDAK dijadwalkan
      const { data: pool, error: pErr } = await supabase
        .from('users')
        .select('id, nickname, nama_panggilan, pendidikan, lingkungan')
        .eq('status', 'Active')
        .eq('is_suspended', false)
        .in('role', ['Misdinar_Aktif', 'Misdinar_Retired']);
      if (pErr) throw pErr;
      if (!pool?.length) throw new Error('Tidak ada anggota aktif');

      // Skor prioritas
      const sixtyAgo = new Date(Date.now() - 60*24*60*60*1000).toISOString();
      const { data: recent } = await supabase
        .from('assignments').select('user_id, created_at').gte('created_at', sixtyAgo);
      const lastMap = {};
      (recent || []).forEach(a => {
        if (!lastMap[a.user_id] || a.created_at > lastMap[a.user_id]) lastMap[a.user_id] = a.created_at;
      });
      const scored = pool.map(u => ({
        ...u,
        score: lastMap[u.id] ? (Date.now() - new Date(lastMap[u.id]).getTime()) / 86400000 : 9999,
      })).sort((a, b) => b.score - a.score);

      const weekends = getWeekends(year, month);
      let poolIdx = 0, created = 0;

      for (const wk of weekends) {
        // Ambil nama dari hari MINGGU di gcatholic
        // Gunakan data statis 2026 (prioritas), fallback ke liturgyData dari fetch
        const liturgiMinggu = (year === 2026)
          ? getStaticLiturgi(wk.sunday)
          : (liturgyData.find(l => l.date === wk.sunday && l.isMinggu) || null);
        const eventName     = liturgiMinggu?.name  || 'Misa Mingguan';
        const warnaLiturgi  = liturgiMinggu?.color || 'Hijau';

        // Skip jika sudah ada
        const { data: existing } = await supabase.from('events')
          .select('id').eq('tanggal_tugas', wk.sunday)
          .not('tipe_event','eq','Misa_Harian').maybeSingle();
        if (existing) continue;

        // Insert event (DRAFT)
        const { data: ev, error: evErr } = await supabase.from('events').insert({
          nama_event:        eventName.toUpperCase(),
          tipe_event:        'Mingguan',
          tanggal_tugas:     wk.sunday,    // Minggu (referensi utama)
          tanggal_latihan:   wk.saturday,  // Sabtu — latihan + Slot 1 Sore
          perayaan:          eventName,
          warna_liturgi:     warnaLiturgi,
          jumlah_misa:       4,
          status_event:      'Akan_Datang',
          is_draft:          true,
          gcatholic_fetched: liturgyData.length > 0,
        }).select().single();
        if (evErr) throw evErr;

        // Assign PETUGAS_PER_SLOT orang per slot (tidak boleh 1 orang di 2 slot)
        const used = new Set();
        const assigns = [];
        for (let slot = 1; slot <= 4; slot++) {
          let cnt = 0, att = 0;
          while (cnt < PETUGAS_PER_SLOT && att < scored.length * 4) {
            const u = scored[poolIdx % scored.length];
            poolIdx++; att++;
            if (used.has(u.id)) continue;
            used.add(u.id);
            assigns.push({ event_id: ev.id, user_id: u.id, slot_number: slot, position: cnt + 1 });
            cnt++;
          }
        }
        if (assigns.length) {
          const { error: aErr } = await supabase.from('assignments').insert(assigns);
          if (aErr) console.error('assign err:', aErr.message);
        }
        created++;
      }

      toast.success(
        created > 0
          ? `✅ ${created} jadwal DRAFT dibuat. Isi PIC tiap slot lalu Publish!`
          : 'Semua jadwal bulan ini sudah ada.',
        { id: tid, duration: 6000 }
      );
      loadEvents();
    } catch (err) {
      toast.error('Gagal: ' + err.message, { id: tid });
    } finally {
      setGenerating(false);
    }
  }

  // ── Tambah Misa Khusus / Hari Raya ────────────────────────
  async function addMisaKhusus() {
    const f = addMisaForm;
    if (!f.tanggal_tugas || !f.perayaan) {
      toast.error('Tanggal dan nama perayaan wajib diisi'); return;
    }

    const isMingguanHariRaya = f.tipe === 'Mingguan_HariRaya';

    let draftNote = null;
    let tanggalLatihan = isMingguanHariRaya ? f.tanggal_latihan : null;

    if (!isMingguanHariRaya) {
      // Encode slot_schedule ke draft_note: "Slot 1: HH.mm|YYYY-MM-DD | Slot 2: ..."
      // Jika slot tanggal kosong, gunakan tanggal_tugas sebagai fallback
      const schedule = (f.slot_schedule || [{ tanggal: f.tanggal_tugas, jam: '07.00' }]);
      const parts = schedule.map((s, i) => {
        const tgl = s.tanggal || f.tanggal_tugas;
        return `Slot ${i+1}: ${s.jam || '07.00'}|${tgl}`;
      });
      draftNote = `Jam: ${parts.join(' | ')}`;

      // tanggal_latihan = tanggal slot pertama (H-1 atau sama)
      // Ini dipakai untuk display subtitle dan slot date di card
      tanggalLatihan = schedule[0]?.tanggal || f.tanggal_tugas;
    }

    const { error } = await supabase.from('events').insert({
      nama_event:        f.perayaan.toUpperCase(),
      tipe_event:        isMingguanHariRaya ? 'Mingguan' : 'Misa_Khusus',
      tanggal_tugas:     f.tanggal_tugas,
      tanggal_latihan:   tanggalLatihan,
      perayaan:          f.perayaan,
      warna_liturgi:     f.warna_liturgi,
      jumlah_misa:       isMingguanHariRaya ? 4 : (f.slot_schedule?.length || 1),
      status_event:      'Akan_Datang',
      is_draft:          true,
      gcatholic_fetched: false,
      draft_note:        draftNote,
      is_misa_besar:     f.is_misa_besar || false,
    });

    if (error) { toast.error('Gagal tambah: ' + error.message); return; }

    toast.success(`"${f.perayaan}" berhasil ditambahkan sebagai DRAFT!`);
    setShowAddMisa(false);
    setAddMisaForm({...INIT_MISA_FORM});
    loadEvents();
  }

  // ── Simpan semua PIC sekaligus (dari tab PIC) ────────────
  async function savePICBatch() {
    const entries = Object.entries(picBatch);
    if (!entries.length) { toast('Tidak ada perubahan'); return; }
    setSavingPIC(true);
    let saved = 0;
    for (const [eventId, slots] of entries) {
      const update = {};
      for (let s = 1; s <= 4; s++) {
        const sl = slots[s];
        if (!sl) continue;
        if (sl.a  !== undefined) update[`pic_slot_${s}a`]    = sl.a  || null;
        if (sl.b  !== undefined) update[`pic_slot_${s}b`]    = sl.b  || null;
        if (sl.hpA!== undefined) update[`pic_hp_slot_${s}a`] = sl.hpA|| null;
        if (sl.hpB!== undefined) update[`pic_hp_slot_${s}b`] = sl.hpB|| null;
      }
      if (Object.keys(update).length) {
        await supabase.from('events').update(update).eq('id', eventId);
        saved++;
      }
    }
    setPicBatch({});
    setSavingPIC(false);
    toast.success(`PIC berhasil disimpan untuk ${saved} jadwal!`);
    loadEvents();
  }

  // ── Simpan pelatih piket ──────────────────────────────────
  async function savePelatihBatch() {
    setSavingPelatih(true);
    let saved = 0;
    for (const [eventId, data] of Object.entries(pelatihBatch)) {
      const { error } = await supabase.from('events').update({
        pelatih_slot_1: data.p1 || null,
        pelatih_slot_2: data.p2 || null,
        pelatih_slot_3: data.p3 || null,
      }).eq('id', eventId);
      if (!error) saved++;
    }
    await loadEvents();
    setPelatihBatch({});
    setSavingPelatih(false);
    toast.success(`Pelatih piket disimpan untuk ${saved} jadwal!`);
  }

  function setPelatihField(eventId, pos, nick) {
    setPelatihBatch(b => ({
      ...b,
      [eventId]: { ...(b[eventId] || {}), [`p${pos}`]: nick },
    }));
  }

  function getPelatihField(ev, pos) {
    const key = `p${pos}`;
    if (pelatihBatch[ev.id]?.[key] !== undefined) return pelatihBatch[ev.id][key];
    return ev[`pelatih_slot_${pos}`] || '';
  }

  function setPICField(eventId, slot, pos, nick) {
    const found = picOptions.find(p => p.nickname === nick);
    const hp    = found ? (found.hp_anak || found.hp_ortu || '') : '';
    setPicBatch(b => ({
      ...b,
      [eventId]: {
        ...(b[eventId] || {}),
        [slot]: {
          ...(b[eventId]?.[slot] || {}),
          [pos]: nick,
          [pos === 'a' ? 'hpA' : 'hpB']: hp,
        },
      },
    }));
  }

  // ── Publish / Unpublish ────────────────────────────────────
  async function publishEvent(ev) {
    // Cek PIC semua slot sudah diisi
    const missingPIC = [1,2,3,4].filter(s => !ev[`pic_slot_${s}a`] && !ev[`pic_slot_${s}b`]);
    if (missingPIC.length && !confirm(`Slot ${missingPIC.join(', ')} belum ada PIC. Publish tetap?`)) return;

    const { error } = await supabase.from('events').update({
      is_draft: false, published_at: new Date().toISOString(),
    }).eq('id', ev.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`"${ev.perayaan}" berhasil dipublish! 🎉`);
    loadEvents();
  }

  async function unpublishEvent(ev) {
    const { error } = await supabase.from('events').update({ is_draft: true, published_at: null }).eq('id', ev.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Dikembalikan ke draft');
    loadEvents();
  }

  // ── Hapus event ────────────────────────────────────────────
  async function deleteEvent(ev) {
    await supabase.from('assignments').delete().eq('event_id', ev.id);
    const { error } = await supabase.from('events').delete().eq('id', ev.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Jadwal dihapus');
    setDeleteConf(null);
    loadEvents();
  }

  // ── Simpan edit ────────────────────────────────────────────
  async function saveEditEvent() {
    const { error } = await supabase.from('events').update({
      perayaan:        editEvent.perayaan,
      nama_event:      (editEvent.perayaan || '').toUpperCase(),
      warna_liturgi:   editEvent.warna_liturgi,
      tanggal_latihan: editEvent.tanggal_latihan,
      draft_note:      editEvent.draft_note,
      pic_slot_1a: editEvent.pic_slot_1a||null, pic_hp_slot_1a: editEvent.pic_hp_slot_1a||null,
      pic_slot_1b: editEvent.pic_slot_1b||null, pic_hp_slot_1b: editEvent.pic_hp_slot_1b||null,
      pic_slot_2a: editEvent.pic_slot_2a||null, pic_hp_slot_2a: editEvent.pic_hp_slot_2a||null,
      pic_slot_2b: editEvent.pic_slot_2b||null, pic_hp_slot_2b: editEvent.pic_hp_slot_2b||null,
      pic_slot_3a: editEvent.pic_slot_3a||null, pic_hp_slot_3a: editEvent.pic_hp_slot_3a||null,
      pic_slot_3b: editEvent.pic_slot_3b||null, pic_hp_slot_3b: editEvent.pic_hp_slot_3b||null,
      pic_slot_4a: editEvent.pic_slot_4a||null, pic_hp_slot_4a: editEvent.pic_hp_slot_4a||null,
      pic_slot_4b: editEvent.pic_slot_4b||null, pic_hp_slot_4b: editEvent.pic_hp_slot_4b||null,
      is_misa_besar: editEvent.is_misa_besar || false,
    }).eq('id', editEvent.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Jadwal diperbarui!');
    setEditEvent(null);
    loadEvents();
  }

  // ── Export PNG (format tabel seperti contoh) ───────────────
  async function exportPNG(ev) {
    const asgn = ev.assignments || [];
    const html = buildExportHTML(ev, asgn, picOptions);

    // Render ke div tersembunyi lalu capture
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
    container.innerHTML = html;
    document.body.appendChild(container);

    try {
      const inner = container.firstElementChild;
      const png   = await toPng(inner, { pixelRatio: 2, backgroundColor: '#ffffff' });
      const a = document.createElement('a');
      a.href     = png;
      a.download = `jadwal-${ev.perayaan?.replace(/\s+/g,'-') || ev.id}.png`;
      a.click();
      toast.success('PNG berhasil diunduh!');
    } catch (err) {
      toast.error('Gagal export PNG: ' + err.message);
    } finally {
      document.body.removeChild(container);
    }
  }

  // ── WA template ────────────────────────────────────────────
  function generateWAText(ev) {
    const asgn   = ev.assignments || [];
    const bySlot = {};
    for (let s = 1; s <= 4; s++) bySlot[s] = asgn.filter(a => a.slot_number === s);

    const lines = ['PERAYAAN EKARISTI', ev.perayaan || ev.nama_event,
      `${formatDate(ev.tanggal_latihan,'dd')}–${formatDate(ev.tanggal_tugas,'dd MMMM yyyy')}`, ''];

    for (let slot = 1; slot <= 4; slot++) {
      const info = SLOT_INFO[slot];
      const picA = ev[`pic_slot_${slot}a`];
      const picB = ev[`pic_slot_${slot}b`];
      const hpA  = ev[`pic_hp_slot_${slot}a`];
      lines.push(info.time);
      if (picA || picB) lines.push(`PIC: ${[picA,picB].filter(Boolean).join(' & ')}${hpA ? ` (${hpA})` : ''}`);
      const names = bySlot[slot]?.map(a => a.users?.nama_panggilan) || [];
      if (!names.length) for (let i=1;i<=PETUGAS_PER_SLOT;i++) lines.push(`${i}. (kosong)`);
      else names.forEach((n,i) => lines.push(`${i+1}. ${n}`));
      lines.push('');
    }
    return lines.join('\n');
  }

  // ── PIC selector dalam edit modal ─────────────────────────
  function PicSelect({ slot, pos }) {
    const fNick = `pic_slot_${slot}${pos}`;
    const fHp   = `pic_hp_slot_${slot}${pos}`;
    const val   = editEvent?.[fNick] || '';

    function onChange(nick) {
      const found = picOptions.find(p => p.nickname === nick);
      const hp    = found ? (found.hp_anak || found.hp_ortu || '') : '';
      setEditEvent(v => ({ ...v, [fNick]: nick, [fHp]: hp }));
    }

    return (
      <div className="flex-1">
        <label className="text-[10px] text-gray-500 font-medium">PIC {pos === 'a' ? '1' : '2'}</label>
        <select className="input text-xs mt-0.5" value={val} onChange={e => onChange(e.target.value)}>
          <option value="">— Pilih PIC —</option>
          {picOptions.map(p => (
            <option key={p.id} value={p.nickname}>{p.nama_panggilan} (@{p.nickname})</option>
          ))}
        </select>
        {editEvent?.[fHp] && (
          <p className="text-[10px] text-gray-400 mt-0.5">📞 {editEvent[fHp]}</p>
        )}
      </div>
    );
  }

  // ── EditPetugasSection: searchable dropdown checklist per slot ───
  function EditPetugasSection({ ev, onSaved }) {
    const [members, setMembers] = React.useState([]);
    const [assigns, setAssigns] = React.useState({});
    const [search,  setSearch]  = React.useState({});   // {slot: queryString}
    const [open,    setOpen]    = React.useState({});   // {slot: bool}
    const [saving,  setSaving]  = React.useState(false);
    const [loaded,  setLoaded]  = React.useState(false);

    const nSlots = ev.tipe_event === 'Misa_Khusus' ? (ev.jumlah_misa || 1) : 4;

    React.useEffect(() => {
      if (!ev?.id || loaded) return;
      (async () => {
        const [{ data: mem }, { data: asgn }] = await Promise.all([
          supabase.from('users').select('id, nickname, nama_panggilan, lingkungan, pendidikan')
            .in('status', ['Active']).in('role', ['Misdinar_Aktif', 'Misdinar_Retired']).order('nama_panggilan'),
          supabase.from('assignments').select('id, slot_number, user_id').eq('event_id', ev.id),
        ]);
        setMembers(mem || []);
        const map = {};
        for (let s = 1; s <= nSlots; s++) {
          map[s] = (asgn || []).filter(a => a.slot_number === s).map(a => a.user_id);
        }
        setAssigns(map);
        setLoaded(true);
      })();
    }, [ev?.id]);

    function toggleMember(slot, userId) {
      setAssigns(prev => {
        const cur = prev[slot] || [];
        return {
          ...prev,
          [slot]: cur.includes(userId)
            ? cur.filter(id => id !== userId)
            : [...cur, userId],
        };
      });
    }

    async function savePetugas() {
      setSaving(true);
      await supabase.from('assignments').delete().eq('event_id', ev.id);
      const rows = [];
      for (let s = 1; s <= nSlots; s++) {
        (assigns[s] || []).forEach((uid, i) => {
          rows.push({ event_id: ev.id, user_id: uid, slot_number: s, position: i + 1 });
        });
      }
      if (rows.length) await supabase.from('assignments').insert(rows);
      toast.success('Petugas diperbarui!');
      setSaving(false);
      onSaved();
    }

    if (!loaded) return (
      <div className="text-xs text-gray-400 text-center py-2">Memuat data petugas…</div>
    );

    return (
      <div className="border-t border-gray-100 pt-4 mt-2">
        <h4 className="font-semibold text-gray-700 mb-3 text-sm flex items-center gap-2">
          <UserCheck size={15} className="text-green-600"/> Edit Petugas per Slot
        </h4>
        {Array.from({length: nSlots}, (_,i) => i+1).map(slot => {
          const info     = SLOT_INFO[slot] || SLOT_INFO[1];
          const selected = assigns[slot] || [];
          const q        = (search[slot] || '').toLowerCase();
          const filtered = members.filter(m =>
            m.nama_panggilan?.toLowerCase().includes(q) ||
            m.nickname?.toLowerCase().includes(q) ||
            m.lingkungan?.toLowerCase().includes(q)
          );
          const isOpen = !!open[slot];
          return (
            <div key={slot} className="mb-3">
              {/* Trigger button */}
              <button type="button"
                onClick={() => setOpen(p => ({...p, [slot]: !p[slot]}))}
                className="w-full flex items-center justify-between text-left px-3 py-2 rounded-xl border border-gray-200 hover:border-brand-800 transition-colors">
                <span className="text-xs font-bold text-gray-700">{info.time}</span>
                <span className="text-xs text-gray-500">{selected.length} dipilih ▾</span>
              </button>

              {/* Selected chips */}
              {selected.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5 px-1">
                  {selected.map(uid => {
                    const m = members.find(x => x.id === uid);
                    return m ? (
                      <button key={uid} type="button"
                        onClick={() => toggleMember(slot, uid)}
                        className="text-[10px] bg-green-100 text-green-800 px-2 py-0.5 rounded-full flex items-center gap-1 hover:bg-red-100 hover:text-red-700 transition-colors">
                        {m.nama_panggilan} ×
                      </button>
                    ) : null;
                  })}
                </div>
              )}

              {/* Dropdown */}
              {isOpen && (
                <div className="mt-1 border border-gray-200 rounded-xl overflow-hidden shadow-lg bg-white z-20 relative">
                  {/* Search */}
                  <div className="p-2 border-b border-gray-100">
                    <input autoFocus
                      type="text"
                      className="input text-sm py-1.5"
                      placeholder="Cari nama, lingkungan…"
                      value={search[slot] || ''}
                      onChange={e => setSearch(p => ({...p, [slot]: e.target.value}))}
                    />
                  </div>
                  {/* List */}
                  <div className="max-h-52 overflow-y-auto">
                    {filtered.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-3">Tidak ditemukan</p>
                    )}
                    {filtered.map(m => {
                      const isSel = selected.includes(m.id);
                      return (
                        <button key={m.id} type="button"
                          onClick={() => toggleMember(slot, m.id)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0
                            ${isSel ? 'bg-green-50' : ''}`}>
                          <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0
                            ${isSel ? 'bg-green-500 border-green-500' : 'border-gray-300'}`}>
                            {isSel && <Check size={10} className="text-white"/>}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-gray-800 truncate">{m.nama_panggilan}</p>
                            <p className="text-[10px] text-gray-400">{m.pendidikan} · {m.lingkungan}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="p-2 border-t border-gray-100">
                    <button type="button"
                      onClick={() => setOpen(p => ({...p, [slot]: false}))}
                      className="btn-outline btn-sm w-full text-xs">Tutup</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <button onClick={savePetugas} disabled={saving}
          className="btn-primary btn-sm w-full gap-2 mt-2">
          <Check size={14}/> {saving ? 'Menyimpan…' : 'Simpan Petugas'}
        </button>
      </div>
    );
  }

  // ── RENDER ─────────────────────────────────────────────────
  const draftCount = events.filter(e => e.is_draft).length;
  const pubCount   = events.filter(e => !e.is_draft).length;

  async function loadMonitorData() {
    setMonitorLoad(true);
    const now = new Date();
    const nowStr = now.toISOString().split('T')[0];

    // Pool aktif (sama seperti generate)
    const { data: pool } = await supabase.from('users')
      .select('id, nickname, nama_panggilan, pendidikan, lingkungan')
      .eq('status', 'Active').eq('is_suspended', false)
      .in('role', ['Misdinar_Aktif', 'Misdinar_Retired']);
    if (!pool?.length) { setMonitorLoad(false); return; }

    // Issue 5: Skor berdasarkan SCAN TUGAS terakhir, bukan jadwal/assignment
    // Ini mencerminkan kapan seseorang terakhir benar-benar hadir tugas
    const since180str = new Date(now - 180*24*3600*1000).toISOString().split('T')[0];

    // Ambil scan tugas 180 hari terakhir
    const { data: scanTugas } = await supabase.from('scan_records')
      .select('user_id, timestamp, event_id, events(tanggal_tugas)')
      .in('scan_type', ['tugas', 'walkin_tugas'])
      .gte('timestamp', since180str + 'T00:00:00')
      .order('timestamp', { ascending: false });

    // Ambil assignments 180 hari untuk hitung jumlah jadwal (info display saja)
    const since180 = new Date(now - 180*24*3600*1000).toISOString();
    const { data: recent } = await supabase.from('assignments')
      .select('user_id, created_at, slot_number, events(tanggal_tugas)')
      .gte('created_at', since180)
      .order('created_at', { ascending: false });

    // Per-user stats
    const countMap      = {};  // total assignments 180 hari (info)
    const lastScanDate  = {};  // timestamp scan tugas terakhir (untuk skor)
    const lastEventDate = {};  // tanggal_tugas event terakhir (untuk display)
    pool.forEach(u => {
      countMap[u.id]     = 0;
      lastScanDate[u.id] = null;
      lastEventDate[u.id] = null;
    });

    // Hitung scan tugas per user (ambil yang terbaru)
    (scanTugas || []).forEach(s => {
      if (lastScanDate[s.user_id] === undefined) return;
      if (!lastScanDate[s.user_id] || s.timestamp > lastScanDate[s.user_id]) {
        lastScanDate[s.user_id] = s.timestamp;
      }
      const evTgl = s.events?.tanggal_tugas;
      if (evTgl && (!lastEventDate[s.user_id] || evTgl > lastEventDate[s.user_id])) {
        lastEventDate[s.user_id] = evTgl;
      }
    });

    // Hitung jumlah assignments untuk display
    (recent||[]).forEach(a => {
      if (countMap[a.user_id] === undefined) return;
      countMap[a.user_id]++;
    });

    // lastCreated alias (dipakai rawScored di bawah)
    const lastCreated = lastScanDate;

    // ── Scoring logic: pakai rekap_poin_mingguan K1-K6 ─────────────────
    // Skor dasar = hari sejak assignment terakhir
    // Bonus dari kondisi baik (K1 +3, K2 +5, K3 +1, K4 +1)
    // Penalti dari kondisi buruk (K5 -2, K6 -10)
    // Sumber: rekap_poin_mingguan 30 hari terakhir

    const since30   = new Date(now - 30*24*3600*1000).toISOString().split('T')[0];
    const todayStr2 = now.toISOString().split('T')[0];

    // Ambil rekap K1-K6 per user dari rekap_poin_mingguan
    const { data: recentRekap } = await supabase
      .from('rekap_poin_mingguan')
      .select('user_id, kondisi, poin')
      .gte('week_start', since30)
      .lte('week_start', todayStr2);

    // Hitung bonus/penalti per kondisi
    const KONDISI_DELTA = { K1: +3, K2: +5, K3: +1, K4: +1, K5: -2, K6: -10 };
    const kondisiBonus = {};
    const kondisiCount = {};
    pool.forEach(u => { kondisiBonus[u.id] = 0; kondisiCount[u.id] = {}; });

    (recentRekap || []).forEach(r => {
      if (kondisiBonus[r.user_id] === undefined) return;
      const delta = KONDISI_DELTA[r.kondisi] || 0;
      kondisiBonus[r.user_id] += delta;
      kondisiCount[r.user_id][r.kondisi] = (kondisiCount[r.user_id][r.kondisi] || 0) + 1;
    });

    // Alias untuk display
    const k6Map = {}, k5Map = {};
    pool.forEach(u => {
      k6Map[u.id] = kondisiCount[u.id]?.K6 || 0;
      k5Map[u.id] = kondisiCount[u.id]?.K5 || 0;
    });

    // ── Skor prioritas: selalu minimal 1, dihitung dari 30 hari lalu ──────
    // Skor = hari sejak tugas terakhir + bonus/penalti dari K1-K6
    // K1 +3, K2 +5, K3 +1, K4 +1, K5 -2, K6 -10 | Minimal 1 selalu
    const rawScored = pool.map(u => {
      const lc        = lastCreated[u.id];
      const daysSince = lc
        ? Math.max(1, Math.floor((now - new Date(lc)) / 86400000))
        : 9999;
      const bonus = kondisiBonus[u.id] || 0;
      const score = daysSince >= 9999 ? 9999 : Math.max(1, daysSince + bonus);
      return {
        ...u,
        daysSince,
        score,
        count180:     countMap[u.id],
        k6Count:      k6Map[u.id] || 0,
        k5Count:      k5Map[u.id] || 0,
        kondisiCount: kondisiCount[u.id] || {},
        bonus,
        lastDate:     lastEventDate[u.id],
      };
    }).sort((a, b) => b.score - a.score);

    // Issue 6: Normalisasi berdasarkan distribusi score, bukan ratio ke max
    // Pakai min-max scaling: (score - min) / (max - min) * 100
    // Ini menghasilkan distribusi nyata — orang dengan score sama dapat % sama
    // Orang dengan scan terbaru dapat % rendah, yang lama dapat % tinggi
    const nonNewScores = rawScored.filter(u => u.score < 9999).map(u => u.score);
    const minScore = nonNewScores.length ? Math.min(...nonNewScores) : 1;
    const maxScore = nonNewScores.length ? Math.max(...nonNewScores) : 1;
    const scoreRange = maxScore - minScore;

    const withPct = rawScored.map((u, i) => {
      let pct;
      if (u.score >= 9999) {
        pct = 100; // belum pernah scan = tertinggi
      } else if (scoreRange === 0) {
        // Semua skor sama — distribusi berdasarkan rank (rank 1 = 100%, rank N = proportional)
        const n = nonNewScores.length;
        pct = n > 1 ? Math.round(100 - ((i / (n - 1)) * 60)) : 50;
      } else {
        // Min-max scaling: skor lebih tinggi = prioritas lebih tinggi
        pct = Math.round(((u.score - minScore) / scoreRange) * 95) + 5;
      }
      pct = Math.min(100, Math.max(1, pct));
      const tier = u.score >= 9999 ? 'new'
                 : u.score >= 30   ? 'high'
                 : u.score >= 7    ? 'medium'
                 : 'low';
      return { ...u, relativePct: pct, tier, rank: i + 1 };
    });

    // ── Kuota bulan ini ───────────────────────────────────────────────────
    const weekendsInMonth = getWeekends(year, month);
    const totalSlotsMonth = weekendsInMonth.length * 4 * PETUGAS_PER_SLOT;
    const poolSize        = pool.length;
    const idealPerPerson  = poolSize > 0 ? (totalSlotsMonth / poolSize).toFixed(1) : 0;

    // Hitung berapa slot sudah terisi bulan ini (dari draft/published)
    const monthStart  = `${year}-${String(month).padStart(2,'0')}-01`;
    const monthEnd    = `${year}-${String(month).padStart(2,'0')}-31`;
    const { data: thisMonthAssigns } = await supabase.from('assignments')
      .select('user_id, events(tanggal_tugas, is_draft)')
      .gte('events.tanggal_tugas', monthStart)
      .lte('events.tanggal_tugas', monthEnd);

    const assignedThisMonth = {};
    pool.forEach(u => { assignedThisMonth[u.id] = 0; });
    (thisMonthAssigns||[]).filter(a => a.events).forEach(a => {
      if (assignedThisMonth[a.user_id] !== undefined) assignedThisMonth[a.user_id]++;
    });
    const filledSlots = (thisMonthAssigns||[]).filter(a => a.events).length;

    // Tambahkan count bulan ini ke setiap member
    const final = withPct.map(u => ({
      ...u,
      countThisMonth: assignedThisMonth[u.id] || 0,
    }));

    setMonitorData({
      members: final,
      totalSlotsMonth,
      filledSlots,
      poolSize,
      idealPerPerson,
      weekendsInMonth: weekendsInMonth.length,
    });
    setMonitorLoad(false);
  }

  // Load monitor when tab switches
  useEffect(() => {
    if (activeTab === 'monitor') loadMonitorData();
  }, [activeTab, year, month]);

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Jadwal Misa Mingguan</h1>
          <p className="page-subtitle">{PETUGAS_PER_SLOT} petugas/slot · 4 slot · Draft → Publish</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <button onClick={() => { if(month===1){setMonth(12);setYear(y=>y-1);}else setMonth(m=>m-1); }} className="btn-ghost p-2"><ChevronLeft size={18}/></button>
          <span className="font-semibold text-gray-700 w-36 text-center">{MONTHS[month-1]} {year}</span>
          <button onClick={() => { if(month===12){setMonth(1);setYear(y=>y+1);}else setMonth(m=>m+1); }} className="btn-ghost p-2"><ChevronRight size={18}/></button>
          <button onClick={loadEvents} className="btn-ghost p-2"><RefreshCw size={16}/></button>
          <button onClick={generateSchedule} disabled={generating} className="btn-primary gap-2">
            <Zap size={16}/> {generating ? 'Generating...' : 'Generate Draft'}
          </button>
          <button onClick={() => setShowAddMisa(true)} className="btn-outline gap-2" title="Tambah Misa Khusus / Hari Raya">
            <span className="text-lg leading-none">+</span> Misa Khusus
          </button>
        </div>
      </div>

      {/* Status chips */}
      {events.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {draftCount > 0 && (
            <div className="badge-yellow flex items-center gap-1.5 px-3 py-1.5">
              <FileEdit size={13}/> {draftCount} draft — belum publik
            </div>
          )}
          {pubCount > 0 && (
            <div className="badge-green flex items-center gap-1.5 px-3 py-1.5">
              <Globe size={13}/> {pubCount} published
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {[
          { key: 'jadwal',   label: '📅 Jadwal' },
          { key: 'pic',      label: `🙋 PIC${Object.keys(picBatch).length > 0 ? ` (${Object.keys(picBatch).length})` : ''}` },
          { key: 'pelatih',  label: '👨‍🏫 Pelatih Piket' },
          { key: 'monitor',  label: '📊 Prioritas' },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab===t.key?'bg-white text-brand-800 shadow-sm':'text-gray-500'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB PIC ── */}
      {activeTab === 'pic' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center justify-between gap-3">
            <p className="text-sm text-blue-700">
              Isi PIC untuk semua slot sekaligus, lalu klik <strong>Simpan Semua PIC</strong>.
              Perubahan disimpan setelah klik tombol — belum tersimpan jika hanya dipilih.
            </p>
            <button onClick={savePICBatch} disabled={savingPIC || !Object.keys(picBatch).length}
              className="btn-primary gap-2 flex-shrink-0">
              <Check size={16}/> {savingPIC ? 'Menyimpan...' : 'Simpan Semua PIC'}
            </button>
          </div>

          {events.length === 0 ? (
            <div className="card text-center py-10 text-gray-400">Belum ada jadwal bulan ini</div>
          ) : (
            <div className="space-y-4">
              {events.map(ev => {
                const lc = getLiturgyClass(ev.warna_liturgi);
                return (
                  <div key={ev.id} className={`card border-l-4 ${ev.is_draft?'border-yellow-400':'border-green-400'}`}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-3 h-3 rounded-full ${lc.dot}`}/>
                      <div>
                        <p className="font-bold text-gray-900">{ev.perayaan || ev.nama_event}</p>
                        <p className="text-xs text-gray-500">
                          {formatDate(ev.tanggal_latihan,'dd MMM')} – {formatDate(ev.tanggal_tugas,'dd MMM yyyy')}
                          {ev.is_draft ? ' · Draft' : ' · Published'}
                        </p>
                      </div>
                    </div>
                    {(() => {
                      // Dinamis: Misa Khusus pakai jumlah_misa, Mingguan pakai 4
                      const isMK   = ev.tipe_event === 'Misa_Khusus';
                      const nSlots = isMK ? (ev.jumlah_misa || 1) : 4;
                      const slots  = Array.from({ length: nSlots }, (_, i) => i + 1);
                      // Parse jam/tanggal dari draft_note untuk label Misa Khusus
                      const slotSched = isMK ? parseSlotSchedule(ev.draft_note, ev.tanggal_tugas) : [];

                      return (
                        <div className={`grid gap-3 ${nSlots <= 2 ? 'grid-cols-2' : nSlots === 3 ? 'grid-cols-3' : 'grid-cols-2 xl:grid-cols-4'}`}>
                          {slots.map(slot => {
                            const curA = picBatch[ev.id]?.[slot]?.a ?? ev[`pic_slot_${slot}a`] ?? '';
                            const curB = picBatch[ev.id]?.[slot]?.b ?? ev[`pic_slot_${slot}b`] ?? '';

                            // Label slot: Misa Khusus → "Misa N · HH.mm (dd MMM)" / Mingguan → SLOT_INFO
                            let slotLabel;
                            if (isMK) {
                              const sc = slotSched.find(s => s.slot === slot);
                              const jam = sc?.jam || `Slot ${slot}`;
                              const tgl = sc?.tanggal
                                ? new Date(sc.tanggal + 'T00:00:00').toLocaleDateString('id-ID',{ day:'numeric', month:'short' })
                                : '';
                              slotLabel = `Misa ${slot} · ${jam}${tgl ? ` (${tgl})` : ''}`;
                            } else {
                              slotLabel = SLOT_INFO[slot]?.time || `Slot ${slot}`;
                            }

                            return (
                              <div key={slot} className="p-3 bg-gray-50 rounded-xl">
                                <p className="text-xs font-bold text-gray-700 mb-2">{slotLabel}</p>
                                <div className="space-y-2">
                                  <div>
                                    <label className="text-[10px] text-gray-400">PIC 1</label>
                                    <select className="input text-xs mt-0.5" value={curA}
                                      onChange={e => setPICField(ev.id, slot, 'a', e.target.value)}>
                                      <option value="">— Pilih —</option>
                                      {picOptions.map(p => (
                                        <option key={p.id} value={p.nickname}>{p.nama_panggilan}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-[10px] text-gray-400">PIC 2</label>
                                    <select className="input text-xs mt-0.5" value={curB}
                                      onChange={e => setPICField(ev.id, slot, 'b', e.target.value)}>
                                      <option value="">— Pilih —</option>
                                      {picOptions.map(p => (
                                        <option key={p.id} value={p.nickname}>{p.nama_panggilan}</option>
                                      ))}
                                    </select>
                                  </div>
                                  {(curA||curB) && (
                                    <p className="text-[10px] text-brand-700 font-medium truncate">
                                      ✓ {[curA,curB].filter(Boolean).join(' & ')}
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB JADWAL ── */}
      {activeTab === 'jadwal' && <>

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700 flex items-start gap-2">
        <FileEdit size={14} className="mt-0.5 flex-shrink-0"/>
        <span>
          Nama perayaan diambil dari <strong>hari Minggu</strong> gcatholic.org.
          Isi <strong>PIC</strong> tiap slot via Edit, lalu <strong>Publish</strong> agar tampil di jadwal publik.
          Export <strong>PNG</strong> menghasilkan format tabel lengkap dengan nama lengkap anggota.
        </span>
      </div>

      {/* Events list */}
      {loading ? (
        <div className="space-y-4">{[1,2,3].map(i=><div key={i} className="skeleton h-72 rounded-xl"/>)}</div>
      ) : events.length === 0 ? (
        <div className="card text-center py-14">
          <Calendar size={48} className="mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500 font-medium">Belum ada jadwal {MONTHS[month-1]} {year}</p>
          <button onClick={generateSchedule} disabled={generating} className="btn-primary mt-4 gap-2">
            <Zap size={16}/> Generate Sekarang
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Kelompokkan vigili dengan event utamanya */}
          {(() => {
            // Pisahkan vigili dan non-vigili
            const vigiliEvents = events.filter(e =>
              e.tipe_event === 'Misa_Khusus' &&
              (e.perayaan?.toLowerCase().startsWith('misa vigili') || e.draft_note?.toLowerCase().includes('vigili h-1'))
            );
            const mainEvents = events.filter(e =>
              !(e.tipe_event === 'Misa_Khusus' &&
                (e.perayaan?.toLowerCase().startsWith('misa vigili') || e.draft_note?.toLowerCase().includes('vigili h-1')))
            );

            return mainEvents.map(ev => {
              // Cari vigili yang tanggal_tugas-nya = tanggal_tugas ev - 1 hari
              const [ey, em, ed] = ev.tanggal_tugas?.split('-').map(Number) || [0,0,0];
              const dayBefore = ey ? `${ey}-${String(em).padStart(2,'0')}-${String(ed-1).padStart(2,'0')}` : null;
              // Cari juga dengan nama event
              const vigili = vigiliEvents.find(v =>
                v.tanggal_tugas === dayBefore ||
                v.perayaan?.toLowerCase().includes(ev.perayaan?.toLowerCase().replace(/misa vigili — ?/i,'').slice(0,10))
              ) || null;

              const lc   = getLiturgyClass(ev.warna_liturgi);
              const asgn = ev.assignments || [];
              const bySlot = {};
              for (let s=1;s<=4;s++) bySlot[s] = asgn.filter(a=>a.slot_number===s);
              const nameTag = tagDuplicateNames(
                asgn.map(a => a.users).filter(Boolean).map(u => ({ ...u, id: u.nickname || '' }))
              );

              return (
              <div key={ev.id} className={`card border-l-4 ${ev.is_draft?'border-yellow-400 bg-yellow-50/20':'border-green-400'}`}>
                {/* Vigili sub-section — tampil di atas slot utama */}
                {vigili && (() => {
                  const va   = vigili.assignments || [];
                  const vPicA = vigili.pic_slot_1a;
                  const vPicB = vigili.pic_slot_1b;
                  const vHpA  = vigili.pic_hp_slot_1a;
                  const vJam  = vigili.draft_note?.match(/Jam: ([\d.]+)/)?.[1] || vigili.vigili_jam || '17.30';
                  const vTgl  = formatDate(vigili.tanggal_tugas, 'EEEE, dd MMM yyyy');
                  return (
                    <div className="mb-4 pb-4 border-b-2 border-dashed border-purple-200 bg-purple-50/40 -mx-4 -mt-4 px-4 pt-4 rounded-t-xl">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="badge badge-purple text-xs">🕯️ Vigili H-1</span>
                          {vigili.is_draft
                            ? <span className="badge-yellow text-xs gap-1 flex items-center"><FileEdit size={10}/>Draft</span>
                            : <span className="badge-green text-xs gap-1 flex items-center"><Globe size={10}/>Published</span>
                          }
                        </div>
                        <div className="flex gap-1">
                          <button onClick={()=>setEditEvent({...vigili})} className="btn-outline btn-sm gap-1 text-xs py-1"><Edit2 size={11}/> Edit</button>
                          {vigili.is_draft
                            ? <button onClick={()=>publishEvent(vigili)} className="btn-primary btn-sm text-xs py-1"><Globe size={11}/> Publish</button>
                            : <button onClick={()=>unpublishEvent(vigili)} className="btn-outline btn-sm text-xs py-1"><Lock size={11}/> Draft</button>
                          }
                          <button onClick={()=>exportPNG(vigili)} className="btn-outline btn-sm text-xs py-1"><Download size={11}/></button>
                          <button onClick={()=>setDeleteConf(vigili)} className="btn-ghost p-1 text-red-400 hover:bg-red-50"><Trash2 size={13}/></button>
                        </div>
                      </div>
                      <p className="text-xs font-semibold text-purple-800 mb-0.5">
                        Misa Vigili — {vTgl} · Jam {vJam}
                      </p>
                      {(vPicA || vPicB) && (
                        <p className="text-[11px] text-purple-600 flex items-center gap-1 mb-2">
                          <UserCheck size={10}/>PIC: {[vPicA,vPicB].filter(Boolean).join(' & ')}
                          {vHpA && <span className="text-purple-400">· 📱 {vHpA}</span>}
                        </p>
                      )}
                      {va.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {va.map((a,i) => (
                            <span key={i} className="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded-full">
                              {a.users?.nama_panggilan}
                            </span>
                          ))}
                        </div>
                      )}
                      {va.length === 0 && <p className="text-xs text-purple-400 italic">Belum ada petugas vigili</p>}
                    </div>
                  );
                })()}

                {/* Header event */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <div className={`w-3 h-3 rounded-full ${lc.dot}`}/>
                      <span className={`text-xs font-semibold ${lc.text}`}>{ev.warna_liturgi}</span>
                      {ev.is_draft
                        ? <span className="badge-yellow text-xs gap-1 flex items-center"><FileEdit size={10}/>Draft</span>
                        : <span className="badge-green text-xs gap-1 flex items-center"><Globe size={10}/>Published</span>
                      }
                    </div>
                    <h3 className="font-bold text-gray-900 text-xl leading-tight">
                      {ev.perayaan || ev.nama_event}
                      {ev.is_misa_besar && <span className="ml-2 text-xs font-normal bg-brand-800 text-white px-2 py-0.5 rounded-full align-middle">🎓 Misa Besar</span>}
                    </h3>
                    {/* No 4: Subtitle dates */}
                    <p className="text-sm text-gray-500 mt-0.5">
                      {(() => {
                        if (ev.tipe_event === 'Misa_Khusus') {
                          const sc = parseSlotSchedule(ev.draft_note, ev.tanggal_tugas);
                          const firstTgl = sc[0]?.tanggal || ev.tanggal_tugas;
                          const lastTgl  = ev.tanggal_tugas;
                          const sameDay  = firstTgl === lastTgl;
                          return sameDay
                            ? <strong>{formatDate(lastTgl,'EEEE, dd MMM yyyy')}</strong>
                            : <><strong>{formatDate(firstTgl,'EEE, dd MMM')}</strong>{' — '}<strong>{formatDate(lastTgl,'EEE, dd MMM yyyy')}</strong></>;
                        }
                        // Mingguan: Sabtu tanggal — Minggu tanggal
                        return <>
                          {ev.tanggal_latihan
                            ? <><strong>{formatDate(ev.tanggal_latihan,'EEE, dd MMM')}</strong>{' — '}</>
                            : null}
                          <strong>{formatDate(ev.tanggal_tugas,'EEE, dd MMM yyyy')}</strong>
                        </>;
                      })()}
                    </p>
                    <p className="text-xs text-gray-400">{asgn.length} petugas · {ev.jumlah_misa || 4} slot</p>
                    {ev.draft_note && <p className="text-xs text-yellow-700 bg-yellow-100 rounded px-2 py-1 mt-1 inline-block">📝 {ev.draft_note}</p>}
                  </div>
                  <div className="flex gap-1 flex-wrap flex-shrink-0">
                    <button onClick={()=>setEditEvent({...ev})} className="btn-outline btn-sm gap-1"><Edit2 size={13}/> Edit</button>
                    {ev.is_draft
                      ? <button onClick={()=>publishEvent(ev)} className="btn-primary btn-sm gap-1"><Globe size={13}/> Publish</button>
                      : <button onClick={()=>unpublishEvent(ev)} className="btn-outline btn-sm gap-1"><Lock size={13}/> Draft</button>
                    }
                    <button onClick={()=>{setWaText(generateWAText(ev));setShowWA(true);}} className="btn-outline btn-sm gap-1"><Send size={13}/> WA</button>
                    <button onClick={()=>exportPNG(ev)} className="btn-outline btn-sm gap-1"><Download size={13}/> PNG</button>
                    <button onClick={()=>{
                      // Build events dari semua slot yang ada assignee-nya
                      const SLOT_TIMES = {1:{d:'saturday',t:'17:30'},2:{d:'sunday',t:'06:00'},3:{d:'sunday',t:'08:00'},4:{d:'sunday',t:'17:30'}};
                      const calEvents = [1,2,3,4].filter(s=>ev[`pic_slot_${s}a`]||ev.tanggal_tugas).map(s=>{
                        const isWeekend = s===1;
                        const baseDate = isWeekend ? ev.tanggal_sabtu || ev.tanggal_tugas : ev.tanggal_tugas;
                        return {
                          title:`[SIGMA] Tugas Misa Slot ${s}`,
                          description:`Jadwal tugas misa sebagai misdinar\nEvent: ${ev.perayaan||'Misa Mingguan'}`,
                          location:'Gereja Kristus Raja Solo Baru',
                          startDate:baseDate?`${baseDate}T${SLOT_TIMES[s].t}`:null,
                          category:'TUGAS MISA',
                        };
                      }).filter(e=>e.startDate);
                      if(calEvents.length) exportToICS(calEvents,`jadwal-${ev.tanggal_tugas}.ics`);
                      else toast.error('Tanggal event belum ada');
                    }} className="btn-outline btn-sm gap-1"><CalendarPlus size={13}/> .ics</button>
                    <button onClick={()=>setDeleteConf(ev)} className="btn-ghost p-2 text-red-500 hover:bg-red-50"><Trash2 size={15}/></button>
                  </div>
                </div>



                {/* Slot cards — No 2: tanggal per slot, No 5: pelatih bawah, No 6: HP PIC */}
                {(() => {
                  const isMisaKhusus = ev.tipe_event === 'Misa_Khusus';
                  const schedule = isMisaKhusus
                    ? parseSlotSchedule(ev.draft_note, ev.tanggal_tugas)
                    : [];
                  const nSlots = isMisaKhusus
                    ? Math.max(ev.jumlah_misa || 1, schedule.length || 1)
                    : 4;
                  const gridClass = nSlots === 1 ? 'grid-cols-1 max-w-sm' : nSlots === 2 ? 'grid-cols-2' : nSlots === 3 ? 'grid-cols-3' : 'grid-cols-2 xl:grid-cols-4';
                  return (
                    <div className={`grid ${gridClass} gap-3`}>
                      {Array.from({length: nSlots}, (_,i) => i+1).map(slot => {
                        const info    = SLOT_INFO[slot] || SLOT_INFO[1];
                        const picA    = ev[`pic_slot_${slot}a`];
                        const picB    = ev[`pic_slot_${slot}b`];
                        const hpA     = ev[`pic_hp_slot_${slot}a`];
                        const people  = bySlot[slot] || [];
                        // Jam & tanggal slot — dari schedule (Misa_Khusus) atau SLOT_INFO (Mingguan)
                        const sc      = schedule.find(s => s.slot === slot);
                        const jamLabel = isMisaKhusus
                          ? `Misa ${slot} · ${sc?.jam || '07.00'}`
                          : info.time;
                        const tglLabel = isMisaKhusus
                          ? (sc?.tanggal ? formatDate(sc.tanggal, 'EEE, dd MMM') : '')
                          : (slot === 1 && ev.tanggal_latihan
                              ? formatDate(ev.tanggal_latihan, 'EEE, dd MMM')
                              : formatDate(ev.tanggal_tugas, 'EEE, dd MMM'));
                        return (
                          <div key={slot} className={`p-3 rounded-xl border ${lc.bg} border-gray-100`}>
                            <div className="mb-2 pb-2 border-b border-gray-200/70">
                              <p className="text-xs font-bold text-gray-700">{jamLabel}</p>
                              <p className="text-[10px] text-gray-500">{tglLabel}</p>
                              {picA||picB ? (
                                <div className="mt-1">
                                  <p className="text-[11px] text-brand-700 flex items-center gap-1">
                                    <UserCheck size={11}/>PIC: {[picA,picB].filter(Boolean).join(' & ')}
                                  </p>
                                  {hpA && <p className="text-[10px] text-gray-400 ml-3.5">📱 {hpA}</p>}
                                </div>
                              ) : (
                                <p className="text-[11px] text-red-400 flex items-center gap-1 mt-0.5">
                                  <AlertTriangle size={10}/>PIC belum diisi
                                </p>
                              )}
                            </div>
                            <div className="space-y-0.5">
                              {people.length === 0
                                ? <p className="text-xs text-gray-400 italic">Belum ada petugas</p>
                                : people.map((a,i) => (
                                  <div key={i} className="flex items-center gap-1.5">
                                    <span className="text-[10px] text-gray-400 w-4 text-right shrink-0">{i+1}.</span>
                                    <div>
                                      <p className="text-xs font-medium text-gray-800 leading-none">{nameTag[a.users?.nickname] || a.users?.nama_panggilan}</p>
                                      <p className="text-[10px] text-gray-400">{a.users?.pendidikan} · {a.users?.lingkungan}</p>
                                    </div>
                                  </div>
                                ))
                              }
                              {people.length > 0 && people.length < PETUGAS_PER_SLOT && (
                                <p className="text-[10px] text-orange-400 mt-1">+{PETUGAS_PER_SLOT-people.length} kosong</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              {/* No 5: Pelatih di bawah slot cards */}
              {(() => {
                const pelatihNicks = [ev.pelatih_slot_1, ev.pelatih_slot_2, ev.pelatih_slot_3].filter(Boolean);
                if (!pelatihNicks.length) return null;
                return (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-[10px] font-semibold text-teal-600 uppercase tracking-wide mb-1.5">🧑‍🏫 Pelatih Piket</p>
                    <div className="flex flex-wrap gap-2">
                      {pelatihNicks.map(nick => {
                        const p = picOptions.find(u => u.nickname === nick);
                        const hp = p?.hp_anak || p?.hp_ortu || '';
                        return (
                          <div key={nick} className="text-xs bg-teal-50 text-teal-800 px-2.5 py-1 rounded-xl border border-teal-100">
                            <span className="font-semibold">{p?.nama_panggilan || nick}</span>
                            {hp && <span className="ml-1.5 text-teal-500 text-[10px]">📱 {hp}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
            );
            }); // end mainEvents.map
          })()} {/* end IIFE grouping */}
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editEvent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg">Edit Jadwal Draft</h3>
              <button onClick={()=>setEditEvent(null)}><X size={20}/></button>
            </div>
            <div className="space-y-4 mb-5">
              <div>
                <label className="label">Nama Perayaan (dari gcatholic.org)</label>
                <input className="input" value={editEvent.perayaan||''}
                  placeholder="Contoh: Hari Minggu Prapaskah III"
                  onChange={e=>setEditEvent(v=>({...v, perayaan:e.target.value, nama_event:e.target.value.toUpperCase()}))}/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Tanggal Latihan (Sabtu)</label>
                  <input type="date" className="input" value={editEvent.tanggal_latihan||''}
                    onChange={e=>setEditEvent(v=>({...v, tanggal_latihan:e.target.value}))}/>
                </div>
                <div>
                  <label className="label">Warna Liturgi</label>
                  <select className="input" value={editEvent.warna_liturgi||'Hijau'}
                    onChange={e=>setEditEvent(v=>({...v, warna_liturgi:e.target.value}))}>
                    {WARNA_OPTIONS.map(w=><option key={w}>{w}</option>)}
                  </select>
                </div>
              </div>

              {/* Misa Besar flag */}
              <div className={`p-3 rounded-xl border-2 cursor-pointer transition-all
                ${editEvent.is_misa_besar ? 'border-brand-800 bg-brand-50' : 'border-gray-200 bg-gray-50'}`}
                onClick={()=>setEditEvent(v=>({...v, is_misa_besar: !v.is_misa_besar}))}>
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={!!editEvent.is_misa_besar} readOnly
                    className="w-4 h-4 accent-brand-800"/>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">🎓 Misa Besar</p>
                    <p className="text-xs text-gray-500">Aktifkan kehadiran latihan wajib untuk event ini</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-5">
              <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2 text-sm">
                <UserCheck size={15} className="text-brand-800"/> PIC per Slot
                <span className="text-xs text-gray-400 font-normal">(wajib diisi sebelum Publish)</span>
              </h4>
              <div className="space-y-3">
                {[1,2,3,4].map(slot=>(
                  <div key={slot} className="p-3 bg-gray-50 rounded-xl">
                    <p className="text-xs font-bold text-gray-600 mb-2">{SLOT_INFO[slot].time}</p>
                    <div className="flex gap-3"><PicSelect slot={slot} pos="a"/><PicSelect slot={slot} pos="b"/></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-5">
              <label className="label">Catatan Draft</label>
              <textarea className="input h-16 resize-none" value={editEvent.draft_note||''}
                placeholder="Catatan sebelum publish..."
                onChange={e=>setEditEvent(v=>({...v, draft_note:e.target.value}))}/>
            </div>

            {/* Edit Petugas per Slot */}
            <EditPetugasSection ev={editEvent} onSaved={()=>{setEditEvent(null);loadEvents();}}/>

            <div className="flex gap-2 mt-4">
              <button onClick={saveEditEvent} className="btn-primary flex-1 gap-2"><Check size={16}/> Simpan</button>
              <button onClick={()=>setEditEvent(null)} className="btn-secondary">Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Modal ── */}
      {deleteConf && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <div className="flex items-center gap-3 mb-3"><AlertTriangle size={24} className="text-red-500"/><h3 className="font-bold text-lg">Hapus Jadwal?</h3></div>
            <p className="text-sm text-gray-600 mb-1"><strong>"{deleteConf.perayaan||deleteConf.nama_event}"</strong><br/>{formatDate(deleteConf.tanggal_tugas,'dd MMM yyyy')}</p>
            <p className="text-xs text-red-500 mb-4">⚠️ {deleteConf.assignments?.length||0} petugas ikut terhapus. Tidak bisa dibatalkan.</p>
            <div className="flex gap-2">
              <button onClick={()=>deleteEvent(deleteConf)} className="btn-danger flex-1">Hapus</button>
              <button onClick={()=>setDeleteConf(null)} className="btn-secondary">Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tambah Misa Khusus Modal ── */}
      {showAddMisa && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3 sm:p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
              <h3 className="font-bold text-lg">Tambah Misa Khusus / Hari Raya</h3>
              <button onClick={() => setShowAddMisa(false)}><X size={20}/></button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4">

            {/* Pilih tipe — 2 kondisi sederhana */}
            <div className="mb-5">
              <label className="label">Tipe Misa</label>
              <div className="grid grid-cols-2 gap-3 mt-1">
                <label className={`flex flex-col gap-1 p-3 rounded-xl border-2 cursor-pointer transition-all ${addMisaForm.tipe==='Misa_Khusus'?'border-brand-800 bg-brand-50':'border-gray-200'}`}>
                  <input type="radio" name="tipe" value="Misa_Khusus" className="sr-only"
                    checked={addMisaForm.tipe==='Misa_Khusus'}
                    onChange={()=>setAddMisaForm(f=>({...f,tipe:'Misa_Khusus',tanggal_latihan:''}))} />
                  <span className="font-semibold text-sm">Hari Raya Mandiri</span>
                  <span className="text-xs text-gray-400">Misa sendiri, tidak ada latihan. Contoh: HR. Natal 25 Des, HR. Maria 1 Jan</span>
                </label>
                <label className={`flex flex-col gap-1 p-3 rounded-xl border-2 cursor-pointer transition-all ${addMisaForm.tipe==='Mingguan_HariRaya'?'border-brand-800 bg-brand-50':'border-gray-200'}`}>
                  <input type="radio" name="tipe" value="Mingguan_HariRaya" className="sr-only"
                    checked={addMisaForm.tipe==='Mingguan_HariRaya'}
                    onChange={()=>setAddMisaForm(f=>({...f,tipe:'Mingguan_HariRaya',jumlah_misa:4}))} />
                  <span className="font-semibold text-sm">Hari Raya + Mingguan</span>
                  <span className="text-xs text-gray-400">Weekend ada misa biasa DAN hari raya. Ada latihan Sabtu + 4 slot Minggu</span>
                </label>
              </div>
            </div>

            <div className="space-y-3">
              {/* Nama perayaan */}
              <div>
                <label className="label">Nama Perayaan *</label>
                <input className="input" value={addMisaForm.perayaan}
                  placeholder="Contoh: HR. Kenaikan Tuhan"
                  onChange={e=>setAddMisaForm(f=>({...f,perayaan:e.target.value}))} />
              </div>

              {/* Tanggal */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">
                    {addMisaForm.tipe==='Mingguan_HariRaya' ? 'Tanggal Misa (Minggu) *' : 'Tanggal Hari Raya *'}
                  </label>
                  <input type="date" className="input" value={addMisaForm.tanggal_tugas}
                    onChange={e=>setAddMisaForm(f=>({...f,tanggal_tugas:e.target.value}))} />
                </div>
                {addMisaForm.tipe==='Mingguan_HariRaya' && (
                  <div>
                    <label className="label">Tanggal Latihan (Sabtu)</label>
                    <input type="date" className="input" value={addMisaForm.tanggal_latihan}
                      onChange={e=>setAddMisaForm(f=>({...f,tanggal_latihan:e.target.value}))} />
                  </div>
                )}
                {addMisaForm.tipe==='Misa_Khusus' && (
                  <div>
                    <label className="label">Jumlah Slot / Misa</label>
                    <select className="input" value={addMisaForm.slot_schedule?.length || 1}
                      onChange={e=>{
                        const n = Number(e.target.value);
                        const cur = addMisaForm.slot_schedule || [];
                        const next = Array.from({length:n}, (_,i) => cur[i] || { tanggal: addMisaForm.tanggal_tugas || '', jam: '07.00' });
                        setAddMisaForm(f=>({...f, jumlah_misa: n, slot_schedule: next}));
                      }}>
                      {[1,2,3,4].map(n=><option key={n} value={n}>{n} misa</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Jadwal per slot — Misa_Khusus: tanggal + jam per slot */}
              {addMisaForm.tipe==='Misa_Khusus' && (
                <div>
                  <label className="label">Jadwal per Misa</label>
                  <p className="text-xs text-gray-400 mb-2">
                    Isi tanggal & jam tiap misa. Misa 1 bisa H-1 (hari sebelumnya).
                  </p>
                  <div className="space-y-2">
                    {(addMisaForm.slot_schedule || []).map((sc, idx) => (
                      <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-xl p-2">
                        <span className="text-xs font-medium text-gray-600 w-14 shrink-0">Misa {idx+1}</span>
                        <input
                          type="date"
                          className="input text-sm flex-1"
                          value={sc.tanggal}
                          onChange={e => {
                            const next = [...addMisaForm.slot_schedule];
                            next[idx] = {...next[idx], tanggal: e.target.value};
                            // Auto-set tanggal_tugas = tanggal misa terakhir
                            const lastTgl = next[next.length-1].tanggal || e.target.value;
                            setAddMisaForm(f=>({...f, slot_schedule: next, tanggal_tugas: lastTgl}));
                          }}
                        />
                        <input
                          type="text"
                          className="input text-sm w-20"
                          value={sc.jam}
                          placeholder="07.00"
                          onChange={e => {
                            const next = [...addMisaForm.slot_schedule];
                            next[idx] = {...next[idx], jam: e.target.value};
                            setAddMisaForm(f=>({...f, slot_schedule: next}));
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">Format jam: 07.00, 17.30, dll.</p>
                </div>
              )}

              {/* Warna liturgi */}
              <div>
                <label className="label">Warna Liturgi</label>
                <select className="input" value={addMisaForm.warna_liturgi}
                  onChange={e=>setAddMisaForm(f=>({...f,warna_liturgi:e.target.value}))}>
                  {WARNA_OPTIONS.map(w=><option key={w}>{w}</option>)}
                </select>
              </div>

              {/* Misa Besar flag */}
              <div className={`p-3 rounded-xl border-2 cursor-pointer transition-all
                ${addMisaForm.is_misa_besar ? 'border-brand-800 bg-brand-50' : 'border-gray-200 bg-gray-50'}`}
                onClick={()=>setAddMisaForm(f=>({...f, is_misa_besar: !f.is_misa_besar}))}>
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={addMisaForm.is_misa_besar} readOnly
                    className="w-4 h-4 accent-brand-800"/>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">🎓 Misa Besar</p>
                    <p className="text-xs text-gray-500">
                      Aktifkan untuk misa yang wajib ada latihan khusus (Natal, Paskah, dll).
                      Sistem akan melacak kehadiran latihan tiap petugas.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Preview ringkasan */}
            {addMisaForm.perayaan && (
              <div className="mt-4 p-3 bg-gray-50 rounded-xl text-xs text-gray-600 space-y-1">
                <p className="font-semibold text-gray-800">Preview:</p>
                {(addMisaForm.slot_schedule||[]).map((sc,i) => (
                  sc.tanggal ? <p key={i}>⛪ Misa {i+1}: {sc.tanggal.split('-').reverse().join('/')} pukul {sc.jam} WIB</p> : null
                ))}
                {addMisaForm.tipe==='Mingguan_HariRaya' && addMisaForm.tanggal_tugas && (
                  <p>⛪ {addMisaForm.perayaan}: {addMisaForm.tanggal_tugas.split('-').reverse().join('/')} (4 slot)</p>
                )}
              </div>
            )}

            </div>{/* end scroll area */}
            <div className="flex gap-2 px-6 py-4 border-t border-gray-100 flex-shrink-0">
              <button onClick={addMisaKhusus} className="btn-primary flex-1 gap-2">
                <Check size={16}/> Tambahkan sebagai Draft
              </button>
              <button onClick={()=>setShowAddMisa(false)} className="btn-secondary">Batal</button>
            </div>
          </div>
        </div>
      )}

      </> /* end TAB JADWAL */}

      {/* ── WA Modal ── */}
      {showWA && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">Template WA</h3>
              <button onClick={()=>setShowWA(false)}><X size={20}/></button>
            </div>
            <textarea className="w-full h-80 font-mono text-xs p-3 border border-gray-200 rounded-xl bg-gray-50 resize-none" value={waText} readOnly/>
            <div className="flex gap-2 mt-4">
              <button onClick={()=>{navigator.clipboard.writeText(waText);toast.success('Disalin!');}} className="btn-primary flex-1">Salin</button>
              <button onClick={()=>setShowWA(false)} className="btn-secondary">Tutup</button>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB PRIORITAS & KUOTA ── */}
      {/* ── TAB PELATIH PIKET ── */}
      {activeTab === 'pelatih' && (
        <div className="space-y-4">
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-teal-700 font-semibold">👨‍🏫 Kelola Pelatih Piket per Event</p>
              <p className="text-xs text-teal-600 mt-0.5">Maksimal 3 pelatih per minggu. Akan tampil di kartu jadwal dan PNG export.</p>
            </div>
            <button onClick={savePelatihBatch} disabled={savingPelatih || Object.keys(pelatihBatch).length === 0}
              className="btn-primary btn-sm gap-1 whitespace-nowrap transition-all hover:scale-105 active:scale-95">
              {savingPelatih ? 'Menyimpan...' : `Simpan (${Object.keys(pelatihBatch).length})`}
            </button>
          </div>

          {events.length === 0 ? (
            <div className="card text-center py-10 text-gray-400">Belum ada jadwal bulan ini</div>
          ) : events.map(ev => (
            <div key={ev.id} className="card space-y-3">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${getLiturgyClass(ev.warna_liturgi).dot}`}/>
                <h3 className="font-bold text-gray-900">{ev.perayaan || ev.nama_event}</h3>
                <span className="text-xs text-gray-400">Sabtu {formatDate(ev.tanggal_latihan,'dd MMM')} — Minggu {formatDate(ev.tanggal_tugas,'dd MMM')}</span>
                {ev.is_draft && <span className="badge-yellow text-xs">Draft</span>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[1, 2, 3].map(pos => (
                  <div key={pos}>
                    <label className="label text-xs">Pelatih {pos}{pos === 1 ? ' *' : ' (opsional)'}</label>
                    <select
                      className={`input text-sm ${getPelatihField(ev, pos) ? 'border-teal-400 bg-teal-50' : ''}`}
                      value={getPelatihField(ev, pos)}
                      onChange={e => setPelatihField(ev.id, pos, e.target.value)}>
                      <option value="">— Pilih Pelatih —</option>
                      {picOptions.filter(u => u.role === 'Pelatih').map(u => (
                        <option key={u.id} value={u.nickname}>{u.nama_panggilan}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {/* Current pelatih display */}
              {(ev.pelatih_slot_1 || ev.pelatih_slot_2 || ev.pelatih_slot_3) && (
                <div className="flex gap-2 flex-wrap">
                  <span className="text-xs text-gray-500">Tersimpan:</span>
                  {[ev.pelatih_slot_1, ev.pelatih_slot_2, ev.pelatih_slot_3].filter(Boolean).map((p,i) => {
                    const pelatih = picOptions.find(u => u.nickname === p);
                    return (
                      <span key={i} className="text-xs bg-teal-100 text-teal-800 px-2 py-0.5 rounded-lg font-medium">
                        {pelatih?.nama_panggilan || p}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'monitor' && (
        <div className="space-y-5">
          {/* Penjelasan rumus */}
          <div className="card bg-blue-50 border border-blue-200 space-y-2">
            <h3 className="font-bold text-blue-900 text-sm flex items-center gap-2">
              📐 Cara Rumus Prioritas Bekerja
            </h3>
            <div className="text-xs text-blue-800 space-y-1 leading-relaxed">
              <p><strong>Skor Prioritas</strong> = Jumlah hari sejak terakhir dijadwalkan (90 hari terakhir)</p>
              <p>→ Semakin lama tidak mendapat jadwal = <strong>skor makin tinggi</strong> = dapat giliran lebih dulu</p>
              <p>→ Belum pernah dijadwalkan = skor <strong>999</strong> (prioritas tertinggi)</p>
              <p className="mt-1"><strong>Persentase Prioritas</strong> = Skor satu orang ÷ Total skor semua orang × 100%</p>
              <p>→ Ini bukan jaminan pasti dapat jadwal, tapi <em>peluang relatif</em> dibanding anggota lain</p>
            </div>
            <div className="bg-blue-100 rounded-lg p-2 text-xs text-blue-900">
              <strong>Contoh:</strong> Rafa tidak dapat jadwal 45 hari, Satrio 10 hari, Beni 999 (baru).
              Total = 45+10+999 = 1054. Peluang Beni = 999/1054 ≈ 94.8%, Rafa = 4.3%, Satrio = 0.9%.
            </div>
          </div>

          {/* Quota info */}
          {monitorData?.idealPerPerson && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: 'Anggota Aktif',      val: monitorData.poolSize,                             color: 'bg-brand-50' },
                { label: 'Weekend bulan ini',  val: monitorData.weekendsInMonth + '×',                color: 'bg-green-50' },
                { label: 'Total Slot',         val: monitorData.totalSlotsMonth,                      color: 'bg-blue-50' },
                { label: 'Slot Terisi',        val: (monitorData.filledSlots||0) + '/' + monitorData.totalSlotsMonth, color: monitorData.filledSlots >= monitorData.totalSlotsMonth ? 'bg-green-100' : 'bg-orange-50' },
                { label: 'Ideal per Orang',    val: monitorData.idealPerPerson + '×',                 color: 'bg-yellow-50' },
              ].map(c => (
                <div key={c.label} className={`card ${c.color} border-0 text-center`}>
                  <div className="text-2xl font-black text-gray-800">{c.val}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{c.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Kuota warning */}
          {monitorData?.idealPerPerson && (
            <div className={`p-3 rounded-xl text-sm flex items-start gap-2 ${
              monitorData.idealPerPerson < 1 ? 'bg-red-50 border border-red-200 text-red-800' :
              monitorData.idealPerPerson > 4 ? 'bg-orange-50 border border-orange-200 text-orange-800' :
              'bg-green-50 border border-green-200 text-green-800'
            }`}>
              <span className="text-lg">
                {monitorData.idealPerPerson < 1 ? '⚠️' : monitorData.idealPerPerson > 4 ? '🔥' : '✅'}
              </span>
              <div>
                <strong>Analisis Kuota:</strong>{' '}
                {monitorData.idealPerPerson < 1
                  ? `Pool anggota terlalu besar (${monitorData.poolSize} orang, slot hanya ${monitorData.totalSlotsMonth}). Sebagian besar tidak akan mendapat jadwal bulan ini.`
                  : monitorData.idealPerPerson > 4
                  ? `Pool anggota terlalu kecil (${monitorData.poolSize} orang, slot ${monitorData.totalSlotsMonth}). Setiap orang rata-rata ${monitorData.idealPerPerson}x per bulan — perlu rekrut lebih banyak misdinar.`
                  : `Distribusi ideal: ${monitorData.poolSize} anggota untuk ${monitorData.totalSlotsMonth} slot → rata-rata ${monitorData.idealPerPerson}× per orang per bulan.`
                }
              </div>
            </div>
          )}

          {/* Filled slots progress */}
          {monitorData?.filledSlots !== undefined && (
            <div className="card">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-700 text-sm">Progress Jadwal Bulan Ini</h3>
                <span className="text-xs text-gray-500">
                  {monitorData.filledSlots} / {monitorData.totalSlotsMonth} slot terisi
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                <div
                  className={`h-3 rounded-full transition-all ${
                    monitorData.filledSlots >= monitorData.totalSlotsMonth ? 'bg-green-500' :
                    monitorData.filledSlots > monitorData.totalSlotsMonth * 0.5 ? 'bg-brand-800' : 'bg-orange-400'
                  }`}
                  style={{ width: `${Math.min(100, Math.round(monitorData.filledSlots / Math.max(1, monitorData.totalSlotsMonth) * 100))}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {monitorData.filledSlots >= monitorData.totalSlotsMonth
                  ? '✅ Semua slot sudah terisi'
                  : `Sisa ${monitorData.totalSlotsMonth - monitorData.filledSlots} slot kosong (termasuk draft)`}
              </p>
            </div>
          )}

          {/* Priority table */}
          <div className="card overflow-hidden p-0">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-700">Daftar Prioritas Generate</h3>
              <div className="flex items-center gap-2">
                <div className="flex gap-2 text-[10px] font-medium">
                  <span className="text-red-500">🔴 Lama (&gt;30hr)</span>
                  <span className="text-orange-500">🟠 Sedang (14-30hr)</span>
                  <span className="text-green-600">🟢 Baru (&lt;14hr)</span>
                  <span className="text-blue-500">🆕 Belum pernah</span>
                </div>
                <button onClick={loadMonitorData} disabled={monitorLoad} className="btn-ghost p-1.5">
                  <RefreshCw size={14} className={monitorLoad ? 'animate-spin' : ''}/>
                </button>
              </div>
            </div>
            {monitorLoad ? (
              <div className="p-6 text-center text-gray-400">Menghitung prioritas...</div>
            ) : (
              <div className="overflow-x-auto max-h-[60vh]">
                <table className="tbl text-xs">
                  <thead>
                    <tr>
                      <th className="w-8">#</th>
                      <th>Anggota</th>
                      <th>Lingkungan</th>
                      <th>Jadwal Terakhir</th>
                      <th>Hari Sejak</th>
                      <th>K6 Penalti</th>
                      <th>K5</th>
                      <th>Skor Efektif</th>
                      <th>Bulan Ini</th>
                      <th>Prioritas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(monitorData?.members || []).map((u, i) => {
                      const tierColor = u.tier === 'new'    ? 'text-blue-500 bg-blue-50' :
                                        u.tier === 'high'   ? 'text-red-600 bg-red-50' :
                                        u.tier === 'medium' ? 'text-orange-500 bg-orange-50' :
                                                              'text-green-600 bg-green-50';
                      const tierIcon  = u.tier === 'new' ? '🆕' : u.tier === 'high' ? '🔴' : u.tier === 'medium' ? '🟠' : '🟢';
                      const barColor  = u.tier === 'new'    ? 'bg-blue-400'   :
                                        u.tier === 'high'   ? 'bg-red-500'    :
                                        u.tier === 'medium' ? 'bg-orange-400' : 'bg-green-400';
                      const nextSlot  = i < PETUGAS_PER_SLOT;   // next 8 = first slot
                      return (
                        <tr key={u.id} className={nextSlot ? 'bg-brand-50/50' : ''}>
                          <td className="font-mono text-gray-400">
                            {i + 1}
                            {nextSlot && <span className="ml-1 text-brand-600 font-bold">▶</span>}
                          </td>
                          <td>
                            <div className="font-semibold text-gray-900">{u.nama_panggilan}</div>
                            <div className="text-gray-400">@{u.nickname}</div>
                          </td>
                          <td className="text-gray-500">{u.lingkungan}</td>
                          <td>
                            {u.lastDate
                              ? <span className="text-gray-600">
                                  {new Date(u.lastDate).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' })}
                                  {u.lastDate >= new Date().toISOString().split('T')[0]
                                    ? <span className="ml-1 text-brand-600 text-[10px] font-medium">(draft/akan datang)</span>
                                    : null}
                                </span>
                              : <span className="text-blue-500 font-semibold">Belum pernah dijadwalkan</span>
                            }
                          </td>
                          <td>
                            <span className={`px-2 py-0.5 rounded-lg font-bold text-xs ${tierColor}`}>
                              {tierIcon} {u.daysSince >= 9999 ? '∞' : u.daysSince === 0 ? 'Hari ini' : `${u.daysSince} hari`}
                            </span>
                          </td>
                          <td className="text-center">
                            {u.k6Count > 0
                              ? <span className="text-red-600 font-bold bg-red-50 px-1.5 rounded text-xs">
                                  K6 ×{u.k6Count} (-{u.k6Count*5}hr)
                                </span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="text-center">
                            {u.k5Count > 0
                              ? <span className="text-teal-600 font-bold bg-teal-50 px-1.5 rounded text-xs">
                                  K5 ×{u.k5Count} (-{u.k5Count*2}hr)
                                </span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="text-center">
                            <span className="font-bold text-sm text-gray-700">
                              {u.score >= 9999 ? '∞' : `${u.score} hr`}
                            </span>
                            {u.penalty > 0 && (
                              <div className="text-[9px] text-red-400">(-{u.penalty} penalti)</div>
                            )}
                          </td>
                          <td className="text-center">
                            <span className={u.countThisMonth > 0 ? 'font-bold text-brand-800' : 'text-gray-400'}>
                              {u.countThisMonth > 0 ? `${u.countThisMonth}×` : '—'}
                            </span>
                          </td>
                          <td className="w-28">
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 bg-gray-100 rounded-full h-2.5 min-w-[36px] overflow-hidden">
                                <div
                                  className={`h-2.5 rounded-full transition-all duration-500 ${barColor}`}
                                  style={{ width: `${u.relativePct}%` }}
                                />
                              </div>
                              <span className={`text-xs font-black w-9 text-right ${
                                u.relativePct >= 80 ? 'text-red-600' :
                                u.relativePct >= 50 ? 'text-orange-500' :
                                u.relativePct >= 20 ? 'text-brand-700' : 'text-gray-400'
                              }`}>
                                {u.relativePct}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-400">
            ▶ Baris merah muda = {PETUGAS_PER_SLOT} orang pertama yang mendapat giliran saat generate jadwal berikutnya.
            Skor dihitung berdasarkan kapan assignment terakhir <em>dibuat</em> (termasuk draft) — bukan tanggal misa.
          </p>
        </div>
      )}
    </div>
);
}
