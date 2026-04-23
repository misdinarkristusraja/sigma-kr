import { createClient } from '@supabase/supabase-js';

// Fallback ke placeholder agar build Vercel tidak crash
// ketika env vars belum diset saat CI/CD build check.
// Di production, env vars WAJIB diset di Vercel Dashboard.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key';

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  console.warn('⚠️  Supabase env vars belum diset. Set di Vercel Dashboard → Settings → Environment Variables');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: true,
  },
  global: {
    headers: { 'x-app-name': 'sigma-krsoba' },
  },
});

export const db = supabase;

/**
 * Upload file ke Supabase Storage.
 *
 * FIX BUG-009: Sebelumnya fungsi ini mengembalikan getPublicUrl() — URL permanen
 * yang bisa diakses siapapun tanpa autentikasi jika tahu path-nya.
 * SKPL N14 mensyaratkan akses via signed URL sementara (bukan URL publik permanen).
 *
 * Sekarang fungsi ini mengembalikan STORAGE PATH saja.
 * Untuk menampilkan file, gunakan getSignedUrl(bucket, path) di bawah,
 * yang menghasilkan URL sementara yang expire dalam 1 jam (default).
 *
 * Contoh penggunaan:
 *   const path = await uploadFile('documents', `surat/${userId}.pdf`, file);
 *   // Simpan path ke database
 *
 *   // Saat tampil:
 *   const url = await getSignedUrl('documents', path);
 *   window.open(url);
 */
export async function uploadFile(bucket, path, file) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: true });
  if (error) throw error;
  // Kembalikan storage path, bukan URL publik
  return data.path;
}

/**
 * Ambil signed URL sementara (default: expire 1 jam).
 * Gunakan ini setiap kali ingin menampilkan atau mendownload file.
 * URL yang dihasilkan tidak bisa dibagikan permanen.
 */
export async function getSignedUrl(bucket, filePath, expiresIn = 3600) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(filePath, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}
