import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Settings, Save, RefreshCw, Shield, Users, Database, Bell, KeyRound, MessageCircle, Send, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';

const CONFIG_GROUPS = {
  'Opt-in Misa Harian': ['window_optin_harian_start','window_optin_harian_end'],
  'Penjadwalan':        ['prioritas_sma_smk_interval','max_hari_tanpa_jadwal'],
  'Tukar Jadwal':       ['swap_expire_hours'],
  'Suspend':            ['max_absen_before_suspend','suspend_duration_days'],
  'Liturgi':            ['gcatholic_url'],
};

// ─── Komponen: Edge Function Health Banner ────────────────────
// status: null | 'checking' | 'ok' | { httpStatus, errorCode, message }
// Menampilkan panduan spesifik berdasarkan HTTP status code dari edge function.
function EdgeFunctionStatus({ status }) {
  if (!status) return null;

  if (status === 'checking') {
    return (
      <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5">
        <div className="w-3 h-3 border-2 border-blue-400/40 border-t-blue-600 rounded-full animate-spin"/>
        Memeriksa edge function...
      </div>
    );
  }

  if (status === 'ok') {
    return (
      <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5">
        <CheckCircle2 size={14}/> Edge Function aktif dan siap digunakan.
      </div>
    );
  }

  // status is an error object: { httpStatus, errorCode, message }
  const { httpStatus, errorCode, message } = status;

  // Panduan berbeda berdasarkan HTTP status code yang sebenarnya
  const GUIDES = {
    0: {
      title: 'Tidak dapat terhubung ke Edge Function (Network Error)',
      items: [
        'Edge Function belum di-deploy — jalankan perintah di bawah',
        'Supabase project sedang pause (Free Tier) → buka Dashboard Supabase untuk mengaktifkan',
        'Koneksi internet bermasalah',
      ],
      showDeploy: true,
    },
    401: {
      title: 'Token JWT ditolak (HTTP 401)',
      items: [
        'Session login sudah expired → logout lalu login kembali',
        'Token rusak — coba hard refresh browser (Ctrl+Shift+R)',
        'Pastikan VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY di Vercel sudah benar',
      ],
      showDeploy: false,
    },
    403: {
      title: 'Akses ditolak (HTTP 403)',
      items: [
        'Akun yang login bukan Administrator atau profil tidak ditemukan di database',
        'Pastikan kolom "role" di tabel users adalah "Administrator" (bukan "Misdinar_Aktif")',
        'Jika status akun "Retired", ubah dulu ke "Active" di tabel users via Supabase Dashboard → Table Editor',
      ],
      showDeploy: false,
    },
    404: {
      title: 'Edge Function tidak ditemukan (HTTP 404)',
      items: [
        'Edge Function belum di-deploy atau nama salah',
        'Deploy ulang dengan perintah di bawah',
        'Pastikan nama function persis: admin-reset-password (huruf kecil, pakai tanda hubung)',
      ],
      showDeploy: true,
    },
    500: {
      title: 'Edge Function crash saat dijalankan (HTTP 500)',
      items: [
        'Environment variable SUPABASE_SERVICE_ROLE_KEY tidak tersedia di edge function',
        'Cek Supabase Dashboard → Edge Functions → admin-reset-password → Logs untuk detail error',
        'Coba deploy ulang',
      ],
      showDeploy: true,
    },
  };

  const guide = GUIDES[httpStatus] || {
    title: `Edge Function error (HTTP ${httpStatus || 'unknown'})`,
    items: ['Cek Supabase Dashboard → Edge Functions → Logs untuk detail'],
    showDeploy: false,
  };

  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
        <AlertTriangle size={16}/> {guide.title}
      </div>

      {/* Pesan asli dari edge function */}
      {message && (
        <div className="bg-red-100 rounded-lg px-3 py-2">
          <p className="text-xs text-red-800 font-mono break-all">
            {errorCode && <span className="font-bold">[{errorCode}] </span>}{message}
          </p>
        </div>
      )}

      <ul className="text-xs text-red-700 space-y-1 pl-4 list-disc">
        {guide.items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>

      {guide.showDeploy && (
        <div className="bg-gray-900 rounded-lg px-3 py-2 mt-2">
          <p className="text-xs text-green-400 font-mono">
            $ supabase functions deploy admin-reset-password --no-verify-jwt
          </p>
        </div>
      )}

      {httpStatus === 403 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-1">
          <p className="text-xs text-amber-800">
            <strong>Perhatian:</strong> Jika akun Admin kamu berstatus <strong>Retired</strong> di tabel users,
            edge function akan menolak request meski role-nya Administrator.
            Ubah status ke <strong>Active</strong> via Supabase Dashboard → Table Editor → users → edit baris Admin.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Komponen: Quick Test Reset ──────────────────────────────
function QuickTestReset({ members, genPassword, onReset }) {
  const [selUser,  setSelUser]  = React.useState('');
  const [tempPw,   setTempPw]   = React.useState('');
  const [showPw,   setShowPw]   = React.useState(false);
  const [loading,  setLoading]  = React.useState(false);
  const [result,   setResult]   = React.useState(null);

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
                      navigator.clipboard.writeText(`username: ${result.nickname}\npassword: ${result.password}`);
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

// ═══════════════════════════════════════════════════════════════
export default function AdminPage() {
  const { profile } = useAuth();
  const [configs,    setConfigs]   = useState({});
  const [users,      setUsers]     = useState([]);
  const [tab,        setTab]       = useState('config');
  const [loading,    setLoading]   = useState(true);
  const [saving,     setSaving]    = useState(false);
  const [auditLog,   setAuditLog]  = useState([]);
  const [pwUsers,    setPwUsers]   = useState([]);
  const [loadingPw,  setLoadingPw] = useState(false);
  const [genResults, setGenResults]= useState([]);

  // ── Mass reset state (dipisah dari genResults) ─────────────
  const [massLoading,  setMassLoad]    = useState(false);
  const [massResults,  setMassRes]     = useState([]);
  // massProgress: { done, total, success, fail }
  const [massProgress, setMassProgress]= useState(null);
  // edgeFnStatus: null | 'checking' | 'ok' | 'error'
  const [edgeFnStatus, setEdgeFnStatus]= useState(null);

  useEffect(() => { loadAll(); }, [tab]);

  async function loadAll() {
    setLoading(true);
    if (tab === 'config')    await loadConfigs();
    if (tab === 'users')     await loadUsers();
    if (tab === 'audit')     await loadAudit();
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
      .select('id, nickname, nama_panggilan, role, status, is_suspended, suspended_until, email, created_at, myid, lingkungan')
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
    const { data, error } = await supabase.rpc('admin_reset_password', {
      p_user_id: user.id, p_new_password: tempPass,
    });
    if (error || data?.ok === false) { toast.error('Gagal reset: ' + (error?.message || data?.error)); return; }
    await supabase.from('audit_logs').insert({ actor_id: profile?.id, action: 'RESET_PASSWORD', target_id: user.id });
    toast.success(`Password direset ke: ${tempPass}`);
  }

  async function manualBackup() {
    toast.loading('Mengambil data backup...', { id: 'backup' });
    try {
      const [u, ev, sc, sw, rk] = await Promise.all([
        supabase.from('users').select('*'),
        supabase.from('events').select('*'),
        supabase.from('scan_records').select('*'),
        supabase.from('swap_requests').select('*'),
        supabase.from('rekap_poin_mingguan').select('*'),
      ]);
      const backup = {
        exported_at: new Date().toISOString(),
        users: u.data, events: ev.data, scan_records: sc.data,
        swap_requests: sw.data, rekap_poin: rk.data,
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
    const h = new Date(new Date().getTime() + 7 * 3600 * 1000).getUTCHours();
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

  // ── Ping health check ───────────────────────────────────────
  // Mengembalikan true jika OK.
  // Jika gagal, set edgeFnStatus ke objek { httpStatus, errorCode, message }
  // agar EdgeFunctionStatus bisa menampilkan panduan yang tepat.
  //
  // Penting: Edge function versi baru menaruh ping SEBELUM auth check,
  // sehingga ping selalu berhasil jika function terdeploy dengan benar —
  // terlepas dari status JWT atau role user.
  async function pingEdgeFunction() {
    setEdgeFnStatus('checking');
    try {
      const { data, error } = await supabase.functions.invoke('admin-reset-password', {
        body: { mode: 'ping' },
      });

      if (error) {
        // FunctionsHttpError: edge function merespons dengan non-2xx
        // FetchError: network level — function tidak terjangkau sama sekali
        const httpStatus = error?.context?.status ?? 0;
        let errorBody = {};
        try {
          // Coba ekstrak JSON response body dari error
          errorBody = await error?.context?.json?.() ?? {};
        } catch { /* response body bukan JSON */ }

        setEdgeFnStatus({
          httpStatus,
          errorCode: errorBody?.error ?? error?.name ?? 'UNKNOWN',
          message: errorBody?.message ?? error?.message ?? 'Tidak ada detail error',
        });
        return false;
      }

      if (!data?.ok) {
        setEdgeFnStatus({
          httpStatus: 200,
          errorCode: 'UNEXPECTED_RESPONSE',
          message: `Edge function merespons tapi ok=false: ${JSON.stringify(data)}`,
        });
        return false;
      }

      setEdgeFnStatus('ok');
      return true;
    } catch (err) {
      // Unexpected JS error (bukan dari supabase-js)
      setEdgeFnStatus({
        httpStatus: 0,
        errorCode: 'JS_ERROR',
        message: err?.message ?? String(err),
      });
      return false;
    }
  }

  // ── Mass Reset — pakai mode provision_all (satu HTTP call) ──
  // FIX ROOT CAUSE 2: Sebelumnya memanggil edge function 131 kali secara sequential
  // (satu call per user), yang menyebabkan 65-130 detik total dan sangat rentan gagal.
  // Mode provision_all memproses semua user dalam SATU HTTP call ke edge function,
  // di mana server yang melakukan loop — jauh lebih cepat dan reliable.
  async function massResetAllPasswords() {
    const activeCount = users.filter(u => u.status === 'Active' && u.role !== 'Administrator').length;
    if (!confirm(
      `Reset password ${activeCount} anggota aktif (Administrator TIDAK termasuk)?\n\n` +
      `Proses dilakukan server-side dalam satu request — jauh lebih cepat dari sebelumnya.\n` +
      `Setiap anggota wajib mengganti password saat login berikutnya.`
    )) return;

    setMassLoad(true);
    setMassRes([]);
    setMassProgress(null);
    setEdgeFnStatus(null);

    // Langkah 1: Ping dulu — pastikan edge function bisa dijangkau
    // Ini mencegah semua request gagal tanpa feedback yang jelas.
    const reachable = await pingEdgeFunction();
    if (!reachable) {
      setMassLoad(false);
      toast.error('Edge Function tidak dapat dijangkau. Lihat panduan di atas.');
      return;
    }

    // Langkah 2: Satu call ke mode provision_all
    // Server generate password acak dan memproses semua user.
    setMassProgress({ done: 0, total: activeCount, success: 0, fail: 0 });
    try {
      const { data, error } = await supabase.functions.invoke('admin-reset-password', {
        body: { mode: 'provision_all' },
      });

      if (error) {
        // Ekstrak HTTP status dan pesan asli dari FunctionsHttpError
        const httpStatus = error?.context?.status ?? 0;
        let errorBody = {};
        try { errorBody = await error?.context?.json?.() ?? {}; } catch { /* ignore */ }

        setEdgeFnStatus({
          httpStatus,
          errorCode: errorBody?.error ?? 'HTTP_ERROR',
          message: errorBody?.message ?? error?.message,
        });
        setMassLoad(false);
        toast.error(`Gagal (HTTP ${httpStatus || 'network error'}): ${errorBody?.message || error?.message}`);
        return;
      }

      if (!data?.ok || !Array.isArray(data.results)) {
        toast.error(`Edge function error: ${data?.error || 'Respons tidak valid'}`);
        setMassLoad(false);
        return;
      }

      // Langkah 3: Petakan hasil provision_all ke format yang dipakai UI
      // provision_all mengembalikan: [{nickname, nama, email, lingkungan, hp_ortu, hp_anak, password, ok, action, error}]
      // massResults di UI mengharapkan: [{user: {...}, password, ok, error}]
      const results = data.results.map(r => ({
        user: {
          nama_panggilan: r.nama,
          nickname:       r.nickname,
          hp_ortu:        r.hp_ortu,
          hp_anak:        r.hp_anak,
          lingkungan:     r.lingkungan || '',
        },
        password: r.password,
        ok:       r.ok,
        error:    r.error,
      }));

      const successCount = results.filter(r => r.ok).length;
      const failCount    = results.filter(r => !r.ok).length;

      setMassRes(results);
      setMassProgress({ done: results.length, total: results.length, success: successCount, fail: failCount });

      // Audit log
      await supabase.from('audit_logs').insert({
        actor_id: profile?.id,
        action:   'MASS_RESET_PASSWORD',
        detail:   `${successCount}/${results.length} berhasil via provision_all`,
      }).catch(() => {}); // audit log tidak boleh gagalkan flow utama

      if (successCount > 0) {
        toast.success(`✅ ${successCount}/${results.length} password berhasil direset!`);
        // Hanya download CSV jika ada yang berhasil — CSV kosong tidak berguna
        downloadMassResetCSV(results.filter(r => r.ok));
      } else {
        toast.error(`Semua ${failCount} reset gagal. Cek error di tabel.`);
      }
    } catch (err) {
      toast.error(`Error tidak terduga: ${err.message}`);
    } finally {
      setMassLoad(false);
    }
  }

  // ── Generate bulk passwords (tab Passwords) ─────────────────
  // Sama seperti mass reset tapi untuk tab "Kirim Password" — juga difix
  // dari individual loop ke provision_all + mapping ke genResults format.
  async function generateBulkPasswords() {
    const targets = pwUsers.filter(u => u.must_change_password);
    if (!targets.length) {
      toast('Semua anggota sudah punya password aktif');
      return;
    }
    if (!confirm(`Generate password baru untuk ${targets.length} anggota yang wajib ganti password?`)) return;

    setLoadingPw(true);
    setEdgeFnStatus(null);

    const reachable = await pingEdgeFunction();
    if (!reachable) {
      setLoadingPw(false);
      toast.error('Edge Function tidak dapat dijangkau.');
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('admin-reset-password', {
        body: { mode: 'provision_all' },
      });

      if (error || !data?.ok) {
        toast.error(`Gagal: ${error?.message || data?.error}`);
        setLoadingPw(false);
        return;
      }

      // Filter hanya yang masuk target (must_change_password), petakan format
      const targetNicknames = new Set(targets.map(t => t.nickname));
      const results = (data.results || [])
        .filter(r => targetNicknames.has(r.nickname))
        .map(r => ({
          user: {
            nama_panggilan: r.nama,
            nickname:       r.nickname,
            hp_ortu:        r.hp_ortu,
            hp_anak:        r.hp_anak,
          },
          password: r.password,
          error:    r.ok ? null : r.error,
        }));

      setGenResults(results);
      toast.success(`${results.filter(r => !r.error).length} password berhasil digenerate!`);
    } catch (err) {
      toast.error(`Error: ${err.message}`);
    } finally {
      setLoadingPw(false);
    }
  }

  function openWA(user, password) {
    const hp = (user.hp_ortu || user.hp_anak || '').replace(/\D/g, '');
    if (!hp) { toast.error(`${user.nama_panggilan}: No. HP tidak ada`); return; }
    const phone = hp.startsWith('0') ? '62' + hp.slice(1) : hp;
    window.open(`https://wa.me/${phone}?text=${buildWAMsg(user, password)}`, '_blank');
  }

  // FIX: CSV hanya download hasil yang OK saja (tidak download jika semua gagal)
  function downloadMassResetCSV(results) {
    const okResults = results.filter(r => r.ok);
    if (!okResults.length) {
      toast('Tidak ada hasil berhasil untuk diunduh');
      return;
    }
    const rows = okResults.map(r => [
      r.user.nickname, r.user.nama_panggilan, r.user.lingkungan || '',
      r.password, 'Berhasil',
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

  // ═══════════════════════════════════════════════════════════
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
        <div className="space-y-4">

          {/* Mass password reset — FIXED */}
          <div className="card border-red-100 bg-red-50/30 space-y-3">
            <h3 className="font-semibold text-red-800 flex items-center gap-2 text-sm">
              <KeyRound size={15}/> Reset Password Massal
            </h3>
            <p className="text-xs text-red-700">
              Reset password semua anggota sekaligus. Cocok untuk deployment pertama kali.
              Setiap anggota wajib mengganti password saat login berikutnya.
              Password di-generate server-side dalam <strong>satu request</strong> — tidak lagi satu-per-satu.
            </p>

            {/* Edge function status banner */}
            <EdgeFunctionStatus status={edgeFnStatus}/>

            {/* Progress bar saat proses berjalan */}
            {massLoading && massProgress && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Memproses {massProgress.total} anggota...</span>
                  <span>{massProgress.done}/{massProgress.total}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-brand-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${massProgress.total ? (massProgress.done / massProgress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-3 flex-wrap items-center">
              <button
                onClick={massResetAllPasswords}
                disabled={massLoading}
                className="btn-danger gap-2 transition-all hover:scale-105 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100">
                <KeyRound size={15}/>
                {massLoading
                  ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/> Memproses...</>
                  : `🔑 Reset Semua (${users.filter(u => u.status === 'Active').length} anggota aktif)`
                }
              </button>

              {/* Hasil summary + tombol download — hanya muncul jika ada sukses */}
              {massResults.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-500">
                    ✅ {massResults.filter(r => r.ok).length} berhasil
                    {massResults.filter(r => !r.ok).length > 0 && (
                      <> · ❌ {massResults.filter(r => !r.ok).length} gagal</>
                    )}
                  </span>
                  {massResults.some(r => r.ok) && (
                    <button onClick={() => downloadMassResetCSV(massResults)}
                      className="btn-outline btn-sm gap-1 text-xs transition-all hover:scale-105">
                      📥 Unduh CSV (yang berhasil)
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Hasil tabel */}
            {massResults.length > 0 && (
              <div className="overflow-x-auto max-h-64 border border-red-100 rounded-xl">
                <table className="tbl text-xs">
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Username</th>
                      <th>Password Baru</th>
                      <th>HP Ortu</th>
                      <th>WA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {massResults.map((r, i) => (
                      <tr key={i} className={r.ok ? '' : 'bg-red-50'}>
                        <td className="font-medium">{r.user.nama_panggilan}</td>
                        <td className="font-mono text-gray-600">{r.user.nickname}</td>
                        <td>
                          {r.ok
                            ? <code className="bg-gray-100 px-2 py-0.5 rounded font-bold text-brand-800">{r.password}</code>
                            : <span className="text-red-500">❌ {r.error}</span>
                          }
                        </td>
                        <td className="text-gray-500">{r.user.hp_ortu || r.user.hp_anak || '—'}</td>
                        <td>
                          {r.ok && (r.user.hp_ortu || r.user.hp_anak) && (
                            <button
                              onClick={() => openWA(r.user, r.password)}
                              className="btn-primary btn-sm gap-1 text-xs transition-all hover:scale-105 active:scale-95">
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

          {/* Daftar user + role */}
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

      {/* Passwords tab */}
      {tab === 'passwords' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-blue-800">📤 Generate & Kirim Password via WhatsApp</p>
            <p className="text-xs text-blue-700 mt-1">
              Generate password otomatis untuk semua anggota yang <strong>wajib ganti password</strong>,
              lalu kirim ke nomor HP orang tua masing-masing via WA.
            </p>
          </div>

          {/* Edge function status banner untuk tab passwords */}
          <EdgeFunctionStatus status={edgeFnStatus}/>

          <div className="flex gap-3 flex-wrap items-center">
            <button onClick={generateBulkPasswords} disabled={loadingPw} className="btn-primary gap-2">
              <KeyRound size={16}/>
              {loadingPw
                ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/> Generating...</>
                : 'Generate Password Semua'
              }
            </button>
            {genResults.length > 0 && (
              <span className="text-xs text-gray-500">{genResults.filter(r => !r.error).length} password digenerate</span>
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
                          {r.error
                            ? <span className="text-red-500 text-xs">❌ {r.error}</span>
                            : <code className="bg-gray-100 px-2 py-0.5 rounded text-sm font-mono font-bold text-brand-800">{r.password}</code>
                          }
                        </td>
                        <td className="text-xs text-gray-500">{r.user.hp_ortu || r.user.hp_anak || '—'}</td>
                        <td>
                          <div className="flex gap-1.5 flex-wrap">
                            {!r.error && (r.user.hp_ortu || r.user.hp_anak) ? (
                              <button onClick={() => openWA(r.user, r.password)}
                                className="btn-primary btn-sm gap-1 text-xs">
                                <MessageCircle size={13}/> WA
                              </button>
                            ) : (
                              !r.error && <span className="text-xs text-orange-400">No HP</span>
                            )}
                            {!r.error && (
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(`username: ${r.user.nickname}\npassword: ${r.password}`);
                                  toast.success(`Disalin! User: ${r.user.nickname}`);
                                }}
                                className="btn-outline btn-sm text-xs">
                                Salin
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

          {/* Quick Test Reset */}
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
                const { data, error } = await supabase.functions.invoke('admin-reset-password', {
                  body: { mode: 'reset', user_id: userId, new_password: pw }
                });
                if (error) return { ok: false, error: `Koneksi gagal: ${error.message}` };
                if (data?.ok === false) return { ok: false, error: data.error };
                return { ok: true };
              }}
            />
          </div>

          {/* Daftar semua anggota aktif */}
          <div className="card overflow-hidden p-0">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-700">Semua Anggota Aktif</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {pwUsers.filter(u => u.must_change_password).length} perlu ganti password ·{' '}
                {pwUsers.filter(u => !u.hp_ortu && !u.hp_anak).length} tanpa nomor HP
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
