import React, { useRef, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { buildQRUrl, truncate } from '../lib/utils';
import QRCode from 'qrcode';
import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';
import { Download, FileDown, Loader, CreditCard, RefreshCw, Search } from 'lucide-react';
import toast from 'react-hot-toast';

export default function CardsPage() {
  const { profile, isPengurus } = useAuth();
  const [members, setMembers]   = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch]     = useState('');
  const [loading, setLoading]   = useState(true);
  const [genLoading, setGenLoading] = useState(false);
  const [qrData, setQrData]     = useState({ latihan: null, tugas: null });
  const latihanRef = useRef(null);
  const tugasRef   = useRef(null);

  useEffect(() => { loadMembers(); }, []);
  useEffect(() => {
    const m = selected || (profile?.role === 'Misdinar_Aktif' ? profile : null);
    if (m) generateQRs(m);
  }, [selected, profile]);

  async function loadMembers() {
    setLoading(true);
    const { data } = await supabase
      .from('users')
      .select('id, nickname, myid, nama_panggilan, lingkungan, status')
      .eq('status', 'Active')
      .order('nama_panggilan');
    setMembers(data || []);
    setLoading(false);
  }

  async function generateQRs(member) {
    if (!member?.myid) return;
    const latihanUrl = buildQRUrl(member.nickname, member.myid, 'latihan');
    const tugasUrl   = buildQRUrl(member.nickname, member.myid, 'tugas');
    const [lat, tug] = await Promise.all([
      QRCode.toDataURL(latihanUrl, { width: 220, margin: 1, color: { dark: '#ffffff', light: '#8B0000' } }),
      QRCode.toDataURL(tugasUrl,   { width: 220, margin: 1, color: { dark: '#1a1a1a', light: '#fefdf4' } }),
    ]);
    setQrData({ latihan: lat, tugas: tug });
  }

  const targetMember = selected || (isPengurus ? null : profile);

  async function downloadCard(type) {
    const ref = type === 'latihan' ? latihanRef : tugasRef;
    if (!ref.current) return;
    setGenLoading(true);
    try {
      const png = await toPng(ref.current, { pixelRatio: 3, cacheBust: true });
      const link = document.createElement('a');
      link.href = png;
      link.download = `kartu-${type}-${targetMember?.nickname}.png`;
      link.click();
      toast.success(`Kartu ${type} berhasil diunduh!`);
    } catch {
      toast.error('Gagal generate gambar');
    } finally {
      setGenLoading(false);
    }
  }

  async function downloadBothAsPDF() {
    if (!latihanRef.current || !tugasRef.current) return;
    setGenLoading(true);
    try {
      const [lPng, tPng] = await Promise.all([
        toPng(latihanRef.current, { pixelRatio: 3 }),
        toPng(tugasRef.current,   { pixelRatio: 3 }),
      ]);
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const W = 90, H = 55;
      pdf.addImage(lPng, 'PNG', 10, 10, W, H);
      pdf.addImage(tPng, 'PNG', 110, 10, W, H);
      pdf.save(`kartu-${targetMember?.nickname}.pdf`);
      toast.success('PDF berhasil diunduh!');
    } catch {
      toast.error('Gagal generate PDF');
    } finally {
      setGenLoading(false);
    }
  }

  async function bulkExport() {
    if (!isPengurus) return;
    setGenLoading(true);
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    let x = 10, y = 10, count = 0;
    try {
      for (const m of members) {
        await generateQRs(m);
        await new Promise(r => setTimeout(r, 100)); // wait for QR render
        if (latihanRef.current && tugasRef.current) {
          const lPng = await toPng(latihanRef.current, { pixelRatio: 2 });
          const tPng = await toPng(tugasRef.current,   { pixelRatio: 2 });
          if (count > 0 && count % 8 === 0) { pdf.addPage(); x = 10; y = 10; }
          pdf.addImage(lPng, 'PNG', x, y, 88, 54);
          pdf.addImage(tPng, 'PNG', x + 100, y, 88, 54);
          y += 60;
          count++;
        }
      }
      pdf.save('semua-kartu-sigma.pdf');
      toast.success(`${count} kartu berhasil diekspor!`);
    } catch (err) {
      toast.error('Gagal bulk export');
    } finally {
      setGenLoading(false);
    }
  }

  const filteredMembers = members.filter(m =>
    !search || m.nama_panggilan?.toLowerCase().includes(search.toLowerCase()) ||
    m.nickname?.toLowerCase().includes(search.toLowerCase())
  );

  const displayMember = targetMember || members[0];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Kartu Anggota</h1>
          <p className="page-subtitle">Download kartu QR untuk absensi</p>
        </div>
        {isPengurus && (
          <button onClick={bulkExport} disabled={genLoading} className="btn-outline gap-2">
            <FileDown size={16} />
            {genLoading ? 'Generating...' : 'Bulk Export PDF'}
          </button>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Member picker (pengurus only) */}
        {isPengurus && (
          <div className="card space-y-3">
            <h3 className="font-semibold text-gray-700 text-sm">Pilih Anggota</h3>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pl-8 text-sm" placeholder="Cari nama..." value={search}
                onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="max-h-80 overflow-y-auto space-y-1">
              {filteredMembers.map(m => (
                <button key={m.id}
                  onClick={() => { setSelected(m); setQrData({latihan:null,tugas:null}); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    selected?.id === m.id ? 'bg-brand-800 text-white' : 'hover:bg-gray-50'
                  }`}>
                  <div className="font-medium">{m.nama_panggilan}</div>
                  <div className={`text-xs ${selected?.id === m.id ? 'text-brand-200' : 'text-gray-400'}`}>
                    @{m.nickname} · {m.lingkungan}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Card preview */}
        <div className={`${isPengurus ? 'lg:col-span-2' : 'lg:col-span-3'} space-y-4`}>
          {!displayMember ? (
            <div className="card text-center py-12 text-gray-400">
              <CreditCard size={40} className="mx-auto mb-3 opacity-30" />
              <p>Pilih anggota untuk melihat kartu</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-4 justify-center">
                {/* Kartu Latihan — Merah */}
                <div>
                  <p className="text-xs text-gray-500 text-center mb-2 font-medium">Kartu Latihan</p>
                  <div ref={latihanRef} className="w-80 h-48 bg-brand-800 rounded-2xl p-5 shadow-xl relative overflow-hidden" style={{ fontFamily: 'Inter, sans-serif' }}>
                    {/* Decorative circle */}
                    <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/5 rounded-full" />
                    <div className="absolute -bottom-6 -left-6 w-24 h-24 bg-white/5 rounded-full" />

                    <div className="relative z-10 flex items-start justify-between h-full">
                      <div className="flex flex-col justify-between h-full">
                        <div>
                          <p className="text-[10px] text-brand-200 font-semibold tracking-widest uppercase">Kartu Latihan</p>
                          <p className="text-white font-black text-2xl leading-none mt-0.5">SIGMA</p>
                          <p className="text-brand-200 text-[9px] mt-0.5">Misdinar Kristus Raja</p>
                        </div>
                        <div>
                          <p className="text-white font-bold text-base leading-none">{displayMember.nama_panggilan}</p>
                          <p className="text-brand-200 text-xs mt-0.5">{displayMember.lingkungan}</p>
                          <p className="text-brand-300 text-[9px] mt-2 italic">Silahkan tunjukan kartu ini kepada pelatih</p>
                          <p className="text-brand-300 text-[9px]">@misdinarkrsoba</p>
                        </div>
                      </div>
                      {/* QR */}
                      <div className="flex-shrink-0">
                        {qrData.latihan ? (
                          <img src={qrData.latihan} alt="QR" className="w-28 h-28 rounded-xl" />
                        ) : (
                          <div className="w-28 h-28 bg-brand-700 rounded-xl flex items-center justify-center">
                            <Loader size={20} className="text-brand-300 animate-spin" />
                          </div>
                        )}
                        <p className="text-brand-300 text-[8px] text-center mt-1 italic">Serve Lord With Gladness</p>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => downloadCard('latihan')} disabled={genLoading || !qrData.latihan}
                    className="mt-2 w-full btn-secondary btn-sm gap-1">
                    <Download size={13} /> Download PNG
                  </button>
                </div>

                {/* Kartu Tugas — Krem */}
                <div>
                  <p className="text-xs text-gray-500 text-center mb-2 font-medium">Kartu Tugas</p>
                  <div ref={tugasRef} className="w-80 h-48 rounded-2xl p-5 shadow-xl relative overflow-hidden border-2 border-amber-300"
                    style={{ background: '#fefdf4', fontFamily: 'Inter, sans-serif' }}>
                    <div className="absolute -top-8 -right-8 w-32 h-32 bg-amber-100/50 rounded-full" />
                    <div className="absolute -bottom-6 -left-6 w-24 h-24 bg-amber-100/50 rounded-full" />

                    <div className="relative z-10 flex items-start justify-between h-full">
                      <div className="flex flex-col justify-between h-full">
                        <div>
                          <p className="text-[10px] text-amber-600 font-semibold tracking-widest uppercase">Kartu Tugas</p>
                          <p className="text-brand-800 font-black text-2xl leading-none mt-0.5">SIGMA</p>
                          <p className="text-amber-600 text-[9px] mt-0.5">Misdinar Kristus Raja</p>
                        </div>
                        <div>
                          <p className="text-gray-900 font-bold text-base leading-none">{displayMember.nama_panggilan}</p>
                          <p className="text-gray-500 text-xs mt-0.5">{displayMember.lingkungan}</p>
                          <p className="text-gray-400 text-[9px] mt-2 italic">Silahkan tunjukan kartu ini kepada pelatih</p>
                          <p className="text-gray-400 text-[9px]">@misdinarkrsoba</p>
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        {qrData.tugas ? (
                          <img src={qrData.tugas} alt="QR" className="w-28 h-28 rounded-xl border border-amber-200" />
                        ) : (
                          <div className="w-28 h-28 bg-amber-50 rounded-xl flex items-center justify-center border border-amber-200">
                            <Loader size={20} className="text-amber-400 animate-spin" />
                          </div>
                        )}
                        <p className="text-gray-400 text-[8px] text-center mt-1 italic">Serve Lord With Gladness</p>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => downloadCard('tugas')} disabled={genLoading || !qrData.tugas}
                    className="mt-2 w-full btn-secondary btn-sm gap-1">
                    <Download size={13} /> Download PNG
                  </button>
                </div>
              </div>

              {/* Download both */}
              <div className="flex justify-center">
                <button onClick={downloadBothAsPDF} disabled={genLoading || !qrData.latihan || !qrData.tugas}
                  className="btn-primary gap-2">
                  <FileDown size={16} />
                  {genLoading ? 'Menggenerate...' : 'Download Keduanya (PDF)'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
