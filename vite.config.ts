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
