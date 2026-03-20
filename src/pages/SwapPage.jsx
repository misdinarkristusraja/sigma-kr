import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, buildWALink } from '../lib/utils';
import {
  ArrowLeftRight, MessageCircle, Clock, CheckCircle, XCircle,
  Plus, AlertTriangle, Send, Copy, RefreshCw, Shield, Globe,
} from 'lucide-react';
import toast from 'react-hot-toast';

const STATUS_CONFIG = {
  Pending:      { label: 'Menunggu PIC',        color: 'badge-yellow' },
  Approved_PIC: { label: 'Disetujui PIC',        color: 'badge-blue'   },
  Rejected_PIC: { label: 'Ditolak PIC',          color: 'badge-red'    },
  Replaced:     { label: 'Tergantikan',           color: 'badge-green'  },
  Offered:      { label: 'Di Papan Penawaran',    color: 'badge-purple' },
  Expired:      { label: 'Kadaluarsa',            color: 'badge-gray'   },
};

const SLOT_LABELS = { 1:'Sabtu 17:30', 2:'Minggu 06:00', 3:'Minggu 08:00', 4:'Minggu 17:30' };

export default function SwapPage() {
  const { profile, isPengurus } = useAuth();

  const [tab,       setTab]      = useState('my');
  const [myReqs,    setMyReqs]   = useState([]);
  const [board,     setBoard]    = useState([]);
  const [allReqs,   setAllReqs]  = useState([]);  // untuk admin
  const [mySched,   setMySched]  = useState([]);
  const [loading,   setLoading]  = useState(true);

  // Form: request sendiri
  const [showForm,  setShowForm] = useState(false);
  const [formData,  setForm]     = useState({ assignment_id: '', alasan: '' });

  // Form: admin add request untuk orang lain
  const [showAdminForm,  setShowAdminForm]  = useState(false);
  const [adminForm,      setAdminForm]      = useState({
    requester_id: '', assignment_id: '', alasan: '', pengganti_id: '', status: 'Replaced',
  });
  const [allMembers,     setAllMembers]     = useState([]);
  const [allAssignments, setAllAssignments] = useState([]);

  // WA template grup
  const [showWA,  setShowWA]  = useState(false);
  const [waText,  setWaText]  = useState('');
  const [grupWA,  setGrupWA]  = useState('');  // link grup WA

  const loadData = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    await Promise.all([
      loadMyRequests(),
      loadBoard(),
      loadMySchedule(),
      isPengurus && loadAllRequests(),
    ].filter(Boolean));
    setLoading(false);
  }, [profile, isPengurus]);

  useEffect(() => { loadData(); }, [loadData]);

  // Load daftar anggota & assignment untuk admin form
  useEffect(() => {
    if (!isPengurus) return;
    const today = new Date().toISOString().split('T')[0];
    supabase.from('users').select('id, nickname, nama_panggilan, lingkungan')
      .eq('status','Active').order('nama_panggilan')
      .then(({ data }) => setAllMembers(data||[]));
    supabase.from('assignments')
      .select('id, slot_number, user_id, users(nama_panggilan), events(id, nama_event, perayaan, tanggal_tugas)')
      .gte('events.tanggal_tugas', today)
      .order('events.tanggal_tugas')
      .limit(100)
      .then(({ data }) => setAllAssignments((data||[]).filter(a => a.events)));
  }, [isPengurus]);

  async function loadMyRequests() {
    const { data } = await supabase
      .from('swap_requests')
      .select(`*,
        assignment:assignment_id(slot_number, events(nama_event, tanggal_tugas, perayaan)),
        pic:pic_user_id(nama_panggilan, hp_anak, hp_ortu),
        pengganti:pengganti_id(nama_panggilan)`)
      .eq('requester_id', profile.id)
      .order('created_at', { ascending: false }).limit(30);
    setMyReqs(data||[]);
  }

  async function loadBoard() {
    const { data } = await supabase
      .from('swap_requests')
      .select(`*,
        requester:requester_id(nama_panggilan, lingkungan),
        assignment:assignment_id(slot_number, events(nama_event, tanggal_tugas, perayaan))`)
      .eq('is_penawaran', true).eq('status','Offered')
      .neq('requester_id', profile?.id)
      .order('created_at', { ascending: false }).limit(20);
    setBoard(data||[]);
  }

  async function loadMySchedule() {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('assignments')
      .select(`id, slot_number,
        events(id, nama_event, tanggal_tugas, perayaan,
          pic_slot_1a, pic_hp_slot_1a, pic_slot_1b, pic_hp_slot_1b,
          pic_slot_2a, pic_hp_slot_2a, pic_slot_2b, pic_hp_slot_2b,
          pic_slot_3a, pic_hp_slot_3a, pic_slot_3b, pic_hp_slot_3b,
          pic_slot_4a, pic_hp_slot_4a, pic_slot_4b, pic_hp_slot_4b)`)
      .eq('user_id', profile.id)
      .gte('events.tanggal_tugas', today)
      .order('events.tanggal_tugas').limit(10);
    setMySched((data||[]).filter(d => d.events));
  }

  async function loadAllRequests() {
    const { data } = await supabase
      .from('swap_requests')
      .select(`*,
        requester:requester_id(nama_panggilan, lingkungan, nickname),
        pengganti:pengganti_id(nama_panggilan),
        assignment:assignment_id(slot_number, events(nama_event, tanggal_tugas, perayaan)),
        pic:pic_user_id(nama_panggilan)`)
      .order('created_at', { ascending: false }).limit(100);
    setAllReqs(data||[]);
  }

  // ── Submit request sendiri ─────────────────────────────────
  async function submitRequest() {
    if (!formData.assignment_id || !formData.alasan) {
      toast.error('Pilih jadwal dan isi alasan'); return;
    }
    const asgn = mySched.find(s => s.id === formData.assignment_id);
    if (!asgn) return;

    const ev    = asgn.events;
    const slot  = asgn.slot_number;
    const picNick = ev[`pic_slot_${slot}a`];
    let picUserId = null, picWaLink = '';

    if (picNick) {
      const { data: picUser } = await supabase.from('users')
        .select('id, hp_anak, hp_ortu').eq('nickname', picNick).maybeSingle();
      if (picUser) {
        picUserId = picUser.id;
        const hp  = picUser.hp_anak || picUser.hp_ortu || '';
        picWaLink = buildWALink(hp,
          `Halo ${picNick}, saya ${profile.nama_panggilan} ingin tukar jadwal ` +
          `${ev.perayaan||ev.nama_event} (${formatDate(ev.tanggal_tugas,'dd MMM')}) ` +
          `Slot ${slot}. Alasan: ${formData.alasan}. Mohon konfirmasi ya 🙏`
        );
      }
    }

    const { error } = await supabase.from('swap_requests').insert({
      requester_id:  profile.id,
      assignment_id: formData.assignment_id,
      alasan:        formData.alasan,
      pic_user_id:   picUserId,
      pic_wa_link:   picWaLink,
      status:        'Pending',
      expires_at:    new Date(Date.now() + 24*60*60*1000).toISOString(),
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Request terkirim!');
    setShowForm(false);
    setForm({ assignment_id: '', alasan: '' });
    loadData();
    if (picWaLink) setTimeout(() => {
      if (confirm('Buka WhatsApp untuk hubungi PIC?')) window.open(picWaLink,'_blank');
    }, 400);
  }

  // ── Admin: add swap manual ─────────────────────────────────
  async function submitAdminSwap() {
    const f = adminForm;
    if (!f.requester_id || !f.assignment_id) {
      toast.error('Pilih anggota dan jadwal'); return;
    }

    const asgn = allAssignments.find(a => a.id === f.assignment_id);
    const pengganti = f.pengganti_id ? allMembers.find(m => m.id === f.pengganti_id) : null;

    const { error } = await supabase.from('swap_requests').insert({
      requester_id:  f.requester_id,
      assignment_id: f.assignment_id,
      alasan:        f.alasan || 'Dicatat oleh penjadwalan',
      pic_user_id:   null,
      pic_wa_link:   '',
      status:        f.status,
      pengganti_id:  f.pengganti_id || null,
      pic_approved_at: f.status === 'Replaced' ? new Date().toISOString() : null,
      expires_at:    new Date(Date.now() + 24*60*60*1000).toISOString(),
    });

    if (error) { toast.error(error.message); return; }

    // Jika langsung Replaced: update assignment ke pengganti
    if (f.status === 'Replaced' && f.pengganti_id) {
      await supabase.from('assignments')
        .update({ user_id: f.pengganti_id })
        .eq('id', f.assignment_id);
    }

    toast.success('Tukar jadwal berhasil dicatat!');
    setShowAdminForm(false);
    setAdminForm({ requester_id:'', assignment_id:'', alasan:'', pengganti_id:'', status:'Replaced' });
    loadData();
  }

  // ── Approve / Reject (pengurus) ────────────────────────────
  async function approveRequest(req) {
    await supabase.from('swap_requests').update({
      status: 'Approved_PIC', pic_approved_at: new Date().toISOString(),
    }).eq('id', req.id);
    toast.success('Request disetujui');
    loadData();
  }

  async function rejectRequest(req) {
    await supabase.from('swap_requests').update({ status: 'Rejected_PIC' }).eq('id', req.id);
    toast.success('Request ditolak');
    loadData();
  }

  async function offerToBoard(req) {
    await supabase.from('swap_requests').update({ status:'Offered', is_penawaran:true }).eq('id', req.id);
    toast.success('Ditawarkan ke papan');
    loadData();
  }

  async function claimFromBoard(req) {
    if (!confirm(`Konfirmasi: kamu sudah deal dengan ${req.requester?.nama_panggilan}?`)) return;
    await supabase.from('swap_requests').update({ status:'Replaced', pengganti_id:profile.id }).eq('id', req.id);
    await supabase.from('assignments').update({ user_id: profile.id }).eq('id', req.assignment_id);
    toast.success('Berhasil ambil tugas!');
    loadData();
  }

  // ── WA Template untuk grup ─────────────────────────────────
  function buildWATemplate(reqs) {
    if (!reqs.length) return '';
    const lines = ['📋 *REKAP TUKAR JADWAL*', `${formatDate(new Date().toISOString(),'dd MMMM yyyy')}`, ''];
    reqs.filter(r => r.status !== 'Expired').forEach(r => {
      const ev    = r.assignment?.events;
      const slot  = r.assignment?.slot_number;
      const sc    = STATUS_CONFIG[r.status];
      lines.push(`• ${r.requester?.nama_panggilan} — ${ev?.perayaan||ev?.nama_event||'?'} (${SLOT_LABELS[slot]||'?'})`);
      lines.push(`  Status: ${sc?.label||r.status}${r.pengganti?.nama_panggilan ? ` → ${r.pengganti.nama_panggilan}` : ''}`);
      lines.push(`  Alasan: ${r.alasan}`);
      lines.push('');
    });
    const offered = reqs.filter(r => r.status === 'Offered');
    if (offered.length) {
      lines.push('🙋 *PENAWARAN TUGAS (siapa bisa?)*');
      offered.forEach(r => {
        const ev   = r.assignment?.events;
        const slot = r.assignment?.slot_number;
        lines.push(`• ${ev?.perayaan||ev?.nama_event} — ${SLOT_LABELS[slot]||'?'} (${formatDate(ev?.tanggal_tugas,'dd MMM')})`);
      });
    }
    return lines.join('\n');
  }

  const tabs = [
    { key: 'my',    label: 'Request Saya' },
    { key: 'board', label: `Papan Penawaran${board.length ? ` (${board.length})` : ''}` },
    ...(isPengurus ? [{ key: 'all', label: `Semua Request${allReqs.length ? ` (${allReqs.length})` : ''}` }] : []),
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Tukar Jadwal</h1>
          <p className="page-subtitle">Request · Papan Penawaran · Rekap</p>
        </div>
        <div className="flex gap-2">
          {mySched.length > 0 && (
            <button onClick={() => setShowForm(true)} className="btn-primary gap-2">
              <Plus size={16}/> Request Tukar
            </button>
          )}
          {isPengurus && (
            <>
              <button onClick={() => setShowAdminForm(true)} className="btn-outline gap-2">
                <Shield size={16}/> Catat Manual
              </button>
              <button onClick={() => {
                setWaText(buildWATemplate(allReqs));
                setShowWA(true);
              }} className="btn-outline gap-2">
                <Send size={16}/> WA Rekap
              </button>
            </>
          )}
          <button onClick={loadData} className="btn-ghost p-2"><RefreshCw size={16}/></button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab===t.key?'bg-white text-brand-800 shadow-sm':'text-gray-500'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB MY REQUESTS ── */}
      {tab === 'my' && (
        <div className="space-y-3">
          {loading ? <div className="skeleton h-24 rounded-xl"/> :
           myReqs.length === 0 ? (
            <div className="card text-center py-10 text-gray-400">
              <ArrowLeftRight size={40} className="mx-auto mb-2 opacity-30"/>
              <p>Belum ada request tukar jadwal</p>
            </div>
          ) : myReqs.map(req => {
            const sc = STATUS_CONFIG[req.status] || {};
            const ev = req.assignment?.events;
            return (
              <div key={req.id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`badge ${sc.color}`}>{sc.label}</span>
                      {req.status === 'Pending' && (
                        <span className="text-xs text-orange-500 flex items-center gap-1">
                          <Clock size={11}/> Exp: {formatDate(req.expires_at,'dd MMM HH:mm')}
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-gray-900 truncate">{ev?.perayaan||ev?.nama_event||'—'}</p>
                    <p className="text-sm text-gray-500">{formatDate(ev?.tanggal_tugas,'dd MMM yyyy')} · {SLOT_LABELS[req.assignment?.slot_number]}</p>
                    <p className="text-xs text-gray-400 italic mt-1">"{req.alasan}"</p>
                    {req.pengganti?.nama_panggilan && (
                      <p className="text-xs text-green-600 mt-1">✅ Digantikan: {req.pengganti.nama_panggilan}</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    {req.status === 'Pending' && req.pic_wa_link && (
                      <a href={req.pic_wa_link} target="_blank" rel="noopener noreferrer"
                        className="btn-primary btn-sm gap-1">
                        <MessageCircle size={13}/> WA PIC
                      </a>
                    )}
                    {req.status === 'Approved_PIC' && (
                      <button onClick={() => offerToBoard(req)} className="btn-outline btn-sm gap-1">
                        <Globe size={13}/> Tawarkan
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── TAB BOARD ── */}
      {tab === 'board' && (
        <div className="space-y-3">
          {board.length === 0 ? (
            <div className="card text-center py-10 text-gray-400">
              <CheckCircle size={40} className="mx-auto mb-2 opacity-30"/>
              <p>Tidak ada penawaran saat ini</p>
            </div>
          ) : board.map(req => {
            const ev = req.assignment?.events;
            return (
              <div key={req.id} className="card border-l-4 border-purple-400">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-900">{ev?.perayaan||ev?.nama_event}</p>
                    <p className="text-sm text-gray-500">{formatDate(ev?.tanggal_tugas,'EEEE, dd MMM yyyy')} · {SLOT_LABELS[req.assignment?.slot_number]}</p>
                    <p className="text-xs text-gray-400 mt-1">Dari: <strong>{req.requester?.nama_panggilan}</strong> ({req.requester?.lingkungan})</p>
                    <p className="text-xs text-gray-400 italic">"{req.alasan}"</p>
                  </div>
                  <button onClick={() => claimFromBoard(req)} className="btn-primary btn-sm gap-1 flex-shrink-0">
                    <CheckCircle size={13}/> Saya Bersedia
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── TAB ALL (PENGURUS) ── */}
      {tab === 'all' && isPengurus && (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto max-h-[65vh]">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Anggota</th><th>Jadwal</th><th>Slot</th>
                  <th>Alasan</th><th>Status</th><th>Pengganti</th><th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-400">Memuat...</td></tr>
                ) : allReqs.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-400">Belum ada data</td></tr>
                ) : allReqs.map(req => {
                  const sc = STATUS_CONFIG[req.status] || {};
                  const ev = req.assignment?.events;
                  return (
                    <tr key={req.id}>
                      <td>
                        <div className="font-semibold text-sm">{req.requester?.nama_panggilan}</div>
                        <div className="text-xs text-gray-400">{req.requester?.lingkungan}</div>
                      </td>
                      <td className="text-xs">{ev?.perayaan||ev?.nama_event}<br/>{formatDate(ev?.tanggal_tugas,'dd MMM')}</td>
                      <td className="text-xs">{SLOT_LABELS[req.assignment?.slot_number]||'—'}</td>
                      <td className="text-xs text-gray-500 max-w-32 truncate">{req.alasan}</td>
                      <td><span className={`badge ${sc.color} text-xs`}>{sc.label}</span></td>
                      <td className="text-xs">{req.pengganti?.nama_panggilan||'—'}</td>
                      <td>
                        {req.status === 'Pending' && (
                          <div className="flex gap-1">
                            <button onClick={() => approveRequest(req)} className="btn-primary btn-sm text-xs">✓ Approve</button>
                            <button onClick={() => rejectRequest(req)} className="btn-danger btn-sm text-xs">✗ Tolak</button>
                          </div>
                        )}
                        {req.status === 'Approved_PIC' && (
                          <button onClick={() => offerToBoard(req)} className="btn-outline btn-sm text-xs">Tawarkan</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── FORM: Request sendiri ── */}
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
                  {mySched.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.events?.perayaan||s.events?.nama_event} · {SLOT_LABELS[s.slot_number]} · {formatDate(s.events?.tanggal_tugas,'dd MMM')}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Alasan *</label>
                <textarea className="input h-24 resize-none" value={formData.alasan}
                  onChange={e => setForm(f => ({...f, alasan: e.target.value}))}
                  placeholder="Contoh: ada acara keluarga, sakit, dll."/>
              </div>
            </div>
            <div className="bg-blue-50 rounded-xl p-3 mt-4 text-xs text-blue-700">
              Setelah submit → tombol WA PIC muncul → hubungi PIC → setelah deal, tawarkan ke papan jika belum ada pengganti.
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={submitRequest} className="btn-primary flex-1">Submit</button>
              <button onClick={() => setShowForm(false)} className="btn-secondary">Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* ── FORM: Admin catat manual ── */}
      {showAdminForm && isPengurus && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
              <Shield size={18} className="text-brand-800"/> Catat Tukar Jadwal Manual
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Anggota yang Minta Tukar *</label>
                  <select className="input" value={adminForm.requester_id}
                    onChange={e => setAdminForm(f=>({...f, requester_id:e.target.value, assignment_id:''}))}>
                    <option value="">— Pilih anggota —</option>
                    {allMembers.map(m => <option key={m.id} value={m.id}>{m.nama_panggilan} (@{m.nickname})</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Status Akhir *</label>
                  <select className="input" value={adminForm.status}
                    onChange={e => setAdminForm(f=>({...f, status:e.target.value}))}>
                    <option value="Replaced">Tergantikan (sudah ada pengganti)</option>
                    <option value="Offered">Ditawarkan ke papan</option>
                    <option value="Approved_PIC">Disetujui PIC, cari pengganti</option>
                    <option value="Pending">Pending (menunggu PIC)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Jadwal yang Ditukar *</label>
                <select className="input" value={adminForm.assignment_id}
                  onChange={e => setAdminForm(f=>({...f, assignment_id:e.target.value}))}>
                  <option value="">— Pilih jadwal —</option>
                  {allAssignments
                    .filter(a => !adminForm.requester_id || a.user_id === adminForm.requester_id)
                    .map(a => (
                      <option key={a.id} value={a.id}>
                        {a.events?.perayaan||a.events?.nama_event} · {SLOT_LABELS[a.slot_number]} · {formatDate(a.events?.tanggal_tugas,'dd MMM')} — ({a.users?.nama_panggilan})
                      </option>
                    ))
                  }
                </select>
                {adminForm.requester_id && allAssignments.filter(a => a.user_id === adminForm.requester_id).length === 0 && (
                  <p className="text-xs text-orange-500 mt-1">Anggota ini tidak punya jadwal mendatang</p>
                )}
              </div>

              {adminForm.status === 'Replaced' && (
                <div>
                  <label className="label">Pengganti</label>
                  <select className="input" value={adminForm.pengganti_id}
                    onChange={e => setAdminForm(f=>({...f, pengganti_id:e.target.value}))}>
                    <option value="">— Pilih pengganti —</option>
                    {allMembers.filter(m => m.id !== adminForm.requester_id).map(m => (
                      <option key={m.id} value={m.id}>{m.nama_panggilan} (@{m.nickname})</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="label">Alasan / Keterangan</label>
                <textarea className="input h-20 resize-none" value={adminForm.alasan}
                  onChange={e => setAdminForm(f=>({...f, alasan:e.target.value}))}
                  placeholder="Contoh: Koordinasi via WA sudah deal"/>
              </div>
            </div>

            {adminForm.status === 'Replaced' && adminForm.requester_id && adminForm.pengganti_id && adminForm.assignment_id && (() => {
              const req = allMembers.find(m => m.id === adminForm.requester_id);
              const peng = allMembers.find(m => m.id === adminForm.pengganti_id);
              const asgn = allAssignments.find(a => a.id === adminForm.assignment_id);
              return (
                <div className="mt-4 p-3 bg-green-50 rounded-xl text-xs text-green-700">
                  Preview: <strong>{req?.nama_panggilan}</strong> tukar dengan <strong>{peng?.nama_panggilan}</strong>
                  {' '}untuk {asgn?.events?.perayaan||asgn?.events?.nama_event} ({SLOT_LABELS[asgn?.slot_number]})
                </div>
              );
            })()}

            <div className="flex gap-2 mt-5">
              <button onClick={submitAdminSwap} className="btn-primary flex-1 gap-2">
                <Shield size={16}/> Simpan
              </button>
              <button onClick={() => setShowAdminForm(false)} className="btn-secondary">Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* ── WA Template Grup ── */}
      {showWA && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">Template WA Rekap Tukar Jadwal</h3>
              <button onClick={() => setShowWA(false)}><XCircle size={20}/></button>
            </div>
            <textarea
              className="w-full h-80 font-mono text-xs p-3 border border-gray-200 rounded-xl bg-gray-50 resize-none"
              value={waText}
              onChange={e => setWaText(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">Teks bisa diedit sebelum dikirim</p>
            {/* Grup WA link */}
            <div className="mt-3 space-y-2">
              <label className="text-xs font-semibold text-gray-600">
                Link Grup WhatsApp (opsional)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="input text-sm flex-1"
                  placeholder="https://chat.whatsapp.com/XXXXX..."
                  value={grupWA}
                  onChange={e => setGrupWA(e.target.value)}
                />
                <button
                  onClick={() => {
                    if (!grupWA) { toast.error('Masukkan link grup WA dulu'); return; }
                    const link = grupWA.startsWith('http') ? grupWA : `https://chat.whatsapp.com/${grupWA}`;
                    window.open(`${link}`, '_blank');
                    setTimeout(() => {
                      navigator.clipboard.writeText(waText);
                      toast.success('Link dibuka & teks disalin ke clipboard!');
                    }, 500);
                  }}
                  className="btn-primary gap-2 whitespace-nowrap transition-all hover:scale-105 active:scale-95">
                  <MessageSquare size={14}/> Kirim ke Grup
                </button>
              </div>
              <p className="text-[10px] text-gray-400">
                💡 Klik "Kirim ke Grup" → grup terbuka di WhatsApp + teks otomatis disalin.
                Paste (tempel) teks di grup WhatsApp. Link grup bisa didapat dari WhatsApp: 
                Grup → Info Grup → Tautan Undangan.
              </p>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => { navigator.clipboard.writeText(waText); toast.success('Disalin!'); }}
                className="btn-outline flex-1 gap-2"><Copy size={15}/> Salin Teks</button>
              <button onClick={() => setShowWA(false)} className="btn-secondary">Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  </div>
  );
}
