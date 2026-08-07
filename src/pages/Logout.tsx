import { useState, useEffect } from 'react';
import { useSearch, useNavigate } from '@tanstack/react-router';
import { LogOut, CheckCircle, Loader2 } from 'lucide-react';
import { authFetch, parseApiResponse, isSuccess, getErrorMessage } from '../utils/fetch';

interface LogoutResponse {
  front_channel_logout_uris?: string[];
  post_logout_redirect_uri?: string;
}

export default function Logout() {
  const searchParams: any = useSearch({ strict: false });
  const navigate = useNavigate();

  const [step, setStep] = useState<'confirm' | 'processing' | 'done'>('confirm');
  const [error, setError] = useState('');
  const [redirectTarget, setRedirectTarget] = useState<string | null>(null);

  // Extract params from hash query (?sid=...&client_id=...&post_logout_redirect_uri=...&state=...)
  const sid = searchParams.sid as string | undefined;
  const clientId = searchParams.client_id as string | undefined;
  const postLogoutRedirectUri = searchParams.post_logout_redirect_uri as string | undefined;
  const state = searchParams.state as string | undefined;

  const handleConfirm = async () => {
    setStep('processing');
    setError('');

    try {
      const res = await authFetch('/api/oidc/end_session/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_logout_redirect_uri: postLogoutRedirectUri }),
      });

      const result = await parseApiResponse<LogoutResponse>(res);

      if (!isSuccess(result)) {
        setError(getErrorMessage(result) || 'Logout failed');
        setStep('confirm');
        return;
      }

      const data = result.data || {};
      const frontChannelUris = data.front_channel_logout_uris || [];
      const finalRedirect = data.post_logout_redirect_uri || postLogoutRedirectUri || null;

      // Clear local auth state
      localStorage.removeItem('token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('session_id');

      if (frontChannelUris.length > 0) {
        // Render hidden iframes for each RP's front-channel logout and wait up to 2s each
        await Promise.allSettled(
          frontChannelUris.map((uri) =>
            Promise.race([
              new Promise<void>((resolve) => {
                const iframe = document.createElement('iframe');
                iframe.style.display = 'none';
                iframe.src = uri;
                iframe.onload = () => resolve();
                iframe.onerror = () => resolve();
                document.body.appendChild(iframe);
              }),
              new Promise<void>((resolve) => setTimeout(resolve, 2000)),
            ])
          )
        );
      }

      // Build final redirect URL, appending state if present
      if (finalRedirect) {
        const url = new URL(finalRedirect);
        if (state) url.searchParams.set('state', state);
        setRedirectTarget(url.toString());
      }

      setStep('done');
    } catch {
      // Even on failure, clear local tokens — the user explicitly asked to log out
      localStorage.removeItem('token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('session_id');
      setStep('done');
    }
  };

  // Auto-redirect after a short delay so the user sees the confirmation
  useEffect(() => {
    if (step === 'done' && redirectTarget) {
      const timer = setTimeout(() => {
        window.location.replace(redirectTarget);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [step, redirectTarget]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <LogOut className="h-12 w-12 text-indigo-600 dark:text-indigo-400" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-zinc-900 dark:text-white">
          {step === 'confirm' ? 'Sign Out' : step === 'processing' ? 'Signing out...' : 'Signed Out'}
        </h2>
        {clientId && step === 'confirm' && (
          <p className="mt-2 text-center text-sm text-zinc-600 dark:text-zinc-400">
            The application <strong>{clientId}</strong> is requesting to end your session.
          </p>
        )}
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-zinc-900 py-8 px-4 shadow sm:rounded-lg sm:px-10">

          {step === 'confirm' && (
            <div className="space-y-6">
              <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
                Are you sure you want to sign out? This will end your session across all connected applications.
              </p>
              {error && <p className="text-sm text-red-600 dark:text-red-400 text-center">{error}</p>}
              <div className="flex gap-3">
                <button
                  onClick={() => navigate({ to: '/' })}
                  className="flex-1 py-2 px-4 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-sm text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  className="flex-1 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}

          {step === 'processing' && (
            <div className="text-center space-y-4">
              <Loader2 className="mx-auto h-10 w-10 text-indigo-500 animate-spin" />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Ending your session and notifying connected applications...
              </p>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center space-y-4">
              <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
              <h3 className="text-lg font-medium text-zinc-900 dark:text-white">
                You have been signed out
              </h3>
              {redirectTarget ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Redirecting you shortly...
                </p>
              ) : (
                <button
                  onClick={() => navigate({ to: '/login' })}
                  className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  Return to sign in
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
