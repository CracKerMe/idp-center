import { Client } from 'ldapts';
import { config as appConfig } from '../config.js';

export interface LdapIdpConfig {
  url: string;                    // ldaps://host:636 (required in production)
  bindDN: string;                 // service account used to search for the user
  bindPassword: string;
  baseDN: string;
  userFilter?: string;            // e.g. '(uid={{username}})' — {{username}} is escaped before substitution
  usernameAttribute?: string;     // default 'uid'
  emailAttribute?: string;        // default 'mail'
  displayNameAttribute?: string;  // default 'cn'
  groupBaseDN?: string;
  groupFilter?: string;           // e.g. '(member={{userDN}})'
  groupNameAttribute?: string;    // default 'cn'
  timeoutMs?: number;
}

export interface LdapAuthResult {
  dn: string;
  username: string;
  email: string | null;
  displayName: string | null;
  groups: string[];
}

/** Escapes a value for safe interpolation into an LDAP filter (RFC 4515 §3). */
function ldapEscape(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

function renderFilter(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => ldapEscape(vars[key] ?? ''));
}

function firstAttr(entry: Record<string, unknown>, key: string): string | null {
  const value = entry[key];
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
  if (value == null) return null;
  return String(value);
}

function assertLdaps(url: string): void {
  if (appConfig.NODE_ENV === 'production' && !url.startsWith('ldaps://')) {
    throw new Error('LDAP identity providers must use ldaps:// in production');
  }
}

async function withClient<T>(url: string, timeoutMs: number, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ url, timeout: timeoutMs, connectTimeout: timeoutMs });
  try {
    return await fn(client);
  } finally {
    await client.unbind().catch(() => {});
  }
}

/**
 * Search-then-bind LDAP authentication: bind as the configured service account to locate
 * the user's DN, then re-bind as that DN with the presented password to verify it. This is
 * the standard pattern for directories (like Active Directory) where the login name isn't
 * itself a valid bind DN.
 */
export async function authenticateLdap(cfg: LdapIdpConfig, username: string, password: string): Promise<LdapAuthResult | null> {
  assertLdaps(cfg.url);
  const timeoutMs = cfg.timeoutMs ?? 5000;
  const usernameAttr = cfg.usernameAttribute || 'uid';
  const emailAttr = cfg.emailAttribute || 'mail';
  const nameAttr = cfg.displayNameAttribute || 'cn';

  const found = await withClient(cfg.url, timeoutMs, async (client) => {
    await client.bind(cfg.bindDN, cfg.bindPassword);

    const filter = renderFilter(cfg.userFilter || `(${usernameAttr}={{username}})`, { username });
    const { searchEntries } = await client.search(cfg.baseDN, {
      scope: 'sub',
      filter,
      attributes: [usernameAttr, emailAttr, nameAttr],
    });

    return searchEntries[0] ?? null;
  });

  if (!found) return null;
  const userDN = found.dn;

  // A failed bind throws — that's the actual "wrong password" signal.
  const passwordOk = await withClient(cfg.url, timeoutMs, async (client) => {
    try {
      await client.bind(userDN, password);
      return true;
    } catch {
      return false;
    }
  });
  if (!passwordOk) return null;

  let groups: string[] = [];
  if (cfg.groupBaseDN && cfg.groupFilter) {
    const groupNameAttr = cfg.groupNameAttribute || 'cn';
    groups = await withClient(cfg.url, timeoutMs, async (client) => {
      await client.bind(cfg.bindDN, cfg.bindPassword);
      const filter = renderFilter(cfg.groupFilter!, { userDN, username });
      const { searchEntries } = await client.search(cfg.groupBaseDN!, {
        scope: 'sub',
        filter,
        attributes: [groupNameAttr],
      });
      return searchEntries.map(e => firstAttr(e, groupNameAttr)).filter((g): g is string => !!g);
    });
  }

  return {
    dn: userDN,
    username: firstAttr(found, usernameAttr) || username,
    email: firstAttr(found, emailAttr),
    displayName: firstAttr(found, nameAttr),
    groups,
  };
}
