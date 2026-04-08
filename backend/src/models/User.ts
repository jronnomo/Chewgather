import mongoose, { Document, Schema } from 'mongoose';

export interface IUserPreferences {
  name: string;
  cuisines: string[];
  budget: string[];
  dietary: string[];
  atmosphere: string[];
  groupSize: string[];
  distance: string;
  isDarkMode?: boolean;
  notificationsEnabled?: boolean;
}

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  phone?: string;
  avatarUri?: string;
  pushToken?: string;
  inviteCode: string;
  preferences?: IUserPreferences;
  favorites: string[];
  favoritedRestaurants: Record<string, unknown>[];
  createdAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    phone: { type: String, trim: true },
    avatarUri: { type: String },
    pushToken: { type: String },
    inviteCode: { type: String, required: true, unique: true },
    preferences: {
      type: {
        name: String,
        cuisines: [String],
        budget: [String],
        dietary: [String],
        atmosphere: [String],
        groupSize: [String],
        distance: String,
        isDarkMode: Boolean,
        notificationsEnabled: Boolean,
      },
      default: undefined,
    },
    favorites: { type: [String], default: [] },
    favoritedRestaurants: { type: Schema.Types.Mixed, default: [] },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

export default mongoose.model<IUser>('User', UserSchema);
