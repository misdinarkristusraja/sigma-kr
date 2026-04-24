import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Settings, Save, Database, KeyRound, MessageCircle,
  CheckCircle2, XCircle, AlertTriangle, Loader2, Eye, EyeOff,
  RefreshCw, ClipboardCopy,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ── Konfigurasi ───────────────────────────────────────────────
const CONFIG_GROUPS = {
  'Opt-in Misa Harian':  ['window_optin_harian_start', 'window_optin_harian_end'],
  'Penjadwalan':         ['prioritas_sma_smk_interval', 'max_hari_tanpa_jadwal'],
  'Tukar Jadwal':        ['swap_expire_hours'],
  'Suspend':             ['max_absen_before_suspend', 'suspend_duration_days'],
  'Liturgi':             ['gcatholic_url'],
};

const ROLES = ['Administrator', 'Pengurus', 'Pelatih', 'Misdinar_Aktif', 'Misdinar_Retired'];

// ─── Helper ───────────────────────────────────────────────────
function getSalam() {
  const h = new Date(new Date().getTime() + 7 * 3600 * 1000).getUTCHours();
  if (h >= 5  && h < 11) return 'pagi';
  if (h >= 11 && h < 15) return 'siang';
  if (h >= 15 && h < 19) return 'sore';
  return 'malam';
}

function buildWAMsg(user, password) {
  return encodeURIComponent(
`Selamat ${getSalam()} bapak/ibu. Berikut adalah username dan password yang akan digunakan untuk sistem penjadwalan SIGMA V. 2.0

username: ${user.nickname}
password: ${password}
link sigma: sigma-krsoba.vercel.app

Mohon login menggunakan akun tersebut, kemudian langsung mengganti password sesuai dengan password yang mudah anda ingat namun kuat. Mohon gunakan dengan bijak dan penuh tanggung jawab. Terimakasih, Berkah Dalem`
  );
}

function openWA(user, password) {
  const hp = (user.hp_ortu || user.hp_anak || '').replace(/\D/g, '');
  if (!hp) { toast.error(`${user.nama_panggilan || user.nama}: No. HP tidak ada`); return; }
  const phone = hp.startsWith('0') ? '62' + hp.slice(1) : hp;
  window.open(`https://wa.me/${phone}?text=${buildWAMsg(user, password)}`, '_blank');
}

// ─── StatusBadge ─────────────────────────────────────────────
function StatusBadge({ user }) {
  if (user.is_suspended) return (
    <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-lg font-medium">
      Suspended {user.suspended_until ? `s/d ${user.suspended_until}` : ''}
    </span>
  );
  const map = {
    Active:  'bg-green-100 text-green-700',
    Pending: 'bg-yellow-100 text-yellow-700',
    Retired: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-lg font-medium ${map[user.status] || 'bg-gray-100 text-gray-500'}`}>
      {user.status}
    </span>
  );
}

// ─── QuickTestReset ───────────────────────────────────────────
function QuickTestReset({ members }) {
  const [selId,   setSelId]   = useState('');
  const [pw,      setPw]      = useState('');
  const [showPw,  setShowPw]  = useState(false);
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const user = members.find(m => m.id === selId);

  async function handleReset(e) {
    e.preventDefault();
    if (!selId || pw.length < 6) return;
    setLoading(true);
    setResult(null);
    const { data, error } = await supabase.rpc('admin_reset_password', {
      p_user_id: selId, p_new_password: pw,
    });
    if (error || data?.ok === false) {
      setResult({ ok: false, error: error?.message || data?.message || data?.error || 'Gagal' });
    } else {
      setResult({ ok: true, nickname: user?.nickname, nama: user?.nama_panggilan, password: pw });
    }
    setLoading(false);
  }

  function genPw() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    setPw(Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''));
    setShowPw(true);
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleReset} className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="label text-xs">Pilih Anggota</label>
          <select className="input text-sm" value={selId}
            onChange={e => { setSelId(e.target.value); setResult(null); setPw(''); }}>
            <option value="">— Pilih anggota —</option>
            {members.map(m => (
              <option key={m.id} value={m.id}>{m.nama_panggilan} (@{m.nickname})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label text-xs">Password Baru</label>
          <div className="flex gap-2">
            <input type={showPw ? 'text' : 'password'} className="input text-sm flex-1"
              value={pw} placeholder="Min. 6 karakter"
              onChange={e => setPw(e.target.value)} />
            <button type="button" onClick={() => setShowPw(v => !v)}
              className="btn-ghost px-2 text-gray-400">
              {showPw ? <EyeOff size={14}/> : <Eye size={14}/>}
            </button>
          </div>
        </div>
        <div className="flex flex-col justify-end gap-2">
          <button type="button" onClick={genPw} className="btn-outline btn-sm text-xs">🎲 Generate</button>
          <button type="submit" disabled={loading || !selId || pw.length < 6}
            className="btn-primary btn-sm text-xs gap-1 disabled:opacity-50">
            {loading ? <Loader2 size={13} className="animate-spin"/> : <KeyRound size={13}/>}
            Set Password
          </button>
        </div>
      </form>

      {result && (
        <div className={`p-4 rounded-xl border-2 ${result.ok ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
          {result.ok ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-green-800">✅ Berhasil untuk <strong>{result.nama}</strong></p>
              <div className="bg-white rounded-xl p-3 border border-green-200 flex items-center justify-between gap-3">
                <div className="font-mono text-sm space-y-0.5">
                  <p><span className="text-gray-400 text-xs">username: </span><strong>{result.nickname}</strong></p>
                  <p><span className="text-gray-400 text-xs">password: </span>
                    <strong className="text-brand-800 text-base">{result.password}</strong></p>
                </div>
                <button onClick={() => {
                  navigator.clipboard.writeText(`username: ${result.nickname}\npassword: ${result.password}`);
                  toast.success('Disalin!');
                }} className="btn-outline btn-sm text-xs gap-1">
                  <ClipboardCopy size={12}/> Salin
                </button>
              </div>
              <p className="text-xs text-green-700">Anggota wajib ganti password saat login berikutnya.</p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold text-red-800">❌ Reset gagal</p>
              <p className="text-xs text-red-700 mt-1 font-mono break-all">{result.error}</p>
              {result.error?.includes('auth.users') && (
                <p className="text-xs text-red-600 mt-2">
                  ⚠️ Jalankan migration <code>010_create_auth_users.sql</code> di Supabase SQL Editor untuk membuat akun auth.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
export default function AdminPage() {
  const { profile } = useAuth();
  const [tab,          setTab]         = useState('config');
  const [configs,      setConfigs]     = useState({});
  const [users,        setUsers]       = useState([]);
  const [auditLog,     setAuditLog]    = useState([]);
  const [pwUsers,      setPwUsers]     = useState([]);
  const [loading,      setLoading]     = useState(false);
  const [saving,       setSaving]      = useState(false);
  const [massLoading,  setMassLoading] = useState(false);
  const [massResults,  setMassResults] = useState([]);
  const [massProgress, setMassProgress]= useState(null); // null | { status, ... }
  const [genResults,   setGenResults]  = useState([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'config') {
        const { data } = await supabase.from('system_config').select('*').order('key');
        const map = {};
        (data || []).forEach(c => { map[c.key] = c.value; });
        setConfigs(map);
      }
      if (tab === 'users') {
        const { data } = await supabase
          .from('users')
          .select('id, nickname, nama_panggilan, role, status, is_suspended, suspended_until, email, myid, lingkungan, hp_ortu, hp_anak')
          .order('nama_panggilan');
        setUsers(data || []);
      }
      if (tab === 'audit') {
        const { data } = await supabase
          .from('audit_logs')
          .select('*, actor:actor_id(nama_panggilan)')
          .order('created_at', { ascending: false })
          .limit(100);
        setAuditLog(data || []);
      }
      if (tab === 'passwords') {
        const { data } = await supabase
          .from('users')
          .select('id, nickname, nama_panggilan, hp_ortu, hp_anak, role, status, must_change_password')
          .eq('status', 'Active')
          .order('nama_panggilan');
        setPwUsers(data || []);
      }
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { loadData(); }, [loadData]);

  async function saveConfigs() {
    setSaving(true);
    const upserts = Object.entries(configs).map(([key, value]) => ({
      key, value: String(value), updated_by: profile?.id, updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('system_config').upsert(upserts, { onConflict: 'key' });
    setSaving(false);
    if (error) { toast.error('Gagal simpan: ' + error.message); return; }
    toast.success('Konfigurasi tersimpan!');
  }

  async function changeRole(userId, newRole) {
    const { error } = await supabase.from('users').update({ role: newRole }).eq('id', userId);
    if (error) { toast.error('Gagal: ' + error.message); return; }
    await supabase.from('audit_logs').insert({
      actor_id: profile?.id, action: 'CHANGE_ROLE', target_id: userId, detail: `→ ${newRole}`,
    }).catch(() => {});
    toast.success('Role diubah');
    loadData();
  }

  async function suspendUser(user) {
    const nowSuspend = !user.is_suspended;
    const until = nowSuspend
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      : null;
    await supabase.from('users')
      .update({ is_suspended: nowSuspend, suspended_until: until }).eq('id', user.id);
    await supabase.from('audit_logs').insert({
      actor_id: profile?.id, action: nowSuspend ? 'SUSPEND' : 'UNSUSPEND', target_id: user.id,
    }).catch(() => {});
    toast.success(nowSuspend ? `${user.nama_panggilan} disuspend 30 hari` : `${user.nama_panggilan} aktif kembali`);
    loadData();
  }

  async function resetOnePassword(user) {
    if (!confirm(`Reset password ${user.nama_panggilan} (@${user.nickname})?`)) return;
    const tempPw = `sigma${(user.myid || user.nickname).slice(0, 6)}`;
    const { data, error } = await supabase.rpc('admin_reset_password', {
      p_user_id: user.id, p_new_password: tempPw,
    });
    if (error || data?.ok === false) {
      toast.error('Gagal: ' + (error?.message || data?.message || data?.error));
      return;
    }
    await supabase.from('audit_logs').insert({
      actor_id: profile?.id, action: 'RESET_PASSWORD', target_id: user.id,
    }).catch(() => {});
    toast.success(`Password sementara: ${tempPw}`, { duration: 8000 });
  }

  async function manualBackup() {
    const tid = toast.loading('Mengambil data backup...');
    try {
      const [u, ev, sc, sw, rk] = await Promise.all([
        supabase.from('users').select('*'),
        supabase.from('events').select('*'),
        supabase.from('scan_records').select('*'),
        supabase.from('swap_requests').select('*'),
        supabase.from('rekap_poin_mingguan').select('*'),
      ]);
      const blob = new Blob([JSON.stringify({
        exported_at: new Date().toISOString(),
        users: u.data, events: ev.data, scan_records: sc.data,
        swap_requests: sw.data, rekap_poin: rk.data,
      }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `sigma-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      toast.success('Backup berhasil!', { id: tid });
    } catch (err) {
      toast.error('Gagal backup: ' + err.message, { id: tid });
    }
  }

  // ──────────────────────────────────────────────────────────
  // MASS RESET — satu RPC call, tanpa Edge Function, tanpa CORS
  // Cara kerja:
  //   1. supabase.rpc('admin_provision_all') → POST /rest/v1/rpc/admin_provision_all
  //   2. PostgreSQL SECURITY DEFINER function berjalan di server Supabase
  //   3. Function loop semua user, generate password, update auth.users
  //   4. Return JSON hasil ke frontend
  //   5. Tidak ada Edge Function, tidak ada Deno, tidak ada CORS
  // ──────────────────────────────────────────────────────────
  async function massResetAllPasswords() {
    const targetCount = users.filter(u =>
      ['Active', 'Pending'].includes(u.status) && u.role !== 'Administrator'
    ).length;

    if (targetCount === 0) { toast('Tidak ada anggota aktif'); return; }

    if (!confirm(
      `Reset password ${targetCount} anggota aktif?\n\n` +
      `Administrator tidak termasuk.\n` +
      `Password di-generate server-side — aman, satu request, tanpa Edge Function.`
    )) return;

    setMassLoading(true);
    setMassResults([]);
    setMassProgress({ status: 'running', total: targetCount });

    // try/finally: setMassLoading(false) SELALU dipanggil terlepas dari apapun.
    // Bug sebelumnya: dipanggil SETELAH audit_logs.insert (~300ms) sehingga
    // banner hijau muncul tapi tombol spinner masih jalan selama jeda itu.
    try {
      const { data, error } = await supabase.rpc('admin_provision_all');

      if (error) {
        setMassProgress({ status: 'error', error: error.message });
        toast.error('RPC gagal: ' + error.message);
        return;
      }

      if (!data?.ok) {
        const msg = data?.message || data?.error || 'Response tidak valid';
        setMassProgress({ status: 'error', error: msg });
        toast.error(msg);
        return;
      }

      const results      = Array.isArray(data.results) ? data.results : [];
      const successCount = data.success ?? results.filter(r => r.ok).length;
      const failCount    = data.fail    ?? results.filter(r => !r.ok).length;

      setMassResults(results);
      setMassProgress({ status: 'done', total: results.length, success: successCount, fail: failCount });

      if (successCount > 0) {
        toast.success(`✅ ${successCount}/${results.length} password berhasil direset!`);
        downloadCSV(results.filter(r => r.ok));
      } else {
        toast.error(`Semua ${failCount} reset gagal. Lihat detail di tabel.`);
      }

      // Fire-and-forget — tidak boleh memblokir UI atau menahan loading state
      supabase.from('audit_logs').insert({
        actor_id: profile?.id,
        action:   'MASS_RESET_PASSWORD',
        detail:   `${successCount}/${results.length} berhasil via admin_provision_all`,
      }).catch(() => {});

    } finally {
      setMassLoading(false);
    }
  }

  async function generateBulkPasswords() {
    const targets = pwUsers.filter(u => u.must_change_password);
    if (!targets.length) { toast('Semua sudah punya password aktif'); return; }
    if (!confirm(`Generate password baru untuk ${targets.length} anggota?`)) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_provision_all');
    setLoading(false);
    if (error || !data?.ok) {
      toast.error(`Gagal: ${error?.message || data?.message || data?.error}`);
      return;
    }
    const targetNicknames = new Set(targets.map(t => t.nickname));
    setGenResults((data.results || []).filter(r => targetNicknames.has(r.nickname)));
    toast.success(`${(data.results || []).filter(r => r.ok && targetNicknames.has(r.nickname)).length} password digenerate!`);
  }

  function downloadCSV(results) {
    const ok = results.filter(r => r.ok);
    if (!ok.length) { toast('Tidak ada yang berhasil untuk diunduh'); return; }
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = 'Username,Nama,Lingkungan,Password Baru,HP Ortu';
    const rows = ok.map(r => [
      r.nickname, r.nama, r.lingkungan || '', r.password, r.hp_ortu || r.hp_anak || '',
    ].map(esc).join(','));
    const blob = new Blob(['\uFEFF' + [header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reset-password-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  }

  // ═══════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Admin &amp; Konfigurasi</h1>
          <p className="page-subtitle">Pengaturan sistem · Manajemen user · Audit log</p>
        </div>
        <button onClick={manualBackup} className="btn-outline gap-2">
          <Database size={16}/> Backup Manual
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        {[
          { key: 'config',    label: '⚙️ Konfigurasi' },
          { key: 'users',     label: '👥 User & Role' },
          { key: 'passwords', label: '🔑 Kirim Password' },
          { key: 'audit',     label: '📋 Audit Log' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.key ? 'bg-white text-brand-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─ Konfigurasi ─────────────────────────────────────── */}
      {tab === 'config' && (
        <div className="space-y-4">
          {Object.entries(CONFIG_GROUPS).map(([group, keys]) => (
            <div key={group} className="card">
              <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <Settings size={16} className="text-brand-800"/> {group}
              </h3>
              <div className="grid sm:grid-cols-2 gap-4">
                {keys.map(key => (
                  <div key={key}>
                    <label className="label text-xs">{key}</label>
                    <input className="input text-sm" value={configs[key] || ''}
                      onChange={e => setConfigs(c => ({ ...c, [key]: e.target.value }))}
                      placeholder={key.includes('url') ? 'https://...' : 'Nilai...'}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <button onClick={saveConfigs} disabled={saving} className="btn-primary gap-2">
            <Save size={16}/> {saving ? 'Menyimpan...' : 'Simpan Konfigurasi'}
          </button>
        </div>
      )}

      {/* ─ User & Role ─────────────────────────────────────── */}
      {tab === 'users' && (
        <div className="space-y-4">

          {/* MASS RESET CARD */}
          <div className="card border-red-100 bg-red-50/40 space-y-4">
            <div>
              <h3 className="font-semibold text-red-800 flex items-center gap-2">
                <KeyRound size={16}/> Reset Password Massal
              </h3>
              <p className="text-xs text-red-700 mt-1 leading-relaxed">
                Reset password semua anggota aktif sekaligus via <strong>database RPC</strong> —
                tanpa Edge Function, tanpa CORS, tanpa Service Role Key di frontend.
                Password di-generate server-side oleh PostgreSQL.
              </p>
            </div>

            {/* Status area */}
            {massLoading && (
              <div className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 border border-red-100">
                <Loader2 size={18} className="animate-spin text-brand-800 flex-shrink-0"/>
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    Memproses {massProgress?.total} anggota di server...
                  </p>
                  <p className="text-xs text-gray-500">
                    Satu request ke PostgreSQL — tidak perlu menunggu lama.
                  </p>
                </div>
              </div>
            )}

            {massProgress?.status === 'error' && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
                <p className="text-sm font-semibold text-red-800 flex items-center gap-2">
                  <AlertTriangle size={15}/> RPC gagal
                </p>
                <p className="text-xs font-mono text-red-700 bg-red-100 rounded px-2 py-1 break-all">
                  {massProgress.error}
                </p>
                <div className="text-xs text-red-700">
                  <p className="font-semibold mb-1">Kemungkinan penyebab:</p>
                  <ul className="pl-4 list-disc space-y-1">
                    <li>Migration <code className="bg-red-100 px-1 rounded">016_rpc_mass_reset.sql</code> belum dijalankan di Supabase SQL Editor</li>
                    <li>Akun yang login bukan Administrator di tabel <code className="bg-red-100 px-1 rounded">public.users</code></li>
                    <li>Session expired — logout lalu login kembali</li>
                  </ul>
                </div>
              </div>
            )}

            {massProgress?.status === 'done' && (
              <div className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 border border-green-200">
                <CheckCircle2 size={18} className="text-green-600 flex-shrink-0"/>
                <p className="text-sm text-gray-700">
                  <strong className="text-green-700">{massProgress.success} berhasil</strong>
                  {massProgress.fail > 0 && <> · <strong className="text-red-600">{massProgress.fail} gagal</strong></>}
                  {' '}· CSV sudah diunduh otomatis.
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-3 items-center">
              <button onClick={massResetAllPasswords} disabled={massLoading}
                className="btn-danger gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
                {massLoading
                  ? <><Loader2 size={15} className="animate-spin"/> Memproses...</>
                  : <><KeyRound size={15}/> 🔑 Reset Semua ({users.filter(u => ['Active','Pending'].includes(u.status) && u.role !== 'Administrator').length} anggota aktif)</>
                }
              </button>
              {massResults.some(r => r.ok) && (
                <button onClick={() => downloadCSV(massResults.filter(r => r.ok))}
                  className="btn-outline btn-sm text-xs gap-1">
                  📥 Unduh CSV Ulang
                </button>
              )}
            </div>

            {massResults.length > 0 && (
              <div className="overflow-x-auto max-h-72 border border-red-100 rounded-xl">
                <table className="tbl text-xs">
                  <thead>
                    <tr><th>Nama</th><th>Username</th><th>Password Baru</th><th>HP Ortu</th><th>WA</th></tr>
                  </thead>
                  <tbody>
                    {massResults.map((r, i) => (
                      <tr key={i} className={!r.ok ? 'bg-red-50' : ''}>
                        <td className="font-medium">{r.nama}</td>
                        <td className="font-mono text-gray-500">{r.nickname}</td>
                        <td>
                          {r.ok
                            ? <code className="bg-gray-100 px-2 py-0.5 rounded font-bold text-brand-800">{r.password}</code>
                            : <span className="text-red-500 flex items-center gap-1 text-xs"><XCircle size={11}/> {r.error}</span>
                          }
                        </td>
                        <td className="text-gray-400 text-xs">{r.hp_ortu || r.hp_anak || '—'}</td>
                        <td>
                          {r.ok && (r.hp_ortu || r.hp_anak) && (
                            <button onClick={() => openWA(r, r.password)}
                              className="btn-primary btn-sm gap-1 text-xs">
                              <MessageCircle size={12}/> WA
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Daftar user */}
          <div className="card overflow-hidden p-0">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-700">Semua User</h3>
              <button onClick={loadData} className="btn-ghost p-1.5 rounded-lg hover:bg-gray-100" title="Refresh">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''}/>
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Aksi</th></tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} className="text-center py-8 text-gray-400">
                      <Loader2 size={20} className="animate-spin mx-auto mb-1"/> Memuat...
                    </td></tr>
                  ) : users.map(u => (
                    <tr key={u.id}>
                      <td>
                        <p className="font-semibold text-gray-900">{u.nama_panggilan}</p>
                        <p className="text-xs text-gray-400">@{u.nickname}</p>
                      </td>
                      <td className="text-xs text-gray-500 max-w-[180px] truncate">{u.email}</td>
                      <td>
                        <select value={u.role} onChange={e => changeRole(u.id, e.target.value)}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-800">
                          {ROLES.map(r => <option key={r}>{r}</option>)}
                        </select>
                      </td>
                      <td><StatusBadge user={u}/></td>
                      <td>
                        <div className="flex gap-1.5">
                          <button onClick={() => suspendUser(u)}
                            className={`text-xs px-2 py-1 rounded-lg ${u.is_suspended ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {u.is_suspended ? 'Aktifkan' : 'Suspend'}
                          </button>
                          <button onClick={() => resetOnePassword(u)}
                            className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">
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

      {/* ─ Kirim Password ───────────────────────────────────── */}
      {tab === 'passwords' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-blue-800">📤 Generate &amp; Kirim Password via WhatsApp</p>
            <p className="text-xs text-blue-700 mt-1">
              Generate password otomatis untuk anggota wajib ganti password,
              lalu kirim ke nomor HP orang tua masing-masing via WA.
            </p>
          </div>

          <div className="flex gap-3 flex-wrap items-center">
            <button onClick={generateBulkPasswords} disabled={loading} className="btn-primary gap-2">
              {loading ? <Loader2 size={16} className="animate-spin"/> : <KeyRound size={16}/>}
              Generate Password Semua
            </button>
            {genResults.length > 0 && (
              <span className="text-xs text-gray-500">
                {genResults.filter(r => r.ok).length} password digenerate
              </span>
            )}
          </div>

          {genResults.length > 0 && (
            <div className="card overflow-hidden p-0">
              <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center">
                <h3 className="font-semibold text-gray-700">Hasil Generate</h3>
                <button onClick={() => downloadCSV(genResults)} className="btn-outline btn-sm text-xs gap-1">
                  📥 Unduh CSV
                </button>
              </div>
              <div className="overflow-x-auto max-h-[55vh]">
                <table className="tbl">
                  <thead>
                    <tr><th>Anggota</th><th>Username</th><th>Password</th><th>HP Ortu</th><th>Kirim</th></tr>
                  </thead>
                  <tbody>
                    {genResults.map((r, i) => (
                      <tr key={i} className={!r.ok ? 'bg-red-50' : ''}>
                        <td className="font-medium text-sm">{r.nama}</td>
                        <td className="font-mono text-xs text-gray-500">{r.nickname}</td>
                        <td>
                          {r.ok
                            ? <code className="bg-gray-100 px-2 py-0.5 rounded text-sm font-bold text-brand-800">{r.password}</code>
                            : <span className="text-red-500 text-xs">{r.error}</span>
                          }
                        </td>
                        <td className="text-xs text-gray-500">{r.hp_ortu || r.hp_anak || '—'}</td>
                        <td>
                          <div className="flex gap-1.5 flex-wrap">
                            {r.ok && (r.hp_ortu || r.hp_anak)
                              ? <button onClick={() => openWA(r, r.password)} className="btn-primary btn-sm gap-1 text-xs">
                                  <MessageCircle size={13}/> WA
                                </button>
                              : r.ok && <span className="text-xs text-orange-400">Tidak ada HP</span>
                            }
                            {r.ok && (
                              <button onClick={() => {
                                navigator.clipboard.writeText(`username: ${r.nickname}\npassword: ${r.password}`);
                                toast.success(`Disalin! (${r.nickname})`);
                              }} className="btn-outline btn-sm text-xs gap-1">
                                <ClipboardCopy size={11}/> Salin
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card space-y-3">
            <h3 className="font-semibold text-gray-700 flex items-center gap-2 text-sm">
              <KeyRound size={15} className="text-brand-800"/> Test Reset — Satu Anggota
            </h3>
            <p className="text-xs text-gray-500">
              Pilih satu anggota, set password manual, gunakan untuk test login.
            </p>
            <QuickTestReset members={pwUsers}/>
          </div>

          <div className="card overflow-hidden p-0">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-700">Semua Anggota Aktif</h3>
              <p className="text-xs text-gray-400">
                {pwUsers.filter(u => u.must_change_password).length} perlu ganti PW ·{' '}
                {pwUsers.filter(u => !u.hp_ortu && !u.hp_anak).length} tanpa HP
              </p>
            </div>
            <div className="overflow-x-auto max-h-64">
              <table className="tbl">
                <thead><tr><th>Anggota</th><th>Username</th><th>Status PW</th><th>HP Ortu</th></tr></thead>
                <tbody>
                  {loading
                    ? <tr><td colSpan={4} className="text-center py-6 text-gray-400">Memuat...</td></tr>
                    : pwUsers.map(u => (
                    <tr key={u.id}>
                      <td className="font-medium text-sm">{u.nama_panggilan}</td>
                      <td className="font-mono text-xs text-gray-500">{u.nickname}</td>
                      <td>
                        {u.must_change_password
                          ? <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-lg">🔑 Wajib Ganti</span>
                          : <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-lg">✓ OK</span>
                        }
                      </td>
                      <td className="text-xs text-gray-500">
                        {u.hp_ortu || u.hp_anak || <span className="text-orange-400">Tidak ada</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─ Audit Log ───────────────────────────────────────── */}
      {tab === 'audit' && (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto max-h-[65vh]">
            <table className="tbl text-xs">
              <thead>
                <tr><th>Waktu</th><th>Aktor</th><th>Aksi</th><th>Detail</th></tr>
              </thead>
              <tbody>
                {loading
                  ? <tr><td colSpan={4} className="text-center py-8 text-gray-400">Memuat...</td></tr>
                  : auditLog.length === 0
                  ? <tr><td colSpan={4} className="text-center py-8 text-gray-400">Belum ada log</td></tr>
                  : auditLog.map((log, i) => (
                  <tr key={i}>
                    <td className="text-gray-400 whitespace-nowrap text-xs">
                      {new Date(log.created_at).toLocaleString('id-ID')}
                    </td>
                    <td className="font-medium">{log.actor?.nama_panggilan || '—'}</td>
                    <td>
                      <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-lg font-mono text-xs">
                        {log.action}
                      </span>
                    </td>
                    <td className="text-gray-500 max-w-xs truncate">{log.detail || '—'}</td>
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
