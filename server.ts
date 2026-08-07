import express from 'express';
import helmet from 'helmet';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config, rootDir } from './server/config.js';
import { db, initDatabase } from './server/database.js';
import { startScheduler } from './server/jobs/scheduler.js';
import authRouter from './server/routes/auth.js';
import oidcRouter from './server/routes/oidc.js';
import wellKnownRouter from './server/routes/well-known.js';
import userRouter from './server/routes/user.js';
import adminRouter from './server/routes/admin.js';
import githubRouter from './server/routes/github.js';
import mfaRouter from './server/routes/mfa.js';
import scimRouter from './server/routes/scim.js';
import federationRouter from './server/routes/federation/index.js';
import healthRouter from './server/routes/health.js';
import { sql } from 'drizzle-orm';

import { tenantContext } from './server/middleware/tenant.js';
import { ipWhitelistGuard } from './server/middleware/ip-whitelist.js';
import { requestIdMiddleware } from './server/middleware/request-id.js';
import { metricsMiddleware } from './server/middleware/metrics.js';

export const app = express();

// Request ID middleware - must be first to ensure all requests have an ID
app.use(requestIdMiddleware);

// Metrics collection middleware
app.use(metricsMiddleware);

// Security headers with helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

app.use(express.json());

// Health & Metrics endpoints (before tenant context - these are global)
app.use(healthRouter);

app.use('/api', tenantContext);
app.use('/api', ipWhitelistGuard);

// Serve uploaded avatars
const uploadsDir = path.join(rootDir, 'uploads', 'avatars');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/api/uploads', express.static(path.join(rootDir, 'uploads')));

// Routes
app.use('/api/auth/github', githubRouter);
app.use('/api/auth', authRouter);
app.use('/api/oidc', oidcRouter);
app.use('/api/user', userRouter);
app.use('/api/user/mfa', mfaRouter);
app.use('/api/admin', adminRouter);
// SAML's ACS endpoint receives an HTML form POST (application/x-www-form-urlencoded), not
// JSON — the global express.json() above silently no-ops on that content type, so this
// needs its own parser. GET routes here are unaffected (no body to parse).
app.use('/api/federation', express.urlencoded({ extended: false }), federationRouter);
app.use('/.well-known', wellKnownRouter);
// SCIM is tenant-scoped via its bearer token's tenant_id, not X-Tenant-ID — mounted
// outside /api so it doesn't go through tenantContext's header-based resolution.
app.use('/scim/v2', express.json({ type: ['application/json', 'application/scim+json'] }), scimRouter);

export async function startServer() {
  await initDatabase();

  if (config.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  const server = app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${config.PORT}`);
    startScheduler();
  });

  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}
