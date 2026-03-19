import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, getLiturgyClass, formatHP, buildWALink } from '../lib/utils';
import { getLiturgiByDate, getLiturgiByMonth, HARI_RAYA_NO_HARIAN } from '../lib/liturgiData2026';
import { toPng } from 'html-to-image';
import {
  CalendarDays, Download, Zap, ChevronLeft, ChevronRight,
  Bell, CheckCircle, XCircle, Clock, RefreshCw, Users,
  AlertTriangle, FileEdit, Globe, Check, X,
} from 'lucide-react';
import toast from 'react-hot-toast';

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const HARI   = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

// ─── helper: last day of month ──────────────────────────────
function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// ─── helper: local ISO string ───────────────────────────────
function toLocalISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

// ─── Get all weekdays (Senin-Jumat) of a month ──────────────
function getWeekdays(year, month) {
  const days = [];
  const total = lastDayOfMonth(year, month);
  for (let d = 1; d <= total; d++) {
    const date = new Date(year, month - 1, d);
    const dow  = date.getDay(); // 0=Minggu 6=Sabtu
    if (dow >= 1 && dow <= 5) { // Senin–Jumat
      days.push({ date: toLocalISO(date), dow });
    }
  }
  return days;
}

// ─── Status label opt-in ────────────────────────────────────
const OPTIN_LABELS = {
  Bisa:        { label: 'Bisa',         color: 'badge-green', icon: <CheckCircle size={13}/> },
  Tidak_Bisa:  { label: 'Tidak Bisa',   color: 'badge-red',   icon: <XCircle size={13}/> },
  Pas_Libur:   { label: 'Pas Libur',    color: 'badge-yellow',icon: <Clock size={13}/> },
};

// ═══════════════════════════════════════════════════════════
export function ScheduleDailyPage() {
  const { profile, isPengurus } = useAuth();

  const [tab,      setTab]      = useState('jadwal');  // jadwal | optin
  const [month,    setMonth]    = useState(new Date().getMonth() + 1);
  const [year,     setYear]     = useState(new Date().getFullYear());
  const [events,   setEvents]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [generating, setGen]    = useState(false);

  // Opt-in states
  const [myOptin,    setMyOptin]   = useState(null);    // own status
  const [optinList,  setOptinList] = useState([]);      // all members (pengurus)
  const [loadingOpt, setLoadingOpt]= useState(false);

  // Opt-in window check
  const today   = new Date();
  const thisDay = today.getDate();
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  const isOptinWindow = thisDay >= 10 && thisDay <= 20; // window 10-20 tiap bulan

  const tableRef = useRef(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    const padM    = String(month).padStart(2,'0');
    const start   = `${year}-${padM}-01`;
    const lastDay = lastDayOfMonth(year, month);
    const end     = `${year}-${padM}-${String(lastDay).padStart(2,'0')}`;
    const { data, error } = await supabase
      .from('events')
      .select(`*, assignments(user_id, users(nama_lengkap, nama_panggilan, lingkungan, pendidikan))`)
      .eq('tipe_event', 'Misa_Harian')
      .gte('tanggal_tugas', start)
      .lte('tanggal_tugas', end)
      .order('tanggal_tugas');
    if (error) toast.error('Gagal load: ' + error.message);
    setEvents(data || []);
    setLoading(false);
  }, [month, year]);

  useEffect(() => { loadEvents(); }, [loadEvents]);
  useEffect(() => { if (tab === 'optin') loadOptinList(); }, [tab, month, year]);

  // Cek opt-in sendiri
  useEffect(() => {
    if (!profile) return;
    supabase.from('misa_harian_availability')
      .select('status, tanggal_tidak_bisa')
      .eq('user_id', profile.id)
      .eq('tahun', nextYear)
      .eq('bulan', nextMonth)
      .maybeSingle()
      .then(({ data }) => setMyOptin(data));
  }, [profile, nextMonth, nextYear]);

  async function loadOptinList() {
    setLoadingOpt(true);
    const { data: users } = await supabase
      .from('users')
      .select('id, nickname, nama_panggilan, lingkungan, pendidikan, is_tarakanita')
      .eq('status', 'Active')
      .order('nama_panggilan');

    const { data: optins } = await supabase
      .from('misa_harian_availability')
      .select('user_id, status, tanggal_tidak_bisa')
      .eq('tahun', nextYear)
      .eq('bulan', nextMonth);

    const optinMap = {};
    (optins || []).forEach(o => { optinMap[o.user_id] = o; });

    const merged = (users || []).map(u => ({
      ...u,
      optin: optinMap[u.id] || null,
    }));
    setOptinList(merged);
    setLoadingOpt(false);
  }

  // Simpan opt-in (user sendiri)
  async function saveOptin(status) {
    if (!profile) return;
    const { error } = await supabase.from('misa_harian_availability').upsert({
      user_id: profile.id,
      tahun:   nextYear,
      bulan:   nextMonth,
      status,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,tahun,bulan' });
    if (error) { toast.error('Gagal simpan: ' + error.message); return; }
    setMyOptin({ status });
    toast.success(`Opt-in disimpan: ${OPTIN_LABELS[status]?.label}`);
  }

  // ── Generate Jadwal Harian ────────────────────────────────
  async function generateHarian() {
    setGen(true);
    const tid = 'gen-harian';
    try {
      toast.loading('Mengambil pool peserta...', { id: tid });

      // Pool: Tarakanita otomatis + opt-in Bisa/Pas_Libur
      const { data: optins } = await supabase
        .from('misa_harian_availability')
        .select('user_id, status, tanggal_tidak_bisa')
        .eq('tahun', year)
        .eq('bulan', month)
        .in('status', ['Bisa', 'Pas_Libur']);

      const { data: tarakanita } = await supabase
        .from('users')
        .select('id, nickname, nama_panggilan, lingkungan, pendidikan')
        .eq('is_tarakanita', true)
        .eq('status', 'Active')
        .eq('is_suspended', false);

      const { data: optinUsers } = await supabase
        .from('users')
        .select('id, nickname, nama_panggilan, lingkungan, pendidikan')
        .in('id', (optins || []).map(o => o.user_id))
        .eq('status', 'Active')
        .eq('is_suspended', false);

      // Gabungkan pool (dedup)
      const poolMap = {};
      [...(tarakanita || []), ...(optinUsers || [])].forEach(u => { poolMap[u.id] = u; });
      const pool = Object.values(poolMap);

      if (pool.length === 0) {
        toast.error('Tidak ada peserta di pool! Pastikan ada yang opt-in atau Tarakanita.', { id: tid });
        return;
      }

      // Buat tanggal tidak bisa per user (dari opt-in data)
      const tidakBisaMap = {};
      (optins || []).forEach(o => {
        if (o.tanggal_tidak_bisa) tidakBisaMap[o.user_id] = o.tanggal_tidak_bisa;
      });

      const weekdays = getWeekdays(year, month);
      toast.loading(`Generate ${weekdays.length} hari kerja...`, { id: tid });

      let poolIdx = 0, created = 0, skipped = 0;

      for (const { date, dow } of weekdays) {
        // Skip Hari Raya yang sudah dikonfigurasi tanpa Misa Harian
        if (HARI_RAYA_NO_HARIAN.includes(date)) { skipped++; continue; }

        // Skip jika event sudah ada
        const { data: existing } = await supabase.from('events')
          .select('id').eq('tipe_event', 'Misa_Harian').eq('tanggal_tugas', date).maybeSingle();
        if (existing) continue;

        // Ambil data liturgi dari data statis 2026
        const liturgi = getLiturgiByDate(date);
        const namaHari  = HARI[dow];
        const perayaan  = liturgi?.name ? `${namaHari} — ${liturgi.name}` : namaHari;
        const warna     = liturgi?.color || 'Hijau';

        // Insert event harian
        const { data: ev, error: evErr } = await supabase.from('events').insert({
          nama_event:     perayaan.toUpperCase(),
          tipe_event:     'Misa_Harian',
          tanggal_tugas:  date,
          hari:           namaHari,
          perayaan,
          warna_liturgi:  warna,
          jumlah_misa:    1,
          status_event:   'Akan_Datang',
          is_draft:       true,
          gcatholic_fetched: true,
        }).select().single();
        if (evErr) { console.error('Event err:', evErr.message); continue; }

        // Pilih 2-3 petugas dari pool yang bisa di tanggal ini
        const available = pool.filter(u => {
          const tidakBisa = tidakBisaMap[u.id] || [];
          return !tidakBisa.includes(date);
        });

        // Assign 2 petugas (minimum), jika pool kecil bisa 1
        const assigns = [];
        const count   = Math.min(2, available.length);
        for (let i = 0; i < count; i++) {
          const u = available[poolIdx % available.length];
          poolIdx++;
          assigns.push({ event_id: ev.id, user_id: u.id, slot_number: 1, position: i + 1 });
        }
        if (assigns.length) await supabase.from('assignments').insert(assigns);
        created++;
      }

      toast.success(
        `✅ ${created} event harian dibuat${skipped > 0 ? `, ${skipped} hari raya diskip` : ''}. Cek draft dan publish!`,
        { id: tid, duration: 5000 }
      );
      loadEvents();
    } catch (err) {
      toast.error('Gagal: ' + err.message, { id: tid });
    } finally {
      setGen(false);
    }
  }

  // ── Publish semua event harian ────────────────────────────
  async function publishAllHarian() {
    const drafts = events.filter(e => e.is_draft);
    if (!drafts.length) { toast('Tidak ada draft'); return; }
    if (!confirm(`Publish ${drafts.length} event Misa Harian bulan ini?`)) return;
    const ids = drafts.map(e => e.id);
    const { error } = await supabase.from('events')
      .update({ is_draft: false, published_at: new Date().toISOString() })
      .in('id', ids);
    if (error) { toast.error(error.message); return; }
    toast.success(`${drafts.length} jadwal harian dipublish! ✅`);
    loadEvents();
  }

  // ── Export PNG ────────────────────────────────────────────
  async function exportPNG() {
    if (!tableRef.current) return;
    try {
      const png = await toPng(tableRef.current, { pixelRatio: 2, backgroundColor: '#ffffff' });
      const a = document.createElement('a');
      a.href = png; a.download = `jadwal-harian-${MONTHS[month-1]}-${year}.png`; a.click();
      toast.success('PNG berhasil diunduh!');
    } catch { toast.error('Gagal export'); }
  }

  const draftCount = events.filter(e => e.is_draft).length;
  const pubCount   = events.filter(e => !e.is_draft).length;

  // Statistik opt-in
  const optinStats = {
    total:      optinList.length,
    bisa:       optinList.filter(u => u.optin?.status === 'Bisa').length,
    tidakBisa:  optinList.filter(u => u.optin?.status === 'Tidak_Bisa').length,
    pasLibur:   optinList.filter(u => u.optin?.status === 'Pas_Libur').length,
    belumIsi:   optinList.filter(u => !u.optin).length,
    tarakanita: optinList.filter(u => u.is_tarakanita).length,
  };

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <CalendarDays size={24} className="text-brand-800"/> Misa Harian
          </h1>
          <p className="page-subtitle">Senin–Jumat · Opt-in · Generate Manual</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <button onClick={() => { if(month===1){setMonth(12);setYear(y=>y-1);}else setMonth(m=>m-1); }} className="btn-ghost p-2"><ChevronLeft size={18}/></button>
          <span className="font-semibold text-gray-700 w-36 text-center">{MONTHS[month-1]} {year}</span>
          <button onClick={() => { if(month===12){setMonth(1);setYear(y=>y+1);}else setMonth(m=>m+1); }} className="btn-ghost p-2"><ChevronRight size={18}/></button>
          {isPengurus && (
            <>
              <button onClick={loadEvents} className="btn-ghost p-2"><RefreshCw size={16}/></button>
              <button onClick={generateHarian} disabled={generating} className="btn-primary gap-2">
                <Zap size={16}/> {generating ? 'Generating...' : 'Generate Harian'}
              </button>
              {draftCount > 0 && (
                <button onClick={publishAllHarian} className="btn-outline gap-2">
                  <Globe size={16}/> Publish Semua ({draftCount})
                </button>
              )}
              <button onClick={exportPNG} className="btn-outline gap-2"><Download size={16}/> PNG</button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {[
          { key: 'jadwal', label: '📅 Jadwal' },
          { key: 'optin',  label: `👥 Opt-in ${MONTHS[nextMonth-1]}` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab===t.key?'bg-white text-brand-800 shadow-sm':'text-gray-500'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── TAB JADWAL ─── */}
      {tab === 'jadwal' && (
        <>
          {/* Status chips */}
          {events.length > 0 && (
            <div className="flex gap-3 flex-wrap">
              {draftCount > 0 && (
                <div className="flex items-center gap-1.5 bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-1.5 text-sm">
                  <FileEdit size={13} className="text-yellow-600"/> {draftCount} draft
                </div>
              )}
              {pubCount > 0 && (
                <div className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-xl px-3 py-1.5 text-sm">
                  <Globe size={13} className="text-green-600"/> {pubCount} published
                </div>
              )}
            </div>
          )}

          {/* Opt-in window alert (untuk anggota biasa) */}
          {!isPengurus && isOptinWindow && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
              <Bell size={18} className="text-blue-600 flex-shrink-0"/>
              <div className="flex-1">
                <p className="text-sm font-semibold text-blue-800">
                  Isi Opt-in Misa Harian {MONTHS[nextMonth-1]} {nextYear}
                </p>
                <p className="text-xs text-blue-600 mt-0.5">
                  Window terbuka s/d tanggal 20. Status sekarang:{' '}
                  {myOptin
                    ? <strong>{OPTIN_LABELS[myOptin.status]?.label}</strong>
                    : <strong className="text-red-500">Belum diisi</strong>
                  }
                </p>
              </div>
              <div className="flex gap-2">
                {['Bisa','Tidak_Bisa','Pas_Libur'].map(s => (
                  <button key={s}
                    onClick={() => saveOptin(s)}
                    className={`btn-sm ${myOptin?.status===s ? 'btn-primary' : 'btn-outline'}`}>
                    {OPTIN_LABELS[s]?.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tarakanita badge */}
          {profile?.is_tarakanita && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center gap-2">
              <CheckCircle size={16} className="text-blue-600"/>
              <p className="text-sm text-blue-700">
                Kamu terdaftar sebagai siswa <strong>Tarakanita</strong> — otomatis masuk pool Misa Harian tanpa opt-in.
              </p>
            </div>
          )}

          {/* Jadwal table */}
          <div className="card overflow-hidden p-0" ref={tableRef}>
            <div className="px-4 py-3 bg-brand-800 text-white">
              <p className="font-bold text-center text-lg tracking-wide">
                JADWAL MISA HARIAN — {MONTHS[month-1].toUpperCase()} {year}
              </p>
            </div>
            <div className="overflow-x-auto">
              {loading ? (
                <div className="p-8 text-center text-gray-400">Memuat...</div>
              ) : events.length === 0 ? (
                <div className="p-10 text-center">
                  <CalendarDays size={40} className="mx-auto text-gray-300 mb-3"/>
                  <p className="text-gray-500">Belum ada jadwal Misa Harian {MONTHS[month-1]} {year}</p>
                  {isPengurus && (
                    <button onClick={generateHarian} disabled={generating} className="btn-primary mt-4 gap-2">
                      <Zap size={16}/> Generate Sekarang
                    </button>
                  )}
                </div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Tanggal</th>
                      <th>Hari</th>
                      <th>Warna Liturgi</th>
                      <th>Perayaan</th>
                      <th>Petugas</th>
                      <th>Lingkungan</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map(ev => {
                      const lc    = getLiturgyClass(ev.warna_liturgi);
                      const asgns = ev.assignments || [];
                      const d = new Date(ev.tanggal_tugas + 'T00:00:00');
                      return asgns.length === 0 ? (
                        <tr key={ev.id} className={lc.bg}>
                          <td className={`font-bold ${lc.text}`}>{formatDate(ev.tanggal_tugas, 'dd')}</td>
                          <td>{HARI[d.getDay()]}</td>
                          <td>
                            <div className="flex items-center gap-1.5">
                              <div className={`w-3 h-3 rounded-full ${lc.dot}`}/>
                              <span className="text-xs">{ev.warna_liturgi}</span>
                            </div>
                          </td>
                          <td className="text-xs">{ev.perayaan || '—'}</td>
                          <td className="text-orange-400 text-xs italic">Belum ada petugas</td>
                          <td>—</td>
                          <td>{ev.is_draft
                            ? <span className="badge-yellow text-xs">Draft</span>
                            : <span className="badge-green text-xs">Published</span>
                          }</td>
                        </tr>
                      ) : asgns.map((a, i) => (
                        <tr key={`${ev.id}-${i}`} className={lc.bg}>
                          {i === 0 && (
                            <>
                              <td rowSpan={asgns.length} className={`font-bold ${lc.text}`}>
                                {formatDate(ev.tanggal_tugas, 'dd')}
                              </td>
                              <td rowSpan={asgns.length}>{HARI[d.getDay()]}</td>
                              <td rowSpan={asgns.length}>
                                <div className="flex items-center gap-1.5">
                                  <div className={`w-3 h-3 rounded-full ${lc.dot}`}/>
                                  <span className="text-xs">{ev.warna_liturgi}</span>
                                </div>
                              </td>
                              <td rowSpan={asgns.length} className="text-xs">{ev.perayaan || '—'}</td>
                            </>
                          )}
                          <td className="font-medium text-sm">{a.users?.nama_panggilan || '—'}</td>
                          <td className="text-xs text-gray-500">{a.users?.lingkungan || '—'}</td>
                          {i === 0 && (
                            <td rowSpan={asgns.length}>
                              {ev.is_draft
                                ? <span className="badge-yellow text-xs">Draft</span>
                                : <span className="badge-green text-xs">Published</span>
                              }
                            </td>
                          )}
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      {/* ─── TAB OPT-IN ─── */}
      {tab === 'optin' && (
        <div className="space-y-4">
          {/* Header info */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-amber-800">
              Rekap Opt-in Misa Harian — {MONTHS[nextMonth-1]} {nextYear}
            </p>
            <p className="text-xs text-amber-700 mt-1">
              Window opt-in terbuka tanggal 10–20 setiap bulan.
              {isOptinWindow
                ? ' 🟢 Window SEDANG BUKA sekarang.'
                : ' 🔴 Window sedang tutup.'}
            </p>
          </div>

          {/* Summary cards */}
          {isPengurus && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: 'Total',       value: optinStats.total,      color: 'bg-gray-50' },
                { label: 'Bisa',        value: optinStats.bisa,       color: 'bg-green-50' },
                { label: 'Tidak Bisa',  value: optinStats.tidakBisa,  color: 'bg-red-50' },
                { label: 'Pas Libur',   value: optinStats.pasLibur,   color: 'bg-yellow-50' },
                { label: 'Belum Isi',   value: optinStats.belumIsi,   color: 'bg-orange-50' },
              ].map(s => (
                <div key={s.label} className={`card ${s.color} border-0 text-center p-3`}>
                  <div className="text-2xl font-black text-gray-800">{s.value}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Opt-in sendiri (non-pengurus) */}
          {!isPengurus && (
            <div className="card">
              <h3 className="font-semibold text-gray-700 mb-3">
                Status Opt-in Kamu — {MONTHS[nextMonth-1]} {nextYear}
              </h3>
              <div className="flex gap-3 flex-wrap">
                {['Bisa','Tidak_Bisa','Pas_Libur'].map(s => {
                  const info = OPTIN_LABELS[s];
                  return (
                    <button key={s} onClick={() => saveOptin(s)}
                      className={`flex items-center gap-2 px-4 py-3 rounded-xl border-2 transition-all ${
                        myOptin?.status === s
                          ? 'border-brand-800 bg-brand-50 font-bold'
                          : 'border-gray-200 hover:border-brand-400'
                      }`}>
                      {info.icon}
                      <span className="text-sm">{info.label}</span>
                      {myOptin?.status === s && <Check size={14} className="text-brand-800"/>}
                    </button>
                  );
                })}
              </div>
              {profile?.is_tarakanita && (
                <p className="text-xs text-blue-600 mt-3 flex items-center gap-1">
                  <CheckCircle size={12}/> Kamu Tarakanita — otomatis masuk pool meski tidak opt-in.
                </p>
              )}
            </div>
          )}

          {/* Tabel rekap (pengurus) */}
          {isPengurus && (
            <div className="card overflow-hidden p-0">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-700 flex items-center gap-2">
                  <Users size={16} className="text-brand-800"/> Daftar Opt-in Anggota
                </h3>
                <button onClick={loadOptinList} className="btn-ghost p-1.5"><RefreshCw size={14}/></button>
              </div>
              <div className="overflow-x-auto max-h-[60vh]">
                {loadingOpt ? (
                  <div className="p-8 text-center text-gray-400">Memuat...</div>
                ) : (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Nama</th>
                        <th>Lingkungan</th>
                        <th>Pendidikan</th>
                        <th>Status Opt-in</th>
                        <th>Keterangan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {optinList.map(u => {
                        const optin = u.optin;
                        const info  = optin ? OPTIN_LABELS[optin.status] : null;
                        return (
                          <tr key={u.id}>
                            <td>
                              <div className="flex items-center gap-2">
                                <div className="font-medium text-gray-900">{u.nama_panggilan}</div>
                                {u.is_tarakanita && <span className="badge-blue text-[10px]">T</span>}
                              </div>
                              <div className="text-xs text-gray-400">@{u.nickname}</div>
                            </td>
                            <td className="text-sm text-gray-600">{u.lingkungan}</td>
                            <td><span className="badge-gray">{u.pendidikan||'—'}</span></td>
                            <td>
                              {u.is_tarakanita ? (
                                <span className="badge-blue flex items-center gap-1 w-fit">
                                  <CheckCircle size={11}/> Otomatis
                                </span>
                              ) : info ? (
                                <span className={`badge ${info.color} flex items-center gap-1 w-fit`}>
                                  {info.icon} {info.label}
                                </span>
                              ) : (
                                <span className="badge-gray flex items-center gap-1 w-fit text-orange-500">
                                  <AlertTriangle size={11}/> Belum isi
                                </span>
                              )}
                            </td>
                            <td className="text-xs text-gray-400">
                              {optin?.tanggal_tidak_bisa?.length > 0
                                ? `Tidak bisa: ${optin.tanggal_tidak_bisa.slice(0,3).join(', ')}...`
                                : '—'
                              }
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Public schedule page ────────────────────────────────────
export function PublicSchedulePage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoad]  = useState(true);

  useEffect(() => {
    const today = new Date();
    const start = toLocalISO(today);
    supabase.from('events')
      .select(`*, assignments(slot_number, users(nama_panggilan))`)
      .gte('tanggal_tugas', start)
      .not('tipe_event', 'eq', 'Misa_Harian')
      .eq('is_draft', false)
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
        {loading ? [1,2,3].map(i=><div key={i} className="skeleton h-40 rounded-xl"/>) :
         events.map(ev => {
          const asgn = ev.assignments || [];
          return (
            <div key={ev.id} className="card">
              <h3 className="font-bold text-gray-900">{ev.perayaan || ev.nama_event}</h3>
              <p className="text-sm text-gray-500 mb-3">{formatDate(ev.tanggal_tugas,'EEEE, dd MMMM yyyy')}</p>
              {[1,2,3,4].map(slot => {
                const names = asgn.filter(a=>a.slot_number===slot).map(a=>a.users?.nama_panggilan);
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
          <p className="text-xs text-gray-400 mt-3">
            Daftar? <a href="/daftar" className="text-brand-800 underline">Klik di sini</a>
          </p>
        </div>
      </div>
    </div>
  );
}

// 404 page
import { Church } from 'lucide-react';
export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-brand-800 flex items-center justify-center text-white text-center p-6">
      <div>
        <Church size={48} className="mx-auto mb-4 text-brand-200"/>
        <h1 className="text-6xl font-black mb-2">404</h1>
        <p className="text-brand-200 text-lg mb-6">Halaman tidak ditemukan</p>
        <a href="/dashboard" className="bg-white text-brand-800 font-bold px-6 py-3 rounded-xl hover:bg-brand-50">Kembali ke Dashboard</a>
      </div>
    </div>
  );
}

export default ScheduleDailyPage;
