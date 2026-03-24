import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatHP, PENDIDIKAN_OPTIONS } from '../lib/utils';
import { RefreshCw, CheckCircle, Clock, Lock } from 'lucide-react';
import toast from 'react-hot-toast';

// Daftar ulang dibuka bulan Juli
const DAFTAR_ULANG_OPEN_MONTH = 7; // Juli
const DAFTAR_ULANG_OPEN_DAY   = 1;
const DAFTAR_ULANG_CLOSE_DAY  = 31;

const LINGKUNGAN_LIST = [
  'Andreas','Bartolomeus','Benediktus','Carolus','Dominikus','Elisabet',
  'Fransiskus','Gabriel','Herkulanus','Ignatius','Josephus','Kristoforus',
  'Laurentius','Martinus','Nikolaus','Petrus','Raphael','Stefanus','Thomas','Yohanes',
];

export default function ReregistrationPage() {
  const { profile, fetchProfile } = useAuth();
  const navigate = useNavigate();
  const [form,     setForm]     = useState({});
  const [loading,  setLoading]  = useState(false);
  const [submitted,setSubmitted]= useState(false);
  const [alreadyRe,setAlreadyRe]= useState(false);

  const now     = new Date();
  const month   = now.getMonth() + 1;
  const day     = now.getDate();
  const isOpen  = month === DAFTAR_ULANG_OPEN_MONTH
    && day >= DAFTAR_ULANG_OPEN_DAY
    && day <= DAFTAR_ULANG_CLOSE_DAY;

  // Hitung hari tersisa atau hari sampai buka
  const daysUntilOpen = isOpen ? 0 : (() => {
    const target = new Date(now.getFullYear(), DAFTAR_ULANG_OPEN_MONTH - 1, DAFTAR_ULANG_OPEN_DAY);
    if (target < now) target.setFullYear(now.getFullYear() + 1);
    return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
  })();

  useEffect(() => {
    if (profile) {
      setForm({
        nama_lengkap:  profile.nama_lengkap  || '',
        nama_panggilan:profile.nama_panggilan || '',
        pendidikan:    profile.pendidikan     || '',
        sekolah:       profile.sekolah        || '',
        lingkungan:    profile.lingkungan     || '',
        alamat:        profile.alamat         || '',
        hp_anak:       profile.hp_anak        || '',
        hp_ortu:       profile.hp_ortu        || '',
        nama_ayah:     profile.nama_ayah      || '',
        nama_ibu:      profile.nama_ibu       || '',
        alasan_masuk:  profile.alasan_masuk   || '',
        sampai_kapan:  profile.sampai_kapan   || '',
      });
      // Cek apakah sudah daftar ulang tahun ini
      checkAlreadyReregistered();
    }
  }, [profile]);

  async function checkAlreadyReregistered() {
    const year = new Date().getFullYear();
    const { data } = await supabase
      .from('reregistrations')
      .select('id')
      .eq('user_id', profile.id)
      .eq('tahun', year)
      .maybeSingle();
    if (data) setAlreadyRe(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isOpen) { toast.error('Daftar ulang belum dibuka'); return; }
    if (alreadyRe) { toast.error('Kamu sudah daftar ulang tahun ini'); return; }
    if (!form.pendidikan || !form.lingkungan) {
      toast.error('Pendidikan dan lingkungan wajib diisi'); return;
    }

    setLoading(true);
    try {
      const year = new Date().getFullYear();
      const isTarakanita = (form.sekolah || '').toLowerCase().includes('tarakanita');

      // Update data profil anggota
      const { error: updateErr } = await supabase.from('users').update({
        nama_lengkap:   form.nama_lengkap,
        nama_panggilan: form.nama_panggilan,
        pendidikan:     form.pendidikan,
        sekolah:        form.sekolah,
        is_tarakanita:  isTarakanita,
        lingkungan:     form.lingkungan,
        alamat:         form.alamat,
        hp_anak:        form.hp_anak ? formatHP(form.hp_anak) : null,
        hp_ortu:        form.hp_ortu ? formatHP(form.hp_ortu) : null,
        nama_ayah:      form.nama_ayah,
        nama_ibu:       form.nama_ibu,
        alasan_masuk:   form.alasan_masuk,
        sampai_kapan:   form.sampai_kapan,
        updated_at:     new Date().toISOString(),
      }).eq('id', profile.id);
      if (updateErr) throw updateErr;

      // Catat daftar ulang
      const { error: reErr } = await supabase.from('reregistrations').insert({
        user_id:  profile.id,
        tahun:    year,
        submitted_at: new Date().toISOString(),
        data_snapshot: JSON.stringify(form),
      });
      if (reErr) throw reErr;

      // Refresh profile
      await fetchProfile();
      setSubmitted(true);
      toast.success('Daftar ulang berhasil! Data kamu sudah diperbarui.');
    } catch (err) {
      toast.error('Gagal daftar ulang: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  // Belum dibuka
  if (!isOpen) {
    return (
      <div className="space-y-5">
        <h1 className="page-title">Daftar Ulang</h1>
        <div className="card text-center py-14">
          <Lock size={48} className="mx-auto text-gray-300 mb-4" />
          <h2 className="font-bold text-xl text-gray-700">Daftar Ulang Belum Dibuka</h2>
          <p className="text-gray-500 text-sm mt-2">
            Daftar ulang akan dibuka pada <strong>1 Juli {new Date().getFullYear()}</strong>.
          </p>
          <p className="text-brand-800 font-bold text-2xl mt-4">{daysUntilOpen} hari lagi</p>
          <p className="text-xs text-gray-400 mt-1">
            Pastikan kamu siap memperbarui data sekolah, nomor HP, dan informasi lainnya.
          </p>
        </div>
      </div>
    );
  }

  // Sudah daftar ulang
  if (alreadyRe || submitted) {
    return (
      <div className="space-y-5">
        <h1 className="page-title">Daftar Ulang</h1>
        <div className="card text-center py-14">
          <CheckCircle size={48} className="mx-auto text-green-500 mb-4" />
          <h2 className="font-bold text-xl text-gray-900">Daftar Ulang Selesai</h2>
          <p className="text-gray-500 text-sm mt-2">
            Kamu sudah melakukan daftar ulang untuk tahun {new Date().getFullYear()}.
          </p>
          <p className="text-xs text-gray-400 mt-4">
            Jika ada perubahan data, hubungi Pengurus secara langsung.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <RefreshCw size={24} className="text-brand-800" /> Daftar Ulang
        </h1>
        <p className="page-subtitle">
          Perbarui data kamu untuk periode {new Date().getFullYear()}/{new Date().getFullYear() + 1}
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-blue-800">Tentang Daftar Ulang</p>
        <p className="text-xs text-blue-700 mt-1">
          Pastikan semua data sudah benar — terutama <strong>sekolah</strong>, <strong>nomor HP</strong>, dan <strong>pendidikan</strong>.
          Data ini akan digunakan untuk penjadwalan Misa Harian.
          Daftar ulang ditutup pada <strong>31 Juli {new Date().getFullYear()}</strong>.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 gap-4">
        {/* Kiri */}
        <div className="card space-y-3">
          <h3 className="font-semibold text-gray-700">Data Diri</h3>

          <div>
            <label className="label">Nama Lengkap *</label>
            <input className="input" value={form.nama_lengkap || ''} required
              onChange={e => setForm(f => ({...f, nama_lengkap: e.target.value}))} />
          </div>
          <div>
            <label className="label">Nama Panggilan *</label>
            <input className="input" value={form.nama_panggilan || ''} required
              onChange={e => setForm(f => ({...f, nama_panggilan: e.target.value}))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Pendidikan *</label>
              <select className="input" required value={form.pendidikan || ''}
                onChange={e => setForm(f => ({...f, pendidikan: e.target.value}))}>
                <option value="">— Pilih —</option>
                {PENDIDIKAN_OPTIONS.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Lingkungan *</label>
              <select className="input" required value={form.lingkungan || ''}
                onChange={e => setForm(f => ({...f, lingkungan: e.target.value}))}>
                <option value="">— Pilih —</option>
                {LINGKUNGAN_LIST.map(l => <option key={l}>{l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Sekolah</label>
            <input className="input" value={form.sekolah || ''}
              onChange={e => setForm(f => ({...f, sekolah: e.target.value}))}
              placeholder="Nama sekolah saat ini" />
          </div>
          <div>
            <label className="label">Alamat Rumah</label>
            <textarea className="input h-20 resize-none" value={form.alamat || ''}
              onChange={e => setForm(f => ({...f, alamat: e.target.value}))} />
          </div>
        </div>

        {/* Kanan */}
        <div className="space-y-4">
          <div className="card space-y-3">
            <h3 className="font-semibold text-gray-700">Kontak</h3>
            <div>
              <label className="label">No. HP Anak</label>
              <input className="input" value={form.hp_anak || ''} placeholder="08xx..."
                onChange={e => setForm(f => ({...f, hp_anak: e.target.value}))} />
            </div>
            <div>
              <label className="label">No. HP Orang Tua *</label>
              <input className="input" required value={form.hp_ortu || ''} placeholder="08xx..."
                onChange={e => setForm(f => ({...f, hp_ortu: e.target.value}))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Nama Ayah</label>
                <input className="input" value={form.nama_ayah || ''}
                  onChange={e => setForm(f => ({...f, nama_ayah: e.target.value}))} />
              </div>
              <div>
                <label className="label">Nama Ibu</label>
                <input className="input" value={form.nama_ibu || ''}
                  onChange={e => setForm(f => ({...f, nama_ibu: e.target.value}))} />
              </div>
            </div>
          </div>

          <div className="card space-y-3">
            <h3 className="font-semibold text-gray-700">Komitmen</h3>
            <div>
              <label className="label">Rencana Sampai Kapan</label>
              <input className="input" value={form.sampai_kapan || ''}
                onChange={e => setForm(f => ({...f, sampai_kapan: e.target.value}))}
                placeholder="Contoh: Sampai lulus SMA 2027" />
            </div>
            <div>
              <label className="label">Alasan / Motivasi</label>
              <textarea className="input h-24 resize-none" value={form.alasan_masuk || ''}
                onChange={e => setForm(f => ({...f, alasan_masuk: e.target.value}))} />
            </div>
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full btn-lg gap-2">
            {loading
              ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Menyimpan...</>
              : <><RefreshCw size={18} /> Konfirmasi Daftar Ulang</>
            }
          </button>
        </div>
      </form>
    </div>
  </div>
  );
}
