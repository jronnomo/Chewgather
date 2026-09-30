import './instrument';
import * as Sentry from '@sentry/node';
import mongoose from 'mongoose';
import cron from 'node-cron';
import app from './app';
import { enforceRsvpDeadlines } from './jobs/deadlineEnforcer';

// F-001-001: Refuse to start if JWT_SECRET is missing
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Server cannot start.');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

mongoose
  .connect(process.env.MONGODB_URI!)
  .then(() => {
    console.log('MongoDB connected');

    // Schedule RSVP deadline enforcer every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      try {
        await enforceRsvpDeadlines();
      } catch (err) {
        console.error('Deadline enforcer error:', err);
      }
    });
    console.log('RSVP deadline enforcer scheduled (every 5 min)');

    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(async err => {
    console.error('MongoDB connection error:', err);
    Sentry.captureException(err);
    await Sentry.close(2000);
    process.exit(1);
  });
