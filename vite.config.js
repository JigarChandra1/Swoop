import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy target (fallback to 4000). Allow override via env.
const DEV_BACKEND = process.env.VITE_SW_BACKEND_URL || 'http://localhost:4000';

export default defineConfig(() => {
  // Prefer an explicit base path when provided (e.g. GitHub Pages sets
  // VITE_BASE_PATH=/Swoop/). Otherwise serve assets from the site root so
  // platforms like Vercel continue to work out of the box.
  const basePath = process.env.VITE_BASE_PATH || '/';

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
