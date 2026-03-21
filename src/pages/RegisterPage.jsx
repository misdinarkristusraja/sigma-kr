import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toNickname, formatHP, PENDIDIKAN_OPTIONS, generateNickname } from '../lib/utils';
import { Church, Upload, CheckCircle, AlertCircle, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';

// Daftar lingkungan Paroki Kristus Raja Solo Baru
const LINGKUNGAN_LIST = [
  'Andreas','Bartolomeus','Benediktus','Carolus','Dominikus',
  'Elisabet','Fransiskus','Gabriel','Herkulanus','Ignatius',
  'Josephus','Kristoforus','Laurentius','Martinus','Nikolaus',
  'Petrus','Raphael','Stefanus','Thomas','Yohanes',
];

const WILAYAH_MAP = {
  1: ['Andreas','Bartolomeus','Benediktus','Carolus','Dominikus'],
  2: ['Elisabet','Fransiskus','Gabriel','Herkulanus','Ignatius'],
  3: ['Josephus','Kristoforus','Laurentius','Martinus','Nikolaus'],
  4: ['Petrus','Raphael','Stefanus','Thomas','Yohanes'],
};

// Sekolah typeahead — sample data (dalam produksi, fetch dari API/DB sekolah Jawa Tengah)
const SEKOLAH_SAMPLE = [
  'SDK Tarakanita Solo Baru','SDN Grogol 01','SDN Grogol 02','SDN Madegondo 01',
  'SMP Tarakanita Solo Baru','SMPN 1 Grogol','SMPN 2 Grogol','SMP Negeri 1 Sukoharjo',
  'SMA Negeri 1 Sukoharjo','SMA Negeri 1 Grogol','SMA Tarakanita','SMKN 1 Sukoharjo',
  'SMA Negeri 2 Sukoharjo','SMKN 2 Sukoharjo','SMA Kristen Surakarta',
];

export default function RegisterPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1); // 1=data diri, 2=sekolah & orang tua, 3=sukses
  const [loading, setLoading] = useState(false);
  const [nicknameStatus, setNicknameStatus] = useState(null); // null | 'checking' | 'ok' | 'taken'
  const [sekolahQuery, setSekolahQuery] = useState('');
  const [sekolahSuggestions, setSekolahSuggestions] = useState([]);
  const [showSekolah, setShowSekolah] = useState(false);
  const nicknameTimer = useRef(null);

  const [form, setForm] = useState({
    nama_lengkap: '', nickname: '', tanggal_lahir: '', alamat: '',
    lingkungan: '', pendidikan: '', sekolah: '',
    hp_anak: '', hp_ortu: '',
    nama_ayah: '', nama_ibu: '',
    alasan_masuk: '', sampai_kapan: '',
    surat_pernyataan: null,
  });
  const [errors, setErrors] = useState({});

  // Auto-generate nickname saat nama lengkap diubah
  function handleNamaChange(val) {
    setForm(f => {
      const newForm = { ...f, nama_lengkap: val };
      if (!f._nickname_manual) {
        // Pakai kata pertama sebagai base panggilan sementara
        const base = val.split(' ').filter(Boolean)[0] || '';
        const suggested = generateNickname(base, val);
        if (suggested) {
          newForm.nickname = suggested;
          checkNickname(suggested);
        }
      }
      return newForm;
    });
  }

  function handleNicknameChange(val) {
    const clean = toNickname(val);
    setForm(f => ({ ...f, nickname: clean, _nickname_manual: true }));
    checkNickname(clean);
  }

  function handleGenerateNickname() {
    const base = form.nickname?.split('_')[0] || form.nama_lengkap.split(' ').filter(Boolean)[0] || '';
    const suggested = generateNickname(base, form.nama_lengkap);
    if (suggested) {
      setForm(f => ({ ...f, nickname: suggested, _nickname_manual: false }));
      checkNickname(suggested);
    }
  }

  function checkNickname(value) {
    if (nicknameTimer.current) clearTimeout(nicknameTimer.current);
    if (!value || value.length < 3) { setNicknameStatus(null); return; }
    setNicknameStatus('checking');
    nicknameTimer.current = setTimeout(async () => {
      const { data } = await supabase.from('users').select('id').eq('nickname', value).maybeSingle();
      setNicknameStatus(data ? 'taken' : 'ok');
    }, 400);
  }

  function handleSekolahChange(val) {
    setSekolahQuery(val);
    setForm(f => ({ ...f, sekolah: val }));
    if (val.length > 1) {
      const filtered = SEKOLAH_SAMPLE.filter(s => s.toLowerCase().includes(val.toLowerCase()));
      setSekolahSuggestions(filtered.slice(0, 8));
      setShowSekolah(true);
    } else {
      setShowSekolah(false);
    }
  }

  function selectSekolah(s) {
    setSekolahQuery(s);
    setForm(f => ({ ...f, sekolah: s }));
    setShowSekolah(false);
  }

  function validate() {
    const e = {};
    if (!form.nama_lengkap) e.nama_lengkap = 'Wajib diisi';
    if (!form.nickname || form.nickname.length < 3) e.nickname = 'Min. 3 karakter';
    if (nicknameStatus === 'taken') e.nickname = 'Sudah dipakai, pilih yang lain';
    if (!form.tanggal_lahir) e.tanggal_lahir = 'Wajib diisi';
    if (!form.lingkungan) e.lingkungan = 'Pilih lingkungan';
    if (!form.pendidikan) e.pendidikan = 'Pilih pendidikan';
    if (!form.hp_ortu) e.hp_ortu = 'No. HP Orang Tua wajib';
    if (!form.nama_ayah && !form.nama_ibu) e.nama_ayah = 'Minimal salah satu orang tua';
    return e;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const e2 = validate();
    if (Object.keys(e2).length) { setErrors(e2); toast.error('Ada data yang belum lengkap'); return; }

    setLoading(true);
    try {
      let suratUrl = null;

      // Upload surat pernyataan
      if (form.surat_pernyataan) {
        const file = form.surat_pernyataan;
        const path = `surat/${Date.now()}_${file.name}`;
        const { error: upErr } = await supabase.storage.from('documents').upload(path, file);
        if (upErr) throw upErr;
        suratUrl = path;
      }

      // Determine is_tarakanita
      const isTarakanita = form.sekolah.toLowerCase().includes('tarakanita');

      // Tentukan wilayah dari lingkungan
      let wilayah = null;
      for (const [w, list] of Object.entries(WILAYAH_MAP)) {
        if (list.includes(form.lingkungan)) { wilayah = `Wilayah ${w}`; break; }
      }

      // Insert ke tabel registrations (atau langsung ke users dengan status Pending)
      const { error } = await supabase.from('registrations').insert({
        nama_lengkap:       form.nama_lengkap,
        nickname:           form.nickname.toLowerCase(),
        tanggal_lahir:      form.tanggal_lahir,
        alamat:             form.alamat,
        lingkungan:         form.lingkungan,
        wilayah,
        pendidikan:         form.pendidikan,
        sekolah:            form.sekolah,
        is_tarakanita:      isTarakanita,
        hp_anak:            form.hp_anak ? formatHP(form.hp_anak) : null,
        hp_ortu:            formatHP(form.hp_ortu),
        nama_ayah:          form.nama_ayah,
        nama_ibu:           form.nama_ibu,
        alasan_masuk:       form.alasan_masuk,
        sampai_kapan:       form.sampai_kapan,
        surat_pernyataan_url: suratUrl,
        status:             'Pending',
      });

      if (error) throw error;
      setStep(3);
    } catch (err) {
      toast.error('Gagal mendaftar: ' + (err.message || 'Coba lagi'));
    } finally {
      setLoading(false);
    }
  }

  if (step === 3) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-brand-800 to-brand-950 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center">
          <CheckCircle size={56} className="text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Pendaftaran Berhasil!</h2>
          <p className="text-gray-600 text-sm mb-6">
            Pendaftaran kamu sudah diterima dan sedang menunggu persetujuan Pengurus.
            Pengurus akan menghubungi melalui nomor HP yang kamu daftarkan.
          </p>
          <p className="text-xs text-gray-400 mb-6 italic">"Serve the Lord with Gladness"</p>
          <Link to="/jadwal" className="btn-primary w-full">Lihat Jadwal Publik</Link>
        </div>
      </div>
    );
  }

  const F = ({ name, label, required, children, hint }) => (
    <div>
      <label className="label">{label}{required && <span className="text-red-500 ml-1">*</span>}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
      {errors[name] && <p className="text-xs text-red-500 mt-1">{errors[name]}</p>}
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-800 to-brand-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex w-14 h-14 bg-white/15 rounded-2xl items-center justify-center mb-3">
            <Church size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Daftar Misdinar</h1>
          <p className="text-brand-200 text-sm">Paroki Kristus Raja Solo Baru</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-2xl p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step >= 1 ? 'bg-brand-800 text-white' : 'bg-gray-200 text-gray-500'}`}>1</div>
            <div className="flex-1 h-px bg-gray-200" />
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step >= 2 ? 'bg-brand-800 text-white' : 'bg-gray-200 text-gray-500'}`}>2</div>
            <p className="text-xs text-gray-400 ml-2">Data Diri & Orang Tua</p>
          </div>

          {/* Data Diri */}
          <F name="nama_lengkap" label="Nama Lengkap (Baptis)" required>
            <input className={`input ${errors.nama_lengkap ? 'input-error' : ''}`}
              value={form.nama_lengkap} onChange={e => handleNamaChange(e.target.value)} placeholder="Nama sesuai baptis" />
          </F>

          <F name="nickname" label="Nama Panggilan (Username)" required hint="Otomatis dari nama baptis. Bisa diubah manual.">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  className={`input ${errors.nickname ? 'input-error' : ''}`}
                  value={form.nickname}
                  onChange={e => handleNicknameChange(e.target.value)}
                  placeholder="satrio_eu"
                />
                {nicknameStatus === 'checking' && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-gray-300 border-t-brand-800 rounded-full animate-spin" />
                )}
                {nicknameStatus === 'ok' && <CheckCircle size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500" />}
                {nicknameStatus === 'taken' && <AlertCircle size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-red-500" />}
              </div>
              <button type="button" onClick={handleGenerateNickname}
                className="btn-outline btn-sm px-3 text-xs whitespace-nowrap">
                ✨ Generate
              </button>
            </div>
            {nicknameStatus === 'taken' && <p className="text-xs text-red-500 mt-1">Sudah dipakai. Coba tambahkan angka di belakang.</p>}
          </F>

          <div className="grid grid-cols-2 gap-3">
            <F name="tanggal_lahir" label="Tanggal Lahir" required>
              <input type="date" className={`input ${errors.tanggal_lahir ? 'input-error' : ''}`}
                value={form.tanggal_lahir} onChange={e => setForm(f => ({...f, tanggal_lahir: e.target.value}))} />
            </F>
            <F name="pendidikan" label="Pendidikan" required>
              <select className={`input ${errors.pendidikan ? 'input-error' : ''}`}
                value={form.pendidikan} onChange={e => setForm(f => ({...f, pendidikan: e.target.value}))}>
                <option value="">Pilih...</option>
                {PENDIDIKAN_OPTIONS.map(p => <option key={p}>{p}</option>)}
              </select>
            </F>
          </div>

          {/* Sekolah typeahead */}
          <F name="sekolah" label="Sekolah" hint="Ketik nama sekolah untuk mencari">
            <div className="relative">
              <input className="input" value={sekolahQuery} onChange={e => handleSekolahChange(e.target.value)} placeholder="Cari nama sekolah..." />
              {showSekolah && sekolahSuggestions.length > 0 && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {sekolahSuggestions.map(s => (
                    <button key={s} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                      onClick={() => selectSekolah(s)}>{s}</button>
                  ))}
                </div>
              )}
            </div>
          </F>

          <F name="lingkungan" label="Lingkungan" required>
            <select className={`input ${errors.lingkungan ? 'input-error' : ''}`}
              value={form.lingkungan} onChange={e => setForm(f => ({...f, lingkungan: e.target.value}))}>
              <option value="">Pilih lingkungan...</option>
              {LINGKUNGAN_LIST.map(l => <option key={l}>{l}</option>)}
            </select>
          </F>

          <F name="alamat" label="Alamat Rumah">
            <textarea className="input h-20 resize-none" value={form.alamat}
              onChange={e => setForm(f => ({...f, alamat: e.target.value}))} placeholder="Alamat lengkap" />
          </F>

          {/* Kontak */}
          <div className="grid grid-cols-2 gap-3">
            <F name="hp_anak" label="No. HP Anak (opsional)" hint="Kosongkan jika tidak punya HP sendiri">
              <input className="input" value={form.hp_anak}
                onChange={e => setForm(f => ({...f, hp_anak: e.target.value}))} placeholder="08xx..." />
            </F>
            <F name="hp_ortu" label="No. HP / WA Orang Tua" required>
              <input className={`input ${errors.hp_ortu ? 'input-error' : ''}`} value={form.hp_ortu}
                onChange={e => setForm(f => ({...f, hp_ortu: e.target.value}))} placeholder="08xx..." />
            </F>
          </div>

          

          <div className="grid grid-cols-2 gap-3">
            <F name="nama_ayah" label="Nama Ayah">
              <input className="input" value={form.nama_ayah}
                onChange={e => setForm(f => ({...f, nama_ayah: e.target.value}))} placeholder="Nama ayah" />
            </F>
            <F name="nama_ibu" label="Nama Ibu">
              <input className="input" value={form.nama_ibu}
                onChange={e => setForm(f => ({...f, nama_ibu: e.target.value}))} placeholder="Nama ibu" />
            </F>
          </div>

          <F name="alasan_masuk" label="Alasan Menjadi Misdinar">
            <textarea className="input h-20 resize-none" value={form.alasan_masuk}
              onChange={e => setForm(f => ({...f, alasan_masuk: e.target.value}))} placeholder="Motivasi kamu..." />
          </F>

          <F name="sampai_kapan" label="Rencana Sampai Kapan">
            <input className="input" value={form.sampai_kapan}
              onChange={e => setForm(f => ({...f, sampai_kapan: e.target.value}))} placeholder="Sampai lulus SMA, dll." />
          </F>

          {/* Upload surat */}
          <F name="surat_pernyataan" label="Surat Pernyataan Orang Tua (PDF)" hint="Maks 2MB">
            <label className="mt-1 flex items-center gap-3 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-brand-800 transition-colors">
              <Upload size={18} className="text-gray-400" />
              <span className="text-sm text-gray-500 flex-1">
                {form.surat_pernyataan ? form.surat_pernyataan.name : 'Klik untuk upload PDF...'}
              </span>
              <input type="file" accept=".pdf" className="hidden"
                onChange={e => {
                  const f = e.target.files[0];
                  if (f && f.size > 2 * 1024 * 1024) { toast.error('File terlalu besar (maks 2MB)'); return; }
                  setForm(prev => ({...prev, surat_pernyataan: f}));
                }} />
            </label>
          </F>

          <button type="submit" className="btn-primary w-full btn-lg mt-2" disabled={loading || nicknameStatus === 'taken'}>
            {loading ? (
              <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Mengirim...</>
            ) : 'Kirim Pendaftaran'}
          </button>

          <p className="text-center text-xs text-gray-400">
            Sudah punya akun?{' '}
            <Link to="/login" className="text-brand-800 font-semibold hover:underline">Masuk</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
