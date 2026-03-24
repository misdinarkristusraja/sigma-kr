// src/pages/LatihanMisaBesarPage.jsx
//
// ┌─────────────────────────────────────────────────────────────────────┐
// │  REFACTORED v2 — Konsolidasi Latihan Misa Besar + Sesi Mandiri      │
// │  (Menggantikan SpecialMassPage yang dihapus dari navigasi)          │
// ├─────────────────────────────────────────────────────────────────────┤
// │  Bug Fixes:                                                         │
// │  [B1] new Set() pada object reference → gunakan Map untuk dedup     │
// │  [B2] Inline async delete tanpa error handling → named function     │
// │  [B3] checkThresholdForUser pakai stale closure `events`            │
// │       → terima currentEvents sebagai parameter eksplisit            │
// │  [B4] Query event_latihan tidak dicek errornya di loadData          │
// │       → error dicek, events tetap dirender tanpa latihan            │
// │  [B5] loadData() dipanggil tanpa await di beberapa handler          │
// │       → ditambahkan await untuk konsistensi state                   │
// │  [B6] AbsenModal.handleSave tanpa error check + setSaving tidak     │
// │       direset di error path → try/finally                           │
// │  [B7] SlotFormModal mengirim session_id saat UPDATE (FK tidak perlu │
// │       diubah) → payload dibedakan INSERT vs UPDATE                  │
// │  [B8] isPast(new Date(...)) dengan string null/undefined → NaN      │
// │       → safe parse + isValid() guard                                │
// │  [B9] fetchSessions tanpa error handling                            │
// │  [B10] slots[0] bisa undefined saat GCal export → guard + sort     │
// └─────────────────────────────────────────────────────────────────────┘

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatDate } from '../lib/utils';
import { sendNotification, broadcastNotification } from '../hooks/useNotifications';
import { exportToGCal, exportToICS, slotToCalEvent } from '../lib/calendarExport';
import { format, parseISO, isPast, isValid } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import {
  Plus, Check, X, AlertTriangle, AlertCircle, Clock,
  Users, ChevronDown, ChevronUp, Bell, BookOpen, Trash2,
  MapPin, Edit3, CalendarPlus, CalendarCheck, Download,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ─────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────

const ALASAN_OPTIONS = [
  { value: 'sakit',                     label: '🤒 Sakit' },
  { value: 'tugas_sekolah',             label: '📚 Tugas/Ujian Sekolah' },
  { value: 'acara_keluarga_urgent',     label: '🏥 Urusan Keluarga Mendesak' },
  { value: 'acara_keluarga_non_urgent', label: '🏠 Acara Keluarga Biasa' },
  { value: 'tidak_ada_transportasi',    label: '🚌 Tidak Ada Transportasi' },
  { value: 'lupa',                      label: '😅 Lupa' },
  { value: 'alasan_lain',               label: '📝 Alasan Lain' },
];

// Menggunakan Set agar lookup O(1), bukan linear scan pada array [B1]
const ALASAN_TIDAK_VALID = new Set([
  'acara_keluarga_non_urgent', 'lupa', 'alasan_lain',
]);

const JENIS_OPTS = [
  'Misa Khusus', 'Misa Besar', 'Perarakan',
  'Misa Rekviem', 'Misa Inkulturasi', 'Prosesi',
];

// ─────────────────────────────────────────────────────────────────────
// ROOT COMPONENT
// ─────────────────────────────────────────────────────────────────────

export default function LatihanMisaBesarPage() {
  const [activeTab, setActiveTab] = useState('misa-besar');

  return (
    <div className="page-container space-y-5">
      {/* Tab Bar */}
      <div className="border-b border-gray-200">
        <div className="flex gap-1">
          {[
            { id: 'misa-besar',   label: '🎓 Misa Besar',   desc: 'Latihan berbasis event terjadwal' },
            { id: 'sesi-mandiri', label: '📋 Sesi Mandiri',  desc: 'Sesi latihan bebas & multi-slot' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={tab.desc}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors
                ${activeTab === tab.id
                  ? 'border-brand-800 text-brand-800 bg-brand-50/60'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'misa-besar' ? <MisaBesarTab /> : <SesiMandiriTab />}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// TAB 1 — MISA BESAR (Event-based latihan)
// ═════════════════════════════════════════════════════════════════════

function MisaBesarTab() {
  const { profile, isAdmin, isPengurus, isPelatih } = useAuth();
  const isStaff = isAdmin || isPengurus || isPelatih;

  const todayStr = new Date().toISOString().split('T')[0];

  const [events,        setEvents]        = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [expandedEv,    setExpandedEv]    = useState({});
  const [myAbsences,    setMyAbsences]    = useState({});
  const [myAttendance,  setMyAttendance]  = useState({});
  const [submitting,    setSubmitting]    = useState({});
  const [checkingNotif, setCheckingNotif] = useState(false);

  // ── Load events Misa Besar + sesi latihan ──────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - 60 * 24 * 3600 * 1000)
        .toISOString().split('T')[0];

      // Query dengan mode_latihan (butuh migration 013)
      // Jika kolom belum ada, fallback ke query tanpa kolom tsb
      let evData, evErr;
      ({ data: evData, error: evErr } = await supabase
        .from('events')
        .select(`
          id, perayaan, nama_event, tipe_event, tanggal_tugas,
          warna_liturgi, is_draft, is_misa_besar, mode_latihan,
          assignments(user_id, slot_number,
            users(id, nickname, nama_panggilan, hp_anak, hp_ortu))
        `)
        .eq('is_misa_besar', true)
        .gte('tanggal_tugas', since)
        .order('tanggal_tugas'));

      // Fallback: kolom mode_latihan belum ada (migration 013 belum dijalankan)
      if (evErr?.message?.includes('mode_latihan')) {
        toast('⚠️ Jalankan migration 013_mode_latihan.sql di Supabase — menggunakan mode default', { icon: '⚠️' });
        ({ data: evData, error: evErr } = await supabase
          .from('events')
          .select(`
            id, perayaan, nama_event, tipe_event, tanggal_tugas,
            warna_liturgi, is_draft, is_misa_besar,
            assignments(user_id, slot_number,
              users(id, nickname, nama_panggilan, hp_anak, hp_ortu))
          `)
          .eq('is_misa_besar', true)
          .gte('tanggal_tugas', since)
          .order('tanggal_tugas'));
        // Inject default mode_latihan ke setiap row
        if (evData) evData = evData.map(e => ({ ...e, mode_latihan: 'gabung' }));
      }

      if (evErr) {
        toast.error('Gagal memuat event: ' + evErr.message);
        return;
      }

      const safeEvData = evData || [];
      const eventIds   = safeEvData.map(e => e.id);

      // [B4] FIX: error pada query latihan kini dicek secara eksplisit
      let latihanMap = {};
      if (eventIds.length > 0) {
        const { data: latData, error: latErr } = await supabase
          .from('event_latihan')
          .select(`
            id, event_id, tanggal, jam, lokasi, catatan,
            event_latihan_attendance(user_id, hadir, marked_at),
            event_latihan_absence(user_id, alasan, keterangan)
          `)
          .in('event_id', eventIds)
          .order('tanggal');

        if (latErr) {
          // Tidak fatal — events masih ditampilkan tanpa sesi latihan
          toast.error('Gagal memuat sesi latihan: ' + latErr.message);
        } else {
          (latData || []).forEach(l => {
            if (!latihanMap[l.event_id]) latihanMap[l.event_id] = [];
            latihanMap[l.event_id].push(l);
          });
        }
      }

      const merged = safeEvData.map(ev => ({
        ...ev,
        latihan: latihanMap[ev.id] || [],
      }));
      setEvents(merged);

      // Ambil attendance & absences milik user sendiri
      if (profile?.id) {
        const allLatihanIds = Object.values(latihanMap).flat().map(l => l.id);
        if (allLatihanIds.length > 0) {
          const [{ data: attData, error: attErr }, { data: absData, error: absErr }] =
            await Promise.all([
              supabase
                .from('event_latihan_attendance')
                .select('latihan_id, hadir')
                .eq('user_id', profile.id),
              supabase
                .from('event_latihan_absence')
                .select('latihan_id, alasan')
                .eq('user_id', profile.id),
            ]);

          if (attErr) console.warn('Gagal load attendance:', attErr.message);
          if (absErr) console.warn('Gagal load absences:',  absErr.message);

          const att = {}, abs = {};
          (attData || []).forEach(r => { att[r.latihan_id] = r.hadir; });
          (absData || []).forEach(r => { abs[r.latihan_id] = r.alasan; });
          setMyAttendance(att);
          setMyAbsences(abs);
        }
      }
    } finally {
      // [B4] Selalu matikan loading walaupun ada error parsial
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Self-report absen oleh petugas ────────────────────────────
  async function submitAbsence(latihanId, alasan, keterangan = '') {
    if (!profile?.id) return;
    setSubmitting(prev => ({ ...prev, [latihanId]: true }));
    try {
      const { error } = await supabase
        .from('event_latihan_absence')
        .upsert(
          { latihan_id: latihanId, user_id: profile.id, alasan, keterangan },
          { onConflict: 'latihan_id,user_id' }
        );

      if (error) { toast.error('Gagal menyimpan: ' + error.message); return; }

      toast.success('Ketidakhadiran tercatat');
      setMyAbsences(prev => ({ ...prev, [latihanId]: alasan }));

      // Snapshot events sebelum loadData me-reset state [B3]
      if (ALASAN_TIDAK_VALID.has(alasan)) {
        const currentEvents = events;
        await checkThresholdForUser(profile.id, currentEvents);
      }
    } finally {
      setSubmitting(prev => ({ ...prev, [latihanId]: false }));
      // [B5] FIX: await agar state konsisten
      await loadData();
    }
  }

  // ── Admin: toggle mode_latihan event ─────────────────────────
  async function toggleModeLatihan(ev) {
    const currentMode = ev.mode_latihan || 'gabung';
    const newMode     = currentMode === 'gabung' ? 'terpisah' : 'gabung';

    // Guard: cek apakah ada data attendance yang sudah ada
    const hasAttendance = ev.latihan.some(
      l => (l.event_latihan_attendance || []).length > 0
    );

    if (hasAttendance) {
      const confirmSwitch = window.confirm(
        `⚠️ Event ini sudah punya data kehadiran.

` +
        `Mengganti mode dari "${currentMode}" ke "${newMode}" tidak menghapus data yang ada, ` +
        `tapi scan berikutnya akan mengikuti mode baru.

` +
        `Lanjutkan ganti mode?`
      );
      if (!confirmSwitch) return;
    }

    const { error } = await supabase
      .from('events')
      .update({ mode_latihan: newMode })
      .eq('id', ev.id);

    if (error) { toast.error('Gagal ubah mode: ' + error.message); return; }

    toast.success(
      newMode === 'gabung'
        ? '✅ Mode diubah ke Gabung — 1 scan untuk semua sesi hari ini'
        : '✅ Mode diubah ke Terpisah — scan khusus per sesi'
    );
    await loadData();
  }

  // ── Admin: mark attendance manual (polymorphic) ─────────────
  // mode=gabung  → tandai semua sesi latihan event untuk user tsb
  // mode=terpisah → hanya tandai latihanId yang diberikan
  async function markAttendance(latihanId, userId, hadir, ev) {
    const mode = ev?.mode_latihan || 'terpisah';

    if (mode === 'gabung' && hadir) {
      // Gabung: tandai semua sesi yang ada untuk event ini
      const latihanIds = (ev.latihan || []).map(l => l.id);
      if (!latihanIds.length) {
        toast.error('Tidak ada sesi latihan di event ini');
        return;
      }
      const rows = latihanIds.map(lid => ({
        latihan_id: lid, user_id: userId, hadir: true, marked_by: profile?.id,
      }));
      const { error } = await supabase
        .from('event_latihan_attendance')
        .upsert(rows, { onConflict: 'latihan_id,user_id' });

      if (error) { toast.error('Gagal update: ' + error.message); return; }
      toast.success(`✅ Hadir dicatat di ${latihanIds.length} sesi (Mode Gabung)`);
    } else {
      // Terpisah: hanya satu sesi
      const { error } = await supabase
        .from('event_latihan_attendance')
        .upsert(
          { latihan_id: latihanId, user_id: userId, hadir, marked_by: profile?.id },
          { onConflict: 'latihan_id,user_id' }
        );
      if (error) { toast.error('Gagal update: ' + error.message); return; }
      toast.success(hadir ? '✅ Hadir dicatat' : '❌ Absen dicatat');
    }
    await loadData();
  }

  // ── Hapus sesi latihan ─────────────────────────────────────────
  // [B2] FIX: tidak lagi inline async di JSX; ada error handling eksplisit
  async function deleteLatihanSession(latihanId) {
    if (!window.confirm('Hapus sesi latihan ini?')) return;
    const { error } = await supabase
      .from('event_latihan')
      .delete()
      .eq('id', latihanId);

    if (error) { toast.error('Gagal menghapus: ' + error.message); return; }
    toast.success('Sesi dihapus');
    await loadData();
  }

  // ── Cek threshold kehadiran per user per event ─────────────────
  // [B3] FIX: menerima currentEvents sebagai parameter, bukan dari closure
  async function checkThresholdForUser(userId, currentEvents, eventId = null) {
    const evList = eventId
      ? currentEvents.filter(e => e.id === eventId)
      : currentEvents;

    for (const ev of evList) {
      const latihans = ev.latihan.filter(l => l.tanggal <= todayStr);
      if (!latihans.length) continue;

      const nLatihan  = latihans.length;
      const threshold = nLatihan > 2 ? 0.65 : 0.50;

      const attended = latihans.filter(l =>
        (l.event_latihan_attendance || []).some(a => a.user_id === userId && a.hadir)
      ).length;

      const pct = attended / nLatihan;

      const sorted = [...latihans].sort((a, b) => a.tanggal.localeCompare(b.tanggal));
      let consecutiveInvalid = 0, maxConsecutive = 0;

      for (const s of sorted) {
        const abs = (s.event_latihan_absence || []).find(a => a.user_id === userId);
        if (abs && ALASAN_TIDAK_VALID.has(abs.alasan)) {
          consecutiveInvalid++;
          maxConsecutive = Math.max(maxConsecutive, consecutiveInvalid);
        } else {
          consecutiveInvalid = 0;
        }
      }

      const triggerPct         = pct < threshold;
      const triggerConsecutive = maxConsecutive >= 2;
      if (!triggerPct && !triggerConsecutive) continue;

      const { data: alreadyNotif, error: notifCheckErr } = await supabase
        .from('latihan_threshold_notified')
        .select('id')
        .eq('event_id', ev.id)
        .eq('user_id', userId)
        .maybeSingle();

      if (notifCheckErr) { console.warn('Gagal cek notif:', notifCheckErr.message); continue; }
      if (alreadyNotif)   continue;

      const { data: userData } = await supabase
        .from('users').select('nickname, nama_panggilan').eq('id', userId).single();

      const nama   = userData?.nama_panggilan || 'Anggota';
      const reason = triggerConsecutive
        ? `${maxConsecutive}x absen berturut alasan tidak valid (hadir: ${attended}/${nLatihan})`
        : `Kehadiran ${Math.round(pct * 100)}% < batas ${Math.round(threshold * 100)}%`;

      await sendNotification({
        userId,
        title: '⚠️ Peringatan Kehadiran Latihan',
        body:  `Kamu mendapat peringatan kehadiran latihan ${ev.perayaan}. ${reason}.`,
        type:  'peringatan',
        data:  { event_id: ev.id, reason },
      });

      const { data: pengurusList } = await supabase
        .from('users').select('id').in('role', ['Administrator', 'Pengurus']);

      for (const p of (pengurusList || [])) {
        await sendNotification({
          userId: p.id,
          title:  `⚠️ ${nama} — Peringatan Latihan`,
          body:   `${nama} terdeteksi: ${reason} pada ${ev.perayaan}.`,
          type:   'peringatan',
          data:   { event_id: ev.id, user_id: userId, reason },
        });
      }

      await supabase
        .from('latihan_threshold_notified')
        .upsert({ event_id: ev.id, user_id: userId, reason }, { onConflict: 'event_id,user_id' });
    }
  }

  // ── Admin: cek semua threshold ─────────────────────────────────
  async function checkAllThresholds() {
    setCheckingNotif(true);
    // Snapshot events saat ini [B3]
    const currentEvents = events;
    let triggered = 0;

    try {
      for (const ev of currentEvents) {
        const petugasIds = [...new Set((ev.assignments || []).map(a => a.user_id))];
        for (const uid of petugasIds) {
          await checkThresholdForUser(uid, currentEvents, ev.id);
          triggered++;
        }
      }
      toast.success(`Threshold check selesai untuk ${triggered} petugas`);
    } catch (err) {
      toast.error('Error saat cek threshold: ' + err.message);
    } finally {
      setCheckingNotif(false);
      await loadData();
    }
  }

  // ── Hitung summary kehadiran ───────────────────────────────────
  function getAttendanceSummary(ev, userId) {
    const pastLatihan = ev.latihan.filter(l => l.tanggal <= todayStr);
    if (!pastLatihan.length) return null;

    const total     = pastLatihan.length;
    const attended  = pastLatihan.filter(l =>
      (l.event_latihan_attendance || []).some(a => a.user_id === userId && a.hadir)
    ).length;
    const threshold = total > 2 ? 0.65 : 0.50;
    const pct       = total > 0 ? attended / total : 0;

    return { total, attended, pct, threshold, pass: pct >= threshold };
  }

  // ─── RENDER ───────────────────────────────────────────────────

  if (loading) return (
    <div className="space-y-4">
      {[1, 2].map(i => <div key={i} className="skeleton h-32 rounded-2xl" />)}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="page-title">🎓 Latihan Misa Besar</h1>
          <p className="page-subtitle">
            Kehadiran wajib latihan · Threshold 50% (≤2 sesi) / 65% ({'>'}2 sesi)
          </p>
        </div>
        {isStaff && (
          <button
            onClick={checkAllThresholds}
            disabled={checkingNotif}
            className="btn-outline gap-2 text-sm"
          >
            <Bell size={15} />
            {checkingNotif ? 'Memeriksa…' : 'Cek Threshold'}
          </button>
        )}
      </div>

      {events.length === 0 && (
        <div className="card text-center py-16">
          <BookOpen size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">Belum ada Misa Besar</p>
          <p className="text-xs text-gray-400 mt-1">
            Tandai event sebagai "Misa Besar" di Jadwal Mingguan untuk memulai
          </p>
        </div>
      )}

      {events.map(ev => {
        const isExpanded  = !!expandedEv[ev.id];
        const amIPetugas  = (ev.assignments || []).some(a => a.user_id === profile?.id);
        const pastLatihan = ev.latihan.filter(l => l.tanggal <= todayStr);
        const upcomingLat = ev.latihan.filter(l => l.tanggal > todayStr);
        const mySummary   = amIPetugas ? getAttendanceSummary(ev, profile.id) : null;

        return (
          <div key={ev.id} className="card border-l-4 border-brand-800 space-y-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="badge bg-brand-800 text-white text-xs">🎓 Misa Besar</span>
                  {ev.is_draft
                    ? <span className="badge-yellow text-xs">Draft</span>
                    : <span className="badge-green text-xs">Published</span>
                  }
                </div>
                <h3 className="font-bold text-gray-900 text-lg">
                  {ev.perayaan || ev.nama_event}
                </h3>
                <p className="text-sm text-gray-500">
                  {formatDate(ev.tanggal_tugas, 'EEEE, dd MMM yyyy')}
                  {' · '}{ev.latihan.length} sesi latihan
                </p>

                {/* Mode badge + toggle (staff only) */}
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full
                    ${ev.mode_latihan === 'gabung'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-purple-100 text-purple-800'}`}>
                    {ev.mode_latihan === 'gabung' ? '🔗 Mode Gabung' : '🔀 Mode Terpisah'}
                  </span>
                  {isStaff && (
                    <button
                      onClick={() => toggleModeLatihan(ev)}
                      className="text-xs text-gray-400 hover:text-gray-700 underline underline-offset-2 transition-colors"
                      title="Klik untuk ganti mode scan latihan"
                    >
                      ganti mode
                    </button>
                  )}
                </div>

                {mySummary && (
                  <div className={`inline-flex items-center gap-1.5 mt-1.5 text-xs px-2.5 py-1 rounded-full font-medium
                    ${mySummary.pass ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {mySummary.pass ? <Check size={12} /> : <AlertTriangle size={12} />}
                    Kehadiranmu: {mySummary.attended}/{mySummary.total}
                    {' '}({Math.round(mySummary.pct * 100)}%)
                    {' '}— min. {Math.round(mySummary.threshold * 100)}%
                    {mySummary.pass ? ' ✅ Aman' : ' ⚠️ Perlu perhatian'}
                  </div>
                )}
              </div>

              <button
                onClick={() => setExpandedEv(prev => ({ ...prev, [ev.id]: !prev[ev.id] }))}
                className="btn-outline btn-sm gap-1"
              >
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {isExpanded ? 'Tutup' : 'Detail'}
              </button>
            </div>

            {isExpanded && (
              <div className="mt-4 space-y-4 pt-4 border-t border-gray-100">
                {/* Mode info banner */}
                <div className={`flex items-start gap-3 px-3 py-2.5 rounded-xl text-xs
                  ${ev.mode_latihan === 'gabung'
                    ? 'bg-blue-50 border border-blue-100 text-blue-800'
                    : 'bg-purple-50 border border-purple-100 text-purple-800'}`}>
                  <span className="text-base leading-none">{ev.mode_latihan === 'gabung' ? '🔗' : '🔀'}</span>
                  <div>
                    <p className="font-semibold">
                      Mode {ev.mode_latihan === 'gabung' ? 'Gabung' : 'Terpisah'} aktif
                    </p>
                    <p className="mt-0.5 leading-relaxed">
                      {ev.mode_latihan === 'gabung'
                        ? 'Satu scan latihan akan menandai kehadiran di SEMUA sesi latihan hari ini sekaligus.'
                        : 'Setiap sesi latihan dicatat secara terpisah. Scan hanya mencatat sesi yang berlangsung saat itu.'
                      }
                    </p>
                  </div>
                </div>

                {isStaff && <AddLatihanForm eventId={ev.id} onSaved={loadData} />}

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
                          onMarkAttendance={(latihanId, userId, hadir) =>
                            markAttendance(latihanId, userId, hadir, ev)
                          }
                          onSubmitAbsence={submitAbsence}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {upcomingLat.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      📅 Sesi Mendatang
                    </p>
                    <div className="space-y-2">
                      {upcomingLat.map(lat => (
                        <div key={lat.id}
                          className="flex items-center justify-between p-3 bg-blue-50 rounded-xl border border-blue-100">
                          <div>
                            <p className="text-sm font-medium text-blue-800">
                              {formatDate(lat.tanggal, 'EEEE, dd MMM yyyy')} · {lat.jam}
                            </p>
                            {lat.lokasi && (
                              <p className="text-xs text-blue-600">📍 {lat.lokasi}</p>
                            )}
                          </div>
                          {/* [B2] FIX: extracted ke named function deleteLatihanSession */}
                          {isStaff && (
                            <button
                              onClick={() => deleteLatihanSession(lat.id)}
                              className="btn-ghost p-1.5 text-red-400 hover:bg-red-50"
                              title="Hapus sesi"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {ev.latihan.length === 0 && (
                  <p className="text-sm text-gray-400 italic text-center py-4">
                    Belum ada sesi latihan.{isStaff ? ' Tambahkan di atas.' : ''}
                  </p>
                )}

                {isStaff && (ev.assignments || []).length > 0 && pastLatihan.length > 0 && (
                  <PetugasAttendanceSummary ev={ev} pastLatihan={pastLatihan} todayStr={todayStr} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Form tambah sesi latihan (admin) ─────────────────────────────────
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
    try {
      const { error } = await supabase
        .from('event_latihan')
        .insert({ event_id: eventId, tanggal, jam, lokasi, catatan });

      if (error) { toast.error('Gagal menyimpan: ' + error.message); return; }

      toast.success('Sesi latihan ditambahkan!');
      setTanggal(''); setJam('07.00'); setLokasi('Aula Gereja'); setCatatan('');
      setShow(false);
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  if (!show) return (
    <button
      onClick={() => setShow(true)}
      className="btn-outline btn-sm gap-1.5 text-xs w-full border-dashed"
    >
      <Plus size={13} /> Tambah Sesi Latihan
    </button>
  );

  return (
    <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
      <p className="text-xs font-semibold text-gray-700">Tambah Sesi Latihan</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label text-xs">Tanggal *</label>
          <input type="date" className="input text-sm" value={tanggal}
            onChange={e => setTanggal(e.target.value)} />
        </div>
        <div>
          <label className="label text-xs">Jam</label>
          <input type="text" className="input text-sm" value={jam} placeholder="07.00"
            onChange={e => setJam(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label text-xs">Lokasi</label>
        <input type="text" className="input text-sm" value={lokasi}
          onChange={e => setLokasi(e.target.value)} />
      </div>
      <div>
        <label className="label text-xs">Catatan (opsional)</label>
        <input type="text" className="input text-sm" value={catatan}
          onChange={e => setCatatan(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="btn-primary btn-sm gap-1 flex-1">
          <Check size={13} /> {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
        <button onClick={() => setShow(false)} className="btn-secondary btn-sm">Batal</button>
      </div>
    </div>
  );
}

// ─── Card satu sesi latihan yang sudah berlangsung ────────────────────
function LatihanSessionCard({
  lat, ev, isStaff, amIPetugas, myAbsence, myHadir,
  submitting, todayStr, profile, onMarkAttendance, onSubmitAbsence,
}) {
  const [showAbsForm, setShowAbsForm] = useState(false);
  const [alasan,      setAlasan]      = useState('sakit');
  const [keterangan,  setKeterangan]  = useState('');

  const attendance = lat.event_latihan_attendance || [];
  const absences   = lat.event_latihan_absence    || [];
  const hadirCount = attendance.filter(a => a.hadir).length;
  const modeLatihan = ev?.mode_latihan || 'terpisah';
  const isGabung    = modeLatihan === 'gabung';

  // [B1] FIX: gunakan Map untuk deduplication yang benar.
  // new Set() pada objects TIDAK pernah mendeduplikasi karena membandingkan
  // object reference (selalu unik). Map dengan key user_id benar secara semantik.
  const petugas = [
    ...new Map(
      (ev.assignments || []).map(a => [
        a.user_id,
        {
          user_id: a.user_id,
          nama:    a.users?.nama_panggilan || a.users?.nickname || '—',
          hp:      a.users?.hp_anak       || a.users?.hp_ortu,
        },
      ])
    ).values(),
  ];

  const isPastDay = lat.tanggal < todayStr;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div>
          <p className="text-sm font-bold text-gray-800">
            {formatDate(lat.tanggal, 'EEEE, dd MMM yyyy')} · {lat.jam}
          </p>
          {lat.lokasi && <p className="text-xs text-gray-500">📍 {lat.lokasi}</p>}
        </div>
        <div className="flex items-center gap-1.5">
          {isGabung && (
            <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full border border-blue-100">
              🔗 Gabung
            </span>
          )}
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full
            ${hadirCount > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {hadirCount}/{petugas.length} hadir
          </span>
        </div>
      </div>

      <div className="divide-y divide-gray-50">
        {petugas.map(p => {
          const att   = attendance.find(a => a.user_id === p.user_id);
          const abs   = absences.find(a => a.user_id === p.user_id);
          const hadir = att?.hadir;

          return (
            <div key={p.user_id} className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full flex-shrink-0
                  ${hadir === true  ? 'bg-green-500'
                  : hadir === false ? 'bg-red-500'
                  : 'bg-gray-300'}`} />
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

              {isStaff && (
                <div className="flex gap-1" title={isGabung ? 'Mode Gabung: ✓ akan tandai semua sesi' : 'Mode Terpisah: hanya sesi ini'}>
                  <button
                    onClick={() => onMarkAttendance(lat.id, p.user_id, true)}
                    title={isGabung ? `Tandai Hadir di semua sesi (Gabung)` : 'Tandai Hadir sesi ini'}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-colors
                      ${hadir === true
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-100 hover:bg-green-100 text-gray-400'}`}
                  >✓{isGabung ? '•' : ''}</button>
                  <button
                    onClick={() => onMarkAttendance(lat.id, p.user_id, false)}
                    title='Tandai Absen sesi ini'
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-colors
                      ${hadir === false
                        ? 'bg-red-500 text-white'
                        : 'bg-gray-100 hover:bg-red-100 text-gray-400'}`}
                  >✗</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {amIPetugas && isPastDay && myHadir === undefined && !myAbsence && (
        <div className="px-4 py-3 bg-orange-50 border-t border-orange-100">
          {!showAbsForm ? (
            <div className="flex items-center justify-between">
              <p className="text-xs text-orange-700 font-medium">
                ⚠️ Kamu belum tercatat hadir di sesi ini
              </p>
              <button
                onClick={() => setShowAbsForm(true)}
                className="btn-sm text-xs px-3 py-1.5 bg-orange-100 hover:bg-orange-200 text-orange-800 rounded-lg"
              >
                Laporkan Ketidakhadiran
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-orange-800">Alasan tidak hadir:</p>
              <select className="input text-sm" value={alasan}
                onChange={e => setAlasan(e.target.value)}>
                {ALASAN_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <input type="text" className="input text-sm"
                placeholder="Keterangan tambahan (opsional)"
                value={keterangan} onChange={e => setKeterangan(e.target.value)} />
              <div className="flex gap-2">
                <button
                  onClick={() => { onSubmitAbsence(lat.id, alasan, keterangan); setShowAbsForm(false); }}
                  disabled={submitting}
                  className="btn-primary btn-sm flex-1 gap-1 text-xs"
                >
                  <Check size={12} /> {submitting ? '…' : 'Kirim'}
                </button>
                <button onClick={() => setShowAbsForm(false)}
                  className="btn-secondary btn-sm text-xs">Batal</button>
              </div>
            </div>
          )}
        </div>
      )}

      {amIPetugas && isPastDay && myAbsence && (
        <div className="px-4 py-2.5 bg-orange-50 border-t border-orange-100">
          <p className="text-xs text-orange-700">
            📝 Keterangan absenmu:{' '}
            <strong>{ALASAN_OPTIONS.find(o => o.value === myAbsence)?.label}</strong>
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Summary kehadiran semua petugas (admin view) ─────────────────────
function PetugasAttendanceSummary({ ev, pastLatihan, todayStr }) {
  // [B1] FIX: Map untuk dedup
  const petugas = [
    ...new Map(
      (ev.assignments || []).map(a => [
        a.user_id,
        { user_id: a.user_id, nama: a.users?.nama_panggilan || a.users?.nickname || '—' },
      ])
    ).values(),
  ];

  const total     = pastLatihan.length;
  const threshold = total > 2 ? 0.65 : 0.50;
  const sorted    = [...pastLatihan].sort((a, b) => a.tanggal.localeCompare(b.tanggal));

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          📊 Rekap Kehadiran Petugas (threshold {Math.round(threshold * 100)}%)
        </p>
      </div>
      <div className="space-y-2">
        {petugas.map(p => {
          const attended = pastLatihan.filter(l =>
            (l.event_latihan_attendance || []).some(a => a.user_id === p.user_id && a.hadir)
          ).length;

          const pct  = total > 0 ? attended / total : 0;
          const pass = pct >= threshold;

          let consecutive = 0, maxCons = 0;
          for (const l of sorted) {
            const abs = (l.event_latihan_absence || []).find(a => a.user_id === p.user_id);
            if (abs && ALASAN_TIDAK_VALID.has(abs.alasan)) {
              consecutive++;
              maxCons = Math.max(maxCons, consecutive);
            } else {
              consecutive = 0;
            }
          }

          const hasWarning = !pass || maxCons >= 2;

          return (
            <div key={p.user_id}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl border
                ${hasWarning ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">{p.nama}</p>
                {maxCons >= 2 && (
                  <p className="text-[10px] text-red-600">{maxCons}x absen non-valid berturut</p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`text-xs font-bold ${pass ? 'text-green-700' : 'text-red-700'}`}>
                  {attended}/{total} ({Math.round(pct * 100)}%)
                </p>
                <p className={`text-[10px] ${pass ? 'text-green-600' : 'text-red-600'}`}>
                  {pass ? '✅ Aman' : '⚠️ Di bawah threshold'}
                </p>
              </div>
              <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden flex-shrink-0">
                <div
                  className={`h-full rounded-full ${pass ? 'bg-green-500' : 'bg-red-500'}`}
                  style={{ width: `${Math.min(100, Math.round(pct * 100))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// TAB 2 — SESI MANDIRI (Formerly SpecialMassPage)
// ═════════════════════════════════════════════════════════════════════

function SesiMandiriTab() {
  const { profile, isAdmin, isPengurus, isPelatih } = useAuth();
  const isStaff = isAdmin || isPengurus || isPelatih;

  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);

  // [B9] FIX: error handling ditambahkan pada fetchSessions
  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('special_mass_sessions')
        .select(`
          *,
          special_mass_slots (
            *,
            special_mass_attendance ( user_id, hadir )
          )
        `)
        .order('tanggal', { ascending: false });

      if (error) {
        toast.error('Gagal memuat sesi: ' + error.message);
        return;
      }
      setSessions(data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  async function handleDelete(id) {
    if (!window.confirm('Hapus sesi ini? Semua slot & absensi ikut terhapus.')) return;
    const { error } = await supabase
      .from('special_mass_sessions')
      .delete()
      .eq('id', id);

    if (error) { toast.error('Gagal menghapus: ' + error.message); return; }
    setSessions(prev => prev.filter(s => s.id !== id));
    toast.success('Sesi dihapus');
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <BookOpen size={22} className="text-brand-800" /> Sesi Mandiri
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Kelola sesi & slot latihan bebas — tidak terikat event, bisa multi-slot per acara
          </p>
        </div>
        {isStaff && (
          <button onClick={() => setShowForm(true)} className="btn-primary gap-1.5">
            <Plus size={16} /> Buat Sesi Baru
          </button>
        )}
      </div>

      {loading && (
        <div className="card py-12 text-center text-gray-400">Memuat data…</div>
      )}

      {!loading && sessions.length === 0 && (
        <div className="card py-12 text-center text-gray-400">
          <BookOpen size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">Belum ada sesi latihan mandiri.</p>
          {isStaff && (
            <button onClick={() => setShowForm(true)} className="btn-primary btn-sm mt-3 gap-1">
              <Plus size={14} /> Buat Sesi Pertama
            </button>
          )}
        </div>
      )}

      <div className="space-y-4">
        {sessions.map(s => (
          <SesiMandiriCard
            key={s.id}
            session={s}
            isStaff={isStaff}
            userId={profile?.id}
            onRefresh={fetchSessions}
            onDelete={() => handleDelete(s.id)}
          />
        ))}
      </div>

      {showForm && (
        <SessionFormModal
          userId={profile?.id}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); fetchSessions(); }}
        />
      )}
    </div>
  );
}

// ─── Card satu sesi mandiri ────────────────────────────────────────────
function SesiMandiriCard({ session: s, isStaff, userId, onRefresh, onDelete }) {
  const [open,       setOpen]       = useState(false);
  const [showAdd,    setShowAdd]    = useState(false);
  const [editSlot,   setEditSlot]   = useState(null);
  const [absenModal, setAbsenModal] = useState(null);

  const slots      = s.special_mass_slots || [];
  const wajibCount = slots.filter(sl => sl.is_wajib).length;

  // [B10] FIX: sort by urutan, guard jika slots kosong
  const handleExportICS = () => {
    if (!slots.length) { toast.error('Belum ada slot untuk diekspor'); return; }
    const calEvents = slots.map(sl => slotToCalEvent(sl, s.nama_acara));
    exportToICS(calEvents, `latihan-${s.nama_acara.replace(/\s+/g, '-').toLowerCase()}.ics`);
    toast.success('File kalender (.ics) diunduh');
  };

  const handleGCal = () => {
    const sortedSlots = [...slots].sort((a, b) => (a.urutan ?? 0) - (b.urutan ?? 0));
    const firstSlot   = sortedSlots[0];
    // [B10] FIX: guard eksplisit
    if (!firstSlot) { toast.error('Belum ada slot'); return; }
    exportToGCal(slotToCalEvent(firstSlot, s.nama_acara));
  };

  const handleBroadcast = async () => {
    try {
      await broadcastNotification({
        title: `📅 Jadwal Latihan: ${s.nama_acara}`,
        body:  `Ada ${slots.length} slot latihan. Lihat jadwal di aplikasi SIGMA.`,
        type:  'latihan',
      });
      toast.success('Notifikasi dikirim ke semua anggota');
    } catch (err) {
      toast.error('Gagal kirim notifikasi: ' + err.message);
    }
  };

  // [B8] FIX: safe parse sebelum isPast
  const sessionDate    = s.tanggal && isValid(parseISO(s.tanggal)) ? parseISO(s.tanggal) : null;
  const isSessionPast  = sessionDate ? isPast(sessionDate) : false;

  return (
    <div className="card p-0 overflow-hidden">
      <button
        onClick={() => setOpen(prev => !prev)}
        className="w-full text-left px-4 py-4 flex items-start justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`badge ${s.is_active && !isSessionPast ? 'badge-green' : 'badge-gray'}`}>
                {s.is_active && !isSessionPast ? 'Aktif' : 'Selesai'}
              </span>
              <span className="badge badge-blue">{s.jenis}</span>
            </div>
            <p className="font-semibold text-gray-800 mt-1">{s.nama_acara}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {sessionDate
                ? format(sessionDate, 'EEEE, d MMMM yyyy', { locale: localeId })
                : '—'}
              {' · '}{slots.length} slot latihan
              {wajibCount > 0 && ` (${wajibCount} wajib)`}
            </p>
          </div>
        </div>
        {open
          ? <ChevronUp size={16} className="text-gray-400 mt-1 shrink-0" />
          : <ChevronDown size={16} className="text-gray-400 mt-1 shrink-0" />
        }
      </button>

      {open && (
        <div className="border-t border-gray-100">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex flex-wrap gap-2">
            <button onClick={handleExportICS} className="btn-outline btn-sm gap-1.5 text-xs">
              <Download size={13} /> Export .ics
            </button>
            <button onClick={handleGCal} className="btn-outline btn-sm gap-1.5 text-xs">
              <CalendarPlus size={13} /> Google Calendar
            </button>
            {isStaff && (
              <>
                <button onClick={handleBroadcast} className="btn-outline btn-sm gap-1.5 text-xs">
                  <Bell size={13} /> Kirim Notif
                </button>
                <button
                  onClick={() => setShowAdd(true)}
                  className="btn-primary btn-sm gap-1.5 text-xs ml-auto"
                >
                  <Plus size={13} /> Tambah Slot
                </button>
                <button
                  onClick={onDelete}
                  className="text-xs border border-red-200 text-red-600 rounded-md px-2.5 py-1
                    hover:bg-red-50 transition-colors flex items-center gap-1"
                >
                  <Trash2 size={12} /> Hapus Sesi
                </button>
              </>
            )}
          </div>

          {s.deskripsi && (
            <p className="px-4 py-2 text-xs text-gray-500 bg-amber-50/50 border-b border-gray-100">
              {s.deskripsi}
            </p>
          )}

          {slots.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">
              Belum ada slot.{isStaff && ' Klik "+ Tambah Slot" untuk memulai.'}
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {[...slots].sort((a, b) => (a.urutan ?? 0) - (b.urutan ?? 0)).map(slot => (
                <SlotRow
                  key={slot.id}
                  slot={slot}
                  sessionName={s.nama_acara}
                  isStaff={isStaff}
                  userId={userId}
                  onEdit={() => setEditSlot(slot)}
                  onAbsen={() => setAbsenModal(slot)}
                  onRefresh={onRefresh}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <SlotFormModal
          sessionId={s.id}
          sessionName={s.nama_acara}
          nextUrutan={slots.length + 1}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); onRefresh(); }}
        />
      )}
      {editSlot && (
        <SlotFormModal
          sessionId={s.id}
          sessionName={s.nama_acara}
          slot={editSlot}
          onClose={() => setEditSlot(null)}
          onSaved={() => { setEditSlot(null); onRefresh(); }}
        />
      )}
      {absenModal && (
        <AbsenModal
          slot={absenModal}
          sessionName={s.nama_acara}
          onClose={() => setAbsenModal(null)}
          onSaved={() => { setAbsenModal(null); onRefresh(); }}
        />
      )}
    </div>
  );
}

// ─── Baris slot ────────────────────────────────────────────────────────
function SlotRow({ slot, sessionName, isStaff, userId, onEdit, onAbsen, onRefresh }) {
  const hadirCount = (slot.special_mass_attendance || []).filter(a => a.hadir).length;
  const myRecord   = (slot.special_mass_attendance || []).find(a => a.user_id === userId);

  // [B8] FIX: safe parse + isValid guard — new Date('undefinedTundefined') = NaN
  const safeTime  = slot.waktu_selesai || slot.waktu_mulai;
  const rawStr    = slot.tanggal && safeTime ? `${slot.tanggal}T${safeTime}` : null;
  const slotEnd   = rawStr ? parseISO(rawStr) : null;
  const past      = slotEnd && isValid(slotEnd) ? isPast(slotEnd) : false;

  const slotDate  = slot.tanggal && isValid(parseISO(slot.tanggal)) ? parseISO(slot.tanggal) : null;

  const handleGCalSlot = e => {
    e.stopPropagation();
    exportToGCal(slotToCalEvent(slot, sessionName));
  };

  const handleDeleteSlot = async e => {
    e.stopPropagation();
    if (!window.confirm(`Hapus slot "${slot.nama_slot}"?`)) return;
    const { error } = await supabase
      .from('special_mass_slots')
      .delete()
      .eq('id', slot.id);

    if (error) { toast.error('Gagal menghapus slot: ' + error.message); return; }
    toast.success('Slot dihapus');
    onRefresh();
  };

  return (
    <div className="px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors">
      <div className="w-6 h-6 rounded-full bg-brand-100 text-brand-800 text-xs font-bold
        flex items-center justify-center shrink-0 mt-0.5">
        {slot.urutan}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-800">{slot.nama_slot}</span>
          {slot.is_wajib && (
            <span className="badge badge-red" style={{ fontSize: '10px' }}>WAJIB</span>
          )}
          {past && (
            <span className="badge badge-gray" style={{ fontSize: '10px' }}>Selesai</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 flex-wrap">
          <span className="flex items-center gap-1">
            <Clock size={11} />
            {slotDate ? format(slotDate, 'd MMM', { locale: localeId }) : '—'}
            {', '}{slot.waktu_mulai}
            {slot.waktu_selesai && `–${slot.waktu_selesai}`}
          </span>
          {slot.lokasi && (
            <span className="flex items-center gap-1"><MapPin size={11} /> {slot.lokasi}</span>
          )}
          {slot.is_wajib && (
            <span className="flex items-center gap-1"><Users size={11} /> {hadirCount} hadir</span>
          )}
        </div>
        {slot.keterangan && (
          <p className="text-xs text-gray-400 mt-0.5 italic">{slot.keterangan}</p>
        )}
        {myRecord && (
          <span className={`inline-flex items-center gap-1 text-[11px] mt-1 px-1.5 py-0.5 rounded-full font-medium
            ${myRecord.hadir ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {myRecord.hadir ? <Check size={10} /> : <X size={10} />}
            {myRecord.hadir ? 'Hadir' : 'Tidak hadir'}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button onClick={handleGCalSlot} title="Google Calendar"
          className="p-1.5 rounded-lg hover:bg-blue-50 transition-colors">
          <CalendarPlus size={15} className="text-blue-500" />
        </button>
        {isStaff && (
          <>
            <button onClick={e => { e.stopPropagation(); onAbsen(); }} title="Catat Absensi"
              className="p-1.5 rounded-lg hover:bg-green-50 transition-colors">
              <CalendarCheck size={15} className="text-green-600" />
            </button>
            <button onClick={e => { e.stopPropagation(); onEdit(); }} title="Edit Slot"
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
              <Edit3 size={15} className="text-gray-400" />
            </button>
            <button onClick={handleDeleteSlot} title="Hapus Slot"
              className="p-1.5 rounded-lg hover:bg-red-50 transition-colors">
              <Trash2 size={15} className="text-red-400" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Modal absensi slot ────────────────────────────────────────────────
function AbsenModal({ slot, sessionName, onClose, onSaved }) {
  const [members,  setMembers]  = useState([]);
  const [existing, setExisting] = useState({});
  const [saving,   setSaving]   = useState(false);
  const [changes,  setChanges]  = useState({});
  const [loadErr,  setLoadErr]  = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [
        { data: users, error: usersErr },
        { data: attend, error: attendErr },
      ] = await Promise.all([
        supabase
          .from('users')
          .select('id, nama_panggilan, nickname')
          .eq('status', 'Active')
          .in('role', ['Misdinar_Aktif', 'Misdinar_Retired'])
          .order('nama_panggilan'),
        supabase
          .from('special_mass_attendance')
          .select('*')
          .eq('slot_id', slot.id),
      ]);

      if (cancelled) return;

      if (usersErr || attendErr) {
        setLoadErr((usersErr || attendErr).message);
        return;
      }

      const map = {};
      (attend || []).forEach(a => { map[a.user_id] = a.hadir; });
      setMembers(users || []);
      setExisting(map);
    })();

    return () => { cancelled = true; };
  }, [slot.id]);

  const toggle = uid =>
    setChanges(prev => ({
      ...prev,
      [uid]: !(uid in prev ? prev[uid] : (existing[uid] ?? false)),
    }));

  const getHadir   = uid => (uid in changes ? changes[uid] : (existing[uid] ?? false));
  const hadirCount = members.filter(m => getHadir(m.id)).length;

  // [B6] FIX: error handling + finally untuk reset saving
  const handleSave = async () => {
    setSaving(true);
    try {
      const rows = members
        .filter(m => m.id in changes)
        .map(m => ({ slot_id: slot.id, user_id: m.id, hadir: changes[m.id] }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('special_mass_attendance')
          .upsert(rows, { onConflict: 'slot_id,user_id' });

        if (error) { toast.error('Gagal menyimpan: ' + error.message); return; }
      }

      toast.success('Absensi disimpan');
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalWrapper title={`Absensi: ${slot.nama_slot}`} onClose={onClose}>
      {loadErr ? (
        <div className="text-center py-6 text-red-500 text-sm">
          <AlertCircle size={24} className="mx-auto mb-2" />
          Gagal memuat data: {loadErr}
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">
            {sessionName}
            {slot.tanggal && isValid(parseISO(slot.tanggal))
              ? ` · ${format(parseISO(slot.tanggal), 'd MMMM yyyy', { locale: localeId })}`
              : ''}
            {slot.waktu_mulai ? `, ${slot.waktu_mulai}` : ''}
            {' · '}<strong>{hadirCount}</strong> hadir
          </p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {members.map(m => {
              const hadir = getHadir(m.id);
              return (
                <button key={m.id} onClick={() => toggle(m.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl border-2 text-left transition-colors
                    ${hadir ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0
                    ${hadir ? 'bg-green-500 border-green-500' : 'border-gray-300'}`}>
                    {hadir && <Check size={11} className="text-white" />}
                  </div>
                  <span className="text-sm font-medium text-gray-800">{m.nama_panggilan}</span>
                  <span className="text-xs text-gray-400">@{m.nickname}</span>
                </button>
              );
            })}
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={onClose} className="btn-outline flex-1">Batal</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
              {saving ? 'Menyimpan…' : 'Simpan Absensi'}
            </button>
          </div>
        </>
      )}
    </ModalWrapper>
  );
}

// ─── Modal buat sesi baru ─────────────────────────────────────────────
function SessionFormModal({ userId, onClose, onSaved }) {
  const [form, setForm] = useState({
    nama_acara: '', jenis: 'Misa Khusus', tanggal: '', deskripsi: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.nama_acara.trim()) { toast.error('Nama acara wajib diisi'); return; }
    if (!form.tanggal)           { toast.error('Tanggal wajib diisi');    return; }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('special_mass_sessions')
        .insert({ ...form, created_by: userId });

      if (error) { toast.error('Gagal menyimpan: ' + error.message); return; }
      toast.success('Sesi dibuat!');
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalWrapper title="Buat Sesi Mandiri" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label text-xs">Nama Acara *</label>
          <input value={form.nama_acara}
            onChange={e => setForm({ ...form, nama_acara: e.target.value })}
            className="input" placeholder="cth: Misa Natal 2026" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label text-xs">Jenis</label>
            <select value={form.jenis}
              onChange={e => setForm({ ...form, jenis: e.target.value })} className="input">
              {JENIS_OPTS.map(j => <option key={j}>{j}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs">Tanggal Puncak *</label>
            <input type="date" value={form.tanggal}
              onChange={e => setForm({ ...form, tanggal: e.target.value })} className="input" />
          </div>
        </div>
        <div>
          <label className="label text-xs">Deskripsi</label>
          <textarea value={form.deskripsi}
            onChange={e => setForm({ ...form, deskripsi: e.target.value })}
            className="input resize-none" rows={2} />
        </div>
        <p className="text-xs text-gray-400 flex items-start gap-1">
          <AlertCircle size={12} className="shrink-0 mt-0.5" />
          Setelah sesi dibuat, tambahkan slot-slot latihan dari dalam kartu sesi.
        </p>
      </div>
      <div className="flex gap-3 mt-4">
        <button onClick={onClose} className="btn-outline flex-1">Batal</button>
        <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
          {saving ? 'Menyimpan…' : 'Buat Sesi'}
        </button>
      </div>
    </ModalWrapper>
  );
}

// ─── Modal buat/edit slot ─────────────────────────────────────────────
function SlotFormModal({ sessionId, sessionName, slot, nextUrutan = 1, onClose, onSaved }) {
  const [form, setForm] = useState({
    nama_slot:     slot?.nama_slot     || `Latihan ${nextUrutan}`,
    tanggal:       slot?.tanggal       || '',
    waktu_mulai:   slot?.waktu_mulai   || '09:00',
    waktu_selesai: slot?.waktu_selesai || '',
    lokasi:        slot?.lokasi        || 'Gereja Kristus Raja Solo Baru',
    keterangan:    slot?.keterangan    || '',
    is_wajib:      slot?.is_wajib      ?? false,
    urutan:        slot?.urutan        || nextUrutan,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.tanggal) { toast.error('Tanggal wajib diisi'); return; }

    setSaving(true);
    try {
      let error;

      if (slot) {
        // [B7] FIX: UPDATE tidak mengirim session_id.
        // FK ini tidak perlu (dan tidak boleh) diubah.
        // Mengirimnya pada UPDATE bisa menyebabkan FK constraint error
        // jika nilai tidak konsisten, dan adalah operasi yang semantically salah.
        const updatePayload = {
          nama_slot:     form.nama_slot,
          tanggal:       form.tanggal,
          waktu_mulai:   form.waktu_mulai,
          waktu_selesai: form.waktu_selesai || null,
          lokasi:        form.lokasi,
          keterangan:    form.keterangan,
          is_wajib:      form.is_wajib,
          urutan:        form.urutan,
        };
        ({ error } = await supabase
          .from('special_mass_slots')
          .update(updatePayload)
          .eq('id', slot.id));
      } else {
        // INSERT: session_id dibutuhkan sebagai FK
        ({ error } = await supabase
          .from('special_mass_slots')
          .insert({ ...form, session_id: sessionId }));
      }

      if (error) { toast.error('Gagal menyimpan: ' + error.message); return; }
      toast.success(slot ? 'Slot diperbarui' : 'Slot ditambahkan');
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalWrapper title={`${slot ? 'Edit' : 'Tambah'} Slot — ${sessionName}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label text-xs">Nama Slot</label>
            <input value={form.nama_slot}
              onChange={e => setForm({ ...form, nama_slot: e.target.value })}
              className="input" placeholder="cth: Gladi Bersih" />
          </div>
          <div>
            <label className="label text-xs">Urutan</label>
            <input type="number" min={1} value={form.urutan}
              onChange={e => setForm({ ...form, urutan: Number(e.target.value) })}
              className="input" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label text-xs">Tanggal *</label>
            <input type="date" value={form.tanggal}
              onChange={e => setForm({ ...form, tanggal: e.target.value })} className="input" />
          </div>
          <div>
            <label className="label text-xs">Mulai</label>
            <input type="time" value={form.waktu_mulai}
              onChange={e => setForm({ ...form, waktu_mulai: e.target.value })} className="input" />
          </div>
          <div>
            <label className="label text-xs">Selesai</label>
            <input type="time" value={form.waktu_selesai}
              onChange={e => setForm({ ...form, waktu_selesai: e.target.value })} className="input" />
          </div>
        </div>
        <div>
          <label className="label text-xs">Lokasi</label>
          <input value={form.lokasi}
            onChange={e => setForm({ ...form, lokasi: e.target.value })} className="input" />
        </div>
        <div>
          <label className="label text-xs">Keterangan</label>
          <textarea value={form.keterangan}
            onChange={e => setForm({ ...form, keterangan: e.target.value })}
            className="input resize-none" rows={2} />
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={form.is_wajib}
            onChange={e => setForm({ ...form, is_wajib: e.target.checked })}
            className="w-4 h-4 accent-brand-800 rounded" />
          <span className="text-sm text-gray-700">
            Wajib hadir <span className="text-red-500">*</span>
          </span>
          <span className="text-xs text-gray-400">(dihitung ke streak)</span>
        </label>
      </div>
      <div className="flex gap-3 mt-4">
        <button onClick={onClose} className="btn-outline flex-1">Batal</button>
        <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
          {saving ? 'Menyimpan…' : slot ? 'Simpan Perubahan' : 'Tambah Slot'}
        </button>
      </div>
    </ModalWrapper>
  );
}

// ─── Modal wrapper (shared) ────────────────────────────────────────────
function ModalWrapper({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-800">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X size={18} className="text-gray-400" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
