import { Link } from '@tanstack/react-router';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import AppHeader from '../components/AppHeader';

export default function Dashboard({ user, setUser }: { user: any, setUser: (user: any) => void }) {
  return (
    <div className="min-h-screen bg-zinc-50">
      <AppHeader user={user} setUser={setUser} />

      <main className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <div className="px-4 py-5 sm:px-6">
            <h3 className="text-lg leading-6 font-medium text-zinc-900">Account Security</h3>
            <p className="mt-1 max-w-2xl text-sm text-zinc-500">Manage your security settings and two-factor authentication.</p>
          </div>
          <div className="border-t border-zinc-200 px-4 py-5 sm:p-0">
            <dl className="sm:divide-y sm:divide-zinc-200">
              <div className="py-4 sm:py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-zinc-500 flex items-center">
                  Two-Factor Authentication (2FA)
                </dt>
                <dd className="mt-1 text-sm text-zinc-900 sm:mt-0 sm:col-span-2 flex items-center justify-between">
                  <div className="flex items-center">
                    {user.otp_enabled ? (
                      <>
                        <ShieldCheck className="h-5 w-5 text-green-500 mr-2" />
                        <span className="text-green-700 font-medium">Enabled</span>
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="h-5 w-5 text-amber-500 mr-2" />
                        <span className="text-amber-700 font-medium">Disabled</span>
                      </>
                    )}
                  </div>
                  {!user.otp_enabled && (
                    <Link
                      to="/setup-otp"
                      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                    >
                      Enable 2FA
                    </Link>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </main>
    </div>
  );
}
