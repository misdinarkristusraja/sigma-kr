import React, { useState, useRef, useEffect } from 'react';
import { Bell, CheckCheck, X, Settings } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../hooks/useNotifications';
import NotifSettingsModal from './NotifSettingsModal';

const TYPE_ICON = {
  jadwal:'📅', swap:'🔄', pengumuman:'📢',
  streak:'🔥', laporan:'📊', badge:'🏆', latihan:'🎵',
};

export default function NotificationBell() {
  const { user } = useAuth();
  const { notifications, unreadCount, loading, markRead, markAllRead } = useNotifications(user?.id);
  const [open, setOpen]           = useState(false);
  const [showSettings, setSettings] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    const handler = e => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(p => !p)}
        className="relative p-2 rounded-xl hover:bg-white/10 transition-colors"
        title="Notifikasi"
      >
        <Bell size={18} className="text-brand-100" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] bg-red-500
            text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-80 bg-white rounded-2xl shadow-2xl
          border border-gray-100 z-50 flex flex-col max-h-[460px] overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
            <span className="font-semibold text-gray-800 text-sm">Notifikasi</span>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button onClick={markAllRead}
                  className="flex items-center gap-1 text-[11px] text-brand-700 hover:text-brand-900 px-2 py-1 rounded-lg hover:bg-brand-50">
                  <CheckCheck size={12}/> Baca semua
                </button>
              )}
              <button onClick={() => { setSettings(true); setOpen(false); }}
                className="p-1.5 rounded-lg hover:bg-gray-100">
                <Settings size={13} className="text-gray-400"/>
              </button>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X size={13} className="text-gray-400"/>
              </button>
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1">
            {loading && (
              <div className="py-10 text-center text-sm text-gray-400">Memuat…</div>
            )}
            {!loading && notifications.length === 0 && (
              <div className="py-10 flex flex-col items-center text-gray-400">
                <Bell size={28} className="opacity-20 mb-2"/>
                <span className="text-sm">Belum ada notifikasi</span>
              </div>
            )}
            {notifications.map(n => (
              <button key={n.id} onClick={() => markRead(n.id)}
                className={`w-full text-left px-4 py-3 border-b border-gray-50 flex gap-3
                  items-start hover:bg-gray-50 transition-colors
                  ${n.is_read ? 'opacity-60' : 'bg-blue-50/30'}`}>
                <span className="text-base shrink-0 mt-0.5">{TYPE_ICON[n.type] || '🔔'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-xs font-semibold text-gray-800 leading-snug">{n.title}</p>
                    {!n.is_read && <span className="w-1.5 h-1.5 rounded-full bg-brand-700 shrink-0"/>}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: localeId })}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {showSettings && <NotifSettingsModal onClose={() => setSettings(false)} />}
    </div>
  );
}
