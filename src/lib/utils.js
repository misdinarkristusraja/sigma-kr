import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO, isValid } from 'date-fns';
import { id } from 'date-fns/locale';

// ── Tailwind class merger ──────────────────────────────────
export function cn(...inputs) { return twMerge(clsx(inputs)); }

// ── Date helpers (WIB = UTC+7) ────────────────────────────
export const WIB_OFFSET = 7 * 60; // minutes

export function nowWIB() {
  const now = new Date();
  return new Date(now.getTime() + WIB_OFFSET * 60 * 1000);
}

export function formatWIB(date, fmt = 'dd MMM yyyy HH:mm') {
  if (!date) return '-';
  const d = typeof date === 'string' ? parseISO(date) : date;
  if (!isValid(d)) return '-';
  return format(d, fmt, { locale: id });
}

export function formatDate(date, fmt = 'EEEE, dd MMMM yyyy') {
  if (!date) return '-';
  const d = typeof date === 'string' ? parseISO(date) : date;
  if (!isValid(d)) return '-';
  return format(d, fmt, { locale: id });
}

/** Hitung periode minggu: Sabtu 07:00 WIB → Sabtu berikutnya 06:59:59 WIB */
export function getWeekPeriod(dateStr) {
  const date = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr;
  const dayOfWeek = date.getDay(); // 0=Sun, 6=Sat
  const hour = date.getHours();

  // Tentukan Sabtu awal periode
  let weekStart = new Date(date);
  if (dayOfWeek === 6 && hour >= 7) {
    // Sudah Sabtu >= 07:00, ini periode berjalan
  } else {
    // Mundur ke Sabtu sebelumnya
    const daysBack = dayOfWeek === 6 ? 7 : (dayOfWeek + 1);
    weekStart.setDate(weekStart.getDate() - daysBack);
  }
  weekStart.setHours(7, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  weekEnd.setHours(6, 59, 59, 999);

  return {
    start: format(weekStart, 'yyyy-MM-dd'),
    end:   format(weekEnd,   'yyyy-MM-dd'),
    label: `${format(weekStart,'dd MMM', {locale:id})} – ${format(weekEnd,'dd MMM yyyy', {locale:id})}`,
  };
}

// ── MyID / CheckSum Generator ─────────────────────────────
/** Generate 10-char HEX uppercase dari input */
export async function generateMyID(nickname, tanggalLahir) {
  const salt  = import.meta.env.VITE_MYID_SALT || 'sigma-krsoba-default';
  const input = `${nickname.toLowerCase()}|${tanggalLahir}|${salt}`;
  const encoder = new TextEncoder();
  const data  = encoder.encode(input);
  const hash  = await crypto.subtle.digest('SHA-256', data);
  const hex   = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return hex.substring(0, 10);
}

// ── QR URL Builder ────────────────────────────────────────
export function buildQRUrl(nickname, myid, type = 'tugas') {
  const base = import.meta.env.VITE_APP_URL || window.location.origin;
  return `${base}/scan?id=${encodeURIComponent(nickname)}&cs=${myid}&t=${type}`;
}

/** Parse QR lama (Google Forms URL) atau QR baru */
export function parseQRValue(raw) {
  try {
    const url = new URL(raw);
    // QR lama — Google Forms
    if (url.hostname.includes('docs.google.com') || url.hostname.includes('google.com')) {
      return {
        version: 'legacy',
        nickname: url.searchParams.get('entry.1892831387') || '',
        myid:     url.searchParams.get('entry.717609437')  || '',
        type:     url.searchParams.get('entry.1680363418') || 'tugas',
      };
    }
    // QR baru — SIGMA
    if (url.pathname === '/scan' || url.searchParams.has('cs')) {
      return {
        version:  'new',
        nickname: url.searchParams.get('id') || '',
        myid:     url.searchParams.get('cs') || '',
        type:     url.searchParams.get('t')  || 'tugas',
      };
    }
  } catch {}
  return null;
}

// ── Phone helpers ─────────────────────────────────────────
export function formatHP(hp) {
  if (!hp) return '';
  const clean = hp.replace(/\D/g, '');
  if (clean.startsWith('0')) return '+62' + clean.slice(1);
  if (clean.startsWith('62')) return '+' + clean;
  return clean;
}

export function buildWALink(hp, message = '') {
  const cleaned = formatHP(hp).replace('+', '');
  const enc = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${cleaned}${enc}`;
}

// ── String helpers ────────────────────────────────────────
export function toNickname(str) {
  return str.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

/**
 * Generate nickname dari nama lengkap — pakai nama baptis (kata pertama) saja
 * Contoh: "Stefanus Gerrard Van Creidoagape" → "gerrard"
 *         "Maria Ratu Rosari Suci"            → "ratu"  (skip "Maria")
 *         "Andreas Antonio Tius Halawa"       → "andreas"
 *
 * Logika:
 *   1. Split nama jadi kata-kata
 *   2. Skip kata pertama jika itu nama santo/santa umum (Maria, Yohanes, dst)
 *   3. Pakai kata pertama yang tersisa, lowercase, strip non-alpha
 */
const SKIP_NAMES = new Set([
  'maria','yohanes','johanes','fransiskus','benediktus','benedictus',
  'antonius','antonius','stefanus','stephanus','christianus','kristianus',
  'thomas','yusuf','mikael','michael','gabriel','raphaël','raphael',
  'theresia','theresia','margaretha','margareta','catharina','katarina',
  'augustinus','dominikus','ignatius','aloysius','robertus','sebastianus',
  'veronika','veronica','monika','monica','cecilia','sesilia','rosaria',
  'immaculata','immaculata','agatha','agata','clara','klara',
  'petrus','paulus','yakobus','bartholomeus','simon','taddeus',
  'venantius','bonaventura','hieronymus','ambrosius','gregorius',
]);

export function generateNickname(namaLengkap) {
  if (!namaLengkap?.trim()) return '';
  const kata = namaLengkap.trim().toLowerCase()
    .replace(/[^a-z\s]/g, '')  // strip non-alpha
    .split(/\s+/)
    .filter(k => k.length > 0);

  if (kata.length === 0) return '';

  // Cari kata pertama yang bukan nama santo/santa umum
  const picked = kata.find(k => !SKIP_NAMES.has(k)) || kata[0];
  return picked.slice(0, 20); // max 20 char
}


export function capitalize(str) {
  return str?.charAt(0).toUpperCase() + str?.slice(1).toLowerCase();
}

export function truncate(str, len = 30) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

// ── Liturgy color mapping ─────────────────────────────────
export const LITURGY_COLORS = {
  Hijau:     { bg: 'bg-green-50',  text: 'text-green-800',  dot: 'bg-green-600',  label: 'Hijau'   },
  Merah:     { bg: 'bg-red-50',    text: 'text-red-800',    dot: 'bg-red-600',    label: 'Merah'   },
  Putih:     { bg: 'bg-amber-50',  text: 'text-amber-800',  dot: 'bg-amber-400',  label: 'Putih'   },
  Ungu:      { bg: 'bg-purple-50', text: 'text-purple-800', dot: 'bg-purple-600', label: 'Ungu'    },
  MerahMuda: { bg: 'bg-pink-50',   text: 'text-pink-800',   dot: 'bg-pink-500',   label: 'Merah Muda' },
  Hitam:     { bg: 'bg-gray-100',  text: 'text-gray-800',   dot: 'bg-gray-700',   label: 'Hitam'   },
};

export function getLiturgyClass(color) {
  return LITURGY_COLORS[color] || LITURGY_COLORS['Hijau'];
}

// ── Role / Status labels ──────────────────────────────────
export const ROLE_LABELS = {
  Administrator:   'Administrator',
  Pengurus:        'Pengurus',
  Pelatih:         'Pelatih',
  Misdinar_Aktif:  'Misdinar Aktif',
  Misdinar_Retired:'Misdinar Retired',
};

export const STATUS_LABELS = {
  Active:   'Aktif',
  Pending:  'Menunggu',
  Retired:  'Pensiun',
  Suspended:'Disuspend',
};

// ── Points formula (6 kondisi) ────────────────────────────
/**
 * Hitung poin & kondisi per minggu — 6 kondisi SIGMA
 *
 * K1 (+2): Dijadwalkan + Hadir Tugas + Hadir Latihan
 * K2 (+3): Walk-in (tidak dijadwalkan) + Hadir Latihan
 * K3 (+1): Dijadwalkan + Hadir Tugas + Tidak Latihan
 * K4 (+1): Walk-in (tidak dijadwalkan) + Tidak Latihan
 * K5 (+1): Dijadwalkan + Tidak Tugas + Hadir Latihan  ← datang latihan
 * K6 (-1): Dijadwalkan + Tidak Tugas + Tidak Latihan  ← absen total
 *
 * Jika tidak dijadwalkan DAN tidak ada scan sama sekali → null (tidak dihitung)
 */
export function hitungPoin({ isDijadwalkan, isHadirTugas, isHadirLatihan, isWalkIn }) {
  // K1: dijadwalkan + tugas + latihan
  if (isDijadwalkan && isHadirTugas && isHadirLatihan)  return { poin:  2, kondisi: 'K1' };
  // K2: walk-in + latihan (bonus karena tidak wajib tapi datang latihan)
  if (!isDijadwalkan && isWalkIn && isHadirLatihan)     return { poin:  3, kondisi: 'K2' };
  // K3: dijadwalkan + tugas tapi tidak latihan
  if (isDijadwalkan && isHadirTugas && !isHadirLatihan) return { poin:  1, kondisi: 'K3' };
  // K4: walk-in tapi tidak latihan
  if (!isDijadwalkan && isWalkIn && !isHadirLatihan)    return { poin:  1, kondisi: 'K4' };
  // K5: dijadwalkan tapi tidak tugas, tapi hadir latihan → +1 (ada usaha)
  if (isDijadwalkan && !isHadirTugas && isHadirLatihan) return { poin:  1, kondisi: 'K5' };
  // K6: dijadwalkan tapi absen total (tidak tugas, tidak latihan)
  if (isDijadwalkan && !isHadirTugas && !isHadirLatihan)return { poin: -1, kondisi: 'K6' };
  // Tidak dijadwalkan & tidak ada scan → tidak dihitung
  return { poin: 0, kondisi: null };
}

// ── Export CSV helper ─────────────────────────────────────
export function downloadCSV(rows, headers, filename) {
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headerRow = headers.map(h => escape(h.label)).join(',');
  const dataRows  = rows.map(r => headers.map(h => escape(r[h.key])).join(','));
  const csv = [headerRow, ...dataRows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

// ── Sleep helper ──────────────────────────────────────────
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Pendidikan options ────────────────────────────────────
export const PENDIDIKAN_OPTIONS = ['SD', 'SMP', 'SMA', 'SMK', 'Lulus'];
export const JENJANG_LABELS = { SD: 'SD', SMP: 'SMP', SMA: 'SMA', SMK: 'SMK', Lulus: 'Alumni' };

// ─── Disambiguasi nama panggilan ─────────────────────────
/**
 * Jika ada dua orang dengan nama_panggilan sama, tambahkan
 * suffix otomatis untuk membedakan. Prioritas suffix:
 *   1. Inisial nama belakang  → "Rafa A."
 *   2. Lingkungan             → "Rafa (Barnabas)"
 *   3. Inisial nickname       → "Rafa [rfq]"
 *
 * Penggunaan:
 *   const tagged = tagDuplicateNames(members);
 *   tagged[member.id] → nama tampil yang unik
 */
export function tagDuplicateNames(members) {
  const result = {};
  const byName = {};

  // Kelompokkan per nama_panggilan
  members.forEach(m => {
    const key = (m.nama_panggilan || '').trim().toLowerCase();
    if (!byName[key]) byName[key] = [];
    byName[key].push(m);
  });

  members.forEach(m => {
    const key = (m.nama_panggilan || '').trim().toLowerCase();
    const group = byName[key];

    if (group.length <= 1) {
      // Tidak ada duplikat — tampilkan apa adanya
      result[m.id] = m.nama_panggilan || m.nickname;
    } else {
      // Ada duplikat — tambahkan suffix disambiguasi
      const base = m.nama_panggilan || m.nickname;

      // Coba suffix 1: inisial nama belakang dari nama_lengkap
      if (m.nama_lengkap) {
        const parts  = m.nama_lengkap.trim().split(/\s+/);
        if (parts.length > 1) {
          const initial = parts[parts.length - 1][0].toUpperCase() + '.';
          // Cek apakah inisial ini unik di dalam group
          const sameInitial = group.filter(g => {
            if (!g.nama_lengkap) return false;
            const gParts = g.nama_lengkap.trim().split(/\s+/);
            return gParts.length > 1 && gParts[gParts.length-1][0].toUpperCase() === initial[0];
          });
          if (sameInitial.length === 1) {
            result[m.id] = `${base} ${initial}`;
            return;
          }
        }
      }

      // Coba suffix 2: lingkungan (disingkat)
      if (m.lingkungan) {
        const sameLinkg = group.filter(g => g.lingkungan === m.lingkungan);
        if (sameLinkg.length === 1) {
          result[m.id] = `${base} (${m.lingkungan})`;
          return;
        }
      }

      // Fallback suffix 3: nickname dalam kurung kotak
      result[m.id] = `${base} [${m.nickname}]`;
    }
  });

  return result; // { userId: displayName }
}

/**
 * Versi singkat: dapatkan display name untuk SATU user
 * berdasarkan konteks daftar anggota yang sedang ditampilkan.
 */
export function getDisplayName(member, allMembers) {
  if (!allMembers || allMembers.length === 0) return member.nama_panggilan || member.nickname;
  const tagged = tagDuplicateNames(allMembers);
  return tagged[member.id] || member.nama_panggilan || member.nickname;
}
