import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/layout/Layout';
import LoadingScreen from './components/ui/LoadingScreen';

const LoginPage      = lazy(() => import('./pages/LoginPage'));
const RegisterPage   = lazy(() => import('./pages/RegisterPage'));
const DashboardPage  = lazy(() => import('./pages/DashboardPage'));
const MembersPage    = lazy(() => import('./pages/MembersPage'));
const MemberDetail   = lazy(() => import('./pages/MemberDetailPage'));
const ScheduleWeekly = lazy(() => import('./pages/ScheduleWeeklyPage'));
const ScheduleDaily  = lazy(() => import('./pages/ScheduleDailyPage'));
const ScanPage       = lazy(() => import('./pages/ScanPage'));
const SwapPage       = lazy(() => import('./pages/SwapPage'));
const RecapPage      = lazy(() => import('./pages/RecapPage'));
const Leaderboard    = lazy(() => import('./pages/LeaderboardPage'));
const CardsPage      = lazy(() => import('./pages/CardsPage'));
const MigrationPage  = lazy(() => import('./pages/MigrationPage'));
const AdminPage      = lazy(() => import('./pages/AdminPage'));
const PublicSchedule = lazy(() => import('./pages/ScheduleDailyPage').then(m => ({ default: m.PublicSchedulePage })));
const NotFound       = lazy(() => import('./pages/ScheduleDailyPage').then(m => ({ default: m.NotFoundPage })));

function ProtectedRoute({ children, roles }) {
  const { user, profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user)   return <Navigate to="/login" replace />;
  if (roles && profile && !roles.includes(profile.role)) return <Navigate to="/dashboard" replace />;
  return children;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/login"  element={user ? <Navigate to="/dashboard" /> : <LoginPage />} />
        <Route path="/daftar" element={<RegisterPage />} />
        <Route path="/jadwal" element={<PublicSchedule />} />
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/dashboard" />} />
          <Route path="/dashboard"       element={<DashboardPage />} />
          <Route path="/anggota"         element={<ProtectedRoute roles={['Administrator','Pengurus','Pelatih']}><MembersPage /></ProtectedRoute>} />
          <Route path="/anggota/:id"     element={<MemberDetail />} />
          <Route path="/jadwal-mingguan" element={<ProtectedRoute roles={['Administrator','Pengurus']}><ScheduleWeekly /></ProtectedRoute>} />
          <Route path="/jadwal-harian"   element={<ScheduleDaily />} />
          <Route path="/scan-qr"         element={<ProtectedRoute roles={['Administrator','Pengurus','Pelatih']}><ScanPage /></ProtectedRoute>} />
          <Route path="/tukar-jadwal"    element={<SwapPage />} />
          <Route path="/rekap"           element={<RecapPage />} />
          <Route path="/leaderboard"     element={<Leaderboard />} />
          <Route path="/kartu"           element={<CardsPage />} />
          <Route path="/migrasi"         element={<ProtectedRoute roles={['Administrator']}><MigrationPage /></ProtectedRoute>} />
          <Route path="/admin"           element={<ProtectedRoute roles={['Administrator']}><AdminPage /></ProtectedRoute>} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return <AuthProvider><AppRoutes /></AuthProvider>;
}
