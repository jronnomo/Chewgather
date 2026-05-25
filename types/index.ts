export interface OpeningPeriod {
  open: { day: number; hour: number; minute: number };
  close?: { day: number; hour: number; minute: number };
}

export interface Restaurant {
  id: string;
  placeId?: string;
  name: string;
  cuisine: string;
  priceLevel: 1 | 2 | 3 | 4;
  rating: number;
  reviewCount: number;
  distance: string;
  address: string;
  imageUrl: string;
  tags: string[];
  isOpenNow: boolean;
  hasReservation: boolean;
  noiseLevel: 'quiet' | 'moderate' | 'lively';
  seating: ('indoor' | 'outdoor')[];
  busyLevel?: 'low' | 'moderate' | 'busy';
  phone: string;
  websiteUri?: string;
  hours: string;
  description: string;
  lastCallDeal?: string;
  closingSoon?: string;
  photos: string[];
  isOutsidePreferredRadius?: boolean;
  vibeScore?: number; // -1.0 (quiet) to +1.0 (lively), computed by placesMapper
  latitude?: number; // geo coords persisted by mapToRestaurant (delta D-1)
  longitude?: number;
  openingPeriods?: OpeningPeriod[];
}

export interface PlanInvite {
  userId: string;
  name: string;
  avatarUri?: string;
  status: 'pending' | 'accepted' | 'declined';
  respondedAt?: string;
}

export interface DiningPlan {
  id: string;
  type?: 'planned' | 'group-swipe';
  title: string;
  date?: string;
  time?: string;
  restaurant?: Restaurant;
  status: 'voting' | 'confirmed' | 'completed' | 'cancelled';
  cancelledAt?: string;
  cuisine: string;
  budget: string;
  /** @deprecated Use `invites` instead. Kept for mock data compatibility. */
  invitees?: Invitee[];
  /** Backend-driven invites with RSVP status */
  invites?: PlanInvite[];
  rsvpDeadline?: string;
  votingOpenedAt?: string;
  ownerId?: string;
  ownerName?: string;
  ownerAvatarUri?: string;
  options: Restaurant[];
  votes: Record<string, string[]>;
  restaurantOptions?: Restaurant[];
  restaurantCount?: number;
  allowCurveball?: boolean;
  curveballIds?: string[];
  swipesCompleted?: string[];
  createdAt: string;
}

export type PlanPhase = 'rsvp_open' | 'voting_open' | 'confirmed' | 'completed' | 'cancelled';

export interface Invitee {
  id: string;
  name: string;
  avatar: string;
  hasVoted: boolean;
}

export interface UserPreferences {
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

export interface Friend {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  avatarUri?: string;
  mutualPlans?: number;
}

export interface FriendRequest {
  id: string;
  from?: Friend;
  to?: Friend;
  direction: 'received' | 'sent';
  createdAt: string;
}

export interface BackendUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  avatarUri?: string;
  pushToken?: string;
  inviteCode: string;
  preferences?: UserPreferences;
  favorites?: string[];
  createdAt: string;
}

export type CuisineType =
  | 'Italian'
  | 'Japanese'
  | 'Mexican'
  | 'Thai'
  | 'Indian'
  | 'Chinese'
  | 'American'
  | 'French'
  | 'Korean'
  | 'Mediterranean'
  | 'Vietnamese'
  | 'Ethiopian';

export type BudgetLevel = '$' | '$$' | '$$$' | '$$$$';

export type DietaryRestriction =
  | 'Vegetarian'
  | 'Vegan'
  | 'Gluten-Free'
  | 'Halal'
  | 'Kosher'
  | 'Dairy-Free'
  | 'Nut-Free';

export interface GroupSession {
  id: string;
  planId: string;
  title: string;
  restaurants: Restaurant[];
  members: GroupMember[];
  swipes: Record<string, Record<string, 'yes' | 'no'>>;
  status: 'swiping' | 'results';
  createdAt: string;
}

export interface GroupMember {
  id: string;
  name: string;
  avatar?: string;
  completedSwiping: boolean;
}

export interface SwipeResult {
  restaurantId: string;
  restaurant: Restaurant;
  yesCount: number;
  totalMembers: number;
  isMatch: boolean;
}

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
  | 'plan_auto_cancelled';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Trending with Friends types (REQ-005, delta D-4)
// ---------------------------------------------------------------------------

export interface FriendEngagement {
  friends: Array<Pick<Friend, 'id' | 'name' | 'avatarUri'>>;
  count: number;
  lastActivityAt: string;
}

export interface TrendingApiFriend {
  id: string;
  name: string;
  avatarUri?: string;
  lastActivityAt: string;
}

export interface TrendingApiItem {
  placeId: string;
  friendCount: number;
  lastActivityAt: string;
  friends: TrendingApiFriend[];
}

export interface TrendingApiResponse {
  friendCount: number;
  items: TrendingApiItem[];
}
