import React, { useState, useEffect } from 'react';
import { Building, Plus, Edit, Trash2, Search, CheckCircle, XCircle } from 'lucide-react';
import { authFetch, parseApiResponse, isSuccess, getErrorMessage } from '../../utils/fetch';
import AdminTable from '../../components/admin/AdminTable';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import AdminDialog from '../../components/admin/AdminDialog';

interface Tenant {
  id: string;
  name: string;
  domain: string | null;
  isActive: number;
  settings: string;
  createdAt: string;
}

export default function TenantsList() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState({ name: '', domain: '', settings: '{}' });
  const [formError, setFormError] = useState('');

  useEffect(() => { fetchTenants(); }, []);

  const fetchTenants = async () => {
    try {
      const res = await authFetch('/api/admin/tenants');
      const result = await parseApiResponse(res);
      if (isSuccess(result) && result.data) setTenants(Array.isArray(result.data) ? result.data : []);
    } catch {
      console.error('Failed to fetch tenants');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingTenant(null);
    setFormData({ name: '', domain: '', settings: '{}' });
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (tenant: Tenant) => {
    setEditingTenant(tenant);
    setFormData({ name: tenant.name, domain: tenant.domain || '', settings: tenant.settings || '{}' });
    setFormError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const url = editingTenant ? `/api/admin/tenants/${editingTenant.id}` : '/api/admin/tenants';
    const method = editingTenant ? 'PUT' : 'POST';
    try {
      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          domain: formData.domain,
          is_active: editingTenant ? editingTenant.isActive : true,
          settings: JSON.parse(formData.settings || '{}'),
        }),
      });
      const result = await parseApiResponse(res);
      if (isSuccess(result)) {
        setShowModal(false);
        setEditingTenant(null);
        fetchTenants();
      } else {
        setFormError(getErrorMessage(result));
      }
    } catch {
      setFormError('Network error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this tenant? Users will be moved to default tenant.')) return;
    try {
      const res = await authFetch(`/api/admin/tenants/${id}`, { method: 'DELETE' });
      const result = await parseApiResponse(res);
      if (isSuccess(result)) fetchTenants();
      else alert(getErrorMessage(result));
    } catch {
      alert('Network error');
    }
  };

  const filteredTenants = tenants.filter(t =>
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (t.domain && t.domain.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="bg-white dark:bg-zinc-900 shadow overflow-hidden sm:rounded-lg">
      {/* Header */}
      <AdminPageHeader
        title="Tenants"
        description="Manage your organization's tenants and domains."
        actions={
          <button
            onClick={openCreate}
            className="inline-flex w-full sm:w-auto justify-center items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            <Plus className="-ml-0.5 mr-2 h-4 w-4" />
            Add Tenant
          </button>
        }
      />

      {/* Search toolbar */}
      <div className="border-t border-zinc-200 dark:border-zinc-700 px-4 py-3 sm:px-6 bg-zinc-50 dark:bg-zinc-800">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Search tenants..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9 w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white rounded-md shadow-sm py-1.5 px-3 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Table */}
      <AdminTable minWidthClass="min-w-190">
        <thead className="bg-zinc-50 dark:bg-zinc-800">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Name</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Domain</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Created</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-700">
          {loading ? (
            <tr><td colSpan={5} className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">Loading...</td></tr>
          ) : filteredTenants.length === 0 ? (
            <tr><td colSpan={5} className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No tenants found</td></tr>
          ) : filteredTenants.map(tenant => (
            <tr key={tenant.id}>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-zinc-900 dark:text-white">
                <div className="flex items-center gap-2">
                  <Building className="h-4 w-4 text-zinc-400" />
                  {tenant.name}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{tenant.domain || '-'}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                {tenant.isActive ? (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                    <CheckCircle className="h-3 w-3 mr-1" /> Active
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-300">
                    <XCircle className="h-3 w-3 mr-1" /> Inactive
                  </span>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                {tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : '-'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <div className="flex justify-end gap-2">
                  <button onClick={() => openEdit(tenant)} className="text-indigo-600 hover:text-indigo-900"><Edit className="h-4 w-4" /></button>
                  {tenant.id !== 'default' && (
                    <button onClick={() => handleDelete(tenant.id)} className="text-zinc-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </AdminTable>

      {/* Create / Edit Dialog */}
      <AdminDialog
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editingTenant ? 'Edit Tenant' : 'Add Tenant'}
        footer={
          <>
            <button type="button" onClick={() => setShowModal(false)}
              className="inline-flex justify-center rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
              Cancel
            </button>
            <button form="tenant-form" type="submit"
              className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              Save
            </button>
          </>
        }
      >
        <form id="tenant-form" onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <p className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm">{formError}</p>
          )}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Tenant Name *</label>
            <input type="text" required value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Domain</label>
            <input type="text" value={formData.domain}
              onChange={e => setFormData({ ...formData, domain: e.target.value })}
              placeholder="example.com"
              className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          {editingTenant && (
            <div className="flex items-center">
              <input type="checkbox" id="is_active" checked={editingTenant.isActive === 1}
                onChange={e => setEditingTenant({ ...editingTenant, isActive: e.target.checked ? 1 : 0 })}
                className="h-4 w-4 text-indigo-600 border-zinc-300 rounded focus:ring-indigo-500" />
              <label htmlFor="is_active" className="ml-2 text-sm text-zinc-900 dark:text-white">Active</label>
            </div>
          )}
        </form>
      </AdminDialog>
    </div>
  );
}
