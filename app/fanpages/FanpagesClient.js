'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * gudmuzik.com/fanpages (WHI-1335): see, add and remove songs on the five
 * fan page Spotify playlists. Same password gate as /curator (gm_auth cookie).
 * Tokens never reach the browser; every Spotify call goes through
 * /api/fanpages/* which reads the mirror table server-side.
 */
export default function FanpagesClient() {
  const [authed, setAuthed] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [pages, setPages] = useState([]);
  const [activeKey, setActiveKey] = useState(null);
  const [playlist, setPlaylist] = useState(null);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busyUri, setBusyUri] = useState(null);
  const [pasteBox, setPasteBox] = useState('');
  const searchTimer = useRef(null);

  const [suggestions, setSuggestions] = useState(null);
  const [loadingSug, setLoadingSug] = useState(false);
  const [previewId, setPreviewId] = useState(null);
  const [openGroups, setOpenGroups] = useState({ viral: true, editorial: true, sounds: true });

  const loadPages = useCallback(async () => {
    const res = await fetch('/api/fanpages');
    if (res.status === 401) { setAuthed(false); return; }
    const data = await res.json();
    if (!res.ok) { setError(data.error || 'Failed to load pages'); return; }
    setPages(data.pages || []);
    setActiveKey((k) => k || (data.pages && data.pages[0] && data.pages[0].key) || null);
  }, []);

  const loadTracks = useCallback(async (key) => {
    if (!key) return;
    setLoadingTracks(true);
    setError('');
    try {
      const res = await fetch(`/api/fanpages/tracks?key=${encodeURIComponent(key)}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to load playlist'); setPlaylist(null); }
      else setPlaylist(data);
    } catch (err) {
      setError(err.message);
    }
    setLoadingTracks(false);
  }, []);

  const loadSuggestions = useCallback(async (key, refresh = false) => {
    if (!key) return;
    setLoadingSug(true);
    setPreviewId(null);
    try {
      const res = await fetch(`/api/fanpages/suggestions?key=${encodeURIComponent(key)}${refresh ? '&refresh=1' : ''}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to load suggestions'); setSuggestions(null); }
      else setSuggestions(data);
    } catch (err) {
      setError(err.message);
    }
    setLoadingSug(false);
  }, []);

  useEffect(() => {
    fetch('/api/fanpages')
      .then((res) => { if (res.ok) setAuthed(true); setAuthChecking(false); })
      .catch(() => setAuthChecking(false));
  }, []);

  useEffect(() => { if (authed) loadPages(); }, [authed, loadPages]);
  useEffect(() => { if (authed && activeKey) { setResults([]); setQuery(''); setSuggestions(null); loadTracks(activeKey); loadSuggestions(activeKey); } }, [authed, activeKey, loadTracks, loadSuggestions]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) setAuthed(true);
    else setAuthError('Wrong password');
  };

  const runSearch = useCallback(async (q) => {
    if (!activeKey || !q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/fanpages/search?key=${encodeURIComponent(activeKey)}&q=${encodeURIComponent(q.trim())}`);
      const data = await res.json();
      if (!res.ok) setError(data.error || 'Search failed');
      else setResults(data.results || []);
    } catch (err) {
      setError(err.message);
    }
    setSearching(false);
  }, [activeKey]);

  const onQueryChange = (v) => {
    setQuery(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runSearch(v), 350);
  };

  const mutate = async (method, uris, label) => {
    setError('');
    setMessage('');
    setBusyUri(uris[0]);
    try {
      const res = await fetch('/api/fanpages/tracks', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: activeKey, uris }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || `${label} failed`);
      else { setMessage(`${label}: ${uris.length} track${uris.length === 1 ? '' : 's'}`); await loadTracks(activeKey); }
    } catch (err) {
      setError(err.message);
    }
    setBusyUri(null);
  };

  const addUri = (uri) => mutate('POST', [uri], 'Added');
  const removeUri = (uri) => mutate('DELETE', [uri], 'Removed');
  const addPasted = () => {
    const lines = pasteBox.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return;
    mutate('POST', lines, 'Added').then(() => setPasteBox(''));
  };

  if (authChecking) return <div style={s.page}><p style={s.muted}>Loading...</p></div>;

  if (!authed) {
    return (
      <div style={s.page}>
        <div style={s.loginContainer}>
          <h1 style={{ ...s.title, textAlign: 'center' }}>gudmuzik</h1>
          <p style={{ color: '#888', textAlign: 'center', marginBottom: 24, fontSize: 14 }}>Fan Page Playlists: enter password</p>
          <form onSubmit={handleLogin} style={s.loginForm}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" style={s.input} autoFocus />
            <button type="submit" style={s.primaryBtn}>Sign in</button>
            {authError && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{authError}</p>}
          </form>
        </div>
      </div>
    );
  }

  const active = pages.find((p) => p.key === activeKey);
  const onPlaylist = new Set((playlist?.tracks || []).map((t) => t.uri));

  return (
    <div style={s.page}>
      <div style={s.container}>
        <div style={s.header}>
          <div>
            <h1 style={s.title}>Fan Page Playlists</h1>
            <p style={s.subtitle}>Search or paste Spotify links to add. Remove takes the song off the playlist right away. The video pipeline reads these playlists.</p>
          </div>
        </div>

        <div style={s.tabs}>
          {pages.map((p) => (
            <button
              key={p.key}
              onClick={() => setActiveKey(p.key)}
              style={{ ...s.tab, ...(p.key === activeKey ? s.tabOn : {}), ...(p.configured ? {} : { opacity: 0.5 }) }}
              title={p.label}
            >
              <span style={{ fontWeight: 600 }}>{p.playlistName || p.key}</span>
              <span style={{ display: 'block', fontSize: 11, color: p.key === activeKey ? '#dbeafe' : '#777' }}>{p.label}</span>
            </button>
          ))}
        </div>

        {error && <div style={s.warnBox}>{error}</div>}
        {message && <div style={s.msgBox}>{message}</div>}

        {active && (
          <div style={s.grid}>
            <div style={s.card}>
              <div style={s.cardHead}>
                <span style={s.label}>Add songs</span>
                {active.playlistId && (
                  <a href={`https://open.spotify.com/playlist/${active.playlistId}`} target="_blank" rel="noreferrer" style={s.link}>Open on Spotify</a>
                )}
              </div>
              <input
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder="Search Spotify: song, artist"
                style={s.input}
              />
              {searching && <p style={s.hint}>Searching...</p>}
              {results.length > 0 && (
                <ul style={s.list}>
                  {results.map((t) => (
                    <li key={t.uri} style={s.row}>
                      {t.cover && <img src={t.cover} alt="" style={s.cover} />}
                      <div style={s.rowText}>
                        <div style={s.trackName}>{t.name}</div>
                        <div style={s.trackMeta}>{t.artists}{t.album ? ` · ${t.album}` : ''}</div>
                      </div>
                      {onPlaylist.has(t.uri) ? (
                        <span style={s.badge}>On playlist</span>
                      ) : (
                        <button onClick={() => addUri(t.uri)} disabled={busyUri === t.uri} style={s.smallPrimary}>Add</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ marginTop: 16 }}>
                <span style={s.label}>Or paste Spotify links / URIs (one per line)</span>
                <textarea value={pasteBox} onChange={(e) => setPasteBox(e.target.value)} rows={3} style={{ ...s.input, marginTop: 6, resize: 'vertical' }} placeholder="https://open.spotify.com/track/..." />
                <button onClick={addPasted} disabled={!pasteBox.trim() || !!busyUri} style={{ ...s.primaryBtn, marginTop: 8 }}>Add pasted</button>
              </div>
            </div>

            <div style={s.card}>
              <div style={s.cardHead}>
                <span style={s.label}>
                  {active.playlistName || 'Playlist'}{playlist ? ` · ${playlist.tracks.length} song${playlist.tracks.length === 1 ? '' : 's'}` : ''}
                </span>
                <button onClick={() => loadTracks(activeKey)} style={s.btn} disabled={loadingTracks}>{loadingTracks ? 'Loading...' : 'Refresh'}</button>
              </div>
              {active.nextReauthDue && (
                <p style={s.hint}>Spotify reauth due {new Date(active.nextReauthDue).toLocaleDateString()} (handled on the Mac mini). Account: {active.displayName || '?'}</p>
              )}
              {!playlist && !loadingTracks && <p style={s.muted}>No playlist loaded.</p>}
              {playlist && playlist.tracks.length === 0 && <p style={s.muted}>Empty. Add the first song on the left.</p>}
              {playlist && playlist.tracks.length > 0 && (
                <ol style={s.list}>
                  {playlist.tracks.map((t) => (
                    <li key={`${t.uri}-${t.position}`} style={s.row}>
                      <span style={s.pos}>{t.position + 1}</span>
                      {t.cover && <img src={t.cover} alt="" style={s.cover} />}
                      <div style={s.rowText}>
                        <div style={s.trackName}>{t.url ? <a href={t.url} target="_blank" rel="noreferrer" style={s.trackLink}>{t.name}</a> : t.name}</div>
                        <div style={s.trackMeta}>{t.artists}{t.addedAt ? ` · added ${new Date(t.addedAt).toLocaleDateString()}` : ''}</div>
                      </div>
                      <button onClick={() => removeUri(t.uri)} disabled={busyUri === t.uri} style={s.smallDanger}>Remove</button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}

        {active && (
          <div style={{ ...s.card, marginTop: 16 }}>
            <div style={s.cardHead}>
              <div>
                <span style={s.label}>Suggested for {active.playlistName || active.key}</span>
                <p style={{ ...s.hint, margin: '4px 0 0' }}>
                  Top songs right now in this page's genres. Viral first, then Spotify editorial playlists, then The Sound of genre playlists. Preview plays 30 seconds (the full song if you are signed in to Spotify in this browser).
                  {suggestions?.refreshedAt ? ` Updated ${new Date(suggestions.refreshedAt).toLocaleString()}.` : ''}
                </p>
              </div>
              <button onClick={() => loadSuggestions(activeKey, true)} style={s.btn} disabled={loadingSug}>{loadingSug ? 'Loading...' : 'Refresh suggestions'}</button>
            </div>
            {loadingSug && !suggestions && <p style={s.muted}>Building suggestions, this takes a few seconds the first time each day...</p>}
            {suggestions && suggestions.errors && suggestions.errors.length > 0 && (
              <p style={s.hint}>Some sources were skipped: {suggestions.errors.join('; ')}</p>
            )}
            {suggestions && ['viral', 'editorial', 'sounds'].map((group) => {
              const secs = suggestions.sections.filter((x) => x.group === group);
              if (!secs.length) return null;
              const groupTitle = group === 'viral' ? 'Viral now' : group === 'editorial' ? 'Spotify editorial playlists' : 'The Sound of (genre playlists)';
              const count = secs.reduce((n, x) => n + x.tracks.length, 0);
              return (
                <div key={group} style={{ marginTop: 14 }}>
                  <button onClick={() => setOpenGroups((g) => ({ ...g, [group]: !g[group] }))} style={s.groupHead}>
                    <span>{openGroups[group] ? '\u25BE' : '\u25B8'} {groupTitle}</span>
                    <span style={{ color: '#666', fontWeight: 400 }}>{count} song{count === 1 ? '' : 's'}</span>
                  </button>
                  {openGroups[group] && secs.map((sec) => (
                    <div key={sec.title + group} style={{ marginTop: 8 }}>
                      {group !== 'viral' && (
                        <div style={s.secTitle}>
                          {sec.playlistId ? <a href={`https://open.spotify.com/playlist/${sec.playlistId}`} target="_blank" rel="noreferrer" style={s.link}>{sec.title}</a> : sec.title}
                          <span style={{ color: '#666', fontWeight: 400 }}> · {sec.subtitle}</span>
                        </div>
                      )}
                      {group === 'viral' && sec.tracks.length === 0 && <p style={s.hint}>Nothing on the viral playlists matches this page's genres right now.</p>}
                      <ul style={s.list}>
                        {sec.tracks.map((t) => {
                          const on = onPlaylist.has(t.uri);
                          return (
                            <li key={`${group}-${t.id}`} style={{ ...s.rowWrap, ...(on ? { opacity: 0.55 } : {}) }}>
                              <div style={s.row}>
                                {t.cover && <img src={t.cover} alt="" style={s.cover} />}
                                <div style={s.rowText}>
                                  <div style={s.trackName}>{t.url ? <a href={t.url} target="_blank" rel="noreferrer" style={s.trackLink}>{t.name}</a> : t.name}</div>
                                  <div style={s.trackMeta}>{t.artists}</div>
                                </div>
                                <span style={s.srcBadge} title={sec.subtitle}>{group === 'viral' ? `Viral · ${t.sourceName}` : group === 'editorial' ? `Editorial · ${t.sourceName}` : t.sourceName}</span>
                                <button onClick={() => setPreviewId(previewId === t.id ? null : t.id)} style={s.btn}>{previewId === t.id ? 'Close' : 'Preview'}</button>
                                {on ? <span style={s.badge}>On playlist</span> : <button onClick={() => addUri(t.uri)} disabled={busyUri === t.uri} style={s.smallPrimary}>Add</button>}
                              </div>
                              {previewId === t.id && (
                                <iframe
                                  title={`Preview ${t.name}`}
                                  src={`https://open.spotify.com/embed/track/${t.id}?utm_source=generator&theme=0`}
                                  width="100%"
                                  height="80"
                                  frameBorder="0"
                                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                                  loading="lazy"
                                  style={{ borderRadius: 8, marginTop: 6 }}
                                />
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a', color: '#e5e5e5', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  container: { maxWidth: 1100, margin: '0 auto', padding: 24 },
  loginContainer: { maxWidth: 360, margin: '0 auto', padding: '20vh 24px 0' },
  loginForm: { display: 'flex', flexDirection: 'column', gap: 12 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, borderBottom: '1px solid #222', paddingBottom: 16, gap: 12, flexWrap: 'wrap' },
  title: { fontSize: 24, fontWeight: 700, color: '#fff', margin: 0 },
  subtitle: { fontSize: 13, color: '#888', margin: '4px 0 0', maxWidth: 720 },
  tabs: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 },
  tab: { padding: '8px 14px', background: '#141414', color: '#ccc', border: '1px solid #333', borderRadius: 10, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', minWidth: 150 },
  tabOn: { background: '#1d4ed8', color: '#fff', borderColor: '#1d4ed8' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' },
  card: { background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 18 },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' },
  primaryBtn: { padding: '10px 18px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  btn: { padding: '6px 12px', background: '#1c1c1c', color: '#ccc', border: '1px solid #333', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  smallPrimary: { padding: '6px 12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
  smallDanger: { padding: '6px 12px', background: '#1c1c1c', color: '#fca5a5', border: '1px solid #7f1d1d', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
  muted: { color: '#666', fontSize: 14, textAlign: 'center', padding: '30px 0' },
  hint: { color: '#777', fontSize: 12, margin: '8px 0' },
  input: { padding: '10px 12px', background: '#0e0e0e', color: '#fff', border: '1px solid #333', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  label: { fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' },
  link: { color: '#60a5fa', fontSize: 13, textDecoration: 'none' },
  list: { listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  row: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#0e0e0e', border: '1px solid #222', borderRadius: 8, flexWrap: 'wrap' },
  rowWrap: { display: 'flex', flexDirection: 'column' },
  groupHead: { width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#101010', color: '#fff', border: '1px solid #2a2a2a', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' },
  secTitle: { fontSize: 13, fontWeight: 600, color: '#ddd', margin: '10px 2px 0' },
  srcBadge: { fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#1a1a2a', border: '1px solid #33335a', color: '#a5b4fc', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' },
  pos: { width: 22, textAlign: 'right', color: '#666', fontSize: 12, flexShrink: 0 },
  cover: { width: 40, height: 40, borderRadius: 4, objectFit: 'cover', flexShrink: 0 },
  rowText: { flex: 1, minWidth: 0 },
  trackName: { fontSize: 14, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  trackLink: { color: '#fff', textDecoration: 'none' },
  trackMeta: { fontSize: 12, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  badge: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, border: '1px solid #444', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' },
  warnBox: { background: '#7c2d1222', border: '1px solid #b91c1c55', color: '#fca5a5', padding: '12px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 },
  msgBox: { background: '#14141a', border: '1px solid #333', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 14 },
};
