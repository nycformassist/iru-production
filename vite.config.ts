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
    },
  };
});
