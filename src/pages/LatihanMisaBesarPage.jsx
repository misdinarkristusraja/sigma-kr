// src/pages/LatihanMisaBesarPage.jsx
// Halaman manajemen latihan untuk Misa Besar
// - Admin/Pengurus/Pelatih: kelola sesi latihan, lihat attendance, mark hadir
// - Semua petugas: lihat jadwal latihan yang relevan, self-report absen

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatDate } from '../lib/utils';
import { sendNotification } from '../hooks/useNotifications';
import {
  Calendar, Plus, Check, X, AlertTriangle, Clock,
  Users, ChevronDown, ChevronUp, Bell, BookOpen, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';

const ALASAN_OPTIONS = [
  { value: 'sakit',                    label: '🤒 Sakit' },
  { value: 'tugas_sekolah',            label: '📚 Tugas/Ujian Sekolah' },
  { value: 'acara_keluarga_urgent',    label: '🏥 Urusan Keluarga Mendesak' },
  { value: 'acara_keluarga_non_urgent',label: '🏠 Acara Keluarga Biasa' },
  { value: 'tidak_ada_transportasi',   label: '🚌 Tidak Ada Transportasi' },
  { value: 'lupa',                     label: '😅 Lupa' },
  { value: 'alasan_lain',              label: '📝 Alasan Lain' },
];

// Alasan yang dianggap TIDAK VALID (mempengaruhi threshold)
const ALASAN_TIDAK_VALID = ['acara_keluarga_non_urgent', 'lupa', 'alasan_lain'];

export default function LatihanMisaBesarPage() {
  const { profile, isAdmin, isPengurus, isPelatih } = useAuth();
  const isStaff = isAdmin || isPengurus || isPelatih;

  const [events,       setEvents]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [expandedEv,   setExpandedEv]   = useState({});   // { eventId: bool }
  const [myAbsences,   setMyAbsences]   = useState({});   // { latihanId: alasan_enum }
  const [myAttendance, setMyAttendance] = useState({});   // { latihanId: bool }
  const [submitting,   setSubmitting]   = useState({});
  const [checkingNotif,setCheckingNotif]= useState(false);

  const todayStr = new Date().toISOString().split('T')[0];

  // ── Load events Misa Besar + latihan sessions ────────────────
  const loadData = useCallback(async () => {
    setLoading(true);

    // Ambil events Misa Besar yang akan datang atau sudah berjalan (max 60 hari lalu)
    const since = new Date(Date.now() - 60*24*3600*1000).toISOString().split('T')[0];
    const { data: evData, error: evErr } = await supabase
      .from('events')
      .select(`
        id, perayaan, nama_event, tipe_event, tanggal_tugas, tanggal_latihan,
        warna_liturgi, is_draft, is_misa_besar,
        assignments(user_id, slot_number,
          users(id, nickname, nama_panggilan, hp_anak, hp_ortu))
      `)
      .eq('is_misa_besar', true)
      .gte('tanggal_tugas', since)
      .order('tanggal_tugas');

    if (evErr) { toast.error('Gagal load: ' + evErr.message); setLoading(false); return; }

    // Ambil latihan sessions
    const eventIds = (evData || []).map(e => e.id);
    let latihanMap = {};
    if (eventIds.length) {
      const { data: latData } = await supabase
        .from('event_latihan')
        .select(`
          id, event_id, tanggal, jam, lokasi, catatan,
          event_latihan_attendance(user_id, hadir, marked_at),
          event_latihan_absence(user_id, alasan, keterangan)
        `)
        .in('event_id', eventIds)
        .order('tanggal');
      (latData || []).forEach(l => {
        if (!latihanMap[l.event_id]) latihanMap[l.event_id] = [];
        latihanMap[l.event_id].push(l);
      });
    }

    // Merge
    const merged = (evData || []).map(ev => ({
      ...ev,
      latihan: latihanMap[ev.id] || [],
    }));
    setEvents(merged);

    // My attendance & absences
    if (profile?.id) {
      const allLatihanIds = Object.values(latihanMap).flat().map(l => l.id);
      if (allLatihanIds.length) {
        const [{ data: attData }, { data: absData }] = await Promise.all([
          supabase.from('event_latihan_attendance')
            .select('latihan_id, hadir').eq('user_id', profile.id),
          supabase.from('event_latihan_absence')
            .select('latihan_id, alasan').eq('user_id', profile.id),
        ]);
        const att = {}, abs = {};
        (attData || []).forEach(r => { att[r.latihan_id] = r.hadir; });
        (absData || []).forEach(r => { abs[r.latihan_id] = r.alasan; });
        setMyAttendance(att);
        setMyAbsences(abs);
      }
    }

    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Self-report absen ────────────────────────────────────────
  async function submitAbsence(latihanId, alasan, keterangan = '') {
    if (!profile?.id) return;
    setSubmitting(p => ({...p, [latihanId]: true}));
    const { error } = await supabase.from('event_latihan_absence').upsert({
      latihan_id: latihanId, user_id: profile.id, alasan, keterangan,
    }, { onConflict: 'latihan_id,user_id' });
    if (error) { toast.error(error.message); }
    else {
      toast.success('Ketidakhadiran tercatat');
      setMyAbsences(p => ({...p, [latihanId]: alasan}));
      // Jika alasan tidak valid, check threshold
      if (ALASAN_TIDAK_VALID.includes(alasan)) {
        await checkThresholdForUser(profile.id);
      }
    }
    setSubmitting(p => ({...p, [latihanId]: false}));
    loadData();
  }

  // ── Admin: mark attendance manual ───────────────────────────
  async function markAttendance(latihanId, userId, hadir) {
    const { error } = await supabase.from('event_latihan_attendance').upsert({
      latihan_id: latihanId, user_id: userId, hadir, marked_by: profile?.id,
    }, { onConflict: 'latihan_id,user_id' });
    if (error) toast.error(error.message);
    else { toast.success(hadir ? 'Hadir ✅' : 'Absen ❌'); loadData(); }
  }

  // ── Check threshold per event per user ───────────────────────
  async function checkThresholdForUser(userId, eventId = null) {
    const evList = eventId ? events.filter(e => e.id === eventId) : events;
    for (const ev of evList) {
      const latihans = ev.latihan.filter(l => l.tanggal <= todayStr); // hanya yang sudah lewat
      if (!latihans.length) continue;

      const nLatihan = latihans.length;
      const threshold = nLatihan > 2 ? 0.65 : 0.50;

      // Ambil attendance user di event ini
      const attended = latihans.filter(l =>
        l.event_latihan_attendance?.find(a => a.user_id === userId && a.hadir)
      ).length;
      const pct = attended / nLatihan;

      // Check consecutive invalid absences
      const sortedAbs = latihans.map(l => ({
        tanggal: l.tanggal,
        abs: l.event_latihan_absence?.find(a => a.user_id === userId),
      })).sort((a,b) => a.tanggal.localeCompare(b.tanggal));

      let consecutiveInvalid = 0, maxConsecutive = 0;
      for (const s of sortedAbs) {
        if (s.abs && ALASAN_TIDAK_VALID.includes(s.abs.alasan)) {
          consecutiveInvalid++;
          maxConsecutive = Math.max(maxConsecutive, consecutiveInvalid);
        } else {
          consecutiveInvalid = 0;
        }
      }

      const triggerPct         = pct < threshold;
      const triggerConsecutive = maxConsecutive >= 2;

      if (!triggerPct && !triggerConsecutive) continue;

      // Cek apakah sudah pernah dinotif untuk event ini
      const { data: alreadyNotif } = await supabase
        .from('latihan_threshold_notified')
        .select('id')
        .eq('event_id', ev.id)
        .eq('user_id', userId)
        .maybeSingle();

      if (alreadyNotif) continue; // sudah dinotif, skip

      // Ambil data user
      const { data: userData } = await supabase
        .from('users').select('nickname, nama_panggilan, role').eq('id', userId).single();
      const nama = userData?.nama_panggilan || 'Anggota';

      const reason = triggerConsecutive
        ? `2x absen berturut alasan tidak valid (total tidak hadir: ${nLatihan - attended}/${nLatihan})`
        : `Kehadiran latihan ${Math.round(pct*100)}% < ${Math.round(threshold*100)}% (threshold)`;

      // Notif ke petugas bersangkutan
      await sendNotification({
        userId,
        title: `⚠️ Peringatan Kehadiran Latihan`,
        body: `Kamu mendapat peringatan kehadiran latihan ${ev.perayaan}. ${reason}. Pastikan hadir di sesi berikutnya.`,
        type: 'peringatan',
        data: { event_id: ev.id, reason },
      });

      // Notif ke semua pengurus
      const { data: pengurusList } = await supabase
        .from('users').select('id').in('role', ['Administrator','Pengurus']);
      for (const p of (pengurusList || [])) {
        await sendNotification({
          userId: p.id,
          title: `⚠️ ${nama} — Peringatan Latihan`,
          body: `${nama} terdeteksi ${reason} pada latihan ${ev.perayaan}.`,
          type: 'peringatan',
          data: { event_id: ev.id, user_id: userId, reason },
        });
      }

      // Catat sudah dinotif
      await supabase.from('latihan_threshold_notified').upsert({
        event_id: ev.id, user_id: userId, reason,
      }, { onConflict: 'event_id,user_id' });
    }
  }

  // ── Admin: check all thresholds ──────────────────────────────
  async function checkAllThresholds() {
    setCheckingNotif(true);
    let triggered = 0;
    for (const ev of events) {
      const petugas = [...new Set((ev.assignments || []).map(a => a.user_id))];
      for (const uid of petugas) {
        await checkThresholdForUser(uid, ev.id);
        triggered++;
      }
    }
    toast.success(`Threshold check selesai untuk ${triggered} petugas`);
    setCheckingNotif(false);
    loadData();
  }

  // ── Hitung summary attendance ────────────────────────────────
  function getAttendanceSummary(ev, userId) {
    const pastLatihan = ev.latihan.filter(l => l.tanggal <= todayStr);
    if (!pastLatihan.length) return null;
    const total    = pastLatihan.length;
    const attended = pastLatihan.filter(l =>
      l.event_latihan_attendance?.find(a => a.user_id === userId && a.hadir)
    ).length;
    const threshold = total > 2 ? 0.65 : 0.50;
    const pct = total ? attended / total : 0;
    return { total, attended, pct, threshold, pass: pct >= threshold };
  }

  if (loading) return (
    <div className="page-container space-y-4">
      {[1,2].map(i => <div key={i} className="skeleton h-32 rounded-2xl"/>)}
    </div>
  );

  return (
    <div className="page-container space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="page-title">🎓 Latihan Misa Besar</h1>
          <p className="page-subtitle">Kehadiran wajib latihan · Threshold 50% (≤2 sesi) / 65% ({'>'}2 sesi)</p>
        </div>
        {isStaff && (
          <button onClick={checkAllThresholds} disabled={checkingNotif}
            className="btn-outline gap-2 text-sm">
            <Bell size={15}/> {checkingNotif ? 'Memeriksa…' : 'Cek Threshold'}
          </button>
        )}
      </div>

      {events.length === 0 && (
        <div className="card text-center py-16">
          <BookOpen size={40} className="mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500 font-medium">Belum ada Misa Besar</p>
          <p className="text-xs text-gray-400 mt-1">
            Tandai event sebagai "Misa Besar" di tab Jadwal Mingguan untuk memulai
          </p>
        </div>
      )}

      {events.map(ev => {
        const isExpanded   = !!expandedEv[ev.id];
        const myPetugasIdx = (ev.assignments || []).findIndex(a => a.user_id === profile?.id);
        const amIPetugas   = myPetugasIdx >= 0;
        const pastLatihan  = ev.latihan.filter(l => l.tanggal <= todayStr);
        const upcomingLat  = ev.latihan.filter(l => l.tanggal > todayStr);

        // My attendance summary
        const mySummary = amIPetugas ? getAttendanceSummary(ev, profile.id) : null;

        return (
          <div key={ev.id} className="card border-l-4 border-brand-800 space-y-0">
            {/* Event header */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="badge bg-brand-800 text-white text-xs">🎓 Misa Besar</span>
                  {ev.is_draft
                    ? <span className="badge-yellow text-xs">Draft</span>
                    : <span className="badge-green text-xs">Published</span>}
                </div>
                <h3 className="font-bold text-gray-900 text-lg">{ev.perayaan || ev.nama_event}</h3>
                <p className="text-sm text-gray-500">
                  {formatDate(ev.tanggal_tugas,'EEEE, dd MMM yyyy')}
                  {' · '}{ev.latihan.length} sesi latihan
                </p>

                {/* My summary badge */}
                {mySummary && (
                  <div className={`inline-flex items-center gap-1.5 mt-1.5 text-xs px-2.5 py-1 rounded-full font-medium
                    ${mySummary.pass ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {mySummary.pass ? <Check size={12}/> : <AlertTriangle size={12}/>}
                    Kehadiranmu: {mySummary.attended}/{mySummary.total} ({Math.round(mySummary.pct*100)}%)
                    — threshold {Math.round(mySummary.threshold*100)}%
                    {mySummary.pass ? ' ✅ Aman' : ' ⚠️ Perlu perhatian'}
                  </div>
                )}
              </div>

              <button onClick={() => setExpandedEv(p => ({...p, [ev.id]: !p[ev.id]}))}
                className="btn-outline btn-sm gap-1">
                {isExpanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                {isExpanded ? 'Tutup' : 'Detail'}
              </button>
            </div>

            {/* Latihan sessions list */}
            {isExpanded && (
              <div className="mt-4 space-y-4 pt-4 border-t border-gray-100">

                {/* Admin: tambah sesi latihan */}
                {isStaff && (
                  <AddLatihanForm eventId={ev.id} onSaved={loadData}/>
                )}

                {/* Past sessions */}
                {pastLatihan.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      📋 Sesi Sudah Berlangsung
                    </p>
                    <div className="space-y-3">
                      {pastLatihan.map(lat => (
                        <LatihanSessionCard
                          key={lat.id}
                          lat={lat}
                          ev={ev}
                          isStaff={isStaff}
                          amIPetugas={amIPetugas}
                          myAbsence={myAbsences[lat.id]}
                          myHadir={myAttendance[lat.id]}
                          submitting={!!submitting[lat.id]}
                          todayStr={todayStr}
                          profile={profile}
                          onMarkAttendance={markAttendance}
                          onSubmitAbsence={submitAbsence}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Upcoming sessions */}
                {upcomingLat.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      📅 Sesi Mendatang
                    </p>
                    <div className="space-y-2">
                      {upcomingLat.map(lat => (
                        <div key={lat.id} className="flex items-center justify-between p-3 bg-blue-50 rounded-xl border border-blue-100">
                          <div>
                            <p className="text-sm font-medium text-blue-800">
                              {formatDate(lat.tanggal,'EEEE, dd MMM yyyy')} · {lat.jam}
                            </p>
                            {lat.lokasi && <p className="text-xs text-blue-600">📍 {lat.lokasi}</p>}
                          </div>
                          {isStaff && (
                            <button onClick={async () => {
                              if (!confirm('Hapus sesi latihan ini?')) return;
                              await supabase.from('event_latihan').delete().eq('id', lat.id);
                              toast.success('Sesi dihapus');
                              loadData();
                            }} className="btn-ghost p-1.5 text-red-400 hover:bg-red-50">
                              <Trash2 size={14}/>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {ev.latihan.length === 0 && (
                  <p className="text-sm text-gray-400 italic text-center py-4">
                    Belum ada sesi latihan. {isStaff ? 'Tambahkan di atas.' : ''}
                  </p>
                )}

                {/* Admin: semua petugas + summary */}
                {isStaff && ev.assignments?.length > 0 && pastLatihan.length > 0 && (
                  <PetugasAttendanceSummary ev={ev} pastLatihan={pastLatihan} todayStr={todayStr}/>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Component: Tambah sesi latihan (admin) ───────────────────
function AddLatihanForm({ eventId, onSaved }) {
  const [show,    setShow]    = useState(false);
  const [tanggal, setTanggal] = useState('');
  const [jam,     setJam]     = useState('07.00');
  const [lokasi,  setLokasi]  = useState('Aula Gereja');
  const [catatan, setCatatan] = useState('');
  const [saving,  setSaving]  = useState(false);

  async function save() {
    if (!tanggal) { toast.error('Tanggal wajib diisi'); return; }
    setSaving(true);
    const { error } = await supabase.from('event_latihan').insert({
      event_id: eventId, tanggal, jam, lokasi, catatan,
    });
    if (error) toast.error(error.message);
    else {
      toast.success('Sesi latihan ditambahkan!');
      setTanggal(''); setJam('07.00'); setLokasi('Aula Gereja'); setCatatan('');
      setShow(false);
      onSaved();
    }
    setSaving(false);
  }

  if (!show) return (
    <button onClick={() => setShow(true)}
      className="btn-outline btn-sm gap-1.5 text-xs w-full border-dashed">
      <Plus size={13}/> Tambah Sesi Latihan
    </button>
  );

  return (
    <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
      <p className="text-xs font-semibold text-gray-700">Tambah Sesi Latihan</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label text-xs">Tanggal *</label>
          <input type="date" className="input text-sm" value={tanggal}
            onChange={e => setTanggal(e.target.value)}/>
        </div>
        <div>
          <label className="label text-xs">Jam</label>
          <input type="text" className="input text-sm" value={jam} placeholder="07.00"
            onChange={e => setJam(e.target.value)}/>
        </div>
      </div>
      <div>
        <label className="label text-xs">Lokasi</label>
        <input type="text" className="input text-sm" value={lokasi}
          onChange={e => setLokasi(e.target.value)}/>
      </div>
      <div>
        <label className="label text-xs">Catatan (opsional)</label>
        <input type="text" className="input text-sm" value={catatan}
          onChange={e => setCatatan(e.target.value)}/>
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="btn-primary btn-sm gap-1 flex-1">
          <Check size={13}/> {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
        <button onClick={() => setShow(false)} className="btn-secondary btn-sm">Batal</button>
      </div>
    </div>
  );
}

// ── Component: Satu sesi latihan yang sudah berlangsung ───────
function LatihanSessionCard({ lat, ev, isStaff, amIPetugas, myAbsence, myHadir,
  submitting, todayStr, profile, onMarkAttendance, onSubmitAbsence }) {

  const [showAbsForm, setShowAbsForm] = useState(false);
  const [alasan,      setAlasan]      = useState('sakit');
  const [keterangan,  setKeterangan]  = useState('');

  const attendance = lat.event_latihan_attendance || [];
  const absences   = lat.event_latihan_absence    || [];
  const hadirCount = attendance.filter(a => a.hadir).length;

  // Petugas event ini
  const petugas = [...new Set((ev.assignments || []).map(a => ({
    user_id: a.user_id,
    nama: a.users?.nama_panggilan || a.users?.nickname,
    hp: a.users?.hp_anak || a.users?.hp_ortu,
  })))].filter((v, i, arr) => arr.findIndex(x => x.user_id === v.user_id) === i);

  const isPastH1 = lat.tanggal < todayStr; // H+1 = sudah lewat hari latihan

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Session header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div>
          <p className="text-sm font-bold text-gray-800">
            {formatDate(lat.tanggal,'EEEE, dd MMM yyyy')} · {lat.jam}
          </p>
          {lat.lokasi && <p className="text-xs text-gray-500">📍 {lat.lokasi}</p>}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full
            ${hadirCount > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {hadirCount}/{petugas.length} hadir
          </span>
        </div>
      </div>

      {/* Petugas attendance list */}
      <div className="divide-y divide-gray-50">
        {petugas.map(p => {
          const att   = attendance.find(a => a.user_id === p.user_id);
          const abs   = absences.find(a => a.user_id === p.user_id);
          const hadir = att?.hadir;

          return (
            <div key={p.user_id} className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full flex-shrink-0
                  ${hadir === true ? 'bg-green-500'
                  : hadir === false ? 'bg-red-500'
                  : 'bg-gray-300'}`}/>
                <div>
                  <p className="text-xs font-medium text-gray-800">{p.nama}</p>
                  {abs && (
                    <p className="text-[10px] text-orange-600">
                      Absen: {ALASAN_OPTIONS.find(o => o.value === abs.alasan)?.label || abs.alasan}
                      {abs.keterangan && ` — ${abs.keterangan}`}
                    </p>
                  )}
                </div>
              </div>
              {/* Admin mark attendance */}
              {isStaff && (
                <div className="flex gap-1">
                  <button onClick={() => onMarkAttendance(lat.id, p.user_id, true)}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-colors
                      ${hadir === true ? 'bg-green-500 text-white' : 'bg-gray-100 hover:bg-green-100 text-gray-400'}`}>
                    ✓
                  </button>
                  <button onClick={() => onMarkAttendance(lat.id, p.user_id, false)}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-colors
                      ${hadir === false ? 'bg-red-500 text-white' : 'bg-gray-100 hover:bg-red-100 text-gray-400'}`}>
                    ✗
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Self-report absen (petugas sendiri, jika belum ada attendance & sudah H+1) */}
      {amIPetugas && isPastH1 && myHadir === undefined && !myAbsence && (
        <div className="px-4 py-3 bg-orange-50 border-t border-orange-100">
          {!showAbsForm ? (
            <div className="flex items-center justify-between">
              <p className="text-xs text-orange-700 font-medium">
                ⚠️ Kamu belum tercatat hadir di sesi ini
              </p>
              <button onClick={() => setShowAbsForm(true)}
                className="btn-sm text-xs px-3 py-1.5 bg-orange-100 hover:bg-orange-200 text-orange-800 rounded-lg">
                Laporkan Ketidakhadiran
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-orange-800">Alasan tidak hadir:</p>
              <select className="input text-sm" value={alasan} onChange={e => setAlasan(e.target.value)}>
                {ALASAN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input type="text" className="input text-sm" placeholder="Keterangan tambahan (opsional)"
                value={keterangan} onChange={e => setKeterangan(e.target.value)}/>
              <div className="flex gap-2">
                <button onClick={() => { onSubmitAbsence(lat.id, alasan, keterangan); setShowAbsForm(false); }}
                  disabled={submitting}
                  className="btn-primary btn-sm flex-1 gap-1 text-xs">
                  <Check size={12}/> {submitting ? '…' : 'Kirim'}
                </button>
                <button onClick={() => setShowAbsForm(false)} className="btn-secondary btn-sm text-xs">Batal</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Show existing absence */}
      {amIPetugas && isPastH1 && myAbsence && (
        <div className="px-4 py-2.5 bg-orange-50 border-t border-orange-100">
          <p className="text-xs text-orange-700">
            📝 Keterangan absenmu: <strong>{ALASAN_OPTIONS.find(o=>o.value===myAbsence)?.label}</strong>
          </p>
        </div>
      )}
    </div>
  );
}

// ── Component: Summary attendance semua petugas (admin view) ──
function PetugasAttendanceSummary({ ev, pastLatihan, todayStr }) {
  const petugas = [...new Map(
    (ev.assignments || []).map(a => [a.user_id, {
      user_id: a.user_id,
      nama: a.users?.nama_panggilan || a.users?.nickname,
    }])
  ).values()];

  const total     = pastLatihan.length;
  const threshold = total > 2 ? 0.65 : 0.50;

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">
        📊 Rekap Kehadiran Petugas (threshold {Math.round(threshold*100)}%)
      </p>
      <div className="space-y-2">
        {petugas.map(p => {
          const attended = pastLatihan.filter(l =>
            l.event_latihan_attendance?.find(a => a.user_id === p.user_id && a.hadir)
          ).length;
          const pct  = total ? attended / total : 0;
          const pass = pct >= threshold;

          // Check consecutive invalids
          let consecutive = 0, maxCons = 0;
          for (const l of pastLatihan.sort((a,b) => a.tanggal.localeCompare(b.tanggal))) {
            const abs = l.event_latihan_absence?.find(a => a.user_id === p.user_id);
            if (abs && ALASAN_TIDAK_VALID.includes(abs.alasan)) {
              consecutive++;
              maxCons = Math.max(maxCons, consecutive);
            } else {
              consecutive = 0;
            }
          }

          return (
            <div key={p.user_id}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl border
                ${!pass || maxCons >= 2 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">{p.nama}</p>
                {maxCons >= 2 && (
                  <p className="text-[10px] text-red-600">{maxCons}x absen non-valid berturut</p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`text-xs font-bold ${pass ? 'text-green-700' : 'text-red-700'}`}>
                  {attended}/{total} ({Math.round(pct*100)}%)
                </p>
                <p className={`text-[10px] ${pass ? 'text-green-600' : 'text-red-600'}`}>
                  {pass ? '✅ Aman' : '⚠️ Di bawah threshold'}
                </p>
              </div>
              {/* Progress bar */}
              <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden flex-shrink-0">
                <div className={`h-full rounded-full ${pass ? 'bg-green-500' : 'bg-red-500'}`}
                  style={{width: `${Math.round(pct*100)}%`}}/>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
