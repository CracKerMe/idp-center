import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Plus, Edit, Trash2, CheckCircle, XCircle, ExternalLink } from 'lucide-react';
import { authFetch, parseApiResponse, isSuccess, getErrorMessage } from '../../utils/fetch';
import AdminTable from '../../components/admin/AdminTable';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import AdminDialog from '../../components/admin/AdminDialog';

type IdpType = 'saml' | 'oidc' | 'ldap';

interface IdentityProvider {
  id: string;
  alias: string;
  type: IdpType;
  displayName: string;
  enabled: boolean;
  config: Record<string, any>;
  jitProvisioning: boolean;
  linkByVerifiedEmail: boolean;
  emailDomains: string | null;
  createdAt: string;
}

interface FormState {
  alias: string;
  type: IdpType;
  displayName: string;
  enabled: boolean;
  jitProvisioning: boolean;
  linkByVerifiedEmail: boolean;
  emailDomains: string;
  // oidc
  issuer: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  // saml
  entryPoint: string;
  idpCert: string;
  idpIssuer: string;
  // ldap
  url: string;
  bindDN: string;
  bindPassword: string;
  baseDN: string;
  userFilter: string;
}

const EMPTY_FORM: FormState = {
  alias: '', type: 'oidc', displayName: '', enabled: true, jitProvisioning: true, linkByVerifiedEmail: true, emailDomains: '',
  issuer: '', clientId: '', clientSecret: '', scope: 'openid profile email',
  entryPoint: '', idpCert: '', idpIssuer: '',
  url: 'ldaps://', bindDN: '', bindPassword: '', baseDN: '', userFilter: '(uid={{username}})',
};

function formToConfig(f: FormState): Record<string, any> {
  if (f.type === 'oidc') return { issuer: f.issuer, clientId: f.clientId, clientSecret: f.clientSecret, scope: f.scope };
  if (f.type === 'saml') return { entryPoint: f.entryPoint, idpCert: f.idpCert, idpIssuer: f.idpIssuer || undefined };
  return { url: f.url, bindDN: f.bindDN, bindPassword: f.bindPassword, baseDN: f.baseDN, userFilter: f.userFilter };
}

function configToForm(idp: IdentityProvider): Partial<FormState> {
  const c = idp.config || {};
  return {
    issuer: c.issuer || '', clientId: c.clientId || '', clientSecret: c.clientSecret || '', scope: c.scope || 'openid profile email',
    entryPoint: c.entryPoint || '', idpCert: c.idpCert || '', idpIssuer: c.idpIssuer || '',
    url: c.url || 'ldaps://', bindDN: c.bindDN || '', bindPassword: c.bindPassword || '', baseDN: c.baseDN || '', userFilter: c.userFilter || '(uid={{username}})',
  };
}

function TypeFields({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  const input = 'mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500';
  const label = 'block text-sm font-medium text-zinc-700 dark:text-zinc-300';

  if (form.type === 'oidc') {
    return (
      <>
        <div><label className={label}>Issuer URL</label>
          <input className={input} required placeholder="https://accounts.example.com" value={form.issuer} onChange={e => setForm({ ...form, issuer: e.target.value })} /></div>
        <div><label className={label}>Client ID</label>
          <input className={input} required value={form.clientId} onChange={e => setForm({ ...form, clientId: e.target.value })} /></div>
        <div><label className={label}>Client Secret</label>
          <input className={input} type="password" required value={form.clientSecret} onChange={e => setForm({ ...form, clientSecret: e.target.value })} placeholder="••••••••" /></div>
        <div><label className={label}>Scope</label>
          <input className={input} value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value })} /></div>
      </>
    );
  }
  if (form.type === 'saml') {
    return (
      <>
        <div><label className={label}>IdP SSO URL (entryPoint)</label>
          <input className={input} required placeholder="https://idp.example.com/sso/saml" value={form.entryPoint} onChange={e => setForm({ ...form, entryPoint: e.target.value })} /></div>
        <div><label className={label}>IdP Signing Certificate (PEM)</label>
          <textarea className={input} rows={5} required placeholder="-----BEGIN CERTIFICATE-----" value={form.idpCert} onChange={e => setForm({ ...form, idpCert: e.target.value })} /></div>
        <div><label className={label}>IdP Issuer (optional)</label>
          <input className={input} value={form.idpIssuer} onChange={e => setForm({ ...form, idpIssuer: e.target.value })} /></div>
      </>
    );
  }
  return (
    <>
      <div><label className={label}>LDAP URL</label>
        <input className={input} required placeholder="ldaps://ldap.example.com:636" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} /></div>
      <div><label className={label}>Bind DN (service account)</label>
        <input className={input} required placeholder="cn=svc,dc=example,dc=com" value={form.bindDN} onChange={e => setForm({ ...form, bindDN: e.target.value })} /></div>
      <div><label className={label}>Bind Password</label>
        <input className={input} type="password" required value={form.bindPassword} onChange={e => setForm({ ...form, bindPassword: e.target.value })} placeholder="••••••••" /></div>
      <div><label className={label}>Base DN</label>
        <input className={input} required placeholder="ou=people,dc=example,dc=com" value={form.baseDN} onChange={e => setForm({ ...form, baseDN: e.target.value })} /></div>
      <div><label className={label}>User Filter</label>
        <input className={input} value={form.userFilter} onChange={e => setForm({ ...form, userFilter: e.target.value })} /></div>
    </>
  );
}

export default function IdentityProviders() {
  const [idps, setIdps] = useState<IdentityProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState<IdentityProvider | null>(null);
  const [formError, setFormError] = useState('');

  const fetchIdps = () => {
    setLoading(true);
    authFetch('/api/admin/idps')
      .then(res => parseApiResponse<IdentityProvider[]>(res))
      .then(result => { if (isSuccess(result) && result.data) setIdps(result.data); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchIdps(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const res = await authFetch('/api/admin/idps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alias: form.alias,
        type: form.type,
        displayName: form.displayName,
        enabled: form.enabled,
        jitProvisioning: form.jitProvisioning,
        linkByVerifiedEmail: form.linkByVerifiedEmail,
        emailDomains: form.emailDomains || undefined,
        config: formToConfig(form),
      }),
    });
    const result = await parseApiResponse(res);
    if (isSuccess(result)) {
      setShowCreate(false);
      setForm(EMPTY_FORM);
      fetchIdps();
    } else {
      setFormError(getErrorMessage(result));
    }
  };

  const openEdit = (idp: IdentityProvider) => {
    setEditing(idp);
    setForm({
      ...EMPTY_FORM,
      alias: idp.alias,
      type: idp.type,
      displayName: idp.displayName,
      enabled: idp.enabled,
      jitProvisioning: idp.jitProvisioning,
      linkByVerifiedEmail: idp.linkByVerifiedEmail,
      emailDomains: idp.emailDomains || '',
      ...configToForm(idp),
    });
    setFormError('');
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setFormError('');
    const res = await authFetch(`/api/admin/idps/${editing.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: form.displayName,
        enabled: form.enabled,
        jitProvisioning: form.jitProvisioning,
        linkByVerifiedEmail: form.linkByVerifiedEmail,
        emailDomains: form.emailDomains || undefined,
        config: formToConfig(form),
      }),
    });
    const result = await parseApiResponse(res);
    if (isSuccess(result)) { setEditing(null); fetchIdps(); }
    else setFormError(getErrorMessage(result));
  };

  const handleDelete = async (idp: IdentityProvider) => {
    if (!confirm(`Delete identity provider "${idp.displayName}"? This cannot be undone.`)) return;
    const res = await authFetch(`/api/admin/idps/${idp.id}`, { method: 'DELETE' });
    const result = await parseApiResponse(res);
    if (isSuccess(result)) fetchIdps();
    else alert(getErrorMessage(result));
  };

  const metadataUrl = (idp: IdentityProvider) => `/api/federation/${idp.alias}/saml/metadata`;

  return (
    <div className="bg-white dark:bg-zinc-900 shadow overflow-hidden sm:rounded-lg">
      <AdminPageHeader
        title="Identity Providers"
        actions={
          <button
            onClick={() => { setForm(EMPTY_FORM); setFormError(''); setShowCreate(true); }}
            className="inline-flex w-full sm:w-auto justify-center items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            <Plus className="-ml-0.5 mr-2 h-4 w-4" />
            New Provider
          </button>
        }
      />

      <AdminTable minWidthClass="min-w-230">
        <thead className="bg-zinc-50 dark:bg-zinc-800">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Name</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Type</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Alias</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Created</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-700">
          {loading ? (
            <tr><td colSpan={6} className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">Loading...</td></tr>
          ) : idps.length === 0 ? (
            <tr><td colSpan={6} className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No identity providers configured</td></tr>
          ) : idps.map(idp => (
            <tr key={idp.id}>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-zinc-900 dark:text-white">{idp.displayName}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400 uppercase">{idp.type}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400 font-mono">
                {idp.alias}
                {idp.type === 'saml' && (
                  <a href={metadataUrl(idp)} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center text-indigo-500 hover:text-indigo-400" title="SP metadata">
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                {idp.enabled ? (
                  <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400"><CheckCircle className="h-4 w-4" /> Enabled</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-zinc-400"><XCircle className="h-4 w-4" /> Disabled</span>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                {format(new Date(idp.createdAt), 'MMM d, yyyy HH:mm')}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <div className="flex justify-end gap-2">
                  <button onClick={() => openEdit(idp)} title="Edit provider" className="text-indigo-600 hover:text-indigo-900"><Edit className="h-4 w-4" /></button>
                  <button onClick={() => handleDelete(idp)} title="Delete provider" className="text-zinc-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </AdminTable>

      <AdminDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New Identity Provider"
        footer={
          <>
            <button type="button" onClick={() => setShowCreate(false)}
              className="inline-flex justify-center rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
              Cancel
            </button>
            <button form="create-idp-form" type="submit"
              className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              Create
            </button>
          </>
        }
      >
        <form id="create-idp-form" onSubmit={handleCreate} className="space-y-4">
          {formError && <p className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm">{formError}</p>}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Type</label>
            <select className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm py-2 px-3 text-sm"
              value={form.type} onChange={e => setForm({ ...form, type: e.target.value as IdpType })}>
              <option value="oidc">OIDC</option>
              <option value="saml">SAML 2.0</option>
              <option value="ldap">LDAP / Active Directory</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Alias (URL segment)</label>
            <input className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm py-2 px-3 text-sm font-mono"
              required pattern="[a-z0-9-]+" placeholder="okta" value={form.alias} onChange={e => setForm({ ...form, alias: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Display Name</label>
            <input className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm py-2 px-3 text-sm"
              required placeholder="Okta" value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} />
          </div>

          <TypeFields form={form} setForm={setForm} />

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email domains for auto-routing (comma separated, optional)</label>
            <input className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm py-2 px-3 text-sm"
              placeholder="example.com" value={form.emailDomains} onChange={e => setForm({ ...form, emailDomains: e.target.value })} />
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} /> Enabled
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={form.jitProvisioning} onChange={e => setForm({ ...form, jitProvisioning: e.target.checked })} /> Auto-create accounts (JIT)
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={form.linkByVerifiedEmail} onChange={e => setForm({ ...form, linkByVerifiedEmail: e.target.checked })} /> Link by verified email
            </label>
          </div>
        </form>
      </AdminDialog>

      <AdminDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.displayName || ''}`}
        footer={
          <>
            <button type="button" onClick={() => setEditing(null)}
              className="inline-flex justify-center rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
              Cancel
            </button>
            <button form="edit-idp-form" type="submit"
              className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              Save
            </button>
          </>
        }
      >
        <form id="edit-idp-form" onSubmit={handleEdit} className="space-y-4">
          {formError && <p className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm">{formError}</p>}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Secret fields show as dots — leave them as-is to keep the current value, or type a new one to replace it.</p>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Display Name</label>
            <input className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm py-2 px-3 text-sm"
              required value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} />
          </div>

          <TypeFields form={form} setForm={setForm} />

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email domains for auto-routing (comma separated, optional)</label>
            <input className="mt-1 block w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm py-2 px-3 text-sm"
              value={form.emailDomains} onChange={e => setForm({ ...form, emailDomains: e.target.value })} />
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} /> Enabled
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={form.jitProvisioning} onChange={e => setForm({ ...form, jitProvisioning: e.target.checked })} /> Auto-create accounts (JIT)
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={form.linkByVerifiedEmail} onChange={e => setForm({ ...form, linkByVerifiedEmail: e.target.checked })} /> Link by verified email
            </label>
          </div>
        </form>
      </AdminDialog>
    </div>
  );
}
