import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Flame, Trophy, Star, Lock } from 'lucide-react';
import toast from 'react-hot-toast';

const PUBLISH_DATE = new Date('2026-04-15');
const IS_PUBLISHED = new Date() >= PUBLISH_DATE;

function StreakBadge({ streak }) {
  if (streak >= 20) return { label: '🏆 Legenda', color: 'text-yellow-600 bg-yellow-50', desc: '20+ minggu berturut-turut' };
  if (streak >= 12) return { label: '💎 Master',  color: 'text-blue-600 bg-blue-50',    desc: '12+ minggu' };
  if (streak >= 8)  return { label: '🔥 Pro',     color: 'text-orange-600 bg-orange-50', desc: '8+ minggu' };
  if (streak >= 4)  return { label: '⭐ Aktif',   color: 'text-green-600 bg-green-50',  desc: '4+ minggu' };
  if (streak >= 1)  return { label: '🌱 Mulai',   color: 'text-teal-600 bg-teal-50',   desc: '1-3 minggu' };
  return                    { label: '💤 Belum',   color: 'text-gray-400 bg-gray-50',   desc: 'Belum ada streak' };
}

export default function StreakPage() {
  const { profile, isPengurus } = useAuth();
  const [myStreak,     setMyStreak]     = useState(null);
  const [leaderboard,  setLeaderboard]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [recalcLoading,setRecalcLoad]   = useState(false);

  useEffect(() => {
    if (profile?.id) loadData();
  }, [profile?.id]);

  async function loadData() {
    setLoading(true);
    const [{ data: myStr }, { data: lb }] = await Promise.all([
      supabase.from('streaks').select('*').eq('user_id', profile.id).maybeSingle(),
      supabase.from('streaks')
        .select('*, users(nama_panggilan, lingkungan, nickname)')
        .eq('is_published', true)
        .order('current_streak', { ascending: false })
        .limit(20),
    ]);
    setMyStreak(myStr);
    setLeaderboard(lb || []);
    setLoading(false);
  }

  async function recalculate() {
    setRecalcLoad(true);
    const { error } = await supabase.rpc('recalculate_streaks');
    if (error) { toast.error('Gagal: ' + error.message); }
    else { toast.success('Streak berhasil dihitung ulang!'); await loadData(); }
    setRecalcLoad(false);
  }

  async function togglePublish() {
    const newVal = !myStreak?.is_published;
    await supabase.from('streaks').upsert({
      user_id: profile.id,
      is_published: newVal,
      current_streak: myStreak?.current_streak || 0,
      longest_streak: myStreak?.longest_streak || 0,
    }, { onConflict: 'user_id' });
    await loadData();
    toast.success(newVal ? 'Streak dipublikasikan!' : 'Streak disembunyikan');
  }

  const badge = StreakBadge({ streak: myStreak?.current_streak || 0 });

  // Hidden until publish date — admin can see
  if (!IS_PUBLISHED && !isPengurus) {
    return (
      <div className="card text-center py-16 space-y-3">
        <Lock size={48} className="mx-auto text-gray-300"/>
        <h2 className="font-bold text-xl text-gray-700">Fitur Segera Hadir</h2>
        <p className="text-gray-400 text-sm">
          Sistem gamifikasi streak akan diluncurkan pada <strong>15 April 2026</strong> 🎉
        </p>
        <p className="text-xs text-gray-300">Terus semangat hadir tugas & latihan!</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">🔥 Streak & Gamifikasi</h1>
          <p className="page-subtitle">Hadir tugas + latihan tanpa bolong = streak makin panjang!</p>
        </div>
        {!IS_PUBLISHED && isPengurus && (
          <span className="badge-yellow text-xs px-3 py-1">Preview — Publish 15 April 2026</span>
        )}
        {isPengurus && (
          <button onClick={recalculate} disabled={recalcLoading}
            className="btn-outline gap-2 text-sm transition-all hover:scale-105 active:scale-95">
            <Flame size={15}/> {recalcLoading ? 'Menghitung...' : 'Hitung Ulang Semua'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 gap-4">
          {[1,2].map(i => <div key={i} className="skeleton h-40 rounded-2xl"/>)}
        </div>
      ) : (
        <>
          {/* My streak card */}
          <div className="card bg-gradient-to-br from-orange-50 to-amber-50 border-orange-200 border">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-600 mb-1">Streak Saya</p>
                <div className="flex items-end gap-3">
                  <div className="text-5xl font-black text-orange-600">
                    {myStreak?.current_streak || 0}
                  </div>
                  <div className="pb-1">
                    <p className="text-sm font-semibold text-gray-700">minggu berturut-turut</p>
                    <p className="text-xs text-gray-500">Terpanjang: {myStreak?.longest_streak || 0} minggu</p>
                  </div>
                </div>
                <div className={`inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full text-sm font-bold ${badge.color}`}>
                  <span>{badge.label}</span>
                  <span className="text-xs font-normal opacity-70">· {badge.desc}</span>
                </div>
              </div>
              <div className="flex-shrink-0">
                <Flame size={64} className={`${(myStreak?.current_streak||0) > 0 ? 'text-orange-400' : 'text-gray-200'}`}/>
              </div>
            </div>

            {myStreak?.last_k1_week && (
              <p className="text-xs text-gray-400 mt-3">
                Terakhir hadir: minggu {new Date(myStreak.last_k1_week).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'})}
              </p>
            )}

            {!myStreak?.current_streak && (
              <div className="mt-3 p-3 bg-orange-100/50 rounded-xl text-xs text-orange-700">
                💡 Hadiri tugas + latihan minggu ini untuk memulai streak pertamamu!
                Streak dihitung otomatis dari data rekap.
              </div>
            )}

            <div className="mt-3 flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={myStreak?.is_published||false} onChange={togglePublish}
                  className="w-4 h-4 accent-orange-500"/>
                <span className="text-xs text-gray-600">Tampilkan di papan peringkat</span>
              </label>
            </div>
          </div>

          {/* How streak works */}
          <div className="card bg-gray-50 space-y-2">
            <h3 className="font-semibold text-gray-700 text-sm">📋 Cara Streak Dihitung</h3>
            <div className="grid sm:grid-cols-2 gap-2 text-xs text-gray-600">
              <div className="bg-white rounded-xl p-3">
                <p className="font-semibold text-green-700">✅ Menambah streak:</p>
                <p>K1 (Hadir Tugas + Latihan) atau K3 (Hadir Tugas) tiap minggu berturut-turut</p>
              </div>
              <div className="bg-white rounded-xl p-3">
                <p className="font-semibold text-red-700">❌ Memutus streak:</p>
                <p>Melewatkan 1 minggu tanpa hadir tugas (K5, K6, atau tidak dijadwalkan)</p>
              </div>
              <div className="bg-white rounded-xl p-3">
                <p className="font-semibold text-blue-700">🔄 Kapan dihitung:</p>
                <p>Otomatis diperbarui setelah Pengurus klik "Hitung Ulang Semua"</p>
              </div>
              <div className="bg-white rounded-xl p-3">
                <p className="font-semibold text-purple-700">🏆 Badge tier:</p>
                <p>1+ Mulai · 4+ Aktif · 8+ Pro · 12+ Master · 20+ Legenda</p>
              </div>
            </div>
          </div>

          {/* Leaderboard */}
          {leaderboard.length > 0 && (
            <div className="card overflow-hidden p-0">
              <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="font-semibold text-gray-700">🏆 Papan Streak Terpanjang</h3>
              </div>
              <div className="divide-y divide-gray-50">
                {leaderboard.map((s, i) => {
                  const b = StreakBadge({ streak: s.current_streak });
                  const isMe = s.user_id === profile.id;
                  return (
                    <div key={s.id} className={`flex items-center gap-3 px-4 py-3 ${isMe ? 'bg-orange-50/50' : ''}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-sm ${
                        i===0?'bg-yellow-400 text-white':i===1?'bg-gray-300 text-gray-700':i===2?'bg-amber-600 text-white':'bg-gray-100 text-gray-500'
                      }`}>{i+1}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 text-sm">{s.users?.nama_panggilan}</p>
                        <p className="text-xs text-gray-400">{s.users?.lingkungan}</p>
                      </div>
                      <div className="text-right">
                        <p className={`font-black text-lg text-orange-600`}>{s.current_streak}🔥</p>
                        <p className={`text-[10px] font-bold ${b.color} px-1.5 py-0.5 rounded-full`}>{b.label}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
