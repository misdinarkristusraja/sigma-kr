import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,         setUser]         = useState(null);
  const [profile,      setProfile]      = useState(null);
  const [loading,      setLoading]      = useState(true);
  // FIX BUG-006: tambahkan state profileError yang jelas.
  // Sebelumnya, semua jalur error (RPC gagal / data null) menggunakan fallback
  // { role: 'Misdinar_Aktif' } — ini berbahaya karena akun Pending bisa mendapat
  // akses seolah-olah sudah diapprove jika ada gangguan koneksi sementara.
  // Sekarang: error → profileError=true, profile=null.
  // ProtectedRoute di App.jsx menangani kondisi ini dengan pesan informatif.
  const [profileError, setProfileError] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_my_profile');

      if (error) {
        console.error('fetchProfile RPC error:', error.message);
        // Jangan beri role default — set error state agar UI menampilkan pesan jelas
        setProfileError(true);
        setProfile(null);
        return;
      }

      if (data) {
        setProfileError(false);
        setProfile(data);
      } else {
        // Profil tidak ditemukan: akun mungkin belum diapprove (status Pending)
        // atau ada masalah RLS. Jangan grant akses default.
        console.warn('fetchProfile: profil tidak ditemukan (akun mungkin belum diapprove)');
        setProfileError(true);
        setProfile(null);
      }
    } catch (err) {
      console.error('fetchProfile exception:', err);
      setProfileError(true);
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) await fetchProfile();
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        // Delay singkat (150ms) dipertahankan untuk memberi waktu Supabase Auth
        // menyelesaikan sinkronisasi session sebelum memanggil RPC get_my_profile.
        // Tanpa ini, RPC kadang dipanggil sebelum JWT ter-propagate ke DB,
        // menyebabkan RLS gagal dan profile null.
        setTimeout(() => fetchProfile(), 150);
      } else {
        setProfile(null);
        setProfileError(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  // Login dengan USERNAME saja (bukan email)
  async function signIn(username, password) {
    // 1. Cari email dari nickname via RPC (SECURITY DEFINER — bypass RLS)
    const { data: email, error: lookupErr } = await supabase.rpc('get_email_by_nickname', {
      p_nickname: username.toLowerCase().trim(),
    });

    if (lookupErr || !email) {
      throw new Error(`Username "${username}" tidak ditemukan di SIGMA`);
    }

    // 2. Login dengan email yang ditemukan
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    // Set state user secara sinkronus agar router/context segera ter-update
    if (data.session?.user) {
      setUser(data.session.user);
    }

    // 3. Fetch profile — onAuthStateChange juga akan memanggil fetchProfile,
    // tapi kita panggil di sini juga agar UI login langsung responsif.
    await fetchProfile();
    return data;
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setProfileError(false);
  }

  const role       = profile?.role ?? null;
  const isAdmin    = role === 'Administrator';
  const isPengurus = ['Administrator', 'Pengurus'].includes(role);
  const isPelatih  = ['Administrator', 'Pengurus', 'Pelatih'].includes(role);
  const canScan    = isPelatih;

  function hasRole(...roles) { return roles.includes(role); }

  return (
    <AuthContext.Provider value={{
      user, profile, loading, profileError,
      signIn, signOut, fetchProfile,
      isAdmin, isPengurus, isPelatih, canScan, role, hasRole,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai dalam AuthProvider');
  return ctx;
}
