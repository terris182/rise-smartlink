import { getLink, updateLink } from '@/lib/links';
import { fetchSpotifyMeta } from '@/lib/spotify';
import { fetchSpotifyTrackMeta } from '@/lib/spotify-api';
import { fetchCrossPlatformLinks } from '@/lib/songlink';
import { searchAppleMusicUrl } from '@/lib/itunes';
import { resolveAppleMusicByIsrc, deezerSearch, appleMusicAmpSearch } from '@/lib/isrc-resolver';
import { notFound } from 'next/navigation';
import SmartLinkClient from './SmartLinkClient';

// Never cache — always fetch fresh data from KV
export const dynamic = 'force-dynamic';

/**
 * Dynamic smart link page.
 * Server component fetches link data, auto-resolves cover art
 * from Spotify oEmbed if missing, auto-resolves Apple Music URL
 * via Songlink/Odesli API if missing, then passes to client component.
 *
 * Uses catch-all route [...slug] to support artist-name/song-name URLs.
 */

function parseSlug(params) {
  const parts = params.slug;
  return Array.isArray(parts) ? parts.join('/') : parts;
}

async function resolveLink(slug) {
  const link = await getLink(slug);
  if (!link) return null;

  const updates = {};
  const needsArtist = !link.artist;
  const needsAppleMusic = !link.appleMusicUrl;
  const needsCover = !link.coverUrl;
  const needsTitle = !link.title;

  // Use Songlink/Odesli API as the primary resolver — it provides:
  // - Artist name (more reliable than Spotify oEmbed which often omits author_name)
  // - Apple Music URL (cross-platform link resolution)
  // - Title (fallback)
  if (link.spotifyUrl && (needsArtist || needsAppleMusic || needsTitle)) {
    try {
      const crossLinks = await fetchCrossPlatformLinks(link.spotifyUrl);
      if (crossLinks) {
        if (needsArtist && crossLinks.artistName) {
          updates.artist = crossLinks.artistName;
          link.artist = crossLinks.artistName;
        }
        if (needsTitle && crossLinks.title) {
          updates.title = crossLinks.title;
          link.title = crossLinks.title;
        }
        if (needsAppleMusic && crossLinks.appleMusicUrl) {
          updates.appleMusicUrl = crossLinks.appleMusicUrl;
          link.appleMusicUrl = crossLinks.appleMusicUrl;
        }
      }
    } catch (err) {
      console.error('[resolveLink] Songlink error:', err.message);
    }
  }

  // Fallback: if Songlink didn't find Apple Music, try iTunes Search API
  if (!link.appleMusicUrl && link.artist && link.title) {
    try {
      const itunesUrl = await searchAppleMusicUrl(link.artist, link.title);
      if (itunesUrl) {
        updates.appleMusicUrl = itunesUrl;
        link.appleMusicUrl = itunesUrl;
      }
    } catch (err) {
      console.error('[resolveLink] iTunes search error:', err.message);
    }
  }

  // Fallback: Deezer text search → get ISRC → Apple Music AMP API / Songlink
  // Deezer indexes tracks faster than iTunes Search and returns ISRCs for free
  if (!link.appleMusicUrl && link.artist && link.title) {
    try {
      const deezerResult = await deezerSearch(link.artist, link.title);
      if (deezerResult?.isrc) {
        console.log(`[resolveLink] Deezer found ISRC ${deezerResult.isrc} — trying ISRC-based resolution`);
        const isrcUrl = await resolveAppleMusicByIsrc(
          deezerResult.isrc,
          link.artist,
          link.title
        );
        if (isrcUrl) {
          updates.appleMusicUrl = isrcUrl;
          link.appleMusicUrl = isrcUrl;
        }
      }
    } catch (err) {
      console.error('[resolveLink] Deezer/ISRC error:', err.message);
    }
  }

  // Fallback: Apple Music AMP API text search (if token available, no ISRC needed)
  if (!link.appleMusicUrl && link.artist && link.title) {
    try {
      const ampUrl = await appleMusicAmpSearch(link.artist, link.title);
      if (ampUrl) {
        updates.appleMusicUrl = ampUrl;
        link.appleMusicUrl = ampUrl;
      }
    } catch (err) {
      console.error('[resolveLink] Apple AMP search error:', err.message);
    }
  }

  // Fallback: Spotify Web API → ISRC → Apple Music resolution
  if (!link.appleMusicUrl && link.spotifyUrl) {
    try {
      const spotifyMeta = await fetchSpotifyTrackMeta(link.spotifyUrl);
      if (spotifyMeta?.isrc) {
        console.log(`[resolveLink] Spotify ISRC ${spotifyMeta.isrc} — trying resolution`);
        const isrcUrl = await resolveAppleMusicByIsrc(
          spotifyMeta.isrc,
          link.artist || spotifyMeta.artist,
          link.title || spotifyMeta.title
        );
        if (isrcUrl) {
          updates.appleMusicUrl = isrcUrl;
          link.appleMusicUrl = isrcUrl;
        }
        if (!link.artist && spotifyMeta.artist) {
          updates.artist = spotifyMeta.artist;
          link.artist = spotifyMeta.artist;
        }
        if (!link.title && spotifyMeta.title) {
          updates.title = spotifyMeta.title;
          link.title = spotifyMeta.title;
        }
      }
    } catch (err) {
      console.error('[resolveLink] Spotify ISRC error:', err.message);
    }
  }

  // Fallback: fetch cover art from Spotify oEmbed if still missing
  if (needsCover && link.spotifyUrl) {
    const meta = await fetchSpotifyMeta(link.spotifyUrl);
    if (meta?.thumbnailUrl) {
      updates.coverUrl = meta.thumbnailUrl;
      link.coverUrl = meta.thumbnailUrl;
    }
    // Also grab artist from oEmbed as last resort (works for some tracks)
    if (!link.artist && meta?.artist) {
      updates.artist = meta.artist;
      link.artist = meta.artist;
    }
  }

  // Persist any auto-resolved fields back to KV
  if (Object.keys(updates).length > 0) {
    await updateLink(slug, updates);
  }

  return link;
}

export async function generateMetadata({ params }) {
  const slug = parseSlug(await params);
  const link = await resolveLink(slug);
  if (!link) return { title: 'Not Found' };

  return {
    title: `${link.title} by ${link.artist}`,
    description: `Listen to ${link.title} by ${link.artist} on Spotify`,
    openGraph: {
      title: `${link.title} by ${link.artist}`,
      description: `Listen to ${link.title} by ${link.artist}`,
      images: link.coverUrl ? [{ url: link.coverUrl, width: 640, height: 640 }] : [],
      type: 'music.song',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${link.title} by ${link.artist}`,
      images: link.coverUrl ? [link.coverUrl] : [],
    },
  };
}

export default async function SmartLinkPage({ params }) {
  const slug = parseSlug(await params);
  const link = await resolveLink(slug);
  if (!link) notFound();

  // Pass serializable link data to client component
  const linkData = {
    slug: link.slug,
    title: link.title,
    artist: link.artist,
    coverUrl: link.coverUrl,
    spotifyUrl: link.spotifyUrl,
    appleMusicUrl: link.appleMusicUrl || '',
    genre: link.genre || '',
    subgenre: link.subgenre || '',
    fbPixelId: link.fbPixelId || '',
    bgColor: link.bgColor || '',
  };

  return <SmartLinkClient link={linkData} />;
}
