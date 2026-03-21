import React from 'react';
import { X, BellRing, Send } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { sendNotification } from '../../hooks/useNotifications';
import toast from 'react-hot-toast';

export default function NotifSettingsModal({ onClose }) {
  const { user } = useAuth();

  const handleTest = async () => {
    await sendNotification({
      userId: user.id,
      title: '🔔 Test Notifikasi SIGMA',
      body: 'Sistem notifikasi berfungsi dengan baik!',
      type: 'pengumuman',
    });
    toast.success('Notifikasi test dikirim');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-gray-800">Pengaturan Notifikasi</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X size={18} className="text-gray-400"/>
          </button>
        </div>

        <div className="flex items-start gap-3 p-3 bg-green-50 rounded-xl mb-4">
          <BellRing size={18} className="text-green-600 mt-0.5 shrink-0"/>
          <div>
            <p className="text-sm font-medium text-gray-800">Notifikasi In-App</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Aktif otomatis. Muncul di ikon lonceng setiap kali kamu membuka aplikasi.
            </p>
            <span className="inline-block mt-1.5 text-[11px] bg-green-100 text-green-700
              px-2 py-0.5 rounded-full font-medium">● Aktif</span>
          </div>
        </div>

        <p className="text-[11px] text-gray-400 mb-4">
          Notifikasi dikirim untuk: jadwal baru, tukar jadwal, pengumuman, latihan misa khusus, dan streak.
        </p>

        <button onClick={handleTest}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl
            bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium transition-colors">
          <Send size={14}/> Kirim Notifikasi Test
        </button>
      </div>
    </div>
  );
}
