import mongoose, { Document, Schema } from 'mongoose';

export type NotificationType =
  | 'plan_invite'
  | 'group_swipe_invite'
  | 'rsvp_response'
  | 'group_swipe_result'
  | 'swipe_completed'
  | 'friend_request'
  | 'friend_accepted'
  | 'plan_reminder'
  | 'rsvp_deadline_passed'
  | 'rsvp_deadline_missed_organizer'
  | 'voting_open'
  | 'plan_cancelled'
  | 'organizer_delegated'
  | 'organizer_changed'
  | 'participant_left'
  | 'plan_auto_cancelled'
  | 'friend_joined_via_invite';

export interface INotification extends Document {
  userId: mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['plan_invite', 'group_swipe_invite', 'rsvp_response', 'group_swipe_result', 'swipe_completed', 'friend_request', 'friend_accepted', 'plan_reminder', 'rsvp_deadline_passed', 'rsvp_deadline_missed_organizer', 'voting_open', 'plan_cancelled', 'organizer_delegated', 'organizer_changed', 'participant_left', 'plan_auto_cancelled', 'friend_joined_via_invite'],
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    data: { type: Schema.Types.Mixed },
    read: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

export default mongoose.model<INotification>('Notification', NotificationSchema);
