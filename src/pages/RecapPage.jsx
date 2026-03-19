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
  K5: { label: 'Latihan (skip Tugas)',   short: 'Hadir Latihan',  poin:  '0', color: 'bg-teal-100 text-teal-800',    bar: '#14b8a6' },
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

// ─── Kalkulasi rekap real-time ────────────────────────────
function buildRekap({ assignments, scans, dateFrom, dateTo }) {
  const weeks = {};

  // Tambahkan minggu dari assignments (dijadwalkan)
  // Hanya proses jika assignments adalah array yang valid
  (assignments || []).forEach(a => {
    if (!a) return;
    const tgl = a.tanggal_tugas || a.tanggal_latihan;
    if (!tgl || typeof tgl !== 'string') return;
    if (dateFrom && tgl < dateFrom) return;
    if (dateTo   && tgl > dateTo)   return;
    const ws = getWeekStartFromDate(tgl);
    if (!ws) return;
    if (!weeks[ws]) weeks[ws] = { week_start: ws, week_end: getWeekEndFromStart(ws), is_dijadwalkan: false, is_hadir_tugas: false, is_hadir_latihan: false, is_walk_in: false };
    weeks[ws].is_dijadwalkan = true;
  });

  // Tambahkan minggu dari scans (hadir)
  (scans || []).forEach(s => {
    if (!s) return;
    const dateStr = s.timestamp?.split('T')[0];
    if (!dateStr) return;
    if (dateFrom && dateStr < dateFrom) return;
    if (dateTo   && dateStr > dateTo)   return;
    const ws = getWeekStartFromDate(dateStr);
    if (!ws) return;
    if (!weeks[ws]) weeks[ws] = { week_start: ws, week_end: getWeekEndFromStart(ws), is_dijadwalkan: false, is_hadir_tugas: false, is_hadir_latihan: false, is_walk_in: false };
    const type = s.scan_type;
    if (type === 'tugas')          { weeks[ws].is_hadir_tugas   = true; }
    if (type === 'latihan')        { weeks[ws].is_hadir_latihan = true; }
    if (type === 'walkin_tugas')   { weeks[ws].is_hadir_tugas   = true; weeks[ws].is_walk_in = true; }
    if (type === 'walkin_latihan') { weeks[ws].is_hadir_latihan = true; weeks[ws].is_walk_in = true; }
  });

  // Hitung poin & kondisi, filter out null
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
    .filter(w => w.kondisi !== null)  // Hanya minggu yang ada aktivitas bermakna
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

    // PENTING: ambil assignments TANPA nested filter tanggal
    // lalu filter manual di JS → tidak ada false-negative
    const [{ data: assigns }, { data: scans }] = await Promise.all([
      supabase.from('assignments')
        .select('event_id, events(tanggal_tugas, tanggal_latihan, tipe_event, status_event)')
        .eq('user_id', uid),
      supabase.from('scan_records')
        .select('scan_type, timestamp, is_walk_in, event_id')
        .eq('user_id', uid)
        .order('timestamp', { ascending: false }),
    ]);

    // Filter: hanya event non-Harian, status bukan draft
    const filteredAssigns = (assigns || [])
      .filter(a => a.events && a.events.tipe_event !== 'Misa_Harian')
      .map(a => ({ tanggal_tugas: a.events.tanggal_tugas, tanggal_latihan: a.events.tanggal_latihan }));

    const rekap  = buildRekap({ assignments: filteredAssigns, scans: scans || [], dateFrom, dateTo });
    const harian = buildRekapHarian(scans || [], dateFrom, dateTo);

    setRekap(rekap);
    setHarian(harian);
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

    const [{ data: allAssigns }, { data: allScans }] = await Promise.all([
      supabase.from('assignments')
        .select('user_id, events(tanggal_tugas, tanggal_latihan, tipe_event)')
        .not('events.tipe_event', 'eq', 'Misa_Harian'),
      supabase.from('scan_records')
        .select('user_id, scan_type, timestamp, is_walk_in, event_id')
        .gte('timestamp', (dateFrom || dateCutoff(3)) + 'T00:00:00'),
    ]);

    // Group
    const aMap = {}, sMap = {};
    members.forEach(m => { aMap[m.id] = []; sMap[m.id] = []; });
    (allAssigns||[]).filter(a=>a.events).forEach(a => {
      if (aMap[a.user_id]) aMap[a.user_id].push({ tanggal_tugas: a.events.tanggal_tugas, tanggal_latihan: a.events.tanggal_latihan });
    });
    (allScans||[]).forEach(s => { if (sMap[s.user_id]) sMap[s.user_id].push(s); });

    const result = members.map(m => {
      const rows  = buildRekap({ assignments: aMap[m.id], scans: sMap[m.id], dateFrom, dateTo });
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
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-700">Rekap Semua Anggota</h3>
            <button onClick={loadAll} className="btn-ghost p-1.5"><RefreshCw size={14}/></button>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr><th>#</th><th>Nama</th><th>Lingkungan</th><th>Total Poin</th><th>Hadir</th><th>Absen</th><th>Minggu</th></tr>
              </thead>
              <tbody>
                {allLoading ? (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-400">Menghitung...</td></tr>
                ) : filteredAll.sort((a,b)=>b.totalPoin-a.totalPoin).map((m,i)=>(
                  <tr key={m.id}>
                    <td className="text-gray-400 text-xs">{i+1}</td>
                    <td className="font-semibold text-gray-900">{m.nama_panggilan}</td>
                    <td className="text-gray-500 text-xs">{m.lingkungan}</td>
                    <td>
                      <span className={`font-bold ${m.totalPoin>0?'text-green-600':m.totalPoin<0?'text-red-600':'text-gray-400'}`}>
                        {m.totalPoin>0?'+':''}{m.totalPoin}
                      </span>
                    </td>
                    <td className="text-center text-sm">{m.hadir}</td>
                    <td className="text-center text-sm">{m.k6>0?<span className="text-red-600 font-bold">{m.k6}</span>:'—'}</td>
                    <td className="text-center text-xs text-gray-400">{m.minggu}</td>
                  </tr>
                ))}
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
