import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
} else if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const reg of registrations) {
      const url = reg.active?.scriptURL || reg.installing?.scriptURL || '';
      if (url.includes('dev-sw')) {
        void reg.unregister();
      }
    }
  }).catch(() => {});
}

createRoot(document.getElementById('root')!).render(<App />);
