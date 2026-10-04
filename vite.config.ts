import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'HSE Audit Manager',
        short_name: 'HSE Audit',
        description: 'Auditorías de Seguridad e Higiene, Salud Ocupacional, Medio Ambiente y CSMS',
        lang: 'es-AR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#eef1f3',
        theme_color: '#1c2b36',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Sólo recursos estáticos: los datos viven en IndexedDB y la API de Supabase nunca se cachea.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/auth\//],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
      },
    }),
  ],
  build: { sourcemap: false, chunkSizeWarningLimit: 1500 },
  test: { environment: 'node' },
} as never);
