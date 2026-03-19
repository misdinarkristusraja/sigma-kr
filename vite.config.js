import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// __dirname tidak tersedia di ESM — gunakan fileURLToPath
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Tidak butuh file fisik di public/ — manifest di-generate otomatis
      manifest: {
        name: 'SIGMA - Misdinar Kristus Raja',
        short_name: 'SIGMA',
        description: 'Sistem Informasi Penjadwalan & Manajemen Misdinar',
        theme_color: '#8B0000',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="32" fill="%238B0000"/><text y="130" x="50%" text-anchor="middle" font-size="100" font-family="sans-serif" fill="white">✝</text></svg>',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg}'],
        // Jangan cache file besar
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    // Pecah chunks agar tidak ada satu file yang terlalu besar
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
    // Tampilkan warning jika chunk > 600kB
    chunkSizeWarningLimit: 600,
  },
});
