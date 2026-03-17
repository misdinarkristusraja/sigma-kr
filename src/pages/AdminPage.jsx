import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Settings, Save, RefreshCw, Shield, Users, Database, Bell } from 'lucide-react';
import toast from 'react-hot-toast';

const CONFIG_GROUPS = {
  'Opt-in Misa Harian': ['window_optin_harian_start','window_optin_harian_end'],
  'Penjadwalan':        ['prioritas_sma_smk_interval','max_hari_tanpa_jadwal'],
  'Tukar Jadwal':       ['swap_expire_hours'],
  'Suspend':            ['max_absen_before_suspend','suspend_duration_days'],
  'Liturgi':            ['gcatholic_url'],
};

export default function AdminPage() {
  const { profile } = useAuth();
  const [configs, setConfigs]   = useState({});
  const [users,   setUsers]     = useState([]);
  const [tab,     setTab]       = useState('config');
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);
  const [auditLog, setAuditLog] = useState([]);

  useEffect(() => { loadAll(); }, [tab]);

  async function loadAll() {
    setLoading(true);
    if (tab === 'config')  await loadConfigs();
    if (tab === 'users')   await loadUsers();
    if (tab === 'audit')   await loadAudit();
    setLoading(false);
  }

  async function loadConfigs() {
    const { data } = await supabase.from('system_config').select('*').order('key');
    const map = {};
    (data || []).forEach(c => { map[c.key] = c.value; });
    setConfigs(map);
  }

  async function loadUsers() {
    const { data } = await supabase
      .from('users')
      .select('id, nickname, nama_panggilan, role, status, is_suspended, suspended_until, email, created_at')
      .order('nama_panggilan');
    setUsers(data || []);
  }

  async function loadAudit() {
    const { data } = await supabase
      .from('audit_logs')
      .select('*, actor:actor_id(nama_panggilan)')
      .order('created_at', { ascending: false })
      .limit(50);
    setAuditLog(data || []);
  }

  async function saveConfigs() {
    setSaving(true);
    try {
      const upserts = Object.entries(configs).map(([key, value]) => ({
        key, value: String(value), updated_by: profile?.id, updated_at: new Date().toISOString()
      }));
      const { error } = await supabase.from('system_config').upsert(upserts, { onConflict: 'key' });
      if (error) throw error;
      toast.success('Konfigurasi tersimpan!');
    } catch (err) {
      toast.error('Gagal menyimpan: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(userId, newRole) {
    const { error } = await supabase.from('users').update({ role: newRole }).eq('id', userId);
    if (error) { toast.error('Gagal ubah role'); return; }
    // Audit log
    await supabase.from('audit_logs').insert({ actor_id: profile?.id, action: 'CHANGE_ROLE', target_id: userId, detail: `→ ${newRole}` });
    toast.success('Role diubah');
    loadUsers();
  }

  async function suspendUser(user) {
    const suspended = !user.is_suspended;
    const until = suspended ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null;
    await supabase.from('users').update({ is_suspended: suspended, suspended_until: until }).eq('id', user.id);
    await supabase.from('audit_logs').insert({ actor_id: profile?.id, action: suspended ? 'SUSPEND' : 'UNSUSPEND', target_id: user.id });
    toast.success(suspended ? `${user.nama_panggilan} disuspend 30 hari` : `${user.nama_panggilan} aktif kembali`);
    loadUsers();
  }

  async function resetPassword(user) {
    if (!confirm(`Reset password ${user.nickname}?`)) return;
    const tempPass = `sigma${user.myid?.slice(0,6) || 'reset'}`;
    const { error } = await supabase.auth.admin.updateUserById(user.id, { password: tempPass });
    if (error) { toast.error('Gagal reset: ' + error.message); return; }
    await supabase.from('audit_logs').insert({ actor_id: profile?.id, action: 'RESET_PASSWORD', target_id: user.id });
    toast.success(`Password direset. Temp: ${tempPass}`);
  }

  async function manualBackup() {
    toast.loading('Mengambil data backup...', { id: 'backup' });
    try {
      const [users, events, scans, swaps, rekap] = await Promise.all([
        supabase.from('users').select('*'),
        supabase.from('events').select('*'),
        supabase.from('scan_records').select('*'),
        supabase.from('swap_requests').select('*'),
        supabase.from('rekap_poin_mingguan').select('*'),
      ]);
      const backup = {
        exported_at: new Date().toISOString(),
        users: users.data,
        events: events.data,
        scan_records: scans.data,
        swap_requests: swaps.data,
        rekap_poin: rekap.data,
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `sigma-backup-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      toast.success('Backup berhasil diunduh!', { id: 'backup' });
    } catch (err) {
      toast.error('Gagal backup: ' + err.message, { id: 'backup' });
    }
  }

  const ROLES = ['Administrator','Pengurus','Pelatih','Misdinar_Aktif','Misdinar_Retired'];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Admin & Konfigurasi</h1>
          <p className="page-subtitle">Pengaturan sistem · Manajemen user · Audit log</p>
        </div>
        <button onClick={manualBackup} className="btn-outline gap-2">
          <Database size={16} /> Backup Manual
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        {[{key:'config',label:'⚙️ Konfigurasi'},{key:'users',label:'👥 User & Role'},{key:'audit',label:'📋 Audit Log'}].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab===t.key?'bg-white text-brand-800 shadow-sm':'text-gray-500'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Config tab */}
      {tab === 'config' && (
        <div className="space-y-4">
          {Object.entries(CONFIG_GROUPS).map(([group, keys]) => (
            <div key={group} className="card">
              <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <Settings size={16} className="text-brand-800" /> {group}
              </h3>
              <div className="grid sm:grid-cols-2 gap-4">
                {keys.map(key => (
                  <div key={key}>
                    <label className="label text-xs">{key}</label>
                    <input className="input text-sm"
                      value={configs[key] || ''}
                      onChange={e => setConfigs(c => ({...c, [key]: e.target.value}))}
                      placeholder={key.includes('url') ? 'https://...' : 'Nilai...'}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <button onClick={saveConfigs} disabled={saving} className="btn-primary gap-2">
            <Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan Konfigurasi'}
          </button>
        </div>
      )}

      {/* Users tab */}
      {tab === 'users' && (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="text-center py-8 text-gray-400">Memuat...</td></tr>
                ) : users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div className="font-semibold text-gray-900">{u.nama_panggilan}</div>
                      <div className="text-xs text-gray-400">@{u.nickname}</div>
                    </td>
                    <td className="text-xs text-gray-500">{u.email}</td>
                    <td>
                      <select
                        value={u.role}
                        onChange={e => changeRole(u.id, e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-800"
                      >
                        {ROLES.map(r => <option key={r}>{r}</option>)}
                      </select>
                    </td>
                    <td>
                      <span className={`badge ${u.is_suspended ? 'badge-red' : u.status === 'Active' ? 'badge-green' : 'badge-gray'}`}>
                        {u.is_suspended ? `Suspended s/d ${u.suspended_until}` : u.status}
                      </span>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <button onClick={() => suspendUser(u)}
                          className={`text-xs px-2 py-1 rounded-lg ${u.is_suspended ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {u.is_suspended ? 'Aktifkan' : 'Suspend'}
                        </button>
                        <button onClick={() => resetPassword(u)}
                          className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600">
                          Reset PW
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Audit log tab */}
      {tab === 'audit' && (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto max-h-[60vh]">
            <table className="tbl text-xs">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Aktor</th>
                  <th>Aksi</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} className="text-center py-8 text-gray-400">Memuat...</td></tr>
                ) : auditLog.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-8 text-gray-400">Belum ada log</td></tr>
                ) : auditLog.map((log, i) => (
                  <tr key={i}>
                    <td className="text-gray-400">{new Date(log.created_at).toLocaleString('id-ID')}</td>
                    <td className="font-medium">{log.actor?.nama_panggilan || '—'}</td>
                    <td><span className="badge-gray">{log.action}</span></td>
                    <td className="text-gray-500">{log.detail || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
