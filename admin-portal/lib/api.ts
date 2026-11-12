export type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error?.message ?? 'تعذّر إكمال الطلب.');
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code ?? 'UNKNOWN_ERROR';
    this.details = body?.error?.details;
  }
}

const TOKEN_KEY = 'maquaty_admin_access_token';
const REFRESH_TOKEN_KEY = 'maquaty_admin_refresh_token';

/**
 * استنتاج رابط الـ API بذكاء وقت التشغيل لمنع أخطاء Mixed Content و Static Build Baking
 */
export function resolveApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';

    if (isLocalhost) {
      const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '');
      if (configured && configured !== '/v1') {
        return configured;
      }
      return 'http://127.0.0.1:3000/v1';
    }

    // بيئة الإنتاج على نطاق حقيقي (مثل admin.maquaty.app)
    const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '');
    if (!configured || configured.includes('127.0.0.1') || configured.includes('localhost')) {
      return '/v1';
    }
    return configured;
  }

  // بيئة الـ SSR (الخادم)
  const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '');
  return configured || 'http://127.0.0.1:3000/v1';
}

export const API_BASE_URL = resolveApiBaseUrl();

export const authToken = {
  get(): string | null {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(TOKEN_KEY);
  },
  set(token: string): void {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(TOKEN_KEY, token);
  },
  getRefresh(): string | null {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(REFRESH_TOKEN_KEY);
  },
  setRefresh(token: string): void {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
  },
  setTokens(accessToken: string, refreshToken?: string): void {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(TOKEN_KEY, accessToken);
    if (refreshToken) {
      window.sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    }
  },
  clear(): void {
    if (typeof window === 'undefined') return;
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  token?: string | null;
  stepUpCode?: string;
  _retry?: boolean;
};

let refreshPromise: Promise<string | null> | null = null;

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, token, stepUpCode, headers, _retry, ...rest } = options;
  const bearer = token ?? authToken.get();
  const baseUrl = resolveApiBaseUrl();

  const isAuthPath =
    path.includes('/auth/admin/login') ||
    path.includes('/auth/admin/mfa/verify') ||
    path.includes('/auth/refresh');

  const response = await fetch(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(stepUpCode ? { 'X-MFA-Code': stepUpCode, 'X-Step-Up-Code': stepUpCode } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // في حال 401 وتدوير التوكن التلقائي Single-Flight Token Refresh Rotation
  if (response.status === 401 && !isAuthPath && !_retry) {
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const currentRefresh = authToken.getRefresh();
        if (!currentRefresh) {
          authToken.clear();
          return null;
        }

        try {
          const refreshRes = await fetch(`${baseUrl}/auth/refresh`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ refreshToken: currentRefresh }),
          });

          if (!refreshRes.ok) {
            authToken.clear();
            return null;
          }

          const data = (await refreshRes.json()) as {
            access_token?: string;
            accessToken?: string;
            refresh_token?: string;
            refreshToken?: string;
          };

          const newAccess = data.access_token ?? data.accessToken;
          const newRefresh = data.refresh_token ?? data.refreshToken;

          if (newAccess) {
            authToken.setTokens(newAccess, newRefresh);
            return newAccess;
          }

          authToken.clear();
          return null;
        } catch {
          authToken.clear();
          return null;
        } finally {
          refreshPromise = null;
        }
      })();
    }

    const newToken = await refreshPromise;

    if (newToken) {
      // إعادة المحاولة بالتوكن الجديد
      return apiFetch<T>(path, { ...options, _retry: true, token: newToken });
    }

    // فشل التجديد: إعادة التوجيه لصفحة الدخول إن كانت بيئة المتصفح
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new ApiError(response.status, payload as ApiErrorBody | null);
  }

  return payload as T;
}

export async function logoutAdmin(): Promise<void> {
  try {
    const refreshToken = authToken.getRefresh();
    if (refreshToken) {
      await apiFetch('/auth/logout', {
        method: 'POST',
        body: { refreshToken },
      });
    }
  } catch {
    // ignore network/token errors during logout
  } finally {
    authToken.clear();
  }
}
