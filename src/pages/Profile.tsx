import React, { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { User, Lock, Smartphone, LogOut, Trash2, Shield, Eye, EyeOff, CheckCircle, XCircle, Save } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import AppHeader from '../components/AppHeader';

interface UserInfo {
  id: string;
  username: string;
  email: string;
  full_name?: string;
  phone?: string;
  otp_enabled: boolean;
  tenant_id?: string;
}

interface Session {
  id: string;
  device_info: string;
  ip_address: string;
  last_active: string;
  created_at: string;
}

interface PasswordStrength {
  score: number;
  valid: boolean;
  errors: string[];
}

export default function Profile({ user, setUser }: { user: UserInfo; setUser: (user: any) => void }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'sessions'>('profile');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Profile form
  const [fullName, setFullName] = useState(user.full_name || '');
  const [phone, setPhone] = useState(user.phone || '');

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrength | null>(null);

  // Sessions
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    if (activeTab === 'sessions') {
      fetchSessions();
    }
  }, [activeTab]);

  const fetchSessions = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch('/api/user/sessions', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (err) {
      console.error('Failed to fetch sessions');
    }
  };

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    const token = localStorage.getItem('token');
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ full_name: fullName, phone })
      });

      if (res.ok) {
        setMessage('Profile updated successfully');
        setUser({ ...user, full_name: fullName, phone });
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update profile');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const validatePassword = async (password: string) => {
    try {
      const res = await fetch('/api/auth/password/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      setPasswordStrength(data);
    } catch (err) {
      console.error('Failed to validate password');
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!passwordStrength?.valid) {
      setError('Password does not meet requirements');
      return;
    }

    setLoading(true);
    const token = localStorage.getItem('token');

    try {
      const res = await fetch('/api/user/password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
      });

      if (res.ok) {
        setMessage('Password changed successfully');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordStrength(null);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to change password');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`/api/user/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.ok) {
        setSessions(sessions.filter(s => s.id !== sessionId));
      }
    } catch (err) {
      console.error('Failed to revoke session');
    }
  };

  const handleLogout = async () => {
    try {
      // Call server logout API to revoke session and tokens
      const token = localStorage.getItem('token');
      const sessionId = localStorage.getItem('session_id');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      if (sessionId) {
        headers['X-Session-Id'] = sessionId;
      }

      await fetch('/api/auth/logout', {
        method: 'POST',
        headers
      });
    } catch (error) {
      console.error('Logout API error:', error);
      // Continue with local logout even if API fails
    } finally {
      // Clear local storage
      localStorage.removeItem('token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('session_id');
      setUser(null);
      navigate({ to: '/login' });
    }
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

  return (
    <div className="min-h-screen bg-zinc-50">
      <AppHeader user={user} setUser={setUser} />

      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-zinc-900">Account Settings</h1>
          <p className="text-zinc-500">Manage your profile, security, and sessions</p>
        </div>

        {/* Tabs */}
        <div className="border-b border-zinc-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('profile')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'profile'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'
              }`}
            >
              <User className="inline-block h-4 w-4 mr-2" />
              Profile
            </button>
            <button
              onClick={() => setActiveTab('security')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'security'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'
              }`}
            >
              <Shield className="inline-block h-4 w-4 mr-2" />
              Security
            </button>
            <button
              onClick={() => setActiveTab('sessions')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'sessions'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'
              }`}
            >
              <Smartphone className="inline-block h-4 w-4 mr-2" />
              Sessions
            </button>
          </nav>
        </div>

        {message && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-600 px-4 py-3 rounded-md text-sm">
            {message}
          </div>
        )}

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">
            {error}
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 16, y: 8 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, x: -16, y: -8 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <div className="bg-white shadow rounded-lg p-6">
              <form onSubmit={handleProfileUpdate} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-zinc-700">Username</label>
                  <input
                    type="text"
                    value={user.username}
                    disabled
                    className="mt-1 block w-full px-3 py-2 border border-zinc-300 rounded-md shadow-sm bg-zinc-50 text-zinc-500 sm:text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700">Email</label>
                  <input
                    type="email"
                    value={user.email}
                    disabled
                    className="mt-1 block w-full px-3 py-2 border border-zinc-300 rounded-md shadow-sm bg-zinc-50 text-zinc-500 sm:text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700">Full Name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="mt-1 block w-full px-3 py-2 border border-zinc-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700">Phone</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="mt-1 block w-full px-3 py-2 border border-zinc-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Save Changes
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              <div className="bg-white shadow rounded-lg p-6">
                <h3 className="text-lg font-medium text-zinc-900 mb-4">Two-Factor Authentication</h3>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    {user.otp_enabled ? (
                      <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
                    ) : (
                      <XCircle className="h-5 w-5 text-zinc-400 mr-2" />
                    )}
                    <span className="text-sm text-zinc-700">
                      {user.otp_enabled ? '2FA is enabled' : '2FA is not enabled'}
                    </span>
                  </div>
                  <button
                    onClick={() => navigate({ to: '/setup-otp' })}
                    className="text-sm text-indigo-600 hover:text-indigo-500"
                  >
                    {user.otp_enabled ? 'Manage' : 'Enable'}
                  </button>
                </div>
              </div>

              <div className="bg-white shadow rounded-lg p-6">
                <h3 className="text-lg font-medium text-zinc-900 mb-4">Change Password</h3>
                <form onSubmit={handlePasswordChange} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700">Current Password</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                      className="mt-1 block w-full px-3 py-2 border border-zinc-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-700">New Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => {
                          setNewPassword(e.target.value);
                          validatePassword(e.target.value);
                        }}
                        required
                        className="mt-1 block w-full px-3 py-2 border border-zinc-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-0 pr-3 mt-1 flex items-center"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4 text-zinc-400" /> : <Eye className="h-4 w-4 text-zinc-400" />}
                      </button>
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
                    <label className="block text-sm font-medium text-zinc-700">Confirm New Password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      className="mt-1 block w-full px-3 py-2 border border-zinc-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                    >
                      <Lock className="h-4 w-4 mr-2" />
                      Change Password
                    </button>
                  </div>
                </form>
              </div>

              <div className="bg-white shadow rounded-lg p-6">
                <h3 className="text-lg font-medium text-zinc-900 mb-4">Sign Out</h3>
                <p className="text-sm text-zinc-500 mb-4">Sign out from your account on this device.</p>
                <button
                  onClick={handleLogout}
                  className="flex items-center py-2 px-4 border border-zinc-300 rounded-md shadow-sm text-sm font-medium text-zinc-700 bg-white hover:bg-zinc-50"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </button>
              </div>
            </div>
          )}

          {/* Sessions Tab */}
          {activeTab === 'sessions' && (
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-zinc-900 mb-4">Active Sessions</h3>
              {sessions.length === 0 ? (
                <p className="text-sm text-zinc-500">No active sessions</p>
              ) : (
                <div className="space-y-4">
                  {sessions.map((session) => (
                    <div key={session.id} className="flex items-center justify-between p-4 border border-zinc-200 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-zinc-900">{session.device_info || 'Unknown Device'}</p>
                        <p className="text-xs text-zinc-500">IP: {session.ip_address}</p>
                        <p className="text-xs text-zinc-500">Last active: {new Date(session.last_active).toLocaleString()}</p>
                      </div>
                      <button
                        onClick={() => handleRevokeSession(session.id)}
                        className="text-red-600 hover:text-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
