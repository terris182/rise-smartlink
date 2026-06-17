'use client';

import React, { useState, useEffect, useCallback } from 'react';

export default function CuratorClient() {
  const [authed, setAuthed] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [playlists, setPlaylists] = useState([]);
  const [account, setAccount] = useState(null);
  const [plError, setPlError] = useState('');

  const [editing, setEditing] = useState(null); // job object (with id) or {} for new
  const [runningId, setRunningId] = useState(null);
  const [message, setMessage] = useState('');

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/curator/jobs');
      if (res.status === 401) { setAuthed(false); return; }
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, []);

  const loadPlaylists = useCallback(async () => {
    setPlError('');
    try {
      const res = await fetch('/api/curator/playlists');
      const data = await res.json();
      if (!res.ok) { setPlError(data.error || 'Failed to load playlists'); return; }
      setPlaylists(data.playlists || []);
      setAccount(data.account || null);
    } catch (err) {
      setPlError(err.message);
    }
  }, []);

  useEffect(() => {
    fetch('/api/curator/jobs')
      .then((res) => {
        if (res.ok) setAuthed(true);
        setAuthChecking(false);
      })
      .catch(() => setAuthChecking(false));
  }, []);

  useEffect(() => {
    if (authed) { loadJobs(); loadPlaylists(); }
  }, [authed, loadJobs, loadPlaylists]);

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

  const playlistName = (id) => playlists.find((p) => p.id === id)?.name || '';

  const saveJob = async () => {
    setMessage('');
    const j = editing;
    const isInsert = !j.mode || j.mode === 'insert';
    if (!j.targetPlaylistId) { setMessage('Error: pick a target playlist'); return; }
    if (isInsert && !j.sourcePlaylistId) { setMessage('Error: pick a submissions (source) playlist'); return; }
    if (j.sourcePlaylistId && j.sourcePlaylistId === j.targetPlaylistId) { setMessage('Error: source and target must differ'); return; }
    const autoName = isInsert
      ? `${playlistName(j.sourcePlaylistId)} → ${playlistName(j.targetPlaylistId)}`
      : `${j.mode === 'refresh' ? 'Refresh' : 'Re-sort'}: ${playlistName(j.targetPlaylistId)}`;
    const payload = {
      ...j,
      name: j.name || autoName,
      sourcePlaylistName: playlistName(j.sourcePlaylistId),
      targetPlaylistName: playlistName(j.targetPlaylistId),
    };
    const res = await fetch('/api/curator/jobs', {
      method: j.id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) { setMessage(`Error: ${data.error}`); return; }
    setEditing(null);
    setMessage('Saved.');
    loadJobs();
  };

  const runNow = async (id) => {
    setRunningId(id);
    setMessage('');
    try {
      const res = await fetch('/api/curator/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: id }),
      });
      const data = await res.json();
      setMessage(res.ok ? `Run complete: ${data.result?.message || 'done'}` : `Error: ${data.error}`);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
    setRunningId(null);
    loadJobs();
  };

  const toggleActive = async (job) => {
    await fetch('/api/curator/jobs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: job.id, active: !job.active }),
    });
    loadJobs();
  };

  const deleteJob = async (id) => {
    await fetch(`/api/curator/jobs?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    setMessage('Deleted.');
    loadJobs();
  };

  if (authChecking) {
    return <div style={s.page}><div style={s.container}><p style={s.muted}>Loading…</p></div></div>;
  }

  if (!authed) {
    return (
      <div style={s.page}>
        <div style={s.loginContainer}>
          <h1 style={{ ...s.title, textAlign: 'center', marginBottom: 8 }}>GudMuzik</h1>
          <p style={{ color: '#888', textAlign: 'center', marginBottom: 24, fontSize: 14 }}>Auto-Curator — enter password</p>
          <form onSubmit={handleLogin} style={s.loginForm}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" style={s.input} autoFocus />
            <button type="submit" style={s.primaryBtn}>Log In</button>
            {authError && <p style={{ color: '#ef4444', fontSize: 13, margin: '8px 0 0' }}>{authError}</p>}
          </form>
        </div>
      </div>
    );
  }

  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }) : '—');

  return (
    <div style={s.page}>
      <div style={s.container}>
        <div style={s.header}>
          <div>
            <h1 style={s.title}>GudMuzik Auto-Curator</h1>
            <p style={s.subtitle}>{account ? `Connected: ${account.name || account.id}${account.email ? ` · ${account.email}` : ''}` : 'Energy-sorted playlist curation'}</p>
          </div>
          {!editing && (
            <button style={s.primaryBtn} onClick={() => setEditing({ mode: 'insert', energyDirection: 'desc', excludeTopN: 5, placementMode: 'window', windowSize: 30, active: true, cadence: 'manual', removeFromSource: false })}>+ New Curation</button>
          )}
        </div>

        {plError && (
          <div style={s.warnBox}>{plError}{' '}— set <code>SPOTIFY_CURATOR_*</code> env vars in Vercel.</div>
        )}
        {message && (
          <div style={{ ...s.msgBox, color: message.startsWith('Error') ? '#ef4444' : '#10b981' }}>{message}</div>
        )}

        {editing ? (
          <JobForm
            job={editing}
            playlists={playlists}
            onChange={(patch) => setEditing((p) => ({ ...p, ...patch }))}
            onSave={saveJob}
            onCancel={() => { setEditing(null); setMessage(''); }}
          />
        ) : loading ? (
          <p style={s.muted}>Loading curations…</p>
        ) : jobs.length === 0 ? (
          <p style={s.muted}>No curations yet. Click “+ New Curation” to create one.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {jobs.map((job) => (
              <div key={job.id} style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ color: '#fff', fontSize: 16 }}>{job.name}</strong>
                      <span style={{ ...s.badge, background: job.active ? '#10b98122' : '#33333322', color: job.active ? '#10b981' : '#888', borderColor: job.active ? '#10b98155' : '#444' }}>{job.active ? 'Active' : 'Paused'}</span>
                      <span style={{ ...s.badge, background: '#3b82f622', color: '#93c5fd', borderColor: '#3b82f655' }}>{job.mode === 'resort' ? 'Energy Re-Sort' : job.mode === 'refresh' ? 'Playlist Refresh' : 'Auto-Curator'}</span>
                      <span style={{ ...s.badge }}>{job.cadence === 'daily' ? 'Daily' : 'Manual'}</span>
                      <span style={{ ...s.badge }}>Energy {job.energyDirection === 'asc' ? 'low→high' : 'high→low'}</span>
                      <span style={{ ...s.badge }}>{(!job.mode || job.mode === 'insert') ? `Exclude top ${job.excludeTopN ?? 5}` : `Pin top ${job.excludeTopN ?? 3}`}</span>
                    </div>
                    <p style={{ color: '#9aa', margin: '8px 0 0', fontSize: 13 }}>
                      {(!job.mode || job.mode === 'insert')
                        ? <>{job.sourcePlaylistName || job.sourcePlaylistId} <span style={{ color: '#555' }}>→</span> {job.targetPlaylistName || job.targetPlaylistId}</>
                        : <>{job.mode === 'refresh' ? 'Refresh' : 'Re-sort'} {job.targetPlaylistName || job.targetPlaylistId}{job.sourcePlaylistId ? <> <span style={{ color: '#555' }}>+ new from</span> {job.sourcePlaylistName || job.sourcePlaylistId}</> : null}</>}
                    </p>
                    <p style={{ color: '#777', margin: '4px 0 0', fontSize: 12 }}>
                      Last run: {fmtDate(job.lastRun)} {job.lastResult ? `· ${job.lastResult.ok ? '✓' : '✗'} ${job.lastResult.message || ''}` : ''}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <button style={s.primaryBtn} onClick={() => runNow(job.id)} disabled={runningId === job.id}>{runningId === job.id ? 'Running…' : 'Run now'}</button>
                    <button style={s.btn} onClick={() => toggleActive(job)}>{job.active ? 'Pause' : 'Activate'}</button>
                    <button style={s.btn} onClick={() => setEditing(job)}>Edit</button>
                    <button style={{ ...s.btn, color: '#ef4444' }} onClick={() => deleteJob(job.id)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JobForm({ job, playlists, onChange, onSave, onCancel }) {
  const isInsert = !job.mode || job.mode === 'insert';
  const opts = [{ id: '', name: '— select a playlist —' }, ...playlists.map((p) => ({ id: p.id, name: `${p.name} (${p.trackCount})` }))];
  return (
    <div style={s.card}>
      <h2 style={{ color: '#fff', marginTop: 0, marginBottom: 16, fontSize: 18 }}>{job.id ? 'Edit Curation' : 'New Curation'}</h2>
      <div style={s.formGrid}>
        <Field label="Name (optional)">
          <input style={s.input} value={job.name || ''} onChange={(e) => onChange({ name: e.target.value })} placeholder="Auto-named if blank" />
        </Field>
        <Field label="Mode">
          <select style={s.input} value={job.mode || 'insert'} onChange={(e) => onChange({ mode: e.target.value })}>
            <option value="insert">Auto-Curator — add new tracks by energy (no resort)</option>
            <option value="resort">Energy Re-Sort — re-sort whole playlist by energy</option>
            <option value="refresh">Playlist Refresh — recency tiers + energy</option>
          </select>
        </Field>
        <Field label={isInsert ? 'Submissions playlist (source)' : 'Add new from (optional source)'}>
          <select style={s.input} value={job.sourcePlaylistId || ''} onChange={(e) => onChange({ sourcePlaylistId: e.target.value })}>
            {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
        <Field label={isInsert ? 'Curated playlist (target)' : 'Playlist (target)'}>
          <select style={s.input} value={job.targetPlaylistId || ''} onChange={(e) => onChange({ targetPlaylistId: e.target.value })}>
            {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
        <Field label={isInsert ? 'Exclude top N tracks (protected)' : 'Pin top N tracks (kept on top)'}>
          <input type="number" min="0" style={s.input} value={job.excludeTopN ?? (isInsert ? 5 : 3)} onChange={(e) => onChange({ excludeTopN: e.target.value })} />
        </Field>
        {job.mode === 'refresh' && (
          <Field label="Recency tiers (fixed)">
            <span style={{ color: '#9aa', fontSize: 13, padding: '8px 0' }}>≤2 weeks · 2–4 weeks · 1–2 months · older — each energy-sorted, oldest at bottom</span>
          </Field>
        )}
        {isInsert && (
          <Field label="Placement search">
            <select style={s.input} value={job.placementMode || 'window'} onChange={(e) => onChange({ placementMode: e.target.value })}>
              <option value="window">First N positions (forgiving toward the end)</option>
              <option value="throughout">Throughout the whole playlist</option>
            </select>
          </Field>
        )}
        {isInsert && (job.placementMode || 'window') === 'window' && (
          <Field label="Placement window size">
            <input type="number" min="1" style={s.input} value={job.windowSize ?? 30} onChange={(e) => onChange({ windowSize: e.target.value })} />
          </Field>
        )}
        <Field label="Energy order">
          <select style={s.input} value={job.energyDirection || 'desc'} onChange={(e) => onChange({ energyDirection: e.target.value })}>
            <option value="desc">High → Low (most energy at top)</option>
            <option value="asc">Low → High (least energy at top)</option>
          </select>
        </Field>
        <Field label="Schedule">
          <select style={s.input} value={job.cadence || 'manual'} onChange={(e) => onChange({ cadence: e.target.value })}>
            <option value="manual">Manual only</option>
            <option value="daily">Daily (auto)</option>
          </select>
        </Field>
        <Field label="Options">
          <label style={s.check}><input type="checkbox" checked={!!job.removeFromSource} onChange={(e) => onChange({ removeFromSource: e.target.checked })} /> Clear submissions after adding</label>
          <label style={s.check}><input type="checkbox" checked={job.active !== false} onChange={(e) => onChange({ active: e.target.checked })} /> Active</label>
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <button style={s.primaryBtn} onClick={onSave}>Save</button>
        <button style={s.btn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={s.label}>{label}</label>
      {children}
    </div>
  );
}

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a', color: '#e5e5e5', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  container: { maxWidth: 1000, margin: '0 auto', padding: 24 },
  loginContainer: { maxWidth: 360, margin: '0 auto', padding: '20vh 24px 0' },
  loginForm: { display: 'flex', flexDirection: 'column', gap: 12 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, borderBottom: '1px solid #222', paddingBottom: 20, gap: 12, flexWrap: 'wrap' },
  title: { fontSize: 24, fontWeight: 700, color: '#fff', margin: 0 },
  subtitle: { fontSize: 13, color: '#888', margin: '4px 0 0' },
  primaryBtn: { padding: '10px 18px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  btn: { padding: '10px 16px', background: '#1c1c1c', color: '#ccc', border: '1px solid #333', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' },
  muted: { color: '#666', fontSize: 14, textAlign: 'center', padding: '40px 0' },
  card: { background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 18 },
  badge: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, border: '1px solid #444', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.04em' },
  input: { padding: '10px 12px', background: '#0e0e0e', color: '#fff', border: '1px solid #333', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 },
  label: { fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' },
  check: { display: 'flex', alignItems: 'center', gap: 8, color: '#ccc', fontSize: 14 },
  warnBox: { background: '#7c2d1222', border: '1px solid #b91c1c55', color: '#fca5a5', padding: '12px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 },
  msgBox: { background: '#14141a', border: '1px solid #333', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 14 },
};
