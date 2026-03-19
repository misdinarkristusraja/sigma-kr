import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { generateMyID, formatHP, parseQRValue } from '../lib/utils';
import {
  Upload, Database, CheckCircle, AlertTriangle,
  Play, Download, FileSpreadsheet, Info
} from 'lucide-react';
import toast from 'react-hot-toast';

// ── Mapping kolom Excel yang mungkin berbeda-beda nama ────────
const COL = (row, ...keys) => {
  for (const k of keys) {
    const val = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
    if (val !== undefined && val !== '') return String(val).trim();
  }
  return '';
};

// ── Normalisasi checksum: uppercase, strip non-hex, ambil 10 char ──
function normalizeMyID(raw) {
  if (!raw) return null;
  const cleaned = String(raw).toUpperCase().replace(/[^0-9A-F]/g, '');
  if (cleaned.length >= 8) return cleaned.slice(0, 10).padEnd(10, '0');
  return null;
}

// ── Parse timestamp Excel (bisa Date object atau string) ──────
function parseTimestamp(val) {
  if (!val) return new Date().toISOString();
  if (val instanceof Date) return val.toISOString();
  // Format Indonesia: "27/03/2024 08.15.00" atau "2024-03-27 08:15:00"
  const str = String(val).replace(/\./g, ':').replace(/\//g, '-');
  const d = new Date(str);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

const MIGRATION_TYPES = [
  {
    key: 'members',
    label: 'Anggota (Member Management.xlsx)',
    sheet: 'Sheet1',
    desc: 'Kolom: id/nickname, nama_lengkap, checksum, pendidikan, lingkungan, hp_user, hp_ortu',
    color: 'border-blue-400 bg-blue-50',
  },
  {
    key: 'regis',
    label: 'Registrasi (responses.xlsx — resp_regis)',
    sheet: 'resp_regis',
    desc: 'Kolom: Timestamp, Nama Lengkap, Nama Panggilan, Tanggal Lahir, Lingkungan, No WA',
    color: 'border-green-400 bg-green-50',
  },
  {
    key: 'absen',
    label: 'Absensi (responses.xlsx — resp_absen / latihan / tugas)',
    sheet: 'resp_absen',
    desc: 'Kolom: Timestamp, id (nickname), checksum, type — ATAU URL QR Google Forms lama',
    color: 'border-yellow-400 bg-yellow-50',
  },
  {
    key: 'swap',
    label: 'Tukar Jadwal (responses.xlsx — resp_swap)',
    sheet: 'resp_swap',
    desc: 'Kolom: Timestamp, email, Tertukar, Penukar, Tanggal Misa, Misa',
    color: 'border-purple-400 bg-purple-50',
  },
];

export default function MigrationPage() {
  const fileRef = useRef(null);
  const [step,     setStep]    = useState('select');
  const [migType,  setMigType] = useState('members');
  const [rawData,  setRawData] = useState([]);
  const [preview,  setPreview] = useState([]);
  const [errors,   setErrors]  = useState([]);
  const [warnings, setWarnings]= useState([]);
  const [result,   setResult]  = useState({ ok: 0, err: 0 });
  const [progress, setProgress]= useState(0);
  const [loading,  setLoading] = useState(false);
  const [sheetNames, setSheetNames] = useState([]);
  const [selSheet,   setSelSheet]   = useState('');

  // ── Baca file Excel ─────────────────────────────────────────
  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb    = XLSX.read(ev.target.result, { type: 'binary', cellDates: true });
        const names = wb.SheetNames;
        setSheetNames(names);

        const type  = MIGRATION_TYPES.find(t => t.key === migType);
        // Cari sheet yang cocok (case-insensitive)
        const found = names.find(n =>
          n.toLowerCase() === type.sheet.toLowerCase() ||
          n.toLowerCase().includes(type.key)
        ) || names[0];

        setSelSheet(found);
        loadSheet(wb, found);
      } catch (err) {
        toast.error('Gagal membaca file: ' + err.message);
        setLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  }

  function loadSheet(wb, sheetName) {
    try {
      const ws   = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
      setRawData(data);
      setPreview(data.slice(0, 5));
      setStep('preview');
      setErrors([]);
      setWarnings([]);
      toast.success(`${data.length} baris dari sheet "${sheetName}"`);
    } catch (err) {
      toast.error('Gagal membaca sheet: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Dry Run ──────────────────────────────────────────────────
  async function runDryRun() {
    const errs = [], warns = [];
    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      const rowNum = i + 2;

      if (migType === 'members') {
        const nick = COL(row, 'id', 'nickname');
        const nama = COL(row, 'nama_lengkap', 'Nama Lengkap', 'nama');
        const cs   = COL(row, 'checksum', 'CheckSum', 'myid', 'MyID');

        if (!nick) errs.push({ row: rowNum, msg: 'Nickname/id kosong' });
        if (!nama) errs.push({ row: rowNum, msg: 'Nama lengkap kosong' });

        const myid = normalizeMyID(cs);
        if (!cs) {
          warns.push({ row: rowNum, msg: `${nick}: tidak ada checksum → akan digenerate otomatis` });
        } else if (!myid) {
          warns.push({ row: rowNum, msg: `${nick}: checksum "${cs}" tidak valid (bukan HEX) → akan digenerate` });
        } else if (myid.length !== 10) {
          warns.push({ row: rowNum, msg: `${nick}: checksum "${cs}" → dinormalisasi jadi "${myid}"` });
        }
      }

      if (migType === 'absen') {
        const nick = COL(row, 'id', 'nickname', 'Nickname');
        const ts   = COL(row, 'Timestamp', 'timestamp');
        if (!nick) {
          // Cek apakah ada kolom URL QR
          const urlCol = Object.values(row).find(v =>
            String(v).includes('entry.1892831387') || String(v).includes('entry.717609437')
          );
          if (!urlCol) errs.push({ row: rowNum, msg: 'Nickname kosong dan tidak ada URL QR lama' });
          else warns.push({ row: rowNum, msg: 'Akan di-parse dari URL QR Google Forms' });
        }
        if (!ts) warns.push({ row: rowNum, msg: `Baris ${rowNum}: tidak ada timestamp, akan pakai waktu sekarang` });
      }
    }
    setErrors(errs);
    setWarnings(warns);
    if (errs.length === 0) toast.success(`Dry-run OK — ${warns.length} warning`);
    else toast.error(`${errs.length} error, ${warns.length} warning`);
  }

  // ── Import utama ─────────────────────────────────────────────
  async function runImport() {
    if (errors.length > 0) {
      toast.error('Perbaiki error terlebih dahulu sebelum import');
      return;
    }
    if (!confirm(`Import ${rawData.length} baris? Proses ini tidak bisa dibatalkan.`)) return;

    setStep('importing');
    setLoading(true);
    let ok = 0, err = 0;
    const errDetails = [];

    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      setProgress(Math.round(((i + 1) / rawData.length) * 100));
      try {
        if (migType === 'members') await importMember(row);
        if (migType === 'regis')   await importRegistration(row);
        if (migType === 'absen')   await importAbsensi(row);
        if (migType === 'swap')    await importSwap(row);
        ok++;
      } catch (e) {
        err++;
        errDetails.push({
          row: i + 2,
          msg: e.message,
          data: Object.values(row).slice(0, 4).join(' | '),
        });
      }
    }

    setErrors(errDetails);
    setResult({ ok, err });
    setStep('done');
    setLoading(false);
    if (err === 0) toast.success(`✅ Semua ${ok} baris berhasil diimport!`);
    else toast.error(`${ok} berhasil, ${err} gagal`);
  }

  // ════════════════════════════════════════════════════════════
  // IMPORT MEMBER — Ini yang paling penting untuk checksum lama
  // ════════════════════════════════════════════════════════════
  async function importMember(row) {
    const nickname    = COL(row, 'id', 'nickname').toLowerCase().replace(/\s+/g, '_');
    const namaLengkap = COL(row, 'nama_lengkap', 'Nama Lengkap', 'nama');
    const namaPanel   = COL(row, 'nama_panggilan', 'Nama Panggilan') || nickname;
    const checksumRaw = COL(row, 'checksum', 'CheckSum', 'myid', 'MyID', 'check_sum');
    const sekolah     = COL(row, 'sekolah', 'Sekolah', 'school');
    const pendidikan  = COL(row, 'pendidikan', 'Pendidikan', 'jenjang');
    const lingkungan  = COL(row, 'lingkungan', 'Lingkungan', 'wilayah_lingkungan');
    const wilayah     = COL(row, 'wilayah', 'Wilayah');
    const email       = COL(row, 'email', 'Email');
    const hpAnak      = COL(row, 'hp_user', 'hp_anak', 'HP Anak', 'no_hp');
    const hpOrtu      = COL(row, 'hp_ortu', 'HP Ortu', 'HP Orangtua', 'no_ortu');
    const tglLahir    = COL(row, 'tanggal_lahir', 'Tanggal Lahir', 'tgl_lahir');

    if (!nickname) throw new Error('Nickname/id kosong');
    if (!namaLengkap) throw new Error('Nama lengkap kosong');

    // ── CHECKSUM: prioritaskan dari Excel, generate hanya jika tidak ada ──
    let myid = normalizeMyID(checksumRaw);
    if (!myid) {
      // Generate dari nickname + tanggal lahir (atau placeholder jika tidak ada tgl lahir)
      myid = await generateMyID(nickname, tglLahir || '2000-01-01');
    }

    const isTarakanita = sekolah.toLowerCase().includes('tarakanita');

    const payload = {
      nickname,
      myid,                    // ← checksum lama dipreservasi di sini
      nama_lengkap:   namaLengkap,
      nama_panggilan: namaPanel,
      tanggal_lahir:  tglLahir || null,
      pendidikan:     pendidikan || null,
      sekolah:        sekolah || null,
      is_tarakanita:  isTarakanita,
      wilayah:        wilayah || null,
      lingkungan:     lingkungan || '',
      email:          email || `${nickname}@sigma.krsoba.id`,
      hp_anak:        hpAnak ? formatHP(hpAnak) : null,
      hp_ortu:        hpOrtu ? formatHP(hpOrtu) : null,
      role:           'Misdinar_Aktif',
      status:         'Active',
      created_at:     new Date().toISOString(),
      updated_at:     new Date().toISOString(),
    };

    // Upsert: jika nickname sudah ada → update (jangan duplikat)
    // PENTING: gunakan tabel 'users', bukan 'users_migration'
    const { error } = await supabase
      .from('users')
      .upsert(payload, { onConflict: 'nickname', ignoreDuplicates: false });

    if (error) throw new Error(error.message);
  }

  // ── Import Registrasi ────────────────────────────────────────
  async function importRegistration(row) {
    const nickname = COL(row, 'Nama Panggilan', 'nama_panggilan', 'nickname', 'id').toLowerCase().trim();
    if (!nickname) throw new Error('Nickname kosong');

    const { error } = await supabase.from('registrations').upsert({
      nickname,
      nama_lengkap:  COL(row, 'Nama Lengkap', 'nama_lengkap') || '',
      tanggal_lahir: COL(row, 'Tanggal Lahir', 'tanggal_lahir') || null,
      lingkungan:    COL(row, 'Lingkungan', 'lingkungan') || '',
      hp_ortu:       COL(row, 'No WA', 'hp_ortu', 'No. HP') ? formatHP(COL(row, 'No WA', 'hp_ortu')) : '',
      hp_milik:      COL(row, 'HP milik siapa', 'hp_milik') || 'Orang Tua',
      nama_ayah:     COL(row, 'Nama Ayah', 'nama_ayah') || null,
      nama_ibu:      COL(row, 'Nama Ibu', 'nama_ibu') || null,
      alasan_masuk:  COL(row, 'Alasan', 'alasan_masuk') || null,
      sampai_kapan:  COL(row, 'Sampai kapan', 'sampai_kapan') || null,
      status:        'Migrated',
    }, { onConflict: 'nickname' });

    if (error) throw new Error(error.message);
  }

  // ── Import Absensi (mendukung QR lama & baru) ────────────────
  async function importAbsensi(row) {
    let nickname = COL(row, 'id', 'nickname', 'Nickname').toLowerCase().trim();
    let checksumRaw = COL(row, 'checksum', 'CheckSum', 'myid');
    let scanTypeRaw = COL(row, 'type', 'Type', 'tipe').toLowerCase();
    const timestamp = parseTimestamp(COL(row, 'Timestamp', 'timestamp'));

    // ── Coba parse dari URL QR Google Forms lama ──
    // Kolom mungkin bernama "QR URL", "url", atau ada di kolom tak dikenal
    if (!nickname) {
      const urlValue = Object.values(row).find(v =>
        String(v).includes('entry.1892831387') ||
        String(v).includes('entry.717609437') ||
        String(v).includes('/scan?id=')
      );
      if (urlValue) {
        const parsed = parseQRValue(String(urlValue));
        if (parsed) {
          nickname    = parsed.nickname;
          checksumRaw = parsed.myid;
          scanTypeRaw = parsed.type;
        }
      }
    }

    if (!nickname) throw new Error('Nickname kosong dan tidak ada URL QR');

    // Cari user berdasarkan nickname
    const { data: user } = await supabase
      .from('users')
      .select('id, myid')
      .eq('nickname', nickname)
      .maybeSingle();

    if (!user) throw new Error(`User "${nickname}" tidak ditemukan di tabel users. Import anggota dulu!`);

    // Validasi checksum jika ada (deteksi anomali)
    const myidNorm  = normalizeMyID(checksumRaw);
    const isAnomaly = myidNorm ? (user.myid !== myidNorm) : false;

    // Normalisasi scan_type ke enum yang valid
    const scanTypeMap = {
      'tugas':          'tugas',
      'latihan':        'latihan',
      'walkin_tugas':   'walkin_tugas',
      'walkin_latihan': 'walkin_latihan',
      'walk-in tugas':  'walkin_tugas',
      'walk-in':        'walkin_tugas',
      '':               'tugas',  // default
    };
    const scanType = scanTypeMap[scanTypeRaw] || 'tugas';

    const { error } = await supabase.from('scan_records').insert({
      user_id:          user.id,
      event_id:         null,      // event historis belum ter-link
      scanner_user_id:  user.id,   // self-scan untuk data historis
      scan_type:        scanType,
      is_walk_in:       scanType.includes('walkin'),
      timestamp,
      qr_version:       'legacy',
      raw_qr_value:     JSON.stringify(row),
      is_anomaly:       isAnomaly,
      anomaly_reason:   isAnomaly ? `Checksum tidak cocok: Excel="${myidNorm}" DB="${user.myid}"` : null,
    });

    if (error) throw new Error(error.message);
  }

  // ── Import Tukar Jadwal ──────────────────────────────────────
  async function importSwap(row) {
    const tertukar = COL(row, 'Tertukar', 'tertukar', 'nickname_asli').toLowerCase().trim();
    const penukar  = COL(row, 'Penukar',  'penukar',  'nickname_baru').toLowerCase().trim();
    const tglMisa  = COL(row, 'Tanggal Misa', 'tanggal_misa', 'Tanggal');
    const timestamp = parseTimestamp(COL(row, 'Timestamp', 'timestamp'));

    if (!tertukar || !penukar) throw new Error('Tertukar/Penukar kosong');

    // Cari user IDs
    const [{ data: u1 }, { data: u2 }] = await Promise.all([
      supabase.from('users').select('id').eq('nickname', tertukar).maybeSingle(),
      supabase.from('users').select('id').eq('nickname', penukar).maybeSingle(),
    ]);

    if (!u1) throw new Error(`User "${tertukar}" tidak ditemukan`);
    if (!u2) throw new Error(`User "${penukar}" tidak ditemukan`);

    // Simpan sebagai swap_request historis dengan status Replaced
    const { error } = await supabase.from('swap_requests').insert({
      requester_id:  u1.id,
      assignment_id: '00000000-0000-0000-0000-000000000000', // placeholder historis
      alasan:        `Migrasi historis — tanggal misa: ${tglMisa}`,
      pic_user_id:   u1.id,
      pic_wa_link:   '',
      status:        'Replaced',
      pengganti_id:  u2.id,
      expires_at:    new Date(timestamp).toISOString(),
      created_at:    new Date(timestamp).toISOString(),
    });

    if (error && !error.message.includes('foreign key')) throw new Error(error.message);
  }

  // ── Download error CSV ────────────────────────────────────────
  function downloadErrorCSV() {
    const csv = ['Row,Error,Data Preview',
      ...errors.map(e => `${e.row},"${e.msg}","${(e.data||'').replace(/"/g,'""')}"`)
    ].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `migration-errors-${migType}-${Date.now()}.csv`;
    a.click();
  }

  const selectedType = MIGRATION_TYPES.find(t => t.key === migType);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Migrasi Data</h1>
        <p className="page-subtitle">Import data historis dari Excel — checksum lama dipreservasi otomatis</p>
      </div>

      {/* Info checksum */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
        <Info size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-blue-800">Checksum / MyID dari data lama</p>
          <p className="text-xs text-blue-700 mt-1">
            Kolom <code className="bg-blue-100 px-1 rounded">checksum</code> atau <code className="bg-blue-100 px-1 rounded">CheckSum</code> dari Excel akan dipakai langsung sebagai MyID.
            QR code lama yang menggunakan URL Google Forms tetap bisa di-scan — sistem mengenali format lama secara otomatis.
            Jika checksum tidak ada atau tidak valid, akan digenerate otomatis dari nickname + tanggal lahir.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Pilih jenis migrasi */}
        <div className="space-y-3">
          <div className="card">
            <h3 className="font-semibold text-gray-700 mb-3 text-sm">Jenis Migrasi</h3>
            <div className="space-y-2">
              {MIGRATION_TYPES.map(t => (
                <label key={t.key}
                  className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                    migType === t.key ? 'border-brand-800 bg-brand-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}>
                  <input type="radio" name="migType" value={t.key} checked={migType === t.key}
                    className="mt-0.5"
                    onChange={() => {
                      setMigType(t.key);
                      setStep('select');
                      setRawData([]);
                      setPreview([]);
                      setErrors([]);
                      setWarnings([]);
                    }} />
                  <div>
                    <p className="text-sm font-medium text-gray-800 leading-tight">{t.label}</p>
                    <p className="text-xs text-gray-400 mt-1 leading-tight">{t.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Urutan import */}
          <div className="card bg-amber-50 border-amber-100">
            <p className="text-xs font-semibold text-amber-800 mb-2">⚠️ Urutan Import</p>
            {['1. Anggota dulu', '2. Registrasi', '3. Absensi', '4. Tukar Jadwal'].map((s, i) => (
              <p key={i} className="text-xs text-amber-700">{s}</p>
            ))}
          </div>
        </div>

        {/* Area upload & preview */}
        <div className="lg:col-span-2 space-y-4">

          {/* Upload */}
          {step === 'select' && (
            <div className="card text-center py-10">
              <FileSpreadsheet size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-600 font-medium mb-1">Upload file Excel</p>
              <p className="text-xs text-gray-400 mb-4">{selectedType?.desc}</p>
              <button onClick={() => fileRef.current?.click()} className="btn-primary gap-2" disabled={loading}>
                <Upload size={16} /> Pilih File Excel (.xlsx / .xls)
              </button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
            </div>
          )}

          {/* Preview */}
          {step === 'preview' && rawData.length > 0 && (
            <div className="card space-y-4">
              {/* Sheet selector */}
              {sheetNames.length > 1 && (
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-gray-700">Sheet:</label>
                  <select className="input w-auto text-sm"
                    value={selSheet}
                    onChange={e => {
                      setSelSheet(e.target.value);
                      const wb = /* re-read not possible without re-upload, show info */ null;
                      toast('Pilih ulang file untuk ganti sheet', { icon: 'ℹ️' });
                    }}>
                    {sheetNames.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              )}

              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-700">
                  Preview <span className="text-brand-800">{rawData.length} baris</span> dari sheet "{selSheet}"
                </h3>
                <div className="flex gap-2">
                  <button onClick={runDryRun} className="btn-outline btn-sm gap-1">
                    <Play size={13} /> Dry Run
                  </button>
                  <button onClick={runImport}
                    disabled={errors.length > 0}
                    className="btn-primary btn-sm gap-1">
                    <Database size={13} /> Import
                  </button>
                </div>
              </div>

              {/* Table preview */}
              <div className="overflow-x-auto max-h-52 border border-gray-100 rounded-xl">
                <table className="tbl text-xs">
                  <thead>
                    <tr>{preview[0] && Object.keys(preview[0]).slice(0, 8).map(k => <th key={k}>{k}</th>)}</tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).slice(0, 8).map((v, j) => (
                          <td key={j} className="max-w-32 truncate" title={String(v)}>{String(v).slice(0, 25)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Warnings */}
              {warnings.length > 0 && (
                <div className="p-3 bg-yellow-50 rounded-xl border border-yellow-100">
                  <p className="text-xs font-semibold text-yellow-800 mb-1">⚠️ {warnings.length} warning (bisa tetap diimport):</p>
                  {warnings.slice(0, 5).map((w, i) => (
                    <p key={i} className="text-xs text-yellow-700">Baris {w.row}: {w.msg}</p>
                  ))}
                  {warnings.length > 5 && <p className="text-xs text-yellow-500">...dan {warnings.length - 5} lainnya</p>}
                </div>
              )}

              {/* Errors */}
              {errors.length > 0 && (
                <div className="p-3 bg-red-50 rounded-xl border border-red-100">
                  <p className="text-xs font-semibold text-red-800 mb-1">❌ {errors.length} error (harus diperbaiki):</p>
                  {errors.slice(0, 5).map((e, i) => (
                    <p key={i} className="text-xs text-red-700">Baris {e.row}: {e.msg}</p>
                  ))}
                  <button onClick={downloadErrorCSV} className="mt-2 btn-danger btn-sm gap-1">
                    <Download size={12} /> Download Error CSV
                  </button>
                </div>
              )}

              <button onClick={() => { setStep('select'); setRawData([]); fileRef.current.value = ''; }}
                className="btn-ghost text-xs text-gray-400">
                ← Ganti file
              </button>
            </div>
          )}

          {/* Importing progress */}
          {step === 'importing' && (
            <div className="card text-center py-10">
              <div className="w-16 h-16 border-4 border-brand-100 border-t-brand-800 rounded-full animate-spin mx-auto mb-4" />
              <p className="font-semibold text-gray-900">Mengimport data...</p>
              <p className="text-3xl font-black text-brand-800 mt-2">{progress}%</p>
              <div className="w-full max-w-xs mx-auto bg-gray-200 rounded-full h-2 mt-3">
                <div className="bg-brand-800 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-gray-400 mt-2">Jangan tutup halaman ini</p>
            </div>
          )}

          {/* Done */}
          {step === 'done' && (
            <div className="card space-y-4">
              <div className="text-center py-4">
                {result.err === 0
                  ? <CheckCircle size={48} className="text-green-500 mx-auto mb-3" />
                  : <AlertTriangle size={48} className="text-yellow-500 mx-auto mb-3" />
                }
                <h3 className="font-bold text-xl text-gray-900">Import Selesai</h3>
                <div className="flex gap-10 justify-center mt-4">
                  <div>
                    <div className="text-3xl font-black text-green-600">{result.ok}</div>
                    <div className="text-xs text-gray-500">Berhasil</div>
                  </div>
                  <div>
                    <div className="text-3xl font-black text-red-600">{result.err}</div>
                    <div className="text-xs text-gray-500">Gagal</div>
                  </div>
                </div>
              </div>

              {errors.length > 0 && (
                <>
                  <div className="max-h-40 overflow-y-auto p-3 bg-red-50 rounded-xl">
                    {errors.map((e, i) => (
                      <p key={i} className="text-xs text-red-700">Baris {e.row}: {e.msg}</p>
                    ))}
                  </div>
                  <button onClick={downloadErrorCSV} className="btn-outline w-full gap-2">
                    <Download size={16} /> Download Error Report CSV
                  </button>
                </>
              )}

              <button onClick={() => { setStep('select'); setRawData([]); setErrors([]); setWarnings([]); }}
                className="btn-secondary w-full">
                Migrasi Data Lain
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
