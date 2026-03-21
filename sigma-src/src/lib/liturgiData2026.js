/**
 * Data Liturgi 2026 — Paroki Kristus Raja Solo Baru
 * Sumber: Jadwal_2026.pdf (jadwal resmi paroki)
 *
 * Format: 'YYYY-MM-DD': { name, color, isMinggu, isHariRaya }
 * Color: Hijau | Merah | Putih | Ungu | MerahMuda | Hitam
 */

export const LITURGI_2026 = {
  // ── JANUARI ──────────────────────────────────────────────
  '2026-01-01': { name: 'HR. Santa Maria Bunda Allah',     color: 'Putih',    isMinggu: false, isHariRaya: true  },
  '2026-01-03': { name: 'HR. Penampakan Tuhan',            color: 'Putih',    isMinggu: false, isHariRaya: true  }, // Sabtu imam
  '2026-01-04': { name: 'HR. Penampakan Tuhan',            color: 'Putih',    isMinggu: true,  isHariRaya: true  }, // Minggu
  '2026-01-11': { name: 'HR. Pembaptisan Tuhan',           color: 'Putih',    isMinggu: true,  isHariRaya: true  },
  '2026-01-18': { name: 'Minggu Biasa II',                 color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-01-25': { name: 'Minggu Biasa III',                color: 'Hijau',    isMinggu: true,  isHariRaya: false },

  // ── FEBRUARI ─────────────────────────────────────────────
  '2026-02-01': { name: 'Minggu Biasa IV',                 color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-02-08': { name: 'Minggu Biasa V',                  color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-02-15': { name: 'Minggu Biasa VI',                 color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-02-18': { name: 'Rabu Abu',                        color: 'Ungu',     isMinggu: false, isHariRaya: false },
  '2026-02-22': { name: 'Minggu Prapaskah I',              color: 'Ungu',     isMinggu: true,  isHariRaya: false },

  // ── MARET ────────────────────────────────────────────────
  '2026-03-01': { name: 'Minggu Prapaskah II',             color: 'Ungu',     isMinggu: true,  isHariRaya: false },
  '2026-03-08': { name: 'Minggu Prapaskah III',            color: 'Ungu',     isMinggu: true,  isHariRaya: false },
  '2026-03-15': { name: 'Minggu Prapaskah IV',             color: 'MerahMuda',isMinggu: true,  isHariRaya: false }, // Laetare
  '2026-03-22': { name: 'Minggu Prapaskah V',              color: 'Ungu',     isMinggu: true,  isHariRaya: false },
  '2026-03-29': { name: 'Minggu Palma',                    color: 'Merah',    isMinggu: true,  isHariRaya: false },

  // ── APRIL (Pekan Suci & Paskah) ──────────────────────────
  '2026-04-02': { name: 'Kamis Putih',                     color: 'Putih',    isMinggu: false, isHariRaya: false },
  '2026-04-03': { name: 'Ibadat Jumat Agung',              color: 'Merah',    isMinggu: false, isHariRaya: false },
  '2026-04-04': { name: 'Vigili Malam Paskah',             color: 'Putih',    isMinggu: false, isHariRaya: true  },
  '2026-04-05': { name: 'HR. Pesta Kebangkitan Tuhan',     color: 'Putih',    isMinggu: true,  isHariRaya: true  },
  '2026-04-12': { name: 'Minggu Paskah II',                color: 'Putih',    isMinggu: true,  isHariRaya: false },
  '2026-04-19': { name: 'Minggu Paskah III',               color: 'Putih',    isMinggu: true,  isHariRaya: false },
  '2026-04-26': { name: 'Minggu Paskah IV',                color: 'Putih',    isMinggu: true,  isHariRaya: false },

  // ── MEI ──────────────────────────────────────────────────
  '2026-05-03': { name: 'Minggu Paskah V',                 color: 'Putih',    isMinggu: true,  isHariRaya: false },
  '2026-05-10': { name: 'Minggu Paskah VI',                color: 'Putih',    isMinggu: true,  isHariRaya: false },
  '2026-05-14': { name: 'HR. Kenaikan Tuhan',              color: 'Putih',    isMinggu: false, isHariRaya: true  },
  '2026-05-17': { name: 'Minggu Paskah VII',               color: 'Putih',    isMinggu: true,  isHariRaya: false },
  '2026-05-24': { name: 'HR. Pentakosta',                  color: 'Merah',    isMinggu: true,  isHariRaya: true  },
  '2026-05-31': { name: 'HR. Tritunggal Mahakudus',        color: 'Putih',    isMinggu: true,  isHariRaya: true  },

  // ── JUNI ─────────────────────────────────────────────────
  '2026-06-07': { name: 'HR. Tubuh dan Darah Kristus',     color: 'Putih',    isMinggu: true,  isHariRaya: true  },
  '2026-06-14': { name: 'Minggu Biasa XI',                 color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-06-21': { name: 'Minggu Biasa XII',                color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-06-28': { name: 'Minggu Biasa XIII',               color: 'Hijau',    isMinggu: true,  isHariRaya: false },

  // ── JULI ─────────────────────────────────────────────────
  '2026-07-05': { name: 'Minggu Biasa XIV',                color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-07-12': { name: 'Minggu Biasa XV',                 color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-07-19': { name: 'Minggu Biasa XVI',                color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-07-26': { name: 'Minggu Biasa XVII',               color: 'Hijau',    isMinggu: true,  isHariRaya: false },

  // ── AGUSTUS ──────────────────────────────────────────────
  '2026-08-02': { name: 'Minggu Biasa XVIII',              color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-08-09': { name: 'Minggu Biasa XIX',                color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-08-15': { name: 'HR. SP Maria Diangkat ke Surga',  color: 'Putih',    isMinggu: false, isHariRaya: true  }, // Sabtu
  '2026-08-16': { name: 'Minggu Biasa XX',                 color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-08-23': { name: 'Minggu Biasa XXI',                color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-08-30': { name: 'Minggu Biasa XXII',               color: 'Hijau',    isMinggu: true,  isHariRaya: false },

  // ── SEPTEMBER ────────────────────────────────────────────
  '2026-09-06': { name: 'Minggu Biasa XXIII',              color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-09-13': { name: 'Minggu Biasa XXIV',               color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-09-20': { name: 'Minggu Biasa XXV',                color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-09-27': { name: 'Minggu Biasa XXVI',               color: 'Hijau',    isMinggu: true,  isHariRaya: false },

  // ── OKTOBER ──────────────────────────────────────────────
  '2026-10-04': { name: 'Minggu Biasa XXVII',              color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-10-11': { name: 'Minggu Biasa XXVIII',             color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-10-18': { name: 'Minggu Biasa XXIX',               color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-10-25': { name: 'Minggu Biasa XXX',                color: 'Hijau',    isMinggu: true,  isHariRaya: false },

  // ── NOVEMBER ─────────────────────────────────────────────
  '2026-11-01': { name: 'HR. Semua Orang Kudus',           color: 'Putih',    isMinggu: true,  isHariRaya: true  },
  '2026-11-08': { name: 'Minggu Biasa XXXII',              color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-11-15': { name: 'Minggu Biasa XXXIII',             color: 'Hijau',    isMinggu: true,  isHariRaya: false },
  '2026-11-22': { name: 'HR. Kristus Raja Semesta Alam',   color: 'Putih',    isMinggu: true,  isHariRaya: true  },
  '2026-11-29': { name: 'Minggu Adven I',                  color: 'Ungu',     isMinggu: true,  isHariRaya: false },

  // ── DESEMBER ─────────────────────────────────────────────
  '2026-12-06': { name: 'Minggu Adven II',                 color: 'Ungu',     isMinggu: true,  isHariRaya: false },
  '2026-12-08': { name: 'HR. Maria Dikandung Tanpa Noda',  color: 'Putih',    isMinggu: false, isHariRaya: true  }, // Selasa
  '2026-12-13': { name: 'Minggu Adven III',                color: 'MerahMuda',isMinggu: true,  isHariRaya: false }, // Gaudete
  '2026-12-20': { name: 'Minggu Adven IV',                 color: 'Ungu',     isMinggu: true,  isHariRaya: false },
  '2026-12-24': { name: 'Malam Natal',                     color: 'Putih',    isMinggu: false, isHariRaya: true  },
  '2026-12-25': { name: 'HR. Natal',                       color: 'Putih',    isMinggu: false, isHariRaya: true  },
  '2026-12-27': { name: 'HR. Keluarga Kudus',              color: 'Putih',    isMinggu: true,  isHariRaya: true  },
};

/**
 * Ambil data liturgi untuk satu tanggal
 * @param {string} dateStr - format YYYY-MM-DD
 * @returns {object|null}
 */
export function getLiturgiByDate(dateStr) {
  return LITURGI_2026[dateStr] || null;
}

/**
 * Ambil data liturgi Minggu untuk sebuah tanggal Minggu
 * @param {string} sundayDate - format YYYY-MM-DD
 * @returns {{ name, color, isHariRaya }|null}
 */
export function getLiturgiMinggu(sundayDate) {
  const entry = LITURGI_2026[sundayDate];
  if (entry?.isMinggu) return entry;
  // Fallback: cari entry apapun di tanggal itu
  return entry || null;
}

/**
 * Ambil semua data liturgi untuk rentang tanggal
 * @param {number} year
 * @param {number} month - 1-12
 * @returns {Array}
 */
export function getLiturgiByMonth(year, month) {
  if (year !== 2026) return []; // data hanya 2026
  const padM  = String(month).padStart(2, '0');
  const prefix = `${year}-${padM}-`;
  return Object.entries(LITURGI_2026)
    .filter(([date]) => date.startsWith(prefix))
    .map(([date, data]) => ({ date, ...data }));
}

// Hari-hari besar yang otomatis hapus Misa Harian (default: tidak ada)
export const HARI_RAYA_NO_HARIAN = [
  '2026-04-02', // Kamis Putih
  '2026-04-03', // Jumat Agung
  '2026-04-04', // Sabtu Suci
];
