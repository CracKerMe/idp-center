import { Link, Outlet, useNavigate, useLocation } from '@tanstack/react-router';
import { Shield, Users, Key, Activity, LogOut, ArrowLeft, Building, BarChart3 } from 'lucide-react';
import { clsx } from 'clsx';

export default function AdminLayout({ user, setUser }: { user: any, setUser: (user: any) => void }) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    navigate({ to: '/login' });
  };

  const navigation = [
    { name: 'Dashboard', href: '/admin/stats', icon: BarChart3 },
    { name: 'Users', href: '/admin/users', icon: Users },
    { name: 'Tenants', href: '/admin/tenants', icon: Building },
    { name: 'Clients', href: '/admin/clients', icon: Key },
    { name: 'Audit Logs', href: '/admin/audit', icon: Activity },
  ];

  return (
    <div className="min-h-screen bg-zinc-100 flex">
      {/* Sidebar */}
      <div className="w-64 bg-zinc-900 text-white flex flex-col">
        <div className="h-16 flex items-center px-6 bg-zinc-950 border-b border-zinc-800">
          <Shield className="h-8 w-8 text-indigo-500" />
          <span className="ml-3 text-lg font-semibold tracking-wide">Admin Panel</span>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-2">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.name}
                to={item.href}
                className={clsx(
                  isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white',
                  'group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors'
                )}
              >
                <item.icon
                  className={clsx(
                    isActive ? 'text-indigo-400' : 'text-zinc-500 group-hover:text-zinc-300',
                    'mr-3 flex-shrink-0 h-5 w-5'
                  )}
                  aria-hidden="true"
                />
                {item.name}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-zinc-800">
          <Link
            to="/"
            className="group flex items-center px-3 py-2 text-sm font-medium rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <ArrowLeft className="mr-3 flex-shrink-0 h-5 w-5 text-zinc-500 group-hover:text-zinc-300" />
            Back to App
          </Link>
          <button
            onClick={handleLogout}
            className="mt-2 w-full group flex items-center px-3 py-2 text-sm font-medium rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <LogOut className="mr-3 flex-shrink-0 h-5 w-5 text-zinc-500 group-hover:text-zinc-300" />
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white shadow-sm z-10">
          <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
            <h1 className="text-2xl font-semibold text-zinc-900">
              {navigation.find(n => n.href === location.pathname)?.name || 'Dashboard'}
            </h1>
            <div className="flex items-center">
              <span className="text-sm text-zinc-500">Logged in as <span className="font-medium text-zinc-900">{user.username}</span></span>
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
