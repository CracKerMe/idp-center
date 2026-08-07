import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useLocation } from '@tanstack/react-router';
import { Shield, Users, Key, Activity, LogOut, ArrowLeft, Building, BarChart3, Menu, X, Link2, ShieldAlert } from 'lucide-react';
import { clsx } from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { authFetch } from '../utils/fetch';
import ThemeToggle from '../components/ThemeToggle';

export default function AdminLayout({ user, setUser }: { user: any, setUser: (user: any) => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!sidebarOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen]);

  useEffect(() => {
    if (!sidebarOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [sidebarOpen]);

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

  const navigation = [
    { name: 'Dashboard', href: '/admin/stats', icon: BarChart3 },
    { name: 'Users', href: '/admin/users', icon: Users },
    { name: 'Tenants', href: '/admin/tenants', icon: Building },
    { name: 'Clients', href: '/admin/clients', icon: Key },
    { name: 'Identity Providers', href: '/admin/identity-providers', icon: Link2 },
    { name: 'Risk Dashboard', href: '/admin/risk', icon: ShieldAlert },
    { name: 'Audit Logs', href: '/admin/audit', icon: Activity },
  ];

  const currentPath = location.pathname === '/admin' ? '/admin/stats' : location.pathname;
  const currentTitle = navigation.find((item) => item.href === currentPath)?.name || 'Dashboard';

  const renderNavigation = (onNavigate?: () => void) => (
    <>
      {navigation.map((item) => {
        const isActive = currentPath === item.href;
        return (
          <Link
            key={item.name}
            to={item.href}
            onClick={onNavigate}
            className={clsx(
              isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white',
              'group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors'
            )}
          >
            <item.icon
              className={clsx(
                isActive ? 'text-indigo-400' : 'text-zinc-500 group-hover:text-zinc-300',
                'mr-3 shrink-0 h-5 w-5'
              )}
              aria-hidden="true"
            />
            {item.name}
          </Link>
        );
      })}
    </>
  );

  const renderSidebarFooter = (onNavigate?: () => void) => (
    <div className="p-4 border-t border-zinc-800">
      <Link
        to="/"
        onClick={onNavigate}
        className="group flex items-center px-3 py-2 text-sm font-medium rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
      >
        <ArrowLeft className="mr-3 shrink-0 h-5 w-5 text-zinc-500 group-hover:text-zinc-300" />
        Back to App
      </Link>
      <button
        onClick={handleLogout}
        className="mt-2 w-full group flex items-center px-3 py-2 text-sm font-medium rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
      >
        <LogOut className="mr-3 shrink-0 h-5 w-5 text-zinc-500 group-hover:text-zinc-300" />
        Logout
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 flex">
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            className="fixed inset-0 z-40 md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute inset-0 bg-black/50"
              aria-label="Close sidebar"
            />
            <motion.div
              className="relative w-64 h-full bg-zinc-900 text-white flex flex-col"
              initial={{ x: -24, opacity: 0.9 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -24, opacity: 0.9 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              <div className="h-16 flex items-center justify-between px-4 bg-zinc-950 border-b border-zinc-800">
                <div className="flex items-center">
                  <Shield className="h-8 w-8 text-indigo-500" />
                  <span className="ml-3 text-lg font-semibold tracking-wide">Admin Panel</span>
                </div>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
                  aria-label="Close menu"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
                {renderNavigation(() => setSidebarOpen(false))}
              </nav>
              {renderSidebarFooter(() => setSidebarOpen(false))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="hidden md:flex md:w-64 bg-zinc-900 text-white md:flex-col sticky top-0 h-screen">
        <div className="h-16 flex items-center px-6 bg-zinc-950 border-b border-zinc-800">
          <Shield className="h-8 w-8 text-indigo-500" />
          <span className="ml-3 text-lg font-semibold tracking-wide">Admin Panel</span>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
          {renderNavigation()}
        </nav>
        {renderSidebarFooter()}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-zinc-900 shadow-sm z-10">
          <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="md:hidden rounded-md p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900 dark:text-white">
                {currentTitle}
              </h1>
            </div>
            <div className="flex items-center justify-end flex-wrap gap-2 sm:gap-3">
              <ThemeToggle showSystem={false} />
              <span className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Logged in as <span className="font-medium text-zinc-900 dark:text-white">{user.username}</span></span>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
