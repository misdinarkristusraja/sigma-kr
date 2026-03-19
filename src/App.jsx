import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/layout/Layout';
import LoadingScreen from './components/ui/LoadingScreen';

const LoginPage         = lazy(() => import('./pages/LoginPage'));
const RegisterPage      = lazy(() => import('./pages/RegisterPage'));
const DashboardPage     = lazy(() => import('./pages/DashboardPage'));
const MembersPage       = lazy(() => import('./pages/MembersPage'));
const MemberDetailPage  = lazy(() => import('./pages/MemberDetailPage'));
const ScheduleWeekly    = lazy(() => import('./pages/ScheduleWeeklyPage'));
const ScheduleDaily     = lazy(() => import('./pages/ScheduleDailyPage'));
const ScanPage          = lazy(() => import('./pages/ScanPage'));
const ScanRecordsPage   = lazy(() => import('./pages/ScanRecordsPage'));
const SwapPage          = lazy(() => import('./pages/SwapPage'));
const RecapPage         = lazy(() => import('./pages/RecapPage'));
const LeaderboardPage   = lazy(() => import('./pages/LeaderboardPage'));
const CardsPage         = lazy(() => import('./pages/CardsPage'));
const MigrationPage     = lazy(() => import('./pages/MigrationPage'));
const AdminPage         = lazy(() => import('./pages/AdminPage'));
const ReregistrationPage= lazy(() => import('./pages/ReregistrationPage'));
const PublicSchedule    = lazy(() => import('./pages/ScheduleDailyPage').then(m => ({ default: m.PublicSchedulePage })));
const NotFound          = lazy(() => import('./pages/ScheduleDailyPage').then(m => ({ default: m.NotFoundPage })));

// Role groups untuk kemudahan
const ADMIN_ONLY    = ['Administrator'];
const ADMIN_PENG    = ['Administrator', 'Pengurus'];
const ADMIN_PENG_LATIH = ['Administrator', 'Pengurus', 'Pelatih'];
const ALL_STAFF     = ['Administrator', 'Pengurus', 'Pelatih'];  // sama dengan di atas, alias

function ProtectedRoute({ children, roles }) {
  const { user, profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user)   return <Navigate to="/login" replace />;
  if (roles && profile && !roles.includes(profile.role))
    return <Navigate to="/dashboard" replace />;
  return children;
}

function R({ path, element, roles }) {
  // Helper: bungkus element dengan ProtectedRoute jika ada roles
  const wrapped = roles ? <ProtectedRoute roles={roles}>{element}</ProtectedRoute> : element;
  return <Route path={path} element={wrapped} />;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        {/* Public routes */}
        <Route path="/login"  element={user ? <Navigate to="/dashboard" /> : <LoginPage />} />
        <Route path="/daftar" element={<RegisterPage />} />
        <Route path="/jadwal" element={<PublicSchedule />} />

        {/* Protected — semua butuh login */}
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/dashboard" />} />

          {/* Dashboard — semua role */}
          <Route path="/dashboard" element={<DashboardPage />} />

          {/* ── Anggota ──────────────────────────────────────────
              Pengurus: lihat list + approve + ubah status/suspend
              Pelatih:  lihat list (read-only)
              Admin:    full CRUD termasuk ubah role
          ─────────────────────────────────────────────────────── */}
          <Route path="/anggota"
            element={<ProtectedRoute roles={ALL_STAFF}><MembersPage /></ProtectedRoute>} />
          <Route path="/anggota/:id" element={<MemberDetailPage />} />

          {/* ── Jadwal Mingguan ──────────────────────────────────
              Pengurus: generate, edit draft, isi PIC, publish, hapus
              Pelatih:  TIDAK bisa akses (tidak perlu lihat backend jadwal)
          ─────────────────────────────────────────────────────── */}
          <Route path="/jadwal-mingguan"
            element={<ProtectedRoute roles={ADMIN_PENG}><ScheduleWeekly /></ProtectedRoute>} />

          {/* ── Jadwal Harian ────────────────────────────────────
              Semua login bisa lihat tab Jadwal
              Pengurus: generate, publish, edit opt-in orang lain
              Pelatih:  bisa lihat jadwal + isi opt-in sendiri
              Misdinar: bisa lihat jadwal + isi opt-in sendiri
          ─────────────────────────────────────────────────────── */}
          <Route path="/jadwal-harian" element={<ScheduleDaily />} />

          {/* ── Scan QR ──────────────────────────────────────────
              Admin, Pengurus, Pelatih bisa scan
          ─────────────────────────────────────────────────────── */}
          <Route path="/scan-qr"
            element={<ProtectedRoute roles={ALL_STAFF}><ScanPage /></ProtectedRoute>} />

          {/* ── Riwayat Scan ─────────────────────────────────────
              Admin & Pengurus: lihat semua + export
              Pelatih: lihat scan yang dia lakukan (filter di page)
          ─────────────────────────────────────────────────────── */}
          <Route path="/riwayat-scan"
            element={<ProtectedRoute roles={ALL_STAFF}><ScanRecordsPage /></ProtectedRoute>} />

          {/* ── Fitur semua role ──────────────────────────────── */}
          <Route path="/tukar-jadwal"  element={<SwapPage />} />
          <Route path="/rekap"         element={<RecapPage />} />
          <Route path="/leaderboard"   element={<LeaderboardPage />} />
          <Route path="/kartu"         element={<CardsPage />} />
          <Route path="/daftar-ulang"  element={<ReregistrationPage />} />

          {/* ── Admin only ───────────────────────────────────── */}
          <Route path="/migrasi"
            element={<ProtectedRoute roles={ADMIN_ONLY}><MigrationPage /></ProtectedRoute>} />
          <Route path="/admin"
            element={<ProtectedRoute roles={ADMIN_ONLY}><AdminPage /></ProtectedRoute>} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return <AuthProvider><AppRoutes /></AuthProvider>;
}
