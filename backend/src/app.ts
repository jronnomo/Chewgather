import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import friendRoutes from './routes/friends';
import planRoutes from './routes/plans';
import notificationRoutes from './routes/notifications';
import uploadRoutes from './routes/uploads';
import restaurantRoutes from './routes/restaurants';

dotenv.config();

const app = express();

// F-001-003: CORS with explicit allowed origins in production
const allowedOrigins = process.env.CORS_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean);
app.use(cors(allowedOrigins && allowedOrigins.length > 0 ? { origin: allowedOrigins } : undefined));

app.use(express.json({ limit: '2mb' }));
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/friends', friendRoutes);
app.use('/plans', planRoutes);
app.use('/notifications', notificationRoutes);
app.use('/uploads', uploadRoutes);
app.use('/restaurants', restaurantRoutes);
app.get('/health', (_req, res) => res.json({ ok: true }));

export default app;
