import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import User from '../models/User';

const router = Router();

router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.userId).select('-passwordHash');
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    res.json(user);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, phone, avatarUri, preferences, favorites, pushToken } = req.body;
    const updates: Record<string, unknown> = {};

    // F-008-010 / GAP-008: server-side type + length validation on profile fields.
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 80) {
        res.status(400).json({ error: 'Name must be 1–80 characters' }); return;
      }
      updates.name = name.trim();
    }
    if (phone !== undefined) {
      if (phone !== null && (typeof phone !== 'string' || phone.length > 32)) {
        res.status(400).json({ error: 'Phone must be 32 characters or less' }); return;
      }
      updates.phone = phone;
    }
    if (avatarUri !== undefined) {
      if (avatarUri !== null && (typeof avatarUri !== 'string' || avatarUri.length > 2048)) {
        res.status(400).json({ error: 'avatarUri must be 2048 characters or less' }); return;
      }
      updates.avatarUri = avatarUri;
    }
    if (preferences !== undefined) {
      if (typeof preferences !== 'object' || preferences === null || Array.isArray(preferences)) {
        res.status(400).json({ error: 'Invalid preferences' }); return;
      }
      updates.preferences = preferences;
    }
    if (favorites !== undefined) {
      if (!Array.isArray(favorites) || favorites.length > 1000 || favorites.some(f => typeof f !== 'string')) {
        res.status(400).json({ error: 'Invalid favorites' }); return;
      }
      updates.favorites = favorites;
    }

    // F-008-009: Validate pushToken format
    if (pushToken !== undefined) {
      if (pushToken !== null && typeof pushToken === 'string' && pushToken.length > 0) {
        if (!pushToken.startsWith('ExponentPushToken[') && !pushToken.startsWith('ExpoPushToken[')) {
          res.status(400).json({ error: 'Invalid push token format' });
          return;
        }
      }
      updates.pushToken = pushToken;
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-passwordHash');
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    res.json(user);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/push-token', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { pushToken } = req.body;

    // F-008-009: Validate pushToken format
    if (pushToken && typeof pushToken === 'string') {
      if (!pushToken.startsWith('ExponentPushToken[') && !pushToken.startsWith('ExpoPushToken[')) {
        res.status(400).json({ error: 'Invalid push token format' });
        return;
      }
    }

    await User.findByIdAndUpdate(req.userId, { $set: { pushToken } });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Clear push token (called on logout)
router.delete('/push-token', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await User.findByIdAndUpdate(req.userId, { $unset: { pushToken: 1 } });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Look up users by phone numbers (for contacts import)
router.post('/lookup', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { phones } = req.body as { phones: string[] };
    if (!Array.isArray(phones) || phones.length === 0) {
      res.status(400).json({ error: 'phones array required' });
      return;
    }

    // F-008-022 / F-007-004: Limit phones array to 100 entries
    const limitedPhones = phones.slice(0, 100);

    const users = await User.find({ phone: { $in: limitedPhones } }).select('id name phone avatarUri inviteCode');
    res.json(users);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Look up user by invite code
router.get('/invite/:code', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findOne({ inviteCode: req.params.code.toUpperCase() }).select('id name avatarUri inviteCode');
    if (!user) { res.status(404).json({ error: 'Invite code not found' }); return; }
    res.json(user);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
