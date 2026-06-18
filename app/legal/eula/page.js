export const dynamic = 'force-dynamic';

export default function EulaPage() {
  return (
    <div style={s.wrapper}>
      <div style={s.container}>
        <h1 style={s.h1}>End User Agreement / Terms</h1>
        <p style={s.meta}>Gudmuzik Pages — Last updated June 17, 2026</p>

        <p style={s.p}>By using gudmuzik.com/pages you agree to these terms.</p>

        <ol style={s.ol}>
          <li style={s.li}>The service lets you interact with Spotify using your own account and your explicit consent for each action.</li>
          <li style={s.li}>You must have a valid Spotify account and comply with the <a href="https://www.spotify.com/legal/end-user-agreement/" style={s.link} target="_blank" rel="noopener noreferrer">Spotify End User Agreement</a>.</li>
          <li style={s.li}>Gudmuzik performs only the actions you initiate; you are responsible for the actions you take (e.g., creating playlists or following artists).</li>
          <li style={s.li}>The service is provided "as is" without warranties; Spotify functionality depends on Spotify's API and your account type (some playback features require Spotify Premium).</li>
          <li style={s.li}>We may update or discontinue features at any time.</li>
          <li style={s.li}>Gudmuzik is operated by Rise.la; contact <a href="mailto:support@rise.la" style={s.link}>support@rise.la</a>.</li>
          <li style={s.li}>Gudmuzik is not affiliated with or endorsed by Spotify AB.</li>
          <li style={s.li}>This agreement is governed by the laws of the United States.</li>
        </ol>

        <p style={s.disclaimer}>Spotify is a trademark of Spotify AB.</p>

        <a href="/pages" style={s.back}>← Back to Pages</a>
      </div>
    </div>
  );
}

const s = {
  wrapper: { minHeight: '100vh', background: '#0d0d0d', padding: '3rem 1.5rem', fontFamily: "'Inter', -apple-system, sans-serif" },
  container: { maxWidth: 680, margin: '0 auto' },
  h1: { fontSize: '28px', fontWeight: 700, color: '#fff', marginBottom: '4px' },
  meta: { color: 'rgba(255,255,255,0.4)', fontSize: '13px', marginBottom: '2rem' },
  p: { color: 'rgba(255,255,255,0.7)', fontSize: '15px', lineHeight: 1.7, margin: '0 0 1rem' },
  ol: { color: 'rgba(255,255,255,0.7)', fontSize: '15px', lineHeight: 1.7, paddingLeft: '1.5rem' },
  li: { marginBottom: '0.75rem' },
  link: { color: '#1DB954', textDecoration: 'none' },
  disclaimer: { color: 'rgba(255,255,255,0.35)', fontSize: '13px', marginTop: '2rem', fontStyle: 'italic' },
  back: { display: 'inline-block', marginTop: '2rem', color: '#1DB954', textDecoration: 'none', fontSize: '14px' },
};
