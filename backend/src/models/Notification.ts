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
  | 'friend_joined_via_invite'
  | 'plan_winner_closed'        // owner: winner detected closed at plan time
  | 'plan_rescheduled'          // members: owner rescheduled
  | 'plan_restaurant_changed'   // members: owner switched restaurant
  | 'plan_kept_despite_hours'   // members: owner kept despite closed warning
  | 'join_request_received'    // owner: someone requested to join
  | 'join_request_approved'    // requester: request was approved
  | 'join_request_denied';     // requester: request was denied

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
      enum: ['plan_invite', 'group_swipe_invite', 'rsvp_response', 'group_swipe_result', 'swipe_completed', 'friend_request', 'friend_accepted', 'plan_reminder', 'rsvp_deadline_passed', 'rsvp_deadline_missed_organizer', 'voting_open', 'plan_cancelled', 'organizer_delegated', 'organizer_changed', 'participant_left', 'plan_auto_cancelled', 'friend_joined_via_invite', 'plan_winner_closed', 'plan_rescheduled', 'plan_restaurant_changed', 'plan_kept_despite_hours', 'join_request_received', 'join_request_approved', 'join_request_denied'],
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
