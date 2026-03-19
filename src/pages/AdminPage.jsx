import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Settings, Save, RefreshCw, Shield, Users, Database, Bell, KeyRound, MessageCircle, Send } from 'lucide-react';
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
  const [auditLog,   setAuditLog]  = useState([]);
  const [pwUsers,    setPwUsers]   = useState([]);   // anggota tanpa password / must_change
  const [loadingPw,  setLoadingPw] = useState(false);
  const [genResults, setGenResults]= useState([]);   // [{user, password, sent}]

  useEffect(() => { loadAll(); }, [tab]);

  async function loadAll() {
    setLoading(true);
    if (tab === 'config')  await loadConfigs();
    if (tab === 'users')   await loadUsers();
    if (tab === 'audit')   await loadAudit();
    if (tab === 'passwords') await loadPwUsers();
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

  async function loadPwUsers() {
    setLoadingPw(true);
    // Anggota yang must_change_password = TRUE atau belum punya akun Auth
    const { data } = await supabase
      .from('users')
      .select('id, nickname, nama_panggilan, hp_ortu, hp_anak, role, status, must_change_password, email')
      .eq('status', 'Active')
      .order('nama_panggilan');
    setPwUsers(data || []);
    setLoadingPw(false);
  }

  function genPassword(len = 8) {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  function getSalam() {
    const h = new Date(new Date().getTime() + 7*3600*1000).getUTCHours();
    if (h >= 5  && h < 11) return 'pagi';
    if (h >= 11 && h < 15) return 'siang';
    if (h >= 15 && h < 19) return 'sore';
    return 'malam';
  }

  function buildWAMsg(user, password) {
    const salam = getSalam();
    return encodeURIComponent(
`Selamat ${salam} bapak/ibu. Berikut adalah username dan password yang akan digunakan untuk sistem penjadwalan SIGMA V. 2.0

username: ${user.nickname}
password: ${password}
link sigma: sigma-krsoba.vercel.app

Mohon login menggunakan akun tersebut, kemudian langsung mengganti password sesuai dengan password yang mudah anda ingat namun kuat. Mohon gunakan dengan bijak dan penuh tanggung jawab. Mengenai regulasi dan tutorial akan dikirimkan via PDF/Video nantinya. Terimakasih, Berkah Dalem`
    );
  }

  async function generateBulkPasswords() {
    const targets = pwUsers.filter(u => u.must_change_password);
    if (!targets.length) {
      toast('Semua anggota sudah punya password aktif');
      return;
    }
    if (!confirm(`Generate password baru untuk ${targets.length} anggota yang belum/wajib ganti password?`)) return;

    setLoadingPw(true);
    const results = [];
    for (const u of targets) {
      const pw = genPassword(8);
      try {
        const { error } = await supabase.auth.admin.updateUserById(u.id, { password: pw });
        if (error) throw error;
        results.push({ user: u, password: pw, error: null });
      } catch (err) {
        // Fallback via RPC
        try {
          await supabase.rpc('admin_reset_password', { p_user_id: u.id, p_new_password: pw });
          results.push({ user: u, password: pw, error: null });
        } catch (e2) {
          results.push({ user: u, password: pw, error: e2.message });
        }
      }
    }
    setGenResults(results);
    setLoadingPw(false);
    toast.success(`${results.filter(r=>!r.error).length} password berhasil digenerate!`);
  }

  function openWA(user, password) {
    const hp = (user.hp_ortu || user.hp_anak || '').replace(/\D/g,'');
    if (!hp) { toast.error(`${user.nama_panggilan}: No. HP tidak ada`); return; }
    const phone = hp.startsWith('0') ? '62' + hp.slice(1) : hp;
    window.open(`https://wa.me/${phone}?text=${buildWAMsg(user, password)}`, '_blank');
  }

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
        {[{key:'config',label:'⚙️ Konfigurasi'},{key:'users',label:'👥 User & Role'},{key:'passwords',label:'🔑 Kirim Password'},{key:'audit',label:'📋 Audit Log'}].map(t => (
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
      {tab === 'passwords' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-blue-800">📤 Generate & Kirim Password via WhatsApp</p>
            <p className="text-xs text-blue-700 mt-1">
              Generate password otomatis untuk semua anggota yang <strong>wajib ganti password</strong>,
              lalu kirim ke nomor HP orang tua masing-masing via WA.
              Password yang digenerate akan ditampilkan di bawah — salin atau klik tombol WA per anggota.
            </p>
          </div>

          <div className="flex gap-3 flex-wrap items-center">
            <button onClick={generateBulkPasswords} disabled={loadingPw} className="btn-primary gap-2">
              <KeyRound size={16}/> {loadingPw ? 'Generating...' : 'Generate Password Semua'}
            </button>
            {genResults.length > 0 && (
              <span className="text-xs text-gray-500">{genResults.length} password digenerate</span>
            )}
          </div>

          {genResults.length > 0 && (
            <div className="card overflow-hidden p-0">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-700">Hasil Generate Password</h3>
                <p className="text-xs text-gray-400">Klik WA untuk kirim ke orang tua</p>
              </div>
              <div className="overflow-x-auto max-h-[60vh]">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Anggota</th>
                      <th>Username</th>
                      <th>Password Baru</th>
                      <th>No. HP Ortu</th>
                      <th>Kirim</th>
                    </tr>
                  </thead>
                  <tbody>
                    {genResults.map((r, i) => (
                      <tr key={i} className={r.error ? 'bg-red-50' : ''}>
                        <td className="font-medium text-sm">{r.user.nama_panggilan}</td>
                        <td className="font-mono text-xs text-gray-600">{r.user.nickname}</td>
                        <td>
                          <code className="bg-gray-100 px-2 py-0.5 rounded text-sm font-mono font-bold text-brand-800">
                            {r.password}
                          </code>
                          {r.error && <span className="text-red-500 text-xs ml-2">❌ {r.error}</span>}
                        </td>
                        <td className="text-xs text-gray-500">{r.user.hp_ortu || r.user.hp_anak || '—'}</td>
                        <td>
                          {(r.user.hp_ortu || r.user.hp_anak) ? (
                            <button onClick={() => openWA(r.user, r.password)}
                              className="btn-primary btn-sm gap-1 text-xs">
                              <MessageCircle size={13}/> WA
                            </button>
                          ) : (
                            <span className="text-xs text-orange-400">No HP kosong</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Daftar semua anggota aktif */}
          <div className="card overflow-hidden p-0">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-700">Semua Anggota Aktif</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {pwUsers.filter(u=>u.must_change_password).length} perlu ganti password ·
                {pwUsers.filter(u=>!u.hp_ortu && !u.hp_anak).length} tanpa nomor HP
              </p>
            </div>
            <div className="overflow-x-auto max-h-72">
              <table className="tbl">
                <thead>
                  <tr><th>Anggota</th><th>Username</th><th>Status PW</th><th>HP Ortu</th></tr>
                </thead>
                <tbody>
                  {loadingPw ? (
                    <tr><td colSpan={4} className="text-center py-6 text-gray-400">Memuat...</td></tr>
                  ) : pwUsers.map(u => (
                    <tr key={u.id}>
                      <td className="font-medium text-sm">{u.nama_panggilan}</td>
                      <td className="font-mono text-xs text-gray-600">{u.nickname}</td>
                      <td>
                        {u.must_change_password
                          ? <span className="badge-yellow text-xs">🔑 Wajib Ganti</span>
                          : <span className="badge-green text-xs">✓ OK</span>
                        }
                      </td>
                      <td className="text-xs text-gray-500">{u.hp_ortu || u.hp_anak || <span className="text-orange-400">Tidak ada</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

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
