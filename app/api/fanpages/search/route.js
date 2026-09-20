import { NextResponse } from 'next/server';
import { isKnownKey, searchTracks } from '@/lib/fanpages';

export const dynamic = 'force-dynamic';

/** GET /api/fanpages/search?key=<key>&q=<text> */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key') || '';
  const q = (searchParams.get('q') || '').trim();
  if (!isKnownKey(key)) return NextResponse.json({ error: 'Unknown key' }, { status: 400 });
  if (!q) return NextResponse.json({ error: 'Missing q' }, { status: 400 });
  try {
    const results = await searchTracks(key, q, 10);
    return NextResponse.json({ key, q, results });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
