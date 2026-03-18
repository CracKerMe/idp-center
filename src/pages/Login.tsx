import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Shield } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

export default function Login({ setUser }: { setUser: (user: any) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [requireOtp, setRequireOtp] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState('');
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [githubEnabled, setGithubEnabled] = useState<boolean | null>(null);
  const navigate = useNavigate();
  const searchParams: any = useSearch({ strict: false });

  // Read error from URL params (e.g. /login?error=...)
  useEffect(() => {
    if (searchParams.error) {
      setError(searchParams.error);
    }
  }, [searchParams.error]);

  // Check if GitHub OAuth is enabled
  useEffect(() => {
    fetch('/api/auth/github/config')
      .then(res => res.json())
      .then(data => setGithubEnabled(data.enabled))
      .catch(() => setGithubEnabled(false));
  }, []);

  const handleResendVerification = async () => {
    setResendStatus('sending');
    try {
      await fetch('/api/auth/email/resend-public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      setResendStatus('sent');
    } catch {
      setResendStatus('idle');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, otp: otp || undefined, remember_me: rememberMe, trust_device: trustDevice })
    });
    
    const { data, code, message } = await res.json();

    if (code === 0) {
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      if (data.session_id) {
        localStorage.setItem('session_id', data.session_id);
      }
      setUser(data.user);
      const redirect = searchParams.redirect;
      if (redirect && typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')) {
        // Hash mode: navigate using hash
        window.location.href = '/#' + redirect;
      } else {
        navigate({ to: '/' });
      }
    } else {
      if (data.requireOtp) {
        setRequireOtp(true);
      } else {
        // Map backend error codes to user-friendly messages
        const errorMessages: Record<string, string> = {
          'EMAIL_NOT_VERIFIED': 'Your email has not been verified. Please check your inbox for a verification link.',
          'ACCOUNT_PENDING_DELETION': 'This account is scheduled for deletion. Please contact support to cancel.',
          'ACCOUNT_LOCKED': data.unlock_at
            ? `Account is temporarily locked. Try again after ${new Date(data.unlock_at).toLocaleTimeString()}.`
            : 'Account is temporarily locked due to too many failed attempts.',
          'ACCOUNT_DISABLED': 'This account has been disabled. Please contact an administrator.',
        };
        if (data.error === 'EMAIL_NOT_VERIFIED') {
          setEmailNotVerified(true);
          setResendStatus('idle');
        } else {
          setEmailNotVerified(false);
        }
        setError(errorMessages[data.error] || data.error || 'Login failed');
      }
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <Shield className="h-12 w-12 text-indigo-600" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-zinc-900">
          Sign in to your account
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <AnimatePresence initial={false}>
              {error && (
                <motion.div
                  key={error}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="text-sm text-center"
                  data-testid="error-message"
                >
                  <p className="text-red-600">{error}</p>
                  {emailNotVerified && (
                    <div className="mt-2">
                      {resendStatus === 'sent' ? (
                        <p className="text-green-600">Verification email sent. Please check your inbox.</p>
                      ) : (
                        <button
                          type="button"
                          disabled={resendStatus === 'sending'}
                          onClick={handleResendVerification}
                          className="text-indigo-600 hover:text-indigo-500 font-medium disabled:opacity-50"
                        >
                          {resendStatus === 'sending' ? 'Sending...' : 'Resend verification email'}
                        </button>
                      )}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
            
            <div>
              <label className="block text-sm font-medium text-zinc-700">Username</label>
              <div className="mt-1">
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-zinc-300 rounded-md shadow-sm placeholder-zinc-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-zinc-700">Password</label>
                <div className="text-sm">
                  <Link to="/forgot-password" className="font-medium text-indigo-600 hover:text-indigo-500">
                    Forgot your password?
                  </Link>
                </div>
              </div>
              <div className="mt-1">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-zinc-300 rounded-md shadow-sm placeholder-zinc-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
            </div>

            <AnimatePresence initial={false}>
              {requireOtp && (
                <motion.div
                  initial={{ opacity: 0, height: 0, y: -8 }}
                  animate={{ opacity: 1, height: 'auto', y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -8 }}
                  transition={{ duration: 0.24, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div>
                    <label className="block text-sm font-medium text-zinc-700">Authenticator Code (OTP)</label>
                    <div className="mt-1">
                      <input
                        type="text"
                        required
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                        className="appearance-none block w-full px-3 py-2 border border-zinc-300 rounded-md shadow-sm placeholder-zinc-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 text-indigo-600 border-zinc-300 rounded focus:ring-indigo-500"
                />
                Remember me
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={trustDevice}
                  onChange={(e) => setTrustDevice(e.target.checked)}
                  className="h-4 w-4 text-indigo-600 border-zinc-300 rounded focus:ring-indigo-500"
                />
                Trust this device
              </label>
            </div>

            <div>
              <button
                type="submit"
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Sign in
              </button>
            </div>
          </form>

          {githubEnabled && (
            <div className="mt-6">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-zinc-300" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white text-zinc-500">Or continue with</span>
                </div>
              </div>

              <div className="mt-4">
                <a
                  href="/api/auth/github"
                  data-testid="github-login-button"
                  className="w-full flex justify-center items-center gap-2 py-2 px-4 border border-zinc-300 rounded-md shadow-sm text-sm font-medium text-zinc-700 bg-white hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                  </svg>
                  Sign in with GitHub
                </a>
              </div>
            </div>
          )}

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-zinc-500">Or</span>
              </div>
            </div>

            <div className="mt-6 text-center">
              <Link to="/register" className="font-medium text-indigo-600 hover:text-indigo-500">
                Create a new account
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
