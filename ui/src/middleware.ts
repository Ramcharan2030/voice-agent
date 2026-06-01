import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const OSS_TOKEN_COOKIE = 'voice_console_auth_token';
const OSS_USER_COOKIE = 'voice_console_auth_user';

// Paths that don't require authentication in OSS mode
const PUBLIC_PATHS = ['/auth/login', '/auth/signup'];
const MANAGED_CUSTOMER_RESTRICTED_PATHS = [
  '/api-keys',
  '/campaigns',
  '/files',
  '/model-configurations',
  '/recordings',
  '/settings',
  '/superadmin',
  '/telephony-configurations',
  '/tools',
  '/workflow',
];

let cachedAuthProvider: string | null = null;

async function fetchAuthProvider(): Promise<string> {
  if (cachedAuthProvider) {
    return cachedAuthProvider;
  }

  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const res = await fetch(`${backendUrl}/api/v1/health`);
    if (res.ok) {
      const data = await res.json();
      cachedAuthProvider = (data.auth_provider as string) || 'local';
      return cachedAuthProvider;
    }
  } catch {
    // Backend not reachable — fall back to local
  }

  cachedAuthProvider = 'local';
  return cachedAuthProvider;
}

export async function middleware(request: NextRequest) {
  const authProvider = await fetchAuthProvider();

  // Only handle OSS mode
  if (authProvider !== 'local') {
    return NextResponse.next();
  }

  const token = request.cookies.get(OSS_TOKEN_COOKIE)?.value;
  const userCookie = request.cookies.get(OSS_USER_COOKIE)?.value;
  const { pathname } = request.nextUrl;

  // Allow public paths without auth
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // If no token, redirect to login
  if (!token) {
    const loginUrl = new URL('/auth/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  let isSuperuser = false;
  if (userCookie) {
    try {
      isSuperuser = Boolean(JSON.parse(userCookie).is_superuser);
    } catch {
      isSuperuser = false;
    }
  }

  if (
    !isSuperuser &&
    MANAGED_CUSTOMER_RESTRICTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  ) {
    const usageUrl = new URL('/usage', request.url);
    return NextResponse.redirect(usageUrl);
  }

  return NextResponse.next();
}

// Configure which routes the middleware runs on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api routes
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|public).*)',
  ],
};
