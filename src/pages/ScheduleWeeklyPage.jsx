import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { formatDate, getLiturgyClass, downloadCSV } from '../lib/utils';
import { toPng } from 'html-to-image';
import {
  Calendar, Download, Send, Edit2, Check, X,
  ChevronLeft, ChevronRight, Zap, AlertTriangle, Trash2,
  FileEdit, Globe, Lock, UserCheck, RefreshCw, Users,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ─────────────────────────────────────────────────────────────────────────────
// KONSTANTA
// ─────────────────────────────────────────────────────────────────────────────
const SLOT_LABELS = {
  1: { time: 'Sabtu 17:30',   day: 'Sabtu',  label: 'Slot 1 — Sabtu Sore' },
  2: { time: 'Minggu 06:00',  day: 'Minggu', label: 'Slot 2 — Minggu Pagi I' },
  3: { time: 'Minggu 08:00',  day: 'Minggu', label: 'Slot 3 — Minggu Pagi II' },
  4: { time: 'Minggu 17:30',  day: 'Minggu', label: 'Slot 4 — Minggu Sore' },
};
const MONTHS       = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const WARNA_OPTIONS= ['Hijau','Merah','Putih','Ungu','MerahMuda','Hitam'];

// Jumlah petugas per slot (per misa)
const PETUGAS_PER_SLOT = 8;

// ─────────────────────────────────────────────────────────────────────────────
// FETCH & PARSE GCATHOLIC.ORG
// ─────────────────────────────────────────────────────────────────────────────

// Cache di memory (tidak perlu refetch jika sudah ada)
const liturgiCache = {};

async function fetchLiturgi(year, month) {
  const cacheKey = `${year}-${month}`;
  if (liturgiCache[cacheKey]) return liturgiCache[cacheKey];

  const targetUrl = `https://gcatholic.org/calendar/${year}/ID-id`;
  const proxies   = [
    `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
    `https://cors-anywhere.herokuapp.com/${targetUrl}`,
  ];

  let html = '';
  for (const proxy of proxies) {
    try {
      const res  = await fetch(proxy, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const json = await res.json().catch(() => null);
      html = json?.contents || json?.body || '';
      if (html.length > 500) break;
    } catch { continue; }
  }

  // Fallback: Supabase Edge Function
  if (!html || html.length < 500) {
    try {
      const { data } = await supabase.functions.invoke('fetch-gcatholic', { body: { year, month } });
      if (Array.isArray(data) && data.length > 0) {
        liturgiCache[cacheKey] = data;
        return data;
      }
    } catch {}
  }

  const parsed = html.length > 500 ? parseLiturgiHTML(html, year) : [];
  if (parsed.length > 0) liturgiCache[cacheKey] = parsed;
  return parsed;
}

/**
 * Parse HTML gcatholic.org
 * Format yang diketahui:
 *   <tr>
 *     <td class="td-day">8</td>
 *     <td class="td-dow">Minggu</td>
 *     <td>...</td>
 *     <td><span class="s2">●</span> Hari Minggu Prapaskah III</td>
 *   </tr>
 *
 * Warna dot (span class):
 *   s1 = Merah, s2 = Ungu/violet, s3 = Putih, s4 = Hijau,
 *   s5 = MerahMuda/rose, s6 = Hitam, s0 = Hijau (default)
 */
function parseLiturgiHTML(html, year) {
  const results = [];

  // Normalisasi HTML
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n/g, '\n');

  // Cari semua baris tabel
  const trRegex = /<tr[\s\S]*?<\/tr>/gi;
  let currentMonth = 0;
  let trMatch;

  // Deteksi bulan dari heading tabel (gcatholic format per bulan)
  const monthHeaderRegex = /<th[^>]*>\s*(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s*<\/th>/gi;
  const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

  // Build map: posisi heading → nomor bulan
  const monthPositions = [];
  let mh;
  while ((mh = monthHeaderRegex.exec(clean)) !== null) {
    const idx = monthNames.findIndex(n => n.toLowerCase() === mh[1].toLowerCase());
    if (idx >= 0) monthPositions.push({ pos: mh.index, month: idx + 1 });
  }

  while ((trMatch = trRegex.exec(clean)) !== null) {
    const rowHtml = trMatch[0];
    const rowPos  = trMatch.index;

    // Tentukan bulan dari posisi row
    let rowMonth = 0;
    for (const mp of monthPositions) {
      if (mp.pos <= rowPos) rowMonth = mp.month;
    }
    if (rowMonth === 0) continue;

    // Ambil semua <td>
    const tdMatches = [...rowHtml.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)];
    if (tdMatches.length < 2) continue;

    // Kolom pertama: nomor hari
    const dayText = tdMatches[0][2].replace(/<[^>]+>/g, '').trim();
    const dayNum  = parseInt(dayText, 10);
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) continue;

    // Kolom kedua: nama hari
    const dowText = tdMatches[1]?.[2].replace(/<[^>]+>/g, '').trim() || '';
    const isMingggu = /minggu|sunday|sun/i.test(dowText);
    const isSabtu   = /sabtu|saturday|sat/i.test(dowText);

    // Kolom terakhir: nama liturgi
    const lastTd = tdMatches[tdMatches.length - 1][2];

    // Deteksi warna dari span class
    let color = 'Hijau';
    const spanMatch = lastTd.match(/<span[^>]*class="([^"]*)"[^>]*>/i);
    if (spanMatch) {
      const cls = spanMatch[1];
      if (/\bs1\b/.test(cls)) color = 'Merah';
      else if (/\bs2\b/.test(cls)) color = 'Ungu';
      else if (/\bs3\b/.test(cls)) color = 'Putih';
      else if (/\bs4\b/.test(cls)) color = 'Hijau';
      else if (/\bs5\b/.test(cls)) color = 'MerahMuda';
      else if (/\bs6\b/.test(cls)) color = 'Hitam';
      // Fallback: detect by color keyword
      else if (/red|merah/i.test(cls))   color = 'Merah';
      else if (/purple|violet|ungu/i.test(cls)) color = 'Ungu';
      else if (/white|putih/i.test(cls)) color = 'Putih';
      else if (/pink|rose/i.test(cls))   color = 'MerahMuda';
      else if (/black|hitam/i.test(cls)) color = 'Hitam';
    }

    // Bersihkan nama liturgi: hapus HTML tags, strip dot bullet, trim
    let name = lastTd
      .replace(/<[^>]+>/g, ' ')
      .replace(/[●○◐◑◒◓]/g, '')  // hapus karakter dot liturgi
      .replace(/\s+/g, ' ')
      .trim();

    if (!name || name.length < 3) continue;

    // Hapus prefix tipe seperti "HR", "HB", "Pfac*" dll
    name = name.replace(/^\s*(HR|HB|HS|Pfac\*?|H)\s*/i, '').trim();

    const dateStr = `${year}-${String(rowMonth).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;

    results.push({
      date:      dateStr,
      month:     rowMonth,
      day:       dayNum,
      dow:       dowText,
      name,
      color,
      isMinggu:  isMingggu,
      isSabtu,
      isHariRaya: /hari raya|solemnity/i.test(name),
    });
  }

  return results;
}

/**
 * Untuk jadwal MINGGUAN:
 * Ambil nama dari hari MINGGU (sesuai arahan)
 */
function getNamaMingguan(liturgyData, sundayDate) {
  const sunday = liturgyData.find(l => l.date === sundayDate && l.isMinggu);
  if (sunday) return { name: sunday.name, color: sunday.color, isHariRaya: sunday.isHariRaya };

  // Fallback: ambil hari Minggu terdekat
  const any = liturgyData.find(l => l.date === sundayDate);
  if (any) return { name: any.name, color: any.color, isHariRaya: false };

  return null;
}

/**
 * Untuk jadwal HARIAN (per pekan):
 * Ambil nama "Pekan X" yang paling sering muncul Senin–Sabtu
 */
function getNamaHarian(liturgyData, weekDates) {
  const counts = {};
  for (const d of weekDates) {
    const entry = liturgyData.find(l => l.date === d);
    if (!entry) continue;
    // Ekstrak nama pekan (contoh: "Pekan Prapaskah III" dari "Senin Pekan Prapaskah III")
    const pekanMatch = entry.name.match(/(Pekan\s+\S+(?:\s+\S+){0,2})/i);
    const key = pekanMatch ? pekanMatch[1] : entry.name.split(' ').slice(1).join(' ') || entry.name;
    counts[key] = (counts[key] || 0) + 1;
  }
  if (Object.keys(counts).length === 0) return null;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function ScheduleWeeklyPage() {
  const [events,      setEvents]     = useState([]);
  const [month,       setMonth]      = useState(new Date().getMonth() + 1);
  const [year,        setYear]       = useState(new Date().getFullYear());
  const [loading,     setLoading]    = useState(true);
  const [generating,  setGenerating] = useState(false);
  const [editEvent,   setEditEvent]  = useState(null);
  const [waText,      setWaText]     = useState('');
  const [showWA,      setShowWA]     = useState(false);
  const [deleteConf,  setDeleteConf] = useState(null);
  const [picOptions,  setPicOptions] = useState([]);  // daftar pengurus/pelatih
  const exportRefs = useRef({});

  // Load events & PIC options
  const loadEvents = useCallback(async () => {
    setLoading(true);
    const start = `${year}-${String(month).padStart(2,'0')}-01`;
    const end   = `${year}-${String(month).padStart(2,'0')}-31`;
    const { data, error } = await supabase
      .from('events')
      .select(`
        id, nama_event, tipe_event, tanggal_tugas, tanggal_latihan,
        perayaan, warna_liturgi, jumlah_misa, status_event, is_draft,
        published_at, draft_note,
        pic_slot_1a, pic_hp_slot_1a, pic_slot_1b, pic_hp_slot_1b,
        pic_slot_2a, pic_hp_slot_2a, pic_slot_2b, pic_hp_slot_2b,
        pic_slot_3a, pic_hp_slot_3a, pic_slot_3b, pic_hp_slot_3b,
        pic_slot_4a, pic_hp_slot_4a, pic_slot_4b, pic_hp_slot_4b,
        assignments(id, slot_number, position, user_id,
          users(nama_panggilan, pendidikan, lingkungan))
      `)
      .gte('tanggal_tugas', start)
      .lte('tanggal_tugas', end)
      .not('tipe_event', 'eq', 'Misa_Harian')
      .order('tanggal_tugas');
    if (error) toast.error('Gagal load jadwal: ' + error.message);
    setEvents(data || []);
    setLoading(false);
  }, [month, year]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // Load PIC options (pengurus & pelatih)
  useEffect(() => {
    supabase.from('users')
      .select('id, nickname, nama_panggilan, hp_anak, hp_ortu')
      .in('role', ['Administrator','Pengurus','Pelatih'])
      .eq('status', 'Active')
      .order('nama_panggilan')
      .then(({ data }) => setPicOptions(data || []));
  }, []);

  // ── Generate jadwal ────────────────────────────────────────────
  async function generateSchedule() {
    setGenerating(true);
    const toastId = 'gen';
    try {
      toast.loading('Mengambil data liturgi dari gcatholic.org...', { id: toastId });
      const liturgyData = await fetchLiturgi(year, month);

      if (liturgyData.length === 0) {
        toast.loading('⚠️ Data liturgi tidak tersedia, melanjutkan dengan nama default...', { id: toastId });
      } else {
        toast.loading(`✅ ${liturgyData.length} entri liturgi ditemukan. Menghitung jadwal...`, { id: toastId });
      }

      // Pool anggota aktif (tidak suspended)
      const { data: pool, error: poolErr } = await supabase
        .from('users')
        .select('id, nickname, nama_panggilan, pendidikan, lingkungan')
        .eq('status', 'Active')
        .eq('is_suspended', false);
      if (poolErr) throw poolErr;
      if (!pool || pool.length === 0) throw new Error('Tidak ada anggota aktif di database');

      // Hitung skor prioritas: makin lama tidak tugas → makin tinggi prioritas
      const sixtyDaysAgo = new Date(Date.now() - 60*24*60*60*1000).toISOString();
      const { data: recentAssign } = await supabase
        .from('assignments')
        .select('user_id, created_at')
        .gte('created_at', sixtyDaysAgo);

      const lastMap = {};
      (recentAssign || []).forEach(a => {
        if (!lastMap[a.user_id] || a.created_at > lastMap[a.user_id])
          lastMap[a.user_id] = a.created_at;
      });

      // Pisahkan SMA/SMK dan SD/SMP untuk prioritas rotasi
      const allScored = pool.map(u => ({
        ...u,
        isSmaSMK: ['SMA','SMK','Lulus'].includes(u.pendidikan),
        score: lastMap[u.id]
          ? (Date.now() - new Date(lastMap[u.id]).getTime()) / 86400000
          : 9999,
      })).sort((a, b) => b.score - a.score);

      const weekends = getWeekends(year, month);
      toast.loading(`Generate ${weekends.length} minggu (${PETUGAS_PER_SLOT} petugas/slot)...`, { id: toastId });

      let poolIdx = 0;
      let created = 0;

      for (const weekend of weekends) {
        // ── Nama liturgi: ambil dari hari MINGGU ──
        const liturgi    = getNamaMingguan(liturgyData, weekend.sunday);
        const eventName  = liturgi?.name  || 'Misa Mingguan';
        const warnaLiturgi = liturgi?.color || 'Hijau';

        // Cek duplikat
        const { data: existing } = await supabase
          .from('events')
          .select('id')
          .eq('tanggal_tugas', weekend.sunday)
          .not('tipe_event', 'eq', 'Misa_Harian')
          .maybeSingle();
        if (existing) continue;

        // Insert event sebagai DRAFT
        const { data: ev, error: evErr } = await supabase.from('events').insert({
          nama_event:        eventName.toUpperCase(),
          tipe_event:        'Mingguan',
          tanggal_tugas:     weekend.sunday,    // Minggu (referensi periode)
          tanggal_latihan:   weekend.saturday,  // Sabtu (latihan + Slot 1 Sore)
          perayaan:          eventName,
          warna_liturgi:     warnaLiturgi,
          jumlah_misa:       4,
          status_event:      'Akan_Datang',
          is_draft:          true,
          gcatholic_fetched: liturgyData.length > 0,
        }).select().single();
        if (evErr) throw evErr;

        // ── Assign PETUGAS_PER_SLOT orang per slot ──
        // Setiap slot punya pool-nya sendiri (tidak duplikat DALAM 1 slot,
        // tapi bisa muncul di slot lain jika anggota terbatas)
        const assignments = [];
        const usedThisEvent = new Set(); // tidak boleh 1 orang di 2 slot berbeda

        for (let slot = 1; slot <= 4; slot++) {
          let assigned = 0;
          let attempts = 0;
          const maxAttempts = allScored.length * 3;

          while (assigned < PETUGAS_PER_SLOT && attempts < maxAttempts) {
            const user = allScored[poolIdx % allScored.length];
            poolIdx++;
            attempts++;

            // Skip jika sudah di-assign di slot lain event ini
            if (usedThisEvent.has(user.id)) continue;

            usedThisEvent.add(user.id);
            assignments.push({
              event_id:    ev.id,
              user_id:     user.id,
              slot_number: slot,
              position:    assigned + 1,
            });
            assigned++;
          }
        }

        if (assignments.length > 0) {
          const { error: aErr } = await supabase.from('assignments').insert(assignments);
          if (aErr) console.error('Assignment error slot:', aErr.message);
        }

        created++;
      }

      toast.success(
        created > 0
          ? `✅ ${created} jadwal dibuat sebagai DRAFT (${PETUGAS_PER_SLOT} petugas/slot). Silakan review dan isi PIC sebelum Publish.`
          : 'Semua jadwal bulan ini sudah ada.',
        { id: toastId, duration: 5000 }
      );
      loadEvents();
    } catch (err) {
      toast.error('Gagal generate: ' + err.message, { id: toastId });
    } finally {
      setGenerating(false);
    }
  }

  // ── Ambil hari Sabtu & Minggu dalam bulan ─────────────────────
  function getWeekends(y, m) {
    const result = [];
    const d = new Date(y, m - 1, 1);
    while (d.getMonth() === m - 1) {
      if (d.getDay() === 0) { // Minggu
        const sat = new Date(d);
        sat.setDate(d.getDate() - 1);
        result.push({
          saturday: sat.toISOString().split('T')[0],
          sunday:   d.toISOString().split('T')[0],
        });
      }
      d.setDate(d.getDate() + 1);
    }
    return result;
  }

  // ── Publish / Unpublish ────────────────────────────────────────
  async function publishEvent(ev) {
    if (!ev.perayaan || ev.perayaan.toLowerCase().includes('misa mingguan')) {
      if (!confirm('Nama perayaan masih default. Yakin mau publish?')) return;
    }
    const { error } = await supabase.from('events').update({
      is_draft:     false,
      published_at: new Date().toISOString(),
    }).eq('id', ev.id);
    if (error) { toast.error('Gagal publish: ' + error.message); return; }
    toast.success(`"${ev.perayaan}" berhasil dipublish! 🎉`);
    loadEvents();
  }

  async function unpublishEvent(ev) {
    const { error } = await supabase.from('events')
      .update({ is_draft: true, published_at: null }).eq('id', ev.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Event dikembalikan ke draft');
    loadEvents();
  }

  // ── Hapus event ────────────────────────────────────────────────
  async function deleteEvent(ev) {
    await supabase.from('assignments').delete().eq('event_id', ev.id);
    const { error } = await supabase.from('events').delete().eq('id', ev.id);
    if (error) { toast.error('Gagal hapus: ' + error.message); return; }
    toast.success('Jadwal berhasil dihapus');
    setDeleteConf(null);
    loadEvents();
  }

  // ── Simpan edit ────────────────────────────────────────────────
  async function saveEditEvent() {
    if (!editEvent) return;
    const { error } = await supabase.from('events').update({
      perayaan:        editEvent.perayaan,
      nama_event:      (editEvent.perayaan || '').toUpperCase(),
      warna_liturgi:   editEvent.warna_liturgi,
      tanggal_latihan: editEvent.tanggal_latihan,
      draft_note:      editEvent.draft_note,
      // PIC per slot
      pic_slot_1a: editEvent.pic_slot_1a || null, pic_hp_slot_1a: editEvent.pic_hp_slot_1a || null,
      pic_slot_1b: editEvent.pic_slot_1b || null, pic_hp_slot_1b: editEvent.pic_hp_slot_1b || null,
      pic_slot_2a: editEvent.pic_slot_2a || null, pic_hp_slot_2a: editEvent.pic_hp_slot_2a || null,
      pic_slot_2b: editEvent.pic_slot_2b || null, pic_hp_slot_2b: editEvent.pic_hp_slot_2b || null,
      pic_slot_3a: editEvent.pic_slot_3a || null, pic_hp_slot_3a: editEvent.pic_hp_slot_3a || null,
      pic_slot_3b: editEvent.pic_slot_3b || null, pic_hp_slot_3b: editEvent.pic_hp_slot_3b || null,
      pic_slot_4a: editEvent.pic_slot_4a || null, pic_hp_slot_4a: editEvent.pic_hp_slot_4a || null,
      pic_slot_4b: editEvent.pic_slot_4b || null, pic_hp_slot_4b: editEvent.pic_hp_slot_4b || null,
    }).eq('id', editEvent.id);
    if (error) { toast.error('Gagal simpan: ' + error.message); return; }
    toast.success('Jadwal diperbarui!');
    setEditEvent(null);
    loadEvents();
  }

  // ── WA Template ────────────────────────────────────────────────
  function generateWAText(ev) {
    const asgn   = ev.assignments || [];
    const bySlot = {};
    for (let s = 1; s <= 4; s++)
      bySlot[s] = asgn.filter(a => a.slot_number === s).map(a => a.users?.nama_panggilan || '?');

    const satDate = formatDate(ev.tanggal_latihan, 'dd');
    const sunDate = formatDate(ev.tanggal_tugas,   'dd MMMM yyyy');
    const lines   = [
      'PERAYAAN EKARISTI',
      ev.perayaan || ev.nama_event,
      `${satDate}–${sunDate}`,
      '',
    ];

    for (const [slot, info] of Object.entries(SLOT_LABELS)) {
      const slotNum = Number(slot);
      lines.push(info.time);
      // PIC
      const picA = ev[`pic_slot_${slotNum}a`];
      const picB = ev[`pic_slot_${slotNum}b`];
      if (picA || picB) lines.push(`PIC: ${[picA, picB].filter(Boolean).join(' & ')}`);
      // Petugas
      const names = bySlot[slotNum] || [];
      if (names.length === 0) {
        for (let i = 1; i <= PETUGAS_PER_SLOT; i++) lines.push(`${i}. (kosong)`);
      } else {
        names.forEach((n, i) => lines.push(`${i+1}. ${n}`));
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  // ── Export PNG ─────────────────────────────────────────────────
  async function exportPNG(eventId) {
    const ref = exportRefs.current[eventId];
    if (!ref) return;
    try {
      const png = await toPng(ref, { pixelRatio: 2, backgroundColor: '#ffffff' });
      const a = document.createElement('a'); a.href = png;
      a.download = `jadwal-${eventId}.png`; a.click();
      toast.success('PNG berhasil diunduh!');
    } catch { toast.error('Gagal export PNG'); }
  }

  // ── Helper: PIC picker ─────────────────────────────────────────
  function PicSelect({ slot, pos }) {
    const fieldNick = `pic_slot_${slot}${pos}`;
    const fieldHp   = `pic_hp_slot_${slot}${pos}`;
    const label     = pos === 'a' ? 'PIC 1' : 'PIC 2';
    const selected  = editEvent?.[fieldNick] || '';

    function handleChange(nickname) {
      const found = picOptions.find(p => p.nickname === nickname);
      const hp    = found ? (found.hp_anak || found.hp_ortu || '') : '';
      setEditEvent(v => ({ ...v, [fieldNick]: nickname, [fieldHp]: hp }));
    }

    return (
      <div className="flex-1">
        <label className="text-[10px] text-gray-400 font-medium">{label}</label>
        <select className="input text-xs mt-0.5" value={selected} onChange={e => handleChange(e.target.value)}>
          <option value="">— {label} —</option>
          {picOptions.map(p => (
            <option key={p.id} value={p.nickname}>{p.nama_panggilan} (@{p.nickname})</option>
          ))}
        </select>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  const draftCount     = events.filter(e => e.is_draft).length;
  const publishedCount = events.filter(e => !e.is_draft).length;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Jadwal Misa Mingguan</h1>
          <p className="page-subtitle">
            {PETUGAS_PER_SLOT} petugas/slot · 4 slot · Draft → Review → Publish
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <button onClick={() => { if (month===1){setMonth(12);setYear(y=>y-1);}else setMonth(m=>m-1); }}
            className="btn-ghost p-2"><ChevronLeft size={18}/></button>
          <span className="font-semibold text-gray-700 w-36 text-center">{MONTHS[month-1]} {year}</span>
          <button onClick={() => { if (month===12){setMonth(1);setYear(y=>y+1);}else setMonth(m=>m+1); }}
            className="btn-ghost p-2"><ChevronRight size={18}/></button>
          <button onClick={loadEvents} className="btn-ghost p-2" title="Refresh">
            <RefreshCw size={16}/>
          </button>
          <button onClick={generateSchedule} disabled={generating} className="btn-primary gap-2">
            <Zap size={16}/> {generating ? 'Generating...' : 'Generate Draft'}
          </button>
        </div>
      </div>

      {/* Status bar */}
      {events.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {draftCount > 0 && (
            <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2">
              <FileEdit size={15} className="text-yellow-600"/>
              <span className="text-sm font-semibold text-yellow-700">{draftCount} jadwal draft — belum terlihat publik</span>
            </div>
          )}
          {publishedCount > 0 && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
              <Globe size={15} className="text-green-600"/>
              <span className="text-sm font-semibold text-green-700">{publishedCount} jadwal published</span>
            </div>
          )}
        </div>
      )}

      {/* Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700 flex items-start gap-2">
        <FileEdit size={15} className="flex-shrink-0 mt-0.5"/>
        <span>
          Jadwal yang digenerate berstatus <strong>Draft</strong>. 
          Wajib isi <strong>PIC</strong> tiap slot via tombol ✏️ edit, lalu klik <strong>Publish</strong>
          agar terlihat di jadwal publik. Nama perayaan diambil dari <strong>hari Minggu</strong> gcatholic.org.
        </span>
      </div>

      {/* Events */}
      {loading ? (
        <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="skeleton h-64 rounded-xl"/>)}</div>
      ) : events.length === 0 ? (
        <div className="card text-center py-14">
          <Calendar size={48} className="mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500 font-medium">Belum ada jadwal untuk {MONTHS[month-1]} {year}</p>
          <button onClick={generateSchedule} disabled={generating} className="btn-primary mt-4 gap-2">
            <Zap size={16}/> Generate Sekarang
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {events.map(ev => {
            const lc     = getLiturgyClass(ev.warna_liturgi);
            const asgn   = ev.assignments || [];
            const bySlot = {};
            for (let s = 1; s <= 4; s++) bySlot[s] = asgn.filter(a => a.slot_number === s);

            return (
              <div key={ev.id} className={`card border-l-4 ${ev.is_draft ? 'border-yellow-400 bg-yellow-50/30' : 'border-green-400'}`}>

                {/* Event header */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <div className={`w-3 h-3 rounded-full ${lc.dot}`}/>
                      <span className={`text-xs font-semibold ${lc.text}`}>{ev.warna_liturgi}</span>
                      {ev.is_draft
                        ? <span className="badge-yellow text-xs flex items-center gap-1"><FileEdit size={10}/>Draft</span>
                        : <span className="badge-green text-xs flex items-center gap-1"><Globe size={10}/>Published</span>
                      }
                    </div>
                    <h3 className="font-bold text-gray-900 text-xl leading-tight">{ev.perayaan || ev.nama_event}</h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Latihan: <strong>{formatDate(ev.tanggal_latihan, 'EEEE, dd MMM')}</strong>
                      {' '}·{' '}
                      Misa: <strong>Sabtu Sore s/d Minggu {formatDate(ev.tanggal_tugas, 'dd MMM yyyy')}</strong>
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {asgn.length} petugas ter-assign ({PETUGAS_PER_SLOT} per slot)
                    </p>
                    {ev.draft_note && (
                      <p className="text-xs text-yellow-700 bg-yellow-100 rounded px-2 py-1 mt-1.5 inline-block">📝 {ev.draft_note}</p>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-1 flex-wrap flex-shrink-0">
                    <button onClick={() => setEditEvent({...ev})} className="btn-outline btn-sm gap-1" title="Edit jadwal & PIC">
                      <Edit2 size={14}/> Edit
                    </button>
                    {ev.is_draft ? (
                      <button onClick={() => publishEvent(ev)} className="btn-primary btn-sm gap-1">
                        <Globe size={13}/> Publish
                      </button>
                    ) : (
                      <button onClick={() => unpublishEvent(ev)} className="btn-outline btn-sm gap-1">
                        <Lock size={13}/> Draft
                      </button>
                    )}
                    <button onClick={() => { setWaText(generateWAText(ev)); setShowWA(true); }}
                      className="btn-outline btn-sm gap-1"><Send size={13}/> WA</button>
                    <button onClick={() => exportPNG(ev.id)} className="btn-outline btn-sm gap-1">
                      <Download size={13}/> PNG
                    </button>
                    <button onClick={() => setDeleteConf(ev)} className="btn-ghost p-2 text-red-500 hover:bg-red-50">
                      <Trash2 size={15}/>
                    </button>
                  </div>
                </div>

                {/* Slot grid — export target */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3"
                  ref={el => { exportRefs.current[ev.id] = el; }}>
                  {[1,2,3,4].map(slot => {
                    const info   = SLOT_LABELS[slot];
                    const picA   = ev[`pic_slot_${slot}a`];
                    const picB   = ev[`pic_slot_${slot}b`];
                    const people = bySlot[slot] || [];

                    return (
                      <div key={slot} className={`p-3 rounded-xl border ${lc.bg} border-gray-100`}>
                        {/* Slot header */}
                        <div className="mb-2 pb-2 border-b border-gray-200/60">
                          <p className="text-xs font-bold text-gray-700">{info.time}</p>
                          {/* PIC */}
                          {(picA || picB) ? (
                            <div className="flex items-center gap-1 mt-1">
                              <UserCheck size={11} className="text-brand-600"/>
                              <p className="text-[11px] text-brand-700 font-medium">
                                PIC: {[picA, picB].filter(Boolean).join(' & ')}
                              </p>
                            </div>
                          ) : (
                            <p className="text-[11px] text-red-400 mt-0.5 flex items-center gap-1">
                              <AlertTriangle size={10}/> PIC belum diisi
                            </p>
                          )}
                        </div>

                        {/* Petugas list */}
                        <div className="space-y-0.5">
                          {people.length === 0 ? (
                            <p className="text-xs text-gray-400 italic py-1">Belum ada petugas</p>
                          ) : people.map((a, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <span className="text-[10px] text-gray-400 w-4 text-right">{i+1}.</span>
                              <div>
                                <p className="text-xs font-medium text-gray-800 leading-none">{a.users?.nama_panggilan}</p>
                                <p className="text-[10px] text-gray-400">{a.users?.pendidikan} · {a.users?.lingkungan}</p>
                              </div>
                            </div>
                          ))}
                          {/* Slot kosong jika kurang dari PETUGAS_PER_SLOT */}
                          {people.length > 0 && people.length < PETUGAS_PER_SLOT && (
                            <p className="text-[10px] text-orange-400 mt-1">
                              +{PETUGAS_PER_SLOT - people.length} slot kosong
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── EDIT MODAL ── */}
      {editEvent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg">Edit Jadwal</h3>
              <button onClick={() => setEditEvent(null)}><X size={20}/></button>
            </div>

            <div className="grid sm:grid-cols-2 gap-4 mb-5">
              <div className="sm:col-span-2">
                <label className="label">Nama Perayaan (dari gcatholic.org)</label>
                <input className="input" value={editEvent.perayaan || ''}
                  placeholder="Contoh: Hari Minggu Prapaskah III"
                  onChange={e => setEditEvent(v => ({...v, perayaan: e.target.value, nama_event: e.target.value.toUpperCase()}))} />
              </div>
              <div>
                <label className="label">Tanggal Latihan</label>
                <input type="date" className="input" value={editEvent.tanggal_latihan || ''}
                  onChange={e => setEditEvent(v => ({...v, tanggal_latihan: e.target.value}))} />
              </div>
              <div>
                <label className="label">Warna Liturgi</label>
                <select className="input" value={editEvent.warna_liturgi || 'Hijau'}
                  onChange={e => setEditEvent(v => ({...v, warna_liturgi: e.target.value}))}>
                  {WARNA_OPTIONS.map(w => <option key={w}>{w}</option>)}
                </select>
              </div>
            </div>

            {/* PIC per slot */}
            <div className="mb-5">
              <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <UserCheck size={16} className="text-brand-800"/> PIC per Slot
              </h4>
              <div className="space-y-3">
                {[1,2,3,4].map(slot => (
                  <div key={slot} className="p-3 bg-gray-50 rounded-xl">
                    <p className="text-xs font-bold text-gray-600 mb-2">{SLOT_LABELS[slot].time}</p>
                    <div className="flex gap-3">
                      <PicSelect slot={slot} pos="a"/>
                      <PicSelect slot={slot} pos="b"/>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-5">
              <label className="label">Catatan Draft</label>
              <textarea className="input h-16 resize-none" value={editEvent.draft_note || ''}
                placeholder="Catatan untuk penjadwal sebelum publish..."
                onChange={e => setEditEvent(v => ({...v, draft_note: e.target.value}))} />
            </div>

            <div className="flex gap-2">
              <button onClick={saveEditEvent} className="btn-primary flex-1 gap-2">
                <Check size={16}/> Simpan
              </button>
              <button onClick={() => setEditEvent(null)} className="btn-secondary">Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRM ── */}
      {deleteConf && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle size={24} className="text-red-500"/>
              <h3 className="font-bold text-lg">Hapus Jadwal?</h3>
            </div>
            <p className="text-sm text-gray-600 mb-1">
              <strong>"{deleteConf.perayaan || deleteConf.nama_event}"</strong><br/>
              {formatDate(deleteConf.tanggal_tugas, 'dd MMM yyyy')}
            </p>
            <p className="text-xs text-red-500 mb-4">⚠️ Semua penugasan ({deleteConf.assignments?.length || 0} petugas) ikut terhapus. Tidak bisa dibatalkan.</p>
            <div className="flex gap-2">
              <button onClick={() => deleteEvent(deleteConf)} className="btn-danger flex-1">Hapus</button>
              <button onClick={() => setDeleteConf(null)} className="btn-secondary">Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* ── WA MODAL ── */}
      {showWA && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">Template WA Jadwal</h3>
              <button onClick={() => setShowWA(false)}><X size={20}/></button>
            </div>
            <textarea className="w-full h-80 font-mono text-xs p-3 border border-gray-200 rounded-xl bg-gray-50 resize-none"
              value={waText} readOnly/>
            <div className="flex gap-2 mt-4">
              <button onClick={() => { navigator.clipboard.writeText(waText); toast.success('Disalin!'); }}
                className="btn-primary flex-1">Salin Teks</button>
              <button onClick={() => setShowWA(false)} className="btn-secondary">Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
