import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/layout/Layout';
import LoadingScreen from './components/ui/LoadingScreen';
import ErrorBoundary from './components/ui/ErrorBoundary';

const LoginPage          = lazy(() => import('./pages/LoginPage'));
const RegisterPage       = lazy(() => import('./pages/RegisterPage'));
const DashboardPage      = lazy(() => import('./pages/DashboardPage'));
const MembersPage        = lazy(() => import('./pages/MembersPage'));
const MemberDetailPage   = lazy(() => import('./pages/MemberDetailPage'));
const ScheduleWeekly     = lazy(() => import('./pages/ScheduleWeeklyPage'));
const ScheduleDaily      = lazy(() => import('./pages/ScheduleDailyPage'));
const ScanPage           = lazy(() => import('./pages/ScanPage'));
const ScanRecordsPage    = lazy(() => import('./pages/ScanRecordsPage'));
const SwapPage           = lazy(() => import('./pages/SwapPage'));
const RecapPage          = lazy(() => import('./pages/RecapPage'));
const CardsPage          = lazy(() => import('./pages/CardsPage'));
const MigrationPage      = lazy(() => import('./pages/MigrationPage'));
const AdminPage          = lazy(() => import('./pages/AdminPage'));
const ReregistrationPage = lazy(() => import('./pages/ReregistrationPage'));
const StatistikPage      = lazy(() => import('./pages/StatistikPage'));
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage'));
const LaporanPage        = lazy(() => import('./pages/LaporanPage'));
const StreakPage          = lazy(() => import('./pages/StreakPage'));
const PublicSchedule     = lazy(() => import('./pages/ScheduleDailyPage').then(m => ({ default: m.PublicSchedulePage })));
const NotFound           = lazy(() => import('./pages/ScheduleDailyPage').then(m => ({ default: m.NotFoundPage })));

const ADMIN = ['Administrator'];
const PENG  = ['Administrator', 'Pengurus'];
const STAFF = ['Administrator', 'Pengurus', 'Pelatih'];

/**
 * ProtectedRoute — penjaga akses berbasis login dan role.
 *
 * FIX BUG-006 (lanjutan): Konsumsi profileError dari AuthContext.
 * Jika profil gagal dimuat (RPC error / akun belum approved), tampilkan
 * pesan informatif daripada loading selamanya atau memberi akses default.
 */
function ProtectedRoute({ children, roles }) {
  const { user, profile, profileError, loading } = useAuth();

  if (loading) return <LoadingScreen/>;
  if (!user)   return <Navigate to="/login" replace/>;

  // Profil error: tampilkan pesan jelas, bukan loading selamanya
  if (profileError && !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-lg font-bold text-gray-800 mb-2">Profil tidak dapat dimuat</h2>
          <p className="text-gray-500 text-sm mb-5 leading-relaxed">
            Akunmu mungkin belum disetujui Admin, atau terjadi gangguan koneksi sementara.
            Coba refresh halaman atau hubungi Pengurus jika masalah berlanjut.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2 bg-red-800 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
          >
            Refresh Halaman
          </button>
        </div>
      </div>
    );
  }

  // Masih menunggu profile selesai di-fetch (normal loading)
  if (!profile) return <LoadingScreen/>;

  if (roles && !roles.includes(profile.role))
    return <Navigate to="/dashboard" replace/>;

  return children;
}

function AppRoutes() {
  const { user, profile, loading } = useAuth();
  if (loading) return <LoadingScreen/>;

  // Force change password jika flag aktif
  const path = window.location.pathname;
  if (user && profile?.must_change_password &&
      path !== '/ganti-password' && path !== '/login') {
    return <Navigate to="/ganti-password" replace/>;
  }

  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingScreen/>}>
        <Routes>
          {/* Public */}
          <Route path="/login"          element={user ? <Navigate to="/dashboard"/> : <LoginPage/>}/>
          <Route path="/daftar"         element={<RegisterPage/>}/>
          <Route path="/jadwal"         element={<PublicSchedule/>}/>
          {/* Ganti password — butuh user login tapi tidak butuh Layout */}
          <Route path="/ganti-password" element={user ? <ChangePasswordPage/> : <Navigate to="/login"/>}/>

          {/* Protected + Layout */}
          <Route element={<ProtectedRoute><Layout/></ProtectedRoute>}>
            <Route index                   element={<Navigate to="/dashboard"/>}/>
            <Route path="/dashboard"       element={<ErrorBoundary><DashboardPage/></ErrorBoundary>}/>

            {/* Daftar anggota — STAFF only */}
            <Route path="/anggota"         element={<ProtectedRoute roles={STAFF}><ErrorBoundary><MembersPage/></ErrorBoundary></ProtectedRoute>}/>

            {/*
              FIX BUG-005: Sebelumnya /anggota/:id tidak memiliki ProtectedRoute dengan roles,
              sehingga Misdinar_Aktif dan Misdinar_Retired bisa mengakses halaman detail
              anggota manapun langsung via URL — termasuk hp_ortu, alamat, nama orang tua
              yang menurut SKPL N10 hanya boleh dilihat Admin & Pengurus.
              Sekarang ditambahkan roles={STAFF} agar Pelatih+ yang bisa mengakses.
            */}
            <Route path="/anggota/:id"     element={<ProtectedRoute roles={STAFF}><ErrorBoundary><MemberDetailPage/></ErrorBoundary></ProtectedRoute>}/>

            <Route path="/jadwal-mingguan" element={<ProtectedRoute roles={PENG}><ErrorBoundary><ScheduleWeekly/></ErrorBoundary></ProtectedRoute>}/>
            <Route path="/jadwal-harian"   element={<ErrorBoundary><ScheduleDaily/></ErrorBoundary>}/>
            <Route path="/scan-qr"         element={<ProtectedRoute roles={STAFF}><ErrorBoundary><ScanPage/></ErrorBoundary></ProtectedRoute>}/>
            <Route path="/riwayat-scan"    element={<ProtectedRoute roles={STAFF}><ErrorBoundary><ScanRecordsPage/></ErrorBoundary></ProtectedRoute>}/>
            <Route path="/tukar-jadwal"    element={<ErrorBoundary><SwapPage/></ErrorBoundary>}/>
            <Route path="/rekap"           element={<ErrorBoundary><RecapPage/></ErrorBoundary>}/>
            <Route path="/kartu"           element={<ErrorBoundary><CardsPage/></ErrorBoundary>}/>
            <Route path="/daftar-ulang"    element={<ErrorBoundary><ReregistrationPage/></ErrorBoundary>}/>
            <Route path="/statistik"       element={<ProtectedRoute roles={PENG}><ErrorBoundary><StatistikPage/></ErrorBoundary></ProtectedRoute>}/>
            <Route path="/laporan"         element={<ProtectedRoute roles={PENG}><ErrorBoundary><LaporanPage/></ErrorBoundary></ProtectedRoute>}/>
            <Route path="/streak"          element={<ErrorBoundary><StreakPage/></ErrorBoundary>}/>
            <Route path="/migrasi"         element={<ProtectedRoute roles={ADMIN}><ErrorBoundary><MigrationPage/></ErrorBoundary></ProtectedRoute>}/>
            <Route path="/admin"           element={<ProtectedRoute roles={ADMIN}><ErrorBoundary><AdminPage/></ErrorBoundary></ProtectedRoute>}/>
          </Route>

          <Route path="*" element={<NotFound/>}/>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppRoutes/>
      </AuthProvider>
    </ErrorBoundary>
  );
}
