import { NextResponse } from 'next/server';
import { getValidAccessToken } from '@/lib/spotify-pages';

export const dynamic = 'force-dynamic';

function copyRefreshedCookies(src, dest) {
  src.cookies.getAll().forEach((c) => dest.cookies.set(c));
}

export async function GET(req) {
  const tmp = new NextResponse();
  const token = await getValidAccessToken(req, tmp);
  const out = NextResponse.json(
    token ? { access_token: token } : { error: 'not_authed' },
    { status: token ? 200 : 401 }
  );
  copyRefreshedCookies(tmp, out);
  return out;
}
