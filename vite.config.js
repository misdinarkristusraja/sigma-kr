import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    // PWA dinonaktifkan — service worker menyebabkan blank screen setelah deploy
    // karena SW serve JS chunk lama yang tidak ada di server baru.
    // Aktifkan kembali jika sudah ada strategi cache invalidation yang proper.
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor':    ['react', 'react-dom', 'react-router-dom'],
          'supabase-vendor': ['@supabase/supabase-js'],
          'chart-vendor':    ['recharts'],
          'export-vendor':   ['html-to-image', 'jspdf', 'qrcode'],
          'xlsx-vendor':     ['xlsx'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
