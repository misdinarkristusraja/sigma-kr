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
    autoRefreshToken: true,
    persistSession:   true,
    detectSessionInUrl: true,
  },
  global: {
    headers: { 'x-app-name': 'sigma-krsoba' },
  },
});

export const db = supabase;

/** Upload file ke Supabase Storage */
export async function uploadFile(bucket, path, file) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: true });
  if (error) throw error;
  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
  return urlData.publicUrl;
}

/** Ambil signed URL (expire 1 jam) */
export async function getSignedUrl(bucket, filePath, expiresIn = 3600) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(filePath, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}
