const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || '';
const BASE_URL = 'https://places.googleapis.com/v1';

if (!API_KEY) {
  console.warn('[Places] EXPO_PUBLIC_GOOGLE_PLACES_API_KEY is not set');
}

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.primaryType',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.regularOpeningHours',
  'places.internationalPhoneNumber',
  'places.photos',
  'places.editorialSummary',
  'places.types',
  'places.reservable',
  'places.websiteUri',
].join(',');

export const CUISINE_TYPE_MAP: Record<string, string[]> = {
  Italian: ['italian_restaurant'],
  Japanese: ['japanese_restaurant', 'ramen_restaurant', 'sushi_restaurant'],
  Mexican: ['mexican_restaurant'],
  Thai: ['thai_restaurant'],
  Indian: ['indian_restaurant'],
  Chinese: ['chinese_restaurant'],
  American: ['american_restaurant', 'hamburger_restaurant', 'barbecue_restaurant'],
  French: ['french_restaurant'],
  Korean: ['korean_restaurant'],
  Mediterranean: ['mediterranean_restaurant', 'greek_restaurant'],
  Vietnamese: ['vietnamese_restaurant'],
  Ethiopian: ['african_restaurant'],
};

const BUDGET_MAP: Record<string, string[]> = {
  '$': ['PRICE_LEVEL_INEXPENSIVE'],
  '$$': ['PRICE_LEVEL_MODERATE'],
  '$$$': ['PRICE_LEVEL_EXPENSIVE'],
  '$$$$': ['PRICE_LEVEL_VERY_EXPENSIVE'],
};

export interface Coords {
  latitude: number;
  longitude: number;
}

export interface PlacePhoto {
  name: string;
  widthPx: number;
  heightPx: number;
}

export interface Place {
  id: string;
  displayName?: { text: string; languageCode: string };
  primaryType?: string;
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  regularOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];
  };
  internationalPhoneNumber?: string;
  photos?: PlacePhoto[];
  editorialSummary?: { text: string; languageCode: string };
  types?: string[];
  reservable?: boolean;
  websiteUri?: string;
}

export interface SearchNearbyParams {
  location: Coords;
  radiusMeters: number;
  includedTypes?: string[];
  priceLevels?: string[];
  minRating?: number;
  maxResultCount?: number;
}

export async function searchNearby(params: SearchNearbyParams): Promise<Place[]> {
  if (!API_KEY) return [];

  const body: Record<string, unknown> = {
    locationRestriction: {
      circle: {
        center: {
          latitude: params.location.latitude,
          longitude: params.location.longitude,
        },
        radius: params.radiusMeters,
      },
    },
    maxResultCount: params.maxResultCount || 20,
  };

  if (params.includedTypes && params.includedTypes.length > 0) {
    body.includedTypes = params.includedTypes;
  }
  if (params.priceLevels && params.priceLevels.length > 0) {
    body.priceLevels = params.priceLevels;
  }
  if (params.minRating !== undefined) {
    body.minRating = params.minRating;
  }

  const response = await fetch(`${BASE_URL}/places:searchNearby`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Places API searchNearby ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  return data.places || [];
}

export async function searchText(params: {
  textQuery: string;
  location?: Coords;
  radiusMeters?: number;
  priceLevels?: string[];
  includedType?: string;
  maxResultCount?: number;
}): Promise<Place[]> {
  if (!API_KEY) return [];

  const body: Record<string, unknown> = {
    textQuery: params.textQuery,
    maxResultCount: params.maxResultCount || 20,
  };

  if (params.location && params.radiusMeters) {
    body.locationBias = {
      circle: {
        center: {
          latitude: params.location.latitude,
          longitude: params.location.longitude,
        },
        radius: params.radiusMeters,
      },
    };
  }

  if (params.priceLevels && params.priceLevels.length > 0) {
    body.priceLevels = params.priceLevels;
  }
  if (params.includedType) {
    body.includedType = params.includedType;
  }

  const response = await fetch(`${BASE_URL}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Places API searchText ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  return data.places || [];
}

export async function getPlaceDetails(placeId: string): Promise<Place | null> {
  if (!API_KEY) return null;

  const singleFieldMask = FIELD_MASK.split(',')
    .map(f => f.replace(/^places\./, ''))
    .join(',');

  const response = await fetch(`${BASE_URL}/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': singleFieldMask,
    },
  });

  if (!response.ok) {
    throw new Error(`Places API getPlaceDetails error: ${response.status}`);
  }

  return response.json();
}

export function buildSearchNearbyParams(
  preferences: {
    cuisines: string[];
    budget: string;
    atmosphere: string;
    distance: string;
  },
  location: Coords,
  maxResultCount?: number
): SearchNearbyParams {
  const radiusMiles = parseFloat(preferences.distance) || 5;
  const radiusMeters = Math.round(radiusMiles * 1609.34);

  const includedTypes: string[] = [];
  for (const cuisine of preferences.cuisines) {
    const types = CUISINE_TYPE_MAP[cuisine];
    if (types) includedTypes.push(...types);
  }

  const priceLevels = BUDGET_MAP[preferences.budget] || [];

  let minRating: number | undefined;
  if (preferences.atmosphere === 'Quiet') minRating = 4.5;

  return {
    location,
    radiusMeters,
    includedTypes: includedTypes.length > 0 ? includedTypes : undefined,
    priceLevels: priceLevels.length > 0 ? priceLevels : undefined,
    minRating,
    maxResultCount: maxResultCount ?? 10,
  };
}
