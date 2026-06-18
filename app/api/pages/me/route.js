import { NextResponse } from 'next/server';
import { getValidAccessToken, spotifyFetch } from '@/lib/spotify-pages';

export const dynamic = 'force-dynamic';

function copyRefreshedCookies(src, dest) {
  src.cookies.getAll().forEach((c) => dest.cookies.set(c));
}

export async function GET(req) {
  const tmp = new NextResponse();
  const token = await getValidAccessToken(req, tmp);
  if (!token) {
    const out = NextResponse.json({ authed: false }, { status: 401 });
    copyRefreshedCookies(tmp, out);
    return out;
  }

  const res = await spotifyFetch(token, '/me');
  if (!res.ok) {
    const out = NextResponse.json({ authed: true, error: `spotify_error_${res.status}` }, { status: res.status });
    copyRefreshedCookies(tmp, out);
    return out;
  }

  const data = await res.json();
  const out = NextResponse.json({
    authed: true,
    id: data.id,
    display_name: data.display_name,
    email: data.email,
    country: data.country,
    product: data.product,
    image: data.images?.[0]?.url || null,
    uri: data.uri,
    external_url: data.external_urls?.spotify,
  });
  copyRefreshedCookies(tmp, out);
  return out;
}
