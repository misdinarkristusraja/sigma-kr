import React, { useState, useCallback } from 'react';
import {
  FileBarChart2, Loader2, Download, Users, TrendingUp,
  Award, CalendarCheck, ChevronDown, Printer,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { downloadCSV } from '../lib/utils';
import toast from 'react-hot-toast';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

const MONTHS = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember',
];
const NOW_Y = new Date().getFullYear();
const YEARS = [NOW_Y - 1, NOW_Y];

export default function MonthlyReportPage() {
  const { user, isPengurus } = useAuth();
  const [bulan,   setBulan]   = useState(new Date().getMonth() + 1);
  const [tahun,   setTahun]   = useState(NOW_Y);
  const [loading, setLoading] = useState(false);
  const [report,  setReport]  = useState(null);

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const y = tahun, m = bulan;
      const startStr = `${y}-${String(m).padStart(2,'0')}-01`;
      const endDate  = new Date(y, m, 0);
      const endStr   = format(endDate, 'yyyy-MM-dd');

      // Anggota aktif
      const { data: members } = await supabase
        .from('users')
        .select('id, nickname, nama_panggilan, nama_lengkap, lingkungan, pendidikan')
        .eq('status', 'Active')
        .in('role', ['Misdinar_Aktif','Misdinar_Retired'])
        .order('nama_panggilan');

      // Rekap mingguan bulan ini
      const { data: rekap } = await supabase
        .from('rekap_poin_mingguan')
        .select('user_id, kondisi, poin, week_start, is_hadir_tugas, is_hadir_latihan, is_walk_in')
        .gte('week_start', startStr)
        .lte('week_start', endStr);

      // Absensi latihan misa khusus bulan ini
      const { data: slotAttend } = await supabase
        .from('special_mass_attendance')
        .select('user_id, hadir, slot:special_mass_slots(tanggal, is_wajib)')
        .eq('hadir', true);

      // Filter slot bulan ini
      const slotThisMonth = (slotAttend || []).filter(a => {
        const t = a.slot?.tanggal;
        return t && t >= startStr && t <= endStr;
      });

      // Build stats per anggota
      const stats = (members || []).map(m => {
        const r = (rekap || []).filter(x => x.user_id === m.id);
        const s = slotThisMonth.filter(x => x.user_id === m.id && x.slot?.is_wajib);

        const hadir_tugas   = r.filter(x => x.is_hadir_tugas).length;
        const total_tugas   = r.length;
        const hadir_latihan = r.filter(x => x.is_hadir_latihan).length + s.length;
        const total_latihan = r.length + slotThisMonth.filter(x => x.user_id === m.id).length;
        const total_poin    = r.reduce((acc, x) => acc + (x.poin || 0), 0);

        return {
          ...m,
          hadir_tugas, total_tugas,
          hadir_latihan, total_latihan,
          hadir_total: hadir_tugas + hadir_latihan,
          total_poin,
          persen: total_tugas > 0 ? Math.round(hadir_tugas * 100 / total_tugas) : 0,
        };
      });

      // Chart data: kondisi per minggu
      const weekMap = {};
      (rekap || []).forEach(r => {
        const w = r.week_start?.substring(5, 10); // MM-DD
        if (!weekMap[w]) weekMap[w] = { minggu: w, hadir: 0, absen: 0 };
        if (r.is_hadir_tugas) weekMap[w].hadir++;
        else if (r.kondisi === 'K6') weekMap[w].absen++;
      });
      const weeklyChart = Object.values(weekMap).sort((a,b) => a.minggu.localeCompare(b.minggu));

      const top5 = [...stats].sort((a,b) => b.hadir_total - a.hadir_total).slice(0, 5);
      const avgPersen = stats.length
        ? Math.round(stats.reduce((s,m) => s + m.persen, 0) / stats.length)
        : 0;

      const snapshot = { stats, top5, weeklyChart, avgPersen };

      // Simpan ke DB
      await supabase.from('monthly_reports').upsert({
        bulan, tahun, generated_by: user?.id,
        generated_at: new Date().toISOString(),
        data_snapshot: snapshot,
      }, { onConflict: 'bulan,tahun' });

      setReport({ ...snapshot, bulan, tahun, startStr, endStr });
      toast.success('Laporan berhasil dibuat!');
    } catch (err) {
      console.error(err);
      toast.error('Gagal membuat laporan');
    }
    setLoading(false);
  }, [bulan, tahun, user]);

  const exportCSV = () => {
    if (!report) return;
    downloadCSV(report.stats, [
      { label: 'Nama',         key: 'nama_panggilan' },
      { label: 'Nickname',     key: 'nickname' },
      { label: 'Lingkungan',   key: 'lingkungan' },
      { label: 'Hadir Tugas',  key: 'hadir_tugas' },
      { label: 'Total Tugas',  key: 'total_tugas' },
      { label: 'Hadir Latihan',key: 'hadir_latihan' },
      { label: 'Total Poin',   key: 'total_poin' },
      { label: 'Kehadiran %',  key: 'persen' },
    ], `laporan-sigma-${bulan}-${tahun}.csv`);
    toast.success('CSV diunduh');
  };

  const periodeLabel = `${MONTHS[bulan - 1]} ${tahun}`;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <FileBarChart2 size={22} className="text-brand-800"/> Laporan Bulanan
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Generate rekap kehadiran & poin per bulan</p>
        </div>
      </div>

      {/* Filter card */}
      <div className="card">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Bulan */}
          <div>
            <label className="label text-xs">Bulan</label>
            <div className="relative">
              <select value={bulan} onChange={e => setBulan(Number(e.target.value))}
                className="input text-sm appearance-none pr-8">
                {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-3 text-gray-400 pointer-events-none"/>
            </div>
          </div>
          {/* Tahun */}
          <div>
            <label className="label text-xs">Tahun</label>
            <div className="relative">
              <select value={tahun} onChange={e => setTahun(Number(e.target.value))}
                className="input text-sm appearance-none pr-8">
                {YEARS.map(y => <option key={y}>{y}</option>)}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-3 text-gray-400 pointer-events-none"/>
            </div>
          </div>
          <button onClick={generate} disabled={loading}
            className="btn-primary gap-2">
            {loading
              ? <><Loader2 size={15} className="animate-spin"/> Memproses…</>
              : <><FileBarChart2 size={15}/> Generate Laporan</>}
          </button>
          {report && (
            <button onClick={exportCSV} className="btn-outline gap-2">
              <Download size={15}/> Export CSV
            </button>
          )}
        </div>
      </div>

      {report && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {
                icon: <Users size={18}/>, label: 'Total Anggota',
                value: report.stats.length, color: 'text-blue-600 bg-blue-50',
              },
              {
                icon: <TrendingUp size={18}/>, label: 'Rata-rata Hadir',
                value: `${report.avgPersen}%`, color: 'text-green-600 bg-green-50',
              },
              {
                icon: <Award size={18}/>, label: 'Kehadiran Terbaik',
                value: report.top5[0]?.nama_panggilan || '—', color: 'text-yellow-600 bg-yellow-50',
              },
              {
                icon: <CalendarCheck size={18}/>, label: 'Periode',
                value: periodeLabel, color: 'text-purple-600 bg-purple-50',
              },
            ].map(c => (
              <div key={c.label} className="card">
                <div className={`inline-flex p-2 rounded-xl mb-2 ${c.color}`}>{c.icon}</div>
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className="font-bold text-gray-800 text-base mt-0.5 truncate">{c.value}</p>
              </div>
            ))}
          </div>

          {/* Chart mingguan */}
          {report.weeklyChart.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-gray-700 text-sm mb-4">Kehadiran per Minggu</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={report.weeklyChart} barGap={4}>
                  <XAxis dataKey="minggu" tick={{ fontSize: 11 }}/>
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false}/>
                  <Tooltip/>
                  <Bar dataKey="hadir" name="Hadir" radius={[4,4,0,0]}>
                    {report.weeklyChart.map((_,i) => <Cell key={i} fill="#8B0000"/>)}
                  </Bar>
                  <Bar dataKey="absen" name="Absen" radius={[4,4,0,0]}>
                    {report.weeklyChart.map((_,i) => <Cell key={i} fill="#fca5a5"/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Top 5 */}
          <div className="card">
            <h3 className="font-semibold text-gray-700 text-sm mb-3">🏆 Top 5 Kehadiran</h3>
            <div className="space-y-2">
              {report.top5.map((m, i) => (
                <div key={m.id} className="flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                    ${i===0?'bg-yellow-100 text-yellow-700':i===1?'bg-gray-100 text-gray-600':'bg-orange-50 text-orange-600'}`}>
                    {i+1}
                  </span>
                  <span className="flex-1 text-sm text-gray-800">{m.nama_panggilan}</span>
                  <span className="text-xs text-gray-500">{m.hadir_total} hadir</span>
                  <span className={`badge ${m.persen>=80?'badge-green':m.persen>=60?'badge-yellow':'badge-red'}`}>
                    {m.persen}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Tabel lengkap */}
          <div className="card overflow-hidden p-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-700 text-sm">Detail Semua Anggota</h3>
              <span className="text-xs text-gray-400">Periode: {periodeLabel}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <th className="text-left px-4 py-2.5">Nama</th>
                    <th className="text-left px-4 py-2.5 hidden sm:table-cell">Lingkungan</th>
                    <th className="text-center px-3 py-2.5">Tugas</th>
                    <th className="text-center px-3 py-2.5">Latihan</th>
                    <th className="text-center px-3 py-2.5">Poin</th>
                    <th className="text-center px-3 py-2.5">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {report.stats.map(m => (
                    <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2.5 font-medium text-gray-800">{m.nama_panggilan}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs hidden sm:table-cell">{m.lingkungan}</td>
                      <td className="px-3 py-2.5 text-center text-gray-700">
                        {m.hadir_tugas}<span className="text-gray-400 text-xs">/{m.total_tugas}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center text-gray-700">
                        {m.hadir_latihan}
                      </td>
                      <td className="px-3 py-2.5 text-center font-semibold text-brand-800">
                        {m.total_poin > 0 ? `+${m.total_poin}` : m.total_poin}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`badge ${m.persen>=80?'badge-green':m.persen>=60?'badge-yellow':'badge-red'}`}>
                          {m.persen}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
