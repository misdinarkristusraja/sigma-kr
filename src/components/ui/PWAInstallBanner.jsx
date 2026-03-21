import React, { useState, useEffect } from 'react';
import { Download, X, Smartphone } from 'lucide-react';

const DISMISS_KEY  = 'sigma_pwa_dismissed';
const DISMISS_DAYS = 7;

export default function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [show,           setShow]           = useState(false);
  const [installing,     setInstalling]     = useState(false);
  const [isIOS,          setIsIOS]          = useState(false);
  const [showIOSGuide,   setShowIOSGuide]   = useState(false);

  useEffect(() => {
    // Sudah jalan sebagai PWA standalone? skip
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (window.navigator.standalone === true) return;

    // Sudah dismiss belum lama?
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed) {
      const daysAgo = (Date.now() - Number(dismissed)) / 86400000;
      if (daysAgo < DISMISS_DAYS) return;
    }

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    setIsIOS(ios);
    if (ios) { setShow(true); return; }

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = () => {
    setShow(false);
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  };

  const handleInstall = async () => {
    if (isIOS) { setShowIOSGuide(true); return; }
    if (!deferredPrompt) return;
    setInstalling(true);
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setInstalling(false);
    setDeferredPrompt(null);
    if (outcome === 'accepted') setShow(false);
  };

  if (!show) return null;

  if (showIOSGuide) return (
    <div className="fixed inset-0 bg-black/60 z-[70] flex items-end justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-800">Install di iPhone / iPad</h3>
          <button onClick={() => { setShowIOSGuide(false); dismiss(); }}
            className="p-1 rounded-lg hover:bg-gray-100">
            <X size={18} className="text-gray-400"/>
          </button>
        </div>
        <ol className="space-y-3 text-sm text-gray-700">
          {[
            <>Tap ikon <strong>Share ⬆️</strong> di bagian bawah Safari</>,
            <>Gulir ke bawah, pilih <strong>"Tambahkan ke Layar Utama"</strong></>,
            <>Tap <strong>"Tambah"</strong> — SIGMA muncul di Home Screen!</>,
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-800 font-bold text-xs
                flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <div className="mt-4 p-3 bg-brand-50 rounded-xl text-xs text-brand-800">
          💡 Setelah install, buka dari Home Screen untuk pengalaman penuh tanpa browser bar.
        </div>
        <button onClick={() => { setShowIOSGuide(false); dismiss(); }}
          className="w-full mt-4 py-2.5 rounded-xl bg-brand-700 text-white font-semibold text-sm
            hover:bg-brand-800 transition-colors">
          Mengerti!
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[70] pointer-events-none">
      <div className="max-w-sm mx-auto pointer-events-auto">
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-4
          flex items-center gap-3" style={{ animation: 'slideUp 0.3s ease-out' }}>
          <div className="w-11 h-11 rounded-xl bg-brand-800 flex items-center justify-center shrink-0">
            <Smartphone size={20} className="text-white"/>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-800">Install SIGMA</p>
            <p className="text-xs text-gray-500">Buka seperti app, tanpa browser</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={dismiss} className="p-1.5 rounded-lg hover:bg-gray-100">
              <X size={15} className="text-gray-400"/>
            </button>
            <button onClick={handleInstall} disabled={installing}
              className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white
                text-xs font-semibold px-3 py-2 rounded-xl transition-colors disabled:opacity-60">
              <Download size={13}/>
              {installing ? 'Loading…' : 'Install'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
