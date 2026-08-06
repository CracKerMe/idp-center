import express from 'express';
import helmet from 'helmet';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config, rootDir } from './server/config.js';
import { db, initDatabase } from './server/database.js';
import { cleanupExpiredTokens } from './server/utils/cleanup.js';
import authRouter from './server/routes/auth.js';
import oidcRouter from './server/routes/oidc.js';
import wellKnownRouter from './server/routes/well-known.js';
import userRouter from './server/routes/user.js';
import adminRouter from './server/routes/admin.js';
import githubRouter from './server/routes/github.js';
import mfaRouter from './server/routes/mfa.js';
import { sql } from 'drizzle-orm';

import { tenantContext } from './server/middleware/tenant.js';
import { ipWhitelistGuard } from './server/middleware/ip-whitelist.js';

export const app = express();

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

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      services: { database: 'ok' },
    });
  } catch {
    res.json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      services: { database: 'error' },
    });
  }
});

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
app.use('/.well-known', wellKnownRouter);

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
    cleanupExpiredTokens();
    setInterval(cleanupExpiredTokens, 3600000);
  });

  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}
