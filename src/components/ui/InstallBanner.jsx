import React, { useState } from 'react';
import { Download, X, Smartphone } from 'lucide-react';
import { usePWA } from '../../hooks/usePWA';

/**
 * InstallBanner — banner "Install Aplikasi" yang muncul di bawah
 * Hanya muncul jika browser mendukung install prompt dan belum diinstall.
 * User bisa dismiss dan tidak akan muncul lagi selama 7 hari.
 */
export default function InstallBanner() {
  const { canInstall, isInstalled, promptInstall } = usePWA();
  const [dismissed, setDismissed] = useState(() => {
    try {
      const ts = localStorage.getItem('sigma_install_dismissed');
      if (!ts) return false;
      return Date.now() - Number(ts) < 7 * 24 * 60 * 60 * 1000; // 7 hari
    } catch { return false; }
  });

  if (!canInstall || isInstalled || dismissed) return null;

  const handleDismiss = () => {
    try { localStorage.setItem('sigma_install_dismissed', String(Date.now())); } catch {}
    setDismissed(true);
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-40 max-w-sm mx-auto
      bg-white rounded-2xl shadow-2xl border border-gray-100
      flex items-center gap-3 px-4 py-3 animate-[fadeIn_0.3s_ease-out]">
      {/* Icon */}
      <div className="w-10 h-10 bg-brand-800 rounded-xl flex items-center justify-center shrink-0">
        <Smartphone size={20} className="text-white"/>
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 leading-tight">Install Aplikasi SIGMA</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Akses lebih cepat, bisa dipakai offline
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={promptInstall}
          className="bg-brand-700 hover:bg-brand-800 text-white text-xs font-semibold
            px-3 py-1.5 rounded-xl transition-colors flex items-center gap-1"
        >
          <Download size={12}/> Install
        </button>
        <button onClick={handleDismiss} className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors">
          <X size={14} className="text-gray-400"/>
        </button>
      </div>
    </div>
  );
}
