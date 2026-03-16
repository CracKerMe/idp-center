import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { User, Lock, Smartphone, LogOut, Trash2, Shield, Eye, EyeOff, CheckCircle, XCircle, Save, Camera, Link, AlertTriangle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import AppHeader from '../components/AppHeader';
import { authFetch } from '../utils/fetch';

interface UserInfo {
  id: string;
  username: string;
  email: string;
  full_name?: string;
  phone?: string;
  avatar_url?: string;
  otp_enabled: boolean;
  tenant_id?: string;
}

interface DeletionRequest {
  id: string;
  status: 'pending' | 'cancelled' | 'completed';
  requested_at: string;
  scheduled_delete_at: string;
  cancelled_at?: string;
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

  // Avatar
  const fileInputRef = useRef<HTMLInputElement>(null);
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url || '');
  const [avatarUrlInput, setAvatarUrlInput] = useState('');
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);

  // Account deletion
  const [deletionRequest, setDeletionRequest] = useState<DeletionRequest | null>(null);
  const [deletionLoading, setDeletionLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
    if (activeTab === 'profile') {
      fetchDeletionRequest();
    }
  }, [activeTab]);

  const fetchSessions = async () => {
    try {
      const res = await authFetch('/api/user/sessions');
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (err) {
      console.error('Failed to fetch sessions');
    }
  };

  const fetchDeletionRequest = async () => {
    try {
      const res = await authFetch('/api/user/account/delete-request');
      if (res.ok) {
        const data = await res.json();
        setDeletionRequest(data.request || null);
      }
    } catch (err) {
      console.error('Failed to fetch deletion request');
    }
  };

  const handleAvatarFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarLoading(true);
    setError('');
    const formData = new FormData();
    formData.append('avatar', file);

    try {
      const res = await authFetch('/api/user/avatar', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        setAvatarUrl(data.avatar_url);
        setUser({ ...user, avatar_url: data.avatar_url });
        setMessage('Avatar updated successfully');
      } else {
        setError(data.error || 'Failed to upload avatar');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setAvatarLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAvatarUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!avatarUrlInput.trim()) return;

    setAvatarLoading(true);
    setError('');

    try {
      const res = await authFetch('/api/user/avatar/url', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: avatarUrlInput })
      });
      const data = await res.json();
      if (res.ok) {
        setAvatarUrl(data.avatar_url);
        setUser({ ...user, avatar_url: data.avatar_url });
        setAvatarUrlInput('');
        setShowUrlInput(false);
        setMessage('Avatar updated successfully');
      } else {
        setError(data.error || 'Failed to set avatar URL');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setAvatarLoading(false);
    }
  };

  const handleRequestDeletion = async () => {
    setDeletionLoading(true);
    setError('');

    try {
      const res = await authFetch('/api/user/account/delete-request', {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        setDeletionRequest(data.request);
        setShowDeleteConfirm(false);
        setMessage('Account deletion request submitted. You have 30 days to cancel.');
      } else {
        setError(data.error || 'Failed to submit deletion request');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setDeletionLoading(false);
    }
  };

  const handleCancelDeletion = async () => {
    setDeletionLoading(true);
    setError('');

    try {
      const res = await authFetch('/api/user/account/delete-request', {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        await fetchDeletionRequest();
        setMessage('Account deletion request cancelled.');
      } else {
        setError(data.error || 'Failed to cancel deletion request');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setDeletionLoading(false);
    }
  };

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      const res = await authFetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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

  const validatePassword = (password: string) => {
    if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
    validateTimerRef.current = setTimeout(async () => {
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
    }, 300);
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

    try {
      const res = await authFetch('/api/user/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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
    try {
      const res = await authFetch(`/api/user/sessions/${sessionId}`, {
        method: 'DELETE',
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
      await authFetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
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
            <div className="space-y-6">
              {/* Avatar Section */}
              <div className="bg-white shadow rounded-lg p-6">
                <h3 className="text-lg font-medium text-zinc-900 mb-4">Profile Picture</h3>
                <div className="flex items-center gap-6">
                  <div className="relative">
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt="Avatar"
                        className="h-20 w-20 rounded-full object-cover border-2 border-zinc-200"
                        onError={() => setAvatarUrl('')}
                      />
                    ) : (
                      <div className="h-20 w-20 rounded-full bg-indigo-100 flex items-center justify-center border-2 border-zinc-200">
                        <User className="h-10 w-10 text-indigo-400" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handleAvatarFileUpload}
                    />
                    <button
                      type="button"
                      disabled={avatarLoading}
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center py-2 px-3 border border-zinc-300 rounded-md text-sm font-medium text-zinc-700 bg-white hover:bg-zinc-50 disabled:opacity-50"
                    >
                      <Camera className="h-4 w-4 mr-2" />
                      Upload Photo
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowUrlInput(!showUrlInput)}
                      className="flex items-center py-2 px-3 border border-zinc-300 rounded-md text-sm font-medium text-zinc-700 bg-white hover:bg-zinc-50"
                    >
                      <Link className="h-4 w-4 mr-2" />
                      Use URL
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-zinc-400">Accepted formats: JPG, PNG, WebP. Max size: 2MB.</p>

                {showUrlInput && (
                  <form onSubmit={handleAvatarUrlSubmit} className="mt-4 flex gap-2">
                    <input
                      type="url"
                      value={avatarUrlInput}
                      onChange={(e) => setAvatarUrlInput(e.target.value)}
                      placeholder="https://example.com/avatar.jpg"
                      className="flex-1 px-3 py-2 border border-zinc-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={avatarLoading || !avatarUrlInput.trim()}
                      className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </form>
                )}
              </div>

              {/* Profile Info Form */}
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

              {/* Account Deletion Section */}
              <div className="bg-white shadow rounded-lg p-6 border border-red-100">
                <h3 className="text-lg font-medium text-red-700 mb-1 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Danger Zone
                </h3>
                <p className="text-sm text-zinc-500 mb-4">
                  Requesting account deletion will schedule your account for permanent removal after a 30-day grace period.
                </p>

                {deletionRequest && deletionRequest.status === 'pending' && (
                  <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
                    <p className="text-sm font-medium text-red-700">Account deletion is pending</p>
                    <p className="text-xs text-red-500 mt-1">
                      Scheduled for: {new Date(deletionRequest.scheduled_delete_at).toLocaleDateString()}
                    </p>
                    <button
                      onClick={handleCancelDeletion}
                      disabled={deletionLoading}
                      className="mt-3 flex items-center py-2 px-3 border border-red-300 rounded-md text-sm font-medium text-red-700 bg-white hover:bg-red-50 disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Cancel Deletion Request
                    </button>
                  </div>
                )}

                {deletionRequest && deletionRequest.status === 'cancelled' && (
                  <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
                    <p className="text-sm text-green-700 flex items-center gap-2">
                      <CheckCircle className="h-4 w-4" />
                      Previous deletion request was cancelled.
                    </p>
                  </div>
                )}

                {(!deletionRequest || deletionRequest.status === 'cancelled') && (
                  <>
                    {showDeleteConfirm ? (
                      <div className="p-4 bg-red-50 border border-red-200 rounded-md">
                        <p className="text-sm font-medium text-red-700 mb-3">
                          Are you sure? This will schedule your account for deletion in 30 days. You can cancel during this period.
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={handleRequestDeletion}
                            disabled={deletionLoading}
                            className="flex items-center py-2 px-3 border border-transparent rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Confirm Deletion Request
                          </button>
                          <button
                            onClick={() => setShowDeleteConfirm(false)}
                            className="py-2 px-3 border border-zinc-300 rounded-md text-sm font-medium text-zinc-700 bg-white hover:bg-zinc-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="flex items-center py-2 px-4 border border-red-300 rounded-md shadow-sm text-sm font-medium text-red-700 bg-white hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Request Account Deletion
                      </button>
                    )}
                  </>
                )}
              </div>
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
