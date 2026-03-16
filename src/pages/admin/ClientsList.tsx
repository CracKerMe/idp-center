import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Plus, Edit, Trash2, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { authFetch } from '../../utils/fetch';

interface Client {
  id: string;
  client_id: string;
  client_name: string;
  redirect_uris: string;
  created_at: string;
}

export default function ClientsList() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newClient, setNewClient] = useState({ client_name: '', redirect_uris: '' });
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editForm, setEditForm] = useState({ client_name: '', redirect_uris: '' });
  const [rotatedSecret, setRotatedSecret] = useState<{ clientId: string; secret: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [actionError, setActionError] = useState('');

  const fetchClients = () => {
    authFetch('/api/admin/clients')
      .then(res => res.json())
      .then(data => { setClients(data); setLoading(false); });
  };

  useEffect(() => { fetchClients(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await authFetch('/api/admin/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newClient)
    });
    if (res.ok) {
      setShowCreateForm(false);
      setNewClient({ client_name: '', redirect_uris: '' });
      fetchClients();
    }
  };

  const openEdit = (client: Client) => {
    setEditingClient(client);
    setEditForm({ client_name: client.client_name, redirect_uris: client.redirect_uris });
    setActionError('');
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient) return;
    setActionError('');
    const res = await authFetch(`/api/admin/clients/${editingClient.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm)
    });
    if (res.ok) {
      setEditingClient(null);
      fetchClients();
    } else {
      const data = await res.json();
      setActionError(data.error || 'Failed to update client');
    }
  };

  const handleDelete = async (client: Client) => {
    if (!confirm(`Delete client "${client.client_name}"? This cannot be undone.`)) return;
    const res = await authFetch(`/api/admin/clients/${client.id}`, {
      method: 'DELETE',
    });
    if (res.ok) fetchClients();
    else alert('Failed to delete client');
  };

  const handleRotateSecret = async (client: Client) => {
    if (!confirm(`Rotate secret for "${client.client_name}"? The old secret will stop working immediately.`)) return;
    const res = await authFetch(`/api/admin/clients/${client.id}/rotate-secret`, {
      method: 'POST',
    });
    if (res.ok) {
      const data = await res.json();
      setRotatedSecret({ clientId: client.client_id, secret: data.client_secret });
      setShowSecret(false);
    } else {
      alert('Failed to rotate secret');
    }
  };

  if (loading) return <div>Loading clients...</div>;

  return (
    <div className="bg-white shadow overflow-hidden sm:rounded-lg">
      <div className="px-4 py-5 sm:px-6 flex justify-between items-center">
        <h3 className="text-lg leading-6 font-medium text-zinc-900">OAuth Clients</h3>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
        >
          <Plus className="-ml-0.5 mr-2 h-4 w-4" />
          New Client
        </button>
      </div>

      {/* New secret banner */}
      {rotatedSecret && (
        <div className="border-t border-yellow-200 bg-yellow-50 px-4 py-4 sm:px-6">
          <p className="text-sm font-medium text-yellow-800 mb-2">
            New secret for client <span className="font-mono">{rotatedSecret.clientId}</span> — copy it now, it won't be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-yellow-300 rounded px-3 py-1 text-sm font-mono break-all">
              {showSecret ? rotatedSecret.secret : '•'.repeat(40)}
            </code>
            <button onClick={() => setShowSecret(s => !s)} className="text-yellow-700 hover:text-yellow-900">
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            <button onClick={() => setRotatedSecret(null)} className="text-yellow-700 hover:text-yellow-900 text-xs underline">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {showCreateForm && (
        <div className="border-t border-zinc-200 px-4 py-5 sm:p-6 bg-zinc-50">
          <form onSubmit={handleCreate} className="space-y-4 max-w-lg">
            <div>
              <label className="block text-sm font-medium text-zinc-700">Client Name</label>
              <input type="text" required value={newClient.client_name}
                onChange={e => setNewClient({ ...newClient, client_name: e.target.value })}
                className="mt-1 block w-full border border-zinc-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700">Redirect URIs (comma separated)</label>
              <input type="text" required value={newClient.redirect_uris}
                onChange={e => setNewClient({ ...newClient, redirect_uris: e.target.value })}
                placeholder="http://localhost:3000/callback"
                className="mt-1 block w-full border border-zinc-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => setShowCreateForm(false)}
                className="mr-3 bg-white py-2 px-4 border border-zinc-300 rounded-md shadow-sm text-sm font-medium text-zinc-700 hover:bg-zinc-50">
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

      <div className="border-t border-zinc-200">
        <table className="min-w-full divide-y divide-zinc-200">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Client ID</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Redirect URIs</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Created</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-zinc-200">
            {clients.map((client) => (
              <tr key={client.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-zinc-900">{client.client_name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 font-mono">{client.client_id}</td>
                <td className="px-6 py-4 text-sm text-zinc-500 break-all max-w-xs">{client.redirect_uris}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500">
                  {format(new Date(client.created_at), 'MMM d, yyyy HH:mm')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => openEdit(client)} title="Edit client"
                      className="text-indigo-600 hover:text-indigo-900">
                      <Edit className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleRotateSecret(client)} title="Rotate secret"
                      className="text-yellow-600 hover:text-yellow-900">
                      <RefreshCw className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleDelete(client)} title="Delete client"
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
      {editingClient && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-zinc-500 bg-opacity-75 transition-opacity" onClick={() => setEditingClient(null)} />
            <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-md sm:w-full sm:p-6 relative z-10">
              <form onSubmit={handleEdit}>
                <h3 className="text-lg font-medium text-zinc-900 mb-4">Edit Client</h3>
                {actionError && (
                  <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">{actionError}</div>
                )}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700">Client Name</label>
                    <input type="text" required value={editForm.client_name}
                      onChange={e => setEditForm({ ...editForm, client_name: e.target.value })}
                      className="mt-1 block w-full border border-zinc-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700">Redirect URIs (comma separated)</label>
                    <textarea rows={3} required value={editForm.redirect_uris}
                      onChange={e => setEditForm({ ...editForm, redirect_uris: e.target.value })}
                      className="mt-1 block w-full border border-zinc-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                  </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                  <button type="button" onClick={() => setEditingClient(null)}
                    className="inline-flex justify-center rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50">
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
