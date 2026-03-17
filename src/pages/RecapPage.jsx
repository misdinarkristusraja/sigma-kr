import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, getWeekPeriod, downloadCSV, hitungPoin } from '../lib/utils';
import { BarChart2, Download, Filter, TrendingUp, User, Calendar } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';

const KONDISI_INFO = {
  K1: { label: 'Dijadwal + Tugas + Latihan', poin: '+2', color: 'bg-green-100 text-green-800' },
  K2: { label: 'Walk-in + Latihan',          poin: '+3', color: 'bg-blue-100 text-blue-800' },
  K3: { label: 'Dijadwal + Tugas',           poin: '+1', color: 'bg-yellow-100 text-yellow-800' },
  K4: { label: 'Walk-in saja',               poin: '+2', color: 'bg-orange-100 text-orange-800' },
  K5: { label: 'Latihan saja',               poin: '+1', color: 'bg-teal-100 text-teal-800' },
  K6: { label: 'Absen (Dijadwal)',            poin: '-1', color: 'bg-red-100 text-red-800' },
};

export default function RecapPage() {
  const { profile, isPengurus } = useAuth();
  const [tab, setTab]         = useState('personal');
  const [rekapData, setRekap] = useState([]);
  const [harianData, setHarian]= useState([]);
  const [allMembers, setAll]  = useState([]);
  const [selUser, setSelUser] = useState(null);
  const [period, setPeriod]   = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [tab, selUser, period]);

  async function loadData() {
    setLoading(true);
    if (tab === 'personal') {
      const uid = selUser || profile?.id;
      if (!uid) { setLoading(false); return; }

      let q = supabase.from('rekap_poin_mingguan').select('*').eq('user_id', uid).order('week_start', { ascending: false });
      if (period !== 'all') {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - parseInt(period));
        q = q.gte('week_start', cutoff.toISOString().split('T')[0]);
      }
      const { data } = await q.limit(52);
      setRekap(data || []);

      const { data: hData } = await supabase.from('rekap_poin_harian').select('*').eq('user_id', uid).order('tahun', {ascending:false}).order('bulan', {ascending:false}).limit(12);
      setHarian(hData || []);
    } else {
      // All members recap (pengurus view)
      const { data: members } = await supabase
        .from('users')
        .select('id, nama_panggilan, lingkungan, pendidikan')
        .eq('status', 'Active')
        .order('nama_panggilan');
      setAll(members || []);
    }
    setLoading(false);
  }

  if (!isPengurus) {
    supabase.from('users').select('id, nama_panggilan').eq('status','Active').then(({ data }) => {
      // only personal view for regular members
    });
  }

  const totalPoin = rekapData.reduce((s, r) => s + (r.poin || 0), 0);
  const hadirCount = rekapData.filter(r => r.is_hadir_tugas || r.is_hadir_latihan).length;
  const k6Count   = rekapData.filter(r => r.kondisi === 'K6').length;

  const chartData = rekapData.slice(0, 12).reverse().map(r => ({
    week: formatDate(r.week_start, 'dd/MM'),
    poin: r.poin || 0,
    kondisi: r.kondisi,
  }));

  const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

  function handleExportCSV() {
    const headers = [
      { key: 'week_start', label: 'Minggu' },
      { key: 'kondisi',    label: 'Kondisi' },
      { key: 'poin',       label: 'Poin' },
      { key: 'is_dijadwalkan', label: 'Dijadwalkan' },
      { key: 'is_hadir_tugas', label: 'Hadir Tugas' },
      { key: 'is_hadir_latihan', label: 'Hadir Latihan' },
    ];
    downloadCSV(rekapData, headers, `rekap-${profile?.nickname}.csv`);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Rekap & Poin</h1>
          <p className="page-subtitle">Rekap Mingguan · Rekap Harian · Riwayat</p>
        </div>
        <button onClick={handleExportCSV} className="btn-outline gap-2"><Download size={16} /> Export CSV</button>
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

      {tab === 'personal' && (
        <>
          {/* Filter row */}
          <div className="flex gap-3 flex-wrap items-center">
            {isPengurus && (
              <select className="input w-auto" value={selUser || ''} onChange={e => setSelUser(e.target.value || null)}>
                <option value="">Data Saya</option>
                {allMembers.map(m => <option key={m.id} value={m.id}>{m.nama_panggilan}</option>)}
              </select>
            )}
            <select className="input w-auto" value={period} onChange={e => setPeriod(e.target.value)}>
              <option value="all">Semua Periode</option>
              <option value="3">3 Bulan Terakhir</option>
              <option value="6">6 Bulan Terakhir</option>
              <option value="12">1 Tahun Terakhir</option>
            </select>
          </div>

          {/* Stats summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="card bg-green-50 border-0 text-center">
              <div className="text-3xl font-black text-green-700">{totalPoin}</div>
              <div className="text-xs text-gray-600 mt-1">Total Poin</div>
            </div>
            <div className="card bg-blue-50 border-0 text-center">
              <div className="text-3xl font-black text-blue-700">{hadirCount}</div>
              <div className="text-xs text-gray-600 mt-1">Kehadiran</div>
            </div>
            <div className="card bg-red-50 border-0 text-center">
              <div className="text-3xl font-black text-red-700">{k6Count}</div>
              <div className="text-xs text-gray-600 mt-1">Absen (K6)</div>
            </div>
          </div>

          {/* Poin chart */}
          {chartData.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2"><TrendingUp size={16} className="text-brand-800" /> Grafik Poin 12 Minggu Terakhir</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartData} barSize={20}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} domain={[-2, 4]} />
                  <Tooltip
                    formatter={(value, name) => [value, 'Poin']}
                    contentStyle={{ borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="poin" radius={[4,4,0,0]}>
                    {chartData.map((d,i) => (
                      <Cell key={i} fill={d.poin > 0 ? '#22c55e' : d.poin < 0 ? '#ef4444' : '#e5e7eb'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Rekap harian */}
          {harianData.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2"><Calendar size={16} className="text-brand-800" /> Rekap Misa Harian</h3>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {harianData.map((h, i) => (
                  <div key={i} className="text-center p-2 bg-gray-50 rounded-xl">
                    <div className="text-lg font-bold text-brand-800">{h.poin_harian}</div>
                    <div className="text-[10px] text-gray-500">{MONTH_NAMES[h.bulan]} {h.tahun}</div>
                    <div className="text-[10px] text-gray-400">{h.count_hadir_harian}x hadir</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Detailed table */}
          <div className="card overflow-hidden p-0">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-700">Riwayat Mingguan</h3>
              <span className="text-xs text-gray-400">{rekapData.length} minggu</span>
            </div>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Minggu</th>
                    <th>Kondisi</th>
                    <th>Dijadwalkan</th>
                    <th>Tugas</th>
                    <th>Latihan</th>
                    <th>Poin</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="text-center py-8 text-gray-400">Memuat...</td></tr>
                  ) : rekapData.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-gray-400">Belum ada data rekap</td></tr>
                  ) : rekapData.map((r, i) => {
                    const ki = KONDISI_INFO[r.kondisi];
                    return (
                      <tr key={i}>
                        <td className="text-xs text-gray-500">
                          {formatDate(r.week_start, 'dd MMM')} – {formatDate(r.week_end, 'dd MMM yyyy')}
                        </td>
                        <td>
                          {ki ? (
                            <span className={`badge text-xs ${ki.color}`}>{r.kondisi} · {ki.label}</span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="text-center">{r.is_dijadwalkan ? '✓' : '—'}</td>
                        <td className="text-center">{r.is_hadir_tugas ? '✓' : r.is_walk_in ? '↑' : '—'}</td>
                        <td className="text-center">{r.is_hadir_latihan ? '✓' : '—'}</td>
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

      {/* All members rekap (pengurus) */}
      {tab === 'all' && isPengurus && (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nama</th>
                  <th>Lingkungan</th>
                  <th>Pendidikan</th>
                  <th>Total Poin</th>
                  <th>Hadir</th>
                  <th>K6 (Absen)</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-400">Memuat...</td></tr>
                ) : allMembers.map((m, i) => (
                  <tr key={m.id}>
                    <td className="text-gray-400 text-xs w-8">{i+1}</td>
                    <td className="font-semibold text-gray-900">{m.nama_panggilan}</td>
                    <td className="text-gray-500 text-xs">{m.lingkungan}</td>
                    <td><span className="badge-gray">{m.pendidikan || '—'}</span></td>
                    <td>—</td><td>—</td><td>—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Formula reference */}
      <div className="card bg-gray-50">
        <h3 className="font-semibold text-gray-700 mb-3 text-sm">📊 Formula 6 Kondisi Poin</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.entries(KONDISI_INFO).map(([k, v]) => (
            <div key={k} className={`p-2 rounded-lg ${v.color}`}>
              <span className="font-bold">{k}</span>
              <span className="ml-1 text-xs">{v.label}</span>
              <span className="ml-auto font-bold block text-right text-base">{v.poin}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
