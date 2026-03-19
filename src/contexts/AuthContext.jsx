import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (uid) => {
    if (!uid) { setProfile(null); return; }
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', uid)
        .maybeSingle();  // pakai maybeSingle agar tidak throw jika kosong

      if (error) {
        console.error('fetchProfile error:', error.message);
        // Jangan set null — biarkan user tetap login, tampilkan peringatan
        toast.error('Profil tidak ditemukan. Hubungi administrator.');
        return;
      }
      if (!data) {
        console.warn('fetchProfile: user ada di Auth tapi tidak ada di tabel users. UID:', uid);
        toast.error('Data profil belum dibuat. Minta admin jalankan SQL insert users.');
        return;
      }
      setProfile(data);
    } catch (err) {
      console.error('fetchProfile exception:', err);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  async function signIn(emailOrNickname, password) {
    let email = emailOrNickname.trim();
    if (!email.includes('@')) {
      const { data } = await supabase
        .from('users')
        .select('email')
        .eq('nickname', email.toLowerCase())
        .maybeSingle();
      if (!data?.email) throw new Error('Username tidak ditemukan');
      email = data.email;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await fetchProfile(data.user.id);
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
  const canSchedule= isPengurus;

  function hasRole(...roles) {
    return roles.includes(role);
  }

  return (
    <AuthContext.Provider value={{
      user, profile, loading,
      signIn, signOut, fetchProfile,
      isAdmin, isPengurus, isPelatih, canScan, canSchedule, hasRole,
      role,
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
