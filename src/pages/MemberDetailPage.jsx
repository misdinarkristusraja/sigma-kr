import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, buildWALink, PENDIDIKAN_OPTIONS, formatHP, STATUS_LABELS, ROLE_LABELS } from '../lib/utils';
import { ArrowLeft, CreditCard, BarChart2, Phone, Edit2, Save, X, ShieldAlert, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';

const LINGKUNGAN_LIST = [
  'Andreas','Bartolomeus','Benediktus','Carolus','Dominikus','Elisabet',
  'Fransiskus','Gabriel','Herkulanus','Ignatius','Josephus','Kristoforus',
  'Laurentius','Martinus','Nikolaus','Petrus','Raphael','Stefanus','Thomas','Yohanes',
];

const ROLES = ['Administrator','Pengurus','Pelatih','Misdinar_Aktif','Misdinar_Retired'];

export default function MemberDetailPage() {
  const { id }          = useParams();
  const { isPengurus, isAdmin } = useAuth();
  const navigate        = useNavigate();
  const [member,  setMember]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form,    setForm]    = useState({});
  const [saving,  setSaving]  = useState(false);

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
        // Role & status hanya admin yang bisa ubah
        ...(isAdmin && { role: form.role, status: form.status }),
        updated_at: new Date().toISOString(),
      }).eq('id', id);

      if (error) throw error;
      toast.success('Data anggota berhasil diperbarui!');
      setEditing(false);
      loadMember();
    } catch (err) {
      toast.error('Gagal simpan: ' + err.message);
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
    toast.success(newVal ? `${member.nama_panggilan} disuspend 30 hari` : 'Suspend dicabut');
    loadMember();
  }

  if (loading) return <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="skeleton h-20 rounded-xl" />)}</div>;
  if (!member) return null;

  const F = ({ label, name, type = 'text', options, textarea, disabled: dis }) => (
    <div>
      <label className="label text-xs">{label}</label>
      {!editing || dis ? (
        <p className="text-sm text-gray-800 py-1">{form[name] || '—'}</p>
      ) : textarea ? (
        <textarea className="input h-20 resize-none text-sm" value={form[name] || ''}
          onChange={e => setForm(f => ({...f, [name]: e.target.value}))} />
      ) : options ? (
        <select className="input text-sm" value={form[name] || ''}
          onChange={e => setForm(f => ({...f, [name]: e.target.value}))}>
          <option value="">— Pilih —</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} className="input text-sm" value={form[name] || ''}
          onChange={e => setForm(f => ({...f, [name]: e.target.value}))} />
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link to="/anggota" className="btn-ghost p-2"><ArrowLeft size={20} /></Link>
        <div className="flex-1">
          <h1 className="page-title">{member.nama_panggilan}</h1>
          <p className="page-subtitle">@{member.nickname} · {member.lingkungan}</p>
        </div>
        {isPengurus && (
          <div className="flex gap-2">
            {!editing ? (
              <button onClick={() => setEditing(true)} className="btn-outline gap-2">
                <Edit2 size={15} /> Edit
              </button>
            ) : (
              <>
                <button onClick={() => { setEditing(false); setForm(member); }} className="btn-secondary gap-2">
                  <X size={15} /> Batal
                </button>
                <button onClick={handleSave} disabled={saving} className="btn-primary gap-2">
                  <Save size={15} /> {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Badge status */}
      <div className="flex gap-2 flex-wrap">
        <span className={`badge ${member.status === 'Active' ? 'badge-green' : member.status === 'Pending' ? 'badge-yellow' : 'badge-gray'}`}>
          {STATUS_LABELS[member.status] || member.status}
        </span>
        <span className="badge-blue">{ROLE_LABELS[member.role] || member.role}</span>
        {member.is_tarakanita && <span className="badge-blue">🏫 Tarakanita</span>}
        {member.is_suspended && <span className="badge-red">⛔ Suspended s/d {member.suspended_until}</span>}
        <span className="badge-gray text-xs font-mono">MyID: {member.myid}</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* Data diri */}
        <div className="card space-y-3">
          <h3 className="font-semibold text-gray-700 flex items-center gap-2">Data Diri</h3>
          <F label="Nama Lengkap"    name="nama_lengkap" />
          <F label="Nama Panggilan"  name="nama_panggilan" />
          <F label="Tanggal Lahir"   name="tanggal_lahir" type="date" disabled />
          <div className="grid grid-cols-2 gap-3">
            <F label="Pendidikan"    name="pendidikan"   options={PENDIDIKAN_OPTIONS} />
            <F label="Lingkungan"    name="lingkungan"   options={LINGKUNGAN_LIST} />
          </div>
          <F label="Sekolah"         name="sekolah" />
          <F label="Wilayah"         name="wilayah" />
          <F label="Alamat"          name="alamat"    textarea />
        </div>

        {/* Kontak & Orang Tua */}
        <div className="space-y-4">
          <div className="card space-y-3">
            <h3 className="font-semibold text-gray-700">Kontak</h3>
            <F label="HP Anak"       name="hp_anak" />
            <F label="HP Orang Tua"  name="hp_ortu" />
            <F label="Nama Ayah"     name="nama_ayah" />
            <F label="Nama Ibu"      name="nama_ibu" />
          </div>

          <div className="card space-y-3">
            <h3 className="font-semibold text-gray-700">Motivasi</h3>
            <F label="Alasan Masuk"  name="alasan_masuk"  textarea />
            <F label="Sampai Kapan"  name="sampai_kapan" />
          </div>

          {/* Admin only: role & status */}
          {isAdmin && (
            <div className="card space-y-3 border-brand-100">
              <h3 className="font-semibold text-brand-800 text-sm">⚙️ Admin</h3>
              <F label="Role"   name="role"   options={ROLES} />
              <F label="Status" name="status" options={['Active','Pending','Retired']} />
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 flex-wrap">
        <Link to={`/kartu?user=${member.id}`} className="btn-primary gap-2">
          <CreditCard size={16} /> Kartu QR
        </Link>
        <Link to={`/rekap?user=${member.id}`} className="btn-outline gap-2">
          <BarChart2 size={16} /> Rekap Poin
        </Link>
        {isPengurus && member.hp_ortu && (
          <a href={buildWALink(member.hp_ortu)} target="_blank" rel="noopener noreferrer" className="btn-outline gap-2">
            <Phone size={16} /> WA Ortu
          </a>
        )}
        {isAdmin && (
          <button onClick={toggleSuspend}
            className={`gap-2 ${member.is_suspended ? 'btn-secondary' : 'btn-danger'} flex items-center`}>
            {member.is_suspended
              ? <><ShieldCheck size={16} /> Cabut Suspend</>
              : <><ShieldAlert size={16} /> Suspend 30 Hari</>
            }
          </button>
        )}
      </div>

      {/* Surat pernyataan */}
      {member.surat_pernyataan_url && isPengurus && (
        <div className="card bg-gray-50">
          <p className="text-sm font-medium text-gray-700 mb-2">Surat Pernyataan Orang Tua</p>
          <a href={member.surat_pernyataan_url} target="_blank" rel="noopener noreferrer"
            className="btn-outline btn-sm gap-2">Lihat / Download PDF</a>
        </div>
      )}
    </div>
  );
}
