import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { User, Lock, Smartphone, LogOut, Trash2, Shield, Eye, EyeOff, CheckCircle, XCircle, Save, Camera, Link, AlertTriangle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import AppHeader from '../components/AppHeader';
import { authFetch, parseApiResponse, isSuccess, getErrorMessage } from '../utils/fetch';

interface UserInfo {
  id: string;
  username: string;
  email: string;
  full_name?: string;
  phone?: string;
  avatar_url?: string;
  otp_enabled: number;
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

interface TrustedDevice {
  id: string;
  device_fingerprint: string;
  device_name: string;
  trusted_at: string;
  expires_at: string;
  last_used_at: string;
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

  // Sessions and Devices
  const [sessions, setSessions] = useState<Session[]>([]);
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);

  useEffect(() => {
    if (activeTab === 'sessions') {
      fetchSessions();
      fetchTrustedDevices();
    }
    if (activeTab === 'profile') {
      fetchDeletionRequest();
    }
  }, [activeTab]);

  const fetchSessions = async () => {
    try {
      const res = await authFetch('/api/user/sessions');
      if (res.ok) {
        const result = await parseApiResponse<Session[]>(res);
        if (isSuccess(result) && result.data) {
          setSessions(result.data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch sessions');
    }
  };

  const fetchTrustedDevices = async () => {
    try {
      const res = await authFetch('/api/user/trusted-devices');
      if (res.ok) {
        const result = await parseApiResponse<TrustedDevice[]>(res);
        if (isSuccess(result) && result.data) {
          setTrustedDevices(result.data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch trusted devices');
    }
  };

  const fetchDeletionRequest = async () => {
    try {
      const res = await authFetch('/api/user/account/delete-request');
      if (res.ok) {
        const result = await parseApiResponse<{ request: DeletionRequest | null }>(res);
        if (isSuccess(result) && result.data) {
          setDeletionRequest(result.data?.request || null);
        }
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
      const result = await parseApiResponse<{ avatar_url: string }>(res);
      if (isSuccess(result) && result.data) {
        const avatarUrl = result.data.avatar_url;
        setAvatarUrl(avatarUrl);
        setUser({ ...user, avatar_url: avatarUrl });
        setMessage('Avatar updated successfully');
      } else {
        setError(getErrorMessage(result));
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
      const result = await parseApiResponse<{ avatar_url: string }>(res);
      if (isSuccess(result) && result.data) {
        const avatarUrl = result.data.avatar_url;
        setAvatarUrl(avatarUrl);
        setUser({ ...user, avatar_url: avatarUrl });
        setAvatarUrlInput('');
        setShowUrlInput(false);
        setMessage('Avatar updated successfully');
      } else {
        setError(getErrorMessage(result));
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
      const result = await parseApiResponse<{ scheduled_delete_at: string; request: DeletionRequest }>(res);
      if (isSuccess(result) && result.data) {
        setDeletionRequest(result.data?.request || null);
        setShowDeleteConfirm(false);
        setMessage('Account deletion request submitted. You have 30 days to cancel.');
      } else {
        setError(getErrorMessage(result));
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
      const result = await parseApiResponse(res);
      if (isSuccess(result)) {
        await fetchDeletionRequest();
        setMessage('Account deletion request cancelled.');
      } else {
        setError(getErrorMessage(result));
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

      const result = await parseApiResponse(res);
      if (isSuccess(result)) {
        setMessage('Profile updated successfully');
        setUser({ ...user, full_name: fullName, phone });
      } else {
        setError(getErrorMessage(result));
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
        const result = await parseApiResponse<PasswordStrength>(res);
        if (isSuccess(result) && result.data) {
          setPasswordStrength(result.data);
        }
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

      const result = await parseApiResponse(res);
      if (isSuccess(result)) {
        setMessage('Password changed successfully');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordStrength(null);
      } else {
        setError(getErrorMessage(result));
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

      const result = await parseApiResponse(res);
      if (isSuccess(result)) {
        setSessions(sessions.filter(s => s.id !== sessionId));
      } else {
        setError(getErrorMessage(result) || 'Failed to revoke session');
      }
    } catch (err) {
      console.error('Failed to revoke session');
    }
  };

  const handleRemoveTrustedDevice = async (deviceId: string) => {
    try {
      const res = await authFetch(`/api/user/trusted-devices/${deviceId}`, {
        method: 'DELETE',
      });
      const result = await parseApiResponse(res);
      if (isSuccess(result)) {
        setTrustedDevices(trustedDevices.filter(d => d.id !== deviceId));
      } else {
        setError(getErrorMessage(result) || 'Failed to remove trusted device');
      }
    } catch (err) {
      console.error('Failed to remove trusted device');
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
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AppHeader user={user} setUser={setUser} />

      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Account Settings</h1>
          <p className="text-zinc-500 dark:text-zinc-400">Manage your profile, security, and sessions</p>
        </div>

        {/* Tabs */}
        <div className="border-b border-zinc-200 dark:border-zinc-700 mb-6">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('profile')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'profile'
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <User className="inline-block h-4 w-4 mr-2" />
              Profile
            </button>
            <button
              onClick={() => setActiveTab('security')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'security'
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <Shield className="inline-block h-4 w-4 mr-2" />
              Security
            </button>
            <button
              onClick={() => setActiveTab('sessions')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'sessions'
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <Smartphone className="inline-block h-4 w-4 mr-2" />
              Sessions
            </button>
          </nav>
        </div>

        {message && (
          <div className="mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-600 dark:text-green-400 px-4 py-3 rounded-md text-sm">
            {message}
          </div>
        )}

        {error && (
          <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm">
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
              <div className="bg-white dark:bg-zinc-900 shadow rounded-lg p-6">
                <h3 className="text-lg font-medium text-zinc-900 dark:text-white mb-4">Profile Picture</h3>
                <div className="flex items-center gap-6">
                  <div className="relative">
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt="Avatar"
                        className="h-20 w-20 rounded-full object-cover border-2 border-zinc-200 dark:border-zinc-700"
                        onError={() => setAvatarUrl('')}
                      />
                    ) : (
                      <div className="h-20 w-20 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center border-2 border-zinc-200 dark:border-zinc-700">
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
                      className="flex items-center py-2 px-3 border border-zinc-300 dark:border-zinc-700 rounded-md text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50"
                    >
                      <Camera className="h-4 w-4 mr-2" />
                      Upload Photo
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowUrlInput(!showUrlInput)}
                      className="flex items-center py-2 px-3 border border-zinc-300 dark:border-zinc-700 rounded-md text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                    >
                      <Link className="h-4 w-4 mr-2" />
                      Use URL
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">Accepted formats: JPG, PNG, WebP. Max size: 2MB.</p>

                {showUrlInput && (
                  <form onSubmit={handleAvatarUrlSubmit} className="mt-4 flex gap-2">
                    <input
                      type="url"
                      value={avatarUrlInput}
                      onChange={(e) => setAvatarUrlInput(e.target.value)}
                      placeholder="https://example.com/avatar.jpg"
                      className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
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
              <div className="bg-white dark:bg-zinc-900 shadow rounded-lg p-6">
                <form onSubmit={handleProfileUpdate} className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Username</label>
                    <input
                      type="text"
                      value={user.username}
                      disabled
                      className="mt-1 block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-sm bg-zinc-50 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 sm:text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
                    <input
                      type="email"
                      value={user.email}
                      disabled
                      className="mt-1 block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-sm bg-zinc-50 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 sm:text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Full Name</label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="mt-1 block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Phone</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="mt-1 block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
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
              <div className="bg-white dark:bg-zinc-900 shadow rounded-lg p-6 border border-red-100 dark:border-red-900">
                <h3 className="text-lg font-medium text-red-700 dark:text-red-400 mb-1 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Danger Zone
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                  Requesting account deletion will schedule your account for permanent removal after a 30-day grace period.
                </p>

                {deletionRequest && deletionRequest.status === 'pending' && (
                  <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                    <p className="text-sm font-medium text-red-700 dark:text-red-400">Account deletion is pending</p>
                    <p className="text-xs text-red-500 mt-1">
                      Scheduled for: {new Date(deletionRequest.scheduled_delete_at).toLocaleDateString()}
                    </p>
                    <button
                      onClick={handleCancelDeletion}
                      disabled={deletionLoading}
                      className="mt-3 flex items-center py-2 px-3 border border-red-300 dark:border-red-700 rounded-md text-sm font-medium text-red-700 dark:text-red-400 bg-white dark:bg-zinc-800 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Cancel Deletion Request
                    </button>
                  </div>
                )}

                {deletionRequest && deletionRequest.status === 'cancelled' && (
                  <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
                    <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
                      <CheckCircle className="h-4 w-4" />
                      Previous deletion request was cancelled.
                    </p>
                  </div>
                )}

                {(!deletionRequest || deletionRequest.status === 'cancelled') && (
                  <>
                    {showDeleteConfirm ? (
                      <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                        <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-3">
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
                            className="py-2 px-3 border border-zinc-300 dark:border-zinc-700 rounded-md text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="flex items-center py-2 px-4 border border-red-300 dark:border-red-700 rounded-md shadow-sm text-sm font-medium text-red-700 dark:text-red-400 bg-white dark:bg-zinc-800 hover:bg-red-50 dark:hover:bg-red-900/20"
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
              <div className="bg-white dark:bg-zinc-900 shadow rounded-lg p-6">
                <h3 className="text-lg font-medium text-zinc-900 dark:text-white mb-4">Two-Factor Authentication</h3>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    {user.otp_enabled ? (
                      <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
                    ) : (
                      <XCircle className="h-5 w-5 text-zinc-400 mr-2" />
                    )}
                    <span className="text-sm text-zinc-700 dark:text-zinc-300">
                      {user.otp_enabled ? '2FA is enabled' : '2FA is not enabled'}
                    </span>
                  </div>
                  <button
                    onClick={() => navigate({ to: '/setup-otp' })}
                    className="text-sm text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                  >
                    {user.otp_enabled ? 'Manage' : 'Enable'}
                  </button>
                </div>
              </div>

              <div className="bg-white dark:bg-zinc-900 shadow rounded-lg p-6">
                <h3 className="text-lg font-medium text-zinc-900 dark:text-white mb-4">Change Password</h3>
                <form onSubmit={handlePasswordChange} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Current Password</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                      className="mt-1 block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">New Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => {
                          setNewPassword(e.target.value);
                          validatePassword(e.target.value);
                        }}
                        required
                        className="mt-1 block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
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
                          <div className="flex-1 h-1 bg-gray-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                            <div className={`h-full ${getStrengthColor()} transition-all`} style={{ width: `${passwordStrength.score * 25}%` }} />
                          </div>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
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
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Confirm New Password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      className="mt-1 block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
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

              <div className="bg-white dark:bg-zinc-900 shadow rounded-lg p-6">
                <h3 className="text-lg font-medium text-zinc-900 dark:text-white mb-4">Sign Out</h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">Sign out from your account on this device.</p>
                <button
                  onClick={handleLogout}
                  className="flex items-center py-2 px-4 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-sm text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </button>
              </div>
            </div>
          )}

          {/* Sessions Tab */}
          {activeTab === 'sessions' && (
            <div className="space-y-6">
              <div className="bg-white dark:bg-zinc-900 shadow rounded-lg p-6">
                <h3 className="text-lg font-medium text-zinc-900 dark:text-white mb-4">Active Sessions</h3>
                {sessions.length === 0 ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">No active sessions</p>
                ) : (
                  <div className="space-y-4">
                    {sessions.map((session) => (
                      <div key={session.id} className="flex items-center justify-between p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                        <div>
                          <p className="text-sm font-medium text-zinc-900 dark:text-white">{session.device_info || 'Unknown Device'}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">IP: {session.ip_address}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">Last active: {new Date(session.last_active).toLocaleString()}</p>
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

              <div className="bg-white dark:bg-zinc-900 shadow rounded-lg p-6">
                <h3 className="text-lg font-medium text-zinc-900 dark:text-white mb-4">Trusted Devices</h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">Devices that will not require 2FA on login.</p>
                {trustedDevices.length === 0 ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">No trusted devices</p>
                ) : (
                  <div className="space-y-4">
                    {trustedDevices.map((device) => (
                      <div key={device.id} className="flex items-center justify-between p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                        <div>
                          <p className="text-sm font-medium text-zinc-900 dark:text-white">{device.device_name || 'Unknown Device'}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">Trusted at: {new Date(device.trusted_at).toLocaleString()}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">Last used: {device.last_used_at ? new Date(device.last_used_at).toLocaleString() : 'Never'}</p>
                        </div>
                        <button
                          onClick={() => handleRemoveTrustedDevice(device.id)}
                          title="Remove device"
                          className="text-red-600 hover:text-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
