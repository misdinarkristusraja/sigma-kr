import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Settings, Save, RefreshCw, Shield, Users, Database, Bell, KeyRound, MessageCircle, Send, Flame, FileSpreadsheet } from 'lucide-react';
import { broadcastNotification, sendNotification } from '../hooks/useNotifications';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';

// ── Helper: reset password via Edge Function ─────────────────────────
// pgcrypto dan GoTrue bcrypt tidak kompatibel → harus pakai Supabase Admin API
// Edge function ada di: supabase/functions/admin-reset-password/index.ts
// Panggil Edge Function dengan SIGMA_SECRET — tidak perlu token JWT
async function callEdge(_supabaseClient, payload) {
  const secret = import.meta.env.VITE_SIGMA_SECRET;
  if (!secret) throw new Error('VITE_SIGMA_SECRET belum di-set di environment variables Vercel');

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-reset-password`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ ...payload, secret }),
    });
  } catch (e) {
    throw new Error(`Network error: ${e.message}`);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch {
    if (res.status === 404) throw new Error('Edge Function belum di-deploy.');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
  }
  if (!data.ok && !data.results) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function resetPasswordViaEdge(supabaseClient, userId, newPassword) {
  const data = await callEdge(supabaseClient, { mode: 'reset', user_id: userId, new_password: newPassword });
  if (!data.ok) throw new Error(data.error || 'Reset gagal');
  return data;
}

const CONFIG_GROUPS = {
  'Opt-in Misa Harian': ['window_optin_harian_start','window_optin_harian_end'],
  'Penjadwalan':        ['prioritas_sma_smk_interval','max_hari_tanpa_jadwal'],
  'Tukar Jadwal':       ['swap_expire_hours'],
  'Suspend':            ['max_absen_before_suspend','suspend_duration_days'],
  'Liturgi':            ['gcatholic_url'],
  'Gamifikasi':         ['streak_feature_enabled'],
};

// ─── Tab Notifikasi & Gamifikasi ─────────────────────────────────────────
function NotifAdminTab() {
  const [title,    setTitle]    = React.useState('');
  const [body,     setBody]     = React.useState('');
  const [type,     setType]     = React.useState('pengumuman');
  const [sending,  setSending]  = React.useState(false);
  const [recalc,   setRecalc]   = React.useState(false);
  const [lastResult, setResult] = React.useState('');

  const handleBroadcast = async () => {
    if (!title || !body) { toast.error('Judul & isi notifikasi wajib diisi'); return; }
    setSending(true);
    try {
      await broadcastNotification({ title, body, type });
      toast.success('Notifikasi dikirim ke semua anggota aktif!');
      setTitle(''); setBody('');
    } catch (err) {
      toast.error('Gagal kirim notifikasi');
    }
    setSending(false);
  };

  const handleRecalcStreak = async () => {
    setRecalc(true);
    try {
      const { data, error } = await supabase.rpc('recalculate_all_streaks');
      if (error) throw error;
      setResult(data || 'Selesai');
      toast.success(data || 'Streak berhasil dihitung ulang');
    } catch {
      toast.error('Gagal hitung ulang streak');
    }
    setRecalc(false);
  };

  const TYPE_OPTS = [
    { value: 'pengumuman', label: '📢 Pengumuman' },
    { value: 'jadwal',     label: '📅 Jadwal' },
    { value: 'latihan',    label: '🎵 Latihan' },
    { value: 'streak',     label: '🔥 Streak' },
  ];

  return (
    <div className="space-y-6">
      {/* Broadcast Notifikasi */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Bell size={18} className="text-brand-800"/>
          <h3 className="font-semibold text-gray-800">Broadcast Notifikasi ke Semua Anggota</h3>
        </div>
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">Judul Notifikasi *</label>
              <input value={title} onChange={e => setTitle(e.target.value)}
                className="input" placeholder="cth: Jadwal Latihan Natal"/>
            </div>
            <div>
              <label className="label text-xs">Tipe</label>
              <select value={type} onChange={e => setType(e.target.value)} className="input">
                {TYPE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label text-xs">Isi Notifikasi *</label>
            <textarea value={body} onChange={e => setBody(e.target.value)}
              className="input resize-none" rows={3}
              placeholder="cth: Latihan Natal akan dilaksanakan Sabtu 20 Des pukul 09.00 WIB di Gereja..."/>
          </div>
          <div className="flex items-start gap-3">
            <button onClick={handleBroadcast} disabled={sending || !title || !body}
              className="btn-primary gap-2">
              <Send size={15}/>
              {sending ? 'Mengirim…' : 'Kirim ke Semua Anggota'}
            </button>
            <p className="text-xs text-gray-400 mt-2">
              Notifikasi akan muncul di ikon lonceng setiap anggota aktif.
            </p>
          </div>
        </div>
      </div>

      {/* Streak Management */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Flame size={18} className="text-orange-500"/>
          <h3 className="font-semibold text-gray-800">Manajemen Streak Gamifikasi</h3>
        </div>
        <div className="space-y-4">
          <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-sm text-amber-800">
            <p className="font-medium mb-1">🔒 Fitur ini akan dipublish pertengahan April</p>
            <p className="text-xs text-amber-700">
              Aktifkan <code className="bg-amber-100 px-1 rounded">streak_feature_enabled</code> di tab
              Konfigurasi untuk menampilkan menu Streak ke semua anggota.
              Streak tetap dihitung di balik layar meski belum dipublish.
            </p>
          </div>

          <div>
            <p className="text-sm text-gray-700 mb-2">
              Hitung ulang streak semua anggota berdasarkan rekap_poin_mingguan &
              absensi latihan wajib. Jalankan ini setelah scan absensi selesai.
            </p>
            <div className="flex items-center gap-3">
              <button onClick={handleRecalcStreak} disabled={recalc}
                className="btn-outline gap-2">
                <RefreshCw size={15} className={recalc ? 'animate-spin' : ''}/>
                {recalc ? 'Menghitung…' : 'Hitung Ulang Semua Streak'}
              </button>
              {lastResult && (
                <span className="text-sm text-green-700 font-medium">✅ {lastResult}</span>
              )}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-gray-100">
            <div className="p-3 bg-gray-50 rounded-xl text-sm">
              <p className="font-medium text-gray-700">Badge Otomatis</p>
              <p className="text-xs text-gray-500 mt-1">
                Badge diberikan otomatis saat recalculate dijalankan.
                Tidak ada notifikasi badge dikirim ke anggota sebelum fitur dipublish.
              </p>
            </div>
            <div className="p-3 bg-gray-50 rounded-xl text-sm">
              <p className="font-medium text-gray-700">Cara Aktifkan</p>
              <ol className="text-xs text-gray-500 mt-1 space-y-0.5 list-decimal list-inside">
                <li>Buka tab ⚙️ Konfigurasi</li>
                <li>Cari grup "Gamifikasi"</li>
                <li>Set <code>streak_feature_enabled</code> = <code>true</code></li>
                <li>Save</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function QuickTestReset({ members, genPassword, onReset }) {
  const [selUser,  setSelUser]  = React.useState('');
  const [tempPw,   setTempPw]   = React.useState('');
  const [showPw,   setShowPw]   = React.useState(false);
  const [loading,  setLoading]  = React.useState(false);
  const [result,   setResult]   = React.useState(null); // {nickname, password, ok}

  const user = members.find(m => m.id === selUser);

  async function handleReset() {
    if (!selUser || !tempPw) return;
    setLoading(true);
    setResult(null);
    const res = await onReset(selUser, tempPw);
    setResult({
      nickname: user?.nickname,
      nama:     user?.nama_panggilan,
      password: tempPw,
      ok:       res.ok,
      error:    res.error,
    });
    setLoading(false);
  }

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="label text-xs">Pilih Anggota</label>
          <select className="input text-sm" value={selUser}
            onChange={e => { setSelUser(e.target.value); setResult(null); setTempPw(''); }}>
            <option value="">— Pilih anggota —</option>
            {members.map(m => (
              <option key={m.id} value={m.id}>{m.nama_panggilan} (@{m.nickname})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label text-xs">Password Test</label>
          <div className="flex gap-2">
            <input
              type={showPw ? 'text' : 'password'}
              className="input text-sm flex-1"
              value={tempPw}
              placeholder="Isi atau generate"
              onChange={e => setTempPw(e.target.value)}
            />
            <button type="button" onClick={() => setShowPw(v => !v)}
              className="btn-ghost px-2 text-xs text-gray-400">
              {showPw ? 'Sem' : 'Lihat'}
            </button>
          </div>
        </div>
        <div className="flex flex-col justify-end gap-2">
          <button onClick={() => setTempPw(genPassword(8))} className="btn-outline btn-sm text-xs">
            🎲 Generate
          </button>
          <button
            onClick={handleReset}
            disabled={loading || !selUser || !tempPw}
            className="btn-primary btn-sm text-xs gap-1">
            {loading ? '...' : '🔑 Set & Tampilkan'}
          </button>
        </div>
      </div>

      {result && (
        <div className={`p-4 rounded-xl border-2 ${result.ok ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
          {result.ok ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-green-800">
                ✅ Password berhasil di-set untuk <strong>{result.nama}</strong>
              </p>
              <div className="bg-white rounded-xl p-3 font-mono text-sm border border-green-200">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-gray-500 text-xs">username: </span>
                    <span className="font-bold text-gray-900">{result.nickname}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 text-xs">password: </span>
                    <span className="font-bold text-brand-800 text-base">{result.password}</span>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`username: ${result.nickname}
password: ${result.password}`);
                      toast.success('Disalin!');
                    }}
                    className="btn-outline btn-sm text-xs ml-3">
                    Salin
                  </button>
                </div>
              </div>
              <p className="text-xs text-green-600">
                Gunakan kredensial di atas untuk test login di tab baru.
                Setelah selesai, anggota wajib ganti password saat login.
              </p>
            </div>
          ) : (
            <p className="text-sm text-red-700">❌ Gagal: {result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const { profile } = useAuth();
  const [configs, setConfigs]   = useState({});
  const [users,   setUsers]     = useState([]);
  const [tab,     setTab]       = useState('config');
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);
  const [auditLog,   setAuditLog]  = useState([]);
  const [pwUsers,    setPwUsers]   = useState([]);
  const [loadingPw,  setLoadingPw] = useState(false);
  const [genResults, setGenResults]= useState([]);
  const [massLoading,setMassLoad]  = useState(false);
  const [massResults,setMassRes]   = useState([]);   // [{user, password, ok}]

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
      .select('id, nickname, nama_panggilan, lingkungan, role, status, is_suspended, suspended_until, email, hp_ortu, hp_anak, created_at')
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
    try {
      await resetPasswordViaEdge(supabase, user.id, tempPass);
      await supabase.from('audit_logs').insert({ actor_id: profile?.id, action: 'RESET_PASSWORD', target_id: user.id });
      toast.success(`Password direset ke: ${tempPass}`);
    } catch (e) { toast.error('Gagal reset: ' + e.message); }
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
        await resetPasswordViaEdge(supabase, u.id, pw);
        results.push({ user: u, password: pw, error: null });
      } catch (e) {
        results.push({ user: u, password: pw, error: e.message });
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

  async function provisionAllAccounts() {
    if (!confirm(
      'Provision akun untuk semua anggota yang belum punya akun login?\n' +
      'Password acak akan di-generate. Download Excel setelah selesai.'
    )) return;
    setMassLoad(true);
    setMassRes([]);
    try {
      const json = await callEdge(supabase, { mode: 'provision_all' });
      const results = (json.results || []).map(r => ({
        user: {
          nickname:       r.nickname    || '',
          nama_panggilan: r.nama        || '',
          lingkungan:     r.lingkungan  || '',
          hp_ortu:        r.hp_ortu     || '',
          hp_anak:        r.hp_anak     || '',
          email:          r.email       || '',
        },
        password: r.password || '',
        ok:       r.ok,
        error:    r.error,
      }));
      setMassRes(results);
      const ok = results.filter(r => r.ok).length;
      toast.success(`${ok}/${results.length} akun berhasil di-provision!`);
      downloadMassResetExcel(results);
      loadUsers();
    } catch (e) {
      toast.error('Error: ' + e.message);
    }
    setMassLoad(false);
  }

  async function massResetAllPasswords() {
    // Exclude Administrator accounts from mass reset
    const targets = users.filter(u => u.status === 'Active' && u.role !== 'Administrator');
    if (!confirm(`Reset password ${targets.length} anggota aktif (Admin TIDAK termasuk)?\nSetiap orang akan wajib ganti password saat login.`)) return;
    setMassLoad(true);
    setMassRes([]);
    const results = [];
    for (const u of targets) {
      const pw = genPassword(8);
      try {
        await resetPasswordViaEdge(supabase, u.id, pw);
        results.push({ user: u, password: pw, ok: true });
      } catch (e) {
        results.push({ user: u, password: pw, ok: false, error: e.message });
      }
    }
    setMassRes(results);
    setMassLoad(false);
    const ok = results.filter(r=>r.ok).length;
    toast.success(`${ok}/${results.length} password berhasil direset! (Admin dilewati)`);
    // Auto-download Excel
    downloadMassResetExcel(results);
  }

  function downloadMassResetExcel(results) {
    if (!results || results.length === 0) {
      toast.error('Tidak ada data untuk diexport');
      return;
    }

    try {
      const rows = results.map(r => ({
        'Username':      r.user?.nickname    || r.nickname    || '',
        'Nama':          r.user?.nama_panggilan || r.nama    || '',
        'Lingkungan':    r.user?.lingkungan  || '',
        'Password Baru': r.ok ? (r.password || '') : '— GAGAL —',
        'Status':        r.ok ? 'Berhasil' : `Gagal: ${r.error || ''}`,
        'HP Ortu':       r.user?.hp_ortu    || r.hp_ortu    || '',
        'HP Anak':       r.user?.hp_anak    || r.hp_anak    || '',
        'Email':         r.user?.email      || r.email      || '',
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [16, 24, 20, 16, 18, 17, 17, 30].map(w => ({ wch: w }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Reset Password');
      const today = new Date().toISOString().split('T')[0];
      XLSX.writeFile(wb, `reset-password-${today}.xlsx`);
      toast.success(`Excel diunduh! ${rows.length} anggota.`);
    } catch (err) {
      console.error('Excel error:', err);
      toast.error('Gagal buat Excel: ' + err.message);
    }
  }

  // Tetap sediakan CSV sebagai fallback
  function downloadMassResetCSV(results) {
    const rows = results.map(r => [
      r.user.nickname, r.user.nama_panggilan, r.user.lingkungan,
      r.password, r.ok ? 'Berhasil' : 'Gagal',
      r.user.hp_ortu || r.user.hp_anak || '',
    ]);
    const header = 'Username,Nama,Lingkungan,Password Baru,Status,HP Ortu';
    const csv = [header, ...rows.map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reset-password-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
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
        {[{key:'config',label:'⚙️ Konfigurasi'},{key:'users',label:'👥 User & Role'},{key:'passwords',label:'🔑 Kirim Password'},{key:'notif',label:'📢 Notifikasi'},{key:'audit',label:'📋 Audit Log'}].map(t => (
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
        <div className="space-y-4">
          {/* Provision + Mass Reset */}
          <div className="card border-red-100 bg-red-50/30 space-y-4">
            <h3 className="font-semibold text-red-800 flex items-center gap-2 text-sm">
              <KeyRound size={15}/> Provision & Reset Password
            </h3>

            {/* Test Edge Function */}
            <EdgeFunctionStatus supabase={supabase}/>

            {/* PROVISION — buat akun baru untuk yang belum punya */}
            <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 space-y-2">
              <p className="text-xs font-semibold text-blue-800">
                🆕 Langkah 1 (pertama kali / ada anggota baru): Provision Akun
              </p>
              <p className="text-xs text-blue-700">
                Buat akun login untuk semua anggota yang belum punya. Password otomatis di-generate acak.
                Anggota lama yang sudah punya akun akan di-reset passwordnya.
              </p>
              <button onClick={provisionAllAccounts} disabled={massLoading}
                className="btn-primary gap-2 bg-blue-600 hover:bg-blue-700 border-blue-600">
                <Users size={15}/>
                {massLoading ? 'Memproses...' : '🚀 Provision Semua Akun'}
              </button>
            </div>

            {/* RESET — hanya reset password, akun sudah ada */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-red-800">
                🔑 Langkah 2 (opsional): Reset Password Saja
              </p>
              <p className="text-xs text-red-700">
                Hanya reset password semua akun yang sudah ada. Tidak membuat akun baru.
              </p>
              <button onClick={massResetAllPasswords} disabled={massLoading}
                className="btn-danger gap-2">
                <KeyRound size={15}/>
                {massLoading ? 'Mereset...' : `Reset Password (${users.filter(u=>u.status==='Active').length} anggota)`}
              </button>
            </div>

            {massResults.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-600 font-medium">
                    ✅ {massResults.filter(r=>r.ok).length} berhasil
                    {massResults.filter(r=>!r.ok).length > 0 && ` · ❌ ${massResults.filter(r=>!r.ok).length} gagal`}
                  </span>
                  <button onClick={() => downloadMassResetExcel(massResults)}
                    className="btn-primary btn-sm gap-1 text-xs">
                    <FileSpreadsheet size={13}/> Excel
                  </button>
                  <button onClick={() => downloadMassResetCSV(massResults)}
                    className="btn-outline btn-sm gap-1 text-xs">
                    📥 CSV
                  </button>
                </div>
                <div className="overflow-x-auto max-h-64 border border-red-100 rounded-xl">
                  <table className="tbl text-xs">
                    <thead><tr><th>Nama</th><th>Username</th><th>Password Baru</th><th>HP Ortu</th><th>WA</th></tr></thead>
                    <tbody>
                      {massResults.map((r,i) => (
                        <tr key={i} className={r.ok ? '' : 'bg-red-50'}>
                          <td className="font-medium">{r.user.nama_panggilan}</td>
                          <td className="font-mono text-gray-600">{r.user.nickname}</td>
                          <td>{r.ok ? <code className="bg-gray-100 px-2 py-0.5 rounded font-bold text-brand-800">{r.password}</code> : <span className="text-red-500">❌ {r.error}</span>}</td>
                          <td className="text-gray-500 text-xs">{r.user.hp_ortu || r.user.hp_anak || '—'}</td>
                          <td>{r.ok && (r.user.hp_ortu||r.user.hp_anak) && (
                            <button onClick={() => openWA(r.user, r.password)} className="btn-primary btn-sm gap-1 text-xs">
                              <MessageCircle size={12}/> WA
                            </button>
                          )}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
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
                          <div className="flex gap-1.5 flex-wrap">
                            {(r.user.hp_ortu || r.user.hp_anak) ? (
                              <button onClick={() => openWA(r.user, r.password)}
                                className="btn-primary btn-sm gap-1 text-xs">
                                <MessageCircle size={13}/> WA
                              </button>
                            ) : (
                              <span className="text-xs text-orange-400">No HP</span>
                            )}
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(
                                  `username: ${r.user.nickname}\npassword: ${r.password}`
                                );
                                toast.success(`Disalin! User: ${r.user.nickname}`);
                              }}
                              className="btn-outline btn-sm text-xs">
                              Salin
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

          {/* Quick Test: reset satu akun untuk test login */}
          <div className="card space-y-3">
            <h3 className="font-semibold text-gray-700 flex items-center gap-2 text-sm">
              <Shield size={15} className="text-brand-800"/> Test Login — Reset Password Sementara
            </h3>
            <p className="text-xs text-gray-500">
              Pilih anggota, generate password sementara, lalu gunakan untuk test login.
              Password disimpan di layar saja — tidak dicatat di database sebagai plain text.
            </p>
            <QuickTestReset
              members={pwUsers}
              genPassword={genPassword}
              onReset={async (userId, pw) => {
                try {
                  await resetPasswordViaEdge(supabase, userId, pw);
                  return { ok: true };
                } catch (e) {
                  return { ok: false, error: e.message };
                }
              }}
            />
          </div>

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

      {tab === 'notif' && (
        <NotifAdminTab/>
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

// ── Komponen: Status Edge Function ────────────────────────────
// Tampil di atas bagian reset password — bantu diagnosa jika EF belum deploy
function EdgeFunctionStatus({ supabase }) {
  const [status, setStatus] = React.useState(null);
  const [detail, setDetail] = React.useState('');

  async function checkEdgeFunction() {
    setStatus('checking'); setDetail('');
    try {
      // Kirim POST dengan mode khusus "ping" — tidak butuh auth, cukup cek EF hidup
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-reset-password`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ mode: 'ping' }),
      });

      const text = await res.text();

      if (res.status === 404 || text.includes('Function not found') || text.includes('Not Found')) {
        setStatus('error');
        setDetail('Edge Function belum di-deploy di Supabase.');
        return;
      }

      // Kalau dapat response apapun (401, 403, 200) — EF sudah ada
      // 401 = EF ada tapi butuh auth (normal)
      setStatus('ok');
      setDetail(`Edge Function aktif (HTTP ${res.status}). Reset password siap digunakan.`);

    } catch (e) {
      // "Failed to fetch" bisa berarti CORS atau network — bukan berarti EF tidak ada
      // Coba verifikasi via supabase client langsung
      try {
        const { data: sessionData } = await supabase.auth.refreshSession();
        const token = sessionData?.session?.access_token;
        if (!token) throw new Error('no token');

        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-reset-password`;
        const res2 = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ mode: 'ping' }),
        });
        const text2 = await res2.text();
        if (res2.status === 404 || text2.includes('Not Found')) {
          setStatus('error');
          setDetail('Edge Function belum di-deploy.');
        } else {
          setStatus('ok');
          setDetail(`Edge Function aktif (HTTP ${res2.status}).`);
        }
      } catch (e2) {
        setStatus('error');
        setDetail(`Tidak bisa terhubung: ${e2.message}. Pastikan VITE_SUPABASE_URL benar.`);
      }
    }
  }

  return (
    <div className={`p-3 rounded-xl border text-xs space-y-2
      ${status === 'ok' ? 'bg-green-50 border-green-200'
      : status === 'error' ? 'bg-red-50 border-red-200'
      : 'bg-gray-50 border-gray-200'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${
            status === 'ok' ? 'bg-green-500'
            : status === 'error' ? 'bg-red-500'
            : status === 'checking' ? 'bg-yellow-400 animate-pulse'
            : 'bg-gray-300'}`}/>
          <span className="font-medium text-gray-700">
            {status === null && 'Edge Function: klik Cek untuk verifikasi'}
            {status === 'checking' && 'Mengecek…'}
            {status === 'ok' && '✅ Edge Function: Aktif'}
            {status === 'error' && '❌ Edge Function: Belum di-deploy'}
          </span>
        </div>
        <button onClick={checkEdgeFunction} disabled={status === 'checking'}
          className="btn-outline btn-sm text-xs px-2 py-1">
          {status === 'checking' ? '…' : 'Cek'}
        </button>
      </div>
      {detail && <p className="text-gray-600">{detail}</p>}
    </div>
  );
}
