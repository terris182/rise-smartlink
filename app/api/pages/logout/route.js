import { NextResponse } from 'next/server';
import { clearAuthCookies } from '@/lib/spotify-pages';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearAuthCookies(res);
  return res;
}
