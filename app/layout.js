import './globals.css';

export const metadata = {
  title: 'GudMuzik – Music Discovery Powered by Rise',
  description: 'GudMuzik is a music discovery platform powered by Rise. Get your music in front of real listeners at rise.la',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
