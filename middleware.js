import { NextResponse } from 'next/server';

/**
 * Middleware to protect /dashboard and /api/analytics and /api/links routes
 * with a simple password cookie.
 *
 * The password hash is checked against a cookie set by the login form.
 */

const DASHBOARD_PASSWORD = 'barrybickle';

// Simple hash for cookie value (not crypto-secure, just prevents casual snooping)
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return 'gm_' + Math.abs(hash).toString(36);
}

const VALID_TOKEN = simpleHash(DASHBOARD_PASSWORD);

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Only protect dashboard and admin API routes
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/api/analytics') || pathname.startsWith('/api/links')) {
    const token = request.cookies.get('gm_auth')?.value;

    if (token !== VALID_TOKEN) {
      // For API routes, return 401
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // For dashboard page, let it through — the client component will show the login form
      // We pass the auth status via a header so the page knows
      const response = NextResponse.next();
      response.headers.set('x-gm-auth', 'false');
      return response;
    }

    const response = NextResponse.next();
    response.headers.set('x-gm-auth', 'true');
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/analytics/:path*', '/api/links/:path*'],
};
