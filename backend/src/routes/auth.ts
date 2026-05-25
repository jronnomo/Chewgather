import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import User from '../models/User';
import Friendship from '../models/Friendship';
import { generateInviteCode } from '../utils/inviteCode';
import { createNotification } from '../utils/createNotification';

const router = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// F-001-004: Rate limiting (skipped in test environment)
const isTest = process.env.NODE_ENV === 'test';

const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: { error: 'Too many registration attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
});

router.post('/register', registerLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) {
      res.status(400).json({ error: 'name, email, and password are required' });
      return;
    }

    // F-001-008: Email format validation
    if (!EMAIL_REGEX.test(email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    // F-001-007: Password minimum length
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newInviteCode = generateInviteCode();

    const user = await User.create({ name, email, passwordHash, phone, inviteCode: newInviteCode });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '90d' });

    // Invite-code resolution — best-effort; never blocks 201
    let invitedByPayload: { id: string; name: string; avatarUri?: string } | null = null;
    try {
      const rawInviteCode: string | undefined = req.body.inviteCode;
      const normalizedCode = rawInviteCode?.trim().toUpperCase() || null;
      if (normalizedCode) {
        const inviter = await User.findOne({ inviteCode: normalizedCode });
        if (inviter && !inviter._id.equals(user._id)) {
          await Friendship.create({
            requester: user._id,
            recipient: inviter._id,
            status: 'accepted',
          });
          await User.findByIdAndUpdate(user._id, { invitedBy: inviter._id });
          await createNotification({
            userId: inviter._id.toString(),
            type: 'friend_joined_via_invite',
            title: `${user.name} joined Chewabl!`,
            body: `${user.name} joined via your invite — you're now friends`,
            data: { newUserId: user._id.toString() },
          });
          invitedByPayload = {
            id: inviter._id.toString(),
            name: inviter.name,
            avatarUri: inviter.avatarUri,
          };
        }
      }
    } catch (err) {
      console.error('/auth/register invite-code error:', err);
    }

    // F-001-002 / F-008-006: Include preferences and favorites in response
    res.status(201).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatarUri: user.avatarUri,
        inviteCode: user.inviteCode,
        preferences: user.preferences,
        favorites: user.favorites,
        createdAt: user.createdAt,
      },
      invitedBy: invitedByPayload,
    });
  } catch (err) {
    console.error('/auth/register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }

    // F-001-007: Password minimum length (fail fast)
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '90d' });

    // F-001-002 / F-008-006: Include preferences and favorites in response
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatarUri: user.avatarUri,
        inviteCode: user.inviteCode,
        preferences: user.preferences,
        favorites: user.favorites,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    console.error('/auth/login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// F-001-006: Logout endpoint (client clears token; server acknowledges)
router.post('/logout', (_req: Request, res: Response): void => {
  res.json({ ok: true });
});

export default router;
