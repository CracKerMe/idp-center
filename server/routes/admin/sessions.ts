import express from 'express';
import { db } from '../../database.js';
import { logAudit } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import { authenticateAdmin, authenticatePlatformAdmin } from '../../middleware/auth.js';
import { success, error, message, ErrorCode } from '../../utils/response.js';
import { cleanupExpiredTokens } from '../../utils/cleanup.js';
import { users, sessions, refreshTokens } from '../../schema.js';
import { eq, sql } from 'drizzle-orm';

const router = express.Router();

// GET /api/admin/sessions
router.get('/sessions', authenticateAdmin, async (req, res) => {
  const tenantFilter = req.isPlatformAdmin ? sql`` : sql`WHERE u.tenant_id = ${req.tenantId}`;
  const sessionList = await db.execute(sql`
    SELECT s.id, s.device_info, s.ip_address, s.last_active, s.created_at,
      u.username, u.email,
      (SELECT COUNT(*)::int FROM refresh_tokens rt WHERE rt.user_id = s.user_id AND rt.revoked = false) as active_tokens
    FROM sessions s
    LEFT JOIN users u ON s.user_id = u.id
    ${tenantFilter}
    ORDER BY s.last_active DESC
  `);
  res.json(success(sessionList));
});

// DELETE /api/admin/sessions/:id
router.delete('/sessions/:id', authenticateAdmin, async (req, res) => {
  const { id } = req.params;

  const [session] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  if (!session) return res.status(404).json(error('Session not found', ErrorCode.RESOURCE_NOT_FOUND));

  if (!req.isPlatformAdmin) {
    const [owner] = await db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, session.userId)).limit(1);
    if (!owner || owner.tenantId !== req.tenantId) return res.status(404).json(error('Session not found', ErrorCode.RESOURCE_NOT_FOUND));
  }

  await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, session.userId));
  await db.delete(sessions).where(eq(sessions.id, id));

  await logAudit({ req, action: AuditAction.ADMIN_SESSION_REVOKED, userId: req.user!.id, details: `Session ${id} revoked by admin` });
  res.json(message('Session revoked successfully'));
});

// POST /api/admin/maintenance/cleanup-tokens — global maintenance, platform-admin only.
router.post('/maintenance/cleanup-tokens', authenticatePlatformAdmin, async (req, res) => {
  const result = await cleanupExpiredTokens();
  res.json(success(result, 'Token cleanup completed'));
});

export default router;
