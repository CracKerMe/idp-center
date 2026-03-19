import React, { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Building, Plus, Edit, Trash2, Search, MoreVertical, CheckCircle, XCircle } from 'lucide-react';
import { authFetch, parseApiResponse, isSuccess, getErrorMessage } from '../../utils/fetch';

interface Tenant {
  id: string;
  name: string;
  domain: string | null;
  is_active: number;
  settings: string;
  created_at: string;
}

export default function TenantsList() {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState({ name: '', domain: '', settings: '{}' });
  const [error, setError] = useState('');

  useEffect(() => {
    fetchTenants();
  }, []);

  const fetchTenants = async () => {
    try {
      const res = await authFetch('/api/admin/tenants');
      const result = await parseApiResponse(res);
      if (isSuccess(result) && result.data) {
        setTenants(Array.isArray(result.data) ? result.data : []);
      }
    } catch (err) {
      console.error('Failed to fetch tenants');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const url = editingTenant ? `/api/admin/tenants/${editingTenant.id}` : '/api/admin/tenants';
    const method = editingTenant ? 'PUT' : 'POST';

    try {
      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          domain: formData.domain,
          is_active: editingTenant ? editingTenant.is_active : true,
          settings: JSON.parse(formData.settings || '{}')
        })
      });

      const result = await parseApiResponse(res);
      if (isSuccess(result)) {
        setShowModal(false);
        setEditingTenant(null);
        setFormData({ name: '', domain: '', settings: '{}' });
        fetchTenants();
      } else {
        setError(getErrorMessage(result));
      }
    } catch (err) {
      setError('Network error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this tenant? Users will be moved to default tenant.')) {
      return;
    }

    try {
      const res = await authFetch(`/api/admin/tenants/${id}`, {
        method: 'DELETE',
      });

      const result = await parseApiResponse(res);
      if (isSuccess(result)) {
        fetchTenants();
      } else {
        alert(getErrorMessage(result));
      }
    } catch (err) {
      alert('Network error');
    }
  };

  const openEdit = (tenant: Tenant) => {
    setEditingTenant(tenant);
    setFormData({
      name: tenant.name,
      domain: tenant.domain || '',
      settings: tenant.settings || '{}'
    });
    setShowModal(true);
  };

  const filteredTenants = tenants.filter(t =>
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (t.domain && t.domain.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div>
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">Tenants</h1>
          <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-400">
            Manage your organization's tenants and domains.
          </p>
        </div>
        <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
          <button
            onClick={() => {
              setEditingTenant(null);
              setFormData({ name: '', domain: '', settings: '{}' });
              setShowModal(true);
            }}
            className="inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Tenant
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mt-4 relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-zinc-400" />
        <input
          type="text"
          placeholder="Search tenants..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 w-full max-w-md px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        />
      </div>

      {/* Table */}
      <div className="mt-6 flex flex-col">
        <div className="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
              <table className="min-w-full divide-y divide-zinc-300 dark:divide-zinc-700">
                <thead className="bg-zinc-50 dark:bg-zinc-800">
                  <tr>
                    <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-zinc-900 dark:text-white sm:pl-6">Name</th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-zinc-900 dark:text-white">Domain</th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-zinc-900 dark:text-white">Status</th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-zinc-900 dark:text-white">Created</th>
                    <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700 bg-white dark:bg-zinc-900">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">Loading...</td>
                    </tr>
                  ) : filteredTenants.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No tenants found</td>
                    </tr>
                  ) : (
                    filteredTenants.map((tenant) => (
                      <tr key={tenant.id}>
                        <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-zinc-900 dark:text-white sm:pl-6">
                          <div className="flex items-center">
                            <Building className="h-5 w-5 text-zinc-400 mr-2" />
                            {tenant.name}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-zinc-500 dark:text-zinc-400">{tenant.domain || '-'}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm">
                          {tenant.is_active ? (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                              <CheckCircle className="h-3 w-3 mr-1" /> Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-300">
                              <XCircle className="h-3 w-3 mr-1" /> Inactive
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-zinc-500 dark:text-zinc-400">
                          {new Date(tenant.created_at).toLocaleDateString()}
                        </td>
                        <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => openEdit(tenant)}
                              className="text-indigo-600 hover:text-indigo-900"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            {tenant.id !== 'default' && (
                              <button
                                onClick={() => handleDelete(tenant.id)}
                                className="text-red-600 hover:text-red-900"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div 
              className="fixed inset-0 bg-zinc-500 bg-opacity-75 transition-opacity" 
              onClick={() => setShowModal(false)} 
            />
            
            <div className="inline-block align-bottom bg-white dark:bg-zinc-900 rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6 relative z-10">
              <form onSubmit={handleSubmit}>
                <h3 className="text-lg font-medium text-zinc-900 dark:text-white mb-4">
                  {editingTenant ? 'Edit Tenant' : 'Add Tenant'}
                </h3>

                {error && (
                  <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm">
                    {error}
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Tenant Name *</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="mt-1 block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Domain</label>
                    <input
                      type="text"
                      value={formData.domain}
                      onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                      placeholder="example.com"
                      className="mt-1 block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                  </div>

                  {editingTenant && (
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="is_active"
                        checked={editingTenant.is_active === 1}
                        onChange={(e) => {
                          const tenant = { ...editingTenant, is_active: e.target.checked ? 1 : 0 };
                          setEditingTenant(tenant);
                        }}
                        className="h-4 w-4 text-indigo-600 border-zinc-300 rounded focus:ring-indigo-500"
                      />
                      <label htmlFor="is_active" className="ml-2 block text-sm text-zinc-900 dark:text-white">
                        Active
                      </label>
                    </div>
                  )}
                </div>

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="inline-flex justify-center rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
                  >
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
