import { Router } from 'express';
import { subscribeAlerts, acknowledgeAlert, resolveAlert, listAlerts, getAlertCounts } from '../services/alert.service.js';
import { authenticateToken, authenticateAdmin, isUserAdmin } from '../middleware/auth.js';
import { verifyInternalJwt } from '../oauth/jwt.js';
import { isTokenRevoked } from '../utils/token-blacklist.js';
import { db } from '../database.js';
import { users } from '../schema.js';
import { eq } from 'drizzle-orm';
import { success, error } from '../utils/response.js';
import type { JwtUserPayload } from '../types/index.js';
import '../types/express-augment.js';

const router = Router();

/**
 * Helper: authenticate SSE request using query param token.
 * EventSource cannot send Authorization header, so we accept ?token= as fallback.
 * ⚠ Token in query string leaks into nginx/CDN access logs, APM traces, and browser
 * history even over HTTPS. Strip /api/events/stream query params from access logs
 * at the reverse-proxy layer to mitigate.
 */
async function authenticateSseRequest(req: any): Promise<{ user: JwtUserPayload; isPlatformAdmin: boolean } | null> {
  // Try Authorization header first
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  // Fallback to query param for EventSource
  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  if (!token) return null;

  try {
    const decoded = await verifyInternalJwt(token);
    if (decoded.sub_type === 'client') return null;
    if (typeof decoded.id !== 'string' || typeof decoded.username !== 'string') return null;

    const revoked = await isTokenRevoked(token);
    if (revoked) return null;

    const user = decoded as unknown as JwtUserPayload;

    // Get platform admin status AND isActive from DB (not JWT)
    const [dbUser] = await db.select({ isPlatformAdmin: users.isPlatformAdmin, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (!dbUser) return null;
    // Disabled accounts must not receive SSE data (matches authenticateToken behavior)
    if (!dbUser.isActive) return null;

    return { user, isPlatformAdmin: dbUser.isPlatformAdmin ?? false };
  } catch {
    return null;
  }
}

/**
 * GET /api/events/stream — SSE endpoint for real-time alerts
 * Accepts token via Authorization header OR ?token= query param (for EventSource)
 */
router.get('/stream', async (req: any, res) => {
  const auth = await authenticateSseRequest(req);
  if (!auth) {
    return res.status(401).json(error('Authorization required'));
  }

  // Admin-only: same logic as authenticateAdmin (isPlatformAdmin || isAdmin || admin:* permission)
  const tenantId = req.tenantId ?? auth.user.tenant_id ?? 'default';
  if (!auth.isPlatformAdmin && !await isUserAdmin(auth.user.id, tenantId)) {
    return res.status(403).json(error('Admin access required'));
  }

  const userId = auth.user.id ?? '';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  const unsubscribe = subscribeAlerts(tenantId, userId, auth.isPlatformAdmin, (alert) => {
    res.write(`event: alert\ndata: ${JSON.stringify(alert)}\n\n`);
  });

  // Heartbeat every 30s
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30_000);

  // Send initial connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ tenantId, userId, isPlatformAdmin: auth.isPlatformAdmin })}\n\n`);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

/**
 * GET /api/events/alerts — List alerts (admin only)
 */
router.get('/alerts', authenticateAdmin, async (req: any, res) => {
  try {
    const tenantId = req.tenantId ?? 'default';
    const { status, severity, limit, offset } = req.query;

    const alertList = await listAlerts(tenantId, {
      status: status as any,
      severity: severity as any,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });

    const counts = await getAlertCounts(tenantId);

    res.json(success({ alerts: alertList, counts }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
});

/**
 * POST /api/events/alerts/:id/acknowledge (admin only)
 */
router.post('/alerts/:id/acknowledge', authenticateAdmin, async (req: any, res) => {
  try {
    const tenantId = req.tenantId ?? 'default';
    const userId = req.user?.id ?? '';
    const result = await acknowledgeAlert(req.params.id, tenantId, userId);
    if (!result) return res.status(404).json(error('Alert not found or already processed'));
    res.json(success({ acknowledged: true }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
});

/**
 * POST /api/events/alerts/:id/resolve (admin only)
 */
router.post('/alerts/:id/resolve', authenticateAdmin, async (req: any, res) => {
  try {
    const tenantId = req.tenantId ?? 'default';
    const userId = req.user?.id ?? '';
    const { note } = req.body ?? {};
    const result = await resolveAlert(req.params.id, tenantId, userId, note);
    if (!result) return res.status(404).json(error('Alert not found or already processed'));
    res.json(success({ resolved: true }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
});

export default router;
