import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, AuthRequest } from '../middleware/auth';
import Report from '../models/Report';
import User from '../models/User';
import Plan from '../models/Plan';

const router = Router();

// #321 (Guideline 1.2): content reporting. Reports land in the Report
// collection as the moderation queue; review is manual for v1.

const REPORT_REASONS = [
  'inappropriate_content',
  'harassment',
  'spam',
  'impersonation',
  'other',
] as const;

const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reports — please try again later.' },
});

router.post('/', requireAuth, reportLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { targetType, targetId, reason, detail } = req.body as {
      targetType?: string; targetId?: string; reason?: string; detail?: string;
    };

    if (targetType !== 'user' && targetType !== 'plan') {
      res.status(400).json({ error: "targetType must be 'user' or 'plan'" }); return;
    }
    if (!targetId) { res.status(400).json({ error: 'targetId is required' }); return; }
    if (!reason || !REPORT_REASONS.includes(reason as (typeof REPORT_REASONS)[number])) {
      res.status(400).json({ error: `reason must be one of: ${REPORT_REASONS.join(', ')}` }); return;
    }

    const target =
      targetType === 'user'
        ? await User.findById(targetId).select('_id')
        : await Plan.findById(targetId).select('_id');
    if (!target) { res.status(404).json({ error: 'Report target not found' }); return; }

    try {
      const report = await Report.create({
        reporterId: req.userId,
        targetType,
        targetId,
        reason,
        detail: typeof detail === 'string' ? detail.slice(0, 1000) : undefined,
      });
      res.status(201).json({ ok: true, reportId: report.id });
    } catch (err: unknown) {
      // Duplicate open report from the same reporter — treat as success so
      // the UI can always show "thanks, we received your report."
      if ((err as { code?: number })?.code === 11000) {
        res.status(200).json({ ok: true, duplicate: true });
        return;
      }
      throw err;
    }
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
