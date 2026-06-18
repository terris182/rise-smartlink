'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const GREEN = '#1DB954';
const DARK = '#0d0d0d';

function action(act, params = {}) {
  return fetch('/api/pages/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: act, ...params }),
  }).then((r) => r.json());
}

function AccountChip({ user, onDisconnect }) {
  return (
    <div style={chipStyles.wrap}>
      {user.image && (
        <img src={user.image} alt={user.display_name} style={chipStyles.avatar} />
      )}
      <div style={chipStyles.info}>
        <div style={chipStyles.name}>{user.display_name}</div>
        <div style={chipStyles.sub}>{user.email} · {user.country} · {user.product}</div>
      </div>
      <button style={chipStyles.btn} onClick={onDisconnect}>Disconnect</button>
    </div>
  );
}

const chipStyles = {
  wrap: { display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.08)', borderRadius: '12px', padding: '8px 12px', marginBottom: '1rem', flexWrap: 'wrap' },
  avatar: { width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' },
  info: { flex: 1, minWidth: 0 },
  name: { color: '#fff', fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  sub: { color: 'rgba(255,255,255,0.55)', fontSize: '12px', marginTop: '2px' },
  btn: { background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '8px', color: '#fff', padding: '6px 12px', cursor: 'pointer', fontSize: '12px', flexShrink: 0 },
};

function StatusMsg({ msg }) {
  if (!msg) return null;
  return <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginTop: '6px', textAlign: 'center' }}>{msg}</div>;
}

export default function PagesClient({ trackId, trackUri, title, artistName, artistId, coverUrl, rawU }) {
  const router = useRouter();
  const [exchanging, setExchanging] = useState(false);
  const [user, setUser] = useState(null); // null = loading, false = not authed, object = authed
  const [authLoaded, setAuthLoaded] = useState(false);
  const [inputUrl, setInputUrl] = useState('');

  // Action states
  const [following, setFollowing] = useState(null);
  const [saved, setSaved] = useState(null);
  const [playlists, setPlaylists] = useState(null);
  const [myUserId, setMyUserId] = useState(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState('');
  const [playlistMsg, setPlaylistMsg] = useState('');
  const [createName, setCreateName] = useState('');
  const [createPublic, setCreatePublic] = useState(false);
  const [createDesc, setCreateDesc] = useState('');
  const [coverFile, setCoverFile] = useState(null);
  const [createMsg, setCreateMsg] = useState('');

  const [topType, setTopType] = useState('tracks');
  const [topItems, setTopItems] = useState(null);
  const [recentItems, setRecentItems] = useState(null);

  // Player
  const [deviceId, setDeviceId] = useState(null);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [playerState, setPlayerState] = useState(null);
  const [seekVal, setSeekVal] = useState(0);
  const [volume, setVolume] = useState(50);
  const [playerMsg, setPlayerMsg] = useState('');
  const sdkReady = useRef(false);
  const pollRef = useRef(null);

  const isPremium = user?.product === 'premium';

  // Step 1: OAuth exchange on mount if code present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (!code) return;
    setExchanging(true);
    fetch('/api/pages/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) window.location.replace(d.returnTo || '/pages');
        else { setExchanging(false); }
      })
      .catch(() => setExchanging(false));
  }, []);

  // Step 2: Load auth state
  useEffect(() => {
    if (exchanging) return;
    fetch('/api/pages/me')
      .then((r) => r.json())
      .then((d) => {
        if (d.authed) { setUser(d); setMyUserId(d.id); }
        else setUser(false);
        setAuthLoaded(true);
      })
      .catch(() => { setUser(false); setAuthLoaded(true); });
  }, [exchanging]);

  // Load follow + save state
  useEffect(() => {
    if (!user || !trackId) return;
    if (artistId) action('is_following', { artistId }).then((d) => setFollowing(d.following ?? null));
    action('is_saved', { trackId }).then((d) => setSaved(d.saved ?? null));
  }, [user, trackId, artistId]);

  // Load playlists
  useEffect(() => {
    if (!user) return;
    action('my_playlists').then((d) => {
      setPlaylists(d.playlists || []);
      if (d.userId) setMyUserId(d.userId);
    });
  }, [user]);

  // Load top items
  useEffect(() => {
    if (!user) return;
    action('top', { type: topType }).then((d) => setTopItems(d.items || []));
  }, [user, topType]);

  // Load recent
  useEffect(() => {
    if (!user) return;
    action('recently_played').then((d) => setRecentItems(d.items || []));
  }, [user]);

  // SDK setup
  useEffect(() => {
    if (!user || sdkReady.current || !isPremium) return;
    sdkReady.current = true;
    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify.Player({
        name: 'Gudmuzik Pages Player',
        getOAuthToken: (cb) =>
          fetch('/api/pages/token').then((r) => r.json()).then((d) => cb(d.access_token)),
        volume: 0.5,
      });
      player.addListener('ready', ({ device_id }) => setDeviceId(device_id));
      player.addListener('not_ready', () => setDeviceId(null));
      player.connect();
    };
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    document.body.appendChild(script);
  }, [user, isPremium]);

  // Poll now_playing
  useEffect(() => {
    if (!user) return;
    const poll = () => {
      action('now_playing').then((d) => setNowPlaying(d));
      action('playback_state').then((d) => setPlayerState(d));
    };
    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => clearInterval(pollRef.current);
  }, [user]);

  const handleDisconnect = useCallback(() => {
    fetch('/api/pages/logout', { method: 'POST' }).then(() => window.location.reload());
  }, []);

  const connectUrl = `/api/pages/login?return=${encodeURIComponent(
    typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/pages'
  )}`;

  const requireAuth = (fn) => () => {
    if (!user) window.location.href = connectUrl;
    else fn();
  };

  const handleFollow = requireAuth(async () => {
    if (following) {
      await action('unfollow_artist', { artistId });
      setFollowing(false);
    } else {
      await action('follow_artist', { artistId });
      setFollowing(true);
    }
  });

  const handleSave = requireAuth(async () => {
    if (saved) {
      await action('remove_saved', { trackId });
      setSaved(false);
    } else {
      await action('save_track', { trackId });
      setSaved(true);
    }
  });

  const handleAddToPlaylist = requireAuth(async () => {
    if (!selectedPlaylist || !trackUri) return;
    const d = await action('add_to_playlist', { playlistId: selectedPlaylist, uri: trackUri });
    setPlaylistMsg(d.ok ? 'Added!' : `Error: ${d.error || d.status}`);
  });

  const handleCreatePlaylist = requireAuth(async () => {
    if (!createName) return;
    setCreateMsg('Creating...');
    const created = await action('create_playlist', {
      name: createName, isPublic: createPublic, description: createDesc, userId: myUserId,
    });
    if (!created.id) { setCreateMsg(`Error: ${created.error}`); return; }
    if (trackUri) await action('add_to_playlist', { playlistId: created.id, uri: trackUri });
    if (coverFile) {
      const b64 = await fileToJpegBase64(coverFile);
      if (b64) await action('upload_cover', { playlistId: created.id, imageBase64: b64 });
    }
    setCreateMsg(`Created! Open on Spotify`);
    setCreateName('');
  });

  async function fileToJpegBase64(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX = 512;
          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve(dataUrl.split(',')[1]);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  const handlePlay = requireAuth(async () => {
    if (!trackUri) return;
    setPlayerMsg('Transferring...');
    if (deviceId) await action('transfer', { deviceId });
    await action('play', { uris: [trackUri], deviceId, position_ms: 0 });
    setPlayerMsg('Playing');
  });

  if (exchanging) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: DARK }}>
        <div style={{ color: '#fff', fontSize: '16px' }}>Finishing Spotify sign-in…</div>
      </div>
    );
  }

  return (
    <div style={s.wrapper}>
      {coverUrl && <div style={{ ...s.bgImage, backgroundImage: `url(${coverUrl})` }} />}
      <div style={s.bgOverlay} />

      <div style={s.container}>
        {/* Auth chip or connect button */}
        <div style={{ width: '100%', maxWidth: 440, marginBottom: '1rem' }}>
          {authLoaded && user ? (
            <AccountChip user={user} onDisconnect={handleDisconnect} />
          ) : authLoaded && !user ? (
            <a href={connectUrl} style={s.connectBtn}>
              <SpotifyIcon /> Connect with Spotify
            </a>
          ) : null}
        </div>

        {/* Track card */}
        <div style={s.card}>
          {coverUrl ? (
            <img src={coverUrl} alt={title || 'Track'} style={s.cover} />
          ) : (
            <div style={s.coverPlaceholder} />
          )}
          {title ? (
            <>
              <h1 style={s.title}>{title}</h1>
              {artistName && <p style={s.artist}>{artistName}</p>}
            </>
          ) : (
            <div style={{ width: '100%', marginTop: '1rem' }}>
              <p style={{ color: 'rgba(255,255,255,0.6)', textAlign: 'center', fontSize: '14px', marginBottom: '8px' }}>Paste a Spotify track link</p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="https://open.spotify.com/track/..."
                  style={s.input}
                />
                <button
                  style={s.smBtn}
                  onClick={() => inputUrl && router.push('/pages?u=' + encodeURIComponent(inputUrl))}
                >Go</button>
              </div>
            </div>
          )}
        </div>

        {/* Track actions */}
        {trackId && (
          <div style={s.section}>
            <h2 style={s.sectionTitle}>Track Actions</h2>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {artistId && (
                <button style={{ ...s.actionBtn, background: following ? GREEN : 'rgba(255,255,255,0.1)' }} onClick={handleFollow}>
                  {following ? 'Following ✓' : 'Follow Artist'}
                </button>
              )}
              <button style={{ ...s.actionBtn, background: saved ? GREEN : 'rgba(255,255,255,0.1)' }} onClick={handleSave}>
                {saved ? 'Saved ✓' : 'Save to Liked Songs'}
              </button>
            </div>

            {/* Add to playlist */}
            <div style={{ marginTop: '12px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  style={s.select}
                  value={selectedPlaylist}
                  onChange={(e) => setSelectedPlaylist(e.target.value)}
                >
                  <option value="">— Add to playlist —</option>
                  {(playlists || []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button style={s.smBtn} onClick={handleAddToPlaylist}>Add</button>
              </div>
              <StatusMsg msg={playlistMsg} />
            </div>

            {/* Create playlist */}
            <div style={{ marginTop: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', padding: '12px' }}>
              <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Create playlist + add this song</div>
              <input style={{ ...s.input, marginBottom: '8px' }} placeholder="Playlist name" value={createName} onChange={(e) => setCreateName(e.target.value)} />
              <input style={{ ...s.input, marginBottom: '8px' }} placeholder="Description (optional)" value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} />
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', display: 'flex', gap: '6px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={createPublic} onChange={(e) => setCreatePublic(e.target.checked)} />
                  Public
                </label>
                <label style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', cursor: 'pointer' }}>
                  Cover image (JPEG/PNG):
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => setCoverFile(e.target.files[0])} />
                  <span style={{ ...s.smBtn, marginLeft: '8px', display: 'inline-block' }}>{coverFile ? coverFile.name.slice(0, 14) + '…' : 'Choose'}</span>
                </label>
              </div>
              <button style={{ ...s.actionBtn, background: GREEN }} onClick={handleCreatePlaylist}>Create & Add</button>
              <StatusMsg msg={createMsg} />
            </div>
          </div>
        )}

        {/* Personalization */}
        {user && (
          <div style={s.section}>
            <h2 style={s.sectionTitle}>Your Listening</h2>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              {['tracks', 'artists'].map((t) => (
                <button key={t} style={{ ...s.tabBtn, background: topType === t ? GREEN : 'rgba(255,255,255,0.1)' }} onClick={() => setTopType(t)}>
                  Top {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(topItems || []).map((item, i) => (
                <TopItem key={item.id} item={item} index={i} type={topType} />
              ))}
              {!topItems && <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>Loading...</div>}
            </div>

            <h3 style={{ ...s.sectionTitle, fontSize: '14px', marginTop: '20px' }}>Recently Played</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(recentItems || []).map((item, i) => (
                <TopItem key={i} item={item.track} index={i} type="tracks" />
              ))}
              {!recentItems && <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>Loading...</div>}
            </div>
          </div>
        )}

        {/* Player */}
        {trackId && (
          <div style={s.section}>
            <h2 style={s.sectionTitle}>Player {!isPremium && user && <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>(Requires Spotify Premium)</span>}</h2>

            {nowPlaying?.playing && (
              <div style={{ background: 'rgba(29,185,84,0.12)', borderRadius: '8px', padding: '8px 12px', marginBottom: '10px', color: '#fff', fontSize: '13px' }}>
                Now Playing: {nowPlaying.item?.name} — {nowPlaying.item?.artists?.[0]?.name}
              </div>
            )}

            {playerState?.active && (
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', marginBottom: '8px' }}>
                Device: {playerState.device?.name} ({playerState.device?.type})
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
              <button style={s.playerBtn} disabled={!isPremium} onClick={handlePlay}>Play This Song</button>
              <button style={s.playerBtn} disabled={!isPremium} onClick={() => action('pause')}>Pause</button>
              <button style={s.playerBtn} disabled={!isPremium} onClick={() => action('previous')}>Previous</button>
              <button style={s.playerBtn} disabled={!isPremium} onClick={() => action('next')}>Next</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>
                Seek (ms): {seekVal}
                <input type="range" min={0} max={300000} step={1000} value={seekVal}
                  onChange={(e) => setSeekVal(Number(e.target.value))}
                  onMouseUp={() => isPremium && action('seek', { position_ms: seekVal })}
                  style={{ width: '100%', accentColor: GREEN }}
                />
              </label>
              <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>
                Volume: {volume}%
                <input type="range" min={0} max={100} value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  onMouseUp={() => isPremium && action('volume', { percent: volume })}
                  style={{ width: '100%', accentColor: GREEN }}
                />
              </label>
            </div>
            <StatusMsg msg={playerMsg} />
          </div>
        )}

        {/* Footer */}
        <div style={s.footer}>
          <span>Powered by Gudmuzik — we never store your Spotify data; actions happen only when you click.</span>
          <div style={{ marginTop: '6px', display: 'flex', gap: '16px', justifyContent: 'center' }}>
            <a href="/legal/privacy" style={s.footerLink}>Privacy Policy</a>
            <a href="/legal/eula" style={s.footerLink}>Terms / EULA</a>
          </div>
        </div>
      </div>
    </div>
  );
}

function TopItem({ item, index, type }) {
  if (!item) return null;
  const img = type === 'tracks' ? item.album?.images?.[1]?.url : item.images?.[1]?.url;
  const name = item.name;
  const sub = type === 'tracks' ? item.artists?.map((a) => a.name).join(', ') : item.genres?.slice(0, 2).join(', ');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0' }}>
      <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px', width: '18px', textAlign: 'right' }}>{index + 1}</span>
      {img ? <img src={img} alt={name} style={{ width: 36, height: 36, borderRadius: '4px', objectFit: 'cover' }} /> : <div style={{ width: 36, height: 36, borderRadius: '4px', background: 'rgba(255,255,255,0.1)' }} />}
      <div>
        <div style={{ color: '#fff', fontSize: '13px', fontWeight: 500 }}>{name}</div>
        {sub && <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '11px' }}>{sub}</div>}
      </div>
    </div>
  );
}

function SpotifyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style={{ flexShrink: 0 }}>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
  );
}

const s = {
  wrapper: {
    position: 'relative',
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    overflow: 'hidden',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    background: DARK,
    paddingTop: '2rem',
    paddingBottom: '3rem',
  },
  bgImage: {
    position: 'fixed',
    inset: '-40px',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: 'blur(60px) brightness(0.35)',
    transform: 'scale(1.2)',
    zIndex: 0,
  },
  bgOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.65) 100%)',
    zIndex: 1,
  },
  container: {
    position: 'relative',
    zIndex: 2,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '1.5rem',
    width: '100%',
    maxWidth: '480px',
  },
  card: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: '16px',
    padding: '1.5rem',
    marginBottom: '1.5rem',
    border: '1px solid rgba(255,255,255,0.07)',
  },
  cover: {
    width: 220,
    height: 220,
    objectFit: 'cover',
    borderRadius: '10px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    marginBottom: '1rem',
  },
  coverPlaceholder: {
    width: 220,
    height: 220,
    borderRadius: '10px',
    background: 'rgba(255,255,255,0.07)',
    marginBottom: '1rem',
  },
  title: { fontSize: '20px', fontWeight: 700, color: '#fff', margin: '0 0 4px', textAlign: 'center' },
  artist: { fontSize: '15px', color: 'rgba(255,255,255,0.65)', margin: 0, textAlign: 'center' },
  connectBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    width: '100%',
    padding: '14px 24px',
    background: GREEN,
    color: '#000',
    fontWeight: 700,
    fontSize: '15px',
    borderRadius: '50px',
    textDecoration: 'none',
    boxShadow: '0 4px 20px rgba(29,185,84,0.35)',
  },
  section: {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: '14px',
    padding: '1.25rem',
    marginBottom: '1rem',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  sectionTitle: { fontSize: '15px', fontWeight: 700, color: '#fff', margin: '0 0 12px' },
  actionBtn: {
    padding: '10px 18px',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontWeight: 600,
    fontSize: '13px',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  tabBtn: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontWeight: 600,
    fontSize: '13px',
    cursor: 'pointer',
  },
  playerBtn: {
    padding: '10px 14px',
    border: 'none',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.12)',
    color: '#fff',
    fontWeight: 600,
    fontSize: '13px',
    cursor: 'pointer',
    opacity: 1,
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '13px',
    boxSizing: 'border-box',
    outline: 'none',
  },
  smBtn: {
    padding: '10px 16px',
    background: 'rgba(255,255,255,0.12)',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontWeight: 600,
    fontSize: '13px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  select: {
    flex: 1,
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '13px',
  },
  footer: {
    marginTop: '1.5rem',
    textAlign: 'center',
    color: 'rgba(255,255,255,0.35)',
    fontSize: '11px',
    lineHeight: 1.6,
  },
  footerLink: {
    color: 'rgba(255,255,255,0.4)',
    textDecoration: 'underline',
    fontSize: '11px',
  },
};
