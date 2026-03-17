import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { formatDate, formatWIB, getLiturgyClass, buildWALink, downloadCSV } from '../lib/utils';
import { toPng } from 'html-to-image';
import { Calendar, RefreshCw, Download, Send, Eye, Edit2, Check, X, ChevronLeft, ChevronRight, Zap, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

const SLOT_LABELS = {
  1: 'Sabtu 17:30',
  2: 'Minggu 06:00',
  3: 'Minggu 08:00',
  4: 'Minggu 17:30',
};

export default function ScheduleWeeklyPage() {
  const [events,   setEvents]   = useState([]);
  const [month,    setMonth]    = useState(new Date().getMonth() + 1);
  const [year,     setYear]     = useState(new Date().getFullYear());
  const [loading,  setLoading]  = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedEvent, setSelected] = useState(null);
  const [waText,   setWaText]   = useState('');
  const [showWA,   setShowWA]   = useState(false);
  const exportRef = useRef(null);

  useEffect(() => { loadEvents(); }, [month, year]);

  async function loadEvents() {
    setLoading(true);
    const start = `${year}-${String(month).padStart(2,'0')}-01`;
    const end   = `${year}-${String(month).padStart(2,'0')}-31`;
    const { data } = await supabase
      .from('events')
      .select(`*, assignments(id, slot_number, user_id, users(nama_panggilan, lingkungan, pendidikan))`)
      .gte('tanggal_tugas', start)
      .lte('tanggal_tugas', end)
      .not('tipe_event', 'eq', 'Misa_Harian')
      .order('tanggal_tugas');
    setEvents(data || []);
    setLoading(false);
  }

  async function generateSchedule() {
    setGenerating(true);
    try {
      // 1. Fetch liturgical data from gcatholic proxy
      toast.loading('Mengambil data liturgi...', { id: 'gen' });

      // In production: call Edge Function to fetch gcatholic.org
      // For now: call our proxy edge function
      const { data: liturgyData, error: litErr } = await supabase.functions.invoke('fetch-gcatholic', {
        body: { year, month }
      });

      toast.loading('Menghitung jadwal...', { id: 'gen' });

      // 2. Get active members pool
      const { data: pool } = await supabase
        .from('users')
        .select('id, nickname, nama_panggilan, pendidikan, lingkungan, is_suspended')
        .eq('status', 'Active')
        .eq('is_suspended', false)
        .order('nama_panggilan');

      // 3. Get last assignments to calculate priority score
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recentAssignments } = await supabase
        .from('assignments')
        .select('user_id, created_at')
        .gte('created_at', thirtyDaysAgo);

      // 4. Compute scores
      const lastAssignMap = {};
      (recentAssignments || []).forEach(a => {
        if (!lastAssignMap[a.user_id] || a.created_at > lastAssignMap[a.user_id]) {
          lastAssignMap[a.user_id] = a.created_at;
        }
      });

      const scoredPool = (pool || []).map(u => {
        const last   = lastAssignMap[u.id] ? new Date(lastAssignMap[u.id]) : new Date(0);
        const daysSince = (Date.now() - last.getTime()) / (1000 * 60 * 60 * 24);
        return { ...u, score: daysSince };
      }).sort((a, b) => b.score - a.score);

      // 5. Get weekends in month
      const weekends = getWeekends(year, month);

      // 6. Assign 4 slots per weekend
      let poolIdx = 0;
      const newEvents = [];
      for (const weekend of weekends) {
        const liturgy = liturgyData?.find(l => l.date === weekend.sunday) || {};
        const event = {
          nama_event:      liturgy.name || `PEKAN BIASA`,
          tipe_event:      'Mingguan',
          tanggal_tugas:   weekend.sunday,
          tanggal_latihan: weekend.saturday,
          perayaan:        liturgy.name || '',
          warna_liturgi:   liturgy.color || 'Hijau',
          jumlah_misa:     4,
          status_event:    'Akan_Datang',
          gcatholic_fetched: !!liturgy.name,
        };

        // Insert event
        const { data: ev, error: evErr } = await supabase.from('events').insert(event).select().single();
        if (evErr) throw evErr;

        // Assign 8 people (2 per slot)
        const assignments = [];
        for (let slot = 1; slot <= 4; slot++) {
          for (let pos = 0; pos < 2; pos++) {
            const user = scoredPool[poolIdx % scoredPool.length];
            assignments.push({ event_id: ev.id, user_id: user.id, slot_number: slot, position: pos + 1 });
            poolIdx++;
          }
        }
        await supabase.from('assignments').insert(assignments);
        newEvents.push(ev);
      }

      toast.success(`${newEvents.length} event berhasil digenerate!`, { id: 'gen' });
      loadEvents();
    } catch (err) {
      toast.error('Gagal generate: ' + err.message, { id: 'gen' });
    } finally {
      setGenerating(false);
    }
  }

  function getWeekends(y, m) {
    const result = [];
    const d = new Date(y, m - 1, 1);
    while (d.getMonth() === m - 1) {
      if (d.getDay() === 0) { // Sunday
        const sat = new Date(d); sat.setDate(d.getDate() - 1);
        result.push({
          saturday: sat.toISOString().split('T')[0],
          sunday:   d.toISOString().split('T')[0],
        });
      }
      d.setDate(d.getDate() + 1);
    }
    return result;
  }

  function generateWAText(event) {
    const asgn = event.assignments || [];
    const bySlot = {};
    for (let s = 1; s <= 4; s++) bySlot[s] = asgn.filter(a => a.slot_number === s).map(a => a.users?.nama_panggilan || '?');

    const lines = [`PERAYAAN EKARISTI ${event.perayaan || event.nama_event}`,
      `${formatDate(event.tanggal_latihan,'dd')}–${formatDate(event.tanggal_tugas,'dd MMMM yyyy')}`,
      '',
    ];
    for (const [slot, label] of Object.entries(SLOT_LABELS)) {
      lines.push(label);
      const names = bySlot[slot] || [];
      if (names.length === 0) lines.push('1. (kosong)');
      else names.forEach((n, i) => lines.push(`${i+1}. ${n}`));
      lines.push('');
    }
    return lines.join('\n');
  }

  async function exportPNG(event) {
    if (!exportRef.current) return;
    try {
      const png = await toPng(exportRef.current, { pixelRatio: 2 });
      const link = document.createElement('a');
      link.href = png;
      link.download = `jadwal-${event.tanggal_tugas}.png`;
      link.click();
      toast.success('PNG berhasil diunduh!');
    } catch { toast.error('Gagal export PNG'); }
  }

  const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Jadwal Misa Mingguan</h1>
          <p className="page-subtitle">4 slot per weekend · Generate & Export</p>
        </div>
        <div className="flex gap-2 items-center">
          {/* Month navigator */}
          <button onClick={() => { if (month === 1) { setMonth(12); setYear(y=>y-1); } else setMonth(m=>m-1); }} className="btn-ghost p-2"><ChevronLeft size={18} /></button>
          <span className="font-semibold text-gray-700 min-w-32 text-center">{MONTHS[month-1]} {year}</span>
          <button onClick={() => { if (month === 12) { setMonth(1); setYear(y=>y+1); } else setMonth(m=>m+1); }} className="btn-ghost p-2"><ChevronRight size={18} /></button>

          <button onClick={generateSchedule} disabled={generating} className="btn-primary gap-2">
            <Zap size={16} />
            {generating ? 'Generating...' : 'Generate Jadwal'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4">{[1,2,3].map(i => <div key={i} className="skeleton h-40 rounded-xl" />)}</div>
      ) : events.length === 0 ? (
        <div className="card text-center py-14">
          <Calendar size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">Belum ada jadwal untuk {MONTHS[month-1]} {year}</p>
          <button onClick={generateSchedule} disabled={generating} className="btn-primary mt-4 gap-2">
            <Zap size={16} /> Generate Sekarang
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {events.map(event => {
            const lc = getLiturgyClass(event.warna_liturgi);
            const asgn = event.assignments || [];
            const bySlot = {};
            for (let s = 1; s <= 4; s++) bySlot[s] = asgn.filter(a => a.slot_number === s);

            return (
              <div key={event.id} className="card">
                {/* Event header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-3 h-3 rounded-full ${lc.dot}`} />
                      <span className={`text-xs font-semibold ${lc.text}`}>{event.warna_liturgi || 'Hijau'}</span>
                      <span className="badge-gray text-xs">{event.tipe_event}</span>
                      {event.status_event === 'Sudah_Lewat' && <span className="badge-gray">Lewat</span>}
                    </div>
                    <h3 className="font-bold text-gray-900 text-lg">{event.perayaan || event.nama_event}</h3>
                    <p className="text-sm text-gray-500">
                      Latihan: {formatDate(event.tanggal_latihan, 'EEEE, dd MMM')} ·
                      Tugas: {formatDate(event.tanggal_tugas, 'EEEE, dd MMM yyyy')}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => { setWaText(generateWAText(event)); setShowWA(true); }}
                      className="btn-outline btn-sm gap-1"
                    ><Send size={13} /> WA</button>
                    <button
                      onClick={() => setSelected(event.id === selectedEvent ? null : event.id)}
                      className="btn-outline btn-sm gap-1"
                    ><Eye size={13} /> {selectedEvent === event.id ? 'Tutup' : 'Lihat'}</button>
                  </div>
                </div>

                {/* Slots preview */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" ref={selectedEvent === event.id ? exportRef : null}>
                  {[1,2,3,4].map(slot => (
                    <div key={slot} className={`p-3 rounded-xl ${lc.bg} border border-gray-100`}>
                      <p className="text-xs font-bold text-gray-600 mb-2">{SLOT_LABELS[slot]}</p>
                      {bySlot[slot]?.length > 0 ? (
                        bySlot[slot].map((a, i) => (
                          <div key={i} className="flex items-center gap-1.5 mb-1">
                            <div className="w-5 h-5 rounded-full bg-brand-800/20 flex items-center justify-center text-[10px] font-bold text-brand-800">
                              {i+1}
                            </div>
                            <span className="text-sm font-medium text-gray-800">{a.users?.nama_panggilan}</span>
                            <span className="text-[10px] text-gray-400">{a.users?.pendidikan}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-gray-400 italic">Kosong</p>
                      )}
                    </div>
                  ))}
                </div>

                {selectedEvent === event.id && (
                  <div className="mt-3 flex justify-end">
                    <button onClick={() => exportPNG(event)} className="btn-secondary btn-sm gap-1">
                      <Download size={13} /> Export PNG
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* WA text modal */}
      {showWA && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">Template WA Jadwal</h3>
              <button onClick={() => setShowWA(false)}><X size={20} /></button>
            </div>
            <textarea
              className="w-full h-72 font-mono text-xs p-3 border border-gray-200 rounded-xl bg-gray-50 resize-none"
              value={waText}
              readOnly
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { navigator.clipboard.writeText(waText); toast.success('Disalin!'); }}
                className="btn-primary flex-1">
                Salin Teks
              </button>
              <button onClick={() => setShowWA(false)} className="btn-secondary">Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
