import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import User from '../models/User';
import bcrypt from 'bcryptjs';
import { v2 as cloudinary } from 'cloudinary';
import Friendship from '../models/Friendship';
import Plan from '../models/Plan';
import Notification from '../models/Notification';
import { isClean } from '../utils/contentFilter';

const router = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const { name, email, phone, avatarUri, preferences, favorites, pushToken } = req.body;
    const updates: Record<string, unknown> = {};

    // F-008-010 / GAP-008: server-side type + length validation on profile fields.
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 80) {
        res.status(400).json({ error: 'Name must be 1–80 characters' }); return;
      }
      if (!isClean(name)) {
        res.status(400).json({ error: 'That name contains language we don’t allow — please pick another.' }); return;
      }
      updates.name = name.trim();
    }
    // F-007-017: allow changing email from profile. Validate format + enforce
    // uniqueness across other accounts. (Email re-verification is a deferred
    // stretch goal — the app does not verify email at registration either.)
    if (email !== undefined) {
      if (typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
        res.status(400).json({ error: 'Invalid email format' }); return;
      }
      const normalizedEmail = email.toLowerCase().trim();
      const existing = await User.findOne({ email: normalizedEmail });
      if (existing && !existing._id.equals(req.userId)) {
        res.status(409).json({ error: 'Email already in use' }); return;
      }
      updates.email = normalizedEmail;
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

// Account deletion — re-authenticates, then hard-deletes the user + full cascade
router.delete('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Step 1 — Validate body
    const { password } = req.body as { password?: unknown };
    if (!password || typeof password !== 'string') {
      res.status(400).json({ error: 'Password is required' }); return;
    }

    // Step 2 — Load user (need passwordHash); return early on mismatch — nothing touched
    const user = await User.findById(req.userId);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) { res.status(401).json({ error: 'Incorrect password' }); return; }

    // Step 3 — Friendships where user is requester or recipient
    await Friendship.deleteMany({ $or: [{ requester: req.userId }, { recipient: req.userId }] });

    // Step 4 — Plans owned by user
    await Plan.deleteMany({ ownerId: req.userId });

    // Step 5 — Pull user from invites on all OTHER plans
    await Plan.updateMany(
      { 'invites.userId': req.userId },
      { $pull: { invites: { userId: req.userId } } }
    );

    // Step 6 — Remove user's vote entry from the votes Map on all surviving plans.
    // votes is a Mongoose Map<string, string[]> keyed by userId (Plan.ts).
    await Plan.updateMany(
      { [`votes.${req.userId}`]: { $exists: true } },
      { $unset: { [`votes.${req.userId}`]: '' } }
    );

    // Step 7 — Remove user from swipesCompleted on all surviving plans
    await Plan.updateMany(
      { swipesCompleted: req.userId },
      { $pull: { swipesCompleted: req.userId } }
    );

    // Step 8 — Notifications for user
    await Notification.deleteMany({ userId: req.userId });

    // Step 9 — Best-effort Cloudinary avatar deletion. NEVER allowed to throw out of the handler.
    try {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
      await cloudinary.uploader.destroy(`chewabl/avatars/${req.userId}`);
    } catch (cloudinaryErr) {
      console.warn('[deleteAccount] Cloudinary avatar cleanup failed (non-fatal):', cloudinaryErr);
    }

    // Step 10 — Delete the user doc (push token is implicitly gone)
    await User.findByIdAndDelete(req.userId);

    res.json({ success: true });
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

// ---------------------------------------------------------------------------
// User blocking (#321 — App Store Guideline 1.2). Blocking is one-directional
// in storage but enforced both ways: neither side can friend-request, invite,
// or surface in the other's discover feed while a block exists.
// ---------------------------------------------------------------------------

router.get('/me/blocked', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const me = await User.findById(req.userId).populate('blockedUsers', 'name avatarUri');
    if (!me) { res.status(404).json({ error: 'User not found' }); return; }
    res.json(me.blockedUsers ?? []);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/block', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targetId = req.params.id;
    if (targetId === req.userId) { res.status(400).json({ error: 'Cannot block yourself' }); return; }
    const target = await User.findById(targetId).select('_id');
    if (!target) { res.status(404).json({ error: 'User not found' }); return; }

    await User.updateOne({ _id: req.userId }, { $addToSet: { blockedUsers: target._id } });

    // Sever any friendship/pending request in either direction — a block that
    // leaves the friendship intact isn't a block.
    await Friendship.deleteMany({
      $or: [
        { requester: req.userId, recipient: targetId },
        { requester: targetId, recipient: req.userId },
      ],
    });

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/block', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await User.updateOne({ _id: req.userId }, { $pull: { blockedUsers: req.params.id } });
    res.json({ ok: true });
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
