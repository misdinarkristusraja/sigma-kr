import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  LayoutDashboard, Users, Calendar, CalendarDays, QrCode,
  ArrowLeftRight, BarChart2, Trophy, CreditCard, Database,
  Settings, LogOut, Menu, X, Bell, ChevronRight,
  Church, Shield, UserCheck,
} from 'lucide-react';
import { cn, truncate } from '../../lib/utils';
import toast from 'react-hot-toast';

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Dashboard',        path: '/dashboard',        roles: null },
  { icon: Users,           label: 'Anggota',          path: '/anggota',          roles: ['Administrator','Pengurus','Pelatih'] },
  { icon: Calendar,        label: 'Jadwal Mingguan',  path: '/jadwal-mingguan',  roles: ['Administrator','Pengurus'] },
  { icon: CalendarDays,    label: 'Misa Harian',      path: '/jadwal-harian',    roles: ['Administrator','Pengurus'] },
  { icon: QrCode,          label: 'Scan QR',          path: '/scan-qr',          roles: ['Administrator','Pengurus','Pelatih'] },
  { icon: ArrowLeftRight,  label: 'Tukar Jadwal',     path: '/tukar-jadwal',     roles: null },
  { icon: BarChart2,       label: 'Rekap & Poin',     path: '/rekap',            roles: null },
  { icon: Trophy,          label: 'Leaderboard',      path: '/leaderboard',      roles: null },
  { icon: CreditCard,      label: 'Kartu Anggota',    path: '/kartu',            roles: null },
  { icon: Database,        label: 'Migrasi Data',     path: '/migrasi',          roles: ['Administrator'] },
  { icon: Settings,        label: 'Admin & Config',   path: '/admin',            roles: ['Administrator'] },
];

export default function Layout() {
  const { profile, signOut, isAdmin, isPengurus, isPelatih } = useAuth();
  const navigate  = useNavigate();
  const [open, setOpen] = useState(false);

  async function handleSignOut() {
    await signOut();
    toast.success('Berhasil logout');
    navigate('/login');
  }

  function canSeeItem(item) {
    if (!item.roles) return true;
    return item.roles.includes(profile?.role);
  }

  const visibleItems = NAV_ITEMS.filter(canSeeItem);

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-brand-900/30">
        <div className="w-9 h-9 bg-white/15 rounded-xl flex items-center justify-center">
          <Church size={18} className="text-white" />
        </div>
        <div>
          <div className="font-bold text-white text-lg leading-none">SIGMA</div>
          <div className="text-[10px] text-brand-200 mt-0.5 leading-none">Misdinar KR Solo Baru</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        {visibleItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cn('nav-item', isActive ? 'nav-item-active' : 'nav-item-inactive text-brand-100/80')
            }
          >
            <item.icon size={17} />
            <span className="text-sm">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Profile */}
      <div className="p-3 border-t border-brand-900/30">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
            {profile?.nama_panggilan?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white truncate">
              {truncate(profile?.nama_panggilan || profile?.nickname || '—', 18)}
            </div>
            <div className="text-[11px] text-brand-200">{profile?.role?.replace('_', ' ')}</div>
          </div>
          <button
            onClick={handleSignOut}
            className="p-1.5 rounded-lg text-brand-200 hover:text-white hover:bg-white/10 transition-colors"
            title="Logout"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-60 flex-shrink-0 bg-brand-800 flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="relative w-60 bg-brand-800 flex flex-col z-10">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 p-1.5 text-brand-200 hover:text-white"
            >
              <X size={20} />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile topbar */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 shadow-sm">
          <button
            onClick={() => setOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <Church size={18} className="text-brand-800" />
            <span className="font-bold text-brand-800">SIGMA</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
