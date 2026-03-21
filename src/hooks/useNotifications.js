import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

const TYPE_ICON = {
  jadwal: '📅', swap: '🔄', pengumuman: '📢',
  streak: '🔥', laporan: '📊', badge: '🏆', latihan: '🎵',
};

export function useNotifications(userId) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [loading,       setLoading]       = useState(true);
  const channelRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('in_app_notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) {
      setNotifications(data);
      setUnreadCount(data.filter(n => !n.is_read).length);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    fetchNotifications();

    channelRef.current = supabase
      .channel(`notif:${userId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public',
        table: 'in_app_notifications',
        filter: `user_id=eq.${userId}`,
      }, payload => {
        const n = payload.new;
        setNotifications(prev => [n, ...prev]);
        setUnreadCount(c => c + 1);
        toast(n.title, { icon: TYPE_ICON[n.type] || '🔔', duration: 5000 });
      })
      .subscribe();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [userId, fetchNotifications]);

  const markRead = useCallback(async (id) => {
    await supabase
      .from('in_app_notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    setUnreadCount(c => Math.max(0, c - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    await supabase
      .from('in_app_notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', userId).eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  }, [userId]);

  return { notifications, unreadCount, loading, markRead, markAllRead, refetch: fetchNotifications };
}

/** Kirim notifikasi ke 1 user */
export async function sendNotification({ userId, title, body, type = 'pengumuman', data = {} }) {
  return supabase.from('in_app_notifications').insert({ user_id: userId, title, body, type, data });
}

/** Broadcast ke semua anggota aktif */
export async function broadcastNotification({ title, body, type = 'pengumuman', data = {} }) {
  const { data: users } = await supabase
    .from('users')
    .select('id')
    .eq('status', 'Active');
  if (!users?.length) return;
  return supabase.from('in_app_notifications')
    .insert(users.map(u => ({ user_id: u.id, title, body, type, data })));
}
