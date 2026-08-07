import { describe, it, expect, vi, beforeEach } from 'vitest';

const bindMock = vi.fn();
const searchMock = vi.fn();
const unbindMock = vi.fn().mockResolvedValue(undefined);

vi.mock('ldapts', () => ({
  Client: vi.fn().mockImplementation(function (this: any) {
    this.bind = bindMock;
    this.search = searchMock;
    this.unbind = unbindMock;
  }),
}));

import { authenticateLdap, type LdapIdpConfig } from '../server/services/ldap.service.js';

const baseCfg: LdapIdpConfig = {
  url: 'ldap://localhost:389',
  bindDN: 'cn=service,dc=example,dc=com',
  bindPassword: 'svc-pass',
  baseDN: 'dc=example,dc=com',
};

describe('ldap.service authenticateLdap', () => {
  beforeEach(() => {
    bindMock.mockReset().mockResolvedValue(undefined);
    searchMock.mockReset();
    unbindMock.mockClear();
  });

  it('rejects an empty password without ever attempting the credential bind (anonymous-bind bypass guard)', async () => {
    searchMock.mockResolvedValueOnce({
      searchEntries: [{ dn: 'uid=alice,dc=example,dc=com', uid: 'alice', mail: 'alice@example.com', cn: 'Alice' }],
    });

    const result = await authenticateLdap(baseCfg, 'alice', '');
    expect(result).toBeNull();

    // Only the service-account bind (for the search) should have happened — never a second
    // bind with the empty password, which LDAP servers treat as an anonymous bind = success.
    expect(bindMock).toHaveBeenCalledTimes(1);
    expect(bindMock).toHaveBeenCalledWith(baseCfg.bindDN, baseCfg.bindPassword);
  });

  it('returns null when the user is not found by search, without attempting any credential bind', async () => {
    searchMock.mockResolvedValueOnce({ searchEntries: [] });

    const result = await authenticateLdap(baseCfg, 'ghost', 'whatever');
    expect(result).toBeNull();
    expect(bindMock).toHaveBeenCalledTimes(1);
  });

  it('escapes LDAP filter metacharacters in the username before searching (injection guard)', async () => {
    searchMock.mockResolvedValueOnce({ searchEntries: [] });

    const malicious = '*)(uid=*';
    await authenticateLdap(baseCfg, malicious, 'whatever');

    const [, opts] = searchMock.mock.calls[0];
    // Raw metacharacters must not appear unescaped in the rendered filter.
    expect(opts.filter).not.toContain('*)(uid=*');
    expect(opts.filter).toContain('\\2a'); // escaped '*'
    expect(opts.filter).toContain('\\28'); // escaped '('
    expect(opts.filter).toContain('\\29'); // escaped ')'
  });

  it('succeeds only when both the search and the credential bind succeed', async () => {
    searchMock
      .mockResolvedValueOnce({ searchEntries: [{ dn: 'uid=bob,dc=example,dc=com', uid: 'bob', mail: 'bob@example.com', cn: 'Bob' }] });
    bindMock
      .mockResolvedValueOnce(undefined) // service bind for search
      .mockResolvedValueOnce(undefined); // credential bind for bob's password

    const result = await authenticateLdap(baseCfg, 'bob', 'correct-password');
    expect(result).toEqual({
      dn: 'uid=bob,dc=example,dc=com',
      username: 'bob',
      email: 'bob@example.com',
      displayName: 'Bob',
      groups: [],
    });
    expect(bindMock).toHaveBeenCalledTimes(2);
    expect(bindMock).toHaveBeenNthCalledWith(2, 'uid=bob,dc=example,dc=com', 'correct-password');
  });

  it('returns null when the user is found but the credential bind fails (wrong password)', async () => {
    searchMock.mockResolvedValueOnce({
      searchEntries: [{ dn: 'uid=bob,dc=example,dc=com', uid: 'bob', mail: 'bob@example.com', cn: 'Bob' }],
    });
    bindMock
      .mockResolvedValueOnce(undefined) // service bind
      .mockRejectedValueOnce(new Error('invalid credentials')); // credential bind fails

    const result = await authenticateLdap(baseCfg, 'bob', 'wrong-password');
    expect(result).toBeNull();
  });
});

describe('ldap.service production ldaps:// enforcement', () => {
  it('rejects a plain ldap:// URL when NODE_ENV=production', async () => {
    vi.resetModules();
    vi.doMock('../server/config.js', () => ({ config: { NODE_ENV: 'production' } }));
    vi.doMock('ldapts', () => ({
      Client: vi.fn().mockImplementation(function (this: any) {
        this.bind = vi.fn();
        this.search = vi.fn();
        this.unbind = vi.fn();
      }),
    }));

    const { authenticateLdap: authenticateLdapProd } = await import('../server/services/ldap.service.js');
    await expect(authenticateLdapProd(baseCfg, 'alice', 'whatever')).rejects.toThrow(/ldaps:\/\//);

    vi.doUnmock('../server/config.js');
    vi.doUnmock('ldapts');
    vi.resetModules();
  });
});
