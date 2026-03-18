import express from 'express';
import helmet from 'helmet';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config, rootDir } from './server/config.js';
// Side-effect: initialises DB schema, migrations and seeds
import './server/database.js';
import { cleanupExpiredTokens } from './server/utils/cleanup.js';
import authRouter from './server/routes/auth.js';
import oidcRouter from './server/routes/oidc.js';
import userRouter from './server/routes/user.js';
import adminRouter from './server/routes/admin.js';
import githubRouter from './server/routes/github.js';
import { db } from './server/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Security headers with helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // unsafe-inline/eval needed for Vite HMR in dev
      styleSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline needed for Tailwind CSS
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false, // Needed for some OAuth flows
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

app.use(express.json());

// Serve uploaded avatars
const uploadsDir = path.join(rootDir, 'uploads', 'avatars');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/api/uploads', express.static(path.join(rootDir, 'uploads')));

// Health check (standalone, not under /admin prefix)
app.get('/api/health', (req, res) => {
  const dbOk = db.prepare('SELECT 1').get() !== undefined;
  res.json({
    status: dbOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    services: { database: dbOk ? 'ok' : 'error' },
  });
});

// Routes
app.use('/api/auth/github', githubRouter);
app.use('/api/auth', authRouter);
app.use('/api/oidc', oidcRouter);
app.use('/api/user', userRouter);
app.use('/api/admin', adminRouter);
app.use('/.well-known', oidcRouter);

async function startServer() {
  if (config.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Hash mode: serve static files only, no SPA fallback needed
    app.use(express.static('dist'));
  }

  app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${config.PORT}`);
    cleanupExpiredTokens();
    setInterval(cleanupExpiredTokens, 3600000);
  });
}

startServer();
