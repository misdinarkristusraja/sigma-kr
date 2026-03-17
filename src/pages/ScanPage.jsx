import React, { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { parseQRValue, formatWIB, sleep } from '../lib/utils';
import { CheckCircle, XCircle, AlertTriangle, Camera, X, QrCode, User } from 'lucide-react';
import toast from 'react-hot-toast';

const SCAN_COOLDOWN_MS = 60 * 60 * 1000; // 60 menit
const AUTO_RETURN_SEC  = 3;

export default function ScanPage() {
  const { profile, canScan }  = useAuth();
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const streamRef  = useRef(null);
  const animRef    = useRef(null);
  const returnRef  = useRef(null);

  const [scanning, setScanning]  = useState(false);
  const [result,   setResult]    = useState(null); // null | { status, member, message, ... }
  const [walkIn,   setWalkIn]    = useState(null); // {show, qrData} | null
  const [countdown,setCountdown] = useState(0);
  const [camError, setCamError]  = useState('');

  // ── Start camera ────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setCamError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setScanning(true);
      scanLoop();
    } catch (err) {
      setCamError('Tidak dapat mengakses kamera. Izinkan akses kamera di browser.');
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    cancelAnimationFrame(animRef.current);
    setScanning(false);
  }, []);

  useEffect(() => {
    if (canScan) startCamera();
    return () => { stopCamera(); clearInterval(returnRef.current); };
  }, [canScan]);

  // ── QR scan loop ─────────────────────────────────────────
  function scanLoop() {
    animRef.current = requestAnimationFrame(() => {
      const video  = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) { scanLoop(); return; }

      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code    = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'dontInvert' });

      if (code?.data) {
        stopCamera();
        processQR(code.data);
      } else {
        scanLoop();
      }
    });
  }

  // ── Process QR ────────────────────────────────────────────
  async function processQR(raw) {
    const parsed = parseQRValue(raw);
    if (!parsed) {
      showResult({ status: 'error', message: 'QR tidak dikenali. Format tidak valid.', raw });
      return;
    }

    // Step 1: cari user dari nickname
    const { data: member } = await supabase
      .from('users')
      .select('id, nickname, myid, nama_panggilan, lingkungan, role, status, is_suspended')
      .eq('nickname', parsed.nickname.toLowerCase())
      .maybeSingle();

    if (!member) {
      showResult({ status: 'error', message: `Misdinar "${parsed.nickname}" tidak ditemukan.` });
      return;
    }

    // Step 2: cocokkan MyID
    const isAnomaly = member.myid !== parsed.myid.toUpperCase();

    // Cek suspended
    if (member.is_suspended) {
      showResult({ status: 'error', message: `${member.nama_panggilan} sedang disuspend.`, member });
      return;
    }

    // Anti-duplikat (60 menit)
    const since = new Date(Date.now() - SCAN_COOLDOWN_MS).toISOString();
    const { data: dupe } = await supabase
      .from('scan_records')
      .select('id, timestamp, scanner_user_id, users!scanner_user_id(nama_panggilan)')
      .eq('user_id', member.id)
      .eq('scan_type', parsed.type === 'latihan' ? 'latihan' : 'tugas')
      .gte('timestamp', since)
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dupe) {
      const minsAgo = Math.floor((Date.now() - new Date(dupe.timestamp)) / 60000);
      showResult({
        status: 'warning',
        message: `${member.nama_panggilan} sudah discan ${minsAgo} menit lalu oleh ${dupe.users?.nama_panggilan}.`,
        member,
      });
      return;
    }

    // Cari event aktif
    const today = new Date().toISOString().split('T')[0];
    const { data: activeEvent } = await supabase
      .from('events')
      .select('id, nama_event, tipe_event')
      .lte('tanggal_tugas', today)
      .gte('tanggal_tugas', today)
      .in('status_event', ['Akan_Datang', 'Berlangsung'])
      .not('tipe_event', 'eq', 'Misa_Harian')
      .order('tanggal_tugas')
      .limit(1)
      .maybeSingle();

    // Cek apakah ada di jadwal
    let assignmentId = null;
    let isWalkInScan = false;

    if (activeEvent) {
      const { data: assignment } = await supabase
        .from('assignments')
        .select('id')
        .eq('user_id', member.id)
        .eq('event_id', activeEvent.id)
        .maybeSingle();

      if (!assignment && parsed.type !== 'latihan') {
        // Walk-in dialog
        setWalkIn({ qrData: parsed, member, activeEvent, isAnomaly, raw });
        return;
      }
      assignmentId = assignment?.id || null;
      isWalkInScan = !assignment;
    } else {
      // Tidak ada event mingguan aktif → cari Misa Harian terdekat
      const { data: harian } = await supabase
        .from('events')
        .select('id, nama_event')
        .eq('tipe_event', 'Misa_Harian')
        .eq('tanggal_tugas', today)
        .limit(1)
        .maybeSingle();

      if (harian) assignmentId = null; // attach ke harian
    }

    await saveScanRecord({ member, parsed, assignmentId, isAnomaly, isWalkIn: isWalkInScan, walkInReason: null, raw });
  }

  async function saveScanRecord({ member, parsed, assignmentId, isAnomaly, isWalkIn, walkInReason, raw }) {
    const scanType = parsed.type === 'latihan'
      ? (isWalkIn ? 'walkin_latihan' : 'latihan')
      : (isWalkIn ? 'walkin_tugas' : 'tugas');

    const { error } = await supabase.from('scan_records').insert({
      user_id:        member.id,
      event_id:       assignmentId ? null : undefined, // simplified
      scanner_user_id: profile?.id,
      scan_type:      scanType,
      is_walk_in:     isWalkIn,
      walkin_reason:  walkInReason,
      timestamp:      new Date().toISOString(),
      qr_version:     parsed.version,
      raw_qr_value:   raw,
      is_anomaly:     isAnomaly,
      anomaly_reason: isAnomaly ? 'MyID tidak cocok' : null,
    });

    if (error) {
      showResult({ status: 'error', message: 'Gagal menyimpan scan: ' + error.message });
      return;
    }

    showResult({
      status: isAnomaly ? 'warning' : 'success',
      message: isAnomaly
        ? `✓ Scan disimpan (ANOMALI: MyID tidak cocok) — ${member.nama_panggilan}`
        : `✓ Scan berhasil — ${member.nama_panggilan}`,
      member,
      scanType,
      isLegacy: parsed.version === 'legacy',
    });
  }

  function showResult(data) {
    setResult(data);
    setWalkIn(null);
    let sec = AUTO_RETURN_SEC;
    setCountdown(sec);
    clearInterval(returnRef.current);
    returnRef.current = setInterval(() => {
      sec -= 1;
      setCountdown(sec);
      if (sec <= 0) {
        clearInterval(returnRef.current);
        handleReset();
      }
    }, 1000);
  }

  function handleReset() {
    setResult(null);
    setWalkIn(null);
    setCountdown(0);
    clearInterval(returnRef.current);
    startCamera();
  }

  async function confirmWalkIn(reason) {
    if (!walkIn) return;
    await saveScanRecord({
      member: walkIn.member,
      parsed: walkIn.qrData,
      assignmentId: null,
      isAnomaly: walkIn.isAnomaly,
      isWalkIn: true,
      walkInReason: reason,
      raw: walkIn.raw,
    });
  }

  if (!canScan && !profile) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-white text-center p-6">
        <div>
          <QrCode size={48} className="mx-auto mb-4 text-gray-400" />
          <p className="text-lg font-semibold">Halaman ini memerlukan login</p>
          <p className="text-sm text-gray-400 mt-2">Hanya Pelatih, Pengurus, dan Administrator yang bisa scan QR.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/50">
        <div className="flex items-center gap-2">
          <QrCode size={20} className="text-brand-400" />
          <span className="text-white font-semibold">Scan Absensi</span>
        </div>
        <div className="text-xs text-gray-400">{profile?.nama_panggilan}</div>
      </div>

      {/* Camera / result area */}
      <div className="flex-1 flex items-center justify-center relative">
        {/* Camera view */}
        <div className={`relative ${result || walkIn ? 'hidden' : 'block'}`}>
          <video ref={videoRef} className="max-w-full max-h-[70vh] rounded-xl" playsInline muted />
          <canvas ref={canvasRef} className="hidden" />

          {scanning && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="qr-viewfinder" />
              <p className="absolute bottom-6 text-white/80 text-sm">Arahkan QR Code ke kamera</p>
            </div>
          )}

          {camError && (
            <div className="absolute inset-0 bg-gray-900 flex flex-col items-center justify-center p-6 rounded-xl">
              <Camera size={48} className="text-gray-500 mb-4" />
              <p className="text-white text-sm text-center">{camError}</p>
              <button onClick={startCamera} className="mt-4 btn-primary">Coba Lagi</button>
            </div>
          )}
        </div>

        {/* Walk-in dialog */}
        {walkIn && (
          <div className="bg-gray-900 rounded-2xl p-6 max-w-sm w-full mx-4">
            <div className="text-center mb-4">
              <AlertTriangle size={40} className="text-yellow-400 mx-auto mb-2" />
              <h3 className="text-white font-bold text-lg">Walk-in Terdeteksi</h3>
              <p className="text-gray-300 text-sm mt-1">
                <strong>{walkIn.member?.nama_panggilan}</strong> tidak ada di jadwal hari ini.
              </p>
            </div>
            <p className="text-gray-400 text-sm text-center mb-4">Pilih alasan walk-in:</p>
            <div className="space-y-2">
              {['Menggantikan', 'Sukarela', 'Lainnya'].map(reason => (
                <button key={reason}
                  onClick={() => confirmWalkIn(reason)}
                  className="w-full py-3 px-4 bg-gray-700 hover:bg-brand-800 text-white rounded-xl text-sm font-medium transition-colors">
                  {reason}
                </button>
              ))}
            </div>
            <button onClick={handleReset} className="mt-3 w-full py-2 text-gray-400 text-sm hover:text-white">Batal</button>
          </div>
        )}

        {/* Result overlay */}
        {result && (
          <div className="bg-gray-900 rounded-2xl p-8 max-w-sm w-full mx-4 text-center">
            {result.status === 'success' && <CheckCircle size={64} className="text-green-400 mx-auto mb-4" />}
            {result.status === 'warning' && <AlertTriangle size={64} className="text-yellow-400 mx-auto mb-4" />}
            {result.status === 'error' && <XCircle size={64} className="text-red-400 mx-auto mb-4" />}

            <h3 className={`font-bold text-xl mb-2 ${
              result.status === 'success' ? 'text-green-300'
              : result.status === 'warning' ? 'text-yellow-300'
              : 'text-red-300'
            }`}>
              {result.status === 'success' ? 'Berhasil' : result.status === 'warning' ? 'Peringatan' : 'Gagal'}
            </h3>

            <p className="text-gray-200 text-sm mb-2">{result.message}</p>

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
              </div>
            )}

            {result.isLegacy && (
              <div className="mt-2 py-1.5 px-3 bg-yellow-900/30 rounded-lg">
                <p className="text-yellow-400 text-xs">⚠️ QR lama terdeteksi — disarankan update kartu</p>
              </div>
            )}

            <div className="mt-6">
              <div className="text-gray-400 text-sm mb-2">
                Kembali otomatis dalam <span className="font-bold text-white">{countdown}</span> detik
              </div>
              <div className="w-full bg-gray-700 rounded-full h-1.5">
                <div
                  className="bg-brand-600 h-1.5 rounded-full transition-all duration-1000"
                  style={{ width: `${(countdown / AUTO_RETURN_SEC) * 100}%` }}
                />
              </div>
              <button onClick={handleReset} className="mt-4 btn-primary w-full">Scan Berikutnya</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
