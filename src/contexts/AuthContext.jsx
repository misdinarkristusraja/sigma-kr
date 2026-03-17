import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);   // Supabase auth user
  const [profile, setProfile] = useState(null);   // users table row
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (uid) => {
    if (!uid) { setProfile(null); return; }
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', uid)
      .single();
    if (error) { console.error('fetchProfile:', error); return; }
    setProfile(data);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else setProfile(null);
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  // ── Sign in ──────────────────────────────────────────────
  async function signIn(emailOrNickname, password) {
    let email = emailOrNickname;
    // Jika bukan format email, cari email dari nickname
    if (!email.includes('@')) {
      const { data } = await supabase
        .from('users')
        .select('email')
        .eq('nickname', emailOrNickname.toLowerCase())
        .single();
      if (!data?.email) throw new Error('Username tidak ditemukan');
      email = data.email;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await fetchProfile(data.user.id);
    return data;
  }

  // ── Sign out ─────────────────────────────────────────────
  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }

  // ── Role helpers ─────────────────────────────────────────
  const isAdmin    = profile?.role === 'Administrator';
  const isPengurus = ['Administrator', 'Pengurus'].includes(profile?.role);
  const isPelatih  = ['Administrator', 'Pengurus', 'Pelatih'].includes(profile?.role);
  const canScan    = isPelatih;
  const canSchedule= isPengurus;

  function hasRole(...roles) {
    return roles.includes(profile?.role);
  }

  const value = {
    user, profile, loading,
    signIn, signOut, fetchProfile,
    isAdmin, isPengurus, isPelatih, canScan, canSchedule,
    hasRole,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai dalam AuthProvider');
  return ctx;
}
