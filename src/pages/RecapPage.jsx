import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, downloadCSV, hitungPoin } from '../lib/utils';
import { BarChart2, Download, TrendingUp, Calendar, RefreshCw, Info } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';

// ─── Konstanta ────────────────────────────────────────────
const KONDISI_INFO = {
  K1: { label: 'Dijadwal + Tugas + Latihan', poin: '+2', color: 'bg-green-100 text-green-800',  bar: '#22c55e' },
  K2: { label: 'Walk-in + Latihan',          poin: '+3', color: 'bg-blue-100 text-blue-800',    bar: '#3b82f6' },
  K3: { label: 'Dijadwal + Tugas',           poin: '+1', color: 'bg-yellow-100 text-yellow-800',bar: '#eab308' },
  K4: { label: 'Walk-in saja',               poin: '+2', color: 'bg-orange-100 text-orange-800',bar: '#f97316' },
  K5: { label: 'Latihan saja',               poin: '+1', color: 'bg-teal-100 text-teal-800',    bar: '#14b8a6' },
  K6: { label: 'Absen (Dijadwal)',            poin: '-1', color: 'bg-red-100 text-red-800',      bar: '#ef4444' },
};

const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

// ─── Hitung week_start dari tanggal scan ─────────────────
// Periode: Sabtu 07:00 WIB — Minggu+7 06:59 WIB
function getWeekStartFromDate(dateStr) {
  // Parse local date (avoid timezone shift)
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dow  = date.getDay(); // 0=Sun 6=Sat
  // Mundur ke Sabtu terdekat
  const daysBack = dow === 6 ? 0 : (dow + 1);
  const sat = new Date(y, m - 1, d - daysBack);
  return `${sat.getFullYear()}-${String(sat.getMonth()+1).padStart(2,'0')}-${String(sat.getDate()).padStart(2,'0')}`;
}

function getWeekEndFromStart(startStr) {
  const [y, m, d] = startStr.split('-').map(Number);
  const end = new Date(y, m - 1, d + 6);
  return `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;
}

// ─── Hitung rekap real-time dari raw data ─────────────────
function hitungRekapRealtime({ assignments, scans }) {
  // Kumpulkan semua week_start yang relevan
  const weekSet = new Set();

  // Dari assignments (dijadwalkan)
  assignments.forEach(a => {
    if (a.events?.tanggal_tugas) {
      weekSet.add(getWeekStartFromDate(a.events.tanggal_tugas));
    }
    // Slot 1 = Sabtu, tanggal_latihan adalah periode yang sama
    if (a.events?.tanggal_latihan) {
      weekSet.add(getWeekStartFromDate(a.events.tanggal_latihan));
    }
  });

  // Dari scan records
  scans.forEach(s => {
    const dateStr = s.timestamp.split('T')[0];
    weekSet.add(getWeekStartFromDate(dateStr));
  });

  // Build map: weekStart → data
  const weeks = {};
  weekSet.forEach(ws => {
    const we = getWeekEndFromStart(ws);
    weeks[ws] = {
      week_start:       ws,
      week_end:         we,
      is_dijadwalkan:   false,
      is_hadir_tugas:   false,
      is_hadir_latihan: false,
      is_walk_in:       false,
      poin:             0,
      kondisi:          null,
    };
  });

  // Isi is_dijadwalkan dari assignments
  assignments.forEach(a => {
    const tgl = a.events?.tanggal_tugas || a.events?.tanggal_latihan;
    if (!tgl) return;
    const ws = getWeekStartFromDate(tgl);
    if (weeks[ws]) weeks[ws].is_dijadwalkan = true;
  });

  // Isi kehadiran dari scans
  scans.forEach(s => {
    const dateStr = s.timestamp.split('T')[0];
    const ws = getWeekStartFromDate(dateStr);
    if (!weeks[ws]) return;

    const type = s.scan_type;
    if (type === 'tugas')          { weeks[ws].is_hadir_tugas   = true; }
    if (type === 'latihan')        { weeks[ws].is_hadir_latihan = true; }
    if (type === 'walkin_tugas')   { weeks[ws].is_hadir_tugas   = true; weeks[ws].is_walk_in = true; }
    if (type === 'walkin_latihan') { weeks[ws].is_hadir_latihan = true; weeks[ws].is_walk_in = true; }
  });

  // Hitung poin & kondisi tiap minggu
  Object.values(weeks).forEach(w => {
    const result = hitungPoin({
      isDijadwalkan:  w.is_dijadwalkan,
      isHadirTugas:   w.is_hadir_tugas,
      isHadirLatihan: w.is_hadir_latihan,
      isWalkIn:       w.is_walk_in,
    });
    w.poin    = result.poin;
    w.kondisi = result.kondisi;
  });

  // Urutkan terbaru dulu
  return Object.values(weeks)
    .filter(w => w.kondisi !== null) // hanya minggu yang ada aktivitas
    .sort((a, b) => b.week_start.localeCompare(a.week_start));
}

// ─── Hitung rekap harian dari scans ──────────────────────
function hitungRekapHarian(scans) {
  const months = {};
  scans
    .filter(s => s.scan_type === 'tugas' || s.scan_type === 'walkin_tugas')
    .forEach(s => {
      // Hanya scan yang terkait Misa Harian
      if (!s.event_id) return; // skip scan tanpa event
      const [y, m] = s.timestamp.split('T')[0].split('-').map(Number);
      const key = `${y}-${m}`;
      if (!months[key]) months[key] = { tahun: y, bulan: m, count: 0 };
      months[key].count++;
    });
  return Object.values(months).sort((a, b) => b.tahun - a.tahun || b.bulan - a.bulan);
}

// ═════════════════════════════════════════════════════════
export default function RecapPage() {
  const { profile, isPengurus } = useAuth();

  const [tab,       setTab]      = useState('personal');
  const [selUser,   setSelUser]  = useState(null);
  const [period,    setPeriod]   = useState('6');     // bulan
  const [loading,   setLoading]  = useState(true);
  const [lastUpdate,setLastUpd]  = useState(null);

  // Data personal
  const [rekapMinggu, setRekapMinggu] = useState([]);
  const [rekapHarian, setRekapHarian] = useState([]);

  // Data semua anggota (tab all)
  const [allMembers, setAllMembers] = useState([]);
  const [allRekap,   setAllRekap]   = useState({}); // { userId: [rekapRows] }
  const [allLoading, setAllLoading] = useState(false);

  // Load members untuk dropdown
  const [memberList, setMemberList] = useState([]);
  useEffect(() => {
    if (!isPengurus) return;
    supabase.from('users').select('id, nama_panggilan, lingkungan')
      .eq('status','Active').order('nama_panggilan')
      .then(({ data }) => setMemberList(data || []));
  }, [isPengurus]);

  // ── Load & kalkulasi real-time ────────────────────────
  const loadPersonal = useCallback(async () => {
    const uid = selUser || profile?.id;
    if (!uid) return;
    setLoading(true);

    const cutoff = (() => {
      if (period === 'all') return '2020-01-01';
      const d = new Date();
      d.setMonth(d.getMonth() - parseInt(period));
      return d.toISOString().split('T')[0];
    })();

    // Ambil assignments sejak cutoff
    const { data: assigns } = await supabase
      .from('assignments')
      .select('id, slot_number, event_id, events(tanggal_tugas, tanggal_latihan, tipe_event)')
      .eq('user_id', uid)
      .gte('events.tanggal_tugas', cutoff)
      .not('events.tipe_event', 'eq', 'Misa_Harian');

    // Ambil scan records sejak cutoff
    const { data: scans } = await supabase
      .from('scan_records')
      .select('scan_type, timestamp, is_walk_in, event_id')
      .eq('user_id', uid)
      .gte('timestamp', cutoff + 'T00:00:00');

    // Kalkulasi real-time
    const rekap  = hitungRekapRealtime({ assignments: assigns || [], scans: scans || [] });
    const harian = hitungRekapHarian(scans || []);

    setRekapMinggu(rekap);
    setRekapHarian(harian);
    setLastUpd(new Date());
    setLoading(false);
  }, [selUser, profile?.id, period]);

  useEffect(() => {
    if (tab === 'personal') loadPersonal();
  }, [tab, loadPersonal]);

  // ── Load semua anggota (tab all) ─────────────────────
  async function loadAllRekap() {
    setAllLoading(true);
    const { data: members } = await supabase
      .from('users')
      .select('id, nama_panggilan, lingkungan, pendidikan')
      .eq('status', 'Active').order('nama_panggilan');

    if (!members?.length) { setAllLoading(false); return; }
    setAllMembers(members);

    // Batch: ambil semua assignments + scans sekaligus
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 3);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const [{ data: assigns }, { data: scans }] = await Promise.all([
      supabase.from('assignments')
        .select('user_id, slot_number, events(tanggal_tugas, tanggal_latihan, tipe_event)')
        .gte('events.tanggal_tugas', cutoffStr)
        .not('events.tipe_event', 'eq', 'Misa_Harian'),
      supabase.from('scan_records')
        .select('user_id, scan_type, timestamp, is_walk_in, event_id')
        .gte('timestamp', cutoffStr + 'T00:00:00'),
    ]);

    // Group by user
    const assignsByUser = {};
    const scansByUser   = {};
    members.forEach(m => { assignsByUser[m.id] = []; scansByUser[m.id] = []; });
    (assigns || []).forEach(a => { if (assignsByUser[a.user_id]) assignsByUser[a.user_id].push(a); });
    (scans   || []).forEach(s => { if (scansByUser[s.user_id])   scansByUser[s.user_id].push(s); });

    const result = {};
    members.forEach(m => {
      result[m.id] = hitungRekapRealtime({
        assignments: assignsByUser[m.id],
        scans:       scansByUser[m.id],
      });
    });
    setAllRekap(result);
    setAllLoading(false);
  }

  useEffect(() => {
    if (tab === 'all') loadAllRekap();
  }, [tab]);

  // ── Derived data ──────────────────────────────────────
  const totalPoin  = rekapMinggu.reduce((s, r) => s + (r.poin || 0), 0);
  const hadirCount = rekapMinggu.filter(r => r.is_hadir_tugas || r.is_hadir_latihan).length;
  const k6Count    = rekapMinggu.filter(r => r.kondisi === 'K6').length;
  const kondisiCount = Object.fromEntries(
    ['K1','K2','K3','K4','K5','K6'].map(k => [k, rekapMinggu.filter(r => r.kondisi === k).length])
  );

  const chartData = [...rekapMinggu].reverse().slice(-12).map(r => ({
    week:    formatDate(r.week_start, 'dd/MM'),
    poin:    r.poin || 0,
    kondisi: r.kondisi,
  }));

  function handleExportCSV() {
    const headers = [
      { key: 'week_start',       label: 'Minggu Mulai' },
      { key: 'week_end',         label: 'Minggu Selesai' },
      { key: 'kondisi',          label: 'Kondisi' },
      { key: 'poin',             label: 'Poin' },
      { key: 'is_dijadwalkan',   label: 'Dijadwalkan' },
      { key: 'is_hadir_tugas',   label: 'Hadir Tugas' },
      { key: 'is_hadir_latihan', label: 'Hadir Latihan' },
      { key: 'is_walk_in',       label: 'Walk-in' },
    ];
    downloadCSV(
      rekapMinggu.map(r => ({...r, is_dijadwalkan: r.is_dijadwalkan?'Ya':'Tidak', is_hadir_tugas: r.is_hadir_tugas?'Ya':'Tidak', is_hadir_latihan: r.is_hadir_latihan?'Ya':'Tidak', is_walk_in: r.is_walk_in?'Ya':'Tidak'})),
      headers,
      `rekap-${profile?.nickname}-${Date.now()}.csv`
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Rekap & Poin</h1>
          <p className="page-subtitle">
            Real-time · Dihitung dari scan records & jadwal
            {lastUpdate && <span className="ml-2 text-gray-400 text-xs">Update: {lastUpdate.toLocaleTimeString('id')}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadPersonal} className="btn-ghost p-2" title="Refresh"><RefreshCw size={16}/></button>
          <button onClick={handleExportCSV} className="btn-outline gap-2"><Download size={16}/> CSV</button>
        </div>
      </div>

      {/* Info real-time */}
      <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2 text-xs text-green-700">
        <Info size={14} className="flex-shrink-0"/>
        Rekap dihitung <strong>real-time</strong> langsung dari data scan & jadwal — tidak perlu tunggu cron malam.
        Data selalu akurat setiap kali halaman ini dibuka.
      </div>

      {/* Tabs */}
      {isPengurus && (
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {[{key:'personal',label:'Pribadi'},{key:'all',label:'Semua Anggota'}].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab===t.key?'bg-white text-brand-800 shadow-sm':'text-gray-500'}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ─── TAB PERSONAL ─── */}
      {tab === 'personal' && (
        <>
          {/* Filter */}
          <div className="flex gap-3 flex-wrap items-center">
            {isPengurus && (
              <select className="input w-auto" value={selUser || ''}
                onChange={e => setSelUser(e.target.value || null)}>
                <option value="">Data Saya</option>
                {memberList.map(m => <option key={m.id} value={m.id}>{m.nama_panggilan}</option>)}
              </select>
            )}
            <select className="input w-auto" value={period} onChange={e => setPeriod(e.target.value)}>
              <option value="3">3 Bulan Terakhir</option>
              <option value="6">6 Bulan Terakhir</option>
              <option value="12">1 Tahun Terakhir</option>
              <option value="all">Semua</option>
            </select>
          </div>

          {loading ? (
            <div className="space-y-3">{[1,2,3].map(i=><div key={i} className="skeleton h-16 rounded-xl"/>)}</div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="card bg-green-50 border-0 text-center">
                  <div className={`text-3xl font-black ${totalPoin > 0 ? 'text-green-700' : totalPoin < 0 ? 'text-red-700' : 'text-gray-400'}`}>
                    {totalPoin > 0 ? '+' : ''}{totalPoin}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">Total Poin</div>
                </div>
                <div className="card bg-blue-50 border-0 text-center">
                  <div className="text-3xl font-black text-blue-700">{hadirCount}</div>
                  <div className="text-xs text-gray-600 mt-1">Minggu Hadir</div>
                </div>
                <div className="card bg-red-50 border-0 text-center">
                  <div className="text-3xl font-black text-red-700">{k6Count}</div>
                  <div className="text-xs text-gray-600 mt-1">Absen (K6)</div>
                </div>
                <div className="card bg-gray-50 border-0 text-center">
                  <div className="text-3xl font-black text-gray-700">{rekapMinggu.length}</div>
                  <div className="text-xs text-gray-600 mt-1">Total Minggu</div>
                </div>
              </div>

              {/* Kondisi breakdown */}
              <div className="card">
                <h3 className="font-semibold text-gray-700 mb-3 text-sm">Breakdown Kondisi</h3>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {['K1','K2','K3','K4','K5','K6'].map(k => {
                    const info = KONDISI_INFO[k];
                    const cnt  = kondisiCount[k] || 0;
                    return (
                      <div key={k} className={`p-3 rounded-xl text-center ${info.color} ${cnt === 0 ? 'opacity-40' : ''}`}>
                        <div className="text-2xl font-black">{cnt}</div>
                        <div className="text-xs font-bold mt-0.5">{k}</div>
                        <div className="text-[10px] opacity-70">{info.poin}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Chart */}
              {chartData.length > 0 && (
                <div className="card">
                  <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
                    <TrendingUp size={16} className="text-brand-800"/> Grafik Poin
                  </h3>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={chartData} barSize={22}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0"/>
                      <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#9ca3af' }}/>
                      <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} domain={[-2, 4]}/>
                      <Tooltip
                        formatter={(v, _, { payload }) => [`${v > 0 ? '+' : ''}${v} poin (${payload.kondisi || '?'})`, 'Poin']}
                        contentStyle={{ borderRadius: 8, fontSize: 12 }}
                      />
                      <Bar dataKey="poin" radius={[4,4,0,0]}>
                        {chartData.map((d, i) => (
                          <Cell key={i} fill={KONDISI_INFO[d.kondisi]?.bar || '#e5e7eb'}/>
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Rekap harian */}
              {rekapHarian.length > 0 && (
                <div className="card">
                  <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <Calendar size={16} className="text-brand-800"/> Rekap Misa Harian
                  </h3>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {rekapHarian.map((h, i) => (
                      <div key={i} className="text-center p-2 bg-gray-50 rounded-xl">
                        <div className="text-lg font-bold text-brand-800">{h.count}</div>
                        <div className="text-[10px] text-gray-500">{MONTH_NAMES[h.bulan]} {h.tahun}</div>
                        <div className="text-[10px] text-gray-400">{h.count}× hadir</div>
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
                        <th>Periode</th>
                        <th>Kondisi</th>
                        <th>Dijadwalkan</th>
                        <th>Hadir Tugas</th>
                        <th>Hadir Latihan</th>
                        <th>Walk-in</th>
                        <th>Poin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rekapMinggu.length === 0 ? (
                        <tr><td colSpan={7} className="text-center py-8 text-gray-400">
                          Belum ada data{period !== 'all' && ' dalam periode ini'}
                        </td></tr>
                      ) : rekapMinggu.map((r, i) => {
                        const ki = KONDISI_INFO[r.kondisi];
                        return (
                          <tr key={i}>
                            <td className="text-xs text-gray-500 whitespace-nowrap">
                              {formatDate(r.week_start, 'dd MMM')} – {formatDate(r.week_end, 'dd MMM')}
                            </td>
                            <td>
                              {ki
                                ? <span className={`badge text-xs ${ki.color}`}>{r.kondisi} · {ki.label}</span>
                                : <span className="text-gray-300">—</span>
                              }
                            </td>
                            <td className="text-center text-sm">{r.is_dijadwalkan ? '✓' : '—'}</td>
                            <td className="text-center text-sm">{r.is_hadir_tugas   ? '✓' : '—'}</td>
                            <td className="text-center text-sm">{r.is_hadir_latihan ? '✓' : '—'}</td>
                            <td className="text-center text-sm">{r.is_walk_in       ? '↑' : '—'}</td>
                            <td>
                              <span className={`font-bold text-sm ${r.poin > 0 ? 'text-green-600' : r.poin < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                {r.poin > 0 ? '+' : ''}{r.poin ?? 0}
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
            <h3 className="font-semibold text-gray-700">Rekap Semua Anggota (3 Bulan)</h3>
            <button onClick={loadAllRekap} className="btn-ghost p-1.5"><RefreshCw size={14}/></button>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nama</th>
                  <th>Lingkungan</th>
                  <th>Total Poin</th>
                  <th>Hadir</th>
                  <th>K6</th>
                  <th>K1</th>
                  <th>K2</th>
                </tr>
              </thead>
              <tbody>
                {allLoading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">Menghitung real-time...</td></tr>
                ) : allMembers.map((m, i) => {
                  const rows = allRekap[m.id] || [];
                  const tot  = rows.reduce((s,r) => s+(r.poin||0), 0);
                  const had  = rows.filter(r => r.is_hadir_tugas || r.is_hadir_latihan).length;
                  const k6   = rows.filter(r => r.kondisi === 'K6').length;
                  const k1   = rows.filter(r => r.kondisi === 'K1').length;
                  const k2   = rows.filter(r => r.kondisi === 'K2').length;
                  return (
                    <tr key={m.id}>
                      <td className="text-gray-400 text-xs">{i+1}</td>
                      <td className="font-semibold text-gray-900">{m.nama_panggilan}</td>
                      <td className="text-gray-500 text-xs">{m.lingkungan}</td>
                      <td>
                        <span className={`font-bold ${tot>0?'text-green-600':tot<0?'text-red-600':'text-gray-400'}`}>
                          {tot>0?'+':''}{tot}
                        </span>
                      </td>
                      <td className="text-center text-sm">{had}</td>
                      <td className="text-center text-sm">{k6 > 0 ? <span className="text-red-600 font-bold">{k6}</span> : '—'}</td>
                      <td className="text-center text-sm">{k1 > 0 ? <span className="text-green-600 font-bold">{k1}</span> : '—'}</td>
                      <td className="text-center text-sm">{k2 > 0 ? <span className="text-blue-600 font-bold">{k2}</span> : '—'}</td>
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
        <h3 className="font-semibold text-gray-700 mb-3 text-sm">📊 Formula 6 Kondisi</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.entries(KONDISI_INFO).map(([k, v]) => (
            <div key={k} className={`p-2.5 rounded-xl ${v.color} flex items-center justify-between`}>
              <div>
                <span className="font-bold">{k}</span>
                <span className="ml-1.5 text-xs">{v.label}</span>
              </div>
              <span className="font-black text-base ml-2">{v.poin}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
