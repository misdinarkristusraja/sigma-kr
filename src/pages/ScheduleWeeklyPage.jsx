import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getLiturgiMinggu as getStaticLiturgi, getLiturgiByMonth, HARI_RAYA_NO_HARIAN } from '../lib/liturgiData2026';
import { supabase } from '../lib/supabase';
import { formatDate, getLiturgyClass, tagDuplicateNames } from '../lib/utils';
import { toPng } from 'html-to-image';
import {
  Calendar, Download, Send, Edit2, Check, X,
  ChevronLeft, ChevronRight, Zap, AlertTriangle, Trash2,
  FileEdit, Globe, Lock, UserCheck, RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ─── Konstanta ─────────────────────────────────────────────────────────────
const SLOT_INFO = {
  1: { time: 'Sabtu 17:30',  label: 'Sabtu Sore',    jam: '17.30' },
  2: { time: 'Minggu 06:00', label: 'Minggu Pagi I',  jam: '06.00' },
  3: { time: 'Minggu 08:00', label: 'Minggu Pagi II', jam: '08.00' },
  4: { time: 'Minggu 17:30', label: 'Minggu Sore',   jam: '17.30' },
};
const MONTHS         = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
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
function buildExportHTML(ev, assignments) {
  const bySlot = {};
  for (let s = 1; s <= 4; s++) bySlot[s] = assignments.filter(a => a.slot_number === s);

  const perayaan = ev.perayaan || ev.nama_event || 'MISA MINGGUAN';

  // Format tanggal Indonesia (local, bukan toISOString)
  function fmtTglIndo(dateStr) {
    if (!dateStr) return '';
    const [y, mo, d] = dateStr.split('-').map(Number);
    return `${d} ${MONTHS_UPPER[mo - 1]} ${y}`;
  }

  const satTgl = fmtTglIndo(ev.tanggal_latihan);
  const sunTgl = fmtTglIndo(ev.tanggal_tugas);

  let rows = '';
  for (let slot = 1; slot <= 4; slot++) {
    const info    = SLOT_INFO[slot];
    const people  = bySlot[slot] || [];
    const picA    = ev[`pic_slot_${slot}a`] || '—';
    const picB    = ev[`pic_slot_${slot}b`] || '—';
    const hpA     = ev[`pic_hp_slot_${slot}a`] || '';
    const hpB     = ev[`pic_hp_slot_${slot}b`] || '';
    const tglSlot = slot === 1 ? satTgl : sunTgl;
    const rowspan = Math.max(people.length, 1);

    // Show PIC 1 phone prominently (main contact)
    const pic1Phone = hpA || '';
    const hp = pic1Phone ? `HP: ${pic1Phone}` : '';

    const tanggalCell = `
      <td rowspan="${rowspan}" style="
        border:1px solid #333; padding:8px 10px; vertical-align:middle;
        text-align:center; font-size:11px; font-weight:bold; line-height:1.6;
        min-width:160px; background:#f9f9f9;">
        ${info.label.toUpperCase()}<br>
        ${tglSlot}<br>
        JAM (${info.jam})<br>
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

  return `
    <div style="font-family:'Arial',sans-serif; width:900px; padding:20px; background:white;">
      <table style="width:100%; border-collapse:collapse; border:2px solid #333;">
        <thead>
          <tr>
            <th colspan="4" style="
              border:2px solid #333; padding:12px; text-align:center;
              font-size:16px; font-weight:bold; letter-spacing:1px;">
              ${perayaan.toUpperCase()}
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
  const [picBatch,   setPicBatch]   = useState({});
  const [savingPIC,  setSavingPIC]  = useState(false);
  const [showAddMisa, setShowAddMisa] = useState(false);
  const INIT_MISA_FORM = {
    tipe:            'Misa_Khusus',  // 'Misa_Khusus' | 'Mingguan_HariRaya'
    tanggal_tugas:   '',
    tanggal_latihan: '',
    perayaan:        '',
    warna_liturgi:   'Putih',
    jumlah_misa:     1,
    // Jam per slot (bisa lebih dari 1 untuk Misa_Khusus)
    slot_times:      ['07.00'],      // array jam string sesuai jumlah slot
    // Misa Vigili: misa malam sebelumnya
    ada_vigili:      false,
    vigili_jam:      '17.30',        // jam misa vigili (default sore)
    // tanggal_tugas adalah hari utama, vigili = tanggal_tugas - 1 hari
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
        published_at, draft_note,
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
      .select('id, nickname, nama_panggilan, hp_anak, hp_ortu')
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

    // Susun nama event dengan jam jika ada
    const jamStr = !isMingguanHariRaya && f.slot_times?.length
      ? ` (${f.slot_times.filter(Boolean).join(', ')})`
      : '';

    // Untuk Misa_Khusus: draft_note berisi info jam tiap slot
    const draftNote = !isMingguanHariRaya && f.slot_times?.length
      ? `Jam: ${f.slot_times.map((j,i) => `Slot ${i+1}: ${j}`).join(' | ')}`
      : '';

    // Insert event utama
    const { data: ev, error } = await supabase.from('events').insert({
      nama_event:        (f.perayaan + jamStr).toUpperCase(),
      tipe_event:        isMingguanHariRaya ? 'Mingguan' : 'Misa_Khusus',
      tanggal_tugas:     f.tanggal_tugas,
      tanggal_latihan:   isMingguanHariRaya ? f.tanggal_latihan : null,
      perayaan:          f.perayaan,
      warna_liturgi:     f.warna_liturgi,
      jumlah_misa:       isMingguanHariRaya ? 4 : f.jumlah_misa,
      status_event:      'Akan_Datang',
      is_draft:          true,
      gcatholic_fetched: false,
      draft_note:        draftNote || null,
    }).select().single();

    if (error) { toast.error('Gagal tambah: ' + error.message); return; }

    // Jika ada Misa Vigili: buat event terpisah untuk H-1
    if (!isMingguanHariRaya && f.ada_vigili && f.vigili_jam) {
      // Hitung tanggal vigili = tanggal_tugas - 1 hari
      const [vy, vm, vd] = f.tanggal_tugas.split('-').map(Number);
      const vigiliDate   = new Date(vy, vm - 1, vd - 1);
      const vigiliStr    = `${vigiliDate.getFullYear()}-${String(vigiliDate.getMonth()+1).padStart(2,'0')}-${String(vigiliDate.getDate()).padStart(2,'0')}`;

      await supabase.from('events').insert({
        nama_event:        `MISA VIGILI — ${f.perayaan.toUpperCase()} (${f.vigili_jam})`,
        tipe_event:        'Misa_Khusus',
        tanggal_tugas:     vigiliStr,
        tanggal_latihan:   null,
        perayaan:          `Misa Vigili — ${f.perayaan}`,
        warna_liturgi:     f.warna_liturgi,
        jumlah_misa:       1,
        status_event:      'Akan_Datang',
        is_draft:          true,
        gcatholic_fetched: false,
        draft_note:        `Vigili H-1. Jam: ${f.vigili_jam}`,
      });
    }

    const vigiliInfo = (!isMingguanHariRaya && f.ada_vigili) ? ' + Misa Vigili H-1' : '';
    toast.success(`"${f.perayaan}"${vigiliInfo} berhasil ditambahkan sebagai DRAFT!`);
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
    }).eq('id', editEvent.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Jadwal diperbarui!');
    setEditEvent(null);
    loadEvents();
  }

  // ── Export PNG (format tabel seperti contoh) ───────────────
  async function exportPNG(ev) {
    const asgn = ev.assignments || [];
    const html = buildExportHTML(ev, asgn);

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

    // Assignments 180 hari terakhir — pakai created_at (bukan tanggal_tugas)
    // Ini yang dipakai generate jadwal: kapan TERAKHIR seseorang ditambahkan ke assignment
    const since180 = new Date(now - 180*24*3600*1000).toISOString();
    const { data: recent } = await supabase.from('assignments')
      .select('user_id, created_at, slot_number, events(tanggal_tugas)')
      .gte('created_at', since180)
      .order('created_at', { ascending: false });

    // Per-user stats
    const countMap    = {};  // total assignments 180 hari
    const lastCreated = {};  // created_at assignment terakhir (untuk skor generate)
    const lastEventDate = {}; // tanggal_tugas event terakhir (untuk info)
    pool.forEach(u => { countMap[u.id] = 0; lastCreated[u.id] = null; lastEventDate[u.id] = null; });

    (recent||[]).forEach(a => {
      if (countMap[a.user_id] === undefined) return;
      countMap[a.user_id]++;
      // created_at = kapan jadwal dibuat (termasuk draft)
      if (!lastCreated[a.user_id] || a.created_at > lastCreated[a.user_id]) {
        lastCreated[a.user_id] = a.created_at;
      }
      // tanggal_tugas = tanggal misa (untuk info display)
      const evTgl = a.events?.tanggal_tugas;
      if (evTgl && (!lastEventDate[a.user_id] || evTgl > lastEventDate[a.user_id])) {
        lastEventDate[a.user_id] = evTgl;
      }
    });

    // ── Scoring logic ──────────────────────────────────────────────────────
    // Skor dasar = hari sejak assignment terakhir dibuat (created_at)
    // Bonus/Penalti dari rekap kehadiran 180 hari terakhir:
    //   Setiap K6 (absen tanpa ijin) = -5 hari bonus (orang paling sering absen
    //   naik prioritas lebih lambat — "reward yang hadir")
    //   Setiap K5 (hadir latihan saja) = -2 hari (sudah ada effort)
    // Belum pernah dijadwalkan = 9999

    // Ambil rekap K5/K6 per user — 30 hari terakhir yang VALID (tanggal_tugas sudah lewat)
    const since30   = new Date(now - 30*24*3600*1000).toISOString().split('T')[0];
    const todayStr2 = now.toISOString().split('T')[0];
    const { data: recentScans } = await supabase.from('scan_records')
      .select('user_id, scan_type, event_id, timestamp')
      .gte('timestamp', since30 + 'T00:00:00');
    // Only past events (tanggal_tugas <= today) - future events don't count as absen
    const { data: recentAssigns } = await supabase.from('assignments')
      .select('user_id, event_id, events(tanggal_tugas)')
      .gte('events.tanggal_tugas', since30)
      .lte('events.tanggal_tugas', todayStr2);

    // Compute K5/K6 counts per user (simple version)
    const k6Map = {}, k5Map = {};
    pool.forEach(u => { k6Map[u.id] = 0; k5Map[u.id] = 0; });
    const scansByUser = {};
    pool.forEach(u => { scansByUser[u.id] = { tugas: false, latihan: false }; });

    // Group scans by user+week
    const assignsByUser = {};
    pool.forEach(u => { assignsByUser[u.id] = new Set(); });
    (recentAssigns||[]).filter(a=>a.events).forEach(a => {
      if (assignsByUser[a.user_id]) assignsByUser[a.user_id].add(a.event_id);
    });

    // Simple absen check: assigned but no tugas scan
    (pool).forEach(u => {
      const assigned = assignsByUser[u.id];
      const userScans = (recentScans||[]).filter(s => s.user_id === u.id);
      const scanEventIds = new Set(userScans.filter(s=>s.scan_type==='tugas'||s.scan_type==='walkin_tugas').map(s=>s.event_id).filter(Boolean));
      const latihanEventIds = new Set(userScans.filter(s=>s.scan_type==='latihan'||s.scan_type==='walkin_latihan').map(s=>s.event_id).filter(Boolean));
      assigned.forEach(eid => {
        if (!scanEventIds.has(eid)) {
          if (latihanEventIds.has(eid)) k5Map[u.id]++;  // K5: hadir latihan tapi absen tugas
          else k6Map[u.id]++;                            // K6: absen total
        }
      });
    });

    const rawScored = pool.map(u => {
      const lc        = lastCreated[u.id];
      const baseScore = lc
        ? Math.max(0, Math.floor((now - new Date(lc)) / 86400000))
        : 9999;
      // Penalti: K6 mengurangi "kredit tunggu" sedikit
      const penalty   = (k6Map[u.id] || 0) * 5 + (k5Map[u.id] || 0) * 2;
      const score     = baseScore >= 9999 ? 9999 : Math.max(0, baseScore - penalty);
      return {
        ...u,
        daysSince:  baseScore,
        score,
        count180:   countMap[u.id],
        k6Count:    k6Map[u.id] || 0,
        k5Count:    k5Map[u.id] || 0,
        penalty,
        lastDate:   lastEventDate[u.id],
      };
    }).sort((a, b) => b.score - a.score);

    // Normalisasi relatif — gunakan distribusi yang bermakna
    // Jika semua score dekat (misal 0-2 hari), tetap tampilkan proporsi
    const maxScore = Math.max(...rawScored.map(u => u.score >= 9999 ? 0 : u.score), 1);
    const withPct = rawScored.map((u, i) => {
      const pct = u.score >= 9999 ? 100
                : maxScore > 0   ? Math.round((u.score / maxScore) * 100)
                : 0;
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
                    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                      {[1,2,3,4].map(slot => {
                        const curA = picBatch[ev.id]?.[slot]?.a ?? ev[`pic_slot_${slot}a`] ?? '';
                        const curB = picBatch[ev.id]?.[slot]?.b ?? ev[`pic_slot_${slot}b`] ?? '';
                        const info = SLOT_INFO[slot];
                        return (
                          <div key={slot} className="p-3 bg-gray-50 rounded-xl">
                            <p className="text-xs font-bold text-gray-600 mb-2">{info.time}</p>
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
          {events.map(ev => {
            const lc   = getLiturgyClass(ev.warna_liturgi);
            const asgn = ev.assignments || [];
            const bySlot = {};
            for (let s=1;s<=4;s++) bySlot[s] = asgn.filter(a=>a.slot_number===s);
            // Disambiguasi nama panggilan yang sama dalam event ini
            const nameTag = tagDuplicateNames(
              asgn.map(a => a.users).filter(Boolean).map(u => ({ ...u, id: u.nickname || '' }))
            );

            return (
              <div key={ev.id} className={`card border-l-4 ${ev.is_draft?'border-yellow-400 bg-yellow-50/20':'border-green-400'}`}>

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
                    <h3 className="font-bold text-gray-900 text-xl leading-tight">{ev.perayaan || ev.nama_event}</h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Latihan: <strong>{formatDate(ev.tanggal_latihan,'EEEE, dd MMM')}</strong>
                      {' · '}Misa: Sabtu Sore s/d Minggu <strong>{formatDate(ev.tanggal_tugas,'dd MMM yyyy')}</strong>
                    </p>
                    <p className="text-xs text-gray-400">{asgn.length} petugas ({PETUGAS_PER_SLOT}/slot)</p>
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
                    <button onClick={()=>setDeleteConf(ev)} className="btn-ghost p-2 text-red-500 hover:bg-red-50"><Trash2 size={15}/></button>
                  </div>
                </div>

                {/* Pelatih Piket */}
                {picOptions.filter(p => {
                  // Show Pelatih who are PIC in any slot of this event
                  const pNicks = [1,2,3,4].flatMap(s => [ev[`pic_slot_${s}a`], ev[`pic_slot_${s}b`]]).filter(Boolean);
                  const pelatihNicks = picOptions.filter(u => u.role === 'Pelatih').map(u => u.nickname);
                  return pNicks.some(n => pelatihNicks.includes(n)) && pelatihNicks.includes(p.nickname) && pNicks.includes(p.nickname);
                }).length > 0 && (
                  <div className="mb-3 p-2 bg-blue-50 rounded-xl border border-blue-100">
                    <p className="text-xs font-semibold text-blue-700 mb-1">👤 Pelatih Piket</p>
                    <div className="flex flex-wrap gap-1">
                      {[1,2,3,4].flatMap(s => [ev[`pic_slot_${s}a`], ev[`pic_slot_${s}b`]]).filter(Boolean)
                        .filter((n,i,arr) => arr.indexOf(n) === i) // deduplicate
                        .filter(n => picOptions.find(p => p.nickname === n && p.role === 'Pelatih'))
                        .map(nick => {
                          const p = picOptions.find(u => u.nickname === nick);
                          return <span key={nick} className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-lg font-medium">{p?.nama_panggilan || nick}</span>;
                        })
                      }
                    </div>
                  </div>
                )}

                {/* Slot cards */}
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                  {[1,2,3,4].map(slot => {
                    const info   = SLOT_INFO[slot];
                    const picA   = ev[`pic_slot_${slot}a`];
                    const picB   = ev[`pic_slot_${slot}b`];
                    const people = bySlot[slot] || [];
                    return (
                      <div key={slot} className={`p-3 rounded-xl border ${lc.bg} border-gray-100`}>
                        <div className="mb-2 pb-2 border-b border-gray-200/70">
                          <p className="text-xs font-bold text-gray-700">{info.time}</p>
                          {picA||picB
                            ? <p className="text-[11px] text-brand-700 flex items-center gap-1 mt-0.5">
                                <UserCheck size={11}/>PIC: {[picA,picB].filter(Boolean).join(' & ')}
                              </p>
                            : <p className="text-[11px] text-red-400 flex items-center gap-1 mt-0.5">
                                <AlertTriangle size={10}/>PIC belum diisi
                              </p>
                          }
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
              </div>
            );
          })}
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
            <div className="flex gap-2">
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg">Tambah Misa Khusus / Hari Raya</h3>
              <button onClick={() => setShowAddMisa(false)}><X size={20}/></button>
            </div>

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
                    <select className="input" value={addMisaForm.jumlah_misa}
                      onChange={e=>{
                        const n = Number(e.target.value);
                        setAddMisaForm(f=>({
                          ...f,
                          jumlah_misa: n,
                          slot_times: Array.from({length:n}, (_,i) => f.slot_times[i] || '07.00'),
                        }));
                      }}>
                      {[1,2,3,4].map(n=><option key={n} value={n}>{n} misa</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Jam per slot — hanya Misa_Khusus */}
              {addMisaForm.tipe==='Misa_Khusus' && (
                <div>
                  <label className="label">Jam Misa</label>
                  <div className="flex gap-2 flex-wrap">
                    {addMisaForm.slot_times.map((jam, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-500 w-12">Misa {idx+1}:</span>
                        <input
                          type="text"
                          className="input w-24 text-sm"
                          value={jam}
                          placeholder="07.00"
                          onChange={e => {
                            const next = [...addMisaForm.slot_times];
                            next[idx] = e.target.value;
                            setAddMisaForm(f=>({...f, slot_times: next}));
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Format: 07.00, 17.30, dll.</p>
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

              {/* Misa Vigili — hanya Misa_Khusus */}
              {addMisaForm.tipe==='Misa_Khusus' && (
                <div className={`p-3 rounded-xl border-2 transition-all ${addMisaForm.ada_vigili ? 'border-brand-800 bg-brand-50' : 'border-gray-200 bg-gray-50'}`}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addMisaForm.ada_vigili}
                      onChange={e=>setAddMisaForm(f=>({...f, ada_vigili:e.target.checked}))}
                      className="w-4 h-4 accent-brand-800"
                    />
                    <div>
                      <p className="text-sm font-semibold text-gray-800">Ada Misa Vigili (H-1)</p>
                      <p className="text-xs text-gray-500">
                        Misa sore/malam di hari sebelum hari raya.
                        Contoh: HR. Kenaikan Tuhan (Kamis) → Vigili Rabu sore.
                      </p>
                    </div>
                  </label>

                  {addMisaForm.ada_vigili && (
                    <div className="mt-3 flex items-center gap-3">
                      <span className="text-xs text-gray-600 w-32 flex-shrink-0">
                        Jam Vigili ({addMisaForm.tanggal_tugas
                          ? (() => {
                              const [y,m,d] = addMisaForm.tanggal_tugas.split('-').map(Number);
                              const vd = new Date(y,m-1,d-1);
                              return ['Min','Sen','Sel','Rab','Kam','Jum','Sab'][vd.getDay()] + ', ' +
                                vd.getDate() + ' ' + ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][vd.getMonth()];
                            })()
                          : 'H-1'
                        }):
                      </span>
                      <input
                        type="text"
                        className="input w-24 text-sm"
                        value={addMisaForm.vigili_jam}
                        placeholder="17.30"
                        onChange={e=>setAddMisaForm(f=>({...f, vigili_jam:e.target.value}))}
                      />
                      <p className="text-xs text-gray-400">Format: 17.30</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Preview ringkasan */}
            {addMisaForm.perayaan && addMisaForm.tanggal_tugas && (
              <div className="mt-4 p-3 bg-gray-50 rounded-xl text-xs text-gray-600 space-y-1">
                <p className="font-semibold text-gray-800">Preview:</p>
                {addMisaForm.ada_vigili && addMisaForm.tipe==='Misa_Khusus' && (() => {
                  const [y,m,d] = addMisaForm.tanggal_tugas.split('-').map(Number);
                  const vd = new Date(y,m-1,d-1);
                  return (
                    <p>📌 Vigili: {vd.getDate()}/{vd.getMonth()+1} pukul {addMisaForm.vigili_jam} WIB</p>
                  );
                })()}
                <p>⛪ {addMisaForm.perayaan}: {addMisaForm.tanggal_tugas.split('-').reverse().join('/')} pukul {addMisaForm.slot_times?.join(', ')} WIB</p>
              </div>
            )}

            <div className="flex gap-2 mt-4">
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
