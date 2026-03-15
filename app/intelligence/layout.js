export const metadata = {
  title: 'Rise Intelligence Dashboard',
  description: '23 scoring models for music artist analytics',
};

export default function IntelligenceLayout({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: '#06080F' }}>
      {children}
    </div>
  );
}