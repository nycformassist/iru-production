import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Web Share Target (2026-10-28): register the service worker so a file
// shared from Gallery/Files to the installed PWA is intercepted by
// public/sw.js instead of reaching the server. Registration failure
// must never break the app: without a worker, sharing simply is not
// available and the normal picker flow is unchanged. The worker caches
// nothing, so registration can never serve a stale app version.
try {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    const register = () => {
      try {
        const p = (navigator as any).serviceWorker.register('/sw.js');
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        // Registration failure is non-fatal by design.
      }
    };
    if (typeof document !== 'undefined' && document.readyState === 'complete') {
      register();
    } else if (typeof window !== 'undefined') {
      window.addEventListener('load', register, { once: true });
    } else {
      register();
    }
  }
} catch {
  // Service-worker registration must never break boot.
}
