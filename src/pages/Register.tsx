import React, { useState, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { Shield, XCircle, Mail } from 'lucide-react';

interface PasswordStrength {
  score: number;
  valid: boolean;
  errors: string[];
}

export default function Register() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [registered, setRegistered] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrength | null>(null);
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const validatePassword = (pwd: string) => {
    if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
    if (!pwd) { setPasswordStrength(null); return; }
    validateTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/auth/password/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd })
        });
        const data = await res.json();
        setPasswordStrength(data);
      } catch {
        // ignore
      }
    }, 300);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (passwordStrength && !passwordStrength.valid) {
      setError('Password does not meet requirements');
      return;
    }

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });

    if (res.ok) {
      setRegistered(true);
    } else {
      const data = await res.json();
      setError(data.error || 'Registration failed');
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <Shield className="h-12 w-12 text-indigo-600" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-zinc-900">
          Create a new account
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {registered ? (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <Mail className="h-12 w-12 text-indigo-600" />
              </div>
              <h3 className="text-lg font-medium text-zinc-900">Check your email</h3>
              <p className="text-sm text-zinc-600">
                We've sent a verification link to <span className="font-medium">{email}</span>. Please check your inbox and click the link to verify your account.
              </p>
              <p className="text-xs text-zinc-500">
                The link will expire in 24 hours. If you don't see the email, check your spam folder.
              </p>
              <div className="pt-2">
                <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500 text-sm">
                  Go to sign in
                </Link>
              </div>
            </div>
          ) : (
          <>
          <form className="space-y-6" onSubmit={handleSubmit}>
            {error && <div className="text-red-600 text-sm text-center">{error}</div>}

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
              <label className="block text-sm font-medium text-zinc-700">Email address</label>
              <div className="mt-1">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-zinc-300 rounded-md shadow-sm placeholder-zinc-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700">Password</label>
              <div className="mt-1">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    validatePassword(e.target.value);
                  }}
                  className="appearance-none block w-full px-3 py-2 border border-zinc-300 rounded-md shadow-sm placeholder-zinc-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
              {passwordStrength && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                      <div className={`h-full ${getStrengthColor()} transition-all`} style={{ width: `${passwordStrength.score * 25}%` }} />
                    </div>
                    <span className="text-xs text-zinc-500">
                      {passwordStrength.score <= 1 ? 'Weak' : passwordStrength.score === 2 ? 'Fair' : passwordStrength.score === 3 ? 'Good' : 'Strong'}
                    </span>
                  </div>
                  {passwordStrength.errors.slice(0, 2).map((err, i) => (
                    <div key={i} className="flex items-center gap-1 text-xs text-red-500">
                      <XCircle className="h-3 w-3" /> {err}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <button
                type="submit"
                disabled={passwordStrength !== null && !passwordStrength.valid}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                Register
              </button>
            </div>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-zinc-500">Already have an account?</span>
              </div>
            </div>

            <div className="mt-6 text-center">
              <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
                Sign in instead
              </Link>
            </div>
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
