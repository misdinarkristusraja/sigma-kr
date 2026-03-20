import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, downloadCSV, hitungPoin } from '../lib/utils';
import { BarChart2, Download, TrendingUp, Calendar, RefreshCw, Info, Search } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';

// ─── Label ramah pengguna ─────────────────────────────────
const KONDISI_INFO = {
  K1: { label: 'Hadir Tugas & Latihan',  short: 'Hadir Lengkap',  poin: '+2', color: 'bg-green-100 text-green-800',  bar: '#22c55e' },
  K2: { label: 'Walk-in + Latihan',      short: 'Walk-in Aktif',  poin: '+3', color: 'bg-blue-100 text-blue-800',    bar: '#3b82f6' },
  K3: { label: 'Hadir Tugas (no Latih)', short: 'Hadir Tugas',    poin: '+1', color: 'bg-yellow-100 text-yellow-800',bar: '#eab308' },
  K4: { label: 'Walk-in saja',           short: 'Walk-in',        poin: '+1', color: 'bg-orange-100 text-orange-800',bar: '#f97316' },
  K5: { label: 'Latihan (skip Tugas)',   short: 'Hadir Latihan',  poin: '+1', color: 'bg-teal-100 text-teal-800',    bar: '#14b8a6' },
  K6: { label: 'Absen',                  short: 'Absen',          poin: '-1', color: 'bg-red-100 text-red-800',      bar: '#ef4444' },
};
const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

// ─── Helpers tanggal ──────────────────────────────────────
function toLocalISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function getWeekStartFromDate(dateStr) {
  if (!dateStr) return null;
  const [y,m,d] = dateStr.split('-').map(Number);
  const date = new Date(y, m-1, d);
  const dow  = date.getDay();
  const daysBack = dow === 6 ? 0 : (dow + 1);
  const sat = new Date(y, m-1, d - daysBack);
  return toLocalISO(sat);
}
function getWeekEndFromStart(ws) {
  const [y,m,d] = ws.split('-').map(Number);
  const end = new Date(y, m-1, d+6);
  return toLocalISO(end);
}
function dateCutoff(months) {
  if (!months) return null;
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return toLocalISO(d);
}

// ─── Raw count rekap (sesuai format Excel) ────────────────
// Jadwal = berapa kali dijadwalkan
// Latihan = berapa kali scan latihan valid
// Tugas = berapa kali scan tugas valid  
// Tukar = berapa kali mengajukan swap
function buildRawRekap({ assignments, scans, swaps, dateFrom, dateTo }) {
  // Jadwal = assignments yang BELUM di-replace
  const replacedIds = new Set(
    (swaps||[]).filter(sw=>sw.status==='Replaced'&&sw.assignment_id).map(sw=>sw.assignment_id)
  );
  const jadwal  = (assignments||[]).filter(a => {
    if (a.assignment_id && replacedIds.has(a.assignment_id)) return false;
    const tgl = a.tanggal_tugas || a.tanggal_latihan;
    if (!tgl) return false;
    if (dateFrom && tgl < dateFrom) return false;
    if (dateTo   && tgl > dateTo)   return false;
    return true;
  }).length;

  const latihan = (scans||[]).filter(s => {
    const ds = s.timestamp?.split('T')[0];
    if (!ds || (dateFrom && ds < dateFrom) || (dateTo && ds > dateTo)) return false;
    return s.scan_type === 'latihan' || s.scan_type === 'walkin_latihan';
  }).length;

  const tugas = (scans||[]).filter(s => {
    const ds = s.timestamp?.split('T')[0];
    if (!ds || (dateFrom && ds < dateFrom) || (dateTo && ds > dateTo)) return false;
    return s.scan_type === 'tugas' || s.scan_type === 'walkin_tugas';
  }).length;

  const tukar = (swaps||[]).filter(sw => {
    if (!sw.created_at) return true;
    const ds = sw.created_at.split('T')[0];
    if (dateFrom && ds < dateFrom) return false;
    if (dateTo   && ds > dateTo)   return false;
    return true;
  }).length;

  return { jadwal, latihan, tugas, tukar, total: jadwal + latihan + tugas };
}

// ─── Kalkulasi rekap real-time (K1-K6 poin) ──────────────
/**
 * buildRekap — kalkulasi real-time K1-K6 per minggu
 *
 * Logika urutan (sesuai request):
 * 1. Cek apakah user ada di assignments event minggu itu → isDijadwalkan
 * 2. Cek apakah assignment-nya sudah di-swap (replaced) → jika ya, bukan dijadwalkan
 * 3. Cek apakah ada scan tugas minggu itu → isHadirTugas
 * 4. Cek apakah ada scan latihan minggu itu → isHadirLatihan
 * 5. Walk-in: hadir tugas/latihan TAPI tidak ada di assignments → isWalkIn
 * 6. Apply hitungPoin K1-K6
 *
 * @param assignments  array { event_id, assignment_id, tanggal_tugas, tanggal_latihan }
 * @param scans        array { scan_type, timestamp, event_id }
 * @param swaps        array { assignment_id, status } — status 'Replaced' = user ditukar keluar
 * @param dateFrom     string YYYY-MM-DD filter mulai
 * @param dateTo       string YYYY-MM-DD filter akhir
 */
function buildRekap({ assignments, scans, swaps, dateFrom, dateTo }) {
  // ── Set event_id yang sudah di-swap keluar ───────────────
  // Jika swap.status = 'Replaced' & swap.assignment_id matches → user sudah digantikan
  const replacedAssignmentIds = new Set(
    (swaps || [])
      .filter(sw => sw.status === 'Replaced' && sw.assignment_id)
      .map(sw => sw.assignment_id)
  );

  // ── Set event_id yang user memang dijadwalkan (belum ditukar) ──
  const activeAssignmentEventIds = new Set();
  const assignmentByEventId = {};   // event_id → { tanggal_tugas, tanggal_latihan, assignment_id }

  (assignments || []).forEach(a => {
    if (!a || !a.event_id) return;
    // Skip jika assignment ini sudah di-replace
    if (a.assignment_id && replacedAssignmentIds.has(a.assignment_id)) return;
    activeAssignmentEventIds.add(a.event_id);
    assignmentByEventId[a.event_id] = a;
  });

  // ── Build weeks dari assignments aktif ──────────────────
  const weeks = {};

  const mkWeek = (ws) => ({
    week_start:       ws,
    week_end:         getWeekEndFromStart(ws),
    is_dijadwalkan:   false,
    is_hadir_tugas:   false,
    is_hadir_latihan: false,
    is_walk_in:       false,
  });

  // Pass 1 — minggu dari assignments yang aktif (tidak di-replace)
  Object.values(assignmentByEventId).forEach(a => {
    const tgl = a.tanggal_tugas || a.tanggal_latihan;
    if (!tgl || typeof tgl !== 'string') return;
    if (dateFrom && tgl < dateFrom) return;
    if (dateTo   && tgl > dateTo)   return;
    const ws = getWeekStartFromDate(tgl);
    if (!ws) return;
    if (!weeks[ws]) weeks[ws] = mkWeek(ws);
    weeks[ws].is_dijadwalkan = true;
  });

  // Pass 2 — scan records
  (scans || []).forEach(s => {
    if (!s) return;
    const dateStr = s.timestamp?.split('T')[0];
    if (!dateStr) return;
    if (dateFrom && dateStr < dateFrom) return;
    if (dateTo   && dateStr > dateTo)   return;
    const ws = getWeekStartFromDate(dateStr);
    if (!ws) return;
    if (!weeks[ws]) weeks[ws] = mkWeek(ws);

    const t = s.scan_type;
    const isTugas   = t === 'tugas'   || t === 'walkin_tugas';
    const isLatihan = t === 'latihan' || t === 'walkin_latihan';

    if (isLatihan) weeks[ws].is_hadir_latihan = true;
    if (isTugas)   weeks[ws].is_hadir_tugas   = true;

    // ── Walk-in detection ───────────────────────────────
    // Walk-in = hadir tugas/latihan TAPI event_id scan tidak ada di assignments aktif
    // ATAU scan_type sudah walkin_* (manual override scanner)
    if (t === 'walkin_tugas' || t === 'walkin_latihan') {
      weeks[ws].is_walk_in = true;
    } else if (s.event_id && !activeAssignmentEventIds.has(s.event_id)) {
      // Punya scan di event ini tapi TIDAK ada di assignment event ini → walk-in
      weeks[ws].is_walk_in = true;
    } else if (!s.event_id && !weeks[ws].is_dijadwalkan) {
      // Scan tanpa event_id dan minggu ini tidak dijadwalkan → walk-in
      weeks[ws].is_walk_in = true;
    }
  });

  // Pass 3 — hitung K1-K6
  return Object.values(weeks)
    .map(w => {
      const { poin, kondisi } = hitungPoin({
        isDijadwalkan:  w.is_dijadwalkan,
        isHadirTugas:   w.is_hadir_tugas,
        isHadirLatihan: w.is_hadir_latihan,
        isWalkIn:       w.is_walk_in,
      });
      return { ...w, poin, kondisi };
    })
    .filter(w => w.kondisi !== null)
    .sort((a, b) => b.week_start.localeCompare(a.week_start));
}

// ═════════════════════════════════════════════════════════
export default function RecapPage() {
  const { profile, isPengurus } = useAuth();

  const [tab,      setTab]    = useState('personal');
  const [loading,  setLoading]= useState(true);

  // Filter personal
  const [selUser,   setSelUser]  = useState(null);
  const [dateFrom,  setDateFrom] = useState(dateCutoff(3)); // default 3 bulan
  const [dateTo,    setDateTo]   = useState(toLocalISO(new Date()));
  const [searchName,setSearch]   = useState('');

  // Data
  const [rekapMinggu, setRekap]   = useState([]);
  const [rekapHarian, setHarian]  = useState([]);
  const [memberList,  setMembers] = useState([]);
  const [allRekap,    setAllRekap]= useState([]);
  const [allLoading,  setAllLoad] = useState(false);
  const [lastUpdate,  setLastUpd] = useState(null);
  const [rawRekap,    setRawRekap] = useState(null);  // { jadwal, latihan, tugas, tukar }

  // Load member list
  useEffect(() => {
    if (!isPengurus) return;
    supabase.from('users').select('id, nama_panggilan, lingkungan')
      .eq('status','Active')
      .in('role', ['Misdinar_Aktif','Misdinar_Retired'])
      .order('nama_panggilan')
      .then(({ data }) => setMembers(data || []));
  }, [isPengurus]);

  // ── Load personal rekap (real-time) ──────────────────
  const loadPersonal = useCallback(async () => {
    const uid = selUser || profile?.id;
    if (!uid) return;
    setLoading(true);

    // Ambil semua data yang dibutuhkan sekaligus
    const [{ data: assigns }, { data: scans }, { data: swapsData }, { data: userProfile }] = await Promise.all([
      // assignments: include id (assignment_id) + event dates
      supabase.from('assignments')
        .select('id, event_id, events(tanggal_tugas, tanggal_latihan, tipe_event, is_draft)')
        .eq('user_id', uid),
      // scans: include event_id untuk cross-reference walk-in
      supabase.from('scan_records')
        .select('scan_type, timestamp, is_walk_in, event_id')
        .eq('user_id', uid)
        .order('timestamp', { ascending: false }),
      // swaps: assignment_id untuk tahu apakah assignment di-replace
      supabase.from('swap_requests')
        .select('assignment_id, status, created_at')
        .eq('requester_id', uid),
      // user role — untuk skip rekap jika admin/pengurus
      supabase.from('users').select('role').eq('id', uid).single(),
    ]);

    // Skip rekap untuk staff (admin/pengurus/pelatih tidak punya rekap kehadiran)
    const userRole = userProfile?.role || '';
    const isStaff  = ['Administrator','Pengurus','Pelatih'].includes(userRole);

    // Filter: hanya event mingguan yang bukan draft
    const filteredAssigns = (assigns || [])
      .filter(a => a.events && a.events.tipe_event !== 'Misa_Harian' && !a.events.is_draft)
      .map(a => ({
        event_id:       a.event_id,
        assignment_id:  a.id,         // ← penting untuk deteksi swap
        tanggal_tugas:  a.events.tanggal_tugas,
        tanggal_latihan:a.events.tanggal_latihan,
      }));

    const rekap  = isStaff ? [] : buildRekap({
      assignments: filteredAssigns,
      scans:       scans || [],
      swaps:       swapsData || [],
      dateFrom,
      dateTo,
    });
    const harian = buildRekapHarian(scans || [], dateFrom, dateTo);

    // Raw rekap counts (sesuai format Excel)
    const raw = buildRawRekap({
      assignments: filteredAssigns,
      scans:       scans || [],
      swaps:       swapsData || [],
      dateFrom,
      dateTo,
    });
    if (isStaff) { setLoading(false); return; } // Staff tidak punya rekap

    setRekap(rekap);
    setHarian(harian);
    setRawRekap(raw);
    setLastUpd(new Date());
    setLoading(false);
  }, [selUser, profile?.id, dateFrom, dateTo]);

  useEffect(() => { if (tab === 'personal') loadPersonal(); }, [tab, loadPersonal]);

  // ── Load semua anggota ────────────────────────────────
  async function loadAll() {
    setAllLoad(true);
    const { data: members } = await supabase.from('users')
      .select('id, nama_panggilan, lingkungan, pendidikan')
      .eq('status','Active')
      .in('role', ['Misdinar_Aktif','Misdinar_Retired'])
      .order('nama_panggilan');
    if (!members?.length) { setAllLoad(false); return; }

    const [{ data: allAssigns }, { data: allScans }, { data: allSwaps }] = await Promise.all([
      // NO nested filter — filter in JS to avoid Supabase join filter bug
      supabase.from('assignments')
        .select('id, user_id, event_id, events(tanggal_tugas, tanggal_latihan, tipe_event, is_draft)'),
      // Load ALL scans — let buildRekap filter by dateFrom/dateTo in JS
      // Same as loadPersonal — this ensures consistent results
      supabase.from('scan_records')
        .select('user_id, scan_type, timestamp, is_walk_in, event_id'),
      supabase.from('swap_requests')
        .select('requester_id, assignment_id, status'),
    ]);

    // Group
    const aMap = {}, sMap = {};
    const swapMap = {};
    members.forEach(m => { aMap[m.id] = []; sMap[m.id] = []; swapMap[m.id] = []; });
    (allSwaps||[]).forEach(sw => { if (swapMap[sw.requester_id]) swapMap[sw.requester_id].push(sw); });
    (allAssigns||[]).filter(a=>a.events && !a.events.is_draft).forEach(a => {
      if (aMap[a.user_id]) aMap[a.user_id].push({
        event_id:        a.event_id,
        assignment_id:   a.id,
        tanggal_tugas:   a.events.tanggal_tugas,
        tanggal_latihan: a.events.tanggal_latihan,
      });
    });
    (allScans||[]).forEach(s => { if (sMap[s.user_id]) sMap[s.user_id].push(s); });

    const result = members.map(m => {
      const rows  = buildRekap({ assignments: aMap[m.id], scans: sMap[m.id], swaps: swapMap[m.id] || [], dateFrom, dateTo });
      const total = rows.reduce((s,r) => s+(r.poin||0), 0);
      const k6    = rows.filter(r => r.kondisi === 'K6').length;
      const hadir = rows.filter(r => r.is_hadir_tugas || r.is_hadir_latihan).length;
      return { ...m, rows, totalPoin: total, k6, hadir, minggu: rows.length };
    });
    setAllRekap(result);
    setAllLoad(false);
  }
  useEffect(() => { if (tab === 'all') loadAll(); }, [tab, dateFrom, dateTo]);

  // ── Rekap harian helper ────────────────────────────────
  function buildRekapHarian(scans, from, to) {
    const months = {};
    scans.filter(s => (s.scan_type === 'tugas' || s.scan_type === 'walkin_tugas') && s.event_id)
      .forEach(s => {
        const ds = s.timestamp?.split('T')[0];
        if (!ds || (from && ds < from) || (to && ds > to)) return;
        const [y, m] = ds.split('-').map(Number);
        const key = `${y}-${m}`;
        if (!months[key]) months[key] = { tahun: y, bulan: m, count: 0 };
        months[key].count++;
      });
    return Object.values(months).sort((a,b) => b.tahun-a.tahun || b.bulan-a.bulan);
  }

  // ── Derived ───────────────────────────────────────────
  const totalPoin  = rekapMinggu.reduce((s,r) => s+(r.poin||0), 0);
  const hadirCount = rekapMinggu.filter(r => r.is_hadir_tugas || r.is_hadir_latihan).length;
  const k6Count    = rekapMinggu.filter(r => r.kondisi === 'K6').length;
  const kondisiCnt = Object.fromEntries(['K1','K2','K3','K4','K5','K6'].map(k => [k, rekapMinggu.filter(r=>r.kondisi===k).length]));

  const chartData = [...rekapMinggu].reverse().slice(-16).map(r => ({
    week: formatDate(r.week_start, 'dd/MM'), poin: r.poin||0, kondisi: r.kondisi,
  }));

  // Filter all by search
  const filteredAll = allRekap.filter(m => !searchName ||
    m.nama_panggilan?.toLowerCase().includes(searchName.toLowerCase()) ||
    m.lingkungan?.toLowerCase().includes(searchName.toLowerCase())
  );

  function handleExport() {
    downloadCSV(
      rekapMinggu.map(r => ({
        minggu_mulai: r.week_start, minggu_selesai: r.week_end,
        kondisi: r.kondisi, kondisi_label: KONDISI_INFO[r.kondisi]?.label,
        poin: r.poin, dijadwalkan: r.is_dijadwalkan?'Ya':'Tidak',
        hadir_tugas: r.is_hadir_tugas?'Ya':'Tidak',
        hadir_latihan: r.is_hadir_latihan?'Ya':'Tidak',
        walk_in: r.is_walk_in?'Ya':'Tidak',
      })),
      ['minggu_mulai','minggu_selesai','kondisi','kondisi_label','poin','dijadwalkan','hadir_tugas','hadir_latihan','walk_in']
        .map(k => ({ key:k, label:k })),
      `rekap-${profile?.nickname}-${Date.now()}.csv`
    );
  }

  // ── Preset filter period ──────────────────────────────
  function setPeriod(months) {
    setDateFrom(months ? dateCutoff(months) : '2020-01-01');
    setDateTo(toLocalISO(new Date()));
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Rekap & Poin</h1>
          <p className="page-subtitle">
            Real-time dari scan & jadwal
            {lastUpdate && <span className="ml-2 text-gray-400 text-xs">· {lastUpdate.toLocaleTimeString('id')}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadPersonal} className="btn-ghost p-2"><RefreshCw size={16}/></button>
          <button onClick={handleExport} className="btn-outline gap-2"><Download size={16}/> CSV</button>
        </div>
      </div>

      {/* Tabs */}
      {isPengurus && (
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {[{key:'personal',label:'Pribadi'},{key:'all',label:'Semua Anggota'}].map(t=>(
            <button key={t.key} onClick={()=>setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab===t.key?'bg-white text-brand-800 shadow-sm':'text-gray-500'}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ─── Filter bar (shared) ─── */}
      <div className="flex gap-3 flex-wrap items-center">
        {/* Preset period */}
        <div className="flex gap-1 flex-wrap">
          {[
            {label:'1 Bln',  months:1},
            {label:'3 Bln',  months:3},
            {label:'6 Bln',  months:6},
            {label:'1 Tahun',months:12},
            {label:'Semua',  months:null},
          ].map(p=>(
            <button key={p.label}
              onClick={()=>setPeriod(p.months)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                dateFrom === (p.months ? dateCutoff(p.months) : '2020-01-01')
                  ? 'bg-brand-800 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        {/* Rentang tanggal custom */}
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <span>Dari</span>
          <input type="date" className="input input-sm text-xs w-32" value={dateFrom || ''} onChange={e=>setDateFrom(e.target.value)}/>
          <span>–</span>
          <input type="date" className="input input-sm text-xs w-32" value={dateTo || ''} onChange={e=>setDateTo(e.target.value)}/>
        </div>
        {/* Pilih user (personal tab + pengurus) */}
        {tab === 'personal' && isPengurus && (
          <select className="input w-auto text-sm" value={selUser || ''} onChange={e=>setSelUser(e.target.value||null)}>
            <option value="">Data Saya</option>
            {memberList.map(m=><option key={m.id} value={m.id}>{m.nama_panggilan}</option>)}
          </select>
        )}
        {/* Search (all tab) */}
        {tab === 'all' && (
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input className="input pl-8 text-sm w-44" placeholder="Cari nama..."
              value={searchName} onChange={e=>setSearch(e.target.value)}/>
          </div>
        )}
      </div>

      {/* ─── TAB PERSONAL ─── */}
      {tab === 'personal' && (
        <>
          {loading ? (
            <div className="space-y-3">{[1,2,3].map(i=><div key={i} className="skeleton h-16 rounded-xl"/>)}</div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label:'Total Poin',     val: totalPoin > 0 ? '+'+totalPoin : totalPoin, color: totalPoin>0?'text-green-700':totalPoin<0?'text-red-700':'text-gray-400', bg:'bg-green-50' },
                  { label:'Hadir',          val: hadirCount,  color:'text-blue-700',  bg:'bg-blue-50' },
                  { label:'Absen (K6)',     val: k6Count,     color:'text-red-700',   bg:'bg-red-50' },
                  { label:'Total Minggu',   val: rekapMinggu.length, color:'text-gray-700', bg:'bg-gray-50' },
                ].map(c=>(
                  <div key={c.label} className={`card ${c.bg} border-0 text-center`}>
                    <div className={`text-3xl font-black ${c.color}`}>{c.val}</div>
                    <div className="text-xs text-gray-600 mt-1">{c.label}</div>
                  </div>
                ))}
              </div>

              {/* Raw rekap counts — sesuai format Excel */}
              {rawRekap && (
                <div className="card">
                  <h3 className="font-semibold text-gray-700 mb-3 text-sm">📋 Rekap Kehadiran</h3>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: 'Dijadwalkan', val: rawRekap.jadwal,  color: 'bg-brand-50 text-brand-800',   icon: '📅' },
                      { label: 'Hadir Latihan',val: rawRekap.latihan, color: 'bg-blue-50 text-blue-700',    icon: '🏋️' },
                      { label: 'Hadir Tugas',  val: rawRekap.tugas,   color: 'bg-green-50 text-green-700',  icon: '⛪' },
                      { label: 'Tukar Jadwal', val: rawRekap.tukar,   color: 'bg-purple-50 text-purple-700',icon: '🔄' },
                    ].map(c => (
                      <div key={c.label} className={`${c.color} rounded-xl p-3 text-center`}>
                        <div className="text-lg">{c.icon}</div>
                        <div className="text-2xl font-black mt-1">{c.val}</div>
                        <div className="text-xs mt-0.5 font-medium opacity-80">{c.label}</div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    Total partisipasi: <strong>{rawRekap.jadwal + rawRekap.latihan + rawRekap.tugas}</strong> kali
                    {rawRekap.jadwal > 0 && rawRekap.tugas > 0 && (
                      <span className="ml-2">· Tingkat kehadiran tugas: <strong>{Math.round(rawRekap.tugas/rawRekap.jadwal*100)}%</strong></span>
                    )}
                  </p>
                </div>
              )}

              {/* Breakdown kondisi — label ramah */}
              <div className="card">
                <h3 className="font-semibold text-gray-700 mb-3 text-sm">Rincian Kehadiran</h3>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {['K1','K2','K3','K4','K5','K6'].map(k=>{
                    const info = KONDISI_INFO[k];
                    const cnt  = kondisiCnt[k]||0;
                    return (
                      <div key={k} className={`p-3 rounded-xl text-center ${info.color} ${cnt===0?'opacity-40':''}`}>
                        <div className="text-2xl font-black">{cnt}</div>
                        <div className="text-xs font-bold mt-0.5">{info.short}</div>
                        <div className="text-[10px] opacity-60">{info.poin}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Chart */}
              {chartData.length > 0 && (
                <div className="card">
                  <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <TrendingUp size={15} className="text-brand-800"/> Grafik Poin
                  </h3>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={chartData} barSize={18}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0"/>
                      <XAxis dataKey="week" tick={{fontSize:10,fill:'#9ca3af'}}/>
                      <YAxis tick={{fontSize:10,fill:'#9ca3af'}} domain={[-2,4]}/>
                      <Tooltip formatter={(v,_,{payload})=>[`${v>0?'+':''}${v} (${KONDISI_INFO[payload.kondisi]?.short||'—'})`,'Poin']}
                        contentStyle={{borderRadius:8,fontSize:12}}/>
                      <Bar dataKey="poin" radius={[4,4,0,0]}>
                        {chartData.map((d,i)=><Cell key={i} fill={KONDISI_INFO[d.kondisi]?.bar||'#e5e7eb'}/>)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Rekap harian */}
              {rekapHarian.length > 0 && (
                <div className="card">
                  <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <Calendar size={15} className="text-brand-800"/> Rekap Misa Harian
                  </h3>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {rekapHarian.map((h,i)=>(
                      <div key={i} className="text-center p-2 bg-gray-50 rounded-xl">
                        <div className="text-lg font-bold text-brand-800">{h.count}×</div>
                        <div className="text-[10px] text-gray-500">{MONTH_NAMES[h.bulan]} {h.tahun}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tabel detail */}
              <div className="card overflow-hidden p-0">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-700">Riwayat Mingguan</h3>
                  <span className="text-xs text-gray-400">{rekapMinggu.length} minggu</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Periode</th><th>Status</th><th>Dijadwalkan</th>
                        <th>Hadir Tugas</th><th>Hadir Latihan</th><th>Poin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rekapMinggu.length===0 ? (
                        <tr><td colSpan={6} className="text-center py-8 text-gray-400">Tidak ada data pada rentang ini</td></tr>
                      ) : rekapMinggu.map((r,i)=>{
                        const ki = KONDISI_INFO[r.kondisi];
                        return (
                          <tr key={i}>
                            <td className="text-xs text-gray-500 whitespace-nowrap">
                              {formatDate(r.week_start,'dd MMM')} – {formatDate(r.week_end,'dd MMM')}
                            </td>
                            <td>
                              {ki ? (
                                <span className={`badge text-xs ${ki.color}`}>{ki.short}</span>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="text-center">{r.is_dijadwalkan?'✓':'—'}</td>
                            <td className="text-center">{r.is_hadir_tugas?'✓':r.is_walk_in?'↑':'—'}</td>
                            <td className="text-center">{r.is_hadir_latihan?'✓':'—'}</td>
                            <td>
                              <span className={`font-bold ${r.poin>0?'text-green-600':r.poin<0?'text-red-600':'text-gray-400'}`}>
                                {r.poin>0?'+':''}{r.poin??0}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ─── TAB ALL ─── */}
      {tab === 'all' && isPengurus && (
        <div className="card overflow-hidden p-0">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold text-gray-700">Rekap Semua Anggota</h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{filteredAll.length} anggota</span>
              <button onClick={loadAll} className="btn-ghost p-1.5" title="Refresh"><RefreshCw size={14}/></button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl text-xs">
              <thead>
                <tr>
                  <th className="w-8">#</th>
                  <th>Nama</th>
                  <th>Lingkungan</th>
                  <th>Poin</th>
                  <th title="Hadir Lengkap (K1)">K1</th>
                  <th title="Walk-in+Latihan (K2)">K2</th>
                  <th title="Hadir Tugas saja (K3)">K3</th>
                  <th title="Walk-in saja (K4)">K4</th>
                  <th title="Latihan saja (K5)">K5</th>
                  <th title="Absen (K6)" className="text-red-600">K6</th>
                  <th>Hadir</th>
                  <th>Minggu</th>
                </tr>
              </thead>
              <tbody>
                {allLoading ? (
                  <tr><td colSpan={12} className="text-center py-8 text-gray-400">Menghitung rekap semua anggota...</td></tr>
                ) : filteredAll.sort((a,b)=>b.totalPoin-a.totalPoin).map((m,i)=>{
                  // Compute K1-K6 counts from rows
                  const kCounts = {};
                  ['K1','K2','K3','K4','K5','K6'].forEach(k => {
                    kCounts[k] = (m.rows||[]).filter(r=>r.kondisi===k).length;
                  });
                  return (
                    <tr key={m.id}>
                      <td className="text-gray-400 font-mono">{i+1}</td>
                      <td className="font-semibold text-gray-900">{m.nama_panggilan}</td>
                      <td className="text-gray-500">{m.lingkungan}</td>
                      <td>
                        <span className={`font-black text-sm ${m.totalPoin>0?'text-green-600':m.totalPoin<0?'text-red-600':'text-gray-400'}`}>
                          {m.totalPoin>0?'+':''}{m.totalPoin}
                        </span>
                      </td>
                      <td className="text-center">{kCounts.K1>0?<span className="text-green-600 font-bold">{kCounts.K1}</span>:'—'}</td>
                      <td className="text-center">{kCounts.K2>0?<span className="text-blue-600 font-bold">{kCounts.K2}</span>:'—'}</td>
                      <td className="text-center">{kCounts.K3>0?<span className="text-yellow-600 font-bold">{kCounts.K3}</span>:'—'}</td>
                      <td className="text-center">{kCounts.K4>0?<span className="text-orange-500 font-bold">{kCounts.K4}</span>:'—'}</td>
                      <td className="text-center">{kCounts.K5>0?<span className="text-teal-600 font-bold">{kCounts.K5}</span>:'—'}</td>
                      <td className="text-center">{kCounts.K6>0?<span className="text-red-600 font-bold">{kCounts.K6}</span>:'—'}</td>
                      <td className="text-center text-gray-600">{m.hadir}</td>
                      <td className="text-center text-gray-400">{m.minggu}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Formula reference */}
      <div className="card bg-gray-50">
        <h3 className="font-semibold text-gray-700 mb-3 text-sm">📊 Keterangan Status Kehadiran</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.entries(KONDISI_INFO).map(([k,v])=>(
            <div key={k} className={`p-2.5 rounded-xl ${v.color} flex items-center justify-between gap-2`}>
              <div>
                <span className="font-bold text-xs">{v.short}</span>
                <span className="ml-1.5 text-[10px] opacity-70">{v.label}</span>
              </div>
              <span className="font-black">{v.poin}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
