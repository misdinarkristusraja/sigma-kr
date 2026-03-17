// ScheduleDailyPage.jsx
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { formatDate, getLiturgyClass } from '../lib/utils';
import { toPng } from 'html-to-image';
import { CalendarDays, Download, Zap, ChevronLeft, ChevronRight, Bell } from 'lucide-react';
import toast from 'react-hot-toast';

export function ScheduleDailyPage() {
  const [events,  setEvents]  = useState([]);
  const [month,   setMonth]   = useState(new Date().getMonth() + 1);
  const [year,    setYear]    = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [optinStatus, setOptin] = useState(null); // user's optin for next month
  const tableRef = useRef(null);

  useEffect(() => { loadEvents(); }, [month, year]);

  async function loadEvents() {
    setLoading(true);
    const start = `${year}-${String(month).padStart(2,'0')}-01`;
    const end   = `${year}-${String(month).padStart(2,'0')}-31`;
    const { data } = await supabase
      .from('events')
      .select(`*, assignments(user_id, users(nama_lengkap, nama_panggilan, lingkungan, pendidikan))`)
      .eq('tipe_event', 'Misa_Harian')
      .gte('tanggal_tugas', start)
      .lte('tanggal_tugas', end)
      .order('tanggal_tugas');
    setEvents(data || []);
    setLoading(false);
  }

  async function exportPNG() {
    if (!tableRef.current) return;
    try {
      const png = await toPng(tableRef.current, { pixelRatio: 2 });
      const a = document.createElement('a');
      a.href = png; a.download = `jadwal-harian-${month}-${year}.png`; a.click();
      toast.success('PNG berhasil diunduh!');
    } catch { toast.error('Gagal export'); }
  }

  const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const HARI   = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Jadwal Misa Harian</h1>
          <p className="page-subtitle">Senin–Jumat · Tarakanita otomatis · Opt-in manual</p>
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={() => { if (month===1){setMonth(12);setYear(y=>y-1);}else setMonth(m=>m-1); }} className="btn-ghost p-2"><ChevronLeft size={18}/></button>
          <span className="font-semibold text-gray-700 w-32 text-center">{MONTHS[month-1]} {year}</span>
          <button onClick={() => { if (month===12){setMonth(1);setYear(y=>y+1);}else setMonth(m=>m+1); }} className="btn-ghost p-2"><ChevronRight size={18}/></button>
          <button onClick={exportPNG} className="btn-outline gap-2"><Download size={16}/> PNG</button>
        </div>
      </div>

      {/* Opt-in notice */}
      <div className="card bg-amber-50 border-amber-100 flex items-center gap-3">
        <Bell size={18} className="text-amber-600 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-800">Opt-in Bulan Depan</p>
          <p className="text-xs text-amber-600">Window opt-in terbuka tanggal 10–20 setiap bulan untuk bulan berikutnya.</p>
        </div>
        <select className="input w-auto text-sm border-amber-300"
          value={optinStatus || ''}
          onChange={e => setOptin(e.target.value)}>
          <option value="">— Pilih —</option>
          <option value="Bisa">Bisa</option>
          <option value="Tidak_Bisa">Tidak Bisa</option>
          <option value="Pas_Libur">Pas Libur (bisa)</option>
        </select>
      </div>

      {/* Schedule table */}
      <div className="card overflow-hidden p-0" ref={tableRef}>
        <div className="px-4 py-3 bg-brand-800 text-white">
          <p className="font-bold text-center">JADWAL MISA HARIAN — {MONTHS[month-1].toUpperCase()} {year}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Hari</th>
                <th>Warna Liturgi</th>
                <th>Perayaan</th>
                <th>Petugas</th>
                <th>Lingkungan</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">Memuat...</td></tr>
              ) : events.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">Belum ada jadwal Misa Harian bulan ini</td></tr>
              ) : events.map(ev => {
                const lc = getLiturgyClass(ev.warna_liturgi);
                const d  = new Date(ev.tanggal_tugas + 'T00:00:00');
                return (ev.assignments || [{ users: null }]).map((a, i) => (
                  <tr key={`${ev.id}-${i}`} className={lc.bg}>
                    {i === 0 && (
                      <>
                        <td rowSpan={(ev.assignments||[1]).length} className={`font-bold ${lc.text}`}>
                          {formatDate(ev.tanggal_tugas, 'dd')}
                        </td>
                        <td rowSpan={(ev.assignments||[1]).length}>{HARI[d.getDay()]}</td>
                        <td rowSpan={(ev.assignments||[1]).length}>
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${lc.dot}`} />
                            <span className="text-xs">{ev.warna_liturgi || 'Hijau'}</span>
                          </div>
                        </td>
                        <td rowSpan={(ev.assignments||[1]).length} className="text-xs">{ev.perayaan || '—'}</td>
                      </>
                    )}
                    <td className="font-medium">{a.users?.nama_lengkap || a.users?.nama_panggilan || '—'}</td>
                    <td className="text-xs text-gray-500">{a.users?.lingkungan || '—'}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── PublicSchedulePage.jsx ──────────────────────────────────────────────────
export function PublicSchedulePage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoad]  = useState(true);

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    supabase.from('events')
      .select(`*, assignments(slot_number, users(nama_panggilan))`)
      .gte('tanggal_tugas', today)
      .not('tipe_event', 'eq', 'Misa_Harian')
      .order('tanggal_tugas').limit(8)
      .then(({ data }) => { setEvents(data || []); setLoad(false); });
  }, []);

  const SLOT_LABELS = { 1:'Sabtu 17:30', 2:'Minggu 06:00', 3:'Minggu 08:00', 4:'Minggu 17:30' };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-brand-800 text-white py-8 px-4 text-center">
        <h1 className="text-2xl font-black">SIGMA</h1>
        <p className="text-brand-200 text-sm">Jadwal Misdinar Paroki Kristus Raja Solo Baru</p>
        <p className="text-brand-300 text-xs italic mt-1">Serve the Lord with Gladness</p>
      </div>
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {loading ? [1,2,3].map(i => <div key={i} className="skeleton h-40 rounded-xl" />) :
         events.map(ev => {
          const asgn = ev.assignments || [];
          return (
            <div key={ev.id} className="card">
              <h3 className="font-bold text-gray-900">{ev.perayaan || ev.nama_event}</h3>
              <p className="text-sm text-gray-500 mb-3">{formatDate(ev.tanggal_tugas,'EEEE, dd MMMM yyyy')}</p>
              {[1,2,3,4].map(slot => {
                const names = asgn.filter(a => a.slot_number === slot).map(a => a.users?.nama_panggilan);
                return names.length > 0 ? (
                  <div key={slot} className="flex items-start gap-3 mb-2 text-sm">
                    <span className="text-gray-400 w-28 flex-shrink-0">{SLOT_LABELS[slot]}</span>
                    <span className="font-medium text-gray-800">{names.join(' / ')}</span>
                  </div>
                ) : null;
              })}
            </div>
          );
        })}
        <div className="text-center pt-4">
          <a href="/login" className="btn-primary">Login ke SIGMA</a>
          <p className="text-xs text-gray-400 mt-3">Daftar menjadi misdinar? <a href="/daftar" className="text-brand-800 underline">Daftar di sini</a></p>
        </div>
      </div>
    </div>
  );
}

// ─── NotFoundPage.jsx ─────────────────────────────────────────────────────────
import { Church } from 'lucide-react';
export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-brand-800 flex items-center justify-center text-white text-center p-6">
      <div>
        <Church size={48} className="mx-auto mb-4 text-brand-200" />
        <h1 className="text-6xl font-black mb-2">404</h1>
        <p className="text-brand-200 text-lg mb-6">Halaman tidak ditemukan</p>
        <a href="/dashboard" className="bg-white text-brand-800 font-bold px-6 py-3 rounded-xl hover:bg-brand-50 transition-colors">Kembali ke Dashboard</a>
      </div>
    </div>
  );
}

export { ScheduleDailyPage as default };
