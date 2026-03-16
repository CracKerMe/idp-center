import { useState, useEffect } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { Shield, CheckCircle, XCircle, Loader2 } from 'lucide-react';

export default function VerifyEmail() {
  const { token } = useSearch({ strict: false }) as { token?: string };
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setError('No verification token provided');
      setStatus('error');
      return;
    }

    fetch('/api/auth/email/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        if (res.ok) {
          setStatus('success');
        } else {
          const data = await res.json();
          if (data.error === 'TOKEN_ALREADY_USED') {
            setError('This verification link has already been used.');
          } else if (data.error === 'TOKEN_EXPIRED_OR_INVALID') {
            setError('This verification link has expired or is invalid.');
          } else {
            setError(data.error || 'Verification failed');
          }
          setStatus('error');
        }
      })
      .catch(() => {
        setError('Network error, please try again later.');
        setStatus('error');
      });
  }, [token]);

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <Shield className="h-12 w-12 text-indigo-600" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-zinc-900">
          {status === 'verifying' && 'Verifying your email...'}
          {status === 'success' && 'Email verified'}
          {status === 'error' && 'Verification failed'}
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {status === 'verifying' && (
            <div className="text-center">
              <Loader2 className="mx-auto h-12 w-12 text-indigo-500 animate-spin mb-4" />
              <p className="text-sm text-zinc-500">Please wait while we verify your email...</p>
            </div>
          )}

          {status === 'success' && (
            <div className="text-center">
              <CheckCircle className="mx-auto h-12 w-12 text-green-500 mb-4" />
              <p className="mt-2 text-sm text-zinc-500">Your email has been verified successfully.</p>
              <div className="mt-6">
                <Link to="/login" className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">
                  Go to login
                </Link>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="text-center">
              <XCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
              <p className="text-sm text-red-600 mb-4">{error}</p>
              <Link to="/login" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
                Go to login
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
