import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { formatDate, downloadCSV } from '../lib/utils';
import { BarChart2, Search, Download, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

const KONDISI_INFO = {
  K1: { label: 'Dijadwal + Tugas + Latihan', poin: '+2', color: 'bg-green-100 text-green-800',  dot: 'bg-green-500'  },
  K2: { label: 'Walk-in + Latihan',          poin: '+3', color: 'bg-blue-100 text-blue-800',    dot: 'bg-blue-500'   },
  K3: { label: 'Dijadwal + Tugas saja',      poin: '+1', color: 'bg-yellow-100 text-yellow-800',dot: 'bg-yellow-500' },
  K4: { label: 'Walk-in saja',               poin: '+1', color: 'bg-orange-100 text-orange-800',dot: 'bg-orange-500' },
  K5: { label: 'Dijadwal + Latihan saja',    poin:  '0', color: 'bg-teal-100 text-teal-800',    dot: 'bg-teal-500'   },
  K6: { label: 'Absen (tidak hadir)',        poin: '-1', color: 'bg-red-100 text-red-800',      dot: 'bg-red-500'    },
};

function pct(val, total) {
  if (!total) return '0%';
  return `${Math.round((val / total) * 100)}%`;
}

export default function StatistikPage() {
  const [members,   setMembers]  = useState([]);
  const [stats,     setStats]    = useState({});   // { userId: statsObj }
  const [loading,   setLoading]  = useState(true);
  const [search,    setSearch]   = useState('');
  const [sortBy,    setSortBy]   = useState('poin');
  const [sortDir,   setSortDir]  = useState('desc');
  const [expanded,  setExpanded] = useState(null);  // userId yang detail-nya dibuka
  const [detail,    setDetail]   = useState({});    // { userId: detailData }

  const load = useCallback(async () => {
    setLoading(true);

    // 1. Semua anggota aktif
    const { data: users } = await supabase
      .from('users')
      .select('id, nickname, nama_panggilan, lingkungan, pendidikan, is_tarakanita, role, status')
      .in('status', ['Active', 'Retired'])
      .in('role', ['Misdinar_Aktif','Misdinar_Retired'])
      .order('nama_panggilan');

    // 2. Rekap poin mingguan semua
    const { data: rekap } = await supabase
      .from('rekap_poin_mingguan')
      .select('user_id, kondisi, poin, week_start, is_dijadwalkan, is_hadir_tugas, is_hadir_latihan, is_walk_in');

    // 3. Assignments semua
    const { data: assigns } = await supabase
      .from('assignments')
      .select('user_id, slot_number, event_id');

    // 4. Swap requests (sebagai requester)
    const { data: swaps } = await supabase
      .from('swap_requests')
      .select('requester_id, status, pengganti_id');

    // Build stats per user
    const statsMap = {};
    for (const u of (users || [])) {
      const userRekap   = (rekap    || []).filter(r => r.user_id === u.id);
      const userAssigns = (assigns  || []).filter(a => a.user_id === u.id);
      const userSwaps   = (swaps    || []).filter(s => s.requester_id === u.id);
      const penggantiOf = (swaps    || []).filter(s => s.pengganti_id === u.id);

      const totalPoin  = userRekap.reduce((s, r) => s + (r.poin || 0), 0);
      const kondisiCounts = { K1:0, K2:0, K3:0, K4:0, K5:0, K6:0 };
      userRekap.forEach(r => { if (kondisiCounts[r.kondisi] !== undefined) kondisiCounts[r.kondisi]++; });

      const totalMinggu      = userRekap.length;
      const dijadwalkan      = userRekap.filter(r => r.is_dijadwalkan).length;
      const hadirTugas       = userRekap.filter(r => r.is_hadir_tugas).length;
      const hadirLatihan     = userRekap.filter(r => r.is_hadir_latihan).length;
      const totalAssignSlots = userAssigns.length;

      // Slot breakdown
      const slotCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
      userAssigns.forEach(a => { if (slotCounts[a.slot_number] !== undefined) slotCounts[a.slot_number]++; });

      statsMap[u.id] = {
        user: u,
        totalPoin,
        kondisiCounts,
        totalMinggu,
        dijadwalkan,
        hadirTugas,
        hadirLatihan,
        totalAssignSlots,
        slotCounts,
        swapCount:      userSwaps.length,
        swapReplaced:   userSwaps.filter(s => s.status === 'Replaced').length,
        swapPending:    userSwaps.filter(s => ['Pending','Offered'].includes(s.status)).length,
        penggantiCount: penggantiOf.length,
        pctDijadwalkan: dijadwalkan && totalMinggu ? Math.round(dijadwalkan / totalMinggu * 100) : 0,
        pctHadirTugas:  hadirTugas && dijadwalkan ? Math.round(hadirTugas / dijadwalkan * 100) : 0,
      };
    }

    setMembers(users || []);
    setStats(statsMap);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function loadDetail(userId) {
    if (detail[userId]) { setExpanded(expanded === userId ? null : userId); return; }

    // Load scan records detail
    const { data: scans } = await supabase
      .from('scan_records')
      .select('scan_type, timestamp, is_walk_in, is_anomaly')
      .eq('user_id', userId)
      .order('timestamp', { ascending: false })
      .limit(20);

    // Load swap detail
    const { data: swapDetail } = await supabase
      .from('swap_requests')
      .select('status, alasan, created_at, assignment:assignment_id(slot_number, events(perayaan,tanggal_tugas))')
      .eq('requester_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    setDetail(d => ({ ...d, [userId]: { scans: scans || [], swaps: swapDetail || [] } }));
    setExpanded(userId);
  }

  const filtered = members
    .filter(u => {
      const s = stats[u.id];
      if (!s) return false;
      if (!search) return true;
      return [u.nama_panggilan, u.nickname, u.lingkungan]
        .some(v => v?.toLowerCase().includes(search.toLowerCase()));
    })
    .sort((a, b) => {
      const sa = stats[a.id], sb = stats[b.id];
      let va = 0, vb = 0;
      if (sortBy === 'poin')        { va = sa?.totalPoin;          vb = sb?.totalPoin; }
      if (sortBy === 'dijadwalkan') { va = sa?.pctDijadwalkan;     vb = sb?.pctDijadwalkan; }
      if (sortBy === 'hadir')       { va = sa?.pctHadirTugas;      vb = sb?.pctHadirTugas; }
      if (sortBy === 'absen')       { va = sa?.kondisiCounts?.K6;  vb = sb?.kondisiCounts?.K6; }
      if (sortBy === 'swap')        { va = sa?.swapCount;          vb = sb?.swapCount; }
      if (sortBy === 'nama')        { return sortDir === 'asc' ? a.nama_panggilan.localeCompare(b.nama_panggilan) : b.nama_panggilan.localeCompare(a.nama_panggilan); }
      return sortDir === 'asc' ? va - vb : vb - va;
    });

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  }
  const SortIcon = ({ col }) => sortBy === col
    ? (sortDir === 'desc' ? <ChevronDown size={13}/> : <ChevronUp size={13}/>)
    : <ChevronDown size={13} className="opacity-30"/>;

  function handleExport() {
    const rows = filtered.map(u => {
      const s = stats[u.id] || {};
      return {
        Nama: u.nama_panggilan, Nickname: u.nickname, Lingkungan: u.lingkungan,
        'Total Poin': s.totalPoin,
        'Total Minggu': s.totalMinggu, 'Dijadwalkan': s.dijadwalkan,
        '% Dijadwalkan': s.pctDijadwalkan + '%', '% Hadir Tugas': s.pctHadirTugas + '%',
        'K1': s.kondisiCounts?.K1, 'K2': s.kondisiCounts?.K2, 'K3': s.kondisiCounts?.K3,
        'K4': s.kondisiCounts?.K4, 'K5': s.kondisiCounts?.K5, 'K6 (Absen)': s.kondisiCounts?.K6,
        'Tukar Jadwal': s.swapCount, 'Berhasil Tukar': s.swapReplaced,
        'Jadi Pengganti': s.penggantiCount,
      };
    });
    downloadCSV(rows, Object.keys(rows[0]).map(k => ({ key: k, label: k })), `statistik-misdinar-${Date.now()}.csv`);
  }

  if (loading) return (
    <div className="space-y-4">{[1,2,3,4,5].map(i => <div key={i} className="skeleton h-12 rounded-xl"/>)}</div>
  );

  // Overall summary
  const allStats = Object.values(stats);
  const summary = {
    totalAnggota: allStats.length,
    avgPoin:      allStats.length ? Math.round(allStats.reduce((s,x)=>s+(x.totalPoin||0),0)/allStats.length) : 0,
    totalK6:      allStats.reduce((s,x)=>s+(x.kondisiCounts?.K6||0),0),
    totalSwap:    allStats.reduce((s,x)=>s+(x.swapCount||0),0),
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2"><BarChart2 size={22} className="text-brand-800"/> Statistik Misdinar</h1>
          <p className="page-subtitle">Rekap K1–K6 · Kehadiran · Rotasi Slot · Tukar Jadwal</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-ghost p-2"><RefreshCw size={16}/></button>
          <button onClick={handleExport} className="btn-outline gap-2"><Download size={16}/> Export CSV</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Anggota', value: summary.totalAnggota, color: 'bg-blue-50' },
          { label: 'Rata-rata Poin', value: summary.avgPoin, color: 'bg-green-50' },
          { label: 'Total K6 (Absen)', value: summary.totalK6, color: 'bg-red-50' },
          { label: 'Total Tukar Jadwal', value: summary.totalSwap, color: 'bg-purple-50' },
        ].map(c => (
          <div key={c.label} className={`card ${c.color} border-0 text-center`}>
            <div className="text-2xl font-black text-gray-800">{c.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Kondisi legend */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(KONDISI_INFO).map(([k, info]) => (
          <div key={k} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium ${info.color}`}>
            <div className={`w-2 h-2 rounded-full ${info.dot}`}/>
            <span>{k}</span>: {info.label} <span className="font-bold">({info.poin})</span>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
        <input className="input pl-9" placeholder="Cari nama, lingkungan..."
          value={search} onChange={e => setSearch(e.target.value)}/>
      </div>

      {/* Table */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="tbl text-xs">
            <thead>
              <tr>
                <th className="cursor-pointer" onClick={() => toggleSort('nama')}>Anggota <SortIcon col="nama"/></th>
                <th className="cursor-pointer" onClick={() => toggleSort('poin')}>Total Poin <SortIcon col="poin"/></th>
                <th>K1</th><th>K2</th><th>K3</th><th>K4</th><th>K5</th>
                <th className="cursor-pointer text-red-600" onClick={() => toggleSort('absen')}>K6 <SortIcon col="absen"/></th>
                <th className="cursor-pointer" onClick={() => toggleSort('dijadwalkan')}>% Dijadwal <SortIcon col="dijadwalkan"/></th>
                <th className="cursor-pointer" onClick={() => toggleSort('hadir')}>% Hadir <SortIcon col="hadir"/></th>
                <th>Slot (1/2/3/4)</th>
                <th className="cursor-pointer" onClick={() => toggleSort('swap')}>Tukar <SortIcon col="swap"/></th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => {
                const s = stats[u.id];
                if (!s) return null;
                const isOpen = expanded === u.id;
                return (
                  <React.Fragment key={u.id}>
                    <tr className={isOpen ? 'bg-brand-50' : ''}>
                      <td>
                        <div className="font-semibold text-gray-900">{u.nama_panggilan}</div>
                        <div className="text-gray-400">@{u.nickname} · {u.lingkungan}</div>
                      </td>
                      <td className={`font-black text-base ${s.totalPoin > 0 ? 'text-green-600' : s.totalPoin < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {s.totalPoin > 0 ? '+' : ''}{s.totalPoin}
                      </td>
                      {['K1','K2','K3','K4','K5'].map(k => (
                        <td key={k} className="text-center font-semibold">
                          {s.kondisiCounts[k] > 0 ? <span className={`inline-block px-1.5 rounded ${KONDISI_INFO[k].color}`}>{s.kondisiCounts[k]}</span> : <span className="text-gray-300">0</span>}
                        </td>
                      ))}
                      <td className="text-center font-semibold">
                        {s.kondisiCounts.K6 > 0 ? <span className="inline-block px-1.5 rounded bg-red-100 text-red-700">{s.kondisiCounts.K6}</span> : <span className="text-gray-300">0</span>}
                      </td>
                      <td className="text-center">
                        <div className="font-semibold">{s.pctDijadwalkan}%</div>
                        <div className="text-gray-400">{s.dijadwalkan}/{s.totalMinggu}</div>
                      </td>
                      <td className="text-center">
                        <div className="font-semibold">{s.pctHadirTugas}%</div>
                        <div className="text-gray-400">{s.hadirTugas}/{s.dijadwalkan || 0}</div>
                      </td>
                      <td className="text-center text-gray-600">
                        {s.slotCounts[1]}/{s.slotCounts[2]}/{s.slotCounts[3]}/{s.slotCounts[4]}
                      </td>
                      <td className="text-center">
                        {s.swapCount > 0 ? (
                          <span className="text-purple-700 font-semibold">{s.swapReplaced}/{s.swapCount}</span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td>
                        <button onClick={() => loadDetail(u.id)} className="btn-ghost btn-sm text-xs">
                          {isOpen ? '▲ Tutup' : '▼ Detail'}
                        </button>
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isOpen && detail[u.id] && (
                      <tr>
                        <td colSpan={13} className="bg-brand-50 px-4 py-3">
                          <div className="grid sm:grid-cols-2 gap-4">
                            {/* Scan history */}
                            <div>
                              <p className="font-semibold text-xs text-gray-600 mb-2">🔍 Scan Terakhir</p>
                              {detail[u.id].scans.length === 0
                                ? <p className="text-xs text-gray-400">Belum ada scan</p>
                                : detail[u.id].scans.slice(0,8).map((sc, i) => (
                                  <div key={i} className="flex items-center gap-2 text-xs text-gray-600 mb-1">
                                    <span className={`w-16 text-center rounded px-1 ${sc.is_walk_in ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                                      {sc.scan_type}
                                    </span>
                                    <span>{formatDate(sc.timestamp, 'dd MMM HH:mm')}</span>
                                    {sc.is_anomaly && <span className="text-red-500">⚠️ anomali</span>}
                                  </div>
                                ))
                              }
                            </div>
                            {/* Swap history */}
                            <div>
                              <p className="font-semibold text-xs text-gray-600 mb-2">🔄 Riwayat Tukar Jadwal</p>
                              {detail[u.id].swaps.length === 0
                                ? <p className="text-xs text-gray-400">Belum pernah tukar jadwal</p>
                                : detail[u.id].swaps.slice(0,5).map((sw, i) => (
                                  <div key={i} className="text-xs text-gray-600 mb-1">
                                    <span className={`px-1 rounded mr-1 ${sw.status === 'Replaced' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{sw.status}</span>
                                    {sw.assignment?.events?.perayaan || '—'} · {formatDate(sw.assignment?.events?.tanggal_tugas, 'dd MMM')}
                                  </div>
                                ))
                              }
                              {s.penggantiCount > 0 && (
                                <p className="text-xs text-blue-600 mt-1">✅ Jadi pengganti {s.penggantiCount}×</p>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
