import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, ChevronDown, ChevronUp, CalendarPlus, Clock,
  MapPin, Users, Check, X, Trash2, Edit3, AlertCircle,
  BookOpen, Bell, CalendarCheck, Download,
} from 'lucide-react';
import { format, parseISO, isPast } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { exportToGCal, exportToICS, slotToCalEvent } from '../lib/calendarExport';
import { broadcastNotification } from '../hooks/useNotifications';
import toast from 'react-hot-toast';

const JENIS_OPTS = ['Misa Khusus','Misa Besar','Perarakan','Misa Rekviem','Misa Inkulturasi','Prosesi'];

// ─────────────────────────────────────────────────────────────────────
export default function SpecialMassPage() {
  const { isPengurus, isPelatih, user } = useAuth();
  const canEdit = isPengurus || isPelatih;

  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('special_mass_sessions')
      .select(`
        *,
        special_mass_slots (
          *,
          special_mass_attendance ( user_id, hadir )
        )
      `)
      .order('tanggal', { ascending: false });
    setSessions(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const handleDelete = async (id) => {
    if (!confirm('Hapus sesi ini? Semua slot & absensi ikut terhapus.')) return;
    const { error } = await supabase.from('special_mass_sessions').delete().eq('id', id);
    if (error) { toast.error('Gagal hapus'); return; }
    setSessions(p => p.filter(s => s.id !== id));
    toast.success('Sesi dihapus');
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <BookOpen size={22} className="text-brand-800"/> Latihan Misa Khusus
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Kelola sesi & slot latihan untuk misa-misa besar (bisa banyak latihan per acara)
          </p>
        </div>
        {canEdit && (
          <button onClick={() => setShowForm(true)} className="btn-primary gap-1.5">
            <Plus size={16}/> Buat Sesi Baru
          </button>
        )}
      </div>

      {loading && (
        <div className="card py-12 text-center text-gray-400">Memuat data…</div>
      )}

      {!loading && sessions.length === 0 && (
        <div className="card py-12 text-center text-gray-400">
          <BookOpen size={32} className="mx-auto mb-2 opacity-30"/>
          <p className="text-sm">Belum ada sesi latihan misa khusus.</p>
          {canEdit && (
            <button onClick={() => setShowForm(true)}
              className="btn-primary btn-sm mt-3 gap-1">
              <Plus size={14}/> Buat Sesi Pertama
            </button>
          )}
        </div>
      )}

      <div className="space-y-4">
        {sessions.map(s => (
          <SessionCard
            key={s.id} session={s} canEdit={canEdit} userId={user?.id}
            onRefresh={fetchSessions} onDelete={() => handleDelete(s.id)}
          />
        ))}
      </div>

      {showForm && (
        <SessionFormModal
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); fetchSessions(); }}
        />
      )}
    </div>
  );
}

// ── Kartu Sesi ────────────────────────────────────────────────────────
function SessionCard({ session: s, canEdit, userId, onRefresh, onDelete }) {
  const [open,       setOpen]       = useState(false);
  const [showAdd,    setShowAdd]    = useState(false);
  const [editSlot,   setEditSlot]   = useState(null);
  const [absenModal, setAbsenModal] = useState(null); // slot yang sedang diabsen

  const slots      = s.special_mass_slots || [];
  const wajibCount = slots.filter(sl => sl.is_wajib).length;
  const past       = isPast(parseISO(s.tanggal));

  const handleExportICS = () => {
    const events = slots.map(sl => slotToCalEvent(sl, s.nama_acara));
    exportToICS(events, `latihan-${s.nama_acara.replace(/\s+/g,'-').toLowerCase()}.ics`);
    toast.success('File kalender (.ics) diunduh');
  };

  const handleBroadcast = async () => {
    await broadcastNotification({
      title: `📅 Jadwal Latihan: ${s.nama_acara}`,
      body:  `Ada ${slots.length} slot latihan. Lihat jadwal di aplikasi SIGMA.`,
      type:  'latihan',
    });
    toast.success('Notifikasi dikirim ke semua anggota');
  };

  return (
    <div className="card p-0 overflow-hidden">
      {/* Header sesi */}
      <button
        onClick={() => setOpen(p => !p)}
        className="w-full text-left px-4 py-4 flex items-start justify-between hover:bg-gray-50 transition-colors">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`badge ${s.is_active && !past ? 'badge-green' : 'badge-gray'}`}>
                {s.is_active && !past ? 'Aktif' : 'Selesai'}
              </span>
              <span className="badge badge-blue">{s.jenis}</span>
            </div>
            <p className="font-semibold text-gray-800 mt-1">{s.nama_acara}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {format(parseISO(s.tanggal), 'EEEE, d MMMM yyyy', { locale: localeId })}
              {' · '}{slots.length} slot latihan
              {wajibCount > 0 && ` (${wajibCount} wajib)`}
            </p>
          </div>
        </div>
        {open ? <ChevronUp size={16} className="text-gray-400 mt-1 shrink-0"/> 
               : <ChevronDown size={16} className="text-gray-400 mt-1 shrink-0"/>}
      </button>

      {/* Expanded */}
      {open && (
        <div className="border-t border-gray-100">
          {/* Action bar */}
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex flex-wrap gap-2">
            <button onClick={handleExportICS}
              className="btn-outline btn-sm gap-1.5 text-xs">
              <Download size={13}/> Export .ics
            </button>
            <button onClick={() => exportToGCal(slotToCalEvent(slots[0] || { tanggal: s.tanggal, waktu_mulai: '09:00', nama_slot: 'Latihan' }, s.nama_acara))}
              className="btn-outline btn-sm gap-1.5 text-xs">
              <CalendarPlus size={13}/> Google Calendar
            </button>
            {canEdit && (
              <>
                <button onClick={handleBroadcast}
                  className="btn-outline btn-sm gap-1.5 text-xs">
                  <Bell size={13}/> Kirim Notif
                </button>
                <button onClick={() => setShowAdd(true)}
                  className="btn-primary btn-sm gap-1.5 text-xs ml-auto">
                  <Plus size={13}/> Tambah Slot
                </button>
                <button onClick={onDelete}
                  className="text-xs border border-red-200 text-red-600 rounded-md px-2.5 py-1
                    hover:bg-red-50 transition-colors flex items-center gap-1">
                  <Trash2 size={12}/> Hapus Sesi
                </button>
              </>
            )}
          </div>

          {/* Deskripsi */}
          {s.deskripsi && (
            <p className="px-4 py-2 text-xs text-gray-500 bg-amber-50/50 border-b border-gray-100">
              {s.deskripsi}
            </p>
          )}

          {/* Slot list */}
          {slots.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">
              Belum ada slot. {canEdit && 'Klik "+ Tambah Slot" untuk memulai.'}
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {[...slots].sort((a,b) => a.urutan - b.urutan).map(slot => (
                <SlotRow
                  key={slot.id} slot={slot} sessionName={s.nama_acara}
                  canEdit={canEdit} userId={userId}
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
        <SlotFormModal sessionId={s.id} sessionName={s.nama_acara}
          nextUrutan={slots.length + 1}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); onRefresh(); }}
        />
      )}
      {editSlot && (
        <SlotFormModal sessionId={s.id} sessionName={s.nama_acara}
          slot={editSlot}
          onClose={() => setEditSlot(null)}
          onSaved={() => { setEditSlot(null); onRefresh(); }}
        />
      )}
      {absenModal && (
        <AbsenModal slot={absenModal} sessionName={s.nama_acara}
          onClose={() => setAbsenModal(null)}
          onSaved={() => { setAbsenModal(null); onRefresh(); }}
        />
      )}
    </div>
  );
}

// ── Baris Slot ─────────────────────────────────────────────────────
function SlotRow({ slot, sessionName, canEdit, userId, onEdit, onAbsen, onRefresh }) {
  const hadirCount = slot.special_mass_attendance?.filter(a => a.hadir).length || 0;
  const myRecord   = slot.special_mass_attendance?.find(a => a.user_id === userId);
  const past       = isPast(new Date(`${slot.tanggal}T${slot.waktu_selesai || slot.waktu_mulai}`));

  const handleGCal = e => {
    e.stopPropagation();
    exportToGCal(slotToCalEvent(slot, sessionName));
  };

  const handleDeleteSlot = async e => {
    e.stopPropagation();
    if (!confirm(`Hapus slot "${slot.nama_slot}"?`)) return;
    await supabase.from('special_mass_slots').delete().eq('id', slot.id);
    onRefresh();
    toast.success('Slot dihapus');
  };

  return (
    <div className="px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors">
      {/* Urutan badge */}
      <div className="w-6 h-6 rounded-full bg-brand-100 text-brand-800 text-xs font-bold
        flex items-center justify-center shrink-0 mt-0.5">
        {slot.urutan}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-800">{slot.nama_slot}</span>
          {slot.is_wajib && (
            <span className="badge badge-red" style={{fontSize:'10px'}}>WAJIB</span>
          )}
          {past && <span className="badge badge-gray" style={{fontSize:'10px'}}>Selesai</span>}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 flex-wrap">
          <span className="flex items-center gap-1">
            <Clock size={11}/>
            {format(parseISO(slot.tanggal), 'd MMM', { locale: localeId })},
            {' '}{slot.waktu_mulai}
            {slot.waktu_selesai && `–${slot.waktu_selesai}`}
          </span>
          {slot.lokasi && (
            <span className="flex items-center gap-1">
              <MapPin size={11}/> {slot.lokasi}
            </span>
          )}
          {slot.is_wajib && (
            <span className="flex items-center gap-1">
              <Users size={11}/> {hadirCount} hadir
            </span>
          )}
        </div>
        {slot.keterangan && (
          <p className="text-xs text-gray-400 mt-0.5 italic">{slot.keterangan}</p>
        )}
        {myRecord && (
          <span className={`inline-flex items-center gap-1 text-[11px] mt-1 px-1.5 py-0.5 rounded-full font-medium
            ${myRecord.hadir ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {myRecord.hadir ? <Check size={10}/> : <X size={10}/>}
            {myRecord.hadir ? 'Hadir' : 'Tidak hadir'}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={handleGCal} title="Tambah ke Google Calendar"
          className="p-1.5 rounded-lg hover:bg-blue-50 transition-colors">
          <CalendarPlus size={15} className="text-blue-500"/>
        </button>
        {canEdit && (
          <>
            <button onClick={onAbsen} title="Catat Absensi"
              className="p-1.5 rounded-lg hover:bg-green-50 transition-colors">
              <CalendarCheck size={15} className="text-green-600"/>
            </button>
            <button onClick={onEdit} title="Edit Slot"
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
              <Edit3 size={15} className="text-gray-400"/>
            </button>
            <button onClick={handleDeleteSlot} title="Hapus Slot"
              className="p-1.5 rounded-lg hover:bg-red-50 transition-colors">
              <Trash2 size={15} className="text-red-400"/>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Modal Absensi Slot ────────────────────────────────────────────
function AbsenModal({ slot, sessionName, onClose, onSaved }) {
  const [members,  setMembers]  = useState([]);
  const [existing, setExisting] = useState({});
  const [saving,   setSaving]   = useState(false);
  const [changes,  setChanges]  = useState({});

  useEffect(() => {
    (async () => {
      const [{ data: users }, { data: attend }] = await Promise.all([
        supabase.from('users').select('id, nama_panggilan, nickname')
          .eq('status','Active').in('role',['Misdinar_Aktif','Misdinar_Retired'])
          .order('nama_panggilan'),
        supabase.from('special_mass_attendance').select('*').eq('slot_id', slot.id),
      ]);
      setMembers(users || []);
      const map = {};
      (attend || []).forEach(a => { map[a.user_id] = a.hadir; });
      setExisting(map);
    })();
  }, [slot.id]);

  const toggle = uid => setChanges(p => ({ ...p, [uid]: !( uid in p ? p[uid] : (existing[uid] ?? false)) }));

  const handleSave = async () => {
    setSaving(true);
    const rows = members
      .filter(m => m.id in changes)
      .map(m => ({ slot_id: slot.id, user_id: m.id, hadir: changes[m.id] }));
    if (rows.length) {
      await supabase.from('special_mass_attendance').upsert(rows, { onConflict: 'slot_id,user_id' });
    }
    toast.success('Absensi disimpan');
    onSaved();
  };

  const getHadir = uid => (uid in changes ? changes[uid] : (existing[uid] ?? false));
  const hadirCount = members.filter(m => getHadir(m.id)).length;

  return (
    <Modal title={`Absensi: ${slot.nama_slot}`} onClose={onClose}>
      <p className="text-xs text-gray-500 mb-3">
        {sessionName} · {format(parseISO(slot.tanggal),'d MMMM yyyy',{locale:localeId})}
        {', '}{slot.waktu_mulai}
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
                {hadir && <Check size={11} className="text-white"/>}
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
    </Modal>
  );
}

// ── Modal Buat/Edit Sesi ──────────────────────────────────────────
function SessionFormModal({ onClose, onSaved }) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    nama_acara:'', jenis:'Misa Khusus', tanggal:'', deskripsi:'',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.nama_acara || !form.tanggal) { toast.error('Nama acara & tanggal wajib'); return; }
    setSaving(true);
    const { error } = await supabase.from('special_mass_sessions')
      .insert({ ...form, created_by: user.id });
    setSaving(false);
    if (error) { toast.error('Gagal menyimpan'); return; }
    toast.success('Sesi dibuat!');
    onSaved();
  };

  return (
    <Modal title="Buat Sesi Misa Khusus" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label text-xs">Nama Acara *</label>
          <input value={form.nama_acara} onChange={e => setForm({...form, nama_acara: e.target.value})}
            className="input" placeholder="cth: Misa Natal 2025"/>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label text-xs">Jenis</label>
            <select value={form.jenis} onChange={e => setForm({...form, jenis: e.target.value})}
              className="input">
              {JENIS_OPTS.map(j => <option key={j}>{j}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs">Tanggal Puncak *</label>
            <input type="date" value={form.tanggal}
              onChange={e => setForm({...form, tanggal: e.target.value})} className="input"/>
          </div>
        </div>
        <div>
          <label className="label text-xs">Deskripsi</label>
          <textarea value={form.deskripsi} onChange={e => setForm({...form, deskripsi: e.target.value})}
            className="input resize-none" rows={2}/>
        </div>
        <p className="text-xs text-gray-400 flex items-start gap-1">
          <AlertCircle size={12} className="shrink-0 mt-0.5"/>
          Setelah sesi dibuat, tambahkan slot-slot latihan dari dalam kartu sesi.
        </p>
      </div>
      <div className="flex gap-3 mt-4">
        <button onClick={onClose} className="btn-outline flex-1">Batal</button>
        <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
          {saving ? 'Menyimpan…' : 'Buat Sesi'}
        </button>
      </div>
    </Modal>
  );
}

// ── Modal Buat/Edit Slot ──────────────────────────────────────────
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
    const payload = { ...form, session_id: sessionId };
    const { error } = slot
      ? await supabase.from('special_mass_slots').update(payload).eq('id', slot.id)
      : await supabase.from('special_mass_slots').insert(payload);
    setSaving(false);
    if (error) { toast.error('Gagal menyimpan'); return; }
    toast.success(slot ? 'Slot diperbarui' : 'Slot ditambahkan');
    onSaved();
  };

  return (
    <Modal title={`${slot ? 'Edit' : 'Tambah'} Slot — ${sessionName}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label text-xs">Nama Slot</label>
            <input value={form.nama_slot} onChange={e => setForm({...form, nama_slot: e.target.value})}
              className="input" placeholder="cth: Gladi Bersih"/>
          </div>
          <div>
            <label className="label text-xs">Urutan</label>
            <input type="number" min={1} value={form.urutan}
              onChange={e => setForm({...form, urutan: Number(e.target.value)})} className="input"/>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label text-xs">Tanggal *</label>
            <input type="date" value={form.tanggal}
              onChange={e => setForm({...form, tanggal: e.target.value})} className="input"/>
          </div>
          <div>
            <label className="label text-xs">Mulai</label>
            <input type="time" value={form.waktu_mulai}
              onChange={e => setForm({...form, waktu_mulai: e.target.value})} className="input"/>
          </div>
          <div>
            <label className="label text-xs">Selesai</label>
            <input type="time" value={form.waktu_selesai}
              onChange={e => setForm({...form, waktu_selesai: e.target.value})} className="input"/>
          </div>
        </div>
        <div>
          <label className="label text-xs">Lokasi</label>
          <input value={form.lokasi} onChange={e => setForm({...form, lokasi: e.target.value})}
            className="input"/>
        </div>
        <div>
          <label className="label text-xs">Keterangan</label>
          <textarea value={form.keterangan} onChange={e => setForm({...form, keterangan: e.target.value})}
            className="input resize-none" rows={2}/>
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={form.is_wajib}
            onChange={e => setForm({...form, is_wajib: e.target.checked})}
            className="w-4 h-4 accent-brand-800 rounded"/>
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
    </Modal>
  );
}

// ── Modal wrapper ─────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-800">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X size={18} className="text-gray-400"/>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
