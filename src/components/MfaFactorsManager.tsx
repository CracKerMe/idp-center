import { useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { CheckCircle, KeyRound, Mail, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { authFetch, parseApiResponse, isSuccess, getErrorMessage } from '../utils/fetch';

interface Factor {
  id: string;
  type: 'totp' | 'sms' | 'email' | 'webauthn' | 'recovery';
  name: string | null;
  status: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}

const FACTOR_ICON: Record<Factor['type'], React.ReactNode> = {
  totp: <ShieldCheck className="h-5 w-5 text-indigo-500" />,
  email: <Mail className="h-5 w-5 text-indigo-500" />,
  sms: <Smartphone className="h-5 w-5 text-indigo-500" />,
  webauthn: <KeyRound className="h-5 w-5 text-indigo-500" />,
  recovery: <ShieldCheck className="h-5 w-5 text-indigo-500" />,
};

export function MfaFactorsManager({ userEmail }: { userEmail: string }) {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [recoveryRemaining, setRecoveryRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Email setup
  const [emailStep, setEmailStep] = useState<'idle' | 'code'>('idle');
  const [emailFactorId, setEmailFactorId] = useState<string | null>(null);
  const [emailCode, setEmailCode] = useState('');

  // Recovery codes modal
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  // Disable modal
  const [disableFactorId, setDisableFactorId] = useState<string | null>(null);
  const [disablePassword, setDisablePassword] = useState('');

  async function refresh() {
    setLoading(true);
    try {
      const res = await authFetch('/api/user/mfa/factors');
      const result = await parseApiResponse<{ factors: Factor[]; recovery_codes_remaining: number }>(res);
      if (isSuccess(result) && result.data) {
        setFactors(result.data.factors);
        setRecoveryRemaining(result.data.recovery_codes_remaining);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleAddTotp() {
    setError(''); setMessage('');
    const res = await authFetch('/api/user/mfa/totp/setup', { method: 'POST' });
    const result = await parseApiResponse<{ factorId: string; secret: string; qrCodeUrl: string }>(res);
    if (!isSuccess(result) || !result.data) { setError(getErrorMessage(result)); return; }

    const token = window.prompt(
      `Scan this secret in your authenticator app, then enter the 6-digit code:\n\n${result.data.secret}`
    );
    if (!token) return;

    const verifyRes = await authFetch('/api/user/mfa/totp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factorId: result.data.factorId, token }),
    });
    const verifyResult = await parseApiResponse(verifyRes);
    if (isSuccess(verifyResult)) { setMessage('Authenticator app enabled'); refresh(); }
    else setError(getErrorMessage(verifyResult));
  }

  async function handleStartEmail() {
    setError(''); setMessage('');
    const res = await authFetch('/api/user/mfa/email/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userEmail }),
    });
    const result = await parseApiResponse<{ factorId: string }>(res);
    if (!isSuccess(result) || !result.data) { setError(getErrorMessage(result)); return; }
    setEmailFactorId(result.data.factorId);
    setEmailStep('code');
  }

  async function handleConfirmEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!emailFactorId) return;
    const res = await authFetch('/api/user/mfa/email/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factorId: emailFactorId, code: emailCode }),
    });
    const result = await parseApiResponse(res);
    if (isSuccess(result)) {
      setMessage('Email verification enabled');
      setEmailStep('idle'); setEmailCode(''); setEmailFactorId(null);
      refresh();
    } else {
      setError(getErrorMessage(result));
    }
  }

  async function handleAddWebauthn() {
    setError(''); setMessage('');
    const res = await authFetch('/api/user/mfa/webauthn/register/options', { method: 'POST' });
    const result = await parseApiResponse<{ factorId: string; options: any }>(res);
    if (!isSuccess(result) || !result.data) { setError(getErrorMessage(result)); return; }

    try {
      const attestation = await startRegistration({ optionsJSON: result.data.options });
      const verifyRes = await authFetch('/api/user/mfa/webauthn/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factorId: result.data.factorId, response: attestation }),
      });
      const verifyResult = await parseApiResponse(verifyRes);
      if (isSuccess(verifyResult)) { setMessage('Security key registered'); refresh(); }
      else setError(getErrorMessage(verifyResult));
    } catch (err: any) {
      setError(err?.message || 'Security key registration failed');
    }
  }

  async function handleGenerateRecoveryCodes() {
    setError(''); setMessage('');
    const res = await authFetch('/api/user/mfa/recovery/generate', { method: 'POST' });
    const result = await parseApiResponse<{ codes: string[] }>(res);
    if (isSuccess(result) && result.data) setRecoveryCodes(result.data.codes);
    else setError(getErrorMessage(result));
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    if (!disableFactorId) return;
    const res = await authFetch(`/api/user/mfa/factors/${disableFactorId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: disablePassword }),
    });
    const result = await parseApiResponse(res);
    if (isSuccess(result)) {
      setMessage('MFA factor disabled');
      setDisableFactorId(null); setDisablePassword('');
      refresh();
    } else {
      setError(getErrorMessage(result));
    }
  }

  const nonRecoveryFactors = factors.filter(f => f.type !== 'recovery');

  return (
    <div className="bg-white dark:bg-zinc-900 shadow rounded-lg p-6 space-y-4">
      <h3 className="text-lg font-medium text-zinc-900 dark:text-white">Multi-Factor Authentication</h3>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-green-600">{message}</p>}

      {!loading && (
        <div className="space-y-2">
          {nonRecoveryFactors.length === 0 && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No MFA factors configured yet.</p>
          )}
          {nonRecoveryFactors.map(f => (
            <div key={f.id} className="flex items-center justify-between p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
              <div className="flex items-center gap-3">
                {FACTOR_ICON[f.type]}
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-white">{f.name || f.type}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-green-500" /> Active
                  </p>
                </div>
              </div>
              <button onClick={() => setDisableFactorId(f.id)} className="text-red-600 hover:text-red-500">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        <button onClick={handleAddTotp} className="text-sm py-1.5 px-3 rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
          Add authenticator app
        </button>
        {emailStep === 'idle' ? (
          <button onClick={handleStartEmail} className="text-sm py-1.5 px-3 rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
            Add email code
          </button>
        ) : null}
        <button onClick={handleAddWebauthn} className="text-sm py-1.5 px-3 rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
          Add security key
        </button>
        <button onClick={handleGenerateRecoveryCodes} className="text-sm py-1.5 px-3 rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
          {recoveryRemaining > 0 ? `Regenerate recovery codes (${recoveryRemaining} left)` : 'Generate recovery codes'}
        </button>
      </div>

      {emailStep === 'code' && (
        <form onSubmit={handleConfirmEmail} className="flex items-center gap-2 pt-2">
          <input
            type="text"
            inputMode="numeric"
            required
            value={emailCode}
            onChange={(e) => setEmailCode(e.target.value)}
            placeholder="6-digit code sent to your email"
            className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm sm:text-sm"
          />
          <button type="submit" className="py-2 px-4 rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">
            Verify
          </button>
        </form>
      )}

      {recoveryCodes && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 max-w-md w-full space-y-4">
            <h4 className="text-lg font-medium text-zinc-900 dark:text-white">Save your recovery codes</h4>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Each code can be used once if you lose access to your other MFA methods. Store them somewhere safe — they will not be shown again.
            </p>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-zinc-100 dark:bg-zinc-800 rounded-md p-3">
              {recoveryCodes.map((c) => <span key={c}>{c}</span>)}
            </div>
            <button
              onClick={() => { setRecoveryCodes(null); refresh(); }}
              className="w-full py-2 px-4 rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
            >
              I've saved these codes
            </button>
          </div>
        </div>
      )}

      {disableFactorId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleDisable} className="bg-white dark:bg-zinc-900 rounded-lg p-6 max-w-sm w-full space-y-4">
            <h4 className="text-lg font-medium text-zinc-900 dark:text-white">Confirm your password</h4>
            <input
              type="password"
              required
              autoFocus
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm sm:text-sm"
              placeholder="Password"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setDisableFactorId(null); setDisablePassword(''); }} className="py-2 px-4 rounded-md text-sm text-zinc-700 dark:text-zinc-300">
                Cancel
              </button>
              <button type="submit" className="py-2 px-4 rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700">
                Disable
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
