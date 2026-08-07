import { pgTable, text, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';

// --- Phase 2.2: Federated identity ---

export const identityProviders = pgTable('identity_providers', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  alias: text('alias').notNull(),               // URL segment: /api/federation/:alias/...
  type: text('type').notNull(),                  // saml | oidc | ldap | oauth2
  displayName: text('display_name').notNull(),
  enabled: boolean('enabled').default(true),
  configEnc: text('config_enc').notNull(),        // full config JSON, encryptToken()
  attributeMapping: text('attribute_mapping').notNull().default('{}'),
  jitProvisioning: boolean('jit_provisioning').default(true),
  linkByVerifiedEmail: boolean('link_by_verified_email').default(false),
  defaultRoles: text('default_roles'),
  emailDomains: text('email_domains'),            // comma-separated, for login-page auto-routing
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  uniqueIndex('idx_idp_tenant_alias').on(t.tenantId, t.alias),
]);

// SAML assertions are single-use (RFC-adjacent convention, not a hard SAML requirement,
// but the standard replay defense): each assertion ID is recorded once and rejected on reuse.
export const samlAssertionIds = pgTable('saml_assertion_ids', {
  assertionId: text('assertion_id').primaryKey(),
  idpAlias: text('idp_alias').notNull(),
  tenantId: text('tenant_id').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_saml_assertion_expires').on(t.expiresAt),
]);

export const linkedAccounts = pgTable('linked_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  provider: text('provider').notNull(),
  providerUserId: text('provider_user_id').notNull(),
  providerUsername: text('provider_username'),
  accessToken: text('access_token'),
  // Nullable for the transition window — backfilled from the linked user's tenant by
  // identity-link.service.ts's migrateLegacyLinkedAccounts() on startup. Needed because two
  // different tenants' SAML/OIDC IdPs can otherwise mint colliding providerUserId values
  // (unlike GitHub's globally-unique numeric id, a NameID like "user123" is only unique
  // within its own IdP) — without this, linking one would silently hijack the other.
  tenantId: text('tenant_id'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  uniqueIndex('idx_linked_accounts_provider_user_tenant').on(t.provider, t.providerUserId, t.tenantId),
]);
