import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Trophy, LogOut, LayoutDashboard } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export default function Layout() {
  const { session, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const navLink = (path: string) =>
    `flex-1 sm:flex-none justify-center px-2 sm:px-3 py-2 rounded-lg hover:bg-pitch-600 min-h-[44px] flex items-center transition-colors ${
      location.pathname === path ? 'bg-pitch-600' : ''
    }`;

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-pitch-700 text-white sticky top-0 z-10 shadow-md">
        {/*
          Phone: row 1 = logo + sign-in / account, row 2 = the four page links spread evenly.
          Wider screens: everything on one row.
        */}
        <div className="max-w-5xl mx-auto px-4 py-2 sm:py-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-2 gap-y-1">
          <Link to="/" className="flex items-center gap-2 min-h-[44px]">
            <Trophy className="w-6 h-6 text-gold-400" aria-hidden />
            <span className="font-display font-bold text-lg leading-tight">MSA</span>
          </Link>

          <nav
            aria-label="Main"
            className="order-last sm:order-none w-full sm:w-auto flex items-center gap-1 text-sm font-medium"
          >
            <Link to="/" className={navLink('/')}>
              Home
            </Link>
            <Link to="/fixtures" className={navLink('/fixtures')}>
              Fixtures
            </Link>
            <Link to="/standings" className={navLink('/standings')}>
              Standings
            </Link>
            <Link to="/divisions" className={navLink('/divisions')}>
              Divisions
            </Link>
          </nav>

          <div className="flex items-center gap-1 text-sm font-medium">
            {session ? (
              <>
                <Link
                  to="/dashboard"
                  className="px-3 py-2 rounded-lg hover:bg-pitch-600 min-h-[44px] flex items-center gap-1"
                  aria-label="Dashboard"
                >
                  <LayoutDashboard className="w-4 h-4" aria-hidden />
                  <span className="sm:hidden">Dashboard</span>
                  <span className="hidden sm:inline">
                    {profile?.full_name?.split(' ')[0] || 'Dashboard'}
                  </span>
                </Link>
                <button
                  onClick={handleSignOut}
                  className="px-3 py-2 rounded-lg hover:bg-pitch-600 min-h-[44px] flex items-center gap-1"
                  aria-label="Sign out"
                >
                  <LogOut className="w-4 h-4" aria-hidden />
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              </>
            ) : (
              <Link
                to="/signin"
                className="px-4 py-2 rounded-lg bg-gold-500 text-pitch-900 hover:bg-gold-400 min-h-[44px] flex items-center font-semibold whitespace-nowrap"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>

      <footer className="bg-pitch-800 text-pitch-100 text-center text-sm py-4">
        <div className="max-w-5xl mx-auto px-4">Madang Soccer Association</div>
      </footer>
    </div>
  );
}
