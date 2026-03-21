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
    // PWA: gunakan manual sw.js di public/ (bukan auto-generate)
    // sehingga kita punya full kontrol atas caching strategy
    // manifest.json sudah ada di public/ — Vite akan include otomatis
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
