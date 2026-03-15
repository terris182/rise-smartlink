import { NextResponse } from 'next/server';

const DASHBOARD_PASSWORD = 'barrybickle';

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return 'gm_' + Math.abs(hash).toString(36);
}

/**
 * POST /api/auth
 * Body: { password: string }
 * Sets auth cookie on success.
 */
export async function POST(request) {
  const { password } = await request.json();

  if (password === DASHBOARD_PASSWORD) {
    const token = simpleHash(DASHBOARD_PASSWORD);
    const response = NextResponse.json({ success: true });
    response.cookies.set('gm_auth', token, {
      httpOnly: false, // needs to be readable by middleware
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return response;
  }

  return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
}
