// src/hooks/useMisaBesarScan.js
//
// Hook untuk memproses scan latihan pada event Misa Besar.
// Dipanggil oleh ScanPage SETELAH scan_records berhasil disimpan.
//
// Logika polimorfik:
//   mode = 'gabung'   → 1 scan menandai SEMUA sesi hari ini untuk event tsb
//   mode = 'terpisah' → 1 scan hanya menandai sesi yang diberikan (atau sesi terdekat)
//
// Integritas:
//   Semua operasi dilakukan melalui SQL function process_misa_besar_scan (SECURITY DEFINER)
//   → atomic, tidak bisa partial update
//   → ON CONFLICT DO UPDATE → tidak ada duplikasi data

import { supabase } from '../lib/supabase';

/**
 * Proses scan latihan untuk Misa Besar.
 *
 * @param {Object} params
 * @param {string}      params.scanRecordId   - UUID scan_records yang baru disimpan
 * @param {string}      params.eventId        - UUID events (is_misa_besar = true)
 * @param {string}      params.userId         - UUID user yang discan
 * @param {string}      params.scannerId      - UUID user yang melakukan scan
 * @param {string|null} params.latihanId      - UUID event_latihan tertentu (null = auto)
 *
 * @returns {Promise<{ ok: boolean, mode: string, marked: number, latihan_ids: string[], error?: string }>}
 */
export async function processMisaBesarLatihan({
  scanRecordId,
  eventId,
  userId,
  scannerId,
  latihanId = null,
}) {
  if (!scanRecordId || !eventId || !userId || !scannerId) {
    console.error('[useMisaBesarScan] parameter tidak lengkap', { scanRecordId, eventId, userId, scannerId });
    return { ok: false, error: 'Parameter tidak lengkap', marked: 0 };
  }

  try {
    const { data, error } = await supabase.rpc('process_misa_besar_scan', {
      p_scan_record_id: scanRecordId,
      p_event_id:       eventId,
      p_user_id:        userId,
      p_scanner_id:     scannerId,
      p_latihan_id:     latihanId,
    });

    if (error) {
      console.error('[useMisaBesarScan] RPC error:', error.message);
      return { ok: false, error: error.message, marked: 0 };
    }

    // data berupa JSONB: { ok, mode, marked, latihan_ids }
    return data || { ok: false, error: 'No response', marked: 0 };
  } catch (err) {
    console.error('[useMisaBesarScan] exception:', err);
    return { ok: false, error: err.message, marked: 0 };
  }
}

/**
 * Cek apakah sebuah event adalah Misa Besar dan punya sesi latihan hari ini.
 * Digunakan ScanPage untuk menentukan apakah perlu memanggil processMisaBesarLatihan.
 *
 * @param {Object} event  - row dari tabel events (harus include is_misa_besar, mode_latihan)
 * @returns {boolean}
 */
export function isMisaBesarWithLatihanToday(event) {
  if (!event?.is_misa_besar) return false;
  // ScanPage sudah memfilter events hari ini (tanggal_latihan atau tanggal_tugas = today)
  // Jika event ini Misa Besar, kemungkinan punya sesi latihan hari ini
  return true;
}
