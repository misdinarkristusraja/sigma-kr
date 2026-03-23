import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  LayoutDashboard, Users, Calendar, CalendarDays, QrCode,
  ArrowLeftRight, BarChart2, CreditCard, Database,
  Settings, LogOut, Menu, X, Church, AlertTriangle,
  ClipboardList, RefreshCw, PieChart, FileBarChart2,
  BookOpen, Flame,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { cn, truncate } from '../../lib/utils';
import toast from 'react-hot-toast';
import NotificationBell from '../notifications/NotificationBell';

const STAFF = ['Administrator', 'Pengurus', 'Pelatih'];
const PENG  = ['Administrator', 'Pengurus'];
const ADMIN = ['Administrator'];

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Dashboard',         path: '/dashboard',       roles: null  },
  { icon: Users,           label: 'Anggota',           path: '/anggota',         roles: STAFF },
  { icon: Calendar,        label: 'Jadwal Mingguan',   path: '/jadwal-mingguan', roles: PENG  },
  { icon: CalendarDays,    label: 'Misa Harian',           path: '/jadwal-harian',      roles: null  },
  // SpecialMassPage dihapus — logikanya dikonsolidasi ke LatihanMisaBesarPage (tab "Sesi Mandiri")
  { icon: BookOpen,        label: '🎓 Latihan Misa Besar', path: '/latihan-misa-besar', roles: null  },
  { icon: QrCode,          label: 'Scan QR',           path: '/scan-qr',         roles: STAFF },
  { icon: ClipboardList,   label: 'Riwayat Scan',      path: '/riwayat-scan',    roles: STAFF },
  { icon: ArrowLeftRight,  label: 'Tukar Jadwal',      path: '/tukar-jadwal',    roles: null  },
  { icon: BarChart2,       label: 'Rekap & Poin',      path: '/rekap',           roles: null  },
  { icon: Flame,           label: 'Streak & Badge',    path: '/streak',          roles: null, configKey: 'streak_nav_visible' },
  { icon: CreditCard,      label: 'Kartu Anggota',     path: '/kartu',           roles: null  },
  { icon: RefreshCw,       label: 'Daftar Ulang',      path: '/daftar-ulang',    roles: null  },
  { icon: FileBarChart2,   label: 'Laporan Bulanan',   path: '/laporan-bulanan', roles: PENG  },
  { icon: PieChart,        label: 'Statistik',         path: '/statistik',       roles: PENG  },
  { icon: Database,        label: 'Migrasi Data',      path: '/migrasi',         roles: ADMIN, configKey: 'migration_enabled' },
  { icon: Settings,        label: 'Admin & Config',    path: '/admin',           roles: ADMIN },
];

export default function Layout() {
  const { profile, role, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [open,       setOpen]      = useState(false);
  const [hiddenKeys, setHiddenKeys]= useState({});

  useEffect(() => {
    supabase
      .from('system_config')
      .select('key, value')
      .in('key', ['migration_enabled', 'streak_feature_enabled'])
      .then(({ data }) => {
        if (!data) return;
        const map = {};
        data.forEach(row => {
          if (row.key === 'migration_enabled')      map['migration_enabled']    = row.value !== 'false';
          if (row.key === 'streak_feature_enabled') map['streak_nav_visible']   = row.value === 'true';
        });
        setHiddenKeys(map);
      })
      .catch(() => {});
  }, []);

  async function handleSignOut() {
    await signOut();
    toast.success('Berhasil logout');
    navigate('/login');
  }

  function canSeeItem(item) {
    if (item.configKey && hiddenKeys[item.configKey] === false) return false;
    // streak nav: hanya tampil jika enabled, kecuali admin/pengurus
    if (item.path === '/streak') {
      const isStaff = PENG.includes(role) || role === 'Administrator';
      if (!isStaff && !hiddenKeys['streak_nav_visible']) return false;
    }
    if (!item.roles) return true;
    if (!role) return true;
    return item.roles.includes(role);
  }

  const visibleItems = NAV_ITEMS.filter(canSeeItem);
  const displayName  = profile?.nama_panggilan || profile?.nickname || '...';

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-brand-900/30">
        <div className="w-9 h-9 bg-white/15 rounded-xl flex items-center justify-center">
          <Church size={18} className="text-white"/>
        </div>
        <div>
          <div className="font-bold text-white text-lg leading-none">SIGMA</div>
          <div className="text-[10px] text-brand-200 mt-0.5 leading-none">Misdinar KR Solo Baru</div>
        </div>
      </div>

      {!profile && !authLoading && (
        <div className="mx-3 mt-3 p-2 bg-yellow-500/20 rounded-lg flex items-start gap-2">
          <AlertTriangle size={13} className="text-yellow-300 flex-shrink-0 mt-0.5"/>
          <p className="text-[10px] text-yellow-200 leading-tight">
            Profil tidak ditemukan. Hubungi administrator.
          </p>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        {visibleItems.map(item => (
          <NavLink key={item.path} to={item.path} onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cn('nav-item', isActive ? 'nav-item-active' : 'nav-item-inactive text-brand-100/80')
            }>
            <item.icon size={17}/>
            <span className="text-sm">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-brand-900/30">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
            {displayName[0]?.toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white truncate">{truncate(displayName, 18)}</div>
            <div className="text-[11px] text-brand-200">{role?.replace('_', ' ') || 'Memuat...'}</div>
          </div>
          <button onClick={handleSignOut}
            className="p-1.5 rounded-lg text-brand-200 hover:text-white hover:bg-white/10"
            title="Logout">
            <LogOut size={15}/>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-60 flex-shrink-0 bg-brand-800 flex-col">
        <SidebarContent/>
      </aside>

      {/* Mobile overlay */}
      <div className={`lg:hidden fixed inset-0 z-50 flex transition-all duration-300 ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)}/>
        <aside className={`relative w-64 bg-brand-800 flex flex-col z-10 shadow-2xl transition-transform duration-300 ease-out ${open ? 'translate-x-0' : '-translate-x-full'}`}>
          <button onClick={() => setOpen(false)}
            className="absolute top-3 right-3 p-1.5 text-brand-200 hover:text-white transition-colors">
            <X size={20}/>
          </button>
          <SidebarContent/>
        </aside>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-brand-800 border-b border-brand-900/30 shadow-sm">
          <button onClick={() => setOpen(true)}
            className="p-2 rounded-lg hover:bg-white/10 text-white">
            <Menu size={20}/>
          </button>
          <div className="flex items-center gap-2 flex-1">
            <Church size={18} className="text-white"/>
            <span className="font-bold text-white">SIGMA</span>
          </div>
          {/* Notification Bell di mobile header */}
          <NotificationBell/>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
            <Outlet/>
          </div>
        </main>
      </div>
    </div>
  );
}
