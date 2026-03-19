import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { generateMyID, formatHP, parseQRValue } from '../lib/utils';
import {
  Upload, Database, CheckCircle, AlertTriangle,
  Play, Download, FileSpreadsheet, Info, Settings2,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ── Normalise MyID: ambil karakter HEX valid, min 6 char ─────
function normalizeMyID(raw) {
  if (!raw) return null;
  const str = String(raw).trim().toUpperCase().replace(/\s/g, '').replace(/^0X/, '');
  if (/^[A-F0-9]{6,12}$/.test(str)) return str;
  // Kadang checksum disimpan sebagai angka desimal oleh Excel — konversi ke HEX
  const num = parseInt(str, 10);
  if (!isNaN(num) && num > 0) {
    const hex = num.toString(16).toUpperCase().padStart(10, '0');
    if (/^[A-F0-9]{6,12}$/.test(hex)) return hex;
  }
  return null;
}

function parseTimestamp(val) {
  if (!val) return new Date().toISOString();
  if (val instanceof Date) return val.toISOString();
  const str = String(val).replace(/\./g, ':').replace(/\//g, '-');
  const d = new Date(str);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// Ambil nilai dari row berdasarkan nama kolom (exact, case-insensitive)
function getCol(row, colName) {
  if (!colName) return '';
  const v = row[colName];
  if (v === undefined || v === null || String(v).trim() === '') return '';
  return String(v).trim();
}

// Coba tebak kolom checksum dari daftar kolom yang ada
function guessChecksumCol(colNames) {
  const hints = ['checksum', 'check_sum', 'myid', 'my_id', 'checksum/myid', 'cs', 'kode', 'hash'];
  for (const c of colNames) {
    if (hints.some(h => c.toLowerCase().includes(h))) return c;
  }
  // Coba lihat dari nilai — cari kolom yang isinya mirip HEX 10 char
  return '';
}

function guessCol(colNames, hints) {
  for (const c of colNames) {
    if (hints.some(h => c.toLowerCase().includes(h.toLowerCase()))) return c;
  }
  return '';
}

const MIGRATION_TYPES = [
  { key: 'members', label: 'Anggota — Member Management.xlsx',           sheet: 'Sheet1',   color: 'bg-blue-50 border-blue-300'   },
  { key: 'regis',   label: 'Registrasi — responses.xlsx (resp_regis)',   sheet: 'resp_regis', color: 'bg-green-50 border-green-300' },
  { key: 'absen',   label: 'Absensi — responses.xlsx (resp_absen)',      sheet: 'resp_absen', color: 'bg-yellow-50 border-yellow-300'},
  { key: 'swap',    label: 'Tukar Jadwal — responses.xlsx (resp_swap)',  sheet: 'resp_swap',  color: 'bg-purple-50 border-purple-300'},
];

// Definisi field yang perlu di-map per jenis migrasi
const FIELD_DEFS = {
  members: [
    { key: 'nickname',     label: 'Nickname / ID',    required: true,  hints: ['id','nickname','panggilan'] },
    { key: 'nama_lengkap', label: 'Nama Lengkap',     required: true,  hints: ['nama','name'] },
    { key: 'checksum',     label: '⭐ Checksum / MyID', required: false, hints: ['checksum','myid','check','cs','kode'] },
    { key: 'tanggal_lahir',label: 'Tanggal Lahir',    required: false, hints: ['lahir','birth','dob','tgl'] },
    { key: 'pendidikan',   label: 'Pendidikan',       required: false, hints: ['pendidikan','jenjang','pendidikan'] },
    { key: 'sekolah',      label: 'Sekolah',          required: false, hints: ['sekolah','school'] },
    { key: 'lingkungan',   label: 'Lingkungan',       required: false, hints: ['lingkungan','lingk'] },
    { key: 'wilayah',      label: 'Wilayah',          required: false, hints: ['wilayah'] },
    { key: 'email',        label: 'Email',            required: false, hints: ['email','mail'] },
    { key: 'hp_anak',      label: 'HP Anak',          required: false, hints: ['hp_user','hp_anak','no_hp','hp'] },
    { key: 'hp_ortu',      label: 'HP Orang Tua',     required: false, hints: ['hp_ortu','ortu','wali','orang tua'] },
  ],
  regis: [
    { key: 'nickname',     label: 'Nickname / Nama Panggilan', required: true,  hints: ['panggilan','nickname','id'] },
    { key: 'nama_lengkap', label: 'Nama Lengkap',    required: true,  hints: ['nama','name'] },
    { key: 'tanggal_lahir',label: 'Tanggal Lahir',   required: false, hints: ['lahir','birth','tgl'] },
    { key: 'lingkungan',   label: 'Lingkungan',      required: false, hints: ['lingkungan'] },
    { key: 'hp_ortu',      label: 'No. HP / WA',     required: false, hints: ['wa','hp','phone','ortu'] },
    { key: 'nama_ayah',    label: 'Nama Ayah',       required: false, hints: ['ayah','father'] },
    { key: 'nama_ibu',     label: 'Nama Ibu',        required: false, hints: ['ibu','mother'] },
    { key: 'alasan',       label: 'Alasan Bergabung',required: false, hints: ['alasan','reason'] },
  ],
  absen: [
    { key: 'timestamp',    label: 'Timestamp',       required: true,  hints: ['timestamp','waktu','time'] },
    { key: 'nickname',     label: 'Nickname (id)',   required: true,  hints: ['id','nickname','panggilan'] },
    { key: 'checksum',     label: '⭐ Checksum',      required: false, hints: ['checksum','myid','check','cs'] },
    { key: 'type',         label: 'Tipe (tugas/latihan)', required: false, hints: ['type','tipe','jenis'] },
    { key: 'scanner',      label: 'Email Scanner',   required: false, hints: ['scanner','pelatih','email'] },
    { key: 'qr_url',       label: 'URL QR (opsional)',required: false, hints: ['url','qr','link'] },
  ],
  swap: [
    { key: 'timestamp',    label: 'Timestamp',       required: false, hints: ['timestamp','waktu'] },
    { key: 'tertukar',     label: 'Nickname Tertukar',required: true, hints: ['tertukar','dari','requester'] },
    { key: 'penukar',      label: 'Nickname Penukar', required: true, hints: ['penukar','ke','ganti'] },
    { key: 'tanggal_misa', label: 'Tanggal Misa',    required: false, hints: ['tanggal','misa','date'] },
  ],
};

export default function MigrationPage() {
  const fileRef = useRef(null);
  const wbRef   = useRef(null);

  const [step,       setStep]      = useState('select');
  const [migType,    setMigType]   = useState('members');
  const [rawData,    setRawData]   = useState([]);
  const [colNames,   setColNames]  = useState([]);   // semua nama kolom dari Excel
  const [colMap,     setColMap]    = useState({});   // mapping field → kolom Excel
  const [preview,    setPreview]   = useState([]);
  const [sheetNames, setSheetNames]= useState([]);
  const [selSheet,   setSelSheet]  = useState('');
  const [errors,     setErrors]    = useState([]);
  const [warnings,   setWarnings]  = useState([]);
  const [result,     setResult]    = useState({ ok: 0, err: 0 });
  const [progress,   setProgress]  = useState(0);
  const [loading,    setLoading]   = useState(false);

  // ── Baca file Excel ─────────────────────────────────────────
  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb    = XLSX.read(ev.target.result, { type: 'binary', cellDates: true });
        wbRef.current = wb;
        setSheetNames(wb.SheetNames);
        const type  = MIGRATION_TYPES.find(t => t.key === migType);
        const found = wb.SheetNames.find(n =>
          n.toLowerCase() === type.sheet.toLowerCase() ||
          n.toLowerCase().includes(migType)
        ) || wb.SheetNames[0];
        setSelSheet(found);
        loadSheet(wb, found);
      } catch (err) {
        toast.error('Gagal baca file: ' + err.message);
        setLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  }

  function loadSheet(wb, sheetName) {
    try {
      const ws   = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
      if (data.length === 0) { toast.error('Sheet kosong!'); setLoading(false); return; }

      const names = Object.keys(data[0]);
      setColNames(names);
      setRawData(data);
      setPreview(data.slice(0, 5));
      setErrors([]);
      setWarnings([]);

      // Auto-map berdasarkan hints
      const fields = FIELD_DEFS[migType] || [];
      const autoMap = {};
      fields.forEach(f => {
        autoMap[f.key] = guessCol(names, f.hints);
      });
      setColMap(autoMap);
      setStep('map');  // tampilkan column mapper dulu
      toast.success(`${data.length} baris dari "${sheetName}" — periksa mapping kolom di bawah`);
    } catch (err) {
      toast.error('Gagal baca sheet: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Dry Run ──────────────────────────────────────────────────
  async function runDryRun() {
    const errs = [], warns = [];
    const fields = FIELD_DEFS[migType] || [];

    // Cek required fields ada mapping-nya
    fields.filter(f => f.required).forEach(f => {
      if (!colMap[f.key]) errs.push({ row: 0, msg: `Kolom wajib "${f.label}" belum di-map` });
    });

    // Cek isi data
    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      const rowNum = i + 2;

      if (migType === 'members') {
        const nick = getCol(row, colMap.nickname);
        const nama = getCol(row, colMap.nama_lengkap);
        const cs   = getCol(row, colMap.checksum);
        if (!nick) errs.push({ row: rowNum, msg: 'Nickname kosong' });
        if (!nama) errs.push({ row: rowNum, msg: 'Nama lengkap kosong' });
        const myid = normalizeMyID(cs);
        if (cs && !myid) warns.push({ row: rowNum, msg: `Checksum "${cs}" tidak valid HEX → akan digenerate` });
        else if (!cs)    warns.push({ row: rowNum, msg: `${nick}: tidak ada checksum → digenerate otomatis` });
      }
      if (migType === 'absen') {
        const nick = getCol(row, colMap.nickname);
        if (!nick) {
          // Coba cari URL QR di row
          const hasUrl = Object.values(row).some(v => String(v).includes('entry.1892831387'));
          if (!hasUrl) errs.push({ row: rowNum, msg: 'Nickname kosong & tidak ada URL QR' });
        }
      }
      if (migType === 'swap') {
        const from = getCol(row, colMap.tertukar);
        const to   = getCol(row, colMap.penukar);
        if (!from || !to) errs.push({ row: rowNum, msg: `Tertukar/Penukar kosong` });
      }
    }

    setErrors(errs);
    setWarnings(warns);
    if (errs.length === 0) toast.success(`Dry-run OK — ${warns.length} warning`);
    else toast.error(`${errs.length} error, ${warns.length} warning`);
    setStep('preview');
  }

  // ── Import ───────────────────────────────────────────────────
  async function runImport() {
    if (errors.some(e => e.row === 0)) {
      toast.error('Perbaiki mapping kolom dulu'); return;
    }
    if (!confirm(`Import ${rawData.length} baris? Tidak bisa dibatalkan.`)) return;
    setStep('importing');
    setLoading(true);
    let ok = 0, err = 0;
    const errDetails = [];
    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      setProgress(Math.round(((i + 1) / rawData.length) * 100));
      try {
        if (migType === 'members') await doImportMember(row);
        if (migType === 'regis')   await doImportRegis(row);
        if (migType === 'absen')   await doImportAbsen(row);
        if (migType === 'swap')    await doImportSwap(row);
        ok++;
      } catch (e) {
        err++;
        errDetails.push({ row: i + 2, msg: e.message, data: Object.values(row).slice(0,3).join(' | ') });
      }
    }
    setErrors(errDetails);
    setResult({ ok, err });
    setStep('done');
    setLoading(false);
    if (err === 0) toast.success(`✅ ${ok} baris berhasil!`);
    else toast.error(`${ok} berhasil, ${err} gagal`);
  }

  // ════════════════════════════════════════════════════════════
  // IMPORT FUNCTIONS
  // ════════════════════════════════════════════════════════════
  async function doImportMember(row) {
    const nickname     = getCol(row, colMap.nickname).toLowerCase().replace(/\s+/g,'_');
    const namaLengkap  = getCol(row, colMap.nama_lengkap);
    const checksumRaw  = getCol(row, colMap.checksum);
    const tglLahir     = getCol(row, colMap.tanggal_lahir);
    const sekolah      = getCol(row, colMap.sekolah);

    if (!nickname)    throw new Error('Nickname kosong');
    if (!namaLengkap) throw new Error('Nama lengkap kosong');

    // ── PRESERVASI CHECKSUM LAMA ─────────────────────────────
    // Prioritas: ambil dari Excel, normalise, jika tidak valid generate baru
    let myid = normalizeMyID(checksumRaw);
    if (!myid) myid = await generateMyID(nickname, tglLahir || '2000-01-01');

    const { error } = await supabase.from('users').upsert({
      nickname,
      myid,                   // ← checksum lama dipreservasi di sini
      nama_lengkap:   namaLengkap,
      nama_panggilan: getCol(row, colMap.nickname) || nickname,
      tanggal_lahir:  tglLahir || null,
      pendidikan:     getCol(row, colMap.pendidikan) || null,
      sekolah:        sekolah || null,
      is_tarakanita:  sekolah.toLowerCase().includes('tarakanita'),
      wilayah:        getCol(row, colMap.wilayah) || null,
      lingkungan:     getCol(row, colMap.lingkungan) || '',
      email:          getCol(row, colMap.email) || `${nickname}@sigma.krsoba.id`,
      hp_anak:        getCol(row, colMap.hp_anak) ? formatHP(getCol(row, colMap.hp_anak)) : null,
      hp_ortu:        getCol(row, colMap.hp_ortu) ? formatHP(getCol(row, colMap.hp_ortu)) : null,
      role:           'Misdinar_Aktif',
      status:         'Active',
      created_at:     new Date().toISOString(),
      updated_at:     new Date().toISOString(),
    }, { onConflict: 'nickname' });
    if (error) throw new Error(error.message);
  }

  async function doImportRegis(row) {
    const nickname = getCol(row, colMap.nickname).toLowerCase().trim();
    if (!nickname) throw new Error('Nickname kosong');
    const { error } = await supabase.from('registrations').upsert({
      nickname,
      nama_lengkap:  getCol(row, colMap.nama_lengkap) || '',
      tanggal_lahir: getCol(row, colMap.tanggal_lahir) || null,
      lingkungan:    getCol(row, colMap.lingkungan) || '',
      hp_ortu:       getCol(row, colMap.hp_ortu) ? formatHP(getCol(row, colMap.hp_ortu)) : '',
      nama_ayah:     getCol(row, colMap.nama_ayah) || null,
      nama_ibu:      getCol(row, colMap.nama_ibu) || null,
      alasan_masuk:  getCol(row, colMap.alasan) || null,
      status:        'Migrated',
    }, { onConflict: 'nickname' });
    if (error) throw new Error(error.message);
  }

  async function doImportAbsen(row) {
    let nickname = getCol(row, colMap.nickname).toLowerCase().trim();
    let csRaw    = getCol(row, colMap.checksum);
    let typeRaw  = getCol(row, colMap.type).toLowerCase();
    const ts     = parseTimestamp(getCol(row, colMap.timestamp));

    // Coba parse dari URL QR jika nickname kosong
    if (!nickname) {
      const urlVal = getCol(row, colMap.qr_url) ||
        Object.values(row).find(v => String(v).includes('entry.1892831387'));
      if (urlVal) {
        const parsed = parseQRValue(String(urlVal));
        if (parsed) { nickname = parsed.nickname; csRaw = parsed.myid; typeRaw = parsed.type; }
      }
    }
    if (!nickname) throw new Error('Nickname kosong');

    const { data: user } = await supabase.from('users').select('id,myid').eq('nickname', nickname).maybeSingle();
    if (!user) throw new Error(`"${nickname}" belum ada di tabel users — import Anggota dulu`);

    const myidNorm  = normalizeMyID(csRaw);
    const isAnomaly = myidNorm ? user.myid !== myidNorm : false;
    const typeMap   = { tugas:'tugas', latihan:'latihan', 'walk-in':'walkin_tugas', walkin:'walkin_tugas' };
    const scanType  = typeMap[typeRaw] || 'tugas';

    const { error } = await supabase.from('scan_records').insert({
      user_id: user.id, event_id: null,
      scanner_user_id: user.id,
      scan_type:    scanType,
      is_walk_in:   scanType.includes('walkin'),
      timestamp:    ts,
      qr_version:   'legacy',
      raw_qr_value: JSON.stringify(row),
      is_anomaly:   isAnomaly,
      anomaly_reason: isAnomaly ? `Checksum tidak cocok: Excel="${myidNorm}" DB="${user.myid}"` : null,
    });
    if (error) throw new Error(error.message);
  }

  async function doImportSwap(row) {
    const from = getCol(row, colMap.tertukar).toLowerCase().trim();
    const to   = getCol(row, colMap.penukar).toLowerCase().trim();
    const ts   = parseTimestamp(getCol(row, colMap.timestamp));
    if (!from || !to) throw new Error('Tertukar/Penukar kosong');
    const [{ data: u1 }, { data: u2 }] = await Promise.all([
      supabase.from('users').select('id').eq('nickname', from).maybeSingle(),
      supabase.from('users').select('id').eq('nickname', to).maybeSingle(),
    ]);
    if (!u1) throw new Error(`"${from}" tidak ditemukan`);
    if (!u2) throw new Error(`"${to}" tidak ditemukan`);
    const { error } = await supabase.from('swap_requests').insert({
      requester_id:  u1.id,
      assignment_id: '00000000-0000-0000-0000-000000000000',
      alasan:        `Historis — ${getCol(row, colMap.tanggal_misa)}`,
      pic_user_id:   u1.id, pic_wa_link: '',
      status:        'Replaced', pengganti_id: u2.id,
      expires_at:    ts, created_at: ts,
    });
    if (error && !error.message.includes('foreign key')) throw new Error(error.message);
  }

  function downloadErrors() {
    const csv = ['Row,Error,Data\n', ...errors.map(e => `${e.row},"${e.msg}","${(e.data||'').replace(/"/g,'""')}"\n`)].join('');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF'+csv], { type: 'text/csv' }));
    a.download = `errors-${migType}.csv`;
    a.click();
  }

  function reset() {
    setStep('select'); setRawData([]); setColNames([]); setColMap({});
    setErrors([]); setWarnings([]); if (fileRef.current) fileRef.current.value = '';
  }

  const fields = FIELD_DEFS[migType] || [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Migrasi Data</h1>
        <p className="page-subtitle">Import historis dari Excel — checksum lama dipreservasi otomatis</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: pilih jenis */}
        <div className="space-y-3">
          <div className="card">
            <h3 className="font-semibold text-gray-700 mb-3 text-sm">Jenis Migrasi</h3>
            <div className="space-y-2">
              {MIGRATION_TYPES.map(t => (
                <label key={t.key} className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${migType===t.key ? 'border-brand-800 bg-brand-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <input type="radio" name="migType" value={t.key} checked={migType===t.key}
                    className="mt-0.5"
                    onChange={() => { setMigType(t.key); reset(); }} />
                  <p className="text-sm font-medium text-gray-800 leading-tight">{t.label}</p>
                </label>
              ))}
            </div>
          </div>
          <div className="card bg-amber-50 border-amber-100">
            <p className="text-xs font-semibold text-amber-800 mb-1">⚠️ Urutan Import</p>
            {['1. Anggota','2. Registrasi','3. Absensi','4. Tukar Jadwal'].map((s,i) => (
              <p key={i} className="text-xs text-amber-700">{s}</p>
            ))}
          </div>
        </div>

        {/* Right: content */}
        <div className="lg:col-span-2 space-y-4">

          {/* STEP: select */}
          {step === 'select' && (
            <div className="card text-center py-10">
              <FileSpreadsheet size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="font-medium text-gray-700 mb-4">Upload file Excel untuk migrasi <b>{MIGRATION_TYPES.find(t=>t.key===migType)?.label}</b></p>
              <button onClick={() => fileRef.current?.click()} className="btn-primary gap-2" disabled={loading}>
                <Upload size={16} /> Pilih File Excel
              </button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
            </div>
          )}

          {/* STEP: map — Column Mapper */}
          {step === 'map' && (
            <div className="card space-y-4">
              <div className="flex items-center gap-2">
                <Settings2 size={18} className="text-brand-800" />
                <h3 className="font-bold text-gray-900">Mapping Kolom Excel</h3>
                <span className="badge-yellow ml-auto text-xs">{rawData.length} baris</span>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex gap-2">
                <Info size={15} className="text-blue-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700">
                  Pilih kolom Excel yang sesuai untuk setiap field. Kolom bertanda <b>⭐</b> adalah checksum/MyID lama —
                  pastikan dipilih dengan benar agar QR lama tetap valid!
                </p>
              </div>

              {/* Sheet selector */}
              {sheetNames.length > 1 && (
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-gray-600 w-32">Sheet:</label>
                  <select className="input w-auto text-sm" value={selSheet}
                    onChange={e => { setSelSheet(e.target.value); loadSheet(wbRef.current, e.target.value); }}>
                    {sheetNames.map(n => <option key={n}>{n}</option>)}
                  </select>
                </div>
              )}

              {/* Field mapper */}
              <div className="space-y-2">
                {fields.map(f => (
                  <div key={f.key} className="flex items-center gap-3">
                    <div className="w-44 flex-shrink-0">
                      <span className="text-sm font-medium text-gray-700">{f.label}</span>
                      {f.required && <span className="text-red-500 ml-1 text-xs">*wajib</span>}
                    </div>
                    <select
                      className={`input flex-1 text-sm ${
                        f.required && !colMap[f.key] ? 'border-red-400' :
                        f.key === 'checksum' && colMap[f.key] ? 'border-green-400 bg-green-50' : ''
                      }`}
                      value={colMap[f.key] || ''}
                      onChange={e => setColMap(m => ({ ...m, [f.key]: e.target.value }))}
                    >
                      <option value="">— tidak ada / lewati —</option>
                      {colNames.map(c => (
                        <option key={c} value={c}>
                          {c} {/* tampilkan contoh nilai */}
                          {rawData[0] && rawData[0][c] ? ` (contoh: ${String(rawData[0][c]).slice(0,20)})` : ''}
                        </option>
                      ))}
                    </select>
                    {/* Indikator checksum */}
                    {f.key === 'checksum' && colMap[f.key] && (
                      <span className="text-xs text-green-600 font-semibold flex-shrink-0">✓ Terpilih</span>
                    )}
                    {f.key === 'checksum' && !colMap[f.key] && (
                      <span className="text-xs text-orange-500 flex-shrink-0">→ auto-generate</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Preview sample data */}
              <div className="overflow-x-auto max-h-40 border border-gray-100 rounded-xl">
                <table className="tbl text-xs">
                  <thead>
                    <tr>{colNames.slice(0, 8).map(c => <th key={c}>{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i}>{colNames.slice(0, 8).map(c => (
                        <td key={c} className="max-w-28 truncate" title={row[c]}>{String(row[c] || '').slice(0,20)}</td>
                      ))}</tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-3">
                <button onClick={runDryRun} className="btn-outline gap-2 flex-1">
                  <Play size={15} /> Dry Run (Validasi)
                </button>
                <button onClick={reset} className="btn-ghost text-sm text-gray-400">← Ganti File</button>
              </div>
            </div>
          )}

          {/* STEP: preview (setelah dry run) */}
          {step === 'preview' && (
            <div className="card space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-gray-900">{rawData.length} baris siap diimport</h3>
                <div className="flex gap-2">
                  <button onClick={() => setStep('map')} className="btn-outline btn-sm">← Edit Mapping</button>
                  <button onClick={runImport} disabled={errors.filter(e=>e.row===0).length > 0}
                    className="btn-primary btn-sm gap-1">
                    <Database size={14} /> Import
                  </button>
                </div>
              </div>

              {/* Checksum summary */}
              {migType === 'members' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-green-50 rounded-xl text-center">
                    <div className="text-lg font-bold text-green-700">
                      {rawData.filter(r => normalizeMyID(getCol(r, colMap.checksum))).length}
                    </div>
                    <div className="text-xs text-green-600">Checksum lama dipreservasi</div>
                  </div>
                  <div className="p-3 bg-yellow-50 rounded-xl text-center">
                    <div className="text-lg font-bold text-yellow-700">
                      {rawData.filter(r => !normalizeMyID(getCol(r, colMap.checksum))).length}
                    </div>
                    <div className="text-xs text-yellow-600">Checksum di-generate otomatis</div>
                  </div>
                </div>
              )}

              {warnings.length > 0 && (
                <div className="p-3 bg-yellow-50 rounded-xl border border-yellow-100">
                  <p className="text-xs font-semibold text-yellow-800">⚠️ {warnings.length} warning:</p>
                  {warnings.slice(0,4).map((w,i) => <p key={i} className="text-xs text-yellow-700">Baris {w.row}: {w.msg}</p>)}
                  {warnings.length > 4 && <p className="text-xs text-yellow-500">...+{warnings.length-4} lainnya</p>}
                </div>
              )}

              {errors.length > 0 && (
                <div className="p-3 bg-red-50 rounded-xl border border-red-100">
                  <p className="text-xs font-semibold text-red-800">❌ {errors.length} error:</p>
                  {errors.slice(0,4).map((e,i) => <p key={i} className="text-xs text-red-700">Baris {e.row}: {e.msg}</p>)}
                  <button onClick={downloadErrors} className="mt-2 btn-danger btn-sm gap-1"><Download size={12}/>Download CSV</button>
                </div>
              )}
            </div>
          )}

          {/* STEP: importing */}
          {step === 'importing' && (
            <div className="card text-center py-10">
              <div className="w-16 h-16 border-4 border-brand-100 border-t-brand-800 rounded-full animate-spin mx-auto mb-4" />
              <p className="font-semibold text-gray-900">Mengimport...</p>
              <p className="text-3xl font-black text-brand-800 mt-2">{progress}%</p>
              <div className="w-full max-w-xs mx-auto bg-gray-200 rounded-full h-2 mt-3">
                <div className="bg-brand-800 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* STEP: done */}
          {step === 'done' && (
            <div className="card space-y-4 text-center">
              {result.err === 0
                ? <CheckCircle size={48} className="text-green-500 mx-auto" />
                : <AlertTriangle size={48} className="text-yellow-500 mx-auto" />
              }
              <h3 className="font-bold text-xl">Import Selesai</h3>
              <div className="flex gap-10 justify-center">
                <div><div className="text-3xl font-black text-green-600">{result.ok}</div><div className="text-xs text-gray-500">Berhasil</div></div>
                <div><div className="text-3xl font-black text-red-600">{result.err}</div><div className="text-xs text-gray-500">Gagal</div></div>
              </div>
              {errors.length > 0 && (
                <button onClick={downloadErrors} className="btn-outline gap-2 mx-auto">
                  <Download size={16} /> Download Error Report
                </button>
              )}
              <button onClick={reset} className="btn-secondary w-full">Migrasi Data Lain</button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
