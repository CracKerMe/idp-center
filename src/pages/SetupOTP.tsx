import React, { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ShieldCheck } from 'lucide-react';
import AppHeader from '../components/AppHeader';

export default function SetupOTP({ user, setUser }: { user: any, setUser: (user: any) => void }) {
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/auth/otp/setup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    .then(res => res.json())
    .then(data => {
      setQrCode(data.qrCodeUrl);
      setSecret(data.secret);
    });
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const res = await fetch('/api/auth/otp/verify', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ token })
    });

    if (res.ok) {
      setUser({ ...user, otp_enabled: 1 });
      navigate({ to: '/' });
    } else {
      setError('Invalid code. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      <AppHeader user={user} setUser={setUser} />

      <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md">
          <div className="flex justify-center">
            <ShieldCheck className="h-12 w-12 text-indigo-600" />
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-zinc-900">
            Setup Two-Factor Authentication
          </h2>
        </div>

        <div className="mt-8 w-full max-w-md">
          <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
            <div className="space-y-6">
              <p className="text-sm text-zinc-600">
                Scan the QR code below with your authenticator app (like Google Authenticator or Authy).
              </p>
              
              {qrCode ? (
                <div className="flex justify-center">
                  <img src={qrCode} alt="QR Code" className="w-48 h-48" />
                </div>
              ) : (
                <div className="flex justify-center items-center w-48 h-48 mx-auto bg-zinc-100 rounded-lg">
                  <span className="text-zinc-400">Loading...</span>
                </div>
              )}

              <div className="text-center">
                <p className="text-xs text-zinc-500">Or enter this secret manually:</p>
                <code className="mt-1 block p-2 bg-zinc-100 rounded text-sm font-mono text-zinc-800 break-all">
                  {secret}
                </code>
              </div>

              <form onSubmit={handleVerify} className="space-y-4">
                {error && <div className="text-red-600 text-sm text-center">{error}</div>}
                
                <div>
                  <label className="block text-sm font-medium text-zinc-700">Enter 6-digit code</label>
                  <div className="mt-1">
                    <input
                      type="text"
                      required
                      maxLength={6}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      className="appearance-none block w-full px-3 py-2 border border-zinc-300 rounded-md shadow-sm placeholder-zinc-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-center tracking-widest font-mono text-lg"
                      placeholder="000000"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  Verify and Enable
                </button>
              </form>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
