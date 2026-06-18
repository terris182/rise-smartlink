export const dynamic = 'force-dynamic';

export default function PrivacyPage() {
  return (
    <div style={s.wrapper}>
      <div style={s.container}>
        <h1 style={s.h1}>Privacy Policy</h1>
        <p style={s.meta}>Gudmuzik Pages — Last updated June 17, 2026</p>

        <p style={s.p}>Gudmuzik (operated by Rise.la) provides interactive music pages at gudmuzik.com/pages. This policy explains how we handle your data when you connect your Spotify account.</p>

        <h2 style={s.h2}>What we access</h2>
        <p style={s.p}>When you click "Connect with Spotify", Spotify asks you to authorize specific permissions (scopes). With your consent we access your Spotify profile (name, email, country, subscription type), your saved tracks and playlists, your followed artists, your top and recently played items, and your playback state — solely to power the features you see on the page (following an artist, saving a song, adding to or creating a playlist, showing your listening, and controlling playback).</p>

        <h2 style={s.h2}>How we use it</h2>
        <p style={s.p}>We only perform an action (follow, save, add, create, play, etc.) when you explicitly click the corresponding control. We use your data in real time to display these features and never for advertising or profiling.</p>

        <h2 style={s.h2}>What we store</h2>
        <p style={s.p}>We do NOT store your Spotify content on our servers. Your Spotify access and refresh tokens are kept only in encrypted, http-only cookies in your own browser so your session persists; they are never sold or shared. We retain no copy of your playlists, library, or listening history.</p>

        <h2 style={s.h2}>Third parties</h2>
        <p style={s.p}>Your data is exchanged only with Spotify (api.spotify.com) to perform the actions you request. We do not share it with any other third party.</p>

        <h2 style={s.h2}>Your control</h2>
        <p style={s.p}>You can disconnect at any time using the "Disconnect" button, which clears your session. You can also revoke Gudmuzik's access from your Spotify account settings (Account → Apps).</p>

        <h2 style={s.h2}>Contact</h2>
        <p style={s.p}><a href="mailto:support@rise.la" style={s.link}>support@rise.la</a></p>

        <p style={s.disclaimer}>Gudmuzik is not affiliated with, endorsed by, or sponsored by Spotify. Spotify is a trademark of Spotify AB.</p>

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
  h2: { fontSize: '17px', fontWeight: 600, color: '#fff', marginTop: '1.75rem', marginBottom: '8px' },
  p: { color: 'rgba(255,255,255,0.7)', fontSize: '15px', lineHeight: 1.7, margin: '0 0 0.5rem' },
  link: { color: '#1DB954', textDecoration: 'none' },
  disclaimer: { color: 'rgba(255,255,255,0.35)', fontSize: '13px', marginTop: '2rem', fontStyle: 'italic' },
  back: { display: 'inline-block', marginTop: '2rem', color: '#1DB954', textDecoration: 'none', fontSize: '14px' },
};
