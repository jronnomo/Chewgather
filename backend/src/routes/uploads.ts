import { Router, Response } from 'express';
import { v2 as cloudinary } from 'cloudinary';
import { requireAuth, AuthRequest } from '../middleware/auth';
import User from '../models/User';

const router = Router();

let cloudinaryConfigured = false;
function ensureCloudinary() {
  if (!cloudinaryConfigured) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    cloudinaryConfigured = true;
  }
}

router.post('/avatar', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    ensureCloudinary();
    const { image } = req.body;
    if (!image || typeof image !== 'string') {
      res.status(400).json({ error: 'image (base64 data URI) is required' });
      return;
    }

    // Defense-in-depth: enforce a friendly error when the dataUri exceeds backend
    // limits, instead of relying on the body-parser to silently 413 (#31).
    const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB — matches express.json limit
    if (image.length > MAX_IMAGE_BYTES) {
      res.status(413).json({ error: 'Image is too large. Please use a smaller photo.' });
      return;
    }

    const result = await cloudinary.uploader.upload(image, {
      folder: 'chewabl/avatars',
      public_id: req.userId,
      overwrite: true,
      transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
    });

    await User.findByIdAndUpdate(req.userId, { avatarUri: result.secure_url });

    res.json({ avatarUri: result.secure_url });
  } catch (err) {
    console.error('/uploads/avatar error:', err);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

export default router;
