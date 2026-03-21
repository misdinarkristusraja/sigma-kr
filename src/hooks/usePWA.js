import { useState, useEffect } from 'react';

/**
 * usePWA — handle service worker registration + install prompt
 * Returns:
 *   canInstall   : boolean - apakah browser mendukung install prompt
 *   isInstalled  : boolean - apakah sudah berjalan sebagai installed PWA
 *   promptInstall: () => void - trigger install dialog
 */
export function usePWA() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [canInstall,     setCanInstall]     = useState(false);
  const [isInstalled,    setIsInstalled]    = useState(false);

  useEffect(() => {
    // Deteksi apakah sudah installed (standalone mode)
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    setIsInstalled(standalone);

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then(reg => {
          console.log('[SIGMA SW] Registered, scope:', reg.scope);
        })
        .catch(err => {
          console.warn('[SIGMA SW] Registration failed:', err);
        });
    }

    // Tangkap install prompt
    const handler = e => {
      e.preventDefault();
      setDeferredPrompt(e);
      setCanInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // Update isInstalled jika user install via prompt
    const installedHandler = () => setIsInstalled(true);
    window.addEventListener('appinstalled', installedHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setCanInstall(false);
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  return { canInstall, isInstalled, promptInstall };
}
