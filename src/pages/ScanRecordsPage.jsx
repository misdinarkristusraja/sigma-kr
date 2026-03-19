import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { formatWIB, downloadCSV } from '../lib/utils';
import { Search, Download, RefreshCw, AlertTriangle, CheckCircle, Filter } from 'lucide-react';

const SCAN_TYPE_LABELS = {
  tugas:          { label: 'Tugas',         color: 'badge-green' },
  latihan:        { label: 'Latihan',       color: 'badge-blue' },
  walkin_tugas:   { label: 'Walk-in Tugas', color: 'badge-yellow' },
  walkin_latihan: { label: 'Walk-in Lat.',  color: 'badge-purple' },
};

export default function ScanRecordsPage() {
  const [records,  setRecords]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState({ scan_type: '', anomaly: '', date: '' });
  const [page,     setPage]     = useState(0);
  const [total,    setTotal]    = useState(0);
  const PAGE_SIZE = 50;

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from('scan_records')
        .select(`
          id, scan_type, is_walk_in, walkin_reason, timestamp,
          qr_version, is_anomaly, anomaly_reason,
          user:user_id(nickname, nama_panggilan, lingkungan),
          scanner:scanner_user_id(nickname, nama_panggilan),
          event:event_id(nama_event, perayaan)
        `, { count: 'exact' })
        .order('timestamp', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (filter.scan_type) q = q.eq('scan_type', filter.scan_type);
      if (filter.anomaly === 'yes') q = q.eq('is_anomaly', true);
      if (filter.anomaly === 'no')  q = q.eq('is_anomaly', false);
      if (filter.date) {
        q = q.gte('timestamp', filter.date + 'T00:00:00')
             .lte('timestamp', filter.date + 'T23:59:59');
      }

      const { data, error, count } = await q;
      if (error) throw error;
      setRecords(data || []);
      setTotal(count || 0);
    } catch (err) {
      console.error('loadRecords:', err);
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  const filtered = records.filter(r =>
    !search || [
      r.user?.nickname, r.user?.nama_panggilan, r.user?.lingkungan,
      r.scanner?.nickname, r.event?.perayaan
    ].some(v => v?.toLowerCase().includes(search.toLowerCase()))
  );

  function handleExport() {
    const headers = [
      { key: 'timestamp',   label: 'Waktu' },
      { key: 'user_nick',   label: 'Anggota' },
      { key: 'user_name',   label: 'Nama Panggilan' },
      { key: 'lingkungan',  label: 'Lingkungan' },
      { key: 'scan_type',   label: 'Tipe Scan' },
      { key: 'event',       label: 'Event' },
      { key: 'scanner',     label: 'Scanner' },
      { key: 'walk_in',     label: 'Walk-in' },
      { key: 'anomaly',     label: 'Anomali' },
      { key: 'qr_version',  label: 'QR Version' },
    ];
    const rows = filtered.map(r => ({
      timestamp:  formatWIB(r.timestamp),
      user_nick:  r.user?.nickname || '',
      user_name:  r.user?.nama_panggilan || '',
      lingkungan: r.user?.lingkungan || '',
      scan_type:  r.scan_type || '',
      event:      r.event?.perayaan || r.event?.nama_event || '',
      scanner:    r.scanner?.nama_panggilan || '',
      walk_in:    r.is_walk_in ? 'Ya' : 'Tidak',
      anomaly:    r.is_anomaly ? 'Ya' : 'Tidak',
      qr_version: r.qr_version || '',
    }));
    downloadCSV(rows, headers, `scan-records-${Date.now()}.csv`);
  }

  const anomalyCount = records.filter(r => r.is_anomaly).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Riwayat Scan</h1>
          <p className="page-subtitle">{total.toLocaleString('id')} total record{anomalyCount > 0 && ` · ${anomalyCount} anomali`}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadRecords} className="btn-ghost p-2" title="Refresh"><RefreshCw size={16} /></button>
          <button onClick={handleExport} className="btn-outline gap-2"><Download size={16} /> Export CSV</button>
        </div>
      </div>

      {/* Anomali alert */}
      {anomalyCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">
            <strong>{anomalyCount} scan anomali</strong> ditemukan — checksum tidak cocok. Perlu dicek.
          </p>
          <button onClick={() => { setFilter(f => ({...f, anomaly: 'yes'})); setPage(0); }}
            className="ml-auto text-xs text-red-600 underline">Lihat saja</button>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Cari nama, lingkungan, event..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <input type="date" className="input w-auto"
          value={filter.date}
          onChange={e => { setFilter(f => ({...f, date: e.target.value})); setPage(0); }} />
        <select className="input w-auto" value={filter.scan_type}
          onChange={e => { setFilter(f => ({...f, scan_type: e.target.value})); setPage(0); }}>
          <option value="">Semua Tipe</option>
          {Object.entries(SCAN_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input w-auto" value={filter.anomaly}
          onChange={e => { setFilter(f => ({...f, anomaly: e.target.value})); setPage(0); }}>
          <option value="">Semua</option>
          <option value="yes">Anomali saja</option>
          <option value="no">Normal saja</option>
        </select>
        {(filter.date || filter.scan_type || filter.anomaly) && (
          <button onClick={() => { setFilter({ scan_type: '', anomaly: '', date: '' }); setPage(0); }}
            className="btn-ghost text-xs text-gray-400">Reset filter</button>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Anggota</th>
                <th>Tipe</th>
                <th>Event</th>
                <th>Scanner</th>
                <th>QR</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-10 text-gray-400">Memuat...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-gray-400">Tidak ada data</td></tr>
              ) : filtered.map(r => {
                const sl = SCAN_TYPE_LABELS[r.scan_type] || { label: r.scan_type, color: 'badge-gray' };
                return (
                  <tr key={r.id} className={r.is_anomaly ? 'bg-red-50' : ''}>
                    <td className="text-xs text-gray-500 whitespace-nowrap">{formatWIB(r.timestamp, 'dd/MM HH:mm')}</td>
                    <td>
                      <div className="font-semibold text-gray-900 text-sm">{r.user?.nama_panggilan || '?'}</div>
                      <div className="text-xs text-gray-400">@{r.user?.nickname} · {r.user?.lingkungan}</div>
                    </td>
                    <td>
                      <span className={`badge ${sl.color}`}>{sl.label}</span>
                      {r.is_walk_in && <span className="badge-yellow ml-1 text-xs">Walk-in</span>}
                    </td>
                    <td className="text-xs text-gray-600 max-w-40 truncate">
                      {r.event?.perayaan || r.event?.nama_event || '—'}
                    </td>
                    <td className="text-xs text-gray-500">{r.scanner?.nama_panggilan || '—'}</td>
                    <td>
                      <span className={`badge text-xs ${r.qr_version === 'legacy' ? 'badge-yellow' : 'badge-gray'}`}>
                        {r.qr_version === 'legacy' ? 'Lama' : 'Baru'}
                      </span>
                    </td>
                    <td>
                      {r.is_anomaly
                        ? <span className="flex items-center gap-1 text-xs text-red-600"><AlertTriangle size={12} /> Anomali</span>
                        : <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle size={12} /> OK</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-500">
              Menampilkan {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} dari {total}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="btn-outline btn-sm">← Prev</button>
              <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total} className="btn-outline btn-sm">Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
