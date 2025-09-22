import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy target (fallback to 4000). Allow override via env.
const DEV_BACKEND = process.env.VITE_SW_BACKEND_URL || 'http://localhost:4000';

export default defineConfig(({ mode }) => {
  // On GitHub Pages the app is served from /Swoop/, so ensure the bundle
  // assets are requested from that prefix unless overridden.
  const basePath =
    process.env.VITE_BASE_PATH || (mode === 'production' ? '/Swoop/' : '/');

  return {
    plugins: [react()],
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
