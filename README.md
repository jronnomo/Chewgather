# Chewabl - Quick Dining Picks

A social dining discovery app that helps you and your friends decide where to eat. Swipe through nearby restaurants, create dining plans, and let group voting settle the "where should we eat?" debate once and for all.

Built with React Native and Expo for iOS and Android.

## Features

### Swipe to Discover
Browse nearby restaurants with a Tinder-style swipe interface. Swipe right to save, left to skip. Your preferences (cuisine, budget, dietary needs, distance) shape what you see. Powered by the Google Places API for real restaurant data based on your location.

### Group Swipe Voting
Can't agree on a restaurant? Create a group swipe session and invite friends. Everyone swipes independently, and Chewabl finds the restaurants your group agrees on. The flow moves through four phases: lobby, swiping, waiting for others, and results with match scores.

### Dining Plans
Plan ahead with structured dining events. Set a date, time, cuisine, and budget. Invite friends with RSVP tracking and deadlines. Plans support both "planned" events (pick a restaurant) and "group-swipe" sessions (vote together).

### Friends & Social
Add friends via phone contacts or unique invite codes. Manage friend requests, see mutual dining plans, and build your dining crew. Push notifications keep everyone in the loop on invites and RSVPs.

### Personalized Preferences
Onboarding captures your taste profile: favorite cuisines, budget range, dietary restrictions, preferred atmosphere, group size, and search radius. These preferences power restaurant recommendations across the app.

### Dark Mode with Chomp Transition
Toggle dark mode from your profile with a custom animated transition. Four sequential cookie-bite shapes eat away the old theme to reveal the new one, complete with scalloped edges and haptic feedback. Respects reduced-motion accessibility settings.

## Tech Stack

### Frontend
- **React Native 0.81** + **Expo 54** + **Expo Router** (file-based routing)
- **React 19** with **TypeScript 5.9**
- **React Query v5** for server state management
- **Google Places API (New)** for real-time restaurant data
- **react-native-svg** for the animated theme transition
- **expo-haptics**, **expo-location**, **expo-contacts**, **expo-image-picker**, **expo-notifications**
- **Lucide React Native** for icons

### Backend
- **Node.js** + **Express** + **TypeScript**
- **MongoDB** with **Mongoose** ODM
- **JWT authentication** (90-day tokens, bcrypt password hashing)
- **Expo Server SDK** for push notifications
- Rate limiting on auth endpoints
- Deployed to **Fly.io** (`chewgether-backend`, https://chewgether-backend.fly.dev — config in `backend/fly.toml`)

## Project Structure

```
app/                          # Screens (Expo Router file-based routing)
  (tabs)/
    (home)/index.tsx          # Home — quick actions + restaurant collections
    discover/index.tsx        # Search & filter restaurants
    plans/index.tsx           # Upcoming/past dining plans
    friends/index.tsx         # Friends list, requests, add friends
    profile/index.tsx         # Profile, preferences, dark mode toggle
  swipe.tsx                   # Solo swipe interface
  group-session.tsx           # Group swipe voting (lobby → swipe → results)
  plan-event.tsx              # Create a dining plan
  onboarding.tsx              # Preference setup wizard
  auth.tsx                    # Sign in / sign up
  restaurant/[id].tsx         # Restaurant detail

components/
  RestaurantCard.tsx          # Restaurant display (horizontal/vertical/compact)
  SwipeCard.tsx               # Draggable swipe card with gesture handling
  PlanCard.tsx                # Dining plan summary card
  ChompOverlay.tsx            # Animated dark mode transition overlay

context/
  AppContext.tsx              # Global state: preferences, plans, favorites, location
  AuthContext.tsx             # User auth, JWT token management
  ThemeContext.tsx             # Light/dark color palette via useColors()
  ThemeTransitionContext.tsx   # Chomp animation orchestration

services/
  api.ts                      # HTTP client with JWT injection
  auth.ts                     # Register, login, logout, profile
  googlePlaces.ts             # Places API: nearby search, text search, details
  plans.ts                    # CRUD plans, RSVP, submit swipe votes
  friends.ts                  # Friend requests, lookup by phone/invite code
  notifications.ts            # Push notification registration & handling

lib/
  placesMapper.ts             # Google Place → Restaurant type mapping
  restaurantRegistry.ts       # In-memory restaurant cache

backend/src/
  models/                     # Mongoose schemas (User, Plan, Friendship)
  routes/                     # Express routes (auth, users, plans, friends, uploads)
  middleware/auth.ts          # JWT verification middleware
  utils/                      # Invite codes, push notification helpers
  app.ts                      # Express app factory
```

## Getting Started

### Prerequisites
- Node.js 18+
- Xcode (for iOS simulator) or Android Studio (for Android emulator)

### Installation

```bash
git clone https://github.com/jronnomo/Chewabl.git
cd Chewabl

# Install frontend dependencies
npm install --legacy-peer-deps

# Install backend dependencies
cd backend && npm install && cd ..
```

### Environment Variables

Create a `.env` file in the project root:

```
EXPO_PUBLIC_API_URL=<your-backend-url>
EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=<your-google-places-api-key>
```

Create a `.env` file in `backend/`:

```
MONGODB_URI=<your-mongodb-connection-string>
JWT_SECRET=<your-jwt-secret>
```

### Running the App

```bash
# Start the backend
cd backend && npm run dev

# In another terminal — start the Expo dev server
npx expo start

# Press 'i' for iOS simulator or 'a' for Android emulator
# Or run a native build directly:
npx expo run:ios
```

### Running Tests

```bash
# TypeScript type checking (frontend)
npx tsc --noEmit

# Backend unit tests
cd backend && npm test
```

## App Screens

| Screen | Description |
|--------|-------------|
| **Home** | Quick action buttons (Eat Now, Plan Later, Group Swipe) plus curated restaurant collections: nearby tonight, last call deals, closing soon, trending with friends |
| **Discover** | Full-text restaurant search with cuisine and budget filters, plus a "Last Call Deals" toggle |
| **Swipe** | Card stack with drag gestures — swipe right to save, left to skip, with undo support |
| **Group Session** | Collaborative voting: create a session, invite friends, everyone swipes, see consensus matches |
| **Plans** | Tabbed list of upcoming/past plans with RSVP status and inline accept/decline |
| **Plan Event** | Form to create a dining plan with date, time, cuisine, budget, invitees, and RSVP deadline |
| **Friends** | Three tabs: friends list, pending requests (sent/received), add by contacts or invite code |
| **Profile** | Avatar, preference chips, saved restaurants, dark mode toggle, sign out |
| **Onboarding** | Step-by-step preference wizard: name, cuisines, budget, dietary needs, atmosphere, group size, distance |

## API Endpoints

### Auth
- `POST /auth/register` — Create account (name, email, password, phone)
- `POST /auth/login` — Sign in, receive JWT

### Users
- `GET /users/me` — Current user profile
- `PUT /users/me` — Update profile and preferences
- `POST /users/lookup` — Find users by phone numbers
- `GET /users/invite/:code` — Look up user by invite code

### Plans
- `GET /plans` — List user's plans (owned + invited)
- `POST /plans` — Create plan with invites
- `POST /plans/:id/rsvp` — Accept or decline an invite
- `POST /plans/:id/swipe` — Submit swipe votes for group session

### Friends
- `GET /friends` — List accepted friends
- `GET /friends/requests` — List pending requests
- `POST /friends/request` — Send friend request
- `PUT /friends/request/:id` — Accept or decline
- `DELETE /friends/:id` — Remove friend

## License

Private — all rights reserved.
