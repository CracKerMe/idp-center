import { useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { parseApiResponse } from '../utils/fetch';
import type { MfaFactorOption } from '../types/user';

const FACTOR_LABELS: Record<MfaFactorOption['type'], string> = {
  totp: 'Authenticator App',
  email: 'Email Code',
  sms: 'SMS Code',
  webauthn: 'Security Key',
  recovery: 'Recovery Code',
};

interface VerifyResult {
  access_token: string;
  refresh_token: string;
  session_id?: string;
  device_trusted?: boolean;
  mfa_enrollment_required?: boolean;
  user?: unknown;
}

export function MfaChallenge({
  mfaToken,
  factors,
  onSuccess,
  onError,
}: {
  mfaToken: string;
  factors: MfaFactorOption[];
  onSuccess: (data: VerifyResult) => void;
  onError: (message: string) => void;
}) {
  const [selectedFactorId, setSelectedFactorId] = useState<string | null>(factors[0]?.id ?? null);
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const selectedFactor = factors.find(f => f.id === selectedFactorId);

  async function verify(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfa_token: mfaToken, ...body }),
      });
      const result = await parseApiResponse<VerifyResult>(res);
      if (result.code === 0 && result.data) {
        onSuccess(result.data);
      } else {
        onError(result.error || 'MFA verification failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSendCode() {
    if (!selectedFactor) return;
    setBusy(true);
    try {
      const res = await fetch('/api/auth/mfa/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfa_token: mfaToken, factor_id: selectedFactor.id }),
      });
      const result = await parseApiResponse<{ options?: unknown }>(res);
      if (result.code !== 0) {
        onError(result.error || 'Failed to send code');
        return;
      }
      setCodeSent(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleWebauthn() {
    if (!selectedFactor) return;
    setBusy(true);
    try {
      const res = await fetch('/api/auth/mfa/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfa_token: mfaToken, factor_id: selectedFactor.id }),
      });
      const result = await parseApiResponse<{ options: any }>(res);
      if (result.code !== 0 || !result.data) {
        onError(result.error || 'Failed to start security key challenge');
        return;
      }
      const assertion = await startAuthentication({ optionsJSON: result.data.options });
      await verify({ factor_id: selectedFactor.id, response: assertion });
    } catch (err: any) {
      onError(err?.message || 'Security key verification failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    if (useRecovery) {
      await verify({ code });
      return;
    }
    if (!selectedFactor) return;
    await verify({ factor_id: selectedFactor.id, code });
  }

  if (useRecovery) {
    return (
      <form onSubmit={handleSubmitCode} className="space-y-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Enter one of your unused recovery codes.</p>
        <input
          type="text"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="appearance-none block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm sm:text-sm"
          placeholder="Recovery code"
        />
        <div className="flex justify-between items-center">
          <button type="button" onClick={() => setUseRecovery(false)} className="text-sm text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
            Back
          </button>
          <button type="submit" disabled={busy} className="py-2 px-4 rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
            Verify
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      {factors.length > 1 && (
        <div className="space-y-2">
          {factors.map(f => (
            <label key={f.id} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="radio"
                name="mfa-factor"
                checked={selectedFactorId === f.id}
                onChange={() => { setSelectedFactorId(f.id); setCodeSent(false); setCode(''); }}
              />
              {f.name || FACTOR_LABELS[f.type]}
            </label>
          ))}
        </div>
      )}

      {selectedFactor?.type === 'totp' && (
        <form onSubmit={handleSubmitCode} className="space-y-4">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="appearance-none block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm sm:text-sm"
            placeholder="6-digit code"
          />
          <button type="submit" disabled={busy} className="w-full py-2 px-4 rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
            Verify
          </button>
        </form>
      )}

      {(selectedFactor?.type === 'email' || selectedFactor?.type === 'sms') && (
        codeSent ? (
          <form onSubmit={handleSubmitCode} className="space-y-4">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="appearance-none block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm sm:text-sm"
              placeholder="6-digit code"
            />
            <button type="submit" disabled={busy} className="w-full py-2 px-4 rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
              Verify
            </button>
          </form>
        ) : (
          <button onClick={handleSendCode} disabled={busy} className="w-full py-2 px-4 rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
            Send code
          </button>
        )
      )}

      {selectedFactor?.type === 'webauthn' && (
        <button onClick={handleWebauthn} disabled={busy} className="w-full py-2 px-4 rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
          Use security key
        </button>
      )}

      <div className="text-center">
        <button type="button" onClick={() => setUseRecovery(true)} className="text-sm text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
          Use a recovery code instead
        </button>
      </div>
    </div>
  );
}
