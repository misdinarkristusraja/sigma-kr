import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { formatDate, getLiturgyClass, buildWALink } from '../lib/utils';
import {
  Calendar, Clock, Trophy, ArrowLeftRight, QrCode,
  CheckCircle, AlertTriangle, ChevronRight, Star, Zap, Bell,
  CalendarPlus, Download, Smartphone,
} from 'lucide-react';
import { exportToGCal } from '../lib/calendarExport';
import StreakWidget from '../components/ui/StreakWidget';

export default function DashboardPage() {
  const { profile, isPengurus, isPelatih } = useAuth();
  const [stats,          setStats]    = useState({ totalPoin: 0, thisWeek: null, history: [] });
  const [upcomingEvents, setUpcoming] = useState([]);
  const [mySchedule,     setMySched]  = useState([]);
  const [swapBoard,      setSwapBoard]= useState([]);
  const [pendingRegs,    setPending]  = useState(0);
  const [optinWindow,    setOptin]    = useState(false);

  // Masing-masing loading state terpisah agar tidak semua skeleton jika 1 query gagal
  const [loadingEvents,  setLoadingEvents]  = useState(true);
  const [loadingStats,   setLoadingStats]   = useState(true);
  const [pengurusStats,  setPengurusStats]  = useState(null);
  const [loadingPStats,  setLoadingPStats]  = useState(false);

  useEffect(() => {
    loadUpcomingEvents();
    if (profile?.id) {
      loadStats();
      loadMySchedule();
      loadSwapBoard();
      checkOptinWindow();
      if (isPengurus) { loadPendingRegs(); loadPengurusStats(); }
    }
  }, [profile?.id, isPengurus]);

  async function loadUpcomingEvents() {
    setLoadingEvents(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('events')
        .select('id, nama_event, tipe_event, tanggal_tugas, tanggal_latihan, perayaan, warna_liturgi, status_event')
        .gte('tanggal_tugas', today)
        .in('status_event', ['Akan_Datang', 'Berlangsung'])
        .order('tanggal_tugas')
        .limit(3);
      setUpcoming(data || []);
    } catch (e) {
      console.error('loadUpcomingEvents:', e);
      setUpcoming([]);
    } finally {
      setLoadingEvents(false);
    }
  }

  async function loadStats() {
    setLoadingStats(true);
    try {
      const { data } = await supabase
        .from('rekap_poin_mingguan')
        .select('poin, kondisi, week_start')
        .eq('user_id', profile.id)
        .order('week_start', { ascending: false })
        .limit(8);
      if (data) {
        const totalPoin = data.reduce((s, r) => s + (r.poin || 0), 0);
        setStats({ totalPoin, thisWeek: data[0] || null, history: data });
      }
    } catch (e) {
      console.error('loadStats:', e);
    } finally {
      setLoadingStats(false);
    }
  }

  async function loadMySchedule() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('assignments')
        .select('id, slot_number, events(nama_event, tanggal_tugas, perayaan)')
        .eq('user_id', profile.id)
        .gte('events.tanggal_tugas', today)
        .order('events.tanggal_tugas')
        .limit(3);
      setMySched((data || []).filter(d => d.events));
    } catch (e) {
      console.error('loadMySchedule:', e);
    }
  }

  async function loadSwapBoard() {
    try {
      const { data } = await supabase
        .from('swap_requests')
        .select('id, requester:requester_id(nama_panggilan, lingkungan), assignment:assignment_id(slot_number, events(nama_event, tanggal_tugas))')
        .eq('is_penawaran', true)
        .eq('status', 'Offered')
        .order('created_at', { ascending: false })
        .limit(5);
      setSwapBoard(data || []);
    } catch (e) {
      console.error('loadSwapBoard:', e);
    }
  }

  async function loadPendingRegs() {
    try {
      const { count } = await supabase
        .from('registrations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'Pending');
      setPending(count || 0);
    } catch (e) {
      console.error('loadPendingRegs:', e);
    }
  }

  async function checkOptinWindow() {
    try {
      const day = new Date().getDate();
      const { data: startData } = await supabase.from('system_config').select('value').eq('key', 'window_optin_harian_start').maybeSingle();
      const { data: endData }   = await supabase.from('system_config').select('value').eq('key', 'window_optin_harian_end').maybeSingle();
      const start = parseInt(startData?.value || '10');
      const end   = parseInt(endData?.value || '20');
      setOptin(day >= start && day <= end);
    } catch (e) {
      console.error('checkOptinWindow:', e);
    }
  }

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 11) return 'Selamat Pagi';
    if (h < 15) return 'Selamat Siang';
    if (h < 18) return 'Selamat Sore';
    return 'Selamat Malam';
  };

  const KONDISI_LABELS = {
    K1: { label: 'Tugas + Latihan',  color: 'text-green-600',  icon: '⭐' },
    K2: { label: 'Walk-in + Latihan',color: 'text-blue-600',   icon: '🌟' },
    K3: { label: 'Tugas saja',        color: 'text-yellow-600', icon: '✓' },
    K4: { label: 'Walk-in saja',      color: 'text-orange-600', icon: '↑' },
    K5: { label: 'Latihan saja',      color: 'text-teal-600',   icon: '+' },
    K6: { label: 'Absen (Penalty)',   color: 'text-red-600',    icon: '✗' },
  };

  const nama = profile?.nama_panggilan || profile?.nickname || '';

  async function loadPengurusStats() {
    setLoadingPStats(true);
    const today = new Date();
    const monthStart = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`;
    const todayStr   = today.toISOString().split('T')[0];

    const [
      { count: totalAktif },
      { count: totalPending },
      { count: scanBulanIni },
      { count: jadwalBulanIni },
      { count: tukarBulanIni },
    ] = await Promise.all([
      supabase.from('users').select('*', { count:'exact', head:true })
        .eq('status','Active').in('role',['Misdinar_Aktif','Misdinar_Retired']),
      supabase.from('users').select('*', { count:'exact', head:true }).eq('status','Pending'),
      supabase.from('scan_records').select('*', { count:'exact', head:true })
        .gte('timestamp', monthStart + 'T00:00:00'),
      supabase.from('assignments').select('*', { count:'exact', head:true })
        .gte('created_at', monthStart + 'T00:00:00'),
      supabase.from('swap_requests').select('*', { count:'exact', head:true })
        .gte('created_at', monthStart + 'T00:00:00'),
    ]);

    // Absensi bulan ini: dijadwalkan tapi tidak scan
    const { data: assignedIds } = await supabase.from('assignments')
      .select('user_id, events(tanggal_tugas)')
      .gte('events.tanggal_tugas', monthStart)
      .lte('events.tanggal_tugas', todayStr);
    
    const { data: scannedIds } = await supabase.from('scan_records')
      .select('user_id').gte('timestamp', monthStart + 'T00:00:00')
      .in('scan_type', ['tugas','walkin_tugas']);

    const scannedSet = new Set((scannedIds||[]).map(s => s.user_id));
    const absenCount = (assignedIds||[]).filter(a => a.events && !scannedSet.has(a.user_id)).length;

    setPengurusStats({
      totalAktif:     totalAktif    || 0,
      totalPending:   totalPending  || 0,
      scanBulanIni:   scanBulanIni  || 0,
      jadwalBulanIni: jadwalBulanIni|| 0,
      tukarBulanIni:  tukarBulanIni || 0,
      absenBulanIni:  absenCount,
    });
    setLoadingPStats(false);
  }

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            {greeting()}{nama ? `, ${nama}` : ''}! 👋
          </h1>
          <p className="page-subtitle">Serve the Lord with Gladness</p>
        </div>
        {/* Statistik pengurus bulan ini */}
        {isPengurus && (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-gray-900">📊 Statistik Bulan Ini</h2>
              {loadingPStats && <div className="w-4 h-4 border-2 border-brand-300 border-t-brand-800 rounded-full animate-spin"/>}
            </div>
            {pengurusStats ? (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {[
                  { label:'Misdinar Aktif',   val: pengurusStats.totalAktif,     color:'bg-brand-50 text-brand-800',   icon:'👥' },
                  { label:'Pendaftar Baru',    val: pengurusStats.totalPending,   color:'bg-yellow-50 text-yellow-700', icon:'📝' },
                  { label:'Total Scan',        val: pengurusStats.scanBulanIni,   color:'bg-green-50 text-green-700',   icon:'📷' },
                  { label:'Jadwal Dibuat',     val: pengurusStats.jadwalBulanIni, color:'bg-blue-50 text-blue-700',     icon:'📅' },
                  { label:'Tukar Jadwal',      val: pengurusStats.tukarBulanIni,  color:'bg-purple-50 text-purple-700', icon:'🔄' },
                  { label:'Absen Bulan Ini',   val: pengurusStats.absenBulanIni,  color:'bg-red-50 text-red-700',       icon:'❌' },
                ].map(s => (
                  <div key={s.label} className={`${s.color} rounded-xl p-3 text-center`}>
                    <div className="text-base">{s.icon}</div>
                    <div className="text-2xl font-black">{s.val}</div>
                    <div className="text-[10px] font-medium mt-0.5 opacity-80 leading-tight">{s.label}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {[1,2,3,4,5,6].map(i => <div key={i} className="skeleton h-20 rounded-xl"/>)}
              </div>
            )}
          </div>
        )}

        {isPengurus && pendingRegs > 0 && (
          <Link to="/anggota" className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2 hover:bg-yellow-100 transition-colors">
            <Bell size={16} className="text-yellow-600" />
            <span className="text-sm font-semibold text-yellow-700">{pendingRegs} pendaftar baru</span>
          </Link>
        )}
      </div>

      {/* Opt-in window alert */}
      {optinWindow && profile?.role === 'Misdinar_Aktif' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
          <Bell size={20} className="text-blue-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-blue-800">Window Opt-in Misa Harian Terbuka!</p>
            <p className="text-xs text-blue-600">Isi kesediaan kamu untuk Misa Harian bulan depan sebelum tanggal 20.</p>
          </div>
          <Link to="/jadwal-harian" className="btn-primary btn-sm">Isi Sekarang</Link>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={<Star size={20} className="text-yellow-500" />}    label="Total Poin"       value={loadingStats ? '…' : stats.totalPoin}             sub="Akumulasi"      color="bg-yellow-50" />
        <StatCard icon={<Zap size={20} className="text-green-500" />}      label="Poin Minggu Ini"  value={loadingStats ? '…' : (stats.thisWeek?.poin ?? 0)} sub={stats.thisWeek?.kondisi ? `Kondisi ${stats.thisWeek.kondisi}` : 'Belum ada'} color="bg-green-50" />
        <StatCard icon={<Calendar size={20} className="text-blue-500" />}  label="Jadwal Mendatang" value={mySchedule.length}                                 sub="Tugas"          color="bg-blue-50" />
        <StatCard icon={<ArrowLeftRight size={20} className="text-purple-500" />} label="Penawaran" value={swapBoard.length}                                  sub="Tersedia"       color="bg-purple-50" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Misa mendatang */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900 flex items-center gap-2">
                <Calendar size={18} className="text-brand-800" /> Misa Mendatang
              </h2>
              <Link to="/jadwal" className="text-xs text-brand-800 hover:underline flex items-center gap-1">
                Lihat semua <ChevronRight size={14} />
              </Link>
            </div>

            {loadingEvents ? (
              <div className="space-y-3">
                {[1,2,3].map(i => <div key={i} className="skeleton h-16 rounded-lg" />)}
              </div>
            ) : upcomingEvents.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">
                Belum ada jadwal mendatang
              </p>
            ) : (
              <div className="space-y-3">
                {upcomingEvents.map(ev => {
                  const lc = getLiturgyClass(ev.warna_liturgi);
                  return (
                    <div key={ev.id} className={`flex items-center gap-4 p-3 rounded-xl border ${lc.bg} border-gray-100`}>
                      <div className={`w-2 h-12 rounded-full flex-shrink-0 ${lc.dot}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-500 font-medium">{formatDate(ev.tanggal_tugas, 'EEEE, dd MMM yyyy')}</p>
                        <p className="font-semibold text-gray-900 text-sm truncate">{ev.perayaan || ev.nama_event}</p>
                        <p className="text-xs text-gray-400">{ev.tipe_event?.replace('_', ' ')}</p>
                      </div>
                      <span className={`badge text-xs ${lc.text} bg-white/60`}>{ev.warna_liturgi || 'Hijau'}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Jadwal saya */}
          {mySchedule.length > 0 && (
            <div className="card">
              <h2 className="font-bold text-gray-900 flex items-center gap-2 mb-3">
                <Clock size={18} className="text-brand-800" /> Jadwal Kamu
              </h2>
              <div className="space-y-2">
                {mySchedule.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-brand-50 rounded-xl">
                    <CheckCircle size={16} className="text-brand-800 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{a.events?.perayaan || a.events?.nama_event}</p>
                      <p className="text-xs text-gray-500">{formatDate(a.events?.tanggal_tugas, 'EEEE, dd MMM')} · Slot {a.slot_number}</p>
                    </div>
                    <button
                      onClick={() => exportToGCal({
                        title: `[SIGMA] Tugas Misa Slot ${a.slot_number}`,
                        description: `Jadwal tugas misa\nEvent: ${a.events?.perayaan || a.events?.nama_event}`,
                        startDate: a.events?.tanggal_tugas
                          ? `${a.events.tanggal_tugas}T${a.slot_number<=1?'17:30':a.slot_number===2?'06:00':a.slot_number===3?'08:00':'17:30'}`
                          : new Date().toISOString(),
                      })}
                      className="p-1.5 rounded-lg hover:bg-brand-100 transition-colors flex-shrink-0"
                      title="Tambah ke Google Calendar"
                    >
                      <CalendarPlus size={15} className="text-brand-700"/>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Streak Widget — Duolingo style */}
          <StreakWidget/>

          {/* Quick actions */}
          <div className="card">
            <h2 className="font-bold text-gray-900 mb-3 text-xs uppercase tracking-wide text-gray-500">Aksi Cepat</h2>
            <div className="space-y-2">
              {isPelatih && (
                <Link to="/scan-qr" className="flex items-center gap-3 p-3 rounded-xl bg-brand-800 text-white hover:bg-brand-900 transition-colors">
                  <QrCode size={18} />
                  <span className="text-sm font-semibold">Scan QR Absensi</span>
                  <ChevronRight size={16} className="ml-auto" />
                </Link>
              )}
              {isPengurus && (
                <Link to="/jadwal-mingguan" className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
                  <Calendar size={18} className="text-brand-800" />
                  <span className="text-sm font-medium text-gray-700">Buat Jadwal</span>
                  <ChevronRight size={16} className="ml-auto text-gray-400" />
                </Link>
              )}
              <Link to="/tukar-jadwal" className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
                <ArrowLeftRight size={18} className="text-brand-800" />
                <span className="text-sm font-medium text-gray-700">Tukar Jadwal</span>
                <ChevronRight size={16} className="ml-auto text-gray-400" />
              </Link>
              <Link to="/kartu" className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
                <QrCode size={18} className="text-brand-800" />
                <span className="text-sm font-medium text-gray-700">Kartu Anggota</span>
                <ChevronRight size={16} className="ml-auto text-gray-400" />
              </Link>
              <InstallAppButton/>

            </div>
          </div>

          {/* Swap board preview */}
          {swapBoard.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-gray-900 text-sm flex items-center gap-2">
                  <AlertTriangle size={16} className="text-orange-500" /> Penawaran Tugas
                </h2>
                <Link to="/tukar-jadwal" className="text-xs text-brand-800 hover:underline">Lihat semua</Link>
              </div>
              <div className="space-y-2">
                {swapBoard.slice(0,3).map(s => (
                  <div key={s.id} className="p-2.5 bg-orange-50 rounded-lg border border-orange-100">
                    <p className="text-xs font-semibold text-gray-800">{s.requester?.nama_panggilan}</p>
                    <p className="text-xs text-gray-500">{s.assignment?.events?.nama_event} · Slot {s.assignment?.slot_number}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Poin history */}
          {stats.history.length > 0 && (
            <div className="card">
              <h2 className="font-bold text-gray-900 mb-3 text-sm flex items-center gap-2">
                <Trophy size={16} className="text-yellow-500" /> Riwayat Poin
              </h2>
              <div className="space-y-1.5">
                {stats.history.slice(0,5).map((r, i) => {
                  const kl = KONDISI_LABELS[r.kondisi];
                  return (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">{formatDate(r.week_start, 'dd MMM')}</span>
                      <span className={kl?.color || 'text-gray-400'}>{kl?.icon} {kl?.label || '—'}</span>
                      <span className={`font-bold ${r.poin > 0 ? 'text-green-600' : r.poin < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {r.poin > 0 ? '+' : ''}{r.poin}
                      </span>
                    </div>
                  );
                })}
              </div>
              <Link to="/rekap" className="mt-3 text-xs text-brand-800 hover:underline flex items-center gap-1">
                Lihat rekap lengkap <ChevronRight size={12} />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }) {
  return (
    <div className={`card ${color} border-0`}>
      <div>{icon}</div>
      <div className="mt-3">
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        <div className="text-xs font-semibold text-gray-700 mt-0.5">{label}</div>
        <div className="text-xs text-gray-400">{sub}</div>
      </div>
    </div>
  );
}

// ── Tombol install app (muncul jika belum install, hilang jika sudah) ──
function InstallAppButton() {
  const [prompt,    setPrompt]    = React.useState(null);
  const [installed, setInstalled] = React.useState(false);

  React.useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone) { setInstalled(true); return; }
    const h = e => { e.preventDefault(); setPrompt(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  if (installed) return null;

  const handleInstall = async () => {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setPrompt(null);
  };

  // iOS: tidak ada prompt, tampilkan petunjuk
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIOS) return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-50 border border-blue-100">
      <Smartphone size={18} className="text-blue-600 shrink-0"/>
      <div className="flex-1">
        <p className="text-xs font-semibold text-blue-800">Install di iPhone</p>
        <p className="text-[11px] text-blue-600">Share ⬆ → "Tambahkan ke Layar Utama"</p>
      </div>
    </div>
  );

  if (!prompt) return null;

  return (
    <button onClick={handleInstall}
      className="flex items-center gap-3 p-3 rounded-xl bg-blue-50 hover:bg-blue-100
        border border-blue-100 transition-colors w-full text-left">
      <Download size={18} className="text-blue-600 shrink-0"/>
      <div className="flex-1">
        <p className="text-sm font-medium text-blue-800">Install Aplikasi SIGMA</p>
        <p className="text-xs text-blue-500">Tambahkan ke home screen HP</p>
      </div>
      <ChevronRight size={16} className="text-blue-400"/>
    </button>
  );
}
