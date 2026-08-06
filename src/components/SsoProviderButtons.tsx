import { useEffect, useState } from 'react';
import { parseApiResponse, isSuccess } from '../utils/fetch';
import type { AuthUser } from '../types/user';

interface IdpOption {
  alias: string;
  type: 'saml' | 'oidc' | 'ldap';
  displayName: string;
}

interface LdapLoginResult {
  access_token: string;
  refresh_token: string;
  session_id?: string;
  user?: AuthUser;
}

export function SsoProviderButtons({
  redirect,
  onLdapSuccess,
  onError,
}: {
  redirect?: string;
  onLdapSuccess: (data: LdapLoginResult) => void;
  onError: (message: string) => void;
}) {
  const [providers, setProviders] = useState<IdpOption[]>([]);
  const [ldapAlias, setLdapAlias] = useState<string | null>(null);
  const [ldapUsername, setLdapUsername] = useState('');
  const [ldapPassword, setLdapPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth/idps')
      .then(res => parseApiResponse<{ providers: IdpOption[] }>(res))
      .then(result => {
        if (isSuccess(result) && result.data) setProviders(result.data.providers);
      })
      .catch(() => {});
  }, []);

  if (providers.length === 0) return null;

  const tenantId = typeof window !== 'undefined' ? localStorage.getItem('tenant_id') : null;

  function federationHref(alias: string, type: 'saml' | 'oidc') {
    const params = new URLSearchParams();
    if (redirect) params.set('redirect', redirect);
    if (tenantId) params.set('tenant_id', tenantId);
    const qs = params.toString();
    return `/api/federation/${alias}/${type}/login${qs ? `?${qs}` : ''}`;
  }

  async function handleLdapSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ldapAlias) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/federation/${ldapAlias}/ldap/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
        },
        body: JSON.stringify({ username: ldapUsername, password: ldapPassword }),
      });
      const result = await parseApiResponse<LdapLoginResult>(res);
      if (isSuccess(result) && result.data) {
        onLdapSuccess(result.data);
      } else {
        onError(result.error || 'Sign-in failed');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-zinc-300 dark:border-zinc-700" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400">Or sign in with</span>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {providers.filter(p => p.type !== 'ldap').map(p => (
          <a
            key={p.alias}
            href={federationHref(p.alias, p.type as 'saml' | 'oidc')}
            className="w-full flex justify-center items-center gap-2 py-2 px-4 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-sm text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700"
          >
            {p.displayName}
          </a>
        ))}

        {providers.filter(p => p.type === 'ldap').map(p => (
          <div key={p.alias}>
            {ldapAlias === p.alias ? (
              <form onSubmit={handleLdapSubmit} className="space-y-2 border border-zinc-200 dark:border-zinc-700 rounded-md p-3">
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="Username"
                  value={ldapUsername}
                  onChange={(e) => setLdapUsername(e.target.value)}
                  className="block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm sm:text-sm"
                />
                <input
                  type="password"
                  required
                  placeholder="Password"
                  value={ldapPassword}
                  onChange={(e) => setLdapPassword(e.target.value)}
                  className="block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-md shadow-sm sm:text-sm"
                />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setLdapAlias(null)} className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400">
                    Cancel
                  </button>
                  <button type="submit" disabled={busy} className="py-1.5 px-3 rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                    Sign in
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => { setLdapAlias(p.alias); setLdapUsername(''); setLdapPassword(''); }}
                className="w-full flex justify-center items-center gap-2 py-2 px-4 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-sm text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700"
              >
                {p.displayName}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
