import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Flame, ChevronRight, Lock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

// ── Komponen utama — tampil di Dashboard ───────────────────────────────
export default function StreakWidget() {
  const { user, isAdmin, isPengurus } = useAuth();
  const [streak,  setStreak]  = useState(null);
  const [badges,  setBadges]  = useState([]);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data: cfg } = await supabase
        .from('system_config').select('value')
        .eq('key', 'streak_feature_enabled').single();
      const on = cfg?.value === 'true' || isAdmin || isPengurus;
      setEnabled(on);
      if (!on) { setLoading(false); return; }

      const [{ data: s }, { data: b }] = await Promise.all([
        supabase.from('user_streaks').select('*').eq('user_id', user.id).single(),
        supabase.from('user_badges')
          .select('badge:streak_badges(icon, nama, warna_bg, warna_text)')
          .eq('user_id', user.id)
          .order('diraih_pada', { ascending: false })
          .limit(4),
      ]);
      setStreak(s || null);
      setBadges((b || []).map(x => x.badge).filter(Boolean));
      setLoading(false);
    })();
  }, [user?.id, isAdmin, isPengurus]);

  if (loading) return null;

  // Belum aktif — teaser kecil
  if (!enabled) {
    return (
      <div className="card bg-gradient-to-r from-gray-50 to-gray-100 border-dashed border-2 border-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gray-200 flex items-center justify-center">
            <Lock size={18} className="text-gray-400"/>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-600">Streak & Badge</p>
            <p className="text-xs text-gray-400">Akan hadir pertengahan April 🔥</p>
          </div>
        </div>
      </div>
    );
  }

  const cur     = streak?.current_streak    ?? 0;
  const longest = streak?.longest_streak   ?? 0;
  const total   = streak?.total_hadir_wajib ?? 0;
  const isHot   = cur >= 4;
  const isMid   = cur >= 2;

  const flameColor = cur === 0 ? '#d1d5db'
    : isHot ? '#f97316' : isMid ? '#fb923c' : '#fbbf24';

  // Progress ke milestone berikutnya
  const MILESTONES = [2, 4, 8, 12, 26];
  const nextM = MILESTONES.find(m => m > cur) || 26;
  const prevM = MILESTONES.filter(m => m <= cur).pop() || 0;
  const pct   = nextM > prevM
    ? Math.min(100, Math.round((cur - prevM) / (nextM - prevM) * 100)) : 100;

  return (
    <Link to="/streak" className="block group">
      <div className={`card overflow-hidden transition-all duration-200
        group-hover:shadow-md group-hover:-translate-y-0.5 border
        ${isHot
          ? 'border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50'
          : 'border-gray-100 bg-white'}`}>

        {/* Row header */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-bold text-gray-700">Streak Saya</span>
          <ChevronRight size={15} className="text-gray-400 group-hover:text-brand-700 transition-colors"/>
        </div>

        {/* Flame + number */}
        <div className="flex items-center gap-4 mb-3">
          <div className="relative flex-shrink-0">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center
              ${isHot ? 'bg-orange-100' : isMid ? 'bg-amber-50' : 'bg-gray-100'}`}>
              <Flame size={36} style={{ color: flameColor }}
                className={isHot ? 'drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]' : ''}/>
            </div>
            {cur > 0 && (
              <div className={`absolute -bottom-1 -right-1 min-w-[22px] h-[22px] rounded-full
                text-white text-[11px] font-black flex items-center justify-center px-1
                ${isHot ? 'bg-orange-500' : 'bg-amber-400'}`}>
                {cur}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-2xl font-black leading-none
              ${isHot ? 'text-orange-600' : cur > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
              {cur}
              <span className={`text-sm font-medium ml-1
                ${isHot ? 'text-orange-400' : 'text-gray-400'}`}>minggu</span>
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {cur === 0 ? 'Mulai streak-mu sekarang!'
               : isHot ? '🔥 Kamu lagi on fire!'
               : `${nextM - cur} lagi ke ${nextM} minggu`}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        {cur > 0 && cur < 26 && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-gray-400">Menuju {nextM} minggu</span>
              <span className="text-[10px] font-semibold text-gray-500">{cur}/{nextM}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-700
                ${isHot ? 'bg-orange-400' : 'bg-amber-400'}`}
                style={{ width: `${pct}%` }}/>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-3 pt-2.5 border-t border-gray-100/60">
          {[
            { label: 'Terpanjang', value: longest, suffix: 'mgg' },
            { label: 'Total Hadir', value: total, suffix: 'kali' },
            { label: 'Badge', value: badges.length, suffix: '' },
          ].map((s, i, arr) => (
            <React.Fragment key={s.label}>
              <div className="flex-1 text-center">
                <p className="text-sm font-bold text-gray-700">{s.value}
                  <span className="text-[10px] text-gray-400 ml-0.5">{s.suffix}</span>
                </p>
                <p className="text-[10px] text-gray-400">{s.label}</p>
              </div>
              {i < arr.length - 1 && <div className="w-px h-6 bg-gray-100"/>}
            </React.Fragment>
          ))}
        </div>

        {/* Badge row */}
        {badges.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-gray-100/60">
            {badges.slice(0, 4).map((b, i) => (
              <span key={i} title={b.nama}
                className={`w-8 h-8 rounded-xl flex items-center justify-center text-base
                  ${b.warna_bg || 'bg-yellow-100'}`}>
                {b.icon || '🏅'}
              </span>
            ))}
            {badges.length > 4 && (
              <span className="text-xs text-gray-400 ml-1">+{badges.length - 4}</span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}

// ── Versi untuk MemberDetailPage (admin bisa lihat streak member) ──────
export function StreakMiniCard({ userId }) {
  const [streak, setStreak] = useState(null);
  const [badges, setBadges] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    Promise.all([
      supabase.from('user_streaks').select('*').eq('user_id', userId).single(),
      supabase.from('user_badges')
        .select('badge:streak_badges(icon, nama, warna_bg, warna_text)')
        .eq('user_id', userId)
        .order('diraih_pada', { ascending: false }),
    ]).then(([{ data: s }, { data: b }]) => {
      setStreak(s || null);
      setBadges((b || []).map(x => x.badge).filter(Boolean));
      setLoading(false);
    });
  }, [userId]);

  if (loading) return (
    <div className="card animate-pulse h-32 bg-gray-100"/>
  );

  const cur    = streak?.current_streak    ?? 0;
  const longest= streak?.longest_streak   ?? 0;
  const total  = streak?.total_hadir_wajib ?? 0;
  const broken = streak?.streak_broken_count ?? 0;
  const isHot  = cur >= 4;

  return (
    <div className="card">
      <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2 text-sm">
        <Flame size={16} className="text-orange-500"/> Streak & Gamifikasi
      </h3>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          { label: 'Streak Aktif',  value: cur,    color: isHot?'text-orange-600':cur>0?'text-amber-600':'text-gray-400' },
          { label: 'Terpanjang',    value: longest, color: 'text-gray-700' },
          { label: 'Total Hadir',   value: total,   color: 'text-brand-800' },
          { label: 'Streak Putus',  value: broken,  color: 'text-gray-500' },
        ].map(s => (
          <div key={s.label} className="bg-gray-50 rounded-xl p-2 text-center">
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Flame visual */}
      <div className={`flex items-center gap-3 p-3 rounded-xl mb-3 border
        ${isHot ? 'bg-orange-50 border-orange-100' : 'bg-gray-50 border-gray-100'}`}>
        <Flame size={26} style={{ color: cur===0?'#d1d5db':isHot?'#f97316':'#fbbf24' }}/>
        <div>
          <p className="text-sm font-bold text-gray-800">
            {cur === 0 ? 'Belum ada streak aktif'
             : cur >= 8 ? `🔥 ${cur} minggu — Luar biasa!`
             : cur >= 4 ? `🔥 ${cur} minggu — On fire!`
             : `${cur} minggu streak aktif`}
          </p>
          <p className="text-xs text-gray-500">
            {streak?.last_attended_date
              ? `Terakhir hadir: ${new Date(streak.last_attended_date).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'})}`
              : 'Belum ada data kehadiran wajib'}
          </p>
        </div>
      </div>

      {/* Badges */}
      {badges.length > 0 ? (
        <div>
          <p className="text-xs text-gray-500 mb-2 font-medium">Badge diraih ({badges.length})</p>
          <div className="flex flex-wrap gap-2">
            {badges.map((b, i) => (
              <span key={i}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium
                  ${b.warna_bg || 'bg-yellow-100'} ${b.warna_text || 'text-yellow-800'}`}>
                <span className="text-base">{b.icon}</span> {b.nama}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-400 text-center py-1">Belum ada badge diraih</p>
      )}
    </div>
  );
}
