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
const MonthlyReportPage  = lazy(() => import('./pages/MonthlyReportPage'));
// SpecialMassPage dihapus — logikanya dikonsolidasi ke LatihanMisaBesarPage
const StreakPage          = lazy(() => import('./pages/StreakPage'));
const LatihanMisaBesarPage = lazy(() => import('./pages/LatihanMisaBesarPage'));
const PublicSchedule     = lazy(() => import('./pages/ScheduleDailyPage').then(m => ({ default: m.PublicSchedulePage })));
const NotFound           = lazy(() => import('./pages/ScheduleDailyPage').then(m => ({ default: m.NotFoundPage })));

const ADMIN = ['Administrator'];
const PENG  = ['Administrator', 'Pengurus'];
const STAFF = ['Administrator', 'Pengurus', 'Pelatih'];

function ProtectedRoute({ children, roles }) {
  const { user, profile, loading } = useAuth();
  if (loading) return <LoadingScreen/>;
  if (!user)   return <Navigate to="/login" replace/>;
  if (roles && profile && !roles.includes(profile.role))
    return <Navigate to="/dashboard" replace/>;
  return children;
}

function AppRoutes() {
  const { user, profile, loading } = useAuth();
  if (loading) return <LoadingScreen/>;

  // Force change password jika flag aktif
  // Redirect ke /ganti-password kecuali jika sudah di sana atau di login
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
          <Route path="/login"           element={user ? <Navigate to="/dashboard"/> : <LoginPage/>}/>
          <Route path="/daftar"          element={<RegisterPage/>}/>
          <Route path="/jadwal"          element={<PublicSchedule/>}/>
          {/* Ganti password — butuh user login tapi tidak butuh Layout */}
          <Route path="/ganti-password"  element={user ? <ChangePasswordPage/> : <Navigate to="/login"/>}/>

          {/* Protected + Layout */}
          <Route element={<ProtectedRoute><Layout/></ProtectedRoute>}>
            <Route index                  element={<Navigate to="/dashboard"/>}/>
            <Route path="/dashboard"      element={<ErrorBoundary><DashboardPage/></ErrorBoundary>}/>
            <Route path="/anggota"        element={<ProtectedRoute roles={STAFF}><ErrorBoundary><MembersPage/></ErrorBoundary></ProtectedRoute>}/>
            <Route path="/anggota/:id"    element={<ErrorBoundary><MemberDetailPage/></ErrorBoundary>}/>
            <Route path="/jadwal-mingguan" element={<ProtectedRoute roles={PENG}><ErrorBoundary><ScheduleWeekly/></ErrorBoundary></ProtectedRoute>}/>
            <Route path="/jadwal-harian"  element={<ErrorBoundary><ScheduleDaily/></ErrorBoundary>}/>
            <Route path="/scan-qr"        element={<ProtectedRoute roles={STAFF}><ErrorBoundary><ScanPage/></ErrorBoundary></ProtectedRoute>}/>
            <Route path="/riwayat-scan"   element={<ProtectedRoute roles={STAFF}><ErrorBoundary><ScanRecordsPage/></ErrorBoundary></ProtectedRoute>}/>
            <Route path="/tukar-jadwal"   element={<ErrorBoundary><SwapPage/></ErrorBoundary>}/>
            <Route path="/rekap"          element={<ErrorBoundary><RecapPage/></ErrorBoundary>}/>
            <Route path="/kartu"          element={<ErrorBoundary><CardsPage/></ErrorBoundary>}/>
            <Route path="/daftar-ulang"   element={<ErrorBoundary><ReregistrationPage/></ErrorBoundary>}/>
            <Route path="/statistik"      element={<ProtectedRoute roles={PENG}><ErrorBoundary><StatistikPage/></ErrorBoundary></ProtectedRoute>}/>
            <Route path="/migrasi"        element={<ProtectedRoute roles={ADMIN}><ErrorBoundary><MigrationPage/></ErrorBoundary></ProtectedRoute>}/>
            <Route path="/admin"          element={<ProtectedRoute roles={ADMIN}><ErrorBoundary><AdminPage/></ErrorBoundary></ProtectedRoute>}/>
            <Route path="/laporan-bulanan"  element={<ProtectedRoute roles={PENG}><ErrorBoundary><MonthlyReportPage/></ErrorBoundary></ProtectedRoute>}/>
            {/* /latihan-khusus dihapus — logikanya ada di tab "Sesi Mandiri" di /latihan-misa-besar */}
            <Route path="/latihan-misa-besar" element={<ErrorBoundary><LatihanMisaBesarPage/></ErrorBoundary>}/>
            <Route path="/streak"           element={<ErrorBoundary><StreakPage/></ErrorBoundary>}/>
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
