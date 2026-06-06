import * as SecureStore from 'expo-secure-store';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

const TOKEN_KEY = 'chewabl_auth_token';

/** Thrown on network / connectivity errors (timeout, no internet, DNS failure) */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** Thrown when the server returns 401 (token expired or invalid) */
export class SessionExpiredError extends Error {
  constructor() {
    super('Session expired. Please sign in again.');
    this.name = 'SessionExpiredError';
  }
}

/** Extended request options — adds custom flags to the standard RequestInit */
interface RequestOptions extends RequestInit {
  skipSessionExpiry?: boolean;
}

// Dedup flag to prevent concurrent 401s from clearing token multiple times
let _handling401 = false;

// Callback for global session-expiry notification (set by AuthContext)
let _onSessionExpired: (() => void) | null = null;

export function registerSessionExpiredHandler(cb: () => void): void {
  _onSessionExpired = cb;
}

export function unregisterSessionExpiredHandler(): void {
  _onSessionExpired = null;
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function request<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { skipSessionExpiry, ...fetchOptions } = options;
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    }).catch((err: unknown) => {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new NetworkError('Request timed out. Please try again.');
      }
      throw new NetworkError(err instanceof TypeError
        ? 'Cannot connect to server. Please check your connection or try again later.'
        : String(err)
      );
    });

    if (response.status === 401) {
      if (skipSessionExpiry) {
        // Auth endpoint — parse body and throw plain Error so caller gets the message
        const body = await response.text();
        let message = 'Invalid credentials';
        try {
          const parsed = JSON.parse(body);
          message = parsed.error || message;
        } catch {
          // body wasn't JSON
        }
        throw new Error(message);
      }
      // All other 401s: global session expiry flow
      if (!_handling401) {
        _handling401 = true;
        try {
          await clearToken();
          _onSessionExpired?.();
        } finally {
          _handling401 = false;
        }
      }
      throw new SessionExpiredError();
    }

    if (!response.ok) {
      const body = await response.text();
      let message = `API ${response.status}`;
      try {
        const parsed = JSON.parse(body);
        message = parsed.error || message;
      } catch {
        // body wasn't JSON
      }
      throw new Error(message);
    }

    return response.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body: unknown, opts?: Pick<RequestOptions, 'skipSessionExpiry'>) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body), ...opts }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown, opts?: Pick<RequestOptions, 'skipSessionExpiry'>) =>
    request<T>(path, {
      method: 'DELETE',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...opts,
    }),
};
