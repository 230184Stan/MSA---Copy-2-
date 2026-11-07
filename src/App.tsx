import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/lib/auth';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';
import PublicHome from '@/routes/PublicHome';
import DivisionsPage from '@/routes/DivisionsPage';
import FixturesPage from '@/routes/FixturesPage';
import StandingsPage from '@/routes/StandingsPage';
import SignInPage from '@/routes/SignInPage';
import SignUpPage from '@/routes/SignUpPage';
import DashboardPage from '@/routes/DashboardPage';
import PlayersPage from '@/routes/PlayersPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            {/* Public routes */}
            <Route index element={<PublicHome />} />
            <Route path="divisions" element={<DivisionsPage />} />
            <Route path="fixtures" element={<FixturesPage />} />
            <Route path="standings" element={<StandingsPage />} />
            <Route path="signin" element={<SignInPage />} />
            <Route path="signup" element={<SignUpPage />} />

            {/* Authenticated routes — any signed-in role */}
            <Route
              path="dashboard"
              element={
                <ProtectedRoute roles={['public', 'club_manager', 'referee', 'admin']}>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="players"
              element={
                <ProtectedRoute roles={['club_manager', 'admin']}>
                  <PlayersPage />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<PublicHome />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
