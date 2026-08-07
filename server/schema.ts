// Table definitions live under server/schema/*.ts, split by domain (tenants, users, oauth,
// sessions, mfa, rbac, federation, risk, account). This file stays a thin re-export so every
// existing `from '../schema.js'` import site keeps working unchanged.
export * from './schema/index.js';
