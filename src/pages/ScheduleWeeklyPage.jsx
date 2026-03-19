import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { formatDate, getLiturgyClass, downloadCSV } from '../lib/utils';
import { toPng } from 'html-to-image';
import {
  Calendar, Download, Send, Eye, Edit2, Check, X,
  ChevronLeft, ChevronRight, Zap, AlertTriangle, Trash2,
  FileEdit, Globe, Lock, RefreshCw
} from 'lucide-react';
import toast from 'react-hot-toast';

const SLOT_LABELS = { 1:'Sabtu 17:30', 2:'Minggu 06:00', 3:'Minggu 08:00', 4:'Minggu 17:30' };
const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

// ── Fetch liturgi dari gcatholic.org via CORS proxy ───────────
async function fetchLiturgi(year, month) {
  const CORS_PROXIES = [
    `https://api.allorigins.win/get?url=${encodeURIComponent(`https://gcatholic.org/calendar/${year}/ID-id`)}`,
    `https://corsproxy.io/?${encodeURIComponent(`https://gcatholic.org/calendar/${year}/ID-id`)}`,
  ];

  for (const proxyUrl of CORS_PROXIES) {
    try {
      const res  = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
      const json = await res.json();
      const html = json.contents || json.body || '';
      return parseLiturgiHTML(html, year, month);
    } catch { continue; }
  }

  // Fallback: coba via Supabase Edge Function jika ada
  try {
    const { data } = await supabase.functions.invoke('fetch-gcatholic', { body: { year, month } });
    if (data && Array.isArray(data)) return data;
  } catch {}

  return []; // Jika semua gagal, return kosong → nama liturgi diisi manual
}

function parseLiturgiHTML(html, year, month) {
  const results = [];
  const targetMonth = String(month).padStart(2, '0');

  // Pattern: cari baris tabel dengan tanggal bulan target
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const rowHtml = match[1];

    // Cari tanggal (format: "1 Mar" atau "Mar 1")
    const dateMatch = rowHtml.match(/>\s*(\d{1,2})\s*</);
    if (!dateMatch) continue;
    const day = dateMatch[1].padStart(2, '0');

    // Cek apakah tanggal ini bulan yang kita minta
    // (gcatholic menampilkan seluruh tahun, filter per bulan)
    const monthNames = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    const targetMonthName = monthNames[month - 1];

    // Ambil nama perayaan — hapus tag HTML
    const nameMatch = rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
    if (!nameMatch || nameMatch.length < 2) continue;

    const rawName = nameMatch[nameMatch.length - 1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!rawName || rawName.length < 3) continue;

    // Deteksi warna liturgi dari class atau context
    let color = 'Hijau';
    if (/class="[^"]*red[^"]*"/i.test(rowHtml))    color = 'Merah';
    if (/class="[^"]*white[^"]*"/i.test(rowHtml))  color = 'Putih';
    if (/class="[^"]*purple[^"]*"/i.test(rowHtml)) color = 'Ungu';
    if (/class="[^"]*violet[^"]*"/i.test(rowHtml)) color = 'Ungu';
    if (/class="[^"]*rose[^"]*"/i.test(rowHtml))   color = 'MerahMuda';
    if (/class="[^"]*pink[^"]*"/i.test(rowHtml))   color = 'MerahMuda';
    if (/class="[^"]*black[^"]*"/i.test(rowHtml))  color = 'Hitam';

    results.push({
      date:  `${year}-${targetMonth}-${day}`,
      name:  rawName,
      color,
      isHariRaya: /hari raya|solemnity|HR/i.test(rawName),
    });
  }

  return results;
}

export default function ScheduleWeeklyPage() {
  const [events,     setEvents]    = useState([]);
  const [month,      setMonth]     = useState(new Date().getMonth() + 1);
  const [year,       setYear]      = useState(new Date().getFullYear());
  const [loading,    setLoading]   = useState(true);
  const [generating, setGenerating]= useState(false);
  const [editEvent,  setEditEvent] = useState(null);  // event sedang diedit
  const [waText,     setWaText]    = useState('');
  const [showWA,     setShowWA]    = useState(false);
  const [deleteConf, setDeleteConf]= useState(null);  // event yang akan dihapus
  const exportRefs = useRef({});

  const loadEvents = useCallback(async () => {
    setLoading(true);
    const start = `${year}-${String(month).padStart(2,'0')}-01`;
    const end   = `${year}-${String(month).padStart(2,'0')}-31`;
    const { data, error } = await supabase
      .from('events')
      .select(`
        id, nama_event, tipe_event, tanggal_tugas, tanggal_latihan,
        perayaan, warna_liturgi, jumlah_misa, status_event, is_draft,
        published_at, draft_note,
        pic_slot_1a, pic_slot_1b, pic_slot_2a, pic_slot_2b,
        pic_slot_3a, pic_slot_3b, pic_slot_4a, pic_slot_4b,
        assignments(id, slot_number, position, user_id, users(nama_panggilan, pendidikan, lingkungan))
      `)
      .gte('tanggal_tugas', start)
      .lte('tanggal_tugas', end)
      .not('tipe_event', 'eq', 'Misa_Harian')
      .order('tanggal_tugas');
    if (error) toast.error('Gagal load jadwal: ' + error.message);
    setEvents(data || []);
    setLoading(false);
  }, [month, year]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // ── Generate jadwal ─────────────────────────────────────────
  async function generateSchedule() {
    setGenerating(true);
    const toastId = 'gen';
    try {
      toast.loading('Mengambil data liturgi dari gcatholic.org...', { id: toastId });
      const liturgyData = await fetchLiturgi(year, month);

      toast.loading('Menghitung skor prioritas anggota...', { id: toastId });

      // Pool anggota aktif
      const { data: pool, error: poolErr } = await supabase
        .from('users')
        .select('id, nickname, nama_panggilan, pendidikan, lingkungan')
        .eq('status', 'Active')
        .eq('is_suspended', false);
      if (poolErr) throw poolErr;
      if (!pool || pool.length === 0) throw new Error('Tidak ada anggota aktif di database');

      // Hitung skor prioritas berdasarkan tugas terakhir
      const sixtyDaysAgo = new Date(Date.now() - 60*24*60*60*1000).toISOString();
      const { data: recentAssign } = await supabase
        .from('assignments')
        .select('user_id, created_at')
        .gte('created_at', sixtyDaysAgo);

      const lastMap = {};
      (recentAssign || []).forEach(a => {
        if (!lastMap[a.user_id] || a.created_at > lastMap[a.user_id]) lastMap[a.user_id] = a.created_at;
      });

      const scoredPool = pool.map(u => ({
        ...u,
        score: lastMap[u.id]
          ? (Date.now() - new Date(lastMap[u.id]).getTime()) / 86400000
          : 9999, // belum pernah tugas → prioritas tertinggi
      })).sort((a, b) => b.score - a.score);

      const weekends = getWeekends(year, month);
      toast.loading(`Generate ${weekends.length} minggu...`, { id: toastId });

      let poolIdx = 0;
      let created = 0;

      for (const weekend of weekends) {
        // Cari data liturgi untuk Minggu ini
        const sundayLiturgy = liturgyData.find(l => l.date === weekend.sunday);
        const satLiturgy    = liturgyData.find(l => l.date === weekend.saturday);

        const eventName = sundayLiturgy?.name || satLiturgy?.name || 'MISA MINGGUAN';
        const warnaLiturgi = sundayLiturgy?.color || 'Hijau';

        // Cek apakah event sudah ada untuk tanggal ini
        const { data: existing } = await supabase
          .from('events')
          .select('id')
          .eq('tanggal_tugas', weekend.sunday)
          .not('tipe_event', 'eq', 'Misa_Harian')
          .maybeSingle();

        if (existing) {
          toast.loading(`Minggu ${weekend.sunday} sudah ada, skip...`, { id: toastId });
          continue;
        }

        // Insert event sebagai DRAFT
        const { data: ev, error: evErr } = await supabase.from('events').insert({
          nama_event:       eventName.toUpperCase(),
          tipe_event:       'Mingguan',
          tanggal_tugas:    weekend.sunday,
          tanggal_latihan:  weekend.saturday,
          perayaan:         eventName,
          warna_liturgi:    warnaLiturgi,
          jumlah_misa:      4,
          status_event:     'Akan_Datang',
          is_draft:         true,           // ← DRAFT, belum published
          gcatholic_fetched: liturgyData.length > 0,
        }).select().single();
        if (evErr) throw evErr;

        // Assign 8 petugas: 2 per slot × 4 slot
        // Pastikan tidak ada petugas yang sama dalam 1 event
        const usedInEvent = new Set();
        const assignments = [];

        for (let slot = 1; slot <= 4; slot++) {
          let assigned = 0;
          let attempts = 0;
          while (assigned < 2 && attempts < scoredPool.length * 2) {
            const user = scoredPool[poolIdx % scoredPool.length];
            poolIdx++;
            attempts++;
            if (usedInEvent.has(user.id)) continue;
            usedInEvent.add(user.id);
            assignments.push({
              event_id:    ev.id,
              user_id:     user.id,
              slot_number: slot,
              position:    assigned + 1,
            });
            assigned++;
          }
        }

        if (assignments.length > 0) {
          const { error: aErr } = await supabase.from('assignments').insert(assignments);
          if (aErr) console.error('Assignment error:', aErr.message);
        }

        created++;
      }

      toast.success(
        created > 0
          ? `✅ ${created} event jadwal dibuat sebagai DRAFT. Review dan publish di bawah.`
          : `Semua jadwal bulan ini sudah ada.`,
        { id: toastId }
      );
      loadEvents();
    } catch (err) {
      toast.error('Gagal generate: ' + err.message, { id: toastId });
    } finally {
      setGenerating(false);
    }
  }

  function getWeekends(y, m) {
    const result = [];
    const d = new Date(y, m - 1, 1);
    while (d.getMonth() === m - 1) {
      if (d.getDay() === 0) { // Minggu
        const sat = new Date(d);
        sat.setDate(d.getDate() - 1);
        result.push({
          saturday: sat.toISOString().split('T')[0],
          sunday:   d.toISOString().split('T')[0],
        });
      }
      d.setDate(d.getDate() + 1);
    }
    return result;
  }

  // ── Publish event ────────────────────────────────────────────
  async function publishEvent(ev) {
    const { error } = await supabase.from('events').update({
      is_draft:     false,
      published_at: new Date().toISOString(),
    }).eq('id', ev.id);
    if (error) { toast.error('Gagal publish: ' + error.message); return; }
    toast.success(`"${ev.perayaan || ev.nama_event}" berhasil dipublish!`);
    loadEvents();
  }

  async function unpublishEvent(ev) {
    const { error } = await supabase.from('events').update({ is_draft: true, published_at: null }).eq('id', ev.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Event dikembalikan ke draft');
    loadEvents();
  }

  // ── Hapus event ──────────────────────────────────────────────
  async function deleteEvent(ev) {
    // Hapus assignments dulu (cascade mungkin tidak aktif)
    await supabase.from('assignments').delete().eq('event_id', ev.id);
    const { error } = await supabase.from('events').delete().eq('id', ev.id);
    if (error) { toast.error('Gagal hapus: ' + error.message); return; }
    toast.success('Jadwal berhasil dihapus');
    setDeleteConf(null);
    loadEvents();
  }

  // ── Save edit event ──────────────────────────────────────────
  async function saveEditEvent() {
    if (!editEvent) return;
    const { error } = await supabase.from('events').update({
      perayaan:      editEvent.perayaan,
      nama_event:    editEvent.nama_event,
      warna_liturgi: editEvent.warna_liturgi,
      tanggal_latihan: editEvent.tanggal_latihan,
      draft_note:    editEvent.draft_note,
    }).eq('id', editEvent.id);
    if (error) { toast.error('Gagal simpan: ' + error.message); return; }
    toast.success('Jadwal diperbarui!');
    setEditEvent(null);
    loadEvents();
  }

  // ── Generate WA text ─────────────────────────────────────────
  function generateWAText(ev) {
    const asgn   = ev.assignments || [];
    const bySlot = {};
    for (let s = 1; s <= 4; s++) bySlot[s] = asgn.filter(a => a.slot_number === s).map(a => a.users?.nama_panggilan || '?');

    const lines = [
      `PERAYAAN EKARISTI`,
      `${ev.perayaan || ev.nama_event}`,
      `${formatDate(ev.tanggal_latihan,'dd')}–${formatDate(ev.tanggal_tugas,'dd MMMM yyyy')}`,
      '',
    ];
    for (const [slot, label] of Object.entries(SLOT_LABELS)) {
      lines.push(label);
      const names = bySlot[slot] || [];
      if (names.length === 0) lines.push('1. (kosong)\n2. (kosong)');
      else names.forEach((n, i) => lines.push(`${i+1}. ${n}`));
      lines.push('');
    }
    return lines.join('\n');
  }

  async function exportPNG(eventId) {
    const ref = exportRefs.current[eventId];
    if (!ref) return;
    try {
      const png = await toPng(ref, { pixelRatio: 2 });
      const a = document.createElement('a'); a.href = png;
      a.download = `jadwal-${eventId}.png`; a.click();
      toast.success('PNG berhasil diunduh!');
    } catch { toast.error('Gagal export PNG'); }
  }

  const WARNA_OPTIONS = ['Hijau','Merah','Putih','Ungu','MerahMuda','Hitam'];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Jadwal Misa Mingguan</h1>
          <p className="page-subtitle">4 slot · 8 petugas · Draft → Publish</p>
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={() => { if (month===1){setMonth(12);setYear(y=>y-1);}else setMonth(m=>m-1); }} className="btn-ghost p-2"><ChevronLeft size={18}/></button>
          <span className="font-semibold text-gray-700 w-36 text-center">{MONTHS[month-1]} {year}</span>
          <button onClick={() => { if (month===12){setMonth(1);setYear(y=>y+1);}else setMonth(m=>m+1); }} className="btn-ghost p-2"><ChevronRight size={18}/></button>
          <button onClick={generateSchedule} disabled={generating} className="btn-primary gap-2">
            <Zap size={16}/> {generating ? 'Generating...' : 'Generate Draft'}
          </button>
        </div>
      </div>

      {/* Info draft */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-start gap-2 text-sm">
        <FileEdit size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
        <p className="text-blue-700">
          Jadwal yang digenerate berstatus <strong>Draft</strong> — hanya terlihat oleh Admin/Penjadwal.
          Review dan edit sesuai kebutuhan, lalu klik <strong>Publish</strong> agar terlihat di jadwal publik.
        </p>
      </div>

      {/* Events list */}
      {loading ? (
        <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="skeleton h-40 rounded-xl"/>)}</div>
      ) : events.length === 0 ? (
        <div className="card text-center py-14">
          <Calendar size={48} className="mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500 font-medium">Belum ada jadwal untuk {MONTHS[month-1]} {year}</p>
          <button onClick={generateSchedule} disabled={generating} className="btn-primary mt-4 gap-2">
            <Zap size={16}/> Generate Sekarang
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {events.map(ev => {
            const lc   = getLiturgyClass(ev.warna_liturgi);
            const asgn = ev.assignments || [];
            const bySlot = {};
            for (let s=1; s<=4; s++) bySlot[s] = asgn.filter(a=>a.slot_number===s);

            return (
              <div key={ev.id} className={`card border-l-4 ${ev.is_draft ? 'border-yellow-400' : 'border-green-400'}`}>
                {/* Event header */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <div className={`w-3 h-3 rounded-full ${lc.dot}`}/>
                      <span className={`text-xs font-semibold ${lc.text}`}>{ev.warna_liturgi}</span>
                      {ev.is_draft
                        ? <span className="badge-yellow text-xs flex items-center gap-1"><FileEdit size={11}/>Draft</span>
                        : <span className="badge-green text-xs flex items-center gap-1"><Globe size={11}/>Published</span>
                      }
                      <span className="badge-gray text-xs">{ev.tipe_event}</span>
                    </div>
                    <h3 className="font-bold text-gray-900 text-lg leading-tight">{ev.perayaan || ev.nama_event}</h3>
                    <p className="text-sm text-gray-500">
                      Latihan: {formatDate(ev.tanggal_latihan,'EEEE, dd MMM')} ·
                      Tugas: {formatDate(ev.tanggal_tugas,'EEEE, dd MMM yyyy')} ·
                      {asgn.length} petugas
                    </p>
                    {ev.draft_note && (
                      <p className="text-xs text-yellow-700 bg-yellow-50 rounded px-2 py-1 mt-1">📝 {ev.draft_note}</p>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-1 flex-wrap flex-shrink-0">
                    <button onClick={() => setEditEvent({...ev})} className="btn-ghost p-2" title="Edit">
                      <Edit2 size={16} className="text-gray-600"/>
                    </button>
                    {ev.is_draft ? (
                      <button onClick={() => publishEvent(ev)} className="btn-primary btn-sm gap-1" title="Publish">
                        <Globe size={14}/> Publish
                      </button>
                    ) : (
                      <button onClick={() => unpublishEvent(ev)} className="btn-outline btn-sm gap-1" title="Kembalikan ke draft">
                        <Lock size={14}/> Draft
                      </button>
                    )}
                    <button onClick={() => { setWaText(generateWAText(ev)); setShowWA(true); }}
                      className="btn-outline btn-sm gap-1"><Send size={13}/> WA</button>
                    <button onClick={() => exportPNG(ev.id)} className="btn-outline btn-sm gap-1">
                      <Download size={13}/> PNG
                    </button>
                    <button onClick={() => setDeleteConf(ev)} className="btn-ghost p-2 text-red-500 hover:bg-red-50">
                      <Trash2 size={16}/>
                    </button>
                  </div>
                </div>

                {/* Slot grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"
                  ref={el => { exportRefs.current[ev.id] = el; }}>
                  {[1,2,3,4].map(slot => (
                    <div key={slot} className={`p-3 rounded-xl ${lc.bg} border border-gray-100`}>
                      <p className="text-xs font-bold text-gray-600 mb-2">{SLOT_LABELS[slot]}</p>
                      {bySlot[slot]?.length > 0 ? bySlot[slot].map((a, i) => (
                        <div key={i} className="flex items-center gap-1.5 mb-1">
                          <div className="w-5 h-5 rounded-full bg-brand-800/20 flex items-center justify-center text-[10px] font-bold text-brand-800 flex-shrink-0">
                            {i+1}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-800 leading-none">{a.users?.nama_panggilan}</p>
                            <p className="text-[10px] text-gray-400">{a.users?.pendidikan}</p>
                          </div>
                        </div>
                      )) : (
                        <p className="text-xs text-gray-400 italic">Kosong</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit event modal */}
      {editEvent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">Edit Jadwal (Draft)</h3>
              <button onClick={() => setEditEvent(null)}><X size={20}/></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="label">Nama Perayaan</label>
                <input className="input" value={editEvent.perayaan || ''} placeholder="Contoh: MINGGU BIASA XXV"
                  onChange={e => setEditEvent(v => ({...v, perayaan: e.target.value, nama_event: e.target.value.toUpperCase()}))} />
              </div>
              <div>
                <label className="label">Tanggal Latihan</label>
                <input type="date" className="input" value={editEvent.tanggal_latihan || ''}
                  onChange={e => setEditEvent(v => ({...v, tanggal_latihan: e.target.value}))} />
              </div>
              <div>
                <label className="label">Warna Liturgi</label>
                <select className="input" value={editEvent.warna_liturgi || 'Hijau'}
                  onChange={e => setEditEvent(v => ({...v, warna_liturgi: e.target.value}))}>
                  {WARNA_OPTIONS.map(w => <option key={w}>{w}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Catatan Draft (untuk penjadwal)</label>
                <textarea className="input h-20 resize-none" value={editEvent.draft_note || ''}
                  placeholder="Catatan untuk review sebelum publish..."
                  onChange={e => setEditEvent(v => ({...v, draft_note: e.target.value}))} />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={saveEditEvent} className="btn-primary flex-1 gap-2"><Check size={16}/> Simpan</button>
              <button onClick={() => setEditEvent(null)} className="btn-secondary">Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteConf && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle size={24} className="text-red-500"/>
              <h3 className="font-bold text-lg">Hapus Jadwal?</h3>
            </div>
            <p className="text-sm text-gray-600 mb-2">
              Jadwal <strong>"{deleteConf.perayaan || deleteConf.nama_event}"</strong>
              ({formatDate(deleteConf.tanggal_tugas, 'dd MMM yyyy')}) akan dihapus beserta semua penugasannya.
            </p>
            <p className="text-xs text-red-500 mb-4">⚠️ Tindakan ini tidak bisa dibatalkan.</p>
            <div className="flex gap-2">
              <button onClick={() => deleteEvent(deleteConf)} className="btn-danger flex-1">Ya, Hapus</button>
              <button onClick={() => setDeleteConf(null)} className="btn-secondary">Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* WA text modal */}
      {showWA && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">Template WA Jadwal</h3>
              <button onClick={() => setShowWA(false)}><X size={20}/></button>
            </div>
            <textarea className="w-full h-72 font-mono text-xs p-3 border border-gray-200 rounded-xl bg-gray-50 resize-none"
              value={waText} readOnly />
            <div className="flex gap-2 mt-4">
              <button onClick={() => { navigator.clipboard.writeText(waText); toast.success('Disalin!'); }}
                className="btn-primary flex-1">Salin Teks</button>
              <button onClick={() => setShowWA(false)} className="btn-secondary">Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
