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

/**
 * Determine if a link should be in pre-save mode.
 * Compares current time (Eastern Time) against the release date/time.
 * Returns true if presave is enabled AND we haven't passed the release datetime yet.
 */
function shouldShowPresave(link) {
  if (!link.presave) return false;
  if (!link.presaveReleaseDate) return true; // presave enabled but no release date = always presave

  // Build release datetime in Eastern Time
  const releaseTime = link.presaveReleaseTime || '00:00';
  const releaseDateTimeStr = `${link.presaveReleaseDate}T${releaseTime}:00`;

  // Parse as Eastern Time
  const now = new Date();
  const easternNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const releaseParts = releaseDateTimeStr.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!releaseParts) return true;

  const releaseDate = new Date(
    parseInt(releaseParts[1]), parseInt(releaseParts[2]) - 1, parseInt(releaseParts[3]),
    parseInt(releaseParts[4]), parseInt(releaseParts[5]), parseInt(releaseParts[6])
  );

  return easternNow < releaseDate;
}

async function resolveLink(slug) {
  const link = await getLink(slug);
  if (!link) return null;

  const updates = {};
  const needsArtist = !link.artist;
  const needsAppleMusic = !link.appleMusicUrl;
  const needsCover = !link.coverUrl;
  const needsTitle = !link.title;

  // ── Step 1: Songlink (primary — provides Apple Music URL directly) ──
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

  // ── Step 2: Spotify Web API (run early — provides artist/title/ISRC) ──
  // This MUST run before text-based searches so we have metadata to search with
  let spotifyIsrc = null;
  if (link.spotifyUrl && (!link.artist || !link.title || !link.appleMusicUrl)) {
    try {
      const spotifyMeta = await fetchSpotifyTrackMeta(link.spotifyUrl);
      if (spotifyMeta) {
        spotifyIsrc = spotifyMeta.isrc;
        if (!link.artist && spotifyMeta.artist) {
          updates.artist = spotifyMeta.artist;
          link.artist = spotifyMeta.artist;
        }
        if (!link.title && spotifyMeta.title) {
          updates.title = spotifyMeta.title;
          link.title = spotifyMeta.title;
        }
        console.log(`[resolveLink] Spotify API: "${spotifyMeta.title}" by ${spotifyMeta.artist}, ISRC: ${spotifyMeta.isrc}`);
      }
    } catch (err) {
      console.error('[resolveLink] Spotify API error:', err.message);
    }
  }

  // ── Step 3: Spotify oEmbed (backup for artist/title/cover) ──
  if (link.spotifyUrl && (!link.artist || !link.title || needsCover)) {
    try {
      const meta = await fetchSpotifyMeta(link.spotifyUrl);
      if (meta) {
        if (needsCover && meta.thumbnailUrl) {
          updates.coverUrl = meta.thumbnailUrl;
          link.coverUrl = meta.thumbnailUrl;
        }
        if (!link.artist && meta.artist) {
          updates.artist = meta.artist;
          link.artist = meta.artist;
        }
        if (!link.title && meta.title) {
          updates.title = meta.title;
          link.title = meta.title;
        }
      }
    } catch (err) {
      console.error('[resolveLink] Spotify oEmbed error:', err.message);
    }
  }

  // ── Step 4: iTunes Search (needs artist + title) ──
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

  // ── Step 5: ISRC-based resolution (most reliable for new tracks) ──
  // Try Spotify ISRC first, fall back to Deezer ISRC
  if (!link.appleMusicUrl && (spotifyIsrc || (link.artist && link.title))) {
    try {
      let isrc = spotifyIsrc;

      // If no Spotify ISRC, try Deezer text search to get one
      if (!isrc && link.artist && link.title) {
        const deezerResult = await deezerSearch(link.artist, link.title);
        if (deezerResult?.isrc) {
          isrc = deezerResult.isrc;
          console.log(`[resolveLink] Deezer found ISRC: ${isrc}`);
        }
      }

      if (isrc) {
        console.log(`[resolveLink] Trying ISRC-based resolution with ${isrc}`);
        const isrcUrl = await resolveAppleMusicByIsrc(isrc, link.artist, link.title);
        if (isrcUrl) {
          updates.appleMusicUrl = isrcUrl;
          link.appleMusicUrl = isrcUrl;
        }
      }
    } catch (err) {
      console.error('[resolveLink] ISRC resolution error:', err.message);
    }
  }

  // ── Step 6: Apple Music AMP text search (last resort, no ISRC needed) ──
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

  const presavePrefix = shouldShowPresave(link) ? 'Pre-Save: ' : '';

  return {
    title: `${presavePrefix}${link.title} by ${link.artist}`,
    description: `Listen to ${link.title} by ${link.artist} on Spotify`,
    openGraph: {
      title: `${presavePrefix}${link.title} by ${link.artist}`,
      description: `Listen to ${link.title} by ${link.artist}`,
      images: link.coverUrl ? [{ url: link.coverUrl, width: 640, height: 640 }] : [],
      type: 'music.song',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${presavePrefix}${link.title} by ${link.artist}`,
      images: link.coverUrl ? [link.coverUrl] : [],
    },
  };
}

export default async function SmartLinkPage({ params }) {
  const slug = parseSlug(await params);
  const link = await resolveLink(slug);
  if (!link) notFound();

  const isPresave = shouldShowPresave(link);

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
    // Pre-save fields
    presave: link.presave || false,
    presaveReleaseDate: link.presaveReleaseDate || '',
    presaveReleaseTime: link.presaveReleaseTime || '',
    spotifyArtistId: link.spotifyArtistId || '',
    spotifyTrackUri: link.spotifyTrackUri || '',
    contestEnabled: link.contestEnabled || false,
    contestUrl: link.contestUrl || '',
    contestPrizeText: link.contestPrizeText || '',
  };

  return <SmartLinkClient link={linkData} isPresave={isPresave} />;
}
