import { getLink } from '@/lib/links';
import { notFound } from 'next/navigation';
import SmartLinkClient from './SmartLinkClient';

/**
 * Dynamic smart link page.
 * Server component fetches link data, passes to client component for interactivity.
 */
export async function generateMetadata({ params }) {
  const { slug } = await params;
  const link = getLink(slug);
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
  const { slug } = await params;
  const link = getLink(slug);
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
    fbPixelId: link.fbPixelId || '',
    fbAccessToken: link.fbAccessToken || '',
    bgColor: link.bgColor || '',
  };

  return <SmartLinkClient link={linkData} />;
}
