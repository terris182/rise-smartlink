import { NextResponse } from 'next/server';
import {
  exchangeCode, setAuthCookies, originFromRequest,
} from '@/lib/spotify-pages';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const { code, state } = await req.json();
    const cookieState = req.cookies.get('sp_state')?.value;
    const verifier = req.cookies.get('sp_pkce')?.value;
    const returnTo = req.cookies.get('sp_return')?.value || '/pages';

    if (!state || state !== cookieState) {
      return NextResponse.json({ error: 'state_mismatch' }, { status: 400 });
    }
    if (!verifier) {
      return NextResponse.json({ error: 'missing_verifier' }, { status: 400 });
    }

    const origin = originFromRequest(req);
    const data = await exchangeCode({ code, verifier, origin });

    const res = NextResponse.json({ ok: true, returnTo });
    setAuthCookies(res, {
      access: data.access_token,
      refresh: data.refresh_token,
      expiry: Date.now() + (data.expires_in || 3600) * 1000,
    });
    // Clear PKCE/state cookies
    const clear = { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 };
    res.cookies.set('sp_state', '', clear);
    res.cookies.set('sp_pkce', '', clear);
    res.cookies.set('sp_return', '', clear);
    return res;
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 400 });
  }
}
