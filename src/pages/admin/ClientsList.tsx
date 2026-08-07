import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Plus, Edit, Trash2, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { authFetch, parseApiResponse, isSuccess, getErrorMessage } from '../../utils/fetch';
import AdminTable from '../../components/admin/AdminTable';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import AdminDialog from '../../components/admin/AdminDialog';

interface Client {
  id: string;
  clientId: string;
  clientName: string;
  redirectUris: string;
  createdAt: string;
}

export default function ClientsList() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newClient, setNewClient] = useState({ client_name: '', redirect_uris: '' });
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editForm, setEditForm] = useState({ client_name: '', redirect_uris: '' });
  const [editError, setEditError] = useState('');
  const [rotatedSecret, setRotatedSecret] = useState<{ clientId: string; secret: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const fetchClients = () => {
    authFetch('/api/admin/clients')
      .then(res => parseApiResponse<any[]>(res))
      .then(result => {
        if (isSuccess(result) && result.data) {
          setClients(Array.isArray(result.data) ? result.data : (result.data as any)?.items || []);
        }
        setLoading(false);
      });
  };

  useEffect(() => { fetchClients(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await authFetch('/api/admin/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newClient),
    });
    const result = await parseApiResponse(res);
    if (isSuccess(result)) {
      setShowCreateDialog(false);
      setNewClient({ client_name: '', redirect_uris: '' });
      fetchClients();
    }
  };

  const openEdit = (client: Client) => {
    setEditingClient(client);
    setEditForm({ client_name: client.clientName, redirect_uris: client.redirectUris });
    setEditError('');
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient) return;
    setEditError('');
    const res = await authFetch(`/api/admin/clients/${editingClient.clientId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    const result = await parseApiResponse(res);
    if (isSuccess(result)) { setEditingClient(null); fetchClients(); }
    else setEditError(getErrorMessage(result));
  };

  const handleDelete = async (client: Client) => {
    if (!confirm(`Delete client "${client.clientName}"? This cannot be undone.`)) return;
    const res = await authFetch(`/api/admin/clients/${client.clientId}`, { method: 'DELETE' });
    const result = await parseApiResponse(res);
    if (isSuccess(result)) fetchClients();
    else alert(getErrorMessage(result));
  };

  const handleRotateSecret = async (client: Client) => {
    if (!confirm(`Rotate secret for "${client.clientName}"? The old secret will stop working immediately.`)) return;
    const res = await authFetch(`/api/admin/clients/${client.clientId}/rotate-secret`, { method: 'POST' });
    const result = await parseApiResponse<{ client_secret: string }>(res);
    if (isSuccess(result) && result.data) {
      setRotatedSecret({ clientId: client.clientId, secret: result.data.client_secret });
      setShowSecret(false);
    } else {
      alert(getErrorMessage(result));
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 shadow overflow-hidden sm:rounded-lg">
      {/* Header */}
      <AdminPageHeader
        title="OAuth Clients"
        actions={
          <button
            onClick={() => setShowCreateDialog(true)}
            className="inline-flex w-full sm:w-auto justify-center items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            <Plus className="-ml-0.5 mr-2 h-4 w-4" />
            New Client
          </button>
        }
      />

      {/* Rotated secret banner */}
      {rotatedSecret && (
        <div className="border-t border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 px-4 py-4 sm:px-6">
          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-400 mb-2">
            New secret for <span className="font-mono">{rotatedSecret.clientId}</span> — copy it now, it won't be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white dark:bg-zinc-800 border border-yellow-300 dark:border-yellow-700 rounded px-3 py-1 text-sm font-mono break-all dark:text-white">
              {showSecret ? rotatedSecret.secret : '•'.repeat(40)}
            </code>
            <button onClick={() => setShowSecret(s => !s)} className="text-yellow-700 dark:text-yellow-400 hover:text-yellow-900">
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            <button onClick={() => setRotatedSecret(null)} className="text-yellow-700 dark:text-yellow-400 hover:text-yellow-900 text-xs underline">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <AdminTable minWidthClass="min-w-230">
        <thead className="bg-zinc-50 dark:bg-zinc-800">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Name</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Client ID</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Redirect URIs</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Created</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-700">
          {loading ? (
            <tr><td colSpan={5} className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">Loading...</td></tr>
          ) : clients.length === 0 ? (
            <tr><td colSpan={5} className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No clients found</td></tr>
          ) : clients.map(client => (
            <tr key={client.id}>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-zinc-900 dark:text-white">{client.clientName}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400 font-mono">{client.clientId}</td>
              <td className="px-6 py-4 text-sm text-zinc-500 dark:text-zinc-400 break-all max-w-xs">{client.redirectUris}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                {client.createdAt ? format(new Date(client.createdAt), 'MMM d, yyyy HH:mm') : '-'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <div className="flex justify-end gap-2">
                  <button onClick={() => openEdit(client)} title="Edit client" className="text-indigo-600 hover:text-indigo-900"><Edit className="h-4 w-4" /></button>
                  <button onClick={() => handleRotateSecret(client)} title="Rotate secret" className="text-yellow-600 hover:text-yellow-900"><RefreshCw className="h-4 w-4" /></button>
                  <button onClick={() => handleDelete(client)} title="Delete client" className="text-zinc-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
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
        title="New Client"
        footer={
          <>
            <button type="button" onClick={() => setShowCreateDialog(false)}
              className="inline-flex justify-center rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
              Cancel
            </button>
            <button form="create-client-form" type="submit"
              className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              Create
            </button>
          </>
        }
      >
        <form id="create-client-form" onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Client Name</label>
            <input type="text" required value={newClient.client_name}
              onChange={e => setNewClient({ ...newClient, client_name: e.target.value })}
              className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Redirect URIs (comma separated)</label>
            <input type="text" required value={newClient.redirect_uris}
              onChange={e => setNewClient({ ...newClient, redirect_uris: e.target.value })}
              placeholder="http://localhost:3000/callback"
              className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
        </form>
      </AdminDialog>

      {/* Edit Dialog */}
      <AdminDialog
        open={!!editingClient}
        onClose={() => setEditingClient(null)}
        title="Edit Client"
        footer={
          <>
            <button type="button" onClick={() => setEditingClient(null)}
              className="inline-flex justify-center rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
              Cancel
            </button>
            <button form="edit-client-form" type="submit"
              className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              Save
            </button>
          </>
        }
      >
        <form id="edit-client-form" onSubmit={handleEdit} className="space-y-4">
          {editError && (
            <p className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm">{editError}</p>
          )}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Client Name</label>
            <input type="text" required value={editForm.client_name}
              onChange={e => setEditForm({ ...editForm, client_name: e.target.value })}
              className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Redirect URIs (comma separated)</label>
            <textarea rows={3} required value={editForm.redirect_uris}
              onChange={e => setEditForm({ ...editForm, redirect_uris: e.target.value })}
              className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
        </form>
      </AdminDialog>
    </div>
  );
}
