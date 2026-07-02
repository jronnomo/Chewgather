import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import User from '../models/User';
import Friendship from '../models/Friendship';
import { generateInviteCode } from '../utils/inviteCode';
import { createNotification } from '../utils/createNotification';
import { isClean } from '../utils/contentFilter';
import { sendEmail, generateResetCode } from '../utils/sendEmail';

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

const forgotLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
});

const resetLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts, please try again later' },
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

    // #321: display names are user-generated content shown to other users.
    if (!isClean(name)) {
      res.status(400).json({ error: 'That name contains language we don\u2019t allow \u2014 please pick another.' });
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
            title: `${user.name} joined Chewgather!`,
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

// F-001-013: Forgot password — request a 6-digit OTP
router.post('/forgot-password', forgotLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: 'email is required' });
      return;
    }

    if (!EMAIL_REGEX.test(email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      res.status(404).json({ error: 'No account found' });
      return;
    }

    const code = generateResetCode();
    user.resetCodeHash = await bcrypt.hash(code, 10);
    user.resetCodeExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    user.resetCodeAttempts = 0;
    await user.save();

    const subject = `Your Chewgather reset code — dig in before it expires!`;
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <style>
    body { background: #F2F0ED; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 0; }
    .wrapper { max-width: 480px; margin: 40px auto; background: #FFFFFF; border-radius: 16px; overflow: hidden; border: 1px solid #E8E6E3; }
    .header { background: #E85D3A; padding: 28px 32px 20px; text-align: center; }
    .logo-text { color: #FFFFFF; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
    .body { padding: 32px; }
    .headline { font-size: 20px; font-weight: 700; color: #1C1917; margin: 0 0 8px; }
    .subtext { font-size: 15px; color: #78716C; margin: 0 0 28px; line-height: 1.5; }
    .code-block { background: #FFF0EB; border: 2px solid #E85D3A; border-radius: 14px; padding: 20px; text-align: center; margin-bottom: 28px; }
    .code { font-size: 40px; font-weight: 800; letter-spacing: 8px; color: #E85D3A; font-variant-numeric: tabular-nums; }
    .code-label { font-size: 13px; color: #A8A29E; margin-top: 6px; }
    .fine-print { font-size: 13px; color: #A8A29E; line-height: 1.6; margin: 0; }
    .footer { padding: 16px 32px 24px; background: #F9F8F7; border-top: 1px solid #E8E6E3; }
    .footer-text { font-size: 12px; color: #A8A29E; margin: 0; }
    @media (prefers-color-scheme: dark) {
      .wrapper { background: #292524; border-color: #44403C; }
      .body { }
      .headline { color: #F5F0EB; }
      .subtext { color: #A8A29E; }
      .code-block { background: #2A2119; border-color: #FF7A5C; }
      .code { color: #FF7A5C; }
      .footer { background: #1C1917; border-color: #44403C; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="logo-text">Chewgather</div>
    </div>
    <div class="body">
      <p class="headline">Locked out? Let's fix that.</p>
      <p class="subtext">Someone (hopefully you!) asked to reset the password on this Chewgather account. Pop the code below into the app and you'll be back at the table in no time.</p>
      <div class="code-block">
        <div class="code">${code}</div>
        <div class="code-label">Expires in 15 minutes</div>
      </div>
      <p class="fine-print">If you didn't request this, no worries — your account is safe. Just ignore this email and nothing will change. This code is single-use and can only be entered 5 times before it locks.</p>
    </div>
    <div class="footer">
      <p class="footer-text">Chewgather · We'll feed you back · <a href="https://chewgather.com" style="color:#E85D3A;">chewgather.com</a></p>
    </div>
  </div>
</body>
</html>
`;

    await sendEmail({ to: user.email, subject, html });

    res.json({ ok: true, ...(isTest ? { code } : {}) });
  } catch (err) {
    console.error('/auth/forgot-password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// F-001-013: Reset password — verify OTP and set new password
router.post('/reset-password', resetLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      res.status(400).json({ error: 'email, code, and newPassword are required' });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user || !user.resetCodeHash || (user.resetCodeAttempts ?? 0) >= 5) {
      res.status(400).json({ error: 'Invalid or expired code' });
      return;
    }

    if (!user.resetCodeExpiresAt || user.resetCodeExpiresAt <= new Date()) {
      res.status(400).json({ error: 'Code expired' });
      return;
    }

    const valid = await bcrypt.compare(code, user.resetCodeHash);
    if (!valid) {
      user.resetCodeAttempts = (user.resetCodeAttempts ?? 0) + 1;
      await user.save();
      res.status(400).json({ error: 'Invalid code' });
      return;
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.resetCodeHash = undefined;
    user.resetCodeExpiresAt = undefined;
    user.resetCodeAttempts = undefined;
    await user.save();

    res.json({ ok: true });
  } catch (err) {
    console.error('/auth/reset-password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
