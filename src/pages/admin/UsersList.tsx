import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Plus, Edit, Ban, CheckCircle, KeyRound, Trash2 } from 'lucide-react';
import { authFetch, parseApiResponse, isSuccess, getErrorMessage } from '../../utils/fetch';
import AdminTable from '../../components/admin/AdminTable';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import AdminDialog from '../../components/admin/AdminDialog';

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
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', email: '', password: '', is_admin: false });
  const [createError, setCreateError] = useState('');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ email: '', is_admin: false });
  const [editError, setEditError] = useState('');

  const fetchUsers = () => {
    authFetch('/api/admin/users')
      .then(res => parseApiResponse<{ items: User[] }>(res))
      .then(result => {
        if (isSuccess(result) && result.data) setUsers(result.data.items || []);
        setLoading(false);
      });
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    const res = await authFetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUser),
    });
    const result = await parseApiResponse(res);
    if (isSuccess(result)) {
      setShowCreateDialog(false);
      setNewUser({ username: '', email: '', password: '', is_admin: false });
      fetchUsers();
    } else {
      setCreateError(getErrorMessage(result));
    }
  };

  const openEdit = (user: User) => {
    setEditingUser(user);
    setEditForm({ email: user.email, is_admin: !!user.is_admin });
    setEditError('');
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setEditError('');
    const res = await authFetch(`/api/admin/users/${editingUser.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    const result = await parseApiResponse(res);
    if (isSuccess(result)) { setEditingUser(null); fetchUsers(); }
    else setEditError(getErrorMessage(result));
  };

  const handleBan = async (user: User) => {
    if (!confirm(`Ban user "${user.username}"? This will revoke all their tokens.`)) return;
    const res = await authFetch(`/api/admin/users/${user.id}/ban`, { method: 'POST' });
    const result = await parseApiResponse(res);
    if (isSuccess(result)) fetchUsers();
    else alert(getErrorMessage(result));
  };

  const handleUnban = async (user: User) => {
    const res = await authFetch(`/api/admin/users/${user.id}/unban`, { method: 'POST' });
    const result = await parseApiResponse(res);
    if (isSuccess(result)) fetchUsers();
    else alert(getErrorMessage(result));
  };

  const handleResetPassword = async (user: User) => {
    if (!confirm(`Reset password for "${user.username}"? They will receive an email.`)) return;
    const res = await authFetch(`/api/admin/users/${user.id}/reset-password`, { method: 'POST' });
    const result = await parseApiResponse(res);
    if (isSuccess(result)) alert('Password reset email sent.');
    else alert(getErrorMessage(result));
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`Delete user "${user.username}"? This action cannot be undone.`)) return;
    const res = await authFetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
    const result = await parseApiResponse(res);
    if (isSuccess(result)) fetchUsers();
    else alert(getErrorMessage(result));
  };

  return (
    <div className="bg-white dark:bg-zinc-900 shadow overflow-hidden sm:rounded-lg">
      {/* Header */}
      <AdminPageHeader
        title="Registered Users"
        actions={
          <button
            onClick={() => { setShowCreateDialog(true); setCreateError(''); }}
            className="inline-flex w-full sm:w-auto justify-center items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            <Plus className="-ml-0.5 mr-2 h-4 w-4" />
            New User
          </button>
        }
      />

      {/* Table */}
      <AdminTable minWidthClass="min-w-245">
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
          {loading ? (
            <tr><td colSpan={7} className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">Loading...</td></tr>
          ) : users.length === 0 ? (
            <tr><td colSpan={7} className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No users found</td></tr>
          ) : users.map(user => (
            <tr key={user.id}>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-zinc-900 dark:text-white">{user.username}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{user.email}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
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
                  <button onClick={() => openEdit(user)} title="Edit user" className="text-indigo-600 hover:text-indigo-900"><Edit className="h-4 w-4" /></button>
                  {user.is_active ? (
                    <button onClick={() => handleBan(user)} title="Ban user" className="text-red-600 hover:text-red-900"><Ban className="h-4 w-4" /></button>
                  ) : (
                    <button onClick={() => handleUnban(user)} title="Unban user" className="text-green-600 hover:text-green-900"><CheckCircle className="h-4 w-4" /></button>
                  )}
                  <button onClick={() => handleResetPassword(user)} title="Reset password" className="text-yellow-600 hover:text-yellow-900"><KeyRound className="h-4 w-4" /></button>
                  <button onClick={() => handleDelete(user)} title="Delete user" className="text-zinc-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </AdminTable>

      {/* Create Dialog */}
      <AdminDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        title="New User"
        footer={
          <>
            <button type="button" onClick={() => setShowCreateDialog(false)}
              className="inline-flex justify-center rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
              Cancel
            </button>
            <button form="create-user-form" type="submit"
              className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              Create
            </button>
          </>
        }
      >
        <form id="create-user-form" onSubmit={handleCreate} className="space-y-4">
          {createError && (
            <p className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm">{createError}</p>
          )}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Username</label>
            <input type="text" required value={newUser.username}
              onChange={e => setNewUser({ ...newUser, username: e.target.value })}
              className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
            <input type="email" required value={newUser.email}
              onChange={e => setNewUser({ ...newUser, email: e.target.value })}
              className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Password</label>
            <input type="password" required value={newUser.password}
              onChange={e => setNewUser({ ...newUser, password: e.target.value })}
              className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <div className="flex items-center">
            <input id="is_admin_create" type="checkbox" checked={newUser.is_admin}
              onChange={e => setNewUser({ ...newUser, is_admin: e.target.checked })}
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-zinc-300 rounded" />
            <label htmlFor="is_admin_create" className="ml-2 text-sm text-zinc-900 dark:text-white">Admin Privileges</label>
          </div>
        </form>
      </AdminDialog>

      {/* Edit Dialog */}
      <AdminDialog
        open={!!editingUser}
        onClose={() => setEditingUser(null)}
        title={`Edit User: ${editingUser?.username}`}
        footer={
          <>
            <button type="button" onClick={() => setEditingUser(null)}
              className="inline-flex justify-center rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
              Cancel
            </button>
            <button form="edit-user-form" type="submit"
              className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              Save
            </button>
          </>
        }
      >
        <form id="edit-user-form" onSubmit={handleEdit} className="space-y-4">
          {editError && (
            <p className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm">{editError}</p>
          )}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
            <input type="email" required value={editForm.email}
              onChange={e => setEditForm({ ...editForm, email: e.target.value })}
              className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <div className="flex items-center">
            <input id="edit_is_admin" type="checkbox" checked={editForm.is_admin}
              onChange={e => setEditForm({ ...editForm, is_admin: e.target.checked })}
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-zinc-300 rounded" />
            <label htmlFor="edit_is_admin" className="ml-2 text-sm text-zinc-900 dark:text-white">Admin Privileges</label>
          </div>
        </form>
      </AdminDialog>
    </div>
  );
}
