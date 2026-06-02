import mongoose, { Document, Schema } from 'mongoose';

export type InviteStatus = 'pending' | 'accepted' | 'declined';

/** Shape of a Google Places opening period — wall-clock, restaurant-local time. */
export interface IOpeningPeriod {
  open: { day: number; hour: number; minute: number };
  close?: { day: number; hour: number; minute: number };
}

export interface IPlanInvite {
  userId: mongoose.Types.ObjectId;
  name: string;
  avatarUri?: string;
  status: InviteStatus;
  respondedAt?: Date;
}

export interface IPlanRestaurant {
  id: string;
  name: string;
  imageUrl: string;
  address: string;
  cuisine: string;
  priceLevel: number;
  rating: number;
  /** Persisted from Google Places so backend can detect closed winner at confirm time. */
  openingPeriods?: IOpeningPeriod[];
}

export interface IPlanRestaurantOption {
  id: string;
  name: string;
  imageUrl: string;
  address: string;
  cuisine: string;
  priceLevel: number;
  rating: number;
  distance: string;
  tags: string[];
  isOpenNow: boolean;
  phone: string;
  hours: string;
  description: string;
  photos: string[];
  reviewCount: number;
  hasReservation: boolean;
  noiseLevel: string;
  seating: string[];
  busyLevel: string;
  isOutsidePreferredRadius?: boolean;
  websiteUri?: string;
  /** Persisted from Google Places so backend can detect closed winner at confirm time. */
  openingPeriods?: IOpeningPeriod[];
}

export interface IPlan extends Document {
  type: 'planned' | 'group-swipe';
  title: string;
  date?: string;
  time?: string;
  ownerId: mongoose.Types.ObjectId;
  status: 'voting' | 'confirmed' | 'completed' | 'cancelled';
  cancelledAt?: Date;
  cuisine: string;
  budget: string;
  restaurant?: IPlanRestaurant;
  invites: IPlanInvite[];
  rsvpDeadline?: Date;
  votingOpenedAt?: Date;
  options: string[];
  votes: Record<string, string[]>;
  restaurantOptions: IPlanRestaurantOption[];
  restaurantCount?: number;
  allowCurveball?: boolean;
  curveballIds?: string[];
  swipesCompleted: string[];
  /** Set when a confirmed winner is detected closed at the plan time. Cleared on reschedule/switch. */
  winnerClosedAt?: Date;
  /** true after owner taps "Don't remind me again". Suppresses modal auto-open only. */
  winnerClosedDismissed?: boolean;
  /** Dedup flag — true after the one-time member notification for keep/dismiss has been sent. */
  winnerClosedMembersNotified?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PlanInviteSchema = new Schema<IPlanInvite>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    avatarUri: { type: String },
    status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
    respondedAt: { type: Date },
  },
  { _id: false }
);

const PlanRestaurantSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    imageUrl: { type: String, required: true },
    address: { type: String, required: true },
    cuisine: { type: String, required: true },
    priceLevel: { type: Number, required: true },
    rating: { type: Number, required: true },
    openingPeriods: { type: Schema.Types.Mixed, default: undefined },
  },
  { _id: false }
);

const PlanRestaurantOptionSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    imageUrl: { type: String, required: true },
    address: { type: String, required: true },
    cuisine: { type: String, required: true },
    priceLevel: { type: Number, required: true },
    rating: { type: Number, required: true },
    distance: { type: String, default: '' },
    tags: { type: [String], default: [] },
    isOpenNow: { type: Boolean, default: false },
    phone: { type: String, default: '' },
    hours: { type: String, default: '' },
    description: { type: String, default: '' },
    photos: { type: [String], default: [] },
    reviewCount: { type: Number, default: 0 },
    hasReservation: { type: Boolean, default: false },
    noiseLevel: { type: String, default: 'moderate' },
    seating: { type: [String], default: [] },
    busyLevel: { type: String, default: 'moderate' },
    isOutsidePreferredRadius: { type: Boolean, default: false },
    websiteUri: { type: String, default: '' },
    openingPeriods: { type: Schema.Types.Mixed, default: undefined },
  },
  { _id: false }
);

const PlanSchema = new Schema<IPlan>(
  {
    type: { type: String, enum: ['planned', 'group-swipe'], default: 'planned' },
    title: { type: String, required: true, trim: true },
    date: { type: String },
    time: { type: String },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['voting', 'confirmed', 'completed', 'cancelled'], default: 'voting' },
    cancelledAt: { type: Date },
    cuisine: { type: String, default: 'Any' },
    budget: { type: String, default: '$$' },
    restaurant: { type: PlanRestaurantSchema },
    invites: { type: [PlanInviteSchema], default: [] },
    rsvpDeadline: { type: Date },
    votingOpenedAt: { type: Date },
    options: { type: [String], default: [] },
    votes: { type: Map, of: [String], default: {} },
    restaurantCount: { type: Number, default: 10 },
    allowCurveball: { type: Boolean, default: false },
    curveballIds: { type: [String], default: [] },
    restaurantOptions: { type: [PlanRestaurantOptionSchema], default: [] },
    swipesCompleted: { type: [String], default: [] },
    winnerClosedAt: { type: Date },
    winnerClosedDismissed: { type: Boolean, default: false },
    winnerClosedMembersNotified: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      // F-005-017: Convert Mongoose Map to plain object for votes field
      transform: (_doc: IPlan, ret: Record<string, unknown>) => {
        if (ret.votes instanceof Map) {
          ret.votes = Object.fromEntries(ret.votes);
        }
        return ret;
      },
    },
  }
);

// Indexes for trending-with-friends aggregation (REQ-002 delta D-3)
PlanSchema.index({ ownerId: 1, status: 1, updatedAt: -1 });
PlanSchema.index({ 'invites.userId': 1, status: 1, updatedAt: -1 });

export default mongoose.model<IPlan>('Plan', PlanSchema);
