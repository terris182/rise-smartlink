import './globals.css';

export const metadata = {
  title: 'GudMuzik – Music Discovery & Promotion Powered by Rise',
  description: 'GudMuzik is a music discovery platform powered by Rise, the music marketing company helping independent artists reach real listeners. Smart links with conversion tracking for music promotion.',
  keywords: 'music marketing, music promotion, smart links, playlist promotion, independent artists, music discovery, Rise, GudMuzik',
  openGraph: {
    title: 'GudMuzik – Music Discovery Powered by Rise',
    description: 'Connecting listeners with fresh music. Powered by Rise music marketing.',
    url: 'https://gudmuzik.com',
    siteName: 'GudMuzik',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'GudMuzik – Music Discovery Powered by Rise',
    description: 'Connecting listeners with fresh music. Powered by Rise music marketing.',
  },
  alternates: {
    canonical: 'https://gudmuzik.com',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
