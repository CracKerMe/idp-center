import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Plus, Edit, Ban, CheckCircle, KeyRound, Trash2 } from 'lucide-react';
import { authFetch } from '../../utils/fetch';

interface User {
  id: string;
  username: string;
  email: string;
  is_active: number;
  is_admin: number;
  otp_enabled: number;
  created_at: string;
}

export default function UsersList() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', email: '', password: '', is_admin: false });
  const [error, setError] = useState('');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ email: '', is_admin: false });
  const [actionError, setActionError] = useState('');

  const fetchUsers = () => {
    authFetch('/api/admin/users')
      .then(res => res.json())
      .then(json => { setUsers(json.data.items || []); setLoading(false); });
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const res = await authFetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUser)
    });
    if (res.ok) {
      setShowCreateForm(false);
      setNewUser({ username: '', email: '', password: '', is_admin: false });
      fetchUsers();
    } else {
      const data = await res.json();
      setError(data.error || 'Failed to create user');
    }
  };

  const openEdit = (user: User) => {
    setEditingUser(user);
    setEditForm({ email: user.email, is_admin: !!user.is_admin });
    setActionError('');
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setActionError('');
    const res = await authFetch(`/api/admin/users/${editingUser.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm)
    });
    if (res.ok) {
      setEditingUser(null);
      fetchUsers();
    } else {
      const result = await res.json();
      setActionError(result.error || 'Failed to update user');
    }
  };

  const handleBan = async (user: User) => {
    if (!confirm(`Ban user "${user.username}"? This will revoke all their tokens.`)) return;
    const res = await authFetch(`/api/admin/users/${user.id}/ban`, {
      method: 'POST',
    });
    if (res.ok) fetchUsers();
    else alert('Failed to ban user');
  };

  const handleUnban = async (user: User) => {
    const res = await authFetch(`/api/admin/users/${user.id}/unban`, {
      method: 'POST',
    });
    if (res.ok) fetchUsers();
    else alert('Failed to unban user');
  };

  const handleResetPassword = async (user: User) => {
    if (!confirm(`Reset password for "${user.username}"? They will receive an email.`)) return;
    const res = await authFetch(`/api/admin/users/${user.id}/reset-password`, {
      method: 'POST',
    });
    if (res.ok) alert('Password reset email sent.');
    else alert('Failed to reset password');
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`Delete user "${user.username}"? This action cannot be undone.`)) return;
    const res = await authFetch(`/api/admin/users/${user.id}`, {
      method: 'DELETE',
    });
    if (res.ok) fetchUsers();
    else alert('Failed to delete user');
  };

  if (loading) return <div>Loading users...</div>;

  return (
    <div className="bg-white dark:bg-zinc-900 shadow overflow-hidden sm:rounded-lg">
      <div className="px-4 py-5 sm:px-6 flex justify-between items-center">
        <h3 className="text-lg leading-6 font-medium text-zinc-900 dark:text-white">Registered Users</h3>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
        >
          <Plus className="-ml-0.5 mr-2 h-4 w-4" />
          New User
        </button>
      </div>

      {showCreateForm && (
        <div className="border-t border-zinc-200 dark:border-zinc-700 px-4 py-5 sm:p-6 bg-zinc-50 dark:bg-zinc-800">
          <form onSubmit={handleCreate} className="space-y-4 max-w-lg">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm">{error}</div>
            )}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Username</label>
              <input type="text" required value={newUser.username}
                onChange={e => setNewUser({ ...newUser, username: e.target.value })}
                className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
              <input type="email" required value={newUser.email}
                onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Password</label>
              <input type="password" required value={newUser.password}
                onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
            </div>
            <div className="flex items-center">
              <input id="is_admin_create" type="checkbox" checked={newUser.is_admin}
                onChange={e => setNewUser({ ...newUser, is_admin: e.target.checked })}
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-zinc-300 rounded" />
              <label htmlFor="is_admin_create" className="ml-2 block text-sm text-zinc-900 dark:text-white">Admin Privileges</label>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => setShowCreateForm(false)}
                className="mr-3 bg-white dark:bg-zinc-800 py-2 px-4 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-sm text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700">
                Cancel
              </button>
              <button type="submit"
                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700">
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="border-t border-zinc-200 dark:border-zinc-700">
        <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
          <thead className="bg-zinc-50 dark:bg-zinc-800">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Username</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Email</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Role</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">2FA</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Created</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-700">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-zinc-900 dark:text-white">{user.username}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{user.email}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${user.is_active ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'}`}>
                    {user.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{user.is_admin ? 'Admin' : 'User'}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{user.otp_enabled ? 'Enabled' : 'Disabled'}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                  {format(new Date(user.created_at), 'MMM d, yyyy HH:mm')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => openEdit(user)} title="Edit user"
                      className="text-indigo-600 hover:text-indigo-900">
                      <Edit className="h-4 w-4" />
                    </button>
                    {user.is_active ? (
                      <button onClick={() => handleBan(user)} title="Ban user"
                        className="text-red-600 hover:text-red-900">
                        <Ban className="h-4 w-4" />
                      </button>
                    ) : (
                      <button onClick={() => handleUnban(user)} title="Unban user"
                        className="text-green-600 hover:text-green-900">
                        <CheckCircle className="h-4 w-4" />
                      </button>
                    )}
                    <button onClick={() => handleResetPassword(user)} title="Reset password"
                      className="text-yellow-600 hover:text-yellow-900">
                      <KeyRound className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleDelete(user)} title="Delete user"
                      className="text-zinc-400 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-zinc-500 bg-opacity-75 transition-opacity" onClick={() => setEditingUser(null)} />
            <div className="inline-block align-bottom bg-white dark:bg-zinc-900 rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-md sm:w-full sm:p-6 relative z-10">
              <form onSubmit={handleEdit}>
                <h3 className="text-lg font-medium text-zinc-900 dark:text-white mb-4">Edit User: {editingUser.username}</h3>
                {actionError && (
                  <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm">{actionError}</div>
                )}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
                    <input type="email" required value={editForm.email}
                      onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                      className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                  </div>
                  <div className="flex items-center">
                    <input id="edit_is_admin" type="checkbox" checked={editForm.is_admin}
                      onChange={e => setEditForm({ ...editForm, is_admin: e.target.checked })}
                      className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-zinc-300 rounded" />
                    <label htmlFor="edit_is_admin" className="ml-2 block text-sm text-zinc-900 dark:text-white">Admin Privileges</label>
                  </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                  <button type="button" onClick={() => setEditingUser(null)}
                    className="inline-flex justify-center rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800">
                    Cancel
                  </button>
                  <button type="submit"
                    className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
                    Save
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
