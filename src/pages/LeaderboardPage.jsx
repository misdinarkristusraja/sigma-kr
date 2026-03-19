import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { hitungPoin, tagDuplicateNames } from '../lib/utils';
import { Trophy, Crown, Medal, RefreshCw } from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────
function toLocalISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function cutoff(months) {
  const d = new Date(); d.setMonth(d.getMonth()-months); return toLocalISO(d);
}
function getWeekStart(dateStr) {
  if (!dateStr) return null;
  const [y,m,d] = dateStr.split('-').map(Number);
  const date = new Date(y,m-1,d);
  const dow  = date.getDay();
  const back = dow===6 ? 0 : (dow+1);
  const sat  = new Date(y,m-1,d-back);
  return toLocalISO(sat);
}

// ─── Hitung leaderboard mingguan real-time ────────────────
function buildLeaderboard({ members, assigns, scans, dateFrom, dateTo }) {
  // Group data per user
  const aMap = {}, sMap = {};
  members.forEach(m => { aMap[m.id] = []; sMap[m.id] = []; });
  assigns.filter(a => a.events).forEach(a => {
    if (aMap[a.user_id]) aMap[a.user_id].push(a.events);
  });
  scans.forEach(s => { if (sMap[s.user_id]) sMap[s.user_id].push(s); });

  return members.map(m => {
    const weeks = {};

    // assignments → dijadwalkan
    aMap[m.id].forEach(ev => {
      const tgl = ev.tanggal_tugas || ev.tanggal_latihan;
      if (!tgl || (dateFrom && tgl < dateFrom) || (dateTo && tgl > dateTo)) return;
      const ws = getWeekStart(tgl);
      if (!ws) return;
      if (!weeks[ws]) weeks[ws] = { is_dijadwalkan:false, is_hadir_tugas:false, is_hadir_latihan:false, is_walk_in:false };
      weeks[ws].is_dijadwalkan = true;
    });

    // scans → hadir
    sMap[m.id].forEach(s => {
      const ds = s.timestamp?.split('T')[0];
      if (!ds || (dateFrom && ds < dateFrom) || (dateTo && ds > dateTo)) return;
      const ws = getWeekStart(ds);
      if (!ws) return;
      if (!weeks[ws]) weeks[ws] = { is_dijadwalkan:false, is_hadir_tugas:false, is_hadir_latihan:false, is_walk_in:false };
      const t = s.scan_type;
      if (t==='tugas')          { weeks[ws].is_hadir_tugas=true; }
      if (t==='latihan')        { weeks[ws].is_hadir_latihan=true; }
      if (t==='walkin_tugas')   { weeks[ws].is_hadir_tugas=true; weeks[ws].is_walk_in=true; }
      if (t==='walkin_latihan') { weeks[ws].is_hadir_latihan=true; weeks[ws].is_walk_in=true; }
    });

    let totalPoin = 0, hadirCount = 0, absenCount = 0;
    Object.values(weeks).forEach(w => {
      const { poin, kondisi } = hitungPoin(w);
      if (kondisi !== null) {
        totalPoin += poin || 0;
        if (w.is_hadir_tugas || w.is_hadir_latihan) hadirCount++;
        if (kondisi === 'K6') absenCount++;
      }
    });

    return { ...m, totalPoin, hadirCount, absenCount, minggu: Object.keys(weeks).length };
  }).sort((a,b) => b.totalPoin - a.totalPoin);
}

// ─── Hitung leaderboard harian real-time ──────────────────
function buildLeaderboardHarian({ members, scans, dateFrom, dateTo }) {
  const sMap = {};
  members.forEach(m => { sMap[m.id] = 0; });
  scans
    .filter(s => (s.scan_type==='tugas'||s.scan_type==='walkin_tugas') && s.event_id)
    .forEach(s => {
      const ds = s.timestamp?.split('T')[0];
      if (!ds || (dateFrom && ds<dateFrom) || (dateTo && ds>dateTo)) return;
      if (sMap[s.user_id] !== undefined) sMap[s.user_id]++;
    });
  return members.map(m => ({ ...m, hadirHarian: sMap[m.id]||0 }))
    .sort((a,b) => b.hadirHarian - a.hadirHarian);
}

// ═════════════════════════════════════════════════════════
export default function LeaderboardPage() {
  const { profile } = useAuth();

  const [tab,      setTab]    = useState('mingguan');
  const [loading,  setLoading]= useState(true);
  const [data,     setData]   = useState([]);
  const [dateFrom, setDateFrom]= useState(cutoff(1));
  const [dateTo,   setDateTo]  = useState(toLocalISO(new Date()));

  // Raw data cache
  const [members,  setMembers] = useState([]);
  const [assigns,  setAssigns] = useState([]);
  const [scans,    setScans]   = useState([]);
  const [loaded,   setLoaded]  = useState(false);

  // Load raw data once
  useEffect(() => {
    async function fetchRaw() {
      const [{ data: mems }, { data: asgs }, { data: scs }] = await Promise.all([
        supabase.from('users')
          .select('id, nama_panggilan, lingkungan, pendidikan')
          .eq('status','Active').order('nama_panggilan'),
        supabase.from('assignments')
          .select('user_id, events(tanggal_tugas, tanggal_latihan, tipe_event)')
          .not('events.tipe_event','eq','Misa_Harian'),
        supabase.from('scan_records')
          .select('user_id, scan_type, timestamp, is_walk_in, event_id')
          .gte('timestamp', '2020-01-01T00:00:00'),
      ]);
      setMembers(mems || []);
      setAssigns((asgs||[]).filter(a => a.events));
      setScans(scs || []);
      setLoaded(true);
    }
    fetchRaw();
  }, []);

  // Recalculate when tab/dates change
  useEffect(() => {
    if (!loaded || !members.length) return;
    setLoading(true);
    setTimeout(() => { // micro async to allow loading indicator
      if (tab === 'mingguan') {
        const lb = buildLeaderboard({ members, assigns, scans, dateFrom, dateTo });
        setData(lb);
      } else {
        const lb = buildLeaderboardHarian({ members, scans, dateFrom, dateTo });
        setData(lb);
      }
      setLoading(false);
    }, 50);
  }, [tab, dateFrom, dateTo, loaded]);

  // Preset periods
  function setPeriod(months, year) {
    if (year === 'ytd') {
      setDateFrom(`${new Date().getFullYear()}-01-01`);
      setDateTo(toLocalISO(new Date()));
    } else if (months === null) {
      setDateFrom('2020-01-01');
      setDateTo(toLocalISO(new Date()));
    } else {
      setDateFrom(cutoff(months));
      setDateTo(toLocalISO(new Date()));
    }
  }

  const periods = [
    { label: '1 Bln',    action: () => setPeriod(1) },
    { label: '2 Bln',    action: () => setPeriod(2) },
    { label: '3 Bln',    action: () => setPeriod(3) },
    { label: 'Tahun Ini',action: () => setPeriod(0,'ytd') },
    { label: 'Semua',    action: () => setPeriod(null) },
  ];

  const RankIcon = ({ rank }) => {
    if (rank===1) return <Crown size={18} className="text-yellow-400"/>;
    if (rank===2) return <Medal size={16} className="text-gray-400"/>;
    if (rank===3) return <Medal size={16} className="text-amber-600"/>;
    return <span className="text-gray-400 text-sm font-bold text-center w-5">{rank}</span>;
  };

  // Top 3 + rest
  const top3 = data.slice(0,3);
  const rest  = data.slice(3);
  const myRank  = data.findIndex(d => d.id === profile?.id) + 1;
  // Disambiguasi nama yang sama di leaderboard
  const nameTag = tagDuplicateNames(data);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Trophy size={22} className="text-yellow-400"/> Leaderboard
          </h1>
          <p className="page-subtitle">Real-time · {data.length} anggota aktif</p>
        </div>
        <button onClick={() => setLoaded(false) || setTimeout(()=>setLoaded(true),100)}
          className="btn-ghost p-2"><RefreshCw size={16}/></button>
      </div>

      {/* Tabs: mingguan / harian */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {[{key:'mingguan',label:'🏆 Misa Mingguan'},{key:'harian',label:'📅 Misa Harian'}].map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab===t.key?'bg-white text-brand-800 shadow-sm':'text-gray-500'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Period filter */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="flex gap-1 flex-wrap">
          {periods.map(p => (
            <button key={p.label} onClick={p.action}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 hover:bg-brand-50 hover:text-brand-800 transition-all">
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <input type="date" className="input input-sm text-xs w-32" value={dateFrom}
            onChange={e=>setDateFrom(e.target.value)}/>
          <span>–</span>
          <input type="date" className="input input-sm text-xs w-32" value={dateTo}
            onChange={e=>setDateTo(e.target.value)}/>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3,4,5].map(i=><div key={i} className="skeleton h-14 rounded-xl"/>)}</div>
      ) : (
        <>
          {/* Podium top 3 */}
          {top3.length >= 2 && (
            <div className="flex items-end justify-center gap-4 py-6">
              {/* Rank 2 */}
              {top3[1] && (
                <div className="text-center">
                  <div className="w-14 h-14 bg-gray-200 rounded-full mx-auto flex items-center justify-center mb-2 text-lg font-bold text-gray-700">
                    {top3[1].nama_panggilan?.[0]?.toUpperCase()}
                  </div>
                  <p className="font-semibold text-sm text-gray-800">{nameTag[top3[1].id] || top3[1].nama_panggilan}</p>
                  <p className="text-xs text-gray-500">{top3[1].lingkungan}</p>
                  <div className="mt-2 bg-gray-200 rounded-t-xl px-4 py-3 text-center">
                    <Medal size={20} className="mx-auto text-gray-400 mb-1"/>
                    <p className="font-black text-gray-700">{tab==='mingguan' ? (top3[1].totalPoin>0?'+':'')+top3[1].totalPoin : top3[1].hadirHarian+'×'}</p>
                    <p className="text-[10px] text-gray-500">#{2}</p>
                  </div>
                </div>
              )}
              {/* Rank 1 */}
              {top3[0] && (
                <div className="text-center -mt-6">
                  <div className="w-16 h-16 bg-yellow-200 rounded-full mx-auto flex items-center justify-center mb-2 text-xl font-bold text-yellow-800 ring-4 ring-yellow-400">
                    {top3[0].nama_panggilan?.[0]?.toUpperCase()}
                  </div>
                  <p className="font-bold text-gray-900">{nameTag[top3[0].id] || top3[0].nama_panggilan}</p>
                  <p className="text-xs text-gray-500">{top3[0].lingkungan}</p>
                  <div className="mt-2 bg-yellow-400 rounded-t-xl px-4 py-4 text-center">
                    <Crown size={22} className="mx-auto text-yellow-900 mb-1"/>
                    <p className="font-black text-yellow-900 text-lg">{tab==='mingguan' ? (top3[0].totalPoin>0?'+':'')+top3[0].totalPoin : top3[0].hadirHarian+'×'}</p>
                    <p className="text-[10px] text-yellow-800">#1</p>
                  </div>
                </div>
              )}
              {/* Rank 3 */}
              {top3[2] && (
                <div className="text-center">
                  <div className="w-12 h-12 bg-amber-100 rounded-full mx-auto flex items-center justify-center mb-2 text-base font-bold text-amber-700">
                    {top3[2].nama_panggilan?.[0]?.toUpperCase()}
                  </div>
                  <p className="font-semibold text-sm text-gray-800">{nameTag[top3[2].id] || top3[2].nama_panggilan}</p>
                  <p className="text-xs text-gray-500">{top3[2].lingkungan}</p>
                  <div className="mt-2 bg-amber-300 rounded-t-xl px-3 py-2 text-center">
                    <Medal size={18} className="mx-auto text-amber-700 mb-1"/>
                    <p className="font-black text-amber-900">{tab==='mingguan' ? (top3[2].totalPoin>0?'+':'')+top3[2].totalPoin : top3[2].hadirHarian+'×'}</p>
                    <p className="text-[10px] text-amber-700">#3</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Posisi saya (kalau bukan top 3) */}
          {myRank > 3 && (
            <div className="bg-brand-50 border border-brand-200 rounded-xl p-3 flex items-center gap-3">
              <span className="font-bold text-brand-800">#{myRank}</span>
              <span className="text-sm text-brand-700">Posisi kamu saat ini</span>
              <span className="ml-auto font-black text-brand-800">
                {tab==='mingguan'
                  ? (data[myRank-1]?.totalPoin>0?'+':'')+data[myRank-1]?.totalPoin
                  : data[myRank-1]?.hadirHarian+'×'
                }
              </span>
            </div>
          )}

          {/* Full ranking */}
          <div className="card overflow-hidden p-0">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-12">#</th>
                  <th>Nama</th>
                  <th>Lingkungan</th>
                  {tab==='mingguan' ? (
                    <><th>Poin</th><th>Hadir</th><th>Absen</th></>
                  ) : (
                    <><th>Hadir Misa Harian</th></>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.map((d,i)=>{
                  const isMe = d.id === profile?.id;
                  return (
                    <tr key={d.id} className={isMe ? 'bg-brand-50 font-semibold' : ''}>
                      <td><div className="flex items-center justify-center"><RankIcon rank={i+1}/></div></td>
                      <td>
                        <span className="font-medium text-gray-900">{nameTag[d.id] || d.nama_panggilan}</span>
                        {isMe && <span className="ml-1.5 text-[10px] bg-brand-800 text-white px-1.5 rounded">Kamu</span>}
                      </td>
                      <td className="text-xs text-gray-500">{d.lingkungan}</td>
                      {tab==='mingguan' ? (
                        <>
                          <td>
                            <span className={`font-black ${d.totalPoin>0?'text-green-600':d.totalPoin<0?'text-red-600':'text-gray-400'}`}>
                              {d.totalPoin>0?'+':''}{d.totalPoin}
                            </span>
                          </td>
                          <td className="text-center text-sm text-gray-600">{d.hadirCount}</td>
                          <td className="text-center text-sm">{d.absenCount>0?<span className="text-red-500">{d.absenCount}</span>:'—'}</td>
                        </>
                      ) : (
                        <td>
                          <span className="font-black text-blue-600">{d.hadirHarian}×</span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
