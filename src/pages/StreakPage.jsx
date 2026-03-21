import React, { useState, useEffect, useCallback } from 'react';
import { Flame, Lock, RefreshCw } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { tagDuplicateNames } from '../lib/utils';
import toast from 'react-hot-toast';

export default function StreakPage() {
  const { user, profile, isAdmin, isPengurus } = useAuth();
  const [enabled,    setEnabled]    = useState(false);
  const [myStreak,   setMyStreak]   = useState(null);
  const [myBadges,   setMyBadges]   = useState([]);
  const [allBadges,  setAllBadges]  = useState([]);
  const [leaderboard,setLeaderboard]= useState([]);
  const [loading,    setLoading]    = useState(true);
  const [recalcing,  setRecalcing]  = useState(false);
  const [tab,        setTab]        = useState('mystreak'); // 'mystreak' | 'leaderboard' | 'badges'

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Cek apakah fitur diaktifkan
      const { data: cfg } = await supabase
        .from('system_config')
        .select('value')
        .eq('key', 'streak_feature_enabled')
        .single();
      const isEnabled = cfg?.value === 'true';
      setEnabled(isEnabled || isAdmin || isPengurus); // Admin/Pengurus selalu bisa lihat

      if (!isEnabled && !isAdmin && !isPengurus) { setLoading(false); return; }

      // Ambil semua data paralel
      const [
        { data: myStr },
        { data: myBdg },
        { data: allBdg },
        { data: board },
      ] = await Promise.all([
        supabase.from('user_streaks').select('*').eq('user_id', user.id).single(),
        supabase.from('user_badges')
          .select('*, badge:streak_badges(*)')
          .eq('user_id', user.id)
          .order('diraih_pada', { ascending: false }),
        supabase.from('streak_badges').select('*').order('urutan'),
        supabase.from('user_streaks')
          .select('*, user:users(id, nama_panggilan, nickname)')
          .order('current_streak', { ascending: false })
          .limit(20),
      ]);

      setMyStreak(myStr || null);
      setMyBadges(myBdg || []);
      setAllBadges(allBdg || []);
      setLeaderboard(board || []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, [user?.id, isAdmin, isPengurus]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRecalculate = async () => {
    setRecalcing(true);
    const { data, error } = await supabase.rpc('recalculate_all_streaks');
    setRecalcing(false);
    if (error) { toast.error('Gagal recalculate'); return; }
    toast.success(data || 'Streak diperbarui');
    fetchData();
  };

  // Fitur belum diaktifkan untuk anggota biasa
  if (!loading && !enabled) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-4">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
          <Lock size={28} className="text-gray-400"/>
        </div>
        <h2 className="font-bold text-gray-700 text-lg mb-1">Fitur Segera Hadir</h2>
        <p className="text-sm text-gray-500 max-w-xs">
          Fitur Streak & Gamifikasi akan diluncurkan pertengahan April.
          Terus hadir dan kumpulkan streak kamu!
        </p>
      </div>
    );
  }

  if (loading) return <div className="card py-12 text-center text-gray-400">Memuat…</div>;

  const myEarnedIds = new Set(myBadges.map(b => b.badge_id));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Flame size={22} className="text-orange-500"/> Streak & Gamifikasi
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Hadir terus-menerus untuk membangun streak dan meraih badge!
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(isAdmin || isPengurus) && (
            <button onClick={handleRecalculate} disabled={recalcing}
              className="btn-outline btn-sm gap-1.5">
              <RefreshCw size={14} className={recalcing ? 'animate-spin' : ''}/>
              {recalcing ? 'Menghitung…' : 'Hitung Ulang'}
            </button>
          )}
          {(isAdmin || isPengurus) && !enabled && (
            <span className="badge badge-yellow">Preview Admin</span>
          )}
        </div>
      </div>

      {/* My Streak Hero Card */}
      <div className="rounded-2xl overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #7f0000 0%, #b91c1c 100%)' }}>
        <div className="px-5 py-6 text-white">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-red-200 text-sm font-medium mb-1">Streak Kamu Saat Ini</p>
              <div className="flex items-end gap-2">
                <span className="text-5xl font-black">
                  {myStreak?.current_streak ?? 0}
                </span>
                <span className="text-red-200 text-lg mb-1">minggu</span>
              </div>
              {myStreak?.last_attended_date && (
                <p className="text-red-200 text-xs mt-1">
                  Terakhir hadir: {format(parseISO(myStreak.last_attended_date), 'd MMMM yyyy', { locale: localeId })}
                </p>
              )}
            </div>
            <div className="text-6xl">🔥</div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-3 mt-5">
            {[
              { label: 'Streak Terpanjang', value: myStreak?.longest_streak ?? 0, suffix: 'mgg' },
              { label: 'Total Hadir Wajib', value: myStreak?.total_hadir_wajib ?? 0, suffix: 'kali' },
              { label: 'Badge Diraih',      value: myBadges.length, suffix: '' },
            ].map(s => (
              <div key={s.label} className="bg-white/15 rounded-xl px-3 py-2.5 text-center">
                <p className="text-white text-xl font-bold">{s.value}<span className="text-red-200 text-sm ml-1">{s.suffix}</span></p>
                <p className="text-red-200 text-[11px] mt-0.5 leading-tight">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-gray-100 rounded-xl p-1 flex gap-1">
        {[
          { key: 'mystreak',    label: 'Badge Saya' },
          { key: 'leaderboard', label: '🏆 Leaderboard' },
          { key: 'badges',      label: 'Semua Badge' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors
              ${tab === t.key ? 'bg-white text-brand-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Badge Saya */}
      {tab === 'mystreak' && (
        <div className="space-y-3">
          {/* Badge earned */}
          {myBadges.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-700 text-sm mb-2">Badge yang sudah diraih ✅</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {myBadges.map(ub => (
                  <BadgeCard key={ub.id} badge={ub.badge} earned diraih={ub.diraih_pada}/>
                ))}
              </div>
            </div>
          )}
          {/* Badge belum diraih */}
          <div>
            <h3 className="font-semibold text-gray-700 text-sm mb-2">
              {myBadges.length > 0 ? 'Badge berikutnya 🎯' : 'Badge yang bisa kamu raih 🎯'}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {allBadges.filter(b => !myEarnedIds.has(b.id)).map(b => {
                const progress = b.syarat_type === 'streak'
                  ? myStreak?.longest_streak ?? 0
                  : myStreak?.total_hadir_wajib ?? 0;
                return (
                  <BadgeCard key={b.id} badge={b} earned={false}
                    progress={progress} target={b.syarat_nilai}/>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Leaderboard */}
      {tab === 'leaderboard' && (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <h3 className="font-semibold text-gray-700 text-sm">Streak Aktif Tertinggi</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {leaderboard.map((row, i) => {
              const isMe = row.user_id === user?.id;
              return (
                <div key={row.id}
                  className={`flex items-center gap-3 px-4 py-3 ${isMe ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0
                    ${i===0?'bg-yellow-100 text-yellow-700':i===1?'bg-gray-200 text-gray-600':i===2?'bg-orange-100 text-orange-600':'bg-gray-100 text-gray-500'}`}>
                    {i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${isMe ? 'text-brand-800' : 'text-gray-800'}`}>
                      {row.user?.nama_panggilan || row.user?.nickname}
                      {isMe && <span className="ml-1 text-[11px] badge badge-red">Kamu</span>}
                    </p>
                    <p className="text-xs text-gray-500">
                      Total hadir: {row.total_hadir_wajib} kali
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-black text-brand-800">{row.current_streak}</p>
                    <p className="text-[10px] text-gray-400">minggu</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab: Semua Badge */}
      {tab === 'badges' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {allBadges.map(b => (
            <BadgeCard key={b.id} badge={b}
              earned={myEarnedIds.has(b.id)}
              progress={b.syarat_type==='streak' ? (myStreak?.longest_streak??0) : (myStreak?.total_hadir_wajib??0)}
              target={b.syarat_nilai}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Badge Card ────────────────────────────────────────────────────
function BadgeCard({ badge, earned, diraih, progress = 0, target }) {
  const pct = target ? Math.min(100, Math.round(progress * 100 / target)) : 0;
  return (
    <div className={`rounded-2xl p-3 border-2 text-center transition-all
      ${earned
        ? `${badge.warna_bg || 'bg-yellow-50'} border-yellow-200`
        : 'bg-gray-50 border-gray-200 opacity-60'}`}>
      <div className="text-3xl mb-1.5">{badge.icon || '🏅'}</div>
      <p className={`text-xs font-bold leading-tight ${earned ? (badge.warna_text || 'text-yellow-800') : 'text-gray-500'}`}>
        {badge.nama}
      </p>
      <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{badge.deskripsi}</p>
      {!earned && target && (
        <div className="mt-2">
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-brand-700 rounded-full transition-all"
              style={{ width: `${pct}%` }}/>
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5">{progress}/{target}</p>
        </div>
      )}
      {earned && diraih && (
        <p className="text-[10px] text-gray-400 mt-1">
          {format(new Date(diraih), 'd MMM yyyy', { locale: localeId })}
        </p>
      )}
    </div>
  );
}
