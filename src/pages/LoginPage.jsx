import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Eye, EyeOff, Church, LogIn } from 'lucide-react';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const { signIn }  = useAuth();
  const navigate    = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username.trim() || !password) {
      toast.error('Username dan password wajib diisi');
      return;
    }
    setLoading(true);
    try {
      await signIn(username.trim(), password);
      toast.success('Selamat datang kembali! 🙏');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.message || 'Login gagal. Cek kembali username/password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-800 via-brand-900 to-brand-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex w-20 h-20 bg-white/15 backdrop-blur rounded-3xl items-center justify-center mb-4 shadow-2xl">
            <Church size={36} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">SIGMA</h1>
          <p className="text-brand-200 text-sm mt-1">Sistem Informasi Penjadwalan & Manajemen Misdinar</p>
          <p className="text-brand-300 text-xs mt-0.5">Paroki Kristus Raja Solo Baru</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-6">
          <h2 className="font-bold text-gray-900 text-lg mb-5">Masuk ke SIGMA</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Username</label>
              <input
                type="text"
                className="input"
                placeholder="Contoh: satrio"
                value={username}
                onChange={e => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
                autoComplete="username"
                autoFocus
                disabled={loading}
              />
              <p className="text-xs text-gray-400 mt-1">Gunakan nama panggilan / username kamu</p>
            </div>

            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="Masukkan password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={loading}
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" tabIndex={-1}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn-primary w-full btn-lg" disabled={loading}>
              {loading
                ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Masuk...</>
                : <><LogIn size={18} /> Masuk</>
              }
            </button>
          </form>

          <div className="mt-4 text-center">
            <p className="text-xs text-gray-500">
              Belum terdaftar?{' '}
              <Link to="/daftar" className="text-brand-800 font-semibold hover:underline">Daftar di sini</Link>
            </p>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100">
            <Link to="/jadwal" className="text-xs text-gray-400 hover:text-gray-600 flex items-center justify-center gap-1">
              Lihat Jadwal Publik →
            </Link>
          </div>
        </div>

        <p className="text-center text-brand-300/60 text-xs mt-6 italic">"Serve the Lord with Gladness"</p>
      </div>
    </div>
  </div>
  );
}
