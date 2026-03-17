// ─── MemberDetailPage.jsx ───────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, ROLE_LABELS, STATUS_LABELS, buildWALink } from '../lib/utils';
import { ArrowLeft, CreditCard, BarChart2, Calendar, Phone, Shield } from 'lucide-react';

export function MemberDetailPage() {
  const { id } = useParams();
  const { isPengurus } = useAuth();
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('users').select('*').eq('id', id).single()
      .then(({ data }) => { setMember(data); setLoading(false); });
  }, [id]);

  if (loading) return <div className="skeleton h-64 rounded-xl" />;
  if (!member)  return <div className="card text-center py-10 text-gray-400">Anggota tidak ditemukan</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/anggota" className="btn-ghost p-2"><ArrowLeft size={20} /></Link>
        <div>
          <h1 className="page-title">{member.nama_panggilan}</h1>
          <p className="page-subtitle">@{member.nickname} · {member.lingkungan}</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="font-semibold text-gray-700 mb-3">Data Diri</h3>
          <dl className="space-y-2 text-sm">
            {[
              ['Nama Lengkap', member.nama_lengkap],
              ['Nickname', `@${member.nickname}`],
              ['Pendidikan', member.pendidikan],
              ['Sekolah', member.sekolah],
              ['Lingkungan', member.lingkungan],
              ['Wilayah', member.wilayah],
              ['MyID', member.myid],
              ['Role', ROLE_LABELS[member.role]],
              ['Status', STATUS_LABELS[member.status]],
              ...(isPengurus ? [
                ['HP Anak', member.hp_anak],
                ['HP Ortu', member.hp_ortu],
                ['Nama Ayah', member.nama_ayah],
                ['Nama Ibu', member.nama_ibu],
              ] : []),
            ].map(([k, v]) => v ? (
              <div key={k} className="flex gap-2">
                <dt className="text-gray-400 w-32 flex-shrink-0">{k}</dt>
                <dd className="font-medium text-gray-800">{v}</dd>
              </div>
            ) : null)}
          </dl>
        </div>

        <div className="space-y-3">
          <div className="card">
            <h3 className="font-semibold text-gray-700 mb-2">Alasan Bergabung</h3>
            <p className="text-sm text-gray-600 italic">{member.alasan_masuk || '—'}</p>
          </div>
          <div className="card">
            <h3 className="font-semibold text-gray-700 mb-2">Rencana</h3>
            <p className="text-sm text-gray-600">{member.sampai_kapan || '—'}</p>
          </div>
          {member.is_tarakanita && (
            <div className="card bg-blue-50 border-blue-100">
              <p className="text-sm font-semibold text-blue-800">🏫 Siswa Tarakanita</p>
              <p className="text-xs text-blue-600 mt-1">Otomatis terjadwal Misa Harian setiap hari kerja.</p>
            </div>
          )}
          {member.is_suspended && (
            <div className="card bg-red-50 border-red-100">
              <p className="text-sm font-semibold text-red-800">⛔ Akun Disuspend</p>
              <p className="text-xs text-red-600 mt-1">Hingga: {member.suspended_until || '—'}</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Link to={`/kartu?user=${member.id}`} className="btn-primary gap-2"><CreditCard size={16} /> Download Kartu</Link>
        <Link to={`/rekap?user=${member.id}`} className="btn-outline gap-2"><BarChart2 size={16} /> Lihat Rekap</Link>
        {isPengurus && member.hp_ortu && (
          <a href={buildWALink(member.hp_ortu)} target="_blank" rel="noopener noreferrer" className="btn-outline gap-2">
            <Phone size={16} /> WA Ortu
          </a>
        )}
      </div>
    </div>
  );
}

export default MemberDetailPage;
