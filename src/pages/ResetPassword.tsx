import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Shield, Eye, EyeOff, CheckCircle, XCircle, ArrowLeft } from 'lucide-react';

interface PasswordStrength {
  score: number;
  valid: boolean;
  errors: string[];
}

export default function ResetPassword() {
  const { token } = useSearch({ strict: false }) as { token?: string };
  const navigate = useNavigate();

  const [step, setStep] = useState<'verifying' | 'reset' | 'success' | 'error'>('verifying');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrength | null>(null);

  useEffect(() => {
    if (!token) {
      setError('No reset token provided');
      setStep('error');
      return;
    }
    // Auto-verify token on mount
    fetch('/api/auth/password/reset-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((res) => (res.ok ? setStep('reset') : res.json().then((d) => { throw new Error(d.error || 'Invalid token'); })))
      .catch((err) => { setError(err.message); setStep('error'); });
  }, [token]);

  const validatePassword = async (password: string) => {
    try {
      const res = await fetch('/api/auth/password/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      setPasswordStrength(await res.json());
    } catch {}
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }
    if (!passwordStrength?.valid) { setError('Password does not meet requirements'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: newPassword }),
      });
      if (res.ok) { setStep('success'); } else {
        const data = await res.json();
        setError(data.error || 'Failed to reset password');
      }
    } catch { setError('Network error'); } finally { setLoading(false); }
  };

  const getStrengthColor = () => {
    if (!passwordStrength) return 'bg-gray-200';
    switch (passwordStrength.score) {
      case 0: case 1: return 'bg-red-500';
      case 2: return 'bg-yellow-500';
      case 3: return 'bg-blue-500';
      case 4: return 'bg-green-500';
      default: return 'bg-gray-200';
    }
  };

  const getStrengthLabel = () => {
    if (!passwordStrength) return '';
    switch (passwordStrength.score) {
      case 0: case 1: return 'Weak';
      case 2: return 'Fair';
      case 3: return 'Good';
      case 4: return 'Strong';
      default: return '';
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <Shield className="h-12 w-12 text-indigo-600" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-zinc-900">
          {step === 'verifying' && 'Verifying token...'}
          {step === 'reset' && 'Set new password'}
          {step === 'success' && 'Password reset complete'}
          {step === 'error' && 'Reset failed'}
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {step === 'verifying' && (
            <p className="text-center text-sm text-zinc-500">Verifying your reset token...</p>
          )}

          {step === 'error' && (
            <div className="text-center">
              <XCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
              <p className="text-sm text-red-600 mb-4">{error}</p>
              <Link to="/forgot-password" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
                Request a new reset link
              </Link>
            </div>
          )}

          {step === 'success' && (
            <div className="text-center">
              <CheckCircle className="mx-auto h-12 w-12 text-green-500 mb-4" />
              <h3 className="text-lg font-medium text-zinc-900">Password reset successful</h3>
              <p className="mt-2 text-sm text-zinc-500">You can now sign in with your new password.</p>
              <div className="mt-6">
                <Link to="/login" className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">
                  Go to login
                </Link>
              </div>
            </div>
          )}

          {step === 'reset' && (
            <form className="space-y-6" onSubmit={handleReset}>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">{error}</div>
              )}

              <div>
                <label className="block text-sm font-medium text-zinc-700">New password</label>
                <div className="mt-1 relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); validatePassword(e.target.value); }}
                    className="appearance-none block w-full px-3 py-2 border border-zinc-300 rounded-md shadow-sm placeholder-zinc-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center">
                    {showPassword ? <EyeOff className="h-4 w-4 text-zinc-400" /> : <Eye className="h-4 w-4 text-zinc-400" />}
                  </button>
                </div>
                {passwordStrength && (
                  <div className="mt-2">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                        <div className={`h-full ${getStrengthColor()} transition-all`} style={{ width: `${passwordStrength.score * 25}%` }} />
                      </div>
                      <span className="text-xs text-zinc-500">{getStrengthLabel()}</span>
                    </div>
                    {passwordStrength.errors?.map((err, i) => (
                      <div key={i} className="flex items-center gap-1 text-xs text-red-500">
                        <XCircle className="h-3 w-3" /> {err}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700">Confirm password</label>
                <div className="mt-1">
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="appearance-none block w-full px-3 py-2 border border-zinc-300 rounded-md shadow-sm placeholder-zinc-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  />
                </div>
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="mt-1 text-xs text-red-500">Passwords do not match</p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {loading ? 'Processing...' : 'Reset password'}
              </button>

              <div className="mt-6 text-center">
                <Link to="/login" className="inline-flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-500">
                  <ArrowLeft className="h-4 w-4 mr-1" /> Back to sign in
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
