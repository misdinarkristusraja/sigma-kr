import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, buildWALink, formatHP } from '../lib/utils';
import { ArrowLeftRight, MessageCircle, Clock, CheckCircle, XCircle, Plus, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

const STATUS_CONFIG = {
  Pending:       { label: 'Menunggu PIC',   color: 'badge-yellow' },
  Approved_PIC:  { label: 'Disetujui PIC',  color: 'badge-blue' },
  Rejected_PIC:  { label: 'Ditolak PIC',    color: 'badge-red' },
  Replaced:      { label: 'Tergantikan',    color: 'badge-green' },
  Offered:       { label: 'Di Papan Penawaran', color: 'badge-purple' },
  Expired:       { label: 'Kadaluarsa',     color: 'badge-gray' },
};

export default function SwapPage() {
  const { profile, isPengurus }  = useAuth();
  const [myRequests, setMyReqs]  = useState([]);
  const [board, setBoard]        = useState([]);
  const [mySchedule, setMySched] = useState([]);
  const [showForm, setShowForm]  = useState(false);
  const [formData, setForm]      = useState({ assignment_id: '', alasan: '' });
  const [loading, setLoading]    = useState(true);
  const [tab, setTab]            = useState('my');

  useEffect(() => { loadData(); }, [profile]);

  async function loadData() {
    if (!profile) return;
    setLoading(true);
    await Promise.all([loadMyRequests(), loadBoard(), loadMySchedule()]);
    setLoading(false);
  }

  async function loadMyRequests() {
    const { data } = await supabase
      .from('swap_requests')
      .select(`*, assignment:assignment_id(slot_number, events(nama_event, tanggal_tugas, perayaan)), pic:pic_user_id(nama_panggilan, hp_anak, hp_ortu)`)
      .eq('requester_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setMyReqs(data || []);
  }

  async function loadBoard() {
    const { data } = await supabase
      .from('swap_requests')
      .select(`*, requester:requester_id(nama_panggilan, lingkungan), assignment:assignment_id(slot_number, events(nama_event, tanggal_tugas, perayaan))`)
      .eq('is_penawaran', true)
      .eq('status', 'Offered')
      .neq('requester_id', profile?.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setBoard(data || []);
  }

  async function loadMySchedule() {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('assignments')
      .select(`id, slot_number, events(id, nama_event, tanggal_tugas, perayaan, pic_slot_1a, pic_slot_1b, pic_slot_2a, pic_slot_2b, pic_slot_3a, pic_slot_3b, pic_slot_4a, pic_slot_4b)`)
      .eq('user_id', profile.id)
      .gte('events.tanggal_tugas', today)
      .order('events.tanggal_tugas')
      .limit(10);
    setMySched(data?.filter(d => d.events) || []);
  }

  async function submitRequest() {
    if (!formData.assignment_id || !formData.alasan) {
      toast.error('Pilih jadwal dan isi alasan'); return;
    }
    const asgn = mySchedule.find(s => s.id === formData.assignment_id);
    if (!asgn) return;

    // Get PIC for that slot
    const ev   = asgn.events;
    const slot = asgn.slot_number;
    const picAKey = `pic_slot_${slot}a`;
    const picNick = ev[picAKey];

    let picUserId = null, picWaLink = '';
    if (picNick) {
      const { data: picUser } = await supabase.from('users').select('id, hp_ortu, hp_anak').eq('nickname', picNick).maybeSingle();
      if (picUser) {
        picUserId = picUser.id;
        const hp = picUser.hp_anak || picUser.hp_ortu;
        picWaLink = buildWALink(hp, `Halo, saya ${profile.nama_panggilan} ingin tukar jadwal pada ${ev.perayaan || ev.nama_event} (${formatDate(ev.tanggal_tugas, 'dd MMM')}) Slot ${slot}. Alasan: ${formData.alasan}. Mohon konfirmasi ya.`);
      }
    }

    const { data, error } = await supabase.from('swap_requests').insert({
      requester_id:  profile.id,
      assignment_id: formData.assignment_id,
      alasan:        formData.alasan,
      pic_user_id:   picUserId,
      pic_wa_link:   picWaLink,
      status:        'Pending',
      expires_at:    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }).select().single();

    if (error) { toast.error('Gagal submit: ' + error.message); return; }

    toast.success('Request tukar jadwal terkirim!');
    setShowForm(false);
    setForm({ assignment_id: '', alasan: '' });
    loadData();

    // Open WA link if available
    if (picWaLink) {
      setTimeout(() => {
        if (confirm('Buka WhatsApp untuk menghubungi PIC?')) window.open(picWaLink, '_blank');
      }, 500);
    }
  }

  async function approvePIC(reqId) {
    await supabase.from('swap_requests').update({ status: 'Approved_PIC', pic_approved_at: new Date().toISOString() }).eq('id', reqId);
    toast.success('Request disetujui');
    loadData();
  }

  async function offerToBoard(reqId) {
    await supabase.from('swap_requests').update({ status: 'Offered', is_penawaran: true }).eq('id', reqId);
    toast.success('Slot ditawarkan ke papan penawaran');
    loadData();
  }

  async function claimFromBoard(req) {
    // Check if already confirmed by member
    const confirmed = confirm(`Apakah kamu sudah konfirmasi langsung dengan ${req.requester?.nama_panggilan} bahwa kamu bersedia menggantikan?`);
    if (!confirmed) return;

    const { error } = await supabase.from('swap_requests').update({
      status: 'Replaced',
      pengganti_id: profile.id,
    }).eq('id', req.id);

    if (error) { toast.error('Gagal: ' + error.message); return; }

    // Update assignment
    await supabase.from('assignments').update({ user_id: profile.id }).eq('id', req.assignment_id);
    toast.success('Berhasil ambil tugas!');
    loadData();
  }

  const SLOT_LABELS = { 1:'Sabtu 17:30', 2:'Minggu 06:00', 3:'Minggu 08:00', 4:'Minggu 17:30' };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Tukar Jadwal</h1>
          <p className="page-subtitle">Request penukaran · Papan Penawaran</p>
        </div>
        {mySchedule.length > 0 && (
          <button onClick={() => setShowForm(true)} className="btn-primary gap-2">
            <Plus size={16} /> Request Tukar
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {[{key:'my',label:'Request Saya'},{key:'board',label:`Papan Penawaran${board.length>0?` (${board.length})`:''}`}].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab===t.key?'bg-white text-brand-800 shadow-sm':'text-gray-500'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* My requests */}
      {tab === 'my' && (
        <div className="space-y-3">
          {loading ? <div className="skeleton h-24 rounded-xl" /> :
           myRequests.length === 0 ? (
            <div className="card text-center py-10 text-gray-400">
              <ArrowLeftRight size={40} className="mx-auto mb-2 opacity-30" />
              <p>Belum ada request tukar jadwal</p>
            </div>
          ) : myRequests.map(req => {
            const sc = STATUS_CONFIG[req.status] || {};
            const ev = req.assignment?.events;
            const waLink = req.pic_wa_link;
            return (
              <div key={req.id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`badge ${sc.color}`}>{sc.label}</span>
                      {req.status === 'Pending' && (
                        <span className="flex items-center gap-1 text-xs text-orange-500">
                          <Clock size={12} />
                          Expires {formatDate(req.expires_at, 'dd MMM HH:mm')}
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-gray-900">{ev?.perayaan || ev?.nama_event || '—'}</p>
                    <p className="text-sm text-gray-500">{formatDate(ev?.tanggal_tugas, 'EEEE, dd MMM yyyy')} · {SLOT_LABELS[req.assignment?.slot_number]}</p>
                    <p className="text-xs text-gray-400 mt-1 italic">"{req.alasan}"</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {req.status === 'Pending' && waLink && (
                      <a href={waLink} target="_blank" rel="noopener noreferrer"
                        className="btn-primary btn-sm gap-1">
                        <MessageCircle size={13} /> WA PIC
                      </a>
                    )}
                    {req.status === 'Approved_PIC' && (
                      <button onClick={() => offerToBoard(req.id)} className="btn-outline btn-sm gap-1">
                        <AlertTriangle size={13} /> Tawarkan ke Papan
                      </button>
                    )}
                    {isPengurus && req.status === 'Pending' && (
                      <button onClick={() => approvePIC(req.id)} className="btn-secondary btn-sm gap-1">
                        <CheckCircle size={13} /> Approve
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Board */}
      {tab === 'board' && (
        <div className="space-y-3">
          {loading ? <div className="skeleton h-24 rounded-xl" /> :
           board.length === 0 ? (
            <div className="card text-center py-10 text-gray-400">
              <CheckCircle size={40} className="mx-auto mb-2 opacity-30" />
              <p>Tidak ada penawaran saat ini</p>
            </div>
          ) : board.map(req => {
            const ev = req.assignment?.events;
            return (
              <div key={req.id} className="card border-l-4 border-purple-400">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="badge-purple">Penawaran</span>
                    </div>
                    <p className="font-semibold text-gray-900">{ev?.perayaan || ev?.nama_event}</p>
                    <p className="text-sm text-gray-500">{formatDate(ev?.tanggal_tugas, 'EEEE, dd MMM yyyy')} · {SLOT_LABELS[req.assignment?.slot_number]}</p>
                    <p className="text-xs text-gray-400 mt-1">Dari: <strong>{req.requester?.nama_panggilan}</strong> ({req.requester?.lingkungan})</p>
                  </div>
                  <button onClick={() => claimFromBoard(req)} className="btn-primary btn-sm gap-1 flex-shrink-0">
                    <CheckCircle size={13} /> Saya Bersedia
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Request form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h3 className="font-bold text-lg mb-4">Request Tukar Jadwal</h3>

            <div className="space-y-4">
              <div>
                <label className="label">Pilih Jadwal yang Ingin Ditukar *</label>
                <select className="input" value={formData.assignment_id}
                  onChange={e => setForm(f => ({...f, assignment_id: e.target.value}))}>
                  <option value="">— Pilih jadwal —</option>
                  {mySchedule.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.events?.perayaan || s.events?.nama_event} · {SLOT_LABELS[s.slot_number]} · {formatDate(s.events?.tanggal_tugas, 'dd MMM')}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Alasan *</label>
                <textarea className="input h-24 resize-none" value={formData.alasan}
                  onChange={e => setForm(f => ({...f, alasan: e.target.value}))}
                  placeholder="Contoh: ada acara keluarga, sakit, dll." />
              </div>
            </div>

            <div className="bg-blue-50 rounded-xl p-3 mt-4">
              <p className="text-xs text-blue-700">
                <strong>Alur:</strong> Submit → Tombol WA PIC muncul → Hubungi PIC via WhatsApp → PIC approve → Cari pengganti atau tawarkan ke Papan.
              </p>
            </div>

            <div className="flex gap-2 mt-4">
              <button onClick={submitRequest} className="btn-primary flex-1">Submit Request</button>
              <button onClick={() => setShowForm(false)} className="btn-secondary">Batal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
