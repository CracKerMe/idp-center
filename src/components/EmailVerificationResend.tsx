import { useState } from 'react';
import { parseApiResponse, isSuccess } from '../utils/fetch';

interface EmailVerificationResendProps {
  username: string;
}

export function EmailVerificationResend({ username }: EmailVerificationResendProps) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  const handleResend = async () => {
    setStatus('sending');
    try {
      const res = await fetch('/api/auth/email/resend-public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const result = await parseApiResponse(res);
      setStatus(isSuccess(result) ? 'sent' : 'idle');
    } catch {
      setStatus('idle');
    }
  };

  if (status === 'sent') {
    return <p className="text-green-600">Verification email sent. Please check your inbox.</p>;
  }

  return (
    <button
      type="button"
      disabled={status === 'sending'}
      onClick={handleResend}
      className="text-indigo-600 hover:text-indigo-500 font-medium disabled:opacity-50"
    >
      {status === 'sending' ? 'Sending...' : 'Resend verification email'}
    </button>
  );
}
