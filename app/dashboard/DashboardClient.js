'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Views ───
const VIEWS = { OVERVIEW: 'overview', STATS: 'stats', EDIT: 'edit', CREATE: 'create' };

export default function DashboardClient() {
  const [view, setView] = useState(VIEWS.OVERVIEW);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState(null);
  const [statsData, setStatsData] = useState(null);
  const [totals, setTotals] = useState({ visits: 0, clicks: 0 });

  // Fetch overview data
  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/analytics');
      const data = await res.json();
      if (data.success) {
        setLinks(data.links || []);
        setTotals({ visits: data.totalVisits || 0, clicks: data.totalClicks || 0 });
      }
    } catch (err) {
      console.error('Failed to fetch overview:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  // Open stats for a slug
  const openStats = async (slug) => {
    setSelectedSlug(slug);
    setView(VIEWS.STATS);
    setStatsData(null);
    try {
      const res = await fetch(`/api/analytics?slug=${encodeURIComponent(slug)}`);
      const data = await res.json();
      if (data.success) setStatsData(data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  const openEdit = (slug) => {
    setSelectedSlug(slug);
    setView(VIEWS.EDIT);
  };

  const openCreate = () => {
    setSelectedSlug(null);
    setView(VIEWS.CREATE);
  };

  const goBack = () => {
    setView(VIEWS.OVERVIEW);
    setSelectedSlug(null);
    fetchOverview();
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <h1 style={styles.title} onClick={goBack}>
              GudMuzik
            </h1>
            <p style={styles.subtitle}>Smart Links Dashboard</p>
          </div>
          {view === VIEWS.OVERVIEW && (
            <button style={styles.createBtn} onClick={openCreate}>
              + New Link
            </button>
          )}
          {view !== VIEWS.OVERVIEW && (
            <button style={styles.backBtn} onClick={goBack}>
              ← Back
            </button>
          )}
        </div>

        {/* Content */}
        {view === VIEWS.OVERVIEW && (
          <OverviewView
            links={links}
            totals={totals}
            loading={loading}
            onStats={openStats}
            onEdit={openEdit}
          />
        )}
        {view === VIEWS.STATS && <StatsView slug={selectedSlug} data={statsData} />}
        {view === VIEWS.EDIT && <EditView slug={selectedSlug} onDone={goBack} />}
        {view === VIEWS.CREATE && <CreateView onDone={goBack} />}
      </div>
    </div>
  );
}

// ─── Overview ───
function OverviewView({ links, totals, loading, onStats, onEdit }) {
  if (loading) return <p style={styles.muted}>Loading...</p>;

  return (
    <>
      {/* Summary cards */}
      <div style={styles.cardRow}>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Total Links</span>
          <span style={styles.cardValue}>{links.length}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Total Visits</span>
          <span style={styles.cardValue}>{totals.visits.toLocaleString()}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Total Clicks</span>
          <span style={styles.cardValue}>{totals.clicks.toLocaleString()}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Avg CTR</span>
          <span style={styles.cardValue}>
            {totals.visits > 0 ? ((totals.clicks / totals.visits) * 100).toFixed(1) : '0.0'}%
          </span>
        </div>
      </div>

      {/* Links table */}
      {links.length === 0 ? (
        <p style={styles.muted}>No links created yet. Click "+ New Link" to get started.</p>
      ) : (
        <div style={styles.table}>
          <div style={{ ...styles.tableRow, ...styles.tableHeader }}>
            <span style={{ ...styles.tableCell, flex: 2 }}>Link</span>
            <span style={styles.tableCell}>Visits</span>
            <span style={styles.tableCell}>Clicks</span>
            <span style={styles.tableCell}>CTR</span>
            <span style={styles.tableCell}>Actions</span>
          </div>
          {links.map((link) => (
            <div key={link.slug} style={styles.tableRow}>
              <span style={{ ...styles.tableCell, flex: 2 }}>
                <strong style={{ color: '#fff' }}>{link.title || link.slug}</strong>
                <br />
                <span style={{ color: '#888', fontSize: '13px' }}>
                  {link.artist ? `${link.artist} · ` : ''}
                  /{link.slug}
                </span>
              </span>
              <span style={styles.tableCell}>{(link.visits || 0).toLocaleString()}</span>
              <span style={styles.tableCell}>{(link.clicks || 0).toLocaleString()}</span>
              <span style={styles.tableCell}>{link.ctr}%</span>
              <span style={{ ...styles.tableCell, gap: '8px', display: 'flex' }}>
                <button style={styles.smallBtn} onClick={() => onStats(link.slug)}>
                  Stats
                </button>
                <button style={styles.smallBtn} onClick={() => onEdit(link.slug)}>
                  Edit
                </button>
                <a
                  href={`https://gudmuzik.com/${link.slug}`}
                  target="_blank"
                  rel="noopener"
                  style={styles.smallLink}
                >
                  View
                </a>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ─── Stats Detail ───
function StatsView({ slug, data }) {
  if (!data) return <p style={styles.muted}>Loading stats for /{slug}...</p>;

  const { link, analytics } = data;
  const { visits, clicks, platforms, countries, clickCountries, devices, os, daily } = analytics;
  const ctr = visits > 0 ? ((clicks / visits) * 100).toFixed(1) : '0.0';

  // Sort daily by date
  const dailyEntries = Object.entries(daily || {}).sort((a, b) => a[0].localeCompare(b[0]));

  // Sort countries by count descending
  const countryEntries = Object.entries(countries || {}).sort((a, b) => b[1] - a[1]);
  const platformEntries = Object.entries(platforms || {}).sort((a, b) => b[1] - a[1]);
  const deviceEntries = Object.entries(devices || {}).sort((a, b) => b[1] - a[1]);
  const osEntries = Object.entries(os || {}).sort((a, b) => b[1] - a[1]);

  // Find max daily value for chart scaling
  const maxDaily = dailyEntries.reduce(
    (max, [, d]) => Math.max(max, d.visits || 0, d.clicks || 0),
    1
  );

  return (
    <div>
      {/* Link header */}
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '24px' }}>
        {link.coverUrl && (
          <img
            src={link.coverUrl}
            alt=""
            style={{ width: '80px', height: '80px', borderRadius: '8px', objectFit: 'cover' }}
          />
        )}
        <div>
          <h2 style={{ color: '#fff', margin: 0, fontSize: '20px' }}>{link.title}</h2>
          <p style={{ color: '#888', margin: '4px 0 0', fontSize: '14px' }}>
            {link.artist} · /{link.slug}
          </p>
        </div>
      </div>

      {/* Summary */}
      <div style={styles.cardRow}>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Visits</span>
          <span style={styles.cardValue}>{visits.toLocaleString()}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Clicks</span>
          <span style={styles.cardValue}>{clicks.toLocaleString()}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>CTR</span>
          <span style={styles.cardValue}>{ctr}%</span>
        </div>
      </div>

      {/* Daily chart */}
      {dailyEntries.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Daily Activity (Last 30 Days)</h3>
          <div style={{ display: 'flex', gap: '2px', alignItems: 'flex-end', height: '120px' }}>
            {dailyEntries.map(([date, d]) => (
              <div
                key={date}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  height: '100%',
                  justifyContent: 'flex-end',
                  position: 'relative',
                }}
                title={`${date}\nVisits: ${d.visits}\nClicks: ${d.clicks}`}
              >
                <div
                  style={{
                    width: '100%',
                    maxWidth: '20px',
                    background: '#3b82f6',
                    borderRadius: '2px 2px 0 0',
                    height: `${((d.visits || 0) / maxDaily) * 100}%`,
                    minHeight: d.visits ? '2px' : 0,
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      background: '#10b981',
                      borderRadius: '2px 2px 0 0',
                      height: `${((d.clicks || 0) / Math.max(d.visits || 1, 1)) * 100}%`,
                      minHeight: d.clicks ? '2px' : 0,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              gap: '16px',
              marginTop: '8px',
              fontSize: '12px',
              color: '#888',
            }}
          >
            <span>
              <span style={{ display: 'inline-block', width: 10, height: 10, background: '#3b82f6', borderRadius: 2, marginRight: 4 }} />
              Visits
            </span>
            <span>
              <span style={{ display: 'inline-block', width: 10, height: 10, background: '#10b981', borderRadius: 2, marginRight: 4 }} />
              Clicks
            </span>
          </div>
        </div>
      )}

      {/* Breakdown grids */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* Platform clicks */}
        {platformEntries.length > 0 && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Clicks by Platform</h3>
            {platformEntries.map(([platform, count]) => (
              <div key={platform} style={styles.breakdownRow}>
                <span style={styles.breakdownLabel}>{formatPlatform(platform)}</span>
                <span style={styles.breakdownValue}>{count.toLocaleString()}</span>
                <div style={styles.barBg}>
                  <div
                    style={{
                      ...styles.barFill,
                      width: `${(count / clicks) * 100}%`,
                      background: platform === 'spotify' ? '#1DB954' : '#FA243C',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Countries */}
        {countryEntries.length > 0 && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Visits by Country</h3>
            {countryEntries.slice(0, 15).map(([country, count]) => (
              <div key={country} style={styles.breakdownRow}>
                <span style={styles.breakdownLabel}>{country}</span>
                <span style={styles.breakdownValue}>{count.toLocaleString()}</span>
                <div style={styles.barBg}>
                  <div
                    style={{
                      ...styles.barFill,
                      width: `${(count / visits) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Devices */}
        {deviceEntries.length > 0 && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Devices</h3>
            {deviceEntries.map(([device, count]) => (
              <div key={device} style={styles.breakdownRow}>
                <span style={styles.breakdownLabel}>{device}</span>
                <span style={styles.breakdownValue}>{count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}

        {/* OS */}
        {osEntries.length > 0 && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Operating Systems</h3>
            {osEntries.map(([name, count]) => (
              <div key={name} style={styles.breakdownRow}>
                <span style={styles.breakdownLabel}>{name}</span>
                <span style={styles.breakdownValue}>{count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatPlatform(key) {
  const map = { spotify: 'Spotify', apple_music: 'Apple Music', soundcloud: 'SoundCloud' };
  return map[key] || key;
}

// ─── Edit View ───
function EditView({ slug, onDone }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/analytics?slug=${encodeURIComponent(slug)}`);
      const data = await res.json();
      if (data.success) {
        setForm(data.link);
      }
    })();
  }, [slug]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/links', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        setMessage('Saved successfully!');
        setTimeout(onDone, 1000);
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
    setSaving(false);
  };

  if (!form) return <p style={styles.muted}>Loading...</p>;

  return (
    <div>
      <h2 style={{ color: '#fff', marginBottom: '20px' }}>Edit Link: /{slug}</h2>

      {/* Preview */}
      {form.coverUrl && (
        <div style={{ marginBottom: '20px', textAlign: 'center' }}>
          <img
            src={form.coverUrl}
            alt=""
            style={{ width: '120px', height: '120px', borderRadius: '8px', objectFit: 'cover' }}
          />
        </div>
      )}

      <div style={styles.formGrid}>
        <FormField label="Title" value={form.title} onChange={(v) => handleChange('title', v)} />
        <FormField label="Artist" value={form.artist} onChange={(v) => handleChange('artist', v)} />
        <FormField
          label="Spotify URL"
          value={form.spotifyUrl}
          onChange={(v) => handleChange('spotifyUrl', v)}
          placeholder="https://open.spotify.com/track/..."
        />
        <FormField
          label="Apple Music URL"
          value={form.appleMusicUrl}
          onChange={(v) => handleChange('appleMusicUrl', v)}
          placeholder="Auto-resolved from Spotify if blank"
        />
        <FormField label="Genre" value={form.genre} onChange={(v) => handleChange('genre', v)} />
        <FormField
          label="Subgenre"
          value={form.subgenre}
          onChange={(v) => handleChange('subgenre', v)}
        />
        <FormField
          label="Cover URL"
          value={form.coverUrl}
          onChange={(v) => handleChange('coverUrl', v)}
          placeholder="Auto-fetched from Spotify if blank"
        />
        <FormField
          label="Background Color"
          value={form.bgColor}
          onChange={(v) => handleChange('bgColor', v)}
          placeholder="#000000"
        />
      </div>

      <div style={{ marginTop: '20px', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <button style={styles.saveBtn} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        <button style={styles.backBtn} onClick={onDone}>
          Cancel
        </button>
        {message && (
          <span style={{ color: message.startsWith('Error') ? '#ef4444' : '#10b981', fontSize: '14px' }}>
            {message}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Create View ───
function CreateView({ onDone }) {
  const [form, setForm] = useState({
    spotifyUrl: '',
    title: '',
    artist: '',
    slug: '',
    appleMusicUrl: '',
    genre: '',
    subgenre: '',
    bgColor: '',
  });
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');
  const [createdUrl, setCreatedUrl] = useState('');

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreate = async () => {
    if (!form.spotifyUrl) {
      setMessage('Error: Spotify URL is required');
      return;
    }
    setCreating(true);
    setMessage('');
    try {
      const res = await fetch('/api/create-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        setMessage('Link created!');
        setCreatedUrl(data.url);
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
    setCreating(false);
  };

  return (
    <div>
      <h2 style={{ color: '#fff', marginBottom: '8px' }}>Create New Smart Link</h2>
      <p style={{ color: '#888', fontSize: '14px', marginBottom: '20px' }}>
        Just paste a Spotify URL — title, artist, cover art, and Apple Music link will be auto-resolved.
      </p>

      <div style={styles.formGrid}>
        <FormField
          label="Spotify URL *"
          value={form.spotifyUrl}
          onChange={(v) => handleChange('spotifyUrl', v)}
          placeholder="https://open.spotify.com/track/..."
        />
        <FormField
          label="Custom Slug (optional)"
          value={form.slug}
          onChange={(v) => handleChange('slug', v)}
          placeholder="artist-name/song-name (auto-generated if blank)"
        />
        <FormField
          label="Title (optional)"
          value={form.title}
          onChange={(v) => handleChange('title', v)}
          placeholder="Auto-fetched from Spotify"
        />
        <FormField
          label="Artist (optional)"
          value={form.artist}
          onChange={(v) => handleChange('artist', v)}
          placeholder="Auto-fetched from Spotify"
        />
        <FormField
          label="Apple Music URL (optional)"
          value={form.appleMusicUrl}
          onChange={(v) => handleChange('appleMusicUrl', v)}
          placeholder="Auto-resolved from Spotify"
        />
        <FormField label="Genre" value={form.genre} onChange={(v) => handleChange('genre', v)} />
        <FormField
          label="Subgenre"
          value={form.subgenre}
          onChange={(v) => handleChange('subgenre', v)}
        />
        <FormField
          label="Background Color"
          value={form.bgColor}
          onChange={(v) => handleChange('bgColor', v)}
          placeholder="#000000"
        />
      </div>

      <div style={{ marginTop: '20px', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <button style={styles.saveBtn} onClick={handleCreate} disabled={creating}>
          {creating ? 'Creating...' : 'Create Link'}
        </button>
        <button style={styles.backBtn} onClick={onDone}>
          Cancel
        </button>
      </div>

      {message && (
        <p
          style={{
            marginTop: '12px',
            color: message.startsWith('Error') ? '#ef4444' : '#10b981',
            fontSize: '14px',
          }}
        >
          {message}
        </p>
      )}

      {createdUrl && (
        <div style={styles.successBox}>
          <p style={{ margin: 0, color: '#fff' }}>Your smart link is live:</p>
          <a href={createdUrl} target="_blank" rel="noopener" style={styles.successLink}>
            {createdUrl}
          </a>
          <button style={{ ...styles.smallBtn, marginTop: '8px' }} onClick={onDone}>
            Back to Dashboard
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Form Field Component ───
function FormField({ label, value, onChange, placeholder = '' }) {
  return (
    <div style={styles.formField}>
      <label style={styles.formLabel}>{label}</label>
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={styles.formInput}
      />
    </div>
  );
}

// ─── Styles ───
const styles = {
  page: {
    minHeight: '100vh',
    background: '#0a0a0a',
    color: '#e5e5e5',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  container: {
    maxWidth: '1100px',
    margin: '0 auto',
    padding: '24px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '28px',
    borderBottom: '1px solid #222',
    paddingBottom: '20px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#fff',
    margin: 0,
    cursor: 'pointer',
  },
  subtitle: {
    fontSize: '14px',
    color: '#888',
    margin: '4px 0 0',
  },
  createBtn: {
    padding: '10px 20px',
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  backBtn: {
    padding: '10px 20px',
    background: '#222',
    color: '#ccc',
    border: '1px solid #333',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  muted: {
    color: '#666',
    fontSize: '14px',
    textAlign: 'center',
    padding: '40px 0',
  },
  cardRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '12px',
    marginBottom: '28px',
  },
  card: {
    background: '#141414',
    border: '1px solid #222',
    borderRadius: '12px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  cardLabel: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  cardValue: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#fff',
  },
  table: {
    background: '#141414',
    border: '1px solid #222',
    borderRadius: '12px',
    overflow: 'hidden',
  },
  tableHeader: {
    background: '#1a1a1a',
    fontWeight: 600,
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#888',
  },
  tableRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid #1e1e1e',
  },
  tableCell: {
    flex: 1,
    fontSize: '14px',
  },
  smallBtn: {
    padding: '6px 14px',
    background: '#222',
    color: '#ccc',
    border: '1px solid #333',
    borderRadius: '6px',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  smallLink: {
    padding: '6px 14px',
    color: '#3b82f6',
    fontSize: '13px',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  },
  section: {
    background: '#141414',
    border: '1px solid #222',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '20px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#fff',
    margin: '0 0 12px',
  },
  breakdownRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 0',
    fontSize: '13px',
  },
  breakdownLabel: {
    width: '80px',
    color: '#ccc',
    flexShrink: 0,
  },
  breakdownValue: {
    width: '60px',
    textAlign: 'right',
    color: '#fff',
    fontWeight: 600,
    flexShrink: 0,
  },
  barBg: {
    flex: 1,
    height: '8px',
    background: '#222',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    background: '#3b82f6',
    borderRadius: '4px',
    transition: 'width 0.3s ease',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  formField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  formLabel: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#aaa',
  },
  formInput: {
    padding: '10px 12px',
    background: '#141414',
    border: '1px solid #333',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  saveBtn: {
    padding: '10px 24px',
    background: '#10b981',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  successBox: {
    marginTop: '16px',
    padding: '16px',
    background: '#141414',
    border: '1px solid #10b981',
    borderRadius: '12px',
  },
  successLink: {
    color: '#3b82f6',
    fontSize: '16px',
    fontWeight: 600,
    textDecoration: 'none',
    display: 'block',
    marginTop: '4px',
  },
};
