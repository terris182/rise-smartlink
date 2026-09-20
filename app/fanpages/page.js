import FanpagesClient from './FanpagesClient';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Fan Page Playlists', robots: { index: false, follow: false } };

export default function FanpagesPage() {
  return <FanpagesClient />;
}
