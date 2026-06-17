import { NextResponse } from 'next/server';
import { curatorConfigured, getMyPlaylists, getMe } from '@/lib/spotify-curator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/curator/playlists → list the connected (tout) account's playlists.
export async function GET() {
  if (!curatorConfigured()) {
    return NextResponse.json(
      { error: 'Curator not configured. Set SPOTIFY_CURATOR_* env vars in Vercel.' },
      { status: 503 }
    );
  }
  try {
    const [me, playlists] = await Promise.all([getMe(), getMyPlaylists()]);
    return NextResponse.json({
      account: { id: me.id, name: me.display_name, email: me.email },
      playlists,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
