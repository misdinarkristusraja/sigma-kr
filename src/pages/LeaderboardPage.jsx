import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Trophy, Crown, Medal, ChevronDown } from 'lucide-react';

export default function LeaderboardPage() {
  const [tab, setTab]     = useState('mingguan');
  const [data, setData]   = useState([]);
  const [loading, setLoad] = useState(true);
  const [period, setPeriod]= useState('month'); // 'week' | 'month' | 'all'

  useEffect(() => { loadLeaderboard(); }, [tab, period]);

  async function loadLeaderboard() {
    setLoad(true);
    try {
      if (tab === 'mingguan') {
        // Aggregate from rekap_poin_mingguan
        let dateFilter = '';
        if (period === 'week') {
          const d = new Date(); d.setDate(d.getDate() - 7);
          dateFilter = d.toISOString().split('T')[0];
        } else if (period === 'month') {
          const d = new Date(); d.setMonth(d.getMonth() - 1);
          dateFilter = d.toISOString().split('T')[0];
        }

        let q = supabase.rpc('leaderboard_mingguan', { date_from: dateFilter || null });
        const { data: rows, error } = await q;
        if (error) {
          // Fallback: manual query
          const { data: rekapAll } = await supabase
            .from('rekap_poin_mingguan')
            .select('user_id, poin, users(nama_panggilan, lingkungan, pendidikan)')
            .gte(dateFilter ? 'week_start' : 'poin', dateFilter || -999);
          // Aggregate by user
          const agg = {};
          (rekapAll || []).forEach(r => {
            if (!agg[r.user_id]) agg[r.user_id] = { ...r.users, total: 0, count: 0 };
            agg[r.user_id].total += r.poin || 0;
            agg[r.user_id].count += 1;
          });
          const sorted = Object.values(agg).sort((a, b) => b.total - a.total);
          setData(sorted);
        } else {
          setData(rows || []);
        }
      } else {
        // Daily leaderboard
        const { data: rows } = await supabase
          .from('rekap_poin_harian')
          .select('user_id, poin_harian, count_hadir_harian, users(nama_panggilan, lingkungan, pendidikan)')
          .order('poin_harian', { ascending: false })
          .limit(50);

        const agg = {};
        (rows || []).forEach(r => {
          if (!agg[r.user_id]) agg[r.user_id] = { ...r.users, poin_harian: 0, hadir: 0 };
          agg[r.user_id].poin_harian += r.poin_harian || 0;
          agg[r.user_id].hadir       += r.count_hadir_harian || 0;
        });
        setData(Object.values(agg).sort((a, b) => b.poin_harian - a.poin_harian));
      }
    } finally {
      setLoad(false);
    }
  }

  const RankIcon = ({ rank }) => {
    if (rank === 1) return <Crown size={18} className="text-yellow-400" />;
    if (rank === 2) return <Medal size={16} className="text-gray-400" />;
    if (rank === 3) return <Medal size={16} className="text-amber-600" />;
    return <span className="text-gray-400 text-sm font-bold w-4 text-center">{rank}</span>;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Leaderboard</h1>
          <p className="page-subtitle">Ranking poin misdinar SIGMA</p>
        </div>
        <select className="input w-auto" value={period} onChange={e => setPeriod(e.target.value)}>
          <option value="week">Minggu Ini</option>
          <option value="month">Bulan Ini</option>
          <option value="all">Semua Waktu</option>
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {[{key:'mingguan',label:'🏆 Mingguan'},{key:'harian',label:'📅 Misa Harian'}].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab===t.key?'bg-white text-brand-800 shadow-sm':'text-gray-500'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Top 3 podium */}
      {!loading && data.length >= 3 && (
        <div className="flex items-end justify-center gap-4 pt-4 pb-6">
          {/* 2nd place */}
          <div className="text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-2 border-2 border-gray-300">
              <span className="text-lg font-bold text-gray-600">{data[1]?.nama_panggilan?.[0]}</span>
            </div>
            <p className="text-sm font-semibold text-gray-700">{data[1]?.nama_panggilan}</p>
            <p className="text-xs text-gray-400">{data[1]?.lingkungan}</p>
            <div className="mt-2 bg-gray-200 rounded-t-xl px-4 py-2 h-16 flex items-center justify-center">
              <span className="text-xl font-black text-gray-600">{tab==='mingguan' ? data[1]?.total : data[1]?.poin_harian}</span>
            </div>
            <div className="bg-gray-300 rounded-b-sm h-1" />
            <span className="text-xs text-gray-400 font-bold mt-1 block">2nd</span>
          </div>

          {/* 1st place */}
          <div className="text-center -mt-4">
            <Crown size={24} className="text-yellow-400 mx-auto mb-1" />
            <div className="w-20 h-20 bg-yellow-50 rounded-full flex items-center justify-center mx-auto mb-2 border-4 border-yellow-400">
              <span className="text-2xl font-bold text-yellow-700">{data[0]?.nama_panggilan?.[0]}</span>
            </div>
            <p className="text-sm font-bold text-gray-900">{data[0]?.nama_panggilan}</p>
            <p className="text-xs text-gray-400">{data[0]?.lingkungan}</p>
            <div className="mt-2 bg-yellow-400 rounded-t-xl px-4 py-2 h-24 flex items-center justify-center">
              <span className="text-2xl font-black text-white">{tab==='mingguan' ? data[0]?.total : data[0]?.poin_harian}</span>
            </div>
            <div className="bg-yellow-500 rounded-b-sm h-1" />
            <span className="text-xs text-yellow-600 font-bold mt-1 block">🥇 1st</span>
          </div>

          {/* 3rd place */}
          <div className="text-center mt-2">
            <div className="w-14 h-14 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-2 border-2 border-amber-400">
              <span className="text-base font-bold text-amber-700">{data[2]?.nama_panggilan?.[0]}</span>
            </div>
            <p className="text-xs font-semibold text-gray-700">{data[2]?.nama_panggilan}</p>
            <p className="text-xs text-gray-400">{data[2]?.lingkungan}</p>
            <div className="mt-2 bg-amber-200 rounded-t-xl px-3 py-2 h-12 flex items-center justify-center">
              <span className="text-lg font-black text-amber-700">{tab==='mingguan' ? data[2]?.total : data[2]?.poin_harian}</span>
            </div>
            <div className="bg-amber-300 rounded-b-sm h-1" />
            <span className="text-xs text-amber-600 font-bold mt-1 block">3rd</span>
          </div>
        </div>
      )}

      {/* Full ranking */}
      <div className="card overflow-hidden p-0">
        {loading ? (
          <div className="p-6 space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="skeleton h-12 rounded-lg" />)}</div>
        ) : data.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <Trophy size={40} className="mx-auto mb-2 opacity-30" />
            <p>Belum ada data poin</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {data.map((row, i) => (
              <div key={i} className={`flex items-center gap-4 px-4 py-3 ${i < 3 ? 'bg-gradient-to-r from-yellow-50/30 to-transparent' : ''}`}>
                <div className="w-8 flex items-center justify-center flex-shrink-0">
                  <RankIcon rank={i+1} />
                </div>
                <div className="w-9 h-9 rounded-full bg-brand-50 flex items-center justify-center font-bold text-brand-800 text-sm flex-shrink-0">
                  {row.nama_panggilan?.[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{row.nama_panggilan}</p>
                  <p className="text-xs text-gray-400">{row.lingkungan} · {row.pendidikan}</p>
                </div>
                <div className="text-right">
                  <div className={`text-lg font-black ${i===0?'text-yellow-500':i===1?'text-gray-500':i===2?'text-amber-600':'text-brand-800'}`}>
                    {tab==='mingguan' ? row.total : row.poin_harian}
                  </div>
                  <div className="text-[10px] text-gray-400">poin</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
