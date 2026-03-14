import { getLink, updateLink } from '@/lib/links';
import { fetchSpotifyMeta } from '@/lib/spotify';
import { notFound } from 'next/navigation';
import SmartLinkClient from './SmartLinkClient';

/**
 * Dynamic smart link page.
 * Server component fetches link data, auto-resolves cover art
 * from Spotify oEmbed if missing, then passes to client component.
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

  // Auto-fetch cover art from Spotify oEmbed if missing
  if (!link.coverUrl && link.spotifyUrl) {
    const meta = await fetchSpotifyMeta(link.spotifyUrl);
    if (meta?.thumbnailUrl) {
      await updateLink(slug, { coverUrl: meta.thumbnailUrl });
      link.coverUrl = meta.thumbnailUrl;
    }
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
    soundcloudUrl: link.soundcloudUrl || '',
    genre: link.genre || '',
    subgenre: link.subgenre || '',
    fbPixelId: link.fbPixelId || '',
    bgColor: link.bgColor || '',
  };

  return <SmartLinkClient link={linkData} />;
}
