import express from 'express';
import { register } from '../utils/metrics.js';
import { checkLiveness, checkReadiness } from '../services/health.service.js';
import { config } from '../config.js';

const router = express.Router();

/**
 * GET /livez - Kubernetes liveness probe endpoint.
 * 
 * Returns 200 if the process is running and can handle requests.
 * Does NOT check external dependencies (database, SMTP, etc.)
 * 
 * Use this for pod restart decisions - if this fails, the pod should be restarted.
 */
router.get('/livez', async (req, res) => {
  try {
    const result = await checkLiveness();
    res.json(result);
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Liveness check failed',
    });
  }
});

/**
 * GET /readyz - Kubernetes readiness probe endpoint.
 * 
 * Returns 200 if the instance is ready to receive traffic.
 * Checks critical dependencies (database) and optional services (SMTP).
 * 
 * Use this for load balancer decisions - if this fails, traffic should be routed elsewhere.
 */
router.get('/readyz', async (req, res) => {
  try {
    const result = await checkReadiness();
    const statusCode = result.status === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(result);
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Readiness check failed',
    });
  }
});

/**
 * GET /metrics - Prometheus metrics endpoint.
 * 
 * Returns all collected metrics in Prometheus exposition format.
 * Protected by bearer token if METRICS_TOKEN is configured, otherwise
 * only accessible from localhost/private IPs.
 */
router.get('/metrics', async (req, res) => {
  // Simple authentication: require bearer token if configured, otherwise check IP
  if (config.METRICS_TOKEN) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    
    if (token !== config.METRICS_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  } else {
    // No token configured - only allow localhost/private IPs
    const ip = req.ip || req.socket.remoteAddress || '';
    const isPrivate = ip === '127.0.0.1' || 
                      ip === '::1' || 
                      ip === '::ffff:127.0.0.1' ||
                      ip.startsWith('10.') ||
                      ip.startsWith('172.16.') ||
                      ip.startsWith('192.168.');
    
    if (!isPrivate) {
      return res.status(403).json({ error: 'Metrics endpoint is only accessible from private networks' });
    }
  }

  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).json({ error: 'Failed to collect metrics' });
  }
});

/**
 * GET /health - Legacy health check endpoint (kept for backward compatibility).
 * Redirects to /readyz behavior.
 */
router.get('/health', async (req, res) => {
  try {
    const result = await checkReadiness();
    // Legacy format for backward compatibility
    res.json({
      status: result.status === 'healthy' ? 'healthy' : 'degraded',
      timestamp: result.timestamp,
      version: result.version,
      services: {
        database: result.services.database.status === 'ok' ? 'ok' : 'error',
      },
    });
  } catch {
    res.json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      version: config.APP_VERSION || '1.0.0',
      services: { database: 'error' },
    });
  }
});

export default router;
