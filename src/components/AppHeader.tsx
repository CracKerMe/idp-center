import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { Shield, LogOut, User } from 'lucide-react';
import { clsx } from 'clsx';

interface AppHeaderProps {
  user: any;
  setUser: (user: any) => void;
}

export default function AppHeader({ user, setUser }: AppHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    navigate({ to: '/login' });
  };

  return (
    <nav className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          <Link to="/" className="flex items-center shrink-0">
            <Shield className="h-8 w-8 text-indigo-600" />
            <span className="ml-2 text-xl font-bold text-zinc-900">IdP Center</span>
          </Link>

          <div className="flex items-center gap-3 sm:gap-4">
            <Link
              to="/profile"
              className={clsx(
                'flex items-center text-sm transition-colors',
                location.pathname === '/profile' ? 'text-indigo-600' : 'text-zinc-700 hover:text-indigo-600'
              )}
            >
              <User className="mr-1 h-4 w-4" />
              Profile
            </Link>

            <span className="hidden text-sm text-zinc-700 sm:inline">Welcome, {user.username}</span>

            {user.is_admin && (
              <Link to="/admin" className="text-sm font-medium text-indigo-600 hover:text-indigo-900">
                Admin Dashboard
              </Link>
            )}

            <button
              onClick={handleLogout}
              className="inline-flex items-center rounded-md border border-transparent px-3 py-2 text-sm font-medium leading-4 text-zinc-500 transition hover:text-zinc-700 focus:outline-none"
            >
              <LogOut className="mr-1 h-4 w-4" />
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}