import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AuthProvider } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabaseClient';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';
import SetupNeeded from '@/components/SetupNeeded';
import PublicHome from '@/routes/PublicHome';
import DivisionsPage from '@/routes/DivisionsPage';
import FixturesPage from '@/routes/FixturesPage';
import StandingsPage from '@/routes/StandingsPage';
import SignInPage from '@/routes/SignInPage';
import SignUpPage from '@/routes/SignUpPage';

// Signed-in screens load on demand, so the public pages stay small and fast
// on slow mobile connections.
const DashboardPage = lazy(() => import('@/routes/DashboardPage'));
const PlayersPage = lazy(() => import('@/routes/PlayersPage'));
const ClubsPage = lazy(() => import('@/routes/ClubsPage'));
const ClubDetailPage = lazy(() => import('@/routes/ClubDetailPage'));
const SeasonsPage = lazy(() => import('@/routes/SeasonsPage'));
const CompetitionsPage = lazy(() => import('@/routes/CompetitionsPage'));
const ResultsPage = lazy(() => import('@/routes/ResultsPage'));
const UsersPage = lazy(() => import('@/routes/UsersPage'));
const MovesPage = lazy(() => import('@/routes/MovesPage'));
const PlayerProfilePage = lazy(() => import('@/routes/PlayerProfilePage'));
const DisciplinePage = lazy(() => import('@/routes/DisciplinePage'));
const MatchEventsPage = lazy(() => import('@/routes/MatchEventsPage'));
const RolloverPage = lazy(() => import('@/routes/RolloverPage'));

function PageLoading() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 animate-spin text-pitch-600" aria-hidden />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export default function App() {
  if (!isSupabaseConfigured) return <SetupNeeded />;

  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route element={<Layout />}>
              {/* Public routes */}
              <Route index element={<PublicHome />} />
              <Route path="divisions" element={<DivisionsPage />} />
              <Route path="fixtures" element={<FixturesPage />} />
              <Route path="standings" element={<StandingsPage />} />
              <Route path="signin" element={<SignInPage />} />
              <Route path="signup" element={<SignUpPage />} />

              {/* Any signed-in role */}
              <Route
                path="dashboard"
                element={
                  <ProtectedRoute roles={['public', 'club_manager', 'referee', 'admin']}>
                    <DashboardPage />
                  </ProtectedRoute>
                }
              />

              {/* Club managers and admins */}
              <Route
                path="players"
                element={
                  <ProtectedRoute roles={['club_manager', 'admin']}>
                    <PlayersPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="players/:id"
                element={
                  <ProtectedRoute roles={['club_manager', 'admin']}>
                    <PlayerProfilePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="clubs/:id"
                element={
                  <ProtectedRoute roles={['club_manager', 'admin']}>
                    <ClubDetailPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/clubs"
                element={
                  <ProtectedRoute roles={['club_manager', 'admin']}>
                    <ClubsPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="moves"
                element={
                  <ProtectedRoute roles={['club_manager', 'admin']}>
                    <MovesPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="rollover"
                element={
                  <ProtectedRoute roles={['club_manager', 'admin']}>
                    <RolloverPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="discipline"
                element={
                  <ProtectedRoute roles={['club_manager', 'admin']}>
                    <DisciplinePage />
                  </ProtectedRoute>
                }
              />

              {/* Referees and admins */}
              <Route
                path="matches/:id/events"
                element={
                  <ProtectedRoute roles={['referee', 'admin']}>
                    <MatchEventsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="matches/manage"
                element={
                  <ProtectedRoute roles={['referee', 'admin']}>
                    <ResultsPage />
                  </ProtectedRoute>
                }
              />

              {/* Admins only (admin always passes; an empty list lets nobody else in) */}
              <Route
                path="admin/seasons"
                element={
                  <ProtectedRoute roles={[]}>
                    <SeasonsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/competitions"
                element={
                  <ProtectedRoute roles={[]}>
                    <CompetitionsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/users"
                element={
                  <ProtectedRoute roles={[]}>
                    <UsersPage />
                  </ProtectedRoute>
                }
              />

              <Route path="*" element={<PublicHome />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
