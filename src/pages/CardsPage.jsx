import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import jsPDF from 'jspdf';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { buildQRUrl } from '../lib/utils';
import { CreditCard, Download, Search, FileDown, Loader } from 'lucide-react';
import toast from 'react-hot-toast';

// ── Helpers ──────────────────────────────────────────────
function titleCase(str) {
  return (str || '').split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ');
}

async function makeQR(url) {
  return QRCode.toDataURL(url, {
    width: 320, margin: 1,
    color: { dark: '#111111', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  });
}

// ── Canvas card drawing ───────────────────────────────────
// Returns a PNG data URL
async function drawCard(member, qrDataUrl, type) {
  const W = 400, H = 240, R = 18, SCALE = 3;
  const canvas = document.createElement('canvas');
  canvas.width  = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  const isTugas = type === 'tugas';
  const name    = titleCase(member.nama_panggilan || member.nickname);
  const linkg   = member.lingkungan || '';

  // ── Background ────────────────────────────────────────
  ctx.save();
  // Rounded rect clip
  roundRect(ctx, 0, 0, W, H, R);
  ctx.clip();

  if (isTugas) {
    // Krem gradient
    const grd = ctx.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, '#FFFDF0');
    grd.addColorStop(1, '#FFF7D4');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);
  } else {
    // Merah gradient
    const grd = ctx.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, '#9B0000');
    grd.addColorStop(1, '#6B0000');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);
  }

  // ── Decorative shapes ────────────────────────────────
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = isTugas ? '#B45309' : '#ffffff';
  ctx.beginPath(); ctx.arc(W - 40, -30, 90, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-20, H + 20, 70, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(W/2, H*1.3, 60, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  // ── Left stripe accent ────────────────────────────────
  ctx.fillStyle = isTugas ? '#D97706' : 'rgba(255,255,255,0.15)';
  ctx.fillRect(0, 0, 4, H);

  // ── QR area (right side) ──────────────────────────────
  const qrSize  = 110;
  const qrX     = W - qrSize - 18;
  const qrY     = (H - qrSize) / 2;

  // QR background card
  ctx.fillStyle = isTugas ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.12)';
  roundRect(ctx, qrX - 8, qrY - 8, qrSize + 16, qrSize + 16, 10);
  ctx.fill();

  // QR border
  ctx.strokeStyle = isTugas ? '#FCD34D' : 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, qrX - 8, qrY - 8, qrSize + 16, qrSize + 16, 10);
  ctx.stroke();

  ctx.restore();

  // Draw QR image
  await new Promise(res => {
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, qrX, qrY, qrSize, qrSize); res(); };
    img.src = qrDataUrl;
  });

  // ── Text content ──────────────────────────────────────
  const textColor    = isTugas ? '#1C1917' : '#FFFFFF';
  const subColor     = isTugas ? '#92400E' : '#FECACA';
  const subtitleColor= isTugas ? '#D97706' : '#FCA5A5';

  // Type label (small caps)
  ctx.font = '600 9px "Inter", sans-serif';
  ctx.fillStyle = subtitleColor;
  ctx.letterSpacing = '3px';
  ctx.fillText((isTugas ? 'KARTU TUGAS' : 'KARTU LATIHAN').toUpperCase(), 20, 28);

  // SIGMA large
  ctx.font = 'bold 30px "Inter", sans-serif';
  ctx.fillStyle = textColor;
  ctx.fillText('SIGMA', 20, 62);

  // Subtitle
  ctx.font = '10px "Inter", sans-serif';
  ctx.fillStyle = subtitleColor;
  ctx.fillText('Misdinar Kristus Raja Solo Baru', 20, 77);

  // Divider line
  ctx.strokeStyle = isTugas ? 'rgba(180,83,9,0.2)' : 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(20, 84); ctx.lineTo(qrX - 20, 84); ctx.stroke();

  // Name
  ctx.font = 'bold 18px "Inter", sans-serif';
  ctx.fillStyle = textColor;
  ctx.fillText(truncName(name, 22), 20, H - 60);

  // Lingkungan
  ctx.font = '11px "Inter", sans-serif';
  ctx.fillStyle = subColor;
  ctx.fillText(linkg, 20, H - 44);

  // Bottom message
  ctx.font = 'italic 8.5px "Inter", sans-serif';
  ctx.fillStyle = subColor;
  ctx.fillText(
    isTugas
      ? 'Silakan tunjukkan kartu ini kepada PIC'
      : 'Silakan tunjukkan kartu ini kepada Pelatih',
    20, H - 22
  );

  // Handle (small)
  ctx.font = '8px "Inter", sans-serif';
  ctx.fillStyle = isTugas ? 'rgba(120,60,0,0.4)' : 'rgba(255,255,255,0.35)';
  ctx.fillText('@misdinarkrsoba', 20, H - 10);

  // Tagline under QR
  ctx.font = 'italic 7px "Inter", sans-serif';
  ctx.fillStyle = subColor;
  ctx.textAlign = 'center';
  ctx.fillText('Serve Lord With Gladness', qrX + qrSize / 2, qrY + qrSize + 12);
  ctx.textAlign = 'left';

  // ── Border ────────────────────────────────────────────
  ctx.save();
  roundRect(ctx, 0, 0, W, H, R);
  ctx.strokeStyle = isTugas ? '#FCD34D' : 'rgba(255,255,255,0.1)';
  ctx.lineWidth = isTugas ? 2 : 0;
  ctx.stroke();
  ctx.restore();

  return canvas.toDataURL('image/png');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function truncName(name, maxLen) {
  return name.length > maxLen ? name.slice(0, maxLen - 1) + '…' : name;
}

// ═════════════════════════════════════════════════════════
export default function CardsPage() {
  const { profile, isPengurus } = useAuth();
  const [members,    setMembers]  = useState([]);
  const [selected,   setSelected] = useState(null);
  const [search,     setSearch]   = useState('');
  const [cardPngs,   setCardPngs] = useState({ latihan: '', tugas: '' });
  const [loading,    setLoading]  = useState(false);
  const [bulkProg,   setBulkProg] = useState(null);

  useEffect(() => {
    supabase.from('users')
      .select('id, nickname, myid, nama_panggilan, lingkungan, status')
      .eq('status', 'Active').order('nama_panggilan')
      .then(({ data }) => {
        setMembers(data || []);
        if (!isPengurus && profile) {
          const me = (data || []).find(m => m.id === profile.id);
          if (me) setSelected(me);
        }
      });
  }, [profile, isPengurus]);

  const displayMember = selected || (members.length ? members[0] : null);

  // Regenerate cards when member changes
  useEffect(() => {
    if (!displayMember?.myid) return;
    let cancelled = false;
    setCardPngs({ latihan: '', tugas: '' });
    (async () => {
      const lUrl = buildQRUrl(displayMember.nickname, displayMember.myid, 'latihan');
      const tUrl = buildQRUrl(displayMember.nickname, displayMember.myid, 'tugas');
      const [lQR, tQR] = await Promise.all([makeQR(lUrl), makeQR(tUrl)]);
      if (cancelled) return;
      const [lPng, tPng] = await Promise.all([
        drawCard(displayMember, lQR, 'latihan'),
        drawCard(displayMember, tQR, 'tugas'),
      ]);
      if (!cancelled) setCardPngs({ latihan: lPng, tugas: tPng });
    })();
    return () => { cancelled = true; };
  }, [displayMember?.id]);

  function downloadPNG(type) {
    const a = document.createElement('a');
    a.href = cardPngs[type];
    a.download = `kartu-${type}-${displayMember?.nickname}.png`;
    a.click();
  }

  function downloadPDF() {
    if (!cardPngs.latihan || !cardPngs.tugas) return;
    // Business card size landscape: 90mm × 54mm
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [90, 54] });
    pdf.addImage(cardPngs.latihan, 'PNG', 0, 0, 90, 54);
    pdf.addPage([90, 54], 'landscape');
    pdf.addImage(cardPngs.tugas,   'PNG', 0, 0, 90, 54);
    pdf.save(`kartu-${displayMember?.nickname}.pdf`);
    toast.success('PDF 2 kartu diunduh!');
  }

  async function bulkExport() {
    if (!isPengurus || !members.length) return;
    setLoading(true);
    setBulkProg({ done: 0, total: members.length });
    const pdf   = new jsPDF({ unit: 'mm', format: 'a4' });
    const CW = 88, CH = 53, GAP_X = 5, GAP_Y = 6, MARGIN = 10;
    const COLS = 2, ROWS = 3; // 2×3 = 6 pasang kartu per halaman
    let pageItem = 0;

    try {
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        if (!m.myid) { setBulkProg(p => ({ ...p, done: i + 1 })); continue; }

        const lUrl = buildQRUrl(m.nickname, m.myid, 'latihan');
        const tUrl = buildQRUrl(m.nickname, m.myid, 'tugas');
        const [lQR, tQR] = await Promise.all([makeQR(lUrl), makeQR(tUrl)]);
        const [lPng, tPng] = await Promise.all([
          drawCard(m, lQR, 'latihan'),
          drawCard(m, tQR, 'tugas'),
        ]);

        if (pageItem > 0 && pageItem % (COLS * ROWS) === 0) {
          pdf.addPage();
        }

        const row = Math.floor((pageItem % (COLS * ROWS)) / COLS);
        const col = (pageItem % (COLS * ROWS)) % COLS;
        const x   = MARGIN + col * (CW + GAP_X);
        const y   = MARGIN + row * (CH + GAP_Y);

        pdf.addImage(lPng, 'PNG', x, y, CW, CH);

        // Tugas kartu di bawah latihan (same column, offset rows)
        const y2 = MARGIN + (row + ROWS) * (CH + GAP_Y);
        if (y2 + CH < 297 - MARGIN) {
          pdf.addImage(tPng, 'PNG', x, y2, CW, CH);
        } else {
          // Next page for tugas
          pdf.addPage();
          pdf.addImage(tPng, 'PNG', x, MARGIN, CW, CH);
        }

        pageItem++;
        setBulkProg({ done: i + 1, total: members.length });
      }
      pdf.save('semua-kartu-sigma.pdf');
      toast.success(`${members.length} kartu diekspor!`);
    } catch (err) {
      toast.error('Gagal: ' + err.message);
    } finally {
      setLoading(false);
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
          <p className="page-subtitle">Kartu QR untuk scan absensi · Latihan & Tugas</p>
        </div>
        {isPengurus && (
          <button onClick={bulkExport} disabled={loading} className="btn-outline gap-2">
            <FileDown size={16}/>
            {loading && bulkProg ? `${bulkProg.done}/${bulkProg.total}...` : 'Bulk Export PDF'}
          </button>
        )}
      </div>

      {/* Progress */}
      {bulkProg && (
        <div className="space-y-1">
          <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
            <div className="bg-brand-800 h-2 rounded-full transition-all duration-300"
              style={{ width: `${Math.round(bulkProg.done / bulkProg.total * 100)}%` }}/>
          </div>
          <p className="text-xs text-gray-500 text-center">
            Memproses {bulkProg.done} dari {bulkProg.total} kartu...
          </p>
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
            <div className="max-h-80 overflow-y-auto space-y-0.5">
              {filtered.map(m => (
                <button key={m.id} onClick={() => setSelected(m)}
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

        <div className={`${isPengurus ? 'lg:col-span-2' : 'lg:col-span-3'} space-y-5`}>
          {!displayMember ? (
            <div className="card text-center py-12 text-gray-400">
              <CreditCard size={40} className="mx-auto mb-3 opacity-30"/>
              <p>Pilih anggota untuk melihat kartu</p>
            </div>
          ) : (
            <>
              {/* Cards side by side */}
              <div className="flex flex-wrap gap-6 justify-center items-start">
                {(['latihan', 'tugas'] ).map(type => (
                  <div key={type} className="flex flex-col items-center gap-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {type === 'latihan' ? 'Kartu Latihan' : 'Kartu Tugas'}
                    </p>

                    {/* Card preview — 5:3 aspect */}
                    <div className="w-80 h-48 rounded-2xl overflow-hidden shadow-2xl relative">
                      {cardPngs[type] ? (
                        <img src={cardPngs[type]} alt={`Kartu ${type}`}
                          className="w-full h-full object-cover"/>
                      ) : (
                        <div className={`w-full h-full flex items-center justify-center ${
                          type === 'latihan' ? 'bg-brand-800' : 'bg-amber-50 border-2 border-amber-300'
                        }`}>
                          <Loader size={28} className={type === 'latihan' ? 'text-white' : 'text-amber-400'} />
                        </div>
                      )}
                    </div>

                    <button onClick={() => downloadPNG(type)}
                      disabled={!cardPngs[type]}
                      className="btn-secondary btn-sm gap-1.5 w-full">
                      <Download size={13}/> Download PNG
                    </button>
                  </div>
                ))}
              </div>

              {/* PDF download */}
              <div className="flex justify-center">
                <button onClick={downloadPDF}
                  disabled={!cardPngs.latihan || !cardPngs.tugas}
                  className="btn-primary gap-2 px-8">
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
