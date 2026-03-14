export default function Home() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: '2rem',
      padding: '2rem',
      textAlign: 'center',
      background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #0a0a0a 100%)',
      color: '#fff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* Logo / Brand */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
        <div style={{
          fontSize: '3rem',
          fontWeight: 800,
          letterSpacing: '-0.02em',
          background: 'linear-gradient(135deg, #1ED760 0%, #1DB954 50%, #00d4ff 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          GudMuzik
        </div>
        <div style={{
          fontSize: '0.85rem',
          textTransform: 'uppercase',
          letterSpacing: '0.2em',
          color: 'rgba(255,255,255,0.5)',
          fontWeight: 500,
        }}>
          Music Discovery Platform
        </div>
      </div>

      {/* Tagline */}
      <p style={{
        color: 'rgba(255,255,255,0.75)',
        maxWidth: 520,
        fontSize: '1.15rem',
        lineHeight: 1.7,
        margin: 0,
      }}>
        Connecting listeners with fresh music they&apos;ll love.
        Every link on GudMuzik is a doorway to your next favorite song.
      </p>

      {/* Divider */}
      <div style={{
        width: 60,
        height: 2,
        background: 'linear-gradient(90deg, #1ED760, #00d4ff)',
        borderRadius: 1,
      }} />

      {/* CTA for artists */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1rem',
      }}>
        <p style={{
          color: 'rgba(255,255,255,0.6)',
          fontSize: '1rem',
          margin: 0,
          maxWidth: 400,
          lineHeight: 1.6,
        }}>
          Are you an artist? Get your music in front of real listeners.
        </p>
        <a
          href="https://www.rise.la"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.85rem 2rem',
            background: 'linear-gradient(135deg, #1ED760, #1DB954)',
            color: '#000',
            fontWeight: 700,
            fontSize: '1rem',
            borderRadius: 50,
            textDecoration: 'none',
            transition: 'transform 0.2s, box-shadow 0.2s',
            boxShadow: '0 4px 20px rgba(30, 215, 96, 0.3)',
          }}
        >
          Visit Rise.la
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginLeft: 2 }}>
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </a>
      </div>

      {/* Powered by */}
      <div style={{
        position: 'absolute',
        bottom: '2rem',
        fontSize: '0.75rem',
        color: 'rgba(255,255,255,0.3)',
        letterSpacing: '0.05em',
      }}>
        Powered by <a href="https://www.rise.la" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>Rise</a>
      </div>
    </div>
  );
}
