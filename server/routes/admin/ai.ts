import express from 'express';
import { logAudit } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import { authenticateAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { success, error, ErrorCode } from '../../utils/response.js';
import { aiAuditSummaryQuerySchema, aiPolicyDraftSchema, aiComplianceCheckQuerySchema } from '../../validators/admin.validator.js';
import { isAiAssistEnabled, generateAuditSummary, draftRiskPolicy, generateComplianceGapCheck, AiAssistDisabledError } from '../../services/ai-assist.service.js';

const router = express.Router();

// ─── LLM-assisted admin tooling (phase 3.3) ─────────────────────────────────
// Every endpoint here 501s when ANTHROPIC_API_KEY is unset. None of them write anything
// that takes effect on its own — drafts are returned for the admin to review and apply
// through the ordinary CRUD endpoints (see risk/policies in risk.ts).

function requireAiAssist(res: express.Response): boolean {
  if (!isAiAssistEnabled()) {
    res.status(501).json(error('AI-assisted tooling is disabled (ANTHROPIC_API_KEY not set)', ErrorCode.SERVER_ERROR));
    return false;
  }
  return true;
}

// GET /api/admin/ai/audit-summary?days=7
router.get('/ai/audit-summary', authenticateAdmin, validate({ query: aiAuditSummaryQuerySchema }), async (req, res) => {
  if (!requireAiAssist(res)) return;
  try {
    const { days } = req.query as any;
    const result = await generateAuditSummary(req.tenantId, days);
    await logAudit({ req, action: AuditAction.AI_AUDIT_SUMMARY_GENERATED, userId: req.user!.id, details: `days=${days}`, tenantId: req.tenantId });
    res.json(success(result));
  } catch (err: any) {
    if (err instanceof AiAssistDisabledError) return res.status(501).json(error(err.message, ErrorCode.SERVER_ERROR));
    res.status(502).json(error(`AI assist failed: ${err.message}`, ErrorCode.SERVER_ERROR));
  }
});

// POST /api/admin/ai/policy-draft — returns a draft only; POST /api/admin/risk/policies
// applies it after human review.
router.post('/ai/policy-draft', authenticateAdmin, validate({ body: aiPolicyDraftSchema }), async (req, res) => {
  if (!requireAiAssist(res)) return;
  try {
    const draft = await draftRiskPolicy(req.body.instruction);
    await logAudit({ req, action: AuditAction.AI_POLICY_DRAFT_GENERATED, userId: req.user!.id, details: JSON.stringify(draft), tenantId: req.tenantId });
    res.json(success(draft, 'Draft generated — review and apply via POST /api/admin/risk/policies'));
  } catch (err: any) {
    if (err instanceof AiAssistDisabledError) return res.status(501).json(error(err.message, ErrorCode.SERVER_ERROR));
    res.status(502).json(error(`AI assist failed: ${err.message}`, ErrorCode.SERVER_ERROR));
  }
});

// GET /api/admin/ai/compliance-check?standard=soc2|gdpr
router.get('/ai/compliance-check', authenticateAdmin, validate({ query: aiComplianceCheckQuerySchema }), async (req, res) => {
  if (!requireAiAssist(res)) return;
  try {
    const { standard } = req.query as any;
    const result = await generateComplianceGapCheck(req.tenantId, standard);
    await logAudit({ req, action: AuditAction.AI_COMPLIANCE_CHECK_GENERATED, userId: req.user!.id, details: `standard=${standard}`, tenantId: req.tenantId });
    res.json(success(result));
  } catch (err: any) {
    if (err instanceof AiAssistDisabledError) return res.status(501).json(error(err.message, ErrorCode.SERVER_ERROR));
    res.status(502).json(error(`AI assist failed: ${err.message}`, ErrorCode.SERVER_ERROR));
  }
});

export default router;
