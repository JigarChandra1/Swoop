import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Dev proxy target (fallback to 4000). Allow override via env.
const DEV_BACKEND = process.env.VITE_SW_BACKEND_URL || 'http://localhost:4000';

export default defineConfig(() => {
  // Prefer an explicit base path when provided (e.g. GitHub Pages sets
  // VITE_BASE_PATH=/Swoop/). Otherwise serve assets from the site root so
  // platforms like Vercel continue to work out of the box.
  const basePath = process.env.VITE_BASE_PATH || '/';

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/swoop-icon.svg'],
        manifest: {
          name: 'Swoop',
          short_name: 'Swoop',
          description: 'Swoop board game companion',
          start_url: '.',
          scope: '.',
          display: 'standalone',
          theme_color: '#2563eb',
          background_color: '#0f172a',
          icons: [
            { src: 'icons/swoop-icon.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
            { src: 'icons/swoop-icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
        devOptions: {
          enabled: true,
        },
      })
    ],
    base: basePath,
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
    },
    server: {
      host: true,
      port: 5173,
      proxy: {
        // Proxy API during dev so the app can call /api/* without CORS issues
        '/api': {
          target: DEV_BACKEND,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
