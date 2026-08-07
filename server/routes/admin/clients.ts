import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../../database.js';
import { logAudit } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import { authenticateAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { success, error, message, ErrorCode } from '../../utils/response.js';
import { clients } from '../../schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { clientIdParamsSchema, createClientSchema, updateClientSchema } from '../../validators/admin.validator.js';

const router = express.Router();

// GET /api/admin/clients
router.get('/clients', authenticateAdmin, async (req, res) => {
  const tenantId = req.tenantId;
  const clientList = await db
    .select({
      id: clients.id,
      clientId: clients.clientId,
      clientName: clients.clientName,
      redirectUris: clients.redirectUris,
      grantTypes: clients.grantTypes,
      tenantId: clients.tenantId,
      createdAt: clients.createdAt,
    })
    .from(clients)
    .where(eq(clients.tenantId, tenantId))
    .orderBy(desc(clients.createdAt));

  res.json(success(clientList));
});

// POST /api/admin/clients
router.post('/clients', authenticateAdmin, validate({ body: createClientSchema }), async (req, res) => {
  const { client_name, redirect_uris, grant_types } = req.body;
  const tenantId = req.tenantId;
  const client_id = crypto.randomBytes(8).toString('hex');
  const client_secret = crypto.randomBytes(16).toString('hex');
  const id = crypto.randomUUID();
  // Hash immediately so the secret is never plaintext-only, even before the client's first token request.
  const clientSecretHash = await bcrypt.hash(client_secret, 10);

  await db.insert(clients).values({
    id,
    clientId: client_id,
    clientSecret: client_secret,
    clientSecretHash,
    clientSecretAlg: 'bcrypt',
    clientName: client_name,
    redirectUris: redirect_uris,
    grantTypes: grant_types || 'authorization_code',
    tenantId,
  });

  await logAudit({ req, action: AuditAction.ADMIN_CLIENT_CREATE, userId: req.user!.id, details: JSON.stringify({ client_id, client_name }), tenantId: tenantId });
  res.json(success({ client_id, client_secret }, 'Client created successfully'));
});

// PUT /api/admin/clients/:clientId
router.put('/clients/:clientId', authenticateAdmin, validate({ params: clientIdParamsSchema, body: updateClientSchema }), async (req, res) => {
  const { clientId } = req.params;
  const updates = req.body;
  const tenantId = req.tenantId;

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.clientId, clientId), eq(clients.tenantId, tenantId)))
    .limit(1);

  if (!client) return res.status(404).json(error('Client not found', ErrorCode.RESOURCE_NOT_FOUND));

  const updateData: Record<string, any> = {};

  if (updates.client_name !== undefined) updateData.clientName = updates.client_name;
  if (updates.redirect_uris !== undefined) {
    updateData.redirectUris = typeof updates.redirect_uris === 'string' ? updates.redirect_uris : JSON.stringify(updates.redirect_uris);
  }
  if (updates.grant_types !== undefined) updateData.grantTypes = updates.grant_types;

  if (Object.keys(updateData).length === 0) return res.status(400).json(error('No fields to update', ErrorCode.VALIDATION_ERROR));

  await db.update(clients).set(updateData).where(and(eq(clients.clientId, clientId), eq(clients.tenantId, tenantId)));

  await logAudit({ req, action: AuditAction.ADMIN_CLIENT_UPDATE, userId: req.user!.id, details: JSON.stringify({ client_id: clientId }), tenantId: tenantId });
  res.json(message('Client updated successfully'));
});

// DELETE /api/admin/clients/:clientId
router.delete('/clients/:clientId', authenticateAdmin, validate({ params: clientIdParamsSchema }), async (req, res) => {
  const { clientId } = req.params;
  const tenantId = req.tenantId;

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.clientId, clientId), eq(clients.tenantId, tenantId)))
    .limit(1);

  if (!client) return res.status(404).json(error('Client not found', ErrorCode.RESOURCE_NOT_FOUND));

  await db.delete(clients).where(and(eq(clients.clientId, clientId), eq(clients.tenantId, tenantId)));
  await logAudit({ req, action: AuditAction.ADMIN_CLIENT_DELETE, userId: req.user!.id, details: JSON.stringify({ client_id: clientId }), tenantId: tenantId });
  res.json(message('Client deleted successfully'));
});

// POST /api/admin/clients/:clientId/rotate-secret
router.post('/clients/:clientId/rotate-secret', authenticateAdmin, validate({ params: clientIdParamsSchema }), async (req, res) => {
  const { clientId } = req.params;
  const tenantId = req.tenantId;

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.clientId, clientId), eq(clients.tenantId, tenantId)))
    .limit(1);

  if (!client) return res.status(404).json(error('Client not found', ErrorCode.RESOURCE_NOT_FOUND));

  const newSecret = crypto.randomBytes(16).toString('hex');
  const newSecretHash = await bcrypt.hash(newSecret, 10);
  await db.update(clients).set({ clientSecret: newSecret, clientSecretHash: newSecretHash, clientSecretAlg: 'bcrypt' }).where(and(eq(clients.clientId, clientId), eq(clients.tenantId, tenantId)));

  await logAudit({ req, action: AuditAction.ADMIN_CLIENT_SECRET_ROTATE, userId: req.user!.id, details: JSON.stringify({ client_id: clientId }), tenantId: tenantId });
  res.json(success({ client_secret: newSecret }, 'Secret rotated successfully'));
});

export default router;
