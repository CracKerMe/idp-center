import React, { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Shield, ArrowLeft, CheckCircle, Mail } from 'lucide-react';

export default function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/password/reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      if (res.ok) {
        setSent(true);
      } else {
        const json = await res.json();
        setError(json.error || 'Failed to request password reset');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <Shield className="h-12 w-12 text-indigo-600 dark:text-indigo-400" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-zinc-900 dark:text-white">
          {sent ? 'Check your email' : 'Reset your password'}
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-zinc-900 py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {sent ? (
            <div className="text-center">
              <div className="flex justify-center mb-4">
                <div className="relative">
                  <Mail className="h-12 w-12 text-indigo-500" />
                  <CheckCircle className="h-5 w-5 text-green-500 absolute -bottom-1 -right-1 bg-white rounded-full" />
                </div>
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
                We've sent a password reset link to <strong>{email}</strong>.
              </p>
              <p className="text-sm text-zinc-500 dark:text-zinc-500 mb-6">
                Click the link in the email to set a new password. The link expires in 1 hour.
              </p>
              <button
                onClick={() => { setSent(false); setEmail(''); }}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
              >
                Send to a different email
              </button>
            </div>
          ) : (
            <form className="space-y-6" onSubmit={handleRequest}>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">
                  {error}
                </div>
              )}
              <p className="text-sm text-zinc-600 dark:text-zinc-400 text-center">
                Enter your email address and we'll send you a link to reset your password.
              </p>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email address</label>
                <div className="mt-1">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="appearance-none block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm placeholder-zinc-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  />
                </div>
              </div>
              <div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  {loading ? 'Sending...' : 'Send reset link'}
                </button>
              </div>
              <div className="mt-6 text-center">
                <Link to="/login" className="inline-flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
