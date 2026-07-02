# Chewgather — Claude Instructions

## Definition of Done

A feature is **not done** until ALL of the following pass:

1. `npx tsc --noEmit` — zero errors
2. Every new/changed screen has been read and visually verified in code (not just compiled)
3. Dark mode checklist passed (see below)
4. No follow-up correction commits — get it right before declaring done

Do not ask the user to test. Do not commit until these pass.

## Quality Standards (learned from post-mortem)

- **Never trust subagent output** without reading the changed files yourself before committing
- **Module-level helper components** (functions defined outside the main component) cannot call `useColors()` automatically — add `const Colors = useColors()` inside the function body explicitly
- **Declare done only once** — multiple correction commits after "done" is a failure mode to avoid

## Dark Mode Checklist

Every screen/component touched must pass this before committing:

- [ ] Root container: `{ backgroundColor: Colors.background }` inline override
- [ ] All `<Text>` elements: `{ color: Colors.text }` or `{ color: Colors.textSecondary }` inline
- [ ] Card/surface `<View>` backgrounds: `{ backgroundColor: Colors.card }` inline
- [ ] Border colors on inputs/cards: `{ borderColor: Colors.border }` inline
- [ ] Any module-level helper component calls `const Colors = useColors()` inside its own body

## Color System Pattern

All files use this two-level pattern:

```ts
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';

const Colors = StaticColors; // ← module level, for StyleSheet.create()

export default function MyScreen() {
  const Colors = useColors(); // ← component level, shadows above for reactive dark mode

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <Text style={[styles.title, { color: Colors.text }]}>...</Text>
    </View>
  );
}
```

`StyleSheet.create()` is static — it never updates. Inline overrides are required for all visible color properties.

## Testing Requirement

**Always run `npx tsc --noEmit` before considering any feature done.** Fix all TypeScript errors without asking.

Do not ask the user to test features — run the type check yourself and fix issues proactively.

## Key Architecture

- **Expo Router** (file-based routing) — use `as never` cast when route string isn't in typed routes
- **React Query v5** — `useQuery`, `useMutation`; `queryKey` arrays required
- **ThemeContext** (`context/ThemeContext.tsx`) — `useColors()` returns LIGHT or DARK palette based on `preferences.isDarkMode`
- **AppContext** — preferences, plans, restaurants, location, avatar persistence
- **AuthContext** — user, isAuthenticated, signIn/signUp/signOut
- **Google Places API (New)** — `POST /v1/places:searchNearby`; price levels must use named enums (`PRICE_LEVEL_INEXPENSIVE` etc.)
- **Backend** (`backend/`) — Node/Express/TypeScript/MongoDB; deployed to Fly.io (`chewgather-backend`, prod db `chewabl-prod`); dev `EXPO_PUBLIC_API_URL` in `.env`, prod URL injected by `eas.json`

## Install Packages

Use `npm install <pkg> --legacy-peer-deps` (bun is not available in shell).
