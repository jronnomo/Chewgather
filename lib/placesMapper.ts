import { Restaurant } from '../types';
import { Place, PlacePhoto, Coords } from '../services/googlePlaces';

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || '';

const PRIMARY_TYPE_TO_CUISINE: Record<string, string> = {
  italian_restaurant: 'Italian',
  japanese_restaurant: 'Japanese',
  ramen_restaurant: 'Japanese',
  sushi_restaurant: 'Japanese',
  mexican_restaurant: 'Mexican',
  thai_restaurant: 'Thai',
  indian_restaurant: 'Indian',
  chinese_restaurant: 'Chinese',
  american_restaurant: 'American',
  hamburger_restaurant: 'American',
  barbecue_restaurant: 'American',
  french_restaurant: 'French',
  korean_restaurant: 'Korean',
  mediterranean_restaurant: 'Mediterranean',
  greek_restaurant: 'Mediterranean',
  vietnamese_restaurant: 'Vietnamese',
  african_restaurant: 'Ethiopian',
};

const PRICE_LEVEL_MAP: Record<string, 1 | 2 | 3 | 4> = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

function haversineDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildPhotoUrl(photo: PlacePhoto): string {
  return `https://places.googleapis.com/v1/${photo.name}/media?maxHeightPx=800&key=${API_KEY}`;
}

function getTodayHours(weekdayDescriptions?: string[]): string {
  if (!weekdayDescriptions || weekdayDescriptions.length === 0) return '';
  // weekdayDescriptions: index 0 = Monday … index 6 = Sunday
  const jsDay = new Date().getDay(); // 0=Sun, 1=Mon … 6=Sat
  const idx = jsDay === 0 ? 6 : jsDay - 1;
  const desc = weekdayDescriptions[idx] || '';
  // Strip "Monday: " prefix
  return desc.replace(/^[^:]+:\s*/, '');
}


interface ClosingInfo {
  minutesUntilClose: number;
  closeHour24: number;
  closeMinute: number;
  isOpen24Hours: boolean;
}

function parseClosingInfo(place: Place): ClosingInfo | undefined {
  const descs = place.regularOpeningHours?.weekdayDescriptions;
  if (!descs) return undefined;
  const jsDay = new Date().getDay();
  const idx = jsDay === 0 ? 6 : jsDay - 1;
  const desc = descs[idx] || '';

  if (/open 24 hours/i.test(desc)) {
    return { minutesUntilClose: Infinity, closeHour24: 0, closeMinute: 0, isOpen24Hours: true };
  }

  if (/closed/i.test(desc) && !/\d/.test(desc)) return undefined;

  const rangeMatch = desc.match(
    /(\d{1,2}):(\d{2})\s*(AM|PM)\s*[–\-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i
  );
  if (!rangeMatch) return undefined;

  const openH = parseInt(rangeMatch[1]);
  const openAMPM = rangeMatch[3].toUpperCase();
  let open24 = openH;
  if (openAMPM === 'PM' && openH !== 12) open24 = openH + 12;
  else if (openAMPM === 'AM' && openH === 12) open24 = 0;

  const closeH = parseInt(rangeMatch[4]);
  const closeM = parseInt(rangeMatch[5]);
  const closeAMPM = rangeMatch[6].toUpperCase();
  let close24 = closeH;
  if (closeAMPM === 'PM' && closeH !== 12) close24 = closeH + 12;
  else if (closeAMPM === 'AM' && closeH === 12) close24 = 0;

  let closeMins = close24 * 60 + closeM;
  const openMins = open24 * 60;
  if (closeMins <= openMins) closeMins += 24 * 60;

  // Compute current time in the restaurant's timezone, not the user's local time.
  // utcOffsetMinutes is the restaurant's offset from UTC (e.g., -420 for PDT, -240 for EDT).
  const now = new Date();
  let nowMins: number;
  if (place.utcOffsetMinutes !== undefined) {
    // Get current UTC time in minutes, then apply the restaurant's offset
    const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
    nowMins = utcMins + place.utcOffsetMinutes;
    // Normalize to 0-1440 range
    if (nowMins < 0) nowMins += 24 * 60;
    if (nowMins >= 24 * 60) nowMins -= 24 * 60;
  } else {
    // Fallback to local time if no timezone data
    nowMins = now.getHours() * 60 + now.getMinutes();
  }
  if (nowMins < openMins && closeMins > 24 * 60) nowMins += 24 * 60;

  return {
    minutesUntilClose: closeMins - nowMins,
    closeHour24: close24,
    closeMinute: closeM,
    isOpen24Hours: false,
  };
}

function getClosingSoon(place: Place): string | undefined {
  const info = parseClosingInfo(place);
  if (!info || info.isOpen24Hours) return undefined;
  const diff = info.minutesUntilClose;
  if (diff > 0 && diff <= 120) {
    const hrs = Math.floor(diff / 60);
    const mins = diff % 60;
    const timeStr = hrs > 0 ? `${hrs}h${mins > 0 ? ` ${mins}m` : ''}` : `${mins}m`;
    return `Closes in ${timeStr}`;
  }
  return undefined;
}

function formatCloseTime(hour24: number, minute: number): string {
  const h12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
  const ampm = hour24 < 12 ? 'AM' : 'PM';
  return minute > 0 ? `${h12}:${minute.toString().padStart(2, '0')} ${ampm}` : `${h12} ${ampm}`;
}

function getLastCallDeal(place: Place): string | undefined {
  const info = parseClosingInfo(place);
  if (!info || info.isOpen24Hours) return undefined;
  const diff = info.minutesUntilClose;

  if (diff > 0 && diff <= 30) {
    return `Last call – ${diff}m left!`;
  }

  if (diff > 30 && diff <= 90) {
    const hrs = Math.floor(diff / 60);
    const mins = diff % 60;
    const timeStr = hrs > 0 ? `${hrs}h${mins > 0 ? ` ${mins}m` : ''}` : `${mins}m`;
    return `Closing soon – ${timeStr} left`;
  }

  const nowHour = new Date().getHours();
  if (nowHour >= 21 && info.closeHour24 < 6 && diff > 0) {
    return `Open late – until ${formatCloseTime(info.closeHour24, info.closeMinute)}`;
  }

  return undefined;
}

// ── Vibe scoring ──────────────────────────────────────────────────────────────

const LIVELY_TYPE_WEIGHTS: Record<string, number> = {
  night_club: 0.35,
  bar: 0.20,
};

const QUIET_TYPE_WEIGHTS: Record<string, number> = {
  fine_dining_restaurant: -0.20,
  cafe: -0.15,
  coffee_shop: -0.15,
  brunch_restaurant: -0.10,
  breakfast_restaurant: -0.10,
};

/**
 * Compute a vibe score from -1.0 (quietest) to +1.0 (liveliest)
 * using atmosphere booleans, place types, and price level.
 */
function computeVibeScore(place: Place): number {
  let score = 0;

  // Boolean signals
  if (place.liveMusic) score += 0.30;
  if (place.goodForWatchingSports) score += 0.25;
  if (place.goodForGroups) score += 0.20;
  if (place.servesCocktails) score += 0.10;
  if (place.servesBeer) score += 0.08;
  if (place.outdoorSeating) score += 0.05;
  if (place.goodForChildren) score -= 0.20;
  if (place.servesCoffee) score -= 0.10;
  if (place.reservable) score -= 0.10;
  if (place.servesWine) score -= 0.08;

  // Type-based signals
  const types = place.types ?? [];
  for (const t of types) {
    if (LIVELY_TYPE_WEIGHTS[t] !== undefined) score += LIVELY_TYPE_WEIGHTS[t];
    if (QUIET_TYPE_WEIGHTS[t] !== undefined) score += QUIET_TYPE_WEIGHTS[t];
  }

  // Price-based signals
  const pl = place.priceLevel;
  if (pl === 'PRICE_LEVEL_VERY_EXPENSIVE') score -= 0.05;
  else if (pl === 'PRICE_LEVEL_EXPENSIVE') score -= 0.03;
  else if (pl === 'PRICE_LEVEL_INEXPENSIVE') score += 0.03;

  // Popularity signal
  if ((place.userRatingCount ?? 0) > 1000) score += 0.03;

  return Math.max(-1, Math.min(1, score));
}

function deriveNoiseLevel(vibeScore: number): 'quiet' | 'moderate' | 'lively' {
  if (vibeScore <= -0.15) return 'quiet';
  if (vibeScore >= 0.15) return 'lively';
  return 'moderate';
}

/**
 * Returns 0-1 affinity between a restaurant's vibeScore and a user's atmosphere preference.
 * Higher = better match.
 */
export function vibeAffinity(vibeScore: number, atmosphere: string | string[]): number {
  const atmos = Array.isArray(atmosphere) ? atmosphere : [atmosphere];
  if (atmos.length === 0 || atmos.includes('Moderate')) return 0.5;
  if (atmos.includes('Quiet') && atmos.includes('Lively')) return 0.5;
  if (atmos.includes('Quiet')) return (1 - vibeScore) / 2;
  if (atmos.includes('Lively')) return (1 + vibeScore) / 2;
  return 0.5;
}

const EXCLUDED_TYPES = new Set([
  'restaurant',
  'food',
  'point_of_interest',
  'establishment',
  'local_business',
  'place',
  'geocode',
]);

function extractTags(types?: string[]): string[] {
  if (!types) return [];
  return types
    .filter(t => !EXCLUDED_TYPES.has(t))
    .map(t =>
      t
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
    )
    .slice(0, 4);
}

export function mapToRestaurant(place: Place, userLocation?: Coords): Restaurant {
  const priceLevel: 1 | 2 | 3 | 4 =
    PRICE_LEVEL_MAP[place.priceLevel ?? ''] ?? 2;

  const cuisine =
    PRIMARY_TYPE_TO_CUISINE[place.primaryType ?? ''] ||
    place.types?.map(t => PRIMARY_TYPE_TO_CUISINE[t]).find(Boolean) ||
    'Restaurant';

  let distanceStr = '';
  if (userLocation && place.location) {
    const d = haversineDistanceMiles(
      userLocation.latitude,
      userLocation.longitude,
      place.location.latitude,
      place.location.longitude
    );
    distanceStr = d < 0.1 ? '< 0.1 mi' : `${d.toFixed(1)} mi`;
  }

  const allPhotos = (place.photos || []).map(buildPhotoUrl);
  const fallbackImage =
    'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800';
  const imageUrl = allPhotos[0] || fallbackImage;

  return {
    id: place.id,
    placeId: place.id,
    name: place.displayName?.text || 'Unknown Restaurant',
    cuisine,
    priceLevel,
    rating: place.rating ?? 0,
    reviewCount: place.userRatingCount ?? 0,
    distance: distanceStr,
    address: place.formattedAddress || '',
    imageUrl,
    photos: allPhotos.length > 0 ? allPhotos : [fallbackImage],
    isOpenNow: place.regularOpeningHours?.openNow ?? false,
    hasReservation: place.reservable ?? false,
    websiteUri: place.websiteUri ?? undefined,
    phone: place.internationalPhoneNumber || '',
    hours: getTodayHours(place.regularOpeningHours?.weekdayDescriptions),
    description: place.editorialSummary?.text || '',
    tags: extractTags(place.types),
    noiseLevel: deriveNoiseLevel(computeVibeScore(place)),
    busyLevel: 'moderate',
    seating: place.outdoorSeating ? ['indoor', 'outdoor'] : ['indoor'],
    vibeScore: computeVibeScore(place),
    lastCallDeal: getLastCallDeal(place),
    closingSoon: getClosingSoon(place),
  };
}
