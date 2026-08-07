import { useState, useEffect } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { Shield } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { parseApiResponse, isSuccess, getErrorMessage } from '../utils/fetch';
import type { AuthUser, MfaFactorOption } from '../types/user';
import { GithubOAuthButton } from '../components/GithubOAuthButton';
import { EmailVerificationResend } from '../components/EmailVerificationResend';
import { DeviceTrustOptions } from '../components/DeviceTrustOptions';
import { MfaChallenge } from '../components/MfaChallenge';
import { SsoProviderButtons } from '../components/SsoProviderButtons';
import { SliderCaptcha } from '../components/SliderCaptcha';
import { hardNavigate, isSafeRedirect, setPendingRedirect } from '../utils/post-login-redirect';

export default function Login({ setUser }: { setUser: (user: AuthUser | null) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaFactors, setMfaFactors] = useState<MfaFactorOption[]>([]);
  const [rememberMe, setRememberMe] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState('');
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const searchParams: Record<string, unknown> = useSearch({ strict: false });
  const redirect = typeof searchParams.redirect === 'string' ? searchParams.redirect : undefined;

  useEffect(() => {
    if (typeof searchParams.error === 'string') {
      setError(searchParams.error);
    }
  }, [searchParams.error]);

  function finishLogin(data: { access_token: string; refresh_token: string; session_id?: string; user?: AuthUser; mfa_enrollment_required?: boolean }) {
    localStorage.setItem('token', data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    if (data.session_id) localStorage.setItem('session_id', data.session_id);
    if (data.user?.tenant_id) localStorage.setItem('tenant_id', data.user.tenant_id);
    setUser(data.user ?? null);

    // Every branch below leaves via hardNavigate(): setUser() above has only *scheduled* a
    // re-render, so a router transition here would still be evaluated against a null user.
    if (data.mfa_enrollment_required) {
      // Park the pending target (typically an OAuth /authorize request) so enrolling a
      // factor resumes it instead of stranding the user on the profile page.
      setPendingRedirect(redirect);
      hardNavigate('/profile?setup_mfa=1');
      return;
    }
    hardNavigate(isSafeRedirect(redirect) ? redirect : '/');
  }

  const doLogin = async (overrideCaptchaPass?: string) => {
    setError('');

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password,
        remember_me: rememberMe,
        trust_device: trustDevice,
        captcha_pass: overrideCaptchaPass,
      }),
    });

    const result = await parseApiResponse<{
      access_token?: string;
      refresh_token?: string;
      session_id?: string;
      user?: AuthUser;
      mfa_token?: string;
      factors?: MfaFactorOption[];
      unlock_at?: string;
      must_change_password?: boolean;
      mfa_enrollment_required?: boolean;
    }>(res);
    const { data, code, error: apiError } = result;

    if (code === 0) {
      setCaptchaRequired(false);
      finishLogin(data as any);
    } else if (code === 'AUTH_MFA_REQUIRED' && data?.mfa_token && data?.factors) {
      setCaptchaRequired(false);
      setMfaToken(data.mfa_token);
      setMfaFactors(data.factors);
    } else if (code === 'PASSWORD_EXPIRED' && data?.must_change_password) {
      setCaptchaRequired(false);
      setMustChangePassword(true);
      setError('');
    } else if (code === 'CAPTCHA_REQUIRED') {
      setCaptchaRequired(true);
    } else {
      const errorMessages: Record<string, string> = {
        ACCOUNT_NOT_VERIFIED: 'Your email has not been verified. Please check your inbox for a verification link.',
        ACCOUNT_PENDING_DELETION: 'This account is scheduled for deletion. Please contact support to cancel.',
        ACCOUNT_LOCKED: data?.unlock_at
          ? `Account is temporarily locked. Try again after ${new Date(data.unlock_at).toLocaleTimeString()}.`
          : 'Account is temporarily locked due to too many failed attempts.',
        ACCOUNT_DISABLED: 'This account has been disabled. Please contact an administrator.',
      };
      setEmailNotVerified(code === 'ACCOUNT_NOT_VERIFIED');
      setError(errorMessages[code as string] || apiError || 'Login failed');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await doLogin();
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    const res = await fetch('/api/auth/password/change-expired', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        current_password: password,
        new_password: newPassword,
      }),
    });

    const result = await parseApiResponse<{ message?: string }>(res);
    if (result.code === 0) {
      setError('');
      setMustChangePassword(false);
      // Auto-login with new password
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: newPassword, remember_me: rememberMe }),
      });
      const loginResult = await parseApiResponse<{
        access_token?: string;
        refresh_token?: string;
        session_id?: string;
        user?: AuthUser;
        mfa_enrollment_required?: boolean;
      }>(loginRes);
      if (loginResult.code === 0 && loginResult.data) {
        // Same completion path as a normal sign-in, so this branch honours `redirect`
        // and the MFA-enrollment diversion too.
        finishLogin(loginResult.data as Parameters<typeof finishLogin>[0]);
      } else {
        setError(loginResult.error || 'Login failed after password change');
      }
    } else {
      setError(result.error || 'Password change failed');
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <Shield className="h-12 w-12 text-indigo-600 dark:text-indigo-400" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-zinc-900 dark:text-white">
          Sign in to your account
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-zinc-900 py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {mustChangePassword ? (
            <form className="space-y-6" onSubmit={handleChangePassword}>
              <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">
                  Change Your Password
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  You must change your password before continuing.
                </p>
              </div>

              <AnimatePresence initial={false}>
                {error && (
                  <motion.div
                    key={error}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="text-sm text-center"
                  >
                    <p className="text-red-600">{error}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">New Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="mt-1 appearance-none block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm placeholder-zinc-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Confirm Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-1 appearance-none block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm placeholder-zinc-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>

              <div>
                <button
                  type="submit"
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  Change Password
                </button>
              </div>
            </form>
          ) : mfaToken ? (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">
                  Verify it's you
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Complete the second step to finish signing in.
                </p>
              </div>

              <AnimatePresence initial={false}>
                {error && (
                  <motion.div
                    key={error}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="text-sm text-center"
                  >
                    <p className="text-red-600">{error}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <MfaChallenge
                mfaToken={mfaToken}
                factors={mfaFactors}
                onSuccess={(data) => finishLogin(data as any)}
                onError={(msg) => setError(msg)}
              />

              <div className="text-center">
                <button type="button" onClick={() => { setMfaToken(null); setMfaFactors([]); setError(''); }} className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400">
                  Back to login
                </button>
              </div>
            </div>
          ) : captchaRequired ? (
            <SliderCaptcha
              username={username}
              onSuccess={(pass) => {
                // The puzzle's job ends here — close it immediately rather than
                // leaving it mounted (still showing its "verified" state) while
                // the login attempt itself plays out, which may fail for an
                // unrelated reason (e.g. the password was also wrong).
                setCaptchaRequired(false);
                doLogin(pass);
              }}
              onCancel={() => setCaptchaRequired(false)}
            />
          ) : (
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
                      <EmailVerificationResend username={username} />
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Username</label>
              <div className="mt-1">
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm placeholder-zinc-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Password</label>
                <div className="text-sm">
                  <Link to="/forgot-password" className="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
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
                  className="appearance-none block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm placeholder-zinc-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
            </div>

            <DeviceTrustOptions
              rememberMe={rememberMe}
              onRememberMeChange={setRememberMe}
              trustDevice={trustDevice}
              onTrustDeviceChange={setTrustDevice}
            />

            <div>
              <button
                type="submit"
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Sign in
              </button>
            </div>
          </form>
          )}

          {!mustChangePassword && !mfaToken && !captchaRequired && <GithubOAuthButton redirect={redirect} />}
          {!mustChangePassword && !mfaToken && !captchaRequired && (
            <SsoProviderButtons
              redirect={redirect}
              onLdapSuccess={(data) => finishLogin(data as any)}
              onError={(msg) => setError(msg)}
            />
          )}

          {!mustChangePassword && !mfaToken && !captchaRequired && (
          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-300 dark:border-zinc-700" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400">Or</span>
              </div>
            </div>

            <div className="mt-6 text-center">
              <Link to="/register" className="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
                Create a new account
              </Link>
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
