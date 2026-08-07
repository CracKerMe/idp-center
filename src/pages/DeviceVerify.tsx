import { useState, useEffect } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Smartphone, CheckCircle, XCircle, Shield } from 'lucide-react';
import { authFetch, parseApiResponse, isSuccess, getErrorMessage } from '../utils/fetch';

export default function DeviceVerify({ user }: { user: any }) {
  const searchParams: any = useSearch({ strict: false });
  const navigate = useNavigate();
  const [userCode, setUserCode] = useState(searchParams.user_code || '');
  const [clientName, setClientName] = useState('');
  const [scope, setScope] = useState('');
  const [step, setStep] = useState<'input' | 'confirm' | 'approved' | 'denied' | 'error'>('input');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // If user_code is provided in the URL, auto-verify on mount
  useEffect(() => {
    if (searchParams.user_code) {
      handleVerify(searchParams.user_code);
    }
  }, []);

  const handleVerify = async (code?: string) => {
    const codeToVerify = code || userCode;
    if (!codeToVerify.trim()) {
      setError('Please enter a device code');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const res = await authFetch(`/api/oidc/device/verify?user_code=${encodeURIComponent(codeToVerify.trim())}`);
      const result = await parseApiResponse<{ client_name: string; scope: string }>(res);

      if (isSuccess(result) && result.data) {
        setClientName(result.data.client_name);
        setScope(result.data.scope || 'openid');
        setStep('confirm');
      } else {
        setError(getErrorMessage(result) || 'Invalid or expired device code');
        setStep('error');
      }
    } catch {
      setError('Network error');
      setStep('error');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch('/api/oidc/device/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_code: userCode.trim() }),
      });
      const result = await parseApiResponse(res);
      if (isSuccess(result)) {
        setStep('approved');
      } else {
        setError(getErrorMessage(result));
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeny = async () => {
    setLoading(true);
    try {
      await authFetch('/api/oidc/device/deny', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_code: userCode.trim() }),
      });
      setStep('denied');
    } catch {
      // Ignore errors on deny
      setStep('denied');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <Smartphone className="h-12 w-12 text-indigo-600 dark:text-indigo-400" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-zinc-900 dark:text-white">
          Device Authorization
        </h2>
        <p className="mt-2 text-center text-sm text-zinc-600 dark:text-zinc-400">
          Sign in to your account on a TV, console, or other device
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-zinc-900 py-8 px-4 shadow sm:rounded-lg sm:px-10">

          {step === 'input' && (
            <div className="space-y-6">
              <div>
                <label htmlFor="user-code" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Enter the code shown on your device
                </label>
                <input
                  id="user-code"
                  type="text"
                  value={userCode}
                  onChange={(e) => setUserCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
                  placeholder="BCDF-GHJK"
                  className="mt-1 block w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-center text-lg tracking-widest font-mono text-zinc-900 dark:text-white shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                  maxLength={9}
                  disabled={loading}
                />
              </div>
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <button
                onClick={() => handleVerify()}
                disabled={loading || !userCode.trim()}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Verifying...' : 'Verify Code'}
              </button>
            </div>
          )}

          {step === 'confirm' && (
            <div className="space-y-6">
              <div className="text-center">
                <Shield className="mx-auto h-10 w-10 text-indigo-500" />
                <h3 className="mt-4 text-lg font-medium text-zinc-900 dark:text-white">
                  Authorize this device?
                </h3>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  <strong className="text-zinc-900 dark:text-white">{clientName}</strong> is requesting
                  access to your account with scope: <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">{scope}</code>
                </p>
              </div>
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <div className="flex gap-3">
                <button
                  onClick={handleDeny}
                  disabled={loading}
                  className="flex-1 py-2 px-4 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-sm text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50"
                >
                  Deny
                </button>
                <button
                  onClick={handleApprove}
                  disabled={loading}
                  className="flex-1 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                >
                  {loading ? 'Approving...' : 'Approve'}
                </button>
              </div>
            </div>
          )}

          {step === 'approved' && (
            <div className="text-center space-y-4">
              <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
              <h3 className="text-lg font-medium text-zinc-900 dark:text-white">Device Authorized</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                You can close this page and return to your device.
              </p>
            </div>
          )}

          {step === 'denied' && (
            <div className="text-center space-y-4">
              <XCircle className="mx-auto h-12 w-12 text-red-500" />
              <h3 className="text-lg font-medium text-zinc-900 dark:text-white">Authorization Denied</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                The device will not be granted access.
              </p>
              <button
                onClick={() => { setStep('input'); setError(''); }}
                className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Try a different code
              </button>
            </div>
          )}

          {step === 'error' && (
            <div className="text-center space-y-4">
              <XCircle className="mx-auto h-12 w-12 text-red-500" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              <button
                onClick={() => { setStep('input'); setError(''); setUserCode(''); }}
                className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
