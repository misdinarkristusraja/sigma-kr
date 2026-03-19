import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Gunakan RPC get_my_profile() — SECURITY DEFINER, bypass RLS, tidak ada timing issue
  const fetchProfile = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_my_profile');

      if (error) {
        console.error('fetchProfile RPC error:', error.message);
        return;
      }
      if (!data) {
        console.warn('get_my_profile() return null — user belum ada di tabel users');
        return;
      }
      setProfile(data);
    } catch (err) {
      console.error('fetchProfile exception:', err);
    }
  }, []);

  useEffect(() => {
    // Load session awal
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchProfile();
      }
      setLoading(false);
    });

    // Listen perubahan auth state
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        // Delay kecil biar JWT ter-attach dulu
        setTimeout(() => fetchProfile(), 100);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  async function signIn(emailOrNickname, password) {
    let email = emailOrNickname.trim();

    // Jika input bukan email, cari email dari nickname
    if (!email.includes('@')) {
      const { data } = await supabase.rpc('get_email_by_nickname', { p_nickname: email.toLowerCase() });
      if (!data) throw new Error('Username tidak ditemukan');
      email = data;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    // Tunggu sebentar lalu fetch profile
    await new Promise(r => setTimeout(r, 200));
    await fetchProfile();
    return data;
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }

  const role = profile?.role ?? null;
  const isAdmin     = role === 'Administrator';
  const isPengurus  = ['Administrator', 'Pengurus'].includes(role);
  const isPelatih   = ['Administrator', 'Pengurus', 'Pelatih'].includes(role);
  const canScan     = isPelatih;
  const canSchedule = isPengurus;

  function hasRole(...roles) { return roles.includes(role); }

  return (
    <AuthContext.Provider value={{
      user, profile, loading,
      signIn, signOut, fetchProfile,
      isAdmin, isPengurus, isPelatih, canScan, canSchedule, hasRole, role,
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
