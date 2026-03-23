import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    try {
      // Pastikan ada session dulu
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;

      // Coba 1: RPC get_my_profile (SECURITY DEFINER — bypass RLS, paling reliable)
      const { data: rpcData, error: rpcErr } = await supabase.rpc('get_my_profile');
      if (!rpcErr && rpcData) {
        setProfile(rpcData);
        return;
      }

      // Coba 2: Direct query (works jika RLS sudah di-setup dengan policy auth.uid() = id)
      const { data: row, error: rowErr } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (!rowErr && row) {
        setProfile(row);
        return;
      }

      // Coba 3: Maybemissing — user baru saja provision, tunggu sebentar lalu coba lagi
      console.warn('fetchProfile: kedua metode gagal. RPC error:', rpcErr?.message, '| Direct error:', rowErr?.message);
      // Jika RPC belum ada di DB, tampilkan pesan yang jelas
      if (rpcErr?.code === 'PGRST202' || rpcErr?.message?.includes('function') ) {
        console.error('PENTING: Jalankan migration 011_fix_get_my_profile.sql di Supabase SQL Editor!');
      }
    } catch (err) {
      console.error('fetchProfile exception:', err);
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
        setTimeout(() => fetchProfile(), 150);
      } else {
        setProfile(null);
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

    // 3. Fetch profile
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
  const isAdmin    = role === 'Administrator';
  const isPengurus = ['Administrator', 'Pengurus'].includes(role);
  const isPelatih  = ['Administrator', 'Pengurus', 'Pelatih'].includes(role);
  const canScan    = isPelatih;

  function hasRole(...roles) { return roles.includes(role); }

  return (
    <AuthContext.Provider value={{
      user, profile, loading,
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
