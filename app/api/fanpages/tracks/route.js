import { NextResponse } from 'next/server';
import { addTracks, isKnownKey, listTracks, removeTracks } from '@/lib/fanpages';

export const dynamic = 'force-dynamic';

/** GET /api/fanpages/tracks?key=<key>: playlist contents in order. */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key') || '';
  if (!isKnownKey(key)) return NextResponse.json({ error: 'Unknown key' }, { status: 400 });
  try {
    return NextResponse.json(await listTracks(key));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

async function readBody(request) {
  const body = await request.json().catch(() => ({}));
  const key = body?.key || '';
  const uris = Array.isArray(body?.uris) ? body.uris : body?.uri ? [body.uri] : [];
  return { key, uris };
}

/** POST /api/fanpages/tracks {key, uris:[...]}: add tracks (uri, url or id). */
export async function POST(request) {
  const { key, uris } = await readBody(request);
  if (!isKnownKey(key)) return NextResponse.json({ error: 'Unknown key' }, { status: 400 });
  if (!uris.length) return NextResponse.json({ error: 'No uris' }, { status: 400 });
  try {
    const result = await addTracks(key, uris);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const status = /Not a Spotify track/.test(err.message) ? 400 : 502;
    return NextResponse.json({ error: err.message }, { status });
  }
}

/** DELETE /api/fanpages/tracks {key, uris:[...]}: remove every occurrence. */
export async function DELETE(request) {
  const { key, uris } = await readBody(request);
  if (!isKnownKey(key)) return NextResponse.json({ error: 'Unknown key' }, { status: 400 });
  if (!uris.length) return NextResponse.json({ error: 'No uris' }, { status: 400 });
  try {
    const result = await removeTracks(key, uris);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const status = /Not a Spotify track/.test(err.message) ? 400 : 502;
    return NextResponse.json({ error: err.message }, { status });
  }
}
