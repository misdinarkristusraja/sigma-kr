import React, { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { parseQRValue } from '../lib/utils';
import {
  CheckCircle, XCircle, AlertTriangle, Camera, QrCode,
  Clock, Shield, ChevronDown, ChevronUp,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ─── Konstanta ──────────────────────────────────────────────
const AUTO_RETURN_SEC  = 4;
const SCAN_COOLDOWN_MS = 60 * 60 * 1000; // anti-duplikat 60 menit

// Jam misa per slot (WIB, dalam menit dari tengah malam)
// Dipakai untuk validasi window ±2 jam
const SLOT_TIMES_MIN = {
  latihan: 8 * 60,        // 08:00 (sabtu pagi)
  slot1:   17 * 60 + 30,  // 17:30 sabtu sore
  slot2:   6  * 60,       // 06:00 minggu
  slot3:   8  * 60,       // 08:00 minggu
  slot4:   17 * 60 + 30,  // 17:30 minggu
};
const WINDOW_MIN = 2 * 60; // ±2 jam = 120 menit

// ─── Helpers ────────────────────────────────────────────────
function toLocalISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

// Jam sekarang dalam menit WIB (UTC+7)
function nowMinutesWIB() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.getUTCHours() * 60 + wib.getUTCMinutes();
}

// Cek apakah menit sekarang masuk window ±WINDOW_MIN dari salah satu slot
function isInTimeWindow(slotMinutes) {
  const now = nowMinutesWIB();
  return Math.abs(now - slotMinutes) <= WINDOW_MIN;
}

// Cari window yang aktif sekarang dari daftar event hari ini
// Mengembalikan array string deskripsi window yang aktif
function getActiveWindows(events, today) {
  const activeWindows = [];
  const now = nowMinutesWIB();

  for (const ev of events) {
    const isSaturday = ev.tanggal_latihan === today;
    const isSunday   = ev.tanggal_tugas   === today;

    if (isSaturday) {
      if (isInTimeWindow(SLOT_TIMES_MIN.latihan)) activeWindows.push('Latihan (08:00)');
      if (isInTimeWindow(SLOT_TIMES_MIN.slot1))   activeWindows.push('Sabtu 17:30');
    }
    if (isSunday) {
      if (isInTimeWindow(SLOT_TIMES_MIN.slot2)) activeWindows.push('Minggu 06:00');
      if (isInTimeWindow(SLOT_TIMES_MIN.slot3)) activeWindows.push('Minggu 08:00');
      if (isInTimeWindow(SLOT_TIMES_MIN.slot4)) activeWindows.push('Minggu 17:30');
    }
    // Misa Harian: window 06:00–09:00 (±2 jam dari 07:00)
    if (ev.tipe_event === 'Misa_Harian' && ev.tanggal_tugas === today) {
      if (isInTimeWindow(7 * 60)) activeWindows.push('Misa Harian (07:00)');
    }
    // Misa Khusus: ambil jam dari draft_note jika ada, default 07:00
    if (ev.tipe_event === 'Misa_Khusus' && ev.tanggal_tugas === today) {
      const match = ev.draft_note?.match(/(\d{2})\.(\d{2})/);
      const mins  = match ? parseInt(match[1]) * 60 + parseInt(match[2]) : 7 * 60;
      if (isInTimeWindow(mins)) activeWindows.push(`${ev.perayaan||'Misa Khusus'}`);
    }
  }

  return [...new Set(activeWindows)]; // dedup
}

// Jam berikutnya yang masih valid hari ini
function getNextWindowLabel(events, today) {
  const now = nowMinutesWIB();
  const all = [];
  for (const ev of events) {
    if (ev.tanggal_latihan === today) {
      all.push({ label: 'Latihan 08:00',   min: SLOT_TIMES_MIN.latihan });
      all.push({ label: 'Sabtu 17:30',     min: SLOT_TIMES_MIN.slot1 });
    }
    if (ev.tanggal_tugas === today && ev.tipe_event !== 'Misa_Harian') {
      all.push({ label: 'Minggu 06:00', min: SLOT_TIMES_MIN.slot2 });
      all.push({ label: 'Minggu 08:00', min: SLOT_TIMES_MIN.slot3 });
      all.push({ label: 'Minggu 17:30', min: SLOT_TIMES_MIN.slot4 });
    }
  }
  const upcoming = all.filter(a => a.min - WINDOW_MIN > now).sort((a,b) => a.min - b.min);
  if (!upcoming.length) return null;
  const next  = upcoming[0];
  const diff  = next.min - WINDOW_MIN - now;
  const hours = Math.floor(diff / 60);
  const mins  = diff % 60;
  return `${next.label} (lagi ${hours > 0 ? `${hours}j ` : ''}${mins}m)`;
}

// ═══════════════════════════════════════════════════════════
export default function ScanPage() {
  const { profile, canScan, isAdmin } = useAuth();
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animRef   = useRef(null);
  const returnRef = useRef(null);

  const [scanning,  setScanning]  = useState(false);
  const [result,    setResult]    = useState(null);
  const [walkIn,    setWalkIn]    = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [camError,  setCamError]  = useState('');
  // Untuk override admin: data scan yang menunggu konfirmasi
  const [pendingOverride, setPendingOverride] = useState(null);

  const startCamera = useCallback(async () => {
    setCamError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current      = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setScanning(true);
      scanLoop();
    } catch {
      setCamError('Tidak dapat mengakses kamera. Izinkan akses di browser.');
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    cancelAnimationFrame(animRef.current);
    setScanning(false);
  }, []);

  useEffect(() => {
    if (canScan) startCamera();
    return () => { stopCamera(); clearInterval(returnRef.current); };
  }, [canScan]);

  function scanLoop() {
    animRef.current = requestAnimationFrame(() => {
      const video  = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) { scanLoop(); return; }
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      const code = jsQR(ctx.getImageData(0,0,canvas.width,canvas.height).data, canvas.width, canvas.height, { inversionAttempts:'dontInvert' });
      if (code?.data) { stopCamera(); processQR(code.data); }
      else scanLoop();
    });
  }

  // ── Validasi & proses QR ───────────────────────────────────
  async function processQR(raw) {
    const parsed = parseQRValue(raw);
    if (!parsed) {
      showResult({ status:'error', message:'QR tidak dikenali. Format tidak valid.', raw }); return;
    }

    // 1. Cari user
    const { data: member } = await supabase
      .from('users')
      .select('id, nickname, myid, nama_panggilan, lingkungan, role, status, is_suspended')
      .eq('nickname', parsed.nickname.toLowerCase())
      .maybeSingle();
    if (!member) {
      showResult({ status:'error', message:`Misdinar "${parsed.nickname}" tidak ditemukan.` }); return;
    }
    if (member.is_suspended) {
      showResult({ status:'error', message:`${member.nama_panggilan} sedang disuspend.`, member }); return;
    }

    const isAnomaly = member.myid !== parsed.myid?.toUpperCase();

    // 2. Anti-duplikat (60 menit)
    const since = new Date(Date.now() - SCAN_COOLDOWN_MS).toISOString();
    const { data: dupe } = await supabase.from('scan_records')
      .select('id, timestamp, scanner_user_id, users!scanner_user_id(nama_panggilan)')
      .eq('user_id', member.id)
      .in('scan_type', ['tugas','latihan','walkin_tugas','walkin_latihan'])
      .gte('timestamp', since)
      .order('timestamp', { ascending:false }).limit(1).maybeSingle();
    if (dupe) {
      const minsAgo = Math.floor((Date.now() - new Date(dupe.timestamp)) / 60000);
      showResult({ status:'warning', message:`${member.nama_panggilan} sudah discan ${minsAgo} menit lalu.`, member }); return;
    }

    // 3. Cari semua event hari ini (tanggal_tugas atau tanggal_latihan = hari ini)
    const today = toLocalISO(new Date());
    const { data: todayEvents } = await supabase
      .from('events')
      .select('id, nama_event, tipe_event, tanggal_tugas, tanggal_latihan, perayaan, draft_note, status_event')
      .or(`tanggal_tugas.eq.${today},tanggal_latihan.eq.${today}`)
      .in('status_event', ['Akan_Datang','Berlangsung'])
      .not('is_draft', 'eq', true);

    // 4. Validasi: ada event hari ini?
    if (!todayEvents || todayEvents.length === 0) {
      const msg = `Tidak ada event/jadwal hari ini (${today}). Scan tidak valid.`;
      if (isAdmin) {
        setPendingOverride({ member, parsed, raw, isAnomaly, events:[], reason: msg });
      } else {
        showResult({ status:'invalid', message: msg, member });
      }
      return;
    }

    // 5. Validasi: cek window waktu ±2 jam
    const activeWindows = getActiveWindows(todayEvents, today);
    if (activeWindows.length === 0) {
      const nextWindow = getNextWindowLabel(todayEvents, today);
      const msg = nextWindow
        ? `Di luar window scan. Scan valid mulai H-2 jam misa.\nBerikutnya: ${nextWindow}`
        : `Semua window scan hari ini sudah lewat.`;
      if (isAdmin) {
        setPendingOverride({ member, parsed, raw, isAnomaly, events: todayEvents, reason: msg });
      } else {
        showResult({ status:'invalid', message: msg, member, nextWindow });
      }
      return;
    }

    // 6. Cari event yang paling relevan (tempat user dijadwalkan)
    let targetEvent = null;
    let assignmentId = null;
    let isWalkInScan = false;

    for (const ev of todayEvents) {
      const { data: asgn } = await supabase.from('assignments')
        .select('id').eq('user_id', member.id).eq('event_id', ev.id).maybeSingle();
      if (asgn) { targetEvent = ev; assignmentId = asgn.id; break; }
    }

    // 7. Validasi: user punya tugas hari ini?
    if (!targetEvent) {
      // Tidak ada assignment → scan TIDAK VALID (bukan walk-in otomatis)
      const msg = `${member.nama_panggilan} tidak memiliki jadwal tugas hari ini. Scan tidak valid.`;
      if (isAdmin) {
        setPendingOverride({
          member, parsed, raw, isAnomaly, events: todayEvents, reason: msg,
          allowWalkIn: true, // admin bisa force sebagai walk-in
        });
      } else {
        showResult({ status:'invalid', message: msg, member });
      }
      return;
    }

    // ✅ Semua validasi lulus — simpan
    await saveScanRecord({
      member, parsed, eventId: targetEvent.id, assignmentId,
      isAnomaly, isWalkIn: false, walkInReason: null,
      raw, activeWindows,
    });
  }

  // ── Simpan scan record ─────────────────────────────────────
  async function saveScanRecord({ member, parsed, eventId, assignmentId, isAnomaly, isWalkIn, walkInReason, raw, activeWindows, isAdminOverride }) {
    const scanType = parsed.type === 'latihan'
      ? (isWalkIn ? 'walkin_latihan' : 'latihan')
      : (isWalkIn ? 'walkin_tugas'   : 'tugas');

    const { error } = await supabase.from('scan_records').insert({
      user_id:         member.id,
      event_id:        eventId || null,
      scanner_user_id: profile?.id,
      scan_type:       scanType,
      is_walk_in:      isWalkIn,
      walkin_reason:   walkInReason,
      timestamp:       new Date().toISOString(),
      qr_version:      parsed.version || 'new',
      raw_qr_value:    raw,
      is_anomaly:      isAnomaly || isAdminOverride,
      anomaly_reason:  isAdminOverride
        ? `Admin override: ${walkInReason||'manual'}`
        : isAnomaly ? 'MyID tidak cocok' : null,
    });

    if (error) { showResult({ status:'error', message:'Gagal simpan: '+error.message }); return; }

    setPendingOverride(null);
    showResult({
      status: (isAnomaly && !isAdminOverride) ? 'warning' : 'success',
      message: isAdminOverride
        ? `✓ Override admin — ${member.nama_panggilan} (dicatat manual)`
        : isAnomaly
        ? `✓ Scan disimpan (anomali MyID) — ${member.nama_panggilan}`
        : `✓ ${member.nama_panggilan} — ${scanType === 'latihan' ? 'Latihan' : 'Tugas'}`,
      member, scanType,
      isLegacy: parsed.version === 'legacy',
      activeWindows,
    });
  }

  // ── Admin override ─────────────────────────────────────────
  async function doAdminOverride(walkInReason) {
    if (!pendingOverride) return;
    const { member, parsed, raw, isAnomaly, events } = pendingOverride;
    const eventId = events?.[0]?.id || null;
    await saveScanRecord({
      member, parsed, eventId, assignmentId: null,
      isAnomaly, isWalkIn: true, walkInReason: walkInReason || 'Admin override',
      raw, activeWindows: [], isAdminOverride: true,
    });
  }

  // ── Walk-in (dari proses normal) ───────────────────────────
  async function confirmWalkIn(reason) {
    if (!walkIn) return;
    await saveScanRecord({
      member: walkIn.member, parsed: walkIn.qrData,
      eventId: walkIn.activeEvent?.id || null, assignmentId: null,
      isAnomaly: walkIn.isAnomaly, isWalkIn: true, walkInReason: reason,
      raw: walkIn.raw, activeWindows: walkIn.activeWindows,
    });
  }

  // ── Show result + auto-return ──────────────────────────────
  function showResult(data) {
    setResult(data); setWalkIn(null);
    let sec = AUTO_RETURN_SEC;
    setCountdown(sec);
    clearInterval(returnRef.current);
    returnRef.current = setInterval(() => {
      sec -= 1; setCountdown(sec);
      if (sec <= 0) { clearInterval(returnRef.current); handleReset(); }
    }, 1000);
  }

  function handleReset() {
    setResult(null); setWalkIn(null); setPendingOverride(null);
    setCountdown(0); clearInterval(returnRef.current);
    startCamera();
  }

  if (!canScan) return (
    <div className="min-h-screen bg-black flex items-center justify-center text-white text-center p-6">
      <div>
        <QrCode size={48} className="mx-auto mb-4 text-gray-400"/>
        <p className="text-lg font-semibold">Hanya Pelatih/Pengurus/Admin</p>
      </div>
    </div>
  );

  // ─── RENDER ─────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-black/50">
        <div className="flex items-center gap-2">
          <QrCode size={20} className="text-brand-400"/>
          <span className="text-white font-semibold">Scan Absensi</span>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && <span className="text-xs bg-brand-800 text-white px-2 py-0.5 rounded-lg">Admin</span>}
          <span className="text-xs text-gray-400">{profile?.nama_panggilan}</span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center relative p-4">

        {/* Camera */}
        {!result && !walkIn && !pendingOverride && (
          <div className="relative">
            <video ref={videoRef} className="max-w-full max-h-[70vh] rounded-xl" playsInline muted/>
            <canvas ref={canvasRef} className="hidden"/>
            {scanning && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="qr-viewfinder"/>
                <p className="absolute bottom-6 text-white/80 text-sm">Arahkan QR Code ke kamera</p>
              </div>
            )}
            {camError && (
              <div className="absolute inset-0 bg-gray-900 flex flex-col items-center justify-center p-6 rounded-xl">
                <Camera size={48} className="text-gray-500 mb-4"/>
                <p className="text-white text-sm text-center">{camError}</p>
                <button onClick={startCamera} className="mt-4 btn-primary">Coba Lagi</button>
              </div>
            )}
          </div>
        )}

        {/* Walk-in dialog (jarang muncul — hanya jika flow normal) */}
        {walkIn && (
          <div className="bg-gray-900 rounded-2xl p-6 max-w-sm w-full">
            <div className="text-center mb-4">
              <AlertTriangle size={40} className="text-yellow-400 mx-auto mb-2"/>
              <h3 className="text-white font-bold text-lg">Walk-in</h3>
              <p className="text-gray-300 text-sm">{walkIn.member?.nama_panggilan} tidak di jadwal.</p>
            </div>
            <div className="space-y-2">
              {['Menggantikan','Sukarela','Lainnya'].map(r => (
                <button key={r} onClick={() => confirmWalkIn(r)}
                  className="w-full py-3 px-4 bg-gray-700 hover:bg-brand-800 text-white rounded-xl text-sm font-medium transition-colors">
                  {r}
                </button>
              ))}
            </div>
            <button onClick={handleReset} className="mt-3 w-full py-2 text-gray-400 text-sm">Batal</button>
          </div>
        )}

        {/* ── ADMIN OVERRIDE panel ── */}
        {pendingOverride && (
          <div className="bg-gray-900 rounded-2xl p-6 max-w-sm w-full">
            <div className="text-center mb-4">
              <Shield size={40} className="text-brand-400 mx-auto mb-2"/>
              <h3 className="text-white font-bold">Scan Tidak Valid</h3>
              <p className="text-gray-400 text-xs mt-1">Kamu login sebagai Admin — bisa override</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-3 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 bg-brand-800 rounded-full flex items-center justify-center text-white font-bold text-sm">
                  {pendingOverride.member?.nama_panggilan?.[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="text-white text-sm font-semibold">{pendingOverride.member?.nama_panggilan}</p>
                  <p className="text-gray-400 text-xs">{pendingOverride.member?.lingkungan}</p>
                </div>
              </div>
              <p className="text-yellow-400 text-xs leading-relaxed">{pendingOverride.reason}</p>
            </div>

            <p className="text-gray-300 text-xs text-center mb-3">Alasan override (dicatat di log):</p>
            <div className="space-y-2">
              {['Hadir tapi lupa scan','Scan telat','Menggantikan mendadak','Keperluan lain'].map(r => (
                <button key={r} onClick={() => doAdminOverride(r)}
                  className="w-full py-2.5 px-4 bg-brand-900 hover:bg-brand-800 text-white rounded-xl text-sm font-medium transition-colors flex items-center gap-2">
                  <Shield size={14} className="text-brand-400"/> {r}
                </button>
              ))}
            </div>
            <button onClick={handleReset} className="mt-3 w-full py-2 text-gray-400 text-sm hover:text-white">
              Batal (Scan Berikutnya)
            </button>
          </div>
        )}

        {/* Result overlay */}
        {result && (
          <div className="bg-gray-900 rounded-2xl p-8 max-w-sm w-full text-center">
            {result.status === 'success'  && <CheckCircle size={64}  className="text-green-400 mx-auto mb-4"/>}
            {result.status === 'warning'  && <AlertTriangle size={64} className="text-yellow-400 mx-auto mb-4"/>}
            {result.status === 'error'    && <XCircle size={64}      className="text-red-400 mx-auto mb-4"/>}
            {result.status === 'invalid'  && (
              <div className="mx-auto mb-4 w-16 h-16 bg-red-900/30 rounded-full flex items-center justify-center">
                <Clock size={40} className="text-red-400"/>
              </div>
            )}

            <h3 className={`font-bold text-xl mb-2 ${
              result.status === 'success' ? 'text-green-300' :
              result.status === 'warning' ? 'text-yellow-300' :
              result.status === 'invalid' ? 'text-red-300' : 'text-red-300'
            }`}>
              {result.status === 'success' ? 'Berhasil' :
               result.status === 'warning' ? 'Anomali' :
               result.status === 'invalid' ? 'Scan Tidak Valid' : 'Gagal'}
            </h3>

            <p className="text-gray-200 text-sm mb-2 whitespace-pre-line">{result.message}</p>

            {result.status === 'invalid' && result.nextWindow && (
              <div className="mt-2 py-1.5 px-3 bg-blue-900/30 rounded-lg">
                <p className="text-blue-400 text-xs flex items-center gap-1 justify-center">
                  <Clock size={11}/> {result.nextWindow}
                </p>
              </div>
            )}

            {result.member && (
              <div className="bg-gray-800 rounded-xl p-3 mt-3 text-left">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-brand-800 rounded-full flex items-center justify-center text-white font-bold text-sm">
                    {result.member.nama_panggilan?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-white text-sm font-semibold">{result.member.nama_panggilan}</p>
                    <p className="text-gray-400 text-xs">{result.member.lingkungan}</p>
                  </div>
                </div>
                {result.activeWindows?.length > 0 && (
                  <p className="text-green-400 text-xs mt-2">Window aktif: {result.activeWindows.join(', ')}</p>
                )}
              </div>
            )}

            {result.isLegacy && (
              <div className="mt-2 py-1.5 px-3 bg-yellow-900/30 rounded-lg">
                <p className="text-yellow-400 text-xs">⚠️ QR lama — disarankan update kartu</p>
              </div>
            )}

            <div className="mt-6">
              <p className="text-gray-400 text-sm mb-2">
                Kembali dalam <span className="font-bold text-white">{countdown}</span>s
              </p>
              <div className="w-full bg-gray-700 rounded-full h-1.5 mb-4">
                <div className="bg-brand-600 h-1.5 rounded-full transition-all duration-1000"
                  style={{ width: `${(countdown/AUTO_RETURN_SEC)*100}%` }}/>
              </div>
              <button onClick={handleReset} className="btn-primary w-full">Scan Berikutnya</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
