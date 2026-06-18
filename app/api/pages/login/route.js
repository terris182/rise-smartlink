import { NextResponse } from 'next/server';
import {
  pagesConfigured, randomString, buildAuthorizeUrl, originFromRequest,
} from '@/lib/spotify-pages';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!pagesConfigured()) {
    return NextResponse.json({ error: 'Spotify pages app not configured' }, { status: 500 });
  }
  const { searchParams } = new URL(req.url);
  const returnTo = searchParams.get('return') || '/pages';

  const state = randomString(24);
  const verifier = randomString(64);
  const origin = originFromRequest(req);
  const authorizeUrl = buildAuthorizeUrl({ origin, state, verifier });

  const res = NextResponse.redirect(authorizeUrl);
  const cookieOpts = { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600 };
  res.cookies.set('sp_state', state, cookieOpts);
  res.cookies.set('sp_pkce', verifier, cookieOpts);
  res.cookies.set('sp_return', returnTo, cookieOpts);
  return res;
}
