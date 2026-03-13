export default function Home() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: '1rem',
      padding: '2rem',
      textAlign: 'center',
    }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 700 }}>Rise Smart Links</h1>
      <p style={{ color: '#999', maxWidth: 480 }}>
        Fast music landing pages with Facebook Conversions API tracking.
        Create links via the API or access existing ones by slug.
      </p>
      <code style={{
        background: '#111',
        padding: '1rem',
        borderRadius: 8,
        fontSize: '0.85rem',
        color: '#6f6',
        maxWidth: 500,
        overflow: 'auto',
        display: 'block',
      }}>
        POST /api/create-link
      </code>
    </div>
  );
}
