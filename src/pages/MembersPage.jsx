import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { truncate, ROLE_LABELS, STATUS_LABELS, formatDate, buildWALink, generateMyID } from '../lib/utils';
import {
  Search, Filter, UserPlus, CheckCircle, XCircle, Eye,
  Phone, School, ChevronDown, Download, RefreshCw, Shield
} from 'lucide-react';
import toast from 'react-hot-toast';

const TABS = [
  { key: 'active',   label: 'Aktif' },
  { key: 'pending',  label: 'Menunggu' },
  { key: 'retired',  label: 'Alumni' },
  { key: 'all',      label: 'Semua' },
];

export default function MembersPage() {
  const { isPengurus, isAdmin } = useAuth();
  const [tab,     setTab]     = useState('active');
  const [members, setMembers] = useState([]);
  const [regs,    setRegs]    = useState([]);   // pending registrations
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState({ pendidikan: '', lingkungan: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    if (tab === 'pending') {
      const { data } = await supabase
        .from('registrations')
        .select('*')
        .eq('status', 'Pending')
        .order('created_at', { ascending: false });
      setRegs(data || []);
    } else {
      let q = supabase.from('users').select('*').order('nama_panggilan');
      if (tab === 'active')  q = q.eq('status', 'Active');
      if (tab === 'retired') q = q.in('status', ['Retired']);
      if (filter.pendidikan) q = q.eq('pendidikan', filter.pendidikan);
      if (filter.lingkungan) q = q.eq('lingkungan', filter.lingkungan);
      const { data } = await q;
      setMembers(data || []);
    }
    setLoading(false);
  }, [tab, filter]);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = members.filter(m =>
    !search || [m.nama_panggilan, m.nickname, m.nama_lengkap, m.lingkungan, m.sekolah]
      .some(v => v?.toLowerCase().includes(search.toLowerCase()))
  );

  async function approveRegistration(reg) {
    try {
      // 1. Generate MyID
      const myid = await generateMyID(reg.nickname, reg.tanggal_lahir);

      // 2. Create Supabase Auth user
      const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        email:    reg.email || `${reg.nickname}@sigma.krsoba.id`,
        password: `sigma${myid.slice(0,6)}`, // temp password
        email_confirm: true,
      });
      if (authErr) throw authErr;

      // 3. Insert into users table
      const { error: dbErr } = await supabase.from('users').insert({
        id:               authData.user.id,
        nickname:         reg.nickname,
        myid,
        nama_lengkap:     reg.nama_lengkap,
        nama_panggilan:   reg.nickname,
        tanggal_lahir:    reg.tanggal_lahir,
        pendidikan:       reg.pendidikan,
        sekolah:          reg.sekolah,
        is_tarakanita:    reg.is_tarakanita,
        wilayah:          reg.wilayah,
        lingkungan:       reg.lingkungan,
        email:            authData.user.email,
        hp_anak:          reg.hp_anak,
        hp_ortu:          reg.hp_ortu,
        nama_ayah:        reg.nama_ayah,
        nama_ibu:         reg.nama_ibu,
        alamat:           reg.alamat,
        alasan_masuk:     reg.alasan_masuk,
        sampai_kapan:     reg.sampai_kapan,
        surat_pernyataan_url: reg.surat_pernyataan_url,
        role:             'Misdinar_Aktif',
        status:           'Active',
      });
      if (dbErr) throw dbErr;

      // 4. Update registration status
      await supabase.from('registrations').update({ status: 'Approved', approved_at: new Date().toISOString() }).eq('id', reg.id);

      toast.success(`${reg.nickname} disetujui! MyID: ${myid}`);
      loadData();
    } catch (err) {
      toast.error('Gagal approve: ' + err.message);
    }
  }

  async function rejectRegistration(reg) {
    if (!confirm(`Tolak pendaftaran ${reg.nickname}?`)) return;
    await supabase.from('registrations').update({ status: 'Rejected' }).eq('id', reg.id);
    toast.success('Pendaftaran ditolak');
    loadData();
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Manajemen Anggota</h1>
          <p className="page-subtitle">{members.length} anggota terdaftar</p>
        </div>
        {isPengurus && (
          <Link to="/anggota/tambah" className="btn-primary">
            <UserPlus size={16} /> Tambah Manual
          </Link>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.key ? 'bg-white text-brand-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {t.key === 'pending' && regs.length > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-[10px] rounded-full px-1.5 py-0.5">{regs.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Pending registrations */}
      {tab === 'pending' && (
        <div className="space-y-3">
          {loading ? (
            <div className="skeleton h-24 rounded-xl" />
          ) : regs.length === 0 ? (
            <div className="card text-center py-10 text-gray-400">Tidak ada pendaftaran baru</div>
          ) : regs.map(reg => (
            <div key={reg.id} className="card border-l-4 border-yellow-400">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-gray-900">{reg.nama_lengkap}</span>
                    <span className="badge-yellow text-xs">Pending</span>
                    {reg.is_tarakanita && <span className="badge-blue text-xs">Tarakanita</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-500">
                    <span>@{reg.nickname}</span>
                    <span>📚 {reg.pendidikan} · {reg.sekolah}</span>
                    <span>⛪ {reg.lingkungan}</span>
                    <span>📅 {formatDate(reg.tanggal_lahir, 'dd MMM yyyy')}</span>
                    <span>📞 {reg.hp_ortu}</span>
                    <span>💬 {reg.alasan_masuk ? truncate(reg.alasan_masuk, 40) : '—'}</span>
                  </div>
                </div>
                {isPengurus && (
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => approveRegistration(reg)}
                      className="btn-primary btn-sm flex items-center gap-1"
                    ><CheckCircle size={14} /> Setuju</button>
                    <button
                      onClick={() => rejectRegistration(reg)}
                      className="btn-danger btn-sm flex items-center gap-1"
                    ><XCircle size={14} /> Tolak</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Active / all members */}
      {tab !== 'pending' && (
        <>
          {/* Search & filter */}
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-9"
                placeholder="Cari nama, nickname, lingkungan..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <select className="input w-auto" value={filter.pendidikan} onChange={e => setFilter(f => ({...f, pendidikan: e.target.value}))}>
              <option value="">Semua Pendidikan</option>
              {['SD','SMP','SMA','SMK','Lulus'].map(p => <option key={p}>{p}</option>)}
            </select>
          </div>

          {/* Table */}
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Nama Panggilan</th>
                    <th>Nama Lengkap</th>
                    <th>Pendidikan</th>
                    <th>Lingkungan</th>
                    <th>Status</th>
                    <th>Role</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="text-center py-8 text-gray-400">Memuat...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-gray-400">Tidak ada data</td></tr>
                  ) : filtered.map(m => (
                    <tr key={m.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 bg-brand-100 rounded-full flex items-center justify-center text-brand-800 font-bold text-xs flex-shrink-0">
                            {m.nama_panggilan?.[0]?.toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">{m.nama_panggilan}</div>
                            <div className="text-xs text-gray-400">@{m.nickname}</div>
                          </div>
                          {m.is_tarakanita && <span className="badge-blue">T</span>}
                        </div>
                      </td>
                      <td className="text-gray-600">{truncate(m.nama_lengkap, 25)}</td>
                      <td><span className="badge-gray">{m.pendidikan || '—'}</span></td>
                      <td className="text-gray-600">{m.lingkungan}</td>
                      <td>
                        <span className={`badge ${
                          m.status === 'Active' ? 'badge-green' :
                          m.status === 'Pending' ? 'badge-yellow' :
                          m.is_suspended ? 'badge-red' : 'badge-gray'
                        }`}>
                          {m.is_suspended ? 'Suspended' : STATUS_LABELS[m.status] || m.status}
                        </span>
                      </td>
                      <td className="text-xs text-gray-500">{ROLE_LABELS[m.role] || m.role}</td>
                      <td>
                        <Link to={`/anggota/${m.id}`} className="btn-ghost btn-sm">
                          <Eye size={14} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
