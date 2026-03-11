import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Plus } from 'lucide-react';

export default function ClientsList() {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newClient, setNewClient] = useState({ client_name: '', redirect_uris: '' });

  const fetchClients = () => {
    fetch('/api/admin/clients', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    .then(res => res.json())
    .then(data => {
      setClients(data);
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/admin/clients', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify(newClient)
    });
    if (res.ok) {
      setShowForm(false);
      setNewClient({ client_name: '', redirect_uris: '' });
      fetchClients();
    }
  };

  if (loading) return <div>Loading clients...</div>;

  return (
    <div className="bg-white shadow overflow-hidden sm:rounded-lg">
      <div className="px-4 py-5 sm:px-6 flex justify-between items-center">
        <h3 className="text-lg leading-6 font-medium text-zinc-900">OAuth Clients</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
        >
          <Plus className="-ml-0.5 mr-2 h-4 w-4" />
          New Client
        </button>
      </div>
      
      {showForm && (
        <div className="border-t border-zinc-200 px-4 py-5 sm:p-6 bg-zinc-50">
          <form onSubmit={handleCreate} className="space-y-4 max-w-lg">
            <div>
              <label className="block text-sm font-medium text-zinc-700">Client Name</label>
              <input
                type="text"
                required
                value={newClient.client_name}
                onChange={e => setNewClient({...newClient, client_name: e.target.value})}
                className="mt-1 block w-full border border-zinc-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700">Redirect URIs (comma separated)</label>
              <input
                type="text"
                required
                value={newClient.redirect_uris}
                onChange={e => setNewClient({...newClient, redirect_uris: e.target.value})}
                className="mt-1 block w-full border border-zinc-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="http://localhost:5986/callback"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="mr-3 bg-white py-2 px-4 border border-zinc-300 rounded-md shadow-sm text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
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
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Name</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Client ID</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Redirect URIs</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Created</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-zinc-200">
            {clients.map((client) => (
              <tr key={client.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-zinc-900">{client.client_name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 font-mono">{client.client_id}</td>
                <td className="px-6 py-4 text-sm text-zinc-500 break-all">{client.redirect_uris}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500">
                  {format(new Date(client.created_at), 'MMM d, yyyy HH:mm')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
