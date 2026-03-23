import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, getLiturgyClass } from '../lib/utils';
import { getLiturgiByDate, getLiturgiByMonth, HARI_RAYA_NO_HARIAN } from '../lib/liturgiData2026';
import { toPng } from 'html-to-image';
import {
  CalendarDays, Download, Zap, ChevronLeft, ChevronRight,
  Bell, CheckCircle, XCircle, Clock, RefreshCw, Users,
  AlertTriangle, FileEdit, Globe, Check, X, Edit2, Search, Church, CalendarPlus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { exportToGCal } from '../lib/calendarExport';

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const HARI   = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

function lastDayOfMonth(year, month) { return new Date(year, month, 0).getDate(); }
function toLocalISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function getWeekdays(year, month) {
  const days = [];
  const total = lastDayOfMonth(year, month);
  for (let d = 1; d <= total; d++) {
    const date = new Date(year, month - 1, d);
    const dow  = date.getDay();
    if (dow >= 1 && dow <= 5) days.push({ date: toLocalISO(date), dow });
  }
  return days;
}

const OPTIN_LABELS = {
  Bisa:       { label: 'Bisa',       color: 'badge-green',  icon: '✅' },
  Tidak_Bisa: { label: 'Tidak Bisa', color: 'badge-red',    icon: '❌' },
  Pas_Libur:  { label: 'Pas Libur',  color: 'badge-yellow', icon: '🏖️' },
};

// ═══════════════════════════════════════════════════════════════
export function ScheduleDailyPage() {
  const { profile, isPengurus } = useAuth();

  const [tab,      setTab]      = useState('jadwal');
  const [month,    setMonth]    = useState(new Date().getMonth() + 1);
  const [year,     setYear]     = useState(new Date().getFullYear());
  const [events,   setEvents]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [generating, setGen]    = useState(false);

  // Opt-in
  const [myOptin,      setMyOptin]    = useState(null);
  const [optinList,    setOptinList]  = useState([]);
  const [loadingOpt,   setLoadingOpt] = useState(false);
  const [editOptinId,  setEditOptinId]= useState(null);  // user_id yang sedang diedit pengurus
  const [searchOptin,  setSearchOptin]= useState('');

  const tableRef = useRef(null);

  // Target bulan opt-in = bulan berikutnya dari bulan yang dipilih
  const nextMonth = month === 12 ? 1  : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  const thisDay   = new Date().getDate();
  const isOptinWindow = thisDay >= 10 && thisDay <= 20;

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
  useEffect(() => {
    if (!profile) return;
    supabase.from('misa_harian_availability')
      .select('status, tanggal_tidak_bisa')
      .eq('user_id', profile.id)
      .eq('tahun', nextYear).eq('bulan', nextMonth)
      .maybeSingle()
      .then(({ data }) => setMyOptin(data));
  }, [profile, nextMonth, nextYear]);

  async function loadOptinList() {
    setLoadingOpt(true);
    const { data: users } = await supabase
      .from('users')
      .select('id, nickname, nama_panggilan, lingkungan, pendidikan, is_tarakanita')
      .eq('status', 'Active').order('nama_panggilan');
    const { data: optins } = await supabase
      .from('misa_harian_availability')
      .select('user_id, status, tanggal_tidak_bisa')
      .eq('tahun', nextYear).eq('bulan', nextMonth);
    const optinMap = {};
    (optins || []).forEach(o => { optinMap[o.user_id] = o; });
    setOptinList((users || []).map(u => ({ ...u, optin: optinMap[u.id] || null })));
    setLoadingOpt(false);
  }

  // ── Simpan opt-in (user sendiri) ────────────────────────
  async function saveOptin(status) {
    if (!profile) return;
    const { error } = await supabase.from('misa_harian_availability').upsert({
      user_id: profile.id, tahun: nextYear, bulan: nextMonth, status,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,tahun,bulan' });
    if (error) { toast.error(error.message); return; }
    setMyOptin({ status });
    toast.success(`Opt-in: ${OPTIN_LABELS[status]?.label}`);
  }

  // ── Edit opt-in oleh Pengurus/Admin untuk user lain ─────
  async function saveOptinForUser(userId, status) {
    const { error } = await supabase.from('misa_harian_availability').upsert({
      user_id: userId, tahun: nextYear, bulan: nextMonth, status,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,tahun,bulan' });
    if (error) { toast.error(error.message); return; }
    // Update local state
    setOptinList(list => list.map(u =>
      u.id === userId ? { ...u, optin: { ...u.optin, status } } : u
    ));
    setEditOptinId(null);
    toast.success('Status opt-in diperbarui');
  }

  // ── Bulk set: set semua yang belum isi ──────────────────
  async function bulkSetOptin(status) {
    const belumIsi = optinList.filter(u => !u.optin && !u.is_tarakanita);
    if (!belumIsi.length) { toast('Semua sudah mengisi opt-in'); return; }
    if (!confirm(`Set ${belumIsi.length} anggota yang belum isi ke "${OPTIN_LABELS[status]?.label}"?`)) return;

    const upserts = belumIsi.map(u => ({
      user_id: u.id, tahun: nextYear, bulan: nextMonth, status,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('misa_harian_availability').upsert(upserts, { onConflict: 'user_id,tahun,bulan' });
    if (error) { toast.error(error.message); return; }
    toast.success(`${belumIsi.length} anggota di-set ke ${OPTIN_LABELS[status]?.label}`);
    loadOptinList();
  }

  // ── Generate Jadwal Harian ───────────────────────────────
  async function generateHarian() {
    setGen(true);
    const tid = 'gen-harian';
    try {
      toast.loading('Mengambil pool peserta...', { id: tid });
      const { data: optins } = await supabase.from('misa_harian_availability')
        .select('user_id, status, tanggal_tidak_bisa')
        .eq('tahun', year).eq('bulan', month)
        .in('status', ['Bisa', 'Pas_Libur']);
      const { data: tarakanita } = await supabase.from('users')
        .select('id, nickname, nama_panggilan, lingkungan, pendidikan')
        .eq('is_tarakanita', true).eq('status', 'Active').eq('is_suspended', false)
        .in('role', ['Misdinar_Aktif','Misdinar_Retired']);
      const { data: optinUsers } = optins?.length
        ? await supabase.from('users')
            .select('id, nickname, nama_panggilan, lingkungan, pendidikan')
            .in('id', optins.map(o => o.user_id))
            .eq('status', 'Active').eq('is_suspended', false)
        : { data: [] };

      const poolMap = {};
      [...(tarakanita||[]), ...(optinUsers||[])].forEach(u => { poolMap[u.id] = u; });
      const pool = Object.values(poolMap);
      if (!pool.length) {
        toast.error('Pool kosong! Tidak ada yang opt-in atau Tarakanita.', { id: tid }); return;
      }
      const tidakBisaMap = {};
      (optins||[]).forEach(o => { if (o.tanggal_tidak_bisa) tidakBisaMap[o.user_id] = o.tanggal_tidak_bisa; });

      const weekdays = getWeekdays(year, month);
      toast.loading(`Generate ${weekdays.length} hari (${pool.length} orang di pool)...`, { id: tid });
      let poolIdx = 0, created = 0, skipped = 0;

      for (const { date, dow } of weekdays) {
        if (HARI_RAYA_NO_HARIAN.includes(date)) { skipped++; continue; }
        const { data: existing } = await supabase.from('events')
          .select('id').eq('tipe_event','Misa_Harian').eq('tanggal_tugas', date).maybeSingle();
        if (existing) continue;

        const liturgi  = getLiturgiByDate(date);
        const namaHari = HARI[dow];
        const perayaan = liturgi?.name ? `${namaHari} — ${liturgi.name}` : namaHari;
        const warna    = liturgi?.color || 'Hijau';

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
        if (evErr) { console.error(evErr.message); continue; }

        const available = pool.filter(u => !(tidakBisaMap[u.id]||[]).includes(date));
        const count     = Math.min(2, available.length);
        const assigns   = [];
        for (let i = 0; i < count; i++) {
          const u = available[poolIdx % available.length];
          poolIdx++;
          assigns.push({ event_id: ev.id, user_id: u.id, slot_number: 1, position: i+1 });
        }
        if (assigns.length) await supabase.from('assignments').insert(assigns);
        created++;
      }

      toast.success(
        `✅ ${created} event dibuat${skipped ? `, ${skipped} hari raya diskip` : ''}!`,
        { id: tid, duration: 5000 }
      );
      loadEvents();
    } catch (err) {
      toast.error('Gagal: ' + err.message, { id: tid });
    } finally { setGen(false); }
  }

  async function publishAllHarian() {
    const drafts = events.filter(e => e.is_draft);
    if (!drafts.length) { toast('Tidak ada draft'); return; }
    if (!confirm(`Publish ${drafts.length} event Misa Harian?`)) return;
    const { error } = await supabase.from('events')
      .update({ is_draft: false, published_at: new Date().toISOString() })
      .in('id', drafts.map(e => e.id));
    if (error) { toast.error(error.message); return; }
    toast.success(`${drafts.length} jadwal dipublish! ✅`);
    loadEvents();
  }

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

  const optinStats = {
    bisa:      optinList.filter(u => u.optin?.status === 'Bisa').length,
    tidakBisa: optinList.filter(u => u.optin?.status === 'Tidak_Bisa').length,
    pasLibur:  optinList.filter(u => u.optin?.status === 'Pas_Libur').length,
    belumIsi:  optinList.filter(u => !u.optin && !u.is_tarakanita).length,
    tarakanita:optinList.filter(u => u.is_tarakanita).length,
  };

  const filteredOptin = optinList.filter(u =>
    !searchOptin ||
    u.nama_panggilan?.toLowerCase().includes(searchOptin.toLowerCase()) ||
    u.nickname?.toLowerCase().includes(searchOptin.toLowerCase()) ||
    u.lingkungan?.toLowerCase().includes(searchOptin.toLowerCase())
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Misa Harian</h1>
          <p className="page-subtitle">Senin–Jumat · Opt-in · Generate Manual</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <button onClick={() => { if(month===1){setMonth(12);setYear(y=>y-1);}else setMonth(m=>m-1); }} className="btn-ghost p-2"><ChevronLeft size={18}/></button>
          <span className="font-semibold text-gray-700 w-36 text-center">{MONTHS[month-1]} {year}</span>
          <button onClick={() => { if(month===12){setMonth(1);setYear(y=>y+1);}else setMonth(m=>m+1); }} className="btn-ghost p-2"><ChevronRight size={18}/></button>
          {isPengurus && (
            <>
              <button onClick={loadEvents} className="btn-ghost p-2" title="Refresh"><RefreshCw size={16}/></button>
              <button onClick={generateHarian} disabled={generating} className="btn-primary gap-2">
                <Zap size={16}/> {generating ? 'Generating...' : 'Generate Harian'}
              </button>
              {draftCount > 0 && (
                <button onClick={publishAllHarian} className="btn-outline gap-2">
                  <Globe size={16}/> Publish ({draftCount})
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
          { key: 'optin',  label: `👥 Opt-in ${MONTHS[nextMonth-1]}` +
            (optinStats.belumIsi > 0 ? ` (${optinStats.belumIsi} belum)` : '') },
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
          {events.length > 0 && (
            <div className="flex gap-3 flex-wrap">
              {draftCount > 0 && <div className="badge-yellow flex items-center gap-1.5 px-3 py-1.5"><FileEdit size={13}/>{draftCount} draft</div>}
              {pubCount > 0  && <div className="badge-green flex items-center gap-1.5 px-3 py-1.5"><Globe size={13}/>{pubCount} published</div>}
            </div>
          )}
          {!isPengurus && isOptinWindow && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3 flex-wrap">
              <Bell size={18} className="text-blue-600 flex-shrink-0"/>
              <div className="flex-1">
                <p className="text-sm font-semibold text-blue-800">Isi Opt-in {MONTHS[nextMonth-1]} {nextYear}</p>
                <p className="text-xs text-blue-600">
                  Status: {myOptin ? <strong>{OPTIN_LABELS[myOptin.status]?.label}</strong> : <strong className="text-red-500">Belum diisi</strong>}
                </p>
              </div>
              <div className="flex gap-2">
                {['Bisa','Tidak_Bisa','Pas_Libur'].map(s => (
                  <button key={s} onClick={() => saveOptin(s)}
                    className={`btn-sm ${myOptin?.status===s ? 'btn-primary' : 'btn-outline'}`}>
                    {OPTIN_LABELS[s]?.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {profile?.is_tarakanita && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center gap-2">
              <CheckCircle size={16} className="text-blue-600"/>
              <p className="text-sm text-blue-700">Kamu Tarakanita — otomatis masuk pool Misa Harian.</p>
            </div>
          )}

          <div className="card overflow-hidden p-0" ref={tableRef}>
            <div className="px-4 py-3 bg-brand-800 text-white">
              <p className="font-bold text-center text-lg tracking-wide">JADWAL MISA HARIAN — {MONTHS[month-1].toUpperCase()} {year}</p>
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
                      <th>Tgl</th><th>Hari</th><th>Warna</th>
                      <th>Perayaan</th><th>Petugas</th><th>Lingkungan</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map(ev => {
                      const lc    = getLiturgyClass(ev.warna_liturgi);
                      const asgns = ev.assignments || [];
                      const d     = new Date(ev.tanggal_tugas + 'T00:00:00');
                      const statusBadge = ev.is_draft
                        ? <span className="badge-yellow text-xs">Draft</span>
                        : <span className="badge-green text-xs">Published</span>;

                      if (!asgns.length) return (
                        <tr key={ev.id} className={lc.bg}>
                          <td className={`font-bold ${lc.text}`}>{formatDate(ev.tanggal_tugas,'dd')}</td>
                          <td>{HARI[d.getDay()]}</td>
                          <td><div className="flex items-center gap-1"><div className={`w-3 h-3 rounded-full ${lc.dot}`}/><span className="text-xs">{ev.warna_liturgi}</span></div></td>
                          <td className="text-xs">{ev.perayaan||'—'}</td>
                          <td className="text-orange-400 text-xs italic">Kosong</td>
                          <td>—</td>
                          <td>{statusBadge}</td>
                        </tr>
                      );
                      return asgns.map((a, i) => (
                        <tr key={`${ev.id}-${i}`} className={lc.bg}>
                          {i===0 && <>
                            <td rowSpan={asgns.length} className={`font-bold ${lc.text}`}>{formatDate(ev.tanggal_tugas,'dd')}</td>
                            <td rowSpan={asgns.length}>{HARI[d.getDay()]}</td>
                            <td rowSpan={asgns.length}><div className="flex items-center gap-1"><div className={`w-3 h-3 rounded-full ${lc.dot}`}/><span className="text-xs">{ev.warna_liturgi}</span></div></td>
                            <td rowSpan={asgns.length} className="text-xs">{ev.perayaan||'—'}</td>
                          </>}
                          <td className="font-medium text-sm">{a.users?.nama_panggilan||'—'}</td>
                          <td className="text-xs text-gray-500">{a.users?.lingkungan||'—'}</td>
                          {i===0 && <td rowSpan={asgns.length}>{statusBadge}</td>}
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
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-800">
                Rekap Opt-in Misa Harian — {MONTHS[nextMonth-1]} {nextYear}
              </p>
              <p className="text-xs text-amber-700 mt-1">
                {isOptinWindow ? '🟢 Window opt-in SEDANG BUKA (tgl 10–20).' : '🔴 Window opt-in sedang tutup.'}
                {isPengurus && ' Admin/Penjadwalan dapat mengubah status secara manual.'}
              </p>
            </div>
            <button onClick={loadOptinList} className="btn-ghost p-1.5 flex-shrink-0"><RefreshCw size={14}/></button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: 'Total Aktif',  value: optinList.length,        color: 'bg-gray-50',   text: 'text-gray-700' },
              { label: 'Bisa',         value: optinStats.bisa,         color: 'bg-green-50',  text: 'text-green-700' },
              { label: 'Tidak Bisa',   value: optinStats.tidakBisa,    color: 'bg-red-50',    text: 'text-red-700' },
              { label: 'Pas Libur',    value: optinStats.pasLibur,     color: 'bg-yellow-50', text: 'text-yellow-700' },
              { label: 'Belum Isi',    value: optinStats.belumIsi,     color: 'bg-orange-50', text: 'text-orange-700' },
            ].map(s => (
              <div key={s.label} className={`card ${s.color} border-0 text-center p-3`}>
                <div className={`text-2xl font-black ${s.text}`}>{s.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Opt-in sendiri (non-pengurus) */}
          {!isPengurus && (
            <div className="card">
              <h3 className="font-semibold text-gray-700 mb-3">Status Opt-in Kamu — {MONTHS[nextMonth-1]} {nextYear}</h3>
              <div className="flex gap-3 flex-wrap">
                {['Bisa','Tidak_Bisa','Pas_Libur'].map(s => (
                  <button key={s} onClick={() => saveOptin(s)}
                    className={`flex items-center gap-2 px-4 py-3 rounded-xl border-2 transition-all ${myOptin?.status===s ? 'border-brand-800 bg-brand-50 font-bold' : 'border-gray-200 hover:border-brand-400'}`}>
                    <span>{OPTIN_LABELS[s]?.icon}</span>
                    <span className="text-sm">{OPTIN_LABELS[s]?.label}</span>
                    {myOptin?.status===s && <Check size={14} className="text-brand-800"/>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tabel rekap + edit (pengurus) */}
          {isPengurus && (
            <div className="card overflow-hidden p-0">
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h3 className="font-semibold text-gray-700 flex items-center gap-2">
                    <Users size={16} className="text-brand-800"/>
                    Daftar Opt-in Anggota
                    <span className="text-xs text-gray-400 font-normal">— klik status untuk ubah</span>
                  </h3>
                  <div className="flex items-center gap-2">
                    {/* Bulk set untuk yang belum isi */}
                    {optinStats.belumIsi > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-500">{optinStats.belumIsi} belum isi, set ke:</span>
                        {['Bisa','Tidak_Bisa'].map(s => (
                          <button key={s} onClick={() => bulkSetOptin(s)}
                            className="btn-outline btn-sm text-xs">
                            {OPTIN_LABELS[s]?.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="relative">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                      <input className="input pl-8 text-sm w-44" placeholder="Cari nama..."
                        value={searchOptin} onChange={e => setSearchOptin(e.target.value)}/>
                    </div>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[60vh]">
                {loadingOpt ? (
                  <div className="p-8 text-center text-gray-400">Memuat...</div>
                ) : (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Nama</th><th>Lingkungan</th><th>Pendidikan</th>
                        <th>Status Opt-in</th><th>Ubah Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOptin.map(u => {
                        const optin = u.optin;
                        const isEditing = editOptinId === u.id;
                        return (
                          <tr key={u.id}>
                            <td>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900">{u.nama_panggilan}</span>
                                {u.is_tarakanita && <span className="badge-blue text-[10px]">T</span>}
                              </div>
                              <div className="text-xs text-gray-400">@{u.nickname}</div>
                            </td>
                            <td className="text-sm text-gray-600">{u.lingkungan}</td>
                            <td><span className="badge-gray">{u.pendidikan||'—'}</span></td>
                            <td>
                              {u.is_tarakanita ? (
                                <span className="badge-blue flex items-center gap-1 w-fit text-xs">
                                  <CheckCircle size={11}/> Otomatis
                                </span>
                              ) : optin ? (
                                <span className={`badge ${OPTIN_LABELS[optin.status]?.color} text-xs`}>
                                  {OPTIN_LABELS[optin.status]?.icon} {OPTIN_LABELS[optin.status]?.label}
                                </span>
                              ) : (
                                <span className="text-xs text-orange-500 flex items-center gap-1">
                                  <AlertTriangle size={11}/> Belum isi
                                </span>
                              )}
                            </td>
                            <td>
                              {u.is_tarakanita ? (
                                <span className="text-xs text-gray-400">—</span>
                              ) : !isEditing ? (
                                <button onClick={() => setEditOptinId(u.id)}
                                  className="btn-ghost btn-sm gap-1 text-xs">
                                  <Edit2 size={12}/> Ubah
                                </button>
                              ) : (
                                <div className="flex gap-1 items-center flex-wrap">
                                  {['Bisa','Tidak_Bisa','Pas_Libur'].map(s => (
                                    <button key={s}
                                      onClick={() => saveOptinForUser(u.id, s)}
                                      className={`btn-sm text-xs px-2 py-1 rounded-lg border transition-all ${optin?.status===s ? 'bg-brand-800 text-white border-brand-800' : 'border-gray-300 hover:border-brand-800'}`}>
                                      {OPTIN_LABELS[s]?.label}
                                    </button>
                                  ))}
                                  <button onClick={() => setEditOptinId(null)} className="btn-ghost p-1">
                                    <X size={12}/>
                                  </button>
                                </div>
                              )}
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

// ─── Public Schedule ────────────────────────────────────────
export function PublicSchedulePage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoad]  = useState(true);

  useEffect(() => {
    supabase.from('events')
      .select(`
        id, perayaan, nama_event, tipe_event, tanggal_tugas, tanggal_latihan,
        warna_liturgi, jumlah_misa, draft_note,
        pic_slot_1a, pic_slot_1b, pic_slot_2a, pic_slot_2b,
        pic_slot_3a, pic_slot_3b, pic_slot_4a, pic_slot_4b,
        pelatih_slot_1, pelatih_slot_2, pelatih_slot_3,
        assignments(slot_number, position, users(nama_panggilan, lingkungan))
      `)
      .gte('tanggal_tugas', toLocalISO(new Date()))
      .not('tipe_event','eq','Misa_Harian')
      .eq('is_draft', false)
      .order('tanggal_tugas')
      .limit(12)
      .then(({ data }) => { setEvents(data||[]); setLoad(false); });
  }, []);

  const SLOT_INFO_PUB = {
    1: { label: 'Sabtu 17:30',  jam: '17.30' },
    2: { label: 'Minggu 06:00', jam: '06.00' },
    3: { label: 'Minggu 08:00', jam: '08.00' },
    4: { label: 'Minggu 17:30', jam: '17.30' },
  };

  const LITURGY_DOT = {
    Hijau:'bg-green-500', Merah:'bg-red-600', Putih:'bg-amber-400',
    Ungu:'bg-purple-600', MerahMuda:'bg-pink-500', Hitam:'bg-gray-700',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-brand-800 text-white py-8 px-4 text-center sticky top-0 z-10 shadow-lg">
        <h1 className="text-2xl font-black tracking-wide">SIGMA</h1>
        <p className="text-brand-200 text-sm mt-0.5">Jadwal Misdinar Paroki Kristus Raja Solo Baru</p>
        <p className="text-brand-300 text-xs italic mt-0.5">Serve the Lord with Gladness</p>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        {loading ? (
          [1,2,3].map(i => <div key={i} className="h-48 rounded-2xl bg-gray-200 animate-pulse"/>)
        ) : events.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="font-medium">Belum ada jadwal mendatang yang dipublish</p>
          </div>
        ) : events.map(ev => {
          const isMisaKhusus = ev.tipe_event === 'Misa_Khusus';
          const nSlots = isMisaKhusus ? (ev.jumlah_misa || 1) : 4;
          const asgn   = ev.assignments || [];
          const bySlot = {};
          for (let s = 1; s <= nSlots; s++) bySlot[s] = asgn.filter(a => a.slot_number === s);

          // Parse jam khusus dari draft_note
          const jamMap = {};
          if (isMisaKhusus && ev.draft_note) {
            const matches = ev.draft_note.matchAll(/Slot (\d+): ([\d.]+)/g);
            for (const m of matches) jamMap[Number(m[1])] = m[2];
          }

          const dot = LITURGY_DOT[ev.warna_liturgi] || 'bg-green-500';
          const pelatihNicks = [ev.pelatih_slot_1, ev.pelatih_slot_2, ev.pelatih_slot_3].filter(Boolean);

          // Subtitle tanggal
          const subtitleDate = isMisaKhusus
            ? formatDate(ev.tanggal_tugas, 'EEEE, dd MMMM yyyy')
            : ev.tanggal_latihan
              ? `${formatDate(ev.tanggal_latihan,'EEEE, dd MMM')} s/d ${formatDate(ev.tanggal_tugas,'dd MMMM yyyy')}`
              : formatDate(ev.tanggal_tugas, 'EEEE, dd MMMM yyyy');

          const gridClass = nSlots === 1 ? 'grid-cols-1' : nSlots === 2 ? 'grid-cols-2' : nSlots === 3 ? 'grid-cols-3' : 'grid-cols-2';

          return (
            <div key={ev.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {/* Event header */}
              <div className="px-4 pt-4 pb-3 border-b border-gray-50">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2.5 h-2.5 rounded-full ${dot} flex-shrink-0`}/>
                  <span className="text-xs text-gray-400">{ev.warna_liturgi}</span>
                </div>
                <h3 className="font-bold text-gray-900 text-base leading-tight">{ev.perayaan || ev.nama_event}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{subtitleDate}</p>

                {/* Pelatih piket */}
                {pelatihNicks.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="text-[10px] text-teal-600 font-medium">🧑‍🏫 Pelatih:</span>
                    {pelatihNicks.map(n => (
                      <span key={n} className="text-[10px] bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded-full">{n}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Slot grid */}
              <div className={`grid ${gridClass} divide-x divide-gray-50`}>
                {Array.from({length: nSlots}, (_,i) => i+1).map(slot => {
                  const info    = SLOT_INFO_PUB[slot] || SLOT_INFO_PUB[1];
                  const picA    = ev[`pic_slot_${slot}a`];
                  const picB    = ev[`pic_slot_${slot}b`];
                  const people  = bySlot[slot] || [];
                  const jamLabel = isMisaKhusus && jamMap[slot] ? jamMap[slot] : info.jam;
                  return (
                    <div key={slot} className="p-3">
                      <div className="mb-2">
                        <p className="text-[11px] font-bold text-gray-600">
                          {isMisaKhusus ? `Misa ${slot} (${jamLabel})` : info.label}
                        </p>
                        {(picA || picB) && (
                          <p className="text-[10px] text-brand-700 mt-0.5">
                            PIC: {[picA,picB].filter(Boolean).join(' & ')}
                          </p>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        {people.length === 0 ? (
                          <p className="text-[10px] text-gray-300 italic">—</p>
                        ) : people.map((a, i) => (
                          <div key={i} className="flex items-baseline gap-1">
                            <span className="text-[9px] text-gray-300 shrink-0">{i+1}.</span>
                            <div>
                              <p className="text-[11px] font-medium text-gray-800 leading-none">{a.users?.nama_panggilan}</p>
                              <p className="text-[9px] text-gray-400">{a.users?.lingkungan}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="text-center pt-4 pb-6 space-y-2">
          <a href="/login" className="btn-primary block max-w-xs mx-auto">Login ke SIGMA</a>
          <p className="text-xs text-gray-400">Daftar? <a href="/daftar" className="text-brand-800 underline">Klik di sini</a></p>
        </div>
      </div>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-brand-800 flex items-center justify-center text-white text-center p-6">
      <div>
        <Church size={48} className="mx-auto mb-4 text-brand-200"/>
        <h1 className="text-6xl font-black mb-2">404</h1>
        <p className="text-brand-200 text-lg mb-6">Halaman tidak ditemukan</p>
        <a href="/dashboard" className="bg-white text-brand-800 font-bold px-6 py-3 rounded-xl">Kembali</a>
      </div>
    </div>
  );
}

export default ScheduleDailyPage;
