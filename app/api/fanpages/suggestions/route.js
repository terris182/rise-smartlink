import { NextResponse } from 'next/server';
import { isKnownKey } from '@/lib/fanpages';
import { getSuggestions } from '@/lib/fanpages-suggest';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/fanpages/suggestions?key=<key>[&refresh=1]: cached 24h per key. */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key') || '';
  const refresh = searchParams.get('refresh') === '1';
  if (!isKnownKey(key)) return NextResponse.json({ error: 'Unknown key' }, { status: 400 });
  try {
    return NextResponse.json(await getSuggestions(key, { refresh }));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
