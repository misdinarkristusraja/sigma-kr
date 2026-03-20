import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import jsPDF from 'jspdf';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { buildQRUrl } from '../lib/utils';
import { CreditCard, Download, Search, FileDown, Loader } from 'lucide-react';
import toast from 'react-hot-toast';

// Capitalize each word
function titleCase(str) {
  if (!str) return '';
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Generate QR as data URL directly (no DOM dependency)
async function makeQR(url) {
  return QRCode.toDataURL(url, { width: 256, margin: 1, color: { dark: '#1a1a1a', light: '#ffffff' } });
}

// Draw one card to an offscreen canvas and return PNG data URL
// type: 'latihan' | 'tugas'
function drawCardToCanvas(member, qrDataUrl, type) {
  const W = 360, H = 220;
  const canvas = document.createElement('canvas');
  canvas.width = W * 3; canvas.height = H * 3; // 3x for sharpness
  const ctx = canvas.getContext('2d');
  ctx.scale(3, 3);

  const isTugas = type === 'tugas';

  // Background
  if (isTugas) {
    ctx.fillStyle = '#fefdf4';
    ctx.roundRect(0, 0, W, H, 16); ctx.fill();
    ctx.strokeStyle = '#fcd34d'; ctx.lineWidth = 2;
    ctx.roundRect(0, 0, W, H, 16); ctx.stroke();
  } else {
    ctx.fillStyle = '#8B0000';
    ctx.roundRect(0, 0, W, H, 16); ctx.fill();
  }

  // Decorative circles
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = isTugas ? '#d97706' : '#ffffff';
  ctx.beginPath(); ctx.arc(W - 30, -20, 55, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(-20, H + 15, 45, 0, Math.PI*2); ctx.fill();
  ctx.globalAlpha = 1;

  // Card type label
  ctx.font = '600 9px Inter, sans-serif';
  ctx.fillStyle = isTugas ? '#d97706' : '#fca5a5';
  ctx.letterSpacing = '2px';
  ctx.fillText((isTugas ? 'KARTU TUGAS' : 'KARTU LATIHAN'), 20, 30);

  // SIGMA title
  ctx.font = 'bold 28px Inter, sans-serif';
  ctx.fillStyle = isTugas ? '#8B0000' : '#ffffff';
  ctx.fillText('SIGMA', 20, 60);

  // Subtitle
  ctx.font = '9px Inter, sans-serif';
  ctx.fillStyle = isTugas ? '#d97706' : '#fca5a5';
  ctx.fillText('Misdinar Kristus Raja', 20, 74);

  // Name (UpperCase first letter each word)
  const displayName = titleCase(member.nama_panggilan || member.nickname);
  ctx.font = 'bold 16px Inter, sans-serif';
  ctx.fillStyle = isTugas ? '#111827' : '#ffffff';
  ctx.fillText(displayName, 20, H - 48);

  // Lingkungan
  ctx.font = '11px Inter, sans-serif';
  ctx.fillStyle = isTugas ? '#6b7280' : '#fca5a5';
  ctx.fillText(member.lingkungan || '', 20, H - 33);

  // Bottom text
  ctx.font = 'italic 8px Inter, sans-serif';
  ctx.fillStyle = isTugas ? '#9ca3af' : '#fca5a5';
  ctx.fillText(isTugas
    ? 'Silakan tunjukkan kartu ini kepada PIC'
    : 'Silakan tunjukkan kartu ini kepada Pelatih',
    20, H - 18);
  ctx.fillText('@misdinarkrsoba', 20, H - 8);

  // QR Code
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const qrSize = 100, qrX = W - qrSize - 16, qrY = (H - qrSize) / 2;
      if (isTugas) {
        ctx.fillStyle = '#fffbeb';
        ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 1;
        ctx.roundRect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8, 8);
        ctx.fill(); ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.roundRect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8, 8);
        ctx.fill();
      }
      ctx.drawImage(img, qrX, qrY, qrSize, qrSize);

      // Tagline under QR
      ctx.font = 'italic 7px Inter, sans-serif';
      ctx.fillStyle = isTugas ? '#9ca3af' : '#fca5a5';
      ctx.textAlign = 'center';
      ctx.fillText('Serve Lord With Gladness', qrX + qrSize/2, qrY + qrSize + 12);
      ctx.textAlign = 'left';

      resolve(canvas.toDataURL('image/png'));
    };
    img.src = qrDataUrl;
  });
}

export default function CardsPage() {
  const { profile, isPengurus } = useAuth();
  const [members,    setMembers]    = useState([]);
  const [selected,   setSelected]   = useState(null);
  const [search,     setSearch]     = useState('');
  const [qrUrls,     setQrUrls]     = useState({ latihan: '', tugas: '' });
  const [cardPngs,   setCardPngs]   = useState({ latihan: '', tugas: '' });
  const [generating, setGenerating] = useState(false);
  const [bulkProg,   setBulkProg]   = useState(null); // null | { done, total }

  useEffect(() => {
    supabase.from('users')
      .select('id, nickname, myid, nama_panggilan, lingkungan, status')
      .eq('status', 'Active')
      .order('nama_panggilan')
      .then(({ data }) => {
        setMembers(data || []);
        if (!isPengurus && profile) {
          const me = (data||[]).find(m => m.id === profile.id);
          if (me) setSelected(me);
        }
      });
  }, [profile, isPengurus]);

  const displayMember = selected || (members.length ? members[0] : null);

  // Generate preview cards whenever displayMember changes
  useEffect(() => {
    if (!displayMember) return;
    let cancelled = false;
    (async () => {
      const lUrl = buildQRUrl(displayMember.nickname, displayMember.myid, 'latihan');
      const tUrl = buildQRUrl(displayMember.nickname, displayMember.myid, 'tugas');
      const [lQR, tQR] = await Promise.all([makeQR(lUrl), makeQR(tUrl)]);
      if (cancelled) return;
      setQrUrls({ latihan: lQR, tugas: tQR });
      const [lPng, tPng] = await Promise.all([
        drawCardToCanvas(displayMember, lQR, 'latihan'),
        drawCardToCanvas(displayMember, tQR, 'tugas'),
      ]);
      if (!cancelled) setCardPngs({ latihan: lPng, tugas: tPng });
    })();
    return () => { cancelled = true; };
  }, [displayMember?.id]);

  function downloadPNG(type) {
    const link = document.createElement('a');
    link.href = cardPngs[type];
    link.download = `kartu-${type}-${displayMember?.nickname}.png`;
    link.click();
  }

  function downloadPDF() {
    if (!cardPngs.latihan || !cardPngs.tugas) return;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [90, 55] });
    pdf.addImage(cardPngs.latihan, 'PNG', 0, 0, 90, 55);
    pdf.addPage([90, 55], 'landscape');
    pdf.addImage(cardPngs.tugas,   'PNG', 0, 0, 90, 55);
    pdf.save(`kartu-${displayMember?.nickname}.pdf`);
  }

  async function bulkExport() {
    if (!isPengurus || !members.length) return;
    setGenerating(true);
    setBulkProg({ done: 0, total: members.length });

    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const CW = 88, CH = 54, gapX = 4, gapY = 6;
    const cols = 2, perPage = 4; // 2 cols × 2 rows (latihan+tugas side by side per member)
    let pageCount = 0;

    try {
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        const lUrl = buildQRUrl(m.nickname, m.myid, 'latihan');
        const tUrl = buildQRUrl(m.nickname, m.myid, 'tugas');
        const [lQR, tQR] = await Promise.all([makeQR(lUrl), makeQR(tUrl)]);
        const [lPng, tPng] = await Promise.all([
          drawCardToCanvas(m, lQR, 'latihan'),
          drawCardToCanvas(m, tQR, 'tugas'),
        ]);

        const row = Math.floor(pageCount % (perPage)) ;
        if (pageCount > 0 && pageCount % perPage === 0) { pdf.addPage(); }

        const rowInPage = Math.floor((pageCount % perPage));
        const y = 10 + rowInPage * (CH + gapY);
        pdf.addImage(lPng, 'PNG', 10,           y, CW, CH);
        pdf.addImage(tPng, 'PNG', 10 + CW + gapX, y, CW, CH);
        pageCount++;

        setBulkProg({ done: i + 1, total: members.length });
      }

      pdf.save('semua-kartu-sigma.pdf');
      toast.success(`${members.length} kartu berhasil diekspor!`);
    } catch (err) {
      toast.error('Gagal export: ' + err.message);
    } finally {
      setGenerating(false);
      setBulkProg(null);
    }
  }

  const filtered = members.filter(m =>
    !search ||
    m.nama_panggilan?.toLowerCase().includes(search.toLowerCase()) ||
    m.nickname?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Kartu Anggota</h1>
          <p className="page-subtitle">Download kartu QR untuk absensi</p>
        </div>
        {isPengurus && (
          <button onClick={bulkExport} disabled={generating} className="btn-outline gap-2">
            <FileDown size={16}/>
            {generating
              ? bulkProg ? `${bulkProg.done}/${bulkProg.total} kartu...` : 'Memulai...'
              : 'Bulk Export PDF'
            }
          </button>
        )}
      </div>

      {/* Progress bar bulk */}
      {bulkProg && (
        <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
          <div className="bg-brand-800 h-2 rounded-full transition-all duration-300"
            style={{ width: `${Math.round(bulkProg.done / bulkProg.total * 100)}%` }}/>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {isPengurus && (
          <div className="card space-y-3">
            <h3 className="font-semibold text-gray-700 text-sm">Pilih Anggota</h3>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input className="input pl-8 text-sm" placeholder="Cari nama..."
                value={search} onChange={e => setSearch(e.target.value)}/>
            </div>
            <div className="max-h-80 overflow-y-auto space-y-1">
              {filtered.map(m => (
                <button key={m.id}
                  onClick={() => setSelected(m)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    selected?.id === m.id ? 'bg-brand-800 text-white' : 'hover:bg-gray-50'
                  }`}>
                  <div className="font-medium">{titleCase(m.nama_panggilan)}</div>
                  <div className={`text-xs ${selected?.id === m.id ? 'text-brand-200' : 'text-gray-400'}`}>
                    @{m.nickname} · {m.lingkungan}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={`${isPengurus ? 'lg:col-span-2' : 'lg:col-span-3'} space-y-4`}>
          {!displayMember ? (
            <div className="card text-center py-12 text-gray-400">
              <CreditCard size={40} className="mx-auto mb-3 opacity-30"/>
              <p>Pilih anggota untuk melihat kartu</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-6 justify-center">
                {/* Latihan card */}
                <div>
                  <p className="text-xs text-gray-500 text-center mb-2 font-medium">Kartu Latihan</p>
                  <div className="w-80 h-48 rounded-2xl overflow-hidden shadow-xl">
                    {cardPngs.latihan
                      ? <img src={cardPngs.latihan} alt="Kartu Latihan" className="w-full h-full object-cover"/>
                      : <div className="w-full h-full bg-brand-800 flex items-center justify-center">
                          <Loader size={24} className="text-white animate-spin"/>
                        </div>
                    }
                  </div>
                  <button onClick={() => downloadPNG('latihan')}
                    disabled={!cardPngs.latihan}
                    className="mt-2 w-full btn-secondary btn-sm gap-1">
                    <Download size={13}/> Download PNG
                  </button>
                </div>

                {/* Tugas card */}
                <div>
                  <p className="text-xs text-gray-500 text-center mb-2 font-medium">Kartu Tugas</p>
                  <div className="w-80 h-48 rounded-2xl overflow-hidden shadow-xl border-2 border-amber-300">
                    {cardPngs.tugas
                      ? <img src={cardPngs.tugas} alt="Kartu Tugas" className="w-full h-full object-cover"/>
                      : <div className="w-full h-full bg-amber-50 flex items-center justify-center">
                          <Loader size={24} className="text-amber-400 animate-spin"/>
                        </div>
                    }
                  </div>
                  <button onClick={() => downloadPNG('tugas')}
                    disabled={!cardPngs.tugas}
                    className="mt-2 w-full btn-secondary btn-sm gap-1">
                    <Download size={13}/> Download PNG
                  </button>
                </div>
              </div>

              {/* Download PDF both */}
              <div className="flex justify-center">
                <button onClick={downloadPDF}
                  disabled={!cardPngs.latihan || !cardPngs.tugas}
                  className="btn-primary gap-2">
                  <FileDown size={16}/> Download PDF (2 Kartu)
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
