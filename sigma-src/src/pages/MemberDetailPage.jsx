import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, buildWALink, PENDIDIKAN_OPTIONS, formatHP, STATUS_LABELS, ROLE_LABELS } from '../lib/utils';
import {
  ArrowLeft, CreditCard, BarChart2, Phone, Edit2, Save, X,
  ShieldAlert, ShieldCheck, KeyRound, MessageCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';

const LINGKUNGAN_LIST = [
  'Andreas','Bartolomeus','Benediktus','Carolus','Dominikus','Elisabet',
  'Fransiskus','Gabriel','Herkulanus','Ignatius','Josephus','Kristoforus',
  'Laurentius','Martinus','Nikolaus','Petrus','Raphael','Stefanus','Thomas','Yohanes',
];
const ROLES = ['Administrator','Pengurus','Pelatih','Misdinar_Aktif','Misdinar_Retired'];

// Generate password acak 8 karakter (huruf + angka, mudah dibaca)
function genPassword(len = 8) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'; // tanpa 0/o/i/l agar tidak rancu
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Salam berdasarkan jam WIB
function getSalam() {
  const h = new Date(new Date().getTime() + 7*3600*1000).getUTCHours();
  if (h >= 5  && h < 11) return 'pagi';
  if (h >= 11 && h < 15) return 'siang';
  if (h >= 15 && h < 19) return 'sore';
  return 'malam';
}

// Build WA message template
function buildWAMessage(member, newPassword) {
  const salam = getSalam();
  const isOrtu = ['Misdinar_Aktif','Misdinar_Retired'].includes(member.role);
  const sapaan = isOrtu ? 'bapak/ibu' : 'teman-teman';
  return encodeURIComponent(
`Selamat ${salam} ${sapaan} semua. Berikut adalah username dan password yang akan digunakan untuk sistem penjadwalan SIGMA V. 2.0

username: ${member.nickname}
password: ${newPassword}
link sigma: sigma-krsoba.vercel.app

Mohon login menggunakan akun tersebut, kemudian langsung mengganti password sesuai dengan password yang mudah anda ingat namun kuat. Mohon gunakan dengan bijak dan penuh tanggung jawab. Mengenai regulasi dan tutorial akan dikirimkan via PDF/Video nantinya. Terimakasih, Berkah Dalem`
  );
}

export default function MemberDetailPage() {
  const { id } = useParams();
  const { isPengurus, isAdmin } = useAuth();
  const navigate  = useNavigate();
  const [tab,     setTab]     = useState('data');  // 'data' | 'akun'
  const [member,  setMember]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form,    setForm]    = useState({});
  const [saving,  setSaving]  = useState(false);

  // Reset password states
  const [newPw,       setNewPw]       = useState('');
  const [showPw,      setShowPw]      = useState(false);
  const [resetting,   setResetting]   = useState(false);
  const [lastPwForWA, setLastPwForWA] = useState(''); // password terakhir yang di-reset (untuk tombol WA)

  useEffect(() => { loadMember(); }, [id]);

  async function loadMember() {
    setLoading(true);
    const { data, error } = await supabase.from('users').select('*').eq('id', id).single();
    if (error) { toast.error('Anggota tidak ditemukan'); navigate('/anggota'); return; }
    setMember(data);
    setForm(data);
    setLoading(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const isTarakanita = (form.sekolah || '').toLowerCase().includes('tarakanita');
      const { error } = await supabase.from('users').update({
        nama_lengkap:   form.nama_lengkap,
        nama_panggilan: form.nama_panggilan,
        pendidikan:     form.pendidikan,
        sekolah:        form.sekolah,
        lingkungan:     form.lingkungan,
        wilayah:        form.wilayah,
        alamat:         form.alamat,
        hp_anak:        form.hp_anak ? formatHP(form.hp_anak) : null,
        hp_ortu:        form.hp_ortu ? formatHP(form.hp_ortu) : null,
        nama_ayah:      form.nama_ayah,
        nama_ibu:       form.nama_ibu,
        alasan_masuk:   form.alasan_masuk,
        sampai_kapan:   form.sampai_kapan,
        is_tarakanita:  isTarakanita,
        ...(isAdmin && { role: form.role, status: form.status }),
        updated_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
      toast.success('Data berhasil diperbarui!');
      setEditing(false);
      loadMember();
    } catch (err) {
      toast.error('Gagal: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleSuspend() {
    const newVal = !member.is_suspended;
    const until  = newVal ? new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0] : null;
    const { error } = await supabase.from('users')
      .update({ is_suspended: newVal, suspended_until: until }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(newVal ? 'Disuspend 30 hari' : 'Suspend dicabut');
    loadMember();
  }

  // ── Reset password via Supabase Admin API ─────────────────
  async function handleResetPassword() {
    if (!newPw || newPw.length < 6) { toast.error('Password minimal 6 karakter'); return; }
    if (!confirm(`Reset password ${member.nama_panggilan} ke password baru?`)) return;
    setResetting(true);
    try {
      // Gunakan RPC admin_reset_password (SECURITY DEFINER — bypass anon key restriction)
      const { data, error } = await supabase.rpc('admin_reset_password', {
        p_user_id:      id,
        p_new_password: newPw,
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.error);

      setLastPwForWA(newPw);
      toast.success(`Password ${member.nama_panggilan} berhasil direset!`);
      setShowPw(false);
      setNewPw('');
      loadMember();
    } catch (err) {
      toast.error('Gagal reset: ' + err.message);
    } finally {
      setResetting(false);
    }
  }

  function openWA(hp, pw) {
    const phone = (hp || '').replace(/\D/g,'');
    if (!phone) { toast.error('Nomor HP tidak ada'); return; }
    const msg = buildWAMessage(member, pw);
    window.open(`https://wa.me/${phone.startsWith('0') ? '62' + phone.slice(1) : phone}?text=${msg}`, '_blank');
  }

  const F = ({ label, name, type='text', options, textarea, disabled: dis }) => (
    <div>
      <label className="label text-xs">{label}</label>
      {!editing || dis ? (
        <p className="text-sm text-gray-800 py-1">{form[name] || '—'}</p>
      ) : textarea ? (
        <textarea className="input h-20 resize-none text-sm" value={form[name] || ''}
          onChange={e => setForm(f => ({...f, [name]: e.target.value}))}/>
      ) : options ? (
        <select className="input text-sm" value={form[name] || ''}
          onChange={e => setForm(f => ({...f, [name]: e.target.value}))}>
          <option value="">— Pilih —</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} className="input text-sm" value={form[name] || ''}
          onChange={e => setForm(f => ({...f, [name]: e.target.value}))}/>
      )}
    </div>
  );

  if (loading) return (
    <div className="space-y-4">{[1,2,3].map(i=><div key={i} className="skeleton h-24 rounded-xl"/>)}</div>
  );
  if (!member) return null;

  const hp = member.hp_anak || member.hp_ortu || '';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link to="/anggota" className="btn-ghost p-2"><ArrowLeft size={20}/></Link>
        <div className="flex-1">
          <h1 className="page-title">{member.nama_panggilan}</h1>
          <p className="page-subtitle">@{member.nickname} · {member.lingkungan}</p>
        </div>
        {isPengurus && (
          <div className="flex gap-2">
            {tab === 'data' && !editing && (
              <button onClick={() => setEditing(true)} className="btn-outline gap-2">
                <Edit2 size={15}/> Edit
              </button>
            )}
            {tab === 'data' && editing && (
              <>
                <button onClick={() => { setEditing(false); setForm(member); }} className="btn-secondary gap-2">
                  <X size={15}/> Batal
                </button>
                <button onClick={handleSave} disabled={saving} className="btn-primary gap-2">
                  <Save size={15}/> {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Badges */}
      <div className="flex gap-2 flex-wrap">
        <span className={`badge ${member.status === 'Active' ? 'badge-green' : member.status === 'Pending' ? 'badge-yellow' : 'badge-gray'}`}>
          {STATUS_LABELS[member.status] || member.status}
        </span>
        <span className="badge-blue">{ROLE_LABELS[member.role] || member.role}</span>
        {member.is_tarakanita && <span className="badge-blue">🏫 Tarakanita</span>}
        {member.is_suspended && <span className="badge-red">⛔ Suspended s/d {member.suspended_until}</span>}
        {member.must_change_password && <span className="badge-yellow">🔑 Wajib Ganti Password</span>}
        <span className="badge-gray text-xs font-mono">MyID: {member.myid}</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {[
          { key: 'data', label: '👤 Data Diri' },
          { key: 'akun', label: '🔑 Akun & WA' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab===t.key?'bg-white text-brand-800 shadow-sm':'text-gray-500'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── TAB DATA DIRI ─── */}
      {tab === 'data' && (
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="card space-y-3">
            <h3 className="font-semibold text-gray-700">Data Diri</h3>
            <F label="Nama Lengkap"   name="nama_lengkap"/>
            <F label="Nama Panggilan" name="nama_panggilan"/>
            <F label="Tanggal Lahir"  name="tanggal_lahir" type="date" disabled/>
            <div className="grid grid-cols-2 gap-3">
              <F label="Pendidikan" name="pendidikan" options={PENDIDIKAN_OPTIONS}/>
              <F label="Lingkungan" name="lingkungan" options={LINGKUNGAN_LIST}/>
            </div>
            <F label="Sekolah"   name="sekolah"/>
            <F label="Wilayah"   name="wilayah"/>
            <F label="Alamat"    name="alamat" textarea/>
          </div>

          <div className="space-y-4">
            <div className="card space-y-3">
              <h3 className="font-semibold text-gray-700">Kontak</h3>
              <F label="HP Anak"      name="hp_anak"/>
              <F label="HP Orang Tua" name="hp_ortu"/>
              <F label="Nama Ayah"    name="nama_ayah"/>
              <F label="Nama Ibu"     name="nama_ibu"/>
            </div>
            <div className="card space-y-3">
              <h3 className="font-semibold text-gray-700">Motivasi</h3>
              <F label="Alasan Masuk"  name="alasan_masuk" textarea/>
              <F label="Sampai Kapan"  name="sampai_kapan"/>
            </div>
            {isAdmin && (
              <div className="card space-y-3 border-brand-100">
                <h3 className="font-semibold text-brand-800 text-sm">⚙️ Admin</h3>
                <F label="Role"   name="role"   options={ROLES}/>
                <F label="Status" name="status" options={['Active','Pending','Retired']}/>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB AKUN & WA ─── */}
      {tab === 'akun' && isAdmin && (
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Reset Password */}
          <div className="card space-y-4">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <KeyRound size={16} className="text-brand-800"/> Reset Password
            </h3>
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs text-yellow-800">
              Admin tidak dapat melihat password sekarang. Setelah reset, anggota diwajibkan mengganti password saat login berikutnya.
            </div>

            <div>
              <label className="label text-xs">Password Baru</label>
              <div className="flex gap-2">
                <input
                  type={showPw ? 'text' : 'password'}
                  className="input flex-1"
                  value={newPw}
                  placeholder="Min. 6 karakter"
                  onChange={e => setNewPw(e.target.value)}
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="btn-ghost px-3 text-xs">{showPw ? 'Sembunyikan' : 'Lihat'}</button>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setNewPw(genPassword())}
                className="btn-outline btn-sm gap-1 text-xs flex-1">
                🎲 Generate Otomatis
              </button>
              <button
                onClick={handleResetPassword}
                disabled={resetting || !newPw}
                className="btn-primary btn-sm gap-1 flex-1">
                {resetting ? 'Mereset...' : '🔑 Reset'}
              </button>
            </div>

            {newPw && (
              <div className="bg-gray-50 rounded-xl p-3 font-mono text-sm text-center border border-dashed border-gray-300">
                Password baru: <strong>{newPw}</strong>
              </div>
            )}
          </div>

          {/* WA Kredensial */}
          <div className="card space-y-4">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <MessageCircle size={16} className="text-green-600"/> Kirim Kredensial via WA
            </h3>

            <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600 leading-relaxed">
              <p className="font-semibold mb-1">Preview pesan yang akan dikirim:</p>
              <p className="italic whitespace-pre-line text-gray-500 text-[11px]">{
`Selamat ${getSalam()} bapak/ibu semua. Berikut adalah username dan password yang akan digunakan untuk sistem penjadwalan SIGMA V. 2.0

username: ${member.nickname}
password: [password yang di-reset]
link sigma: sigma-krsoba.vercel.app

Mohon login... (dst)`
              }</p>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-gray-500">Kirim ke nomor:</p>
              {member.hp_ortu && (
                <button
                  onClick={() => {
                    const pw = lastPwForWA || newPw;
                    if (!pw) { toast.error('Reset password dulu sebelum kirim WA'); return; }
                    openWA(member.hp_ortu, pw);
                  }}
                  className="btn-outline w-full gap-2 text-sm justify-start">
                  <MessageCircle size={15} className="text-green-600"/>
                  WA Orang Tua: {member.hp_ortu}
                </button>
              )}
              {member.hp_anak && (
                <button
                  onClick={() => {
                    const pw = lastPwForWA || newPw;
                    if (!pw) { toast.error('Reset password dulu sebelum kirim WA'); return; }
                    openWA(member.hp_anak, pw);
                  }}
                  className="btn-outline w-full gap-2 text-sm justify-start">
                  <MessageCircle size={15} className="text-green-600"/>
                  WA Anak: {member.hp_anak}
                </button>
              )}
              {!member.hp_ortu && !member.hp_anak && (
                <p className="text-xs text-orange-500">⚠️ Tidak ada nomor HP yang terdaftar. Edit data diri dulu.</p>
              )}
            </div>

            {!lastPwForWA && !newPw && (
              <p className="text-xs text-gray-400 italic">
                💡 Reset password dulu (tab kiri), lalu tombol WA akan berisi password baru secara otomatis.
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'akun' && !isAdmin && (
        <div className="card text-center py-10 text-gray-400">
          <KeyRound size={36} className="mx-auto mb-2 opacity-30"/>
          <p>Hanya Administrator yang dapat mengakses tab ini.</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3 flex-wrap">
        <Link to={`/kartu?user=${member.id}`} className="btn-primary gap-2">
          <CreditCard size={16}/> Kartu QR
        </Link>
        <Link to={`/rekap?user=${member.id}`} className="btn-outline gap-2">
          <BarChart2 size={16}/> Rekap Poin
        </Link>
        {isPengurus && hp && (
          <a href={buildWALink(hp, '')} target="_blank" rel="noopener noreferrer" className="btn-outline gap-2">
            <Phone size={16}/> WA
          </a>
        )}
        {isAdmin && (
          <button onClick={toggleSuspend}
            className={`gap-2 flex items-center ${member.is_suspended ? 'btn-secondary' : 'btn-danger'}`}>
            {member.is_suspended
              ? <><ShieldCheck size={16}/> Cabut Suspend</>
              : <><ShieldAlert size={16}/> Suspend 30 Hari</>
            }
          </button>
        )}
      </div>
    </div>
  );
}
