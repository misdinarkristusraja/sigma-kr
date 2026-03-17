import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { generateMyID, formatHP } from '../lib/utils';
import { Upload, Database, CheckCircle, XCircle, AlertTriangle, Play, Download, FileSpreadsheet } from 'lucide-react';
import toast from 'react-hot-toast';

const MIGRATION_TYPES = [
  { key: 'members',   label: 'Anggota (Member Management.xlsx)',     sheet: 'Sheet1', desc: 'id, nama_lengkap, pendidikan, lingkungan, checksum...' },
  { key: 'regis',     label: 'Registrasi (responses.xlsx - resp_regis)', sheet: 'resp_regis', desc: 'Timestamp, Nama Lengkap, Nickname, Tanggal Lahir...' },
  { key: 'absen',     label: 'Absensi (responses.xlsx - resp_absen)', sheet: 'resp_absen', desc: 'Timestamp, scanner, id, checksum, type...' },
  { key: 'swap',      label: 'Tukar Jadwal (responses.xlsx - resp_swap)', sheet: 'resp_swap', desc: 'Timestamp, email, Tertukar, Penukar, Tanggal, Misa...' },
  { key: 'schedule',  label: 'Jadwal Historis (Schedule Maker.xlsx)', sheet: 'Sheet1', desc: 'Tanggal, tipe, perayaan, PIC, petugas...' },
];

export default function MigrationPage() {
  const fileRef     = useRef(null);
  const [step, setStep]       = useState('select'); // select | preview | importing | done
  const [migType, setMigType] = useState('members');
  const [rawData, setRawData] = useState([]);
  const [preview, setPreview] = useState([]);
  const [errors,  setErrors]  = useState([]);
  const [result,  setResult]  = useState({ ok: 0, err: 0 });
  const [progress, setProgress]= useState(0);
  const [loading, setLoading] = useState(false);

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb     = XLSX.read(ev.target.result, { type: 'binary', cellDates: true });
        const type   = MIGRATION_TYPES.find(t => t.key === migType);
        const sheet  = wb.SheetNames.includes(type.sheet) ? type.sheet : wb.SheetNames[0];
        const ws     = wb.Sheets[sheet];
        const data   = XLSX.utils.sheet_to_json(ws, { defval: '' });
        setRawData(data);
        setPreview(data.slice(0, 5));
        setStep('preview');
        toast.success(`${data.length} baris berhasil dibaca dari sheet "${sheet}"`);
      } catch (err) {
        toast.error('Gagal membaca file: ' + err.message);
      } finally {
        setLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  }

  async function runDryRun() {
    const errs = [];
    const type = migType;
    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      if (type === 'members') {
        if (!row['id'] && !row['nickname']) errs.push({ row: i+2, msg: 'Nickname kosong' });
        if (!row['nama_lengkap'] && !row['Nama Lengkap']) errs.push({ row: i+2, msg: 'Nama lengkap kosong' });
      }
    }
    setErrors(errs);
    if (errs.length === 0) toast.success('Dry-run selesai, tidak ada error!');
    else toast.error(`Dry-run: ${errs.length} baris bermasalah`);
  }

  async function runImport() {
    if (!confirm(`Import ${rawData.length} baris data? Ini tidak bisa dibatalkan.`)) return;
    setStep('importing');
    setLoading(true);
    let ok = 0, err = 0;
    const errDetails = [];

    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      setProgress(Math.round((i / rawData.length) * 100));
      try {
        if (migType === 'members') await importMember(row);
        if (migType === 'regis')   await importRegistration(row);
        if (migType === 'absen')   await importAbsensi(row);
        ok++;
      } catch (e) {
        err++;
        errDetails.push({ row: i+2, msg: e.message, data: JSON.stringify(row).slice(0, 80) });
      }
    }

    setErrors(errDetails);
    setResult({ ok, err });
    setStep('done');
    setLoading(false);
    toast.success(`Import selesai: ${ok} berhasil, ${err} gagal`);
  }

  async function importMember(row) {
    const nickname = (row['id'] || row['nickname'] || '').toLowerCase().trim();
    const namaLengkap = row['nama_lengkap'] || row['Nama Lengkap'] || '';
    const checksum    = row['checksum'] || row['CheckSum'] || '';
    const sekolah     = row['sekolah'] || row['Sekolah'] || '';
    const isTarakanita = sekolah.toLowerCase().includes('tarakanita');

    if (!nickname || !namaLengkap) throw new Error('Nickname atau nama kosong');

    // Use existing checksum or generate new
    const myid = checksum.toUpperCase() || await generateMyID(nickname, '2000-01-01');

    const payload = {
      nickname,
      myid,
      nama_lengkap:   namaLengkap,
      nama_panggilan: row['nama_panggilan'] || nickname,
      pendidikan:     row['pendidikan'] || row['Pendidikan'] || null,
      sekolah,
      is_tarakanita:  isTarakanita,
      wilayah:        row['wilayah'] || null,
      lingkungan:     row['lingkungan'] || row['Lingkungan'] || '',
      email:          row['email'] || `${nickname}@sigma.krsoba.id`,
      hp_anak:        row['hp_user'] ? formatHP(String(row['hp_user'])) : null,
      hp_ortu:        row['hp_ortu'] ? formatHP(String(row['hp_ortu'])) : '',
      role:           'Misdinar_Aktif',
      status:         'Active',
    };

    await supabase.from('users_migration').upsert(payload, { onConflict: 'nickname' });
  }

  async function importRegistration(row) {
    const nickname = (row['Nama Panggilan'] || row['nickname'] || '').toLowerCase().trim();
    if (!nickname) throw new Error('Nickname kosong');
    await supabase.from('registrations').upsert({
      nickname,
      nama_lengkap:  row['Nama Lengkap'] || '',
      tanggal_lahir: row['Tanggal Lahir'] || null,
      lingkungan:    row['Lingkungan'] || '',
      hp_ortu:       row['No WA'] ? formatHP(String(row['No WA'])) : '',
      nama_ayah:     row['Nama Ayah'] || null,
      nama_ibu:      row['Nama Ibu'] || null,
      alasan_masuk:  row['Alasan'] || null,
      status:        'Migrated',
    }, { onConflict: 'nickname' });
  }

  async function importAbsensi(row) {
    const nickname  = (row['id'] || '').toLowerCase().trim();
    const checksum  = (row['checksum'] || '').toUpperCase();
    const scanType  = row['type'] || 'tugas';
    const timestamp = row['Timestamp'] || new Date().toISOString();

    if (!nickname) throw new Error('Nickname kosong');

    const { data: user } = await supabase.from('users').select('id').eq('nickname', nickname).maybeSingle();
    if (!user) throw new Error(`User ${nickname} tidak ditemukan`);

    await supabase.from('scan_records').insert({
      user_id:     user.id,
      scan_type:   scanType,
      timestamp:   new Date(timestamp).toISOString(),
      qr_version:  'legacy',
      raw_qr_value: JSON.stringify(row),
      is_anomaly:  false,
      scanner_user_id: user.id, // self (migrated)
    });
  }

  function downloadErrorCSV() {
    const csv = ['Row,Error,Data', ...errors.map(e => `${e.row},"${e.msg}","${e.data || ''}"`)]
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'migration-errors.csv';
    link.click();
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Migrasi Data</h1>
        <p className="page-subtitle">Import data historis dari Excel ke SIGMA</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: config */}
        <div className="space-y-4">
          <div className="card">
            <h3 className="font-semibold text-gray-700 mb-3">Jenis Migrasi</h3>
            <div className="space-y-2">
              {MIGRATION_TYPES.map(t => (
                <label key={t.key} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${migType===t.key?'border-brand-800 bg-brand-50':'border-gray-200 hover:bg-gray-50'}`}>
                  <input type="radio" name="migType" value={t.key} checked={migType===t.key}
                    onChange={() => { setMigType(t.key); setStep('select'); setRawData([]); setPreview([]); setErrors([]); }} className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{t.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{t.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="card bg-amber-50 border-amber-100">
            <div className="flex gap-2">
              <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Perhatian</p>
                <p className="text-xs text-amber-700 mt-1">Selalu lakukan Dry-Run terlebih dahulu sebelum import ke database. Error report akan ter-generate otomatis.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: actions */}
        <div className="lg:col-span-2 space-y-4">
          {step === 'select' && (
            <div className="card">
              <div className="text-center py-8">
                <FileSpreadsheet size={48} className="mx-auto text-gray-300 mb-4" />
                <p className="text-gray-600 font-medium mb-4">Upload file Excel untuk migrasi</p>
                <button onClick={() => fileRef.current?.click()} className="btn-primary gap-2" disabled={loading}>
                  <Upload size={16} /> Pilih File Excel
                </button>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
              </div>
            </div>
          )}

          {step === 'preview' && rawData.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-700">Preview Data ({rawData.length} baris)</h3>
                <div className="flex gap-2">
                  <button onClick={runDryRun} className="btn-outline btn-sm gap-1"><Play size={13} /> Dry Run</button>
                  <button onClick={runImport} className="btn-primary btn-sm gap-1"><Database size={13} /> Import</button>
                </div>
              </div>
              <div className="overflow-x-auto max-h-64">
                <table className="tbl text-xs">
                  <thead>
                    <tr>{preview[0] && Object.keys(preview[0]).slice(0,8).map(k => <th key={k}>{k}</th>)}</tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i}>{Object.values(row).slice(0,8).map((v, j) => <td key={j}>{String(v).slice(0,30)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {errors.length > 0 && (
                <div className="mt-4 p-3 bg-red-50 rounded-xl">
                  <p className="text-sm font-semibold text-red-700">{errors.length} baris bermasalah</p>
                  {errors.slice(0,3).map((e,i) => <p key={i} className="text-xs text-red-600">Baris {e.row}: {e.msg}</p>)}
                  <button onClick={downloadErrorCSV} className="mt-2 btn-danger btn-sm gap-1"><Download size={12} /> Download Error Report</button>
                </div>
              )}
            </div>
          )}

          {step === 'importing' && (
            <div className="card text-center py-10">
              <div className="w-16 h-16 border-4 border-brand-800/20 border-t-brand-800 rounded-full animate-spin mx-auto mb-4" />
              <p className="font-semibold text-gray-900">Mengimport data...</p>
              <p className="text-sm text-gray-500 mt-1">{progress}%</p>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-4 max-w-xs mx-auto">
                <div className="bg-brand-800 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="card">
              <div className="text-center py-6">
                {result.err === 0 ? (
                  <CheckCircle size={48} className="text-green-500 mx-auto mb-3" />
                ) : (
                  <AlertTriangle size={48} className="text-yellow-500 mx-auto mb-3" />
                )}
                <h3 className="font-bold text-xl text-gray-900">Import Selesai</h3>
                <div className="flex gap-8 justify-center mt-4">
                  <div><div className="text-3xl font-black text-green-600">{result.ok}</div><div className="text-xs text-gray-500">Berhasil</div></div>
                  <div><div className="text-3xl font-black text-red-600">{result.err}</div><div className="text-xs text-gray-500">Gagal</div></div>
                </div>
              </div>
              {errors.length > 0 && (
                <button onClick={downloadErrorCSV} className="btn-outline w-full gap-2 mt-4"><Download size={16} /> Download Error Report CSV</button>
              )}
              <button onClick={() => { setStep('select'); setRawData([]); setPreview([]); setErrors([]); }}
                className="btn-secondary w-full mt-2">Migrasi Lain</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
