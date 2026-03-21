import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { KeyRound, Eye, EyeOff, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ChangePasswordPage() {
  const { profile, fetchProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [newPw,   setNewPw]   = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw,  setShowPw]  = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (newPw.length < 6)  { toast.error('Password minimal 6 karakter'); return; }
    if (newPw !== confirm) { toast.error('Konfirmasi tidak cocok'); return; }

    setLoading(true);
    try {
      // Gunakan RPC change_my_password — SECURITY DEFINER, bypass "User not allowed"
      const { data, error } = await supabase.rpc('change_my_password', {
        p_new_password: newPw,
      });

      if (error) throw new Error(error.message);
      if (data?.ok === false) throw new Error(data.error || 'Gagal ganti password');

      toast.success('Password berhasil diperbarui! Login ulang dengan password baru. 🎉');

      // Logout → session lama tidak valid lagi setelah password diganti
      await signOut();
      navigate('/login');

    } catch (err) {
      toast.error(err.message || 'Gagal ganti password. Hubungi admin.');
    } finally {
      setLoading(false);
    }
  }

  const strength = [
    newPw.length >= 6,
    /[A-Z]/.test(newPw),
    /[0-9]/.test(newPw),
    /[^A-Za-z0-9]/.test(newPw),
  ];
  const strengthScore = strength.filter(Boolean).length;
  const strengthLabel = ['', 'Lemah', 'Cukup', 'Kuat', 'Sangat Kuat'][strengthScore];
  const strengthColor = ['', 'text-red-500', 'text-yellow-500', 'text-blue-500', 'text-green-500'][strengthScore];

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-800 to-brand-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-yellow-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <KeyRound size={28} className="text-yellow-600"/>
            </div>
            <h1 className="text-xl font-bold text-gray-900">Buat Password Baru</h1>
            <p className="text-sm text-gray-500 mt-1">
              Halo <strong>{profile?.nama_panggilan}</strong>!
              Admin sudah mereset password kamu. Buat password baru sekarang.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">
                Password Baru <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="Min. 6 karakter"
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  autoFocus
                  required
                />
                <button type="button" tabIndex={-1}
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPw ? <EyeOff size={16}/> : <Eye size={16}/>}
                </button>
              </div>

              {newPw && (
                <div className="mt-2 space-y-1">
                  <div className="flex gap-1">
                    {strength.map((ok, i) => (
                      <div key={i}
                        className={`h-1.5 flex-1 rounded-full transition-all ${ok ? 'bg-brand-800' : 'bg-gray-200'}`}/>
                    ))}
                  </div>
                  <p className={`text-xs font-medium ${strengthColor}`}>{strengthLabel}</p>
                </div>
              )}
            </div>

            <div>
              <label className="label">
                Konfirmasi Password <span className="text-red-500">*</span>
              </label>
              <input
                type={showPw ? 'text' : 'password'}
                className={`input ${
                  confirm && confirm !== newPw ? 'border-red-400' :
                  confirm && confirm === newPw ? 'border-green-400' : ''
                }`}
                placeholder="Ulangi password baru"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
              />
              {confirm && confirm === newPw && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  <CheckCircle size={12}/> Password cocok
                </p>
              )}
              {confirm && confirm !== newPw && (
                <p className="text-xs text-red-500 mt-1">Password tidak cocok</p>
              )}
            </div>

            <button
              type="submit"
              className="btn-primary w-full btn-lg"
              disabled={loading || newPw !== confirm || newPw.length < 6}>
              {loading
                ? <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                    Menyimpan...
                  </span>
                : 'Simpan Password Baru'
              }
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-4">
            Setelah disimpan kamu akan diminta login ulang dengan password baru.
          </p>
        </div>
      </div>
    </div>
  );
}
