import './globals.css';

export const metadata = {
  title: 'Rise Smart Links',
  description: 'Fast music landing pages with conversion tracking',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
