// src/hooks/usePWAInstall.js
// Menangkap beforeinstallprompt event dan expose fungsi install

import { useState, useEffect } from 'react';

export function usePWAInstall() {
  const [deferredPrompt, setDeferred] = useState(null);
  const [isInstallable,  setInstallable] = useState(false);
  const [isInstalled,    setInstalled]   = useState(false);

  useEffect(() => {
    // Cek apakah sudah diinstall (standalone mode)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    setInstalled(isStandalone);

    const handler = (e) => {
      e.preventDefault();
      setDeferred(e);
      setInstallable(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // Deteksi setelah berhasil diinstall
    window.addEventListener('appinstalled', () => {
      setInstalled(true);
      setInstallable(false);
      setDeferred(null);
    });

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstalled(true);
      setInstallable(false);
    }
    setDeferred(null);
    return outcome === 'accepted';
  };

  return { isInstallable, isInstalled, promptInstall };
}
