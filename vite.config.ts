import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      // API key is NOT injected into bundle — lives only in Vercel env vars
      'process.env.GEMINI_API_KEY': JSON.stringify(undefined),
      // Android recovery diagnostics: build commit SHA for the ?debug=1
      // overlay. Vercel sets VERCEL_GIT_COMMIT_SHA at build time; local
      // builds fall back to 'local-dev'. Never a secret.
      '__IRU_BUILD_SHA__': JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'local-dev'),
    },
    resolve: {
      alias: {
        // Removed esm.sh aliases — they work in AI Studio sandbox but
        // break Vercel/Vite production builds
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        // Local dev: proxy /api/* to Python API server (port 8000)
        // In production, Vercel handles these as Python serverless functions
        '/api/fill-': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/api/assessment-': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        // Local dev only: the real Node API handlers (checkout / webhook
        // verification / entitlement status) run in dev-api-server.mjs
        // (port 3001). The webhook itself is NOT proxied here — the
        // tunnel forwards straight to port 3002 so Stripe's raw body
        // and signature headers arrive untouched.
        '/api/checkout': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
        '/api/verify-session': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
        '/api/entitlement-status': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  };
});
