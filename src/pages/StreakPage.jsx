import React, { useState, useEffect, useCallback } from 'react';
import { Flame, Lock, RefreshCw, Search, Download, ChevronDown, ChevronUp, Trophy, Users } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { downloadCSV } from '../lib/utils';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';

export default function StreakPage() {
  const { user, isAdmin, isPengurus } = useAuth();
  const canAdmin = isAdmin || isPengurus;

  const [enabled,     setEnabled]     = useState(false);
  const [myStreak,    setMyStreak]    = useState(null);
  const [myBadges,    setMyBadges]    = useState([]);
  const [allBadges,   setAllBadges]   = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [allMembers,  setAllMembers]  = useState([]); // admin only
  const [loading,     setLoading]     = useState(true);
  const [recalcing,   setRecalcing]   = useState(false);
  const [search,      setSearch]      = useState('');
  const [sortBy,      setSortBy]      = useState('current_streak');
  const [sortDir,     setSortDir]     = useState('desc');
  const [tab, setTab] = useState('mystreak'); // mystreak | leaderboard | badges | admin

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: cfg } = await supabase
        .from('system_config').select('value')
        .eq('key', 'streak_feature_enabled').single();
      const on = cfg?.value === 'true' || canAdmin;
      setEnabled(on);
      if (!on) { setLoading(false); return; }

      const promises = [
        supabase.from('user_streaks').select('*').eq('user_id', user.id).single(),
        supabase.from('user_badges')
          .select('*, badge:streak_badges(*)')
          .eq('user_id', user.id)
          .order('diraih_pada', { ascending: false }),
        supabase.from('streak_badges').select('*').order('urutan'),
        supabase.from('user_streaks')
          .select('*, user:users(id, nama_panggilan, nickname, lingkungan)')
          .order('current_streak', { ascending: false })
          .limit(20),
      ];

      // Admin: ambil SEMUA anggota + streak mereka
      if (canAdmin) {
        promises.push(
          supabase.from('users')
            .select(`
              id, nama_panggilan, nickname, lingkungan, pendidikan, status,
              streak:user_streaks(current_streak, longest_streak, total_hadir_wajib,
                streak_broken_count, last_attended_date, updated_at),
              badges:user_badges(badge:streak_badges(kode, nama, icon))
            `)
            .in('role', ['Misdinar_Aktif', 'Misdinar_Retired'])
            .eq('status', 'Active')
            .order('nama_panggilan')
        );
      }

      const results = await Promise.all(promises);
      const [s, b, ab, board, membersRes] = results;

      setMyStreak(s.data || null);
      setMyBadges((b.data || []).map(x => x.badge ? { ...x.badge, diraih_pada: x.diraih_pada } : null).filter(Boolean));
      setAllBadges(ab.data || []);
      setLeaderboard(board.data || []);
      if (canAdmin && membersRes) {
        setAllMembers((membersRes.data || []).map(m => ({
          ...m,
          streak: Array.isArray(m.streak) ? m.streak[0] : m.streak,
          badges: m.badges || [],
        })));
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, [user?.id, canAdmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRecalc = async () => {
    setRecalcing(true);
    const { data, error } = await supabase.rpc('recalculate_all_streaks');
    setRecalcing(false);
    if (error) { toast.error('Gagal recalculate'); return; }
    toast.success(data || 'Streak diperbarui');
    fetchData();
  };

  // ── Export Excel semua streak anggota (admin) ──────────────────
  const handleExportExcel = () => {
    if (!filteredMembers.length) { toast.error('Tidak ada data'); return; }
    try {
      const rows = filteredMembers.map(m => {
        const s = m.streak;
        return {
          'Nama':              m.nama_panggilan,
          'Username':          m.nickname,
          'Lingkungan':        m.lingkungan || '',
          'Streak Aktif':      s?.current_streak    ?? 0,
          'Streak Terpanjang': s?.longest_streak    ?? 0,
          'Total Hadir Wajib': s?.total_hadir_wajib ?? 0,
          'Streak Putus':      s?.streak_broken_count ?? 0,
          'Badge':             m.badges.map(b => b.badge?.nama).filter(Boolean).join(', '),
          'Terakhir Hadir':    s?.last_attended_date
            ? format(parseISO(s.last_attended_date), 'd MMM yyyy', { locale: localeId })
            : '—',
        };
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [22, 16, 20, 12, 16, 16, 12, 32, 15].map(w => ({ wch: w }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Streak Anggota');
      XLSX.writeFile(wb, `streak-anggota-${format(new Date(),'yyyyMMdd')}.xlsx`);
      toast.success(`Excel diunduh! ${rows.length} anggota.`);
    } catch (err) {
      console.error('Excel error:', err);
      toast.error('Gagal export Excel: ' + err.message);
    }
  };

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

  const myEarnedIds = new Set(myBadges.map(b => b.id));
  const cur     = myStreak?.current_streak    ?? 0;
  const longest = myStreak?.longest_streak   ?? 0;
  const total   = myStreak?.total_hadir_wajib ?? 0;
  const isHot   = cur >= 4;
  const isMid   = cur >= 2;
  const flameColor = cur === 0 ? '#d1d5db' : isHot ? '#f97316' : isMid ? '#fb923c' : '#fbbf24';

  const MILESTONES = [2, 4, 8, 12, 26];
  const nextM = MILESTONES.find(m => m > cur) || 26;
  const prevM = MILESTONES.filter(m => m <= cur).pop() || 0;
  const pct   = nextM > prevM ? Math.min(100, Math.round((cur - prevM) / (nextM - prevM) * 100)) : 100;

  // Sort & filter untuk admin tab
  const filteredMembers = allMembers
    .filter(m => !search || m.nama_panggilan?.toLowerCase().includes(search.toLowerCase())
      || m.nickname?.toLowerCase().includes(search.toLowerCase())
      || m.lingkungan?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const va = a.streak?.[sortBy] ?? 0;
      const vb = b.streak?.[sortBy] ?? 0;
      return sortDir === 'desc' ? vb - va : va - vb;
    });

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(col); setSortDir('desc'); }
  }
  function SortIcon({ col }) {
    if (sortBy !== col) return <ChevronDown size={12} className="text-gray-300"/>;
    return sortDir === 'desc'
      ? <ChevronDown size={12} className="text-brand-700"/>
      : <ChevronUp size={12} className="text-brand-700"/>;
  }

  const tabs = [
    { key: 'mystreak',    label: 'Badge Saya' },
    { key: 'leaderboard', label: '🏆 Leaderboard' },
    { key: 'badges',      label: 'Semua Badge' },
    ...(canAdmin ? [{ key: 'admin', label: '👥 Semua Anggota' }] : []),
  ];

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
        {canAdmin && (
          <button onClick={handleRecalc} disabled={recalcing} className="btn-outline gap-2">
            <RefreshCw size={14} className={recalcing ? 'animate-spin' : ''}/>
            {recalcing ? 'Menghitung…' : 'Hitung Ulang Streak'}
          </button>
        )}
      </div>

      {/* Hero Card */}
      <div className="rounded-2xl overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #7f0000 0%, #b91c1c 100%)' }}>
        <div className="px-5 py-6 text-white">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-red-200 text-sm font-medium mb-1">Streak Kamu Saat Ini</p>
              <div className="flex items-end gap-2">
                <span className="text-5xl font-black">{cur}</span>
                <span className="text-red-200 text-lg mb-1">minggu</span>
              </div>
              {cur > 0 && (
                <p className="text-red-200 text-xs mt-1">
                  {isHot ? '🔥 On fire! Jangan putus sekarang!'
                   : `${nextM - cur} minggu lagi ke milestone ${nextM}`}
                </p>
              )}
              {myStreak?.last_attended_date && (
                <p className="text-red-300 text-xs mt-0.5">
                  Terakhir hadir: {format(parseISO(myStreak.last_attended_date), 'd MMMM yyyy', { locale: localeId })}
                </p>
              )}
            </div>
            <div className="relative">
              <span className="text-6xl" style={{ filter: cur === 0 ? 'grayscale(1)' : 'none' }}>🔥</span>
              {cur > 0 && (
                <span className={`absolute -bottom-1 -right-1 min-w-[24px] h-[24px]
                  rounded-full text-white text-xs font-black flex items-center justify-center px-1
                  ${isHot ? 'bg-orange-500' : 'bg-amber-400'}`}>
                  {cur}
                </span>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {cur > 0 && cur < 26 && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-red-300 mb-1">
                <span>Menuju {nextM} minggu</span>
                <span>{cur}/{nextM}</span>
              </div>
              <div className="h-2.5 bg-red-900/40 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700
                  ${isHot ? 'bg-orange-400' : 'bg-amber-400'}`}
                  style={{ width: `${pct}%` }}/>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 mt-5">
            {[
              { label: 'Streak Terpanjang', value: longest, suffix: 'mgg' },
              { label: 'Total Hadir Wajib', value: total,   suffix: 'kali' },
              { label: 'Badge Diraih',      value: myBadges.length, suffix: '' },
            ].map(s => (
              <div key={s.label} className="bg-white/15 rounded-xl px-3 py-2.5 text-center">
                <p className="text-white text-xl font-bold">{s.value}
                  <span className="text-red-200 text-sm ml-1">{s.suffix}</span>
                </p>
                <p className="text-red-200 text-[11px] mt-0.5 leading-tight">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-gray-100 rounded-xl p-1 flex gap-1 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors whitespace-nowrap
              ${tab === t.key ? 'bg-white text-brand-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Badge Saya */}
      {tab === 'mystreak' && (
        <div className="space-y-4">
          {myBadges.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-700 text-sm mb-2">Badge yang sudah diraih ✅</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {myBadges.map(b => <BadgeCard key={b.id} badge={b} earned diraih={b.diraih_pada}/>)}
              </div>
            </div>
          )}
          <div>
            <h3 className="font-semibold text-gray-700 text-sm mb-2">
              {myBadges.length > 0 ? 'Badge berikutnya 🎯' : 'Badge yang bisa kamu raih 🎯'}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {allBadges.filter(b => !myEarnedIds.has(b.id)).map(b => (
                <BadgeCard key={b.id} badge={b} earned={false}
                  progress={b.syarat_type === 'streak' ? cur : total}
                  target={b.syarat_nilai}/>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Leaderboard */}
      {tab === 'leaderboard' && (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <h3 className="font-semibold text-gray-700 text-sm">Streak Aktif Tertinggi (Top 20)</h3>
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
                      {isMe && <span className="ml-1 badge badge-red" style={{fontSize:'10px'}}>Kamu</span>}
                    </p>
                    <p className="text-xs text-gray-500">Total hadir: {row.total_hadir_wajib} kali</p>
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
              progress={b.syarat_type === 'streak' ? cur : total}
              target={b.syarat_nilai}/>
          ))}
        </div>
      )}

      {/* Tab: Admin — Semua Anggota */}
      {tab === 'admin' && canAdmin && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-3 text-gray-400"/>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Cari nama, username, lingkungan…"
                className="input pl-9 text-sm"/>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Users size={14}/> {filteredMembers.length} anggota
            </div>
            <button onClick={handleExportExcel}
              className="btn-outline gap-2 text-sm">
              <Download size={15}/> Export Excel
            </button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                label: 'Punya Streak Aktif',
                value: allMembers.filter(m => (m.streak?.current_streak ?? 0) > 0).length,
                color: 'text-orange-600', bg: 'bg-orange-50',
              },
              {
                label: 'Streak ≥ 4 Minggu',
                value: allMembers.filter(m => (m.streak?.current_streak ?? 0) >= 4).length,
                color: 'text-red-700', bg: 'bg-red-50',
              },
              {
                label: 'Belum Ada Streak',
                value: allMembers.filter(m => !(m.streak?.current_streak)).length,
                color: 'text-gray-500', bg: 'bg-gray-50',
              },
            ].map(s => (
              <div key={s.label} className={`card ${s.bg} border-0 py-3`}>
                <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Tabel semua anggota */}
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase border-b border-gray-100">
                    <th className="text-left px-4 py-3">Nama</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">Lingkungan</th>
                    <th className="text-center px-3 py-3 cursor-pointer select-none"
                      onClick={() => toggleSort('current_streak')}>
                      <span className="flex items-center justify-center gap-1">
                        Streak <SortIcon col="current_streak"/>
                      </span>
                    </th>
                    <th className="text-center px-3 py-3 cursor-pointer select-none"
                      onClick={() => toggleSort('longest_streak')}>
                      <span className="flex items-center justify-center gap-1">
                        Terpanjang <SortIcon col="longest_streak"/>
                      </span>
                    </th>
                    <th className="text-center px-3 py-3 cursor-pointer select-none"
                      onClick={() => toggleSort('total_hadir_wajib')}>
                      <span className="flex items-center justify-center gap-1">
                        Total Hadir <SortIcon col="total_hadir_wajib"/>
                      </span>
                    </th>
                    <th className="text-center px-3 py-3">Badge</th>
                    <th className="text-center px-3 py-3 hidden md:table-cell">Terakhir Hadir</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredMembers.map(m => {
                    const s = m.streak;
                    const c = s?.current_streak ?? 0;
                    const hot = c >= 4;
                    return (
                      <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-gray-800">{m.nama_panggilan}</p>
                          <p className="text-xs text-gray-400">@{m.nickname}</p>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500 hidden sm:table-cell">
                          {m.lingkungan || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`font-black text-base flex items-center justify-center gap-0.5
                            ${hot ? 'text-orange-500' : c > 0 ? 'text-amber-500' : 'text-gray-300'}`}>
                            {c > 0 && <Flame size={14}/>}{c}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center font-semibold text-gray-700">
                          {s?.longest_streak ?? 0}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="font-semibold text-brand-800">{s?.total_hadir_wajib ?? 0}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-0.5 flex-wrap">
                            {m.badges.slice(0,4).map((ub, i) => (
                              <span key={i} title={ub.badge?.nama} className="text-base">
                                {ub.badge?.icon || ''}
                              </span>
                            ))}
                            {m.badges.length === 0 && <span className="text-gray-300 text-xs">—</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center text-xs text-gray-500 hidden md:table-cell">
                          {s?.last_attended_date
                            ? format(parseISO(s.last_attended_date), 'd MMM yyyy', { locale: localeId })
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredMembers.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-gray-400">
                        {search ? 'Tidak ada anggota cocok dengan pencarian' : 'Belum ada data streak. Klik "Hitung Ulang Streak" terlebih dahulu.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Badge Card ─────────────────────────────────────────────────────────
function BadgeCard({ badge, earned, diraih, progress = 0, target }) {
  const pct = target ? Math.min(100, Math.round(progress * 100 / target)) : 0;
  return (
    <div className={`rounded-2xl p-3 border-2 text-center transition-all
      ${earned
        ? `${badge.warna_bg || 'bg-yellow-50'} border-yellow-200`
        : 'bg-gray-50 border-gray-200 opacity-60'}`}>
      <div className="text-3xl mb-1.5">{badge.icon || '🏅'}</div>
      <p className={`text-xs font-bold leading-tight
        ${earned ? (badge.warna_text || 'text-yellow-800') : 'text-gray-500'}`}>
        {badge.nama}
      </p>
      <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{badge.deskripsi}</p>
      {!earned && target && (
        <div className="mt-2">
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-brand-700 rounded-full" style={{ width: `${pct}%` }}/>
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
