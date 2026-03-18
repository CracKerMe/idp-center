import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { Shield, LogOut, User } from 'lucide-react';
import { clsx } from 'clsx';
import { authFetch } from '../utils/fetch';
import ThemeToggle from './ThemeToggle';

interface AppHeaderProps {
  user: any;
  setUser: (user: any) => void;
}

export default function AppHeader({ user, setUser }: AppHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await authFetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Logout API error:', error);
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('session_id');
      setUser(null);
      navigate({ to: '/login' });
    }
  };

  return (
    <nav className="bg-white shadow-sm dark:bg-zinc-900 dark:border-b dark:border-zinc-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          <Link to="/" className="flex items-center shrink-0">
            <Shield className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
            <span className="ml-2 text-xl font-bold text-zinc-900 dark:text-white">IdP Center</span>
          </Link>

          <div className="flex items-center gap-3 sm:gap-4">
            <Link
              to="/profile"
              className={clsx(
                'flex items-center text-sm transition-colors',
                location.pathname === '/profile' 
                  ? 'text-indigo-600 dark:text-indigo-400' 
                  : 'text-zinc-700 hover:text-indigo-600 dark:text-zinc-300 dark:hover:text-indigo-400'
              )}
            >
              <User className="mr-1 h-4 w-4" />
              Profile
            </Link>

            <span className="hidden text-sm text-zinc-700 dark:text-zinc-300 sm:inline">
              Welcome, {user.username}
            </span>

            {user.is_admin && (
              <Link 
                to="/admin" 
                className="text-sm font-medium text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300"
              >
                Admin Dashboard
              </Link>
            )}

            <ThemeToggle showSystem={false} />

            <button
              onClick={handleLogout}
              className="inline-flex items-center rounded-md border border-transparent px-3 py-2 text-sm font-medium leading-4 text-zinc-500 transition hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 focus:outline-none"
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
