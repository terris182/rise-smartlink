'use client';

import { useEffect, useRef, useCallback } from 'react';
import Script from 'next/script';

/**
 * Client-side Smart Link page component.
 * Handles:
 * 1. Visual layout (Hypeddit-style: blurred BG, cover art, streaming buttons)
 * 2. Facebook Pixel (browser-side) for PageView + custom events
 * 3. Facebook Conversions API (server-side via /api/track) for the same events
 * 4. Event deduplication using shared event_id between pixel and CAPI
 */

// Generate a unique event ID
function generateEventId() {
  return 'evt_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Get cookie value by name
function getCookie(name) {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

// Send server-side CAPI event
async function sendServerEvent({ eventName, eventId, link, customData = {} }) {
  try {
    const fbc = getCookie('_fbc');
    const fbp = getCookie('_fbp');

    await fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventName,
        eventId,
        sourceUrl: window.location.href,
        pixelId: link.fbPixelId,
        accessToken: link.fbAccessToken,
        fbc: fbc || undefined,
        fbp: fbp || undefined,
        customData,
      }),
      // Use keepalive so the request survives navigation
      keepalive: true,
    });
  } catch (err) {
    console.warn('[CAPI] Failed to send server event:', err);
  }
}

export default function SmartLinkClient({ link }) {
  const hasFired = useRef(false);

  // Fire PageView + Smart Link Visit on load
  useEffect(() => {
    if (hasFired.current) return;
    hasFired.current = true;

    // Wait for FB pixel to initialize
    const fireEvents = () => {
      const pageViewId = generateEventId();
      const visitId = generateEventId();
      const customData = {
        artist_name: link.artist,
        title: link.title,
        genre: link.genre,
      };

      // Browser-side pixel events
      if (typeof window.fbq === 'function') {
        window.fbq('track', 'PageView', {}, { eventID: pageViewId });
        window.fbq('trackCustom', 'SmartLinkVisit', customData, { eventID: visitId });
      }

      // Server-side CAPI events (same event IDs for dedup)
      if (link.fbPixelId && link.fbAccessToken) {
        sendServerEvent({ eventName: 'PageView', eventId: pageViewId, link });
        sendServerEvent({
          eventName: 'SmartLinkVisit',
          eventId: visitId,
          link,
          customData,
        });
      }
    };

    // Small delay to let pixel script load
    if (typeof window.fbq === 'function') {
      fireEvents();
    } else {
      const timer = setTimeout(fireEvents, 800);
      return () => clearTimeout(timer);
    }
  }, [link]);

  // Handle streaming link click with tracking
  const handleLinkClick = useCallback(
    (platform, url) => {
      const clickId = generateEventId();
      const customData = {
        artist_name: link.artist,
        title: link.title,
        genre: link.genre,
        platform,
      };

      // Browser-side pixel
      if (typeof window.fbq === 'function') {
        window.fbq('trackCustom', 'SmartLinkClick', customData, { eventID: clickId });
      }

      // Server-side CAPI
      if (link.fbPixelId && link.fbAccessToken) {
        sendServerEvent({
          eventName: 'SmartLinkClick',
          eventId: clickId,
          link,
          customData,
        });
      }

      // Navigate after a tiny delay to ensure tracking fires
      setTimeout(() => {
        window.open(url, '_blank', 'noopener');
      }, 150);
    },
    [link]
  );

  // Spotify SVG icon
  const SpotifyIcon = () => (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="#1DB954">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381C8.64 5.801 15.6 6.06 20.04 8.94c.6.36.72 1.08.36 1.62-.36.48-1.08.66-1.62.36-.24-.12-.36-.24-.48-.36l.18.12z"/>
    </svg>
  );

  // Apple Music SVG icon
  const AppleMusicIcon = () => (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="#FA243C">
      <path d="M23.994 6.124a9.23 9.23 0 00-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043a5.022 5.022 0 00-1.877-.726 10.496 10.496 0 00-1.564-.15c-.073-.005-.146-.01-.22-.015H5.988c-.076.005-.15.01-.225.015a10.487 10.487 0 00-1.564.15 5.022 5.022 0 00-1.877.726C1.204 1.644.46 2.644.143 3.954a9.23 9.23 0 00-.24 2.19L0 6.2v11.8c.003.076.006.151.01.227.017.387.05.774.107 1.159.14.962.472 1.848 1.014 2.638a4.96 4.96 0 001.837 1.597c.517.26 1.065.437 1.64.527.39.06.784.093 1.18.108.07.004.141.008.212.012h12.2c.071-.004.142-.008.213-.012a10.5 10.5 0 001.18-.108 5.022 5.022 0 001.64-.527 4.96 4.96 0 001.837-1.597c.542-.79.873-1.676 1.014-2.638.057-.385.09-.772.107-1.16L24 17.8V6.2l-.006-.076zM16.95 17.333c0 .343-.097.653-.284.927-.187.274-.44.477-.76.612-.218.09-.448.158-.69.204a4.677 4.677 0 01-.805.065c-.12-.003-.24-.017-.358-.042a1.62 1.62 0 01-.661-.29 1.162 1.162 0 01-.442-.646 1.455 1.455 0 01-.02-.67c.06-.26.183-.485.37-.674.187-.188.41-.33.668-.426.258-.098.53-.17.814-.222.283-.05.568-.09.854-.118.17-.018.3-.07.393-.154.094-.083.14-.2.14-.347V9.58a.456.456 0 00-.098-.316.472.472 0 00-.302-.154l-5.264.996a.393.393 0 00-.246.125.404.404 0 00-.09.28l-.003 7.51c0 .343-.092.65-.276.924-.184.274-.434.477-.75.612-.216.09-.444.158-.683.204-.24.046-.484.067-.733.065a2.66 2.66 0 01-.356-.042 1.62 1.62 0 01-.662-.29 1.162 1.162 0 01-.442-.646 1.455 1.455 0 01-.02-.67c.06-.26.183-.485.37-.674.187-.188.41-.33.668-.426.258-.098.53-.17.815-.222.283-.05.567-.09.853-.118.17-.018.3-.07.393-.154.094-.083.14-.2.14-.347V7.257c0-.2.052-.37.157-.514.104-.144.25-.24.44-.29l6.188-1.296a.792.792 0 01.17-.022c.17 0 .305.055.404.165.1.11.15.26.15.445v11.588z"/>
    </svg>
  );

  // SoundCloud SVG icon
  const SoundCloudIcon = () => (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="#FF5500">
      <path d="M1.175 12.225c-.051 0-.094.046-.101.1l-.233 2.154.233 2.105c.007.058.05.098.101.098.05 0 .09-.04.099-.098l.255-2.105-.255-2.154c-.009-.054-.048-.1-.099-.1zm-.899.828c-.06 0-.091.037-.104.094L0 14.479l.172 1.308c.013.06.045.094.104.094.057 0 .093-.035.104-.094l.2-1.308-.2-1.332c-.011-.057-.047-.094-.104-.094zm1.822-.742c-.063 0-.113.05-.12.114l-.2 2.048.2 2.018c.007.063.057.114.12.114.063 0 .11-.05.12-.114l.23-2.018-.23-2.048c-.01-.063-.057-.114-.12-.114zm.938-.296c-.073 0-.128.06-.136.13l-.17 2.344.17 2.286c.008.073.063.13.136.13.07 0 .126-.057.135-.13l.198-2.286-.198-2.344c-.009-.07-.065-.13-.135-.13zm.998-.142c-.083 0-.148.068-.155.15l-.14 2.486.14 2.424c.007.083.072.15.155.15.08 0 .146-.067.155-.15l.16-2.424-.16-2.486c-.009-.082-.075-.15-.155-.15zm1.06-.32c-.093 0-.166.077-.172.17l-.132 2.806.132 2.569c.006.093.08.166.172.166.09 0 .164-.073.172-.166l.15-2.569-.15-2.807c-.008-.092-.082-.17-.172-.17zm1.065-.437c-.1 0-.184.088-.19.19l-.12 3.243.12 2.61c.006.1.09.186.19.186.098 0 .18-.086.19-.186l.138-2.61-.138-3.243c-.01-.103-.092-.19-.19-.19zm1.062-.065c-.11 0-.2.098-.207.21l-.108 3.308.108 2.628c.007.112.097.2.207.2.108 0 .197-.088.207-.2l.122-2.628-.122-3.308c-.01-.112-.1-.21-.207-.21zm1.082-.177c-.118 0-.213.105-.22.224l-.094 3.485.094 2.642c.007.12.102.213.22.213.117 0 .21-.094.22-.213l.108-2.642-.108-3.485c-.01-.12-.103-.224-.22-.224zm1.08.082c-.128 0-.233.112-.238.24l-.084 3.403.084 2.632c.005.126.11.232.238.232.126 0 .23-.106.238-.232l.095-2.632-.095-3.403c-.008-.128-.112-.24-.238-.24zm1.1-.282c-.138 0-.248.12-.254.258l-.073 3.685.073 2.625c.006.136.116.248.254.248.136 0 .246-.112.254-.248l.083-2.625-.083-3.685c-.008-.138-.118-.258-.254-.258zm1.092-.42c-.148 0-.27.127-.275.275l-.06 4.105.06 2.613c.005.146.127.264.275.264.146 0 .265-.118.275-.264l.068-2.613-.068-4.105c-.01-.148-.13-.275-.275-.275zm1.116-.325c-.155 0-.283.135-.29.29l-.05 4.43.05 2.597c.007.156.135.28.29.28.154 0 .28-.124.29-.28l.055-2.597-.055-4.43c-.01-.155-.136-.29-.29-.29zm1.112.12c-.166 0-.3.14-.305.304l-.04 4.006.04 2.587c.005.163.14.293.305.293.163 0 .296-.13.305-.293l.044-2.587-.044-4.006c-.009-.164-.142-.303-.305-.303zm2.354-.95c-.2-.09-.424-.14-.658-.14-.164 0-.323.02-.476.065a4.397 4.397 0 00-4.04-2.695c-.365 0-.723.05-1.06.145-.125.036-.158.073-.16.147v8.686c.002.077.06.14.136.152h6.258a2.224 2.224 0 002.224-2.224 2.224 2.224 0 00-2.224-2.224v.088z"/>
    </svg>
  );

  return (
    <>
      {/* Facebook Pixel Script - only load if pixel ID exists */}
      {link.fbPixelId && (
        <Script
          id="fb-pixel"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              !function(f,b,e,v,n,t,s)
              {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];
              s.parentNode.insertBefore(t,s)}(window, document,'script',
              'https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', '${link.fbPixelId}');
            `,
          }}
        />
      )}

      <div style={styles.wrapper}>
        {/* Blurred background using cover art */}
        <div
          style={{
            ...styles.bgImage,
            backgroundImage: `url(${link.coverUrl})`,
          }}
        />
        <div style={styles.bgOverlay} />

        {/* Main content */}
        <div style={styles.container}>
          {/* Cover art */}
          <div style={styles.coverWrapper}>
            <img
              src={link.coverUrl}
              alt={`${link.title} by ${link.artist}`}
              style={styles.coverImg}
              width={300}
              height={300}
              loading="eager"
            />
          </div>

          {/* Title + Artist */}
          <h1 style={styles.title}>{link.title}</h1>
          <p style={styles.artist}>{link.artist}</p>

          {/* Streaming buttons */}
          <div style={styles.buttonList}>
            {link.spotifyUrl && (
              <button
                onClick={() => handleLinkClick('spotify', link.spotifyUrl)}
                style={styles.streamButton}
              >
                <span style={styles.buttonIcon}><SpotifyIcon /></span>
                <span style={styles.buttonLabel}>Spotify</span>
                <span style={styles.playBtn}>Play</span>
              </button>
            )}

            {link.appleMusicUrl && (
              <button
                onClick={() => handleLinkClick('apple_music', link.appleMusicUrl)}
                style={styles.streamButton}
              >
                <span style={styles.buttonIcon}><AppleMusicIcon /></span>
                <span style={styles.buttonLabel}>Apple Music</span>
                <span style={styles.playBtn}>Play</span>
              </button>
            )}

            {link.soundcloudUrl && (
              <button
                onClick={() => handleLinkClick('soundcloud', link.soundcloudUrl)}
                style={styles.streamButton}
              >
                <span style={styles.buttonIcon}><SoundCloudIcon /></span>
                <span style={styles.buttonLabel}>SoundCloud</span>
                <span style={styles.playBtn}>Play</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// Inline styles for maximum performance (no external CSS to load)
const styles = {
  wrapper: {
    position: 'relative',
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bgImage: {
    position: 'absolute',
    inset: '-20px',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: 'blur(30px) brightness(0.5)',
    transform: 'scale(1.1)',
    zIndex: 0,
  },
  bgOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    zIndex: 1,
  },
  container: {
    position: 'relative',
    zIndex: 2,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '2rem 1.5rem',
    width: '100%',
    maxWidth: '420px',
  },
  coverWrapper: {
    width: '280px',
    height: '280px',
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
    marginBottom: '1.5rem',
  },
  coverImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 700,
    textAlign: 'center',
    color: '#fff',
    margin: 0,
    lineHeight: 1.2,
  },
  artist: {
    fontSize: '1rem',
    fontWeight: 400,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.8)',
    margin: '0.25rem 0 0',
  },
  buttonList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    width: '100%',
    marginTop: '2rem',
  },
  streamButton: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    background: '#fff',
    border: 'none',
    borderRadius: '10px',
    padding: '0.85rem 1.25rem',
    cursor: 'pointer',
    transition: 'transform 0.1s, box-shadow 0.2s',
    boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
    fontSize: '1rem',
  },
  buttonIcon: {
    display: 'flex',
    alignItems: 'center',
    marginRight: '0.75rem',
  },
  buttonLabel: {
    flex: 1,
    textAlign: 'left',
    fontWeight: 600,
    color: '#222',
    fontSize: '1rem',
  },
  playBtn: {
    padding: '0.4rem 1.25rem',
    border: '1.5px solid #ddd',
    borderRadius: '20px',
    fontSize: '0.875rem',
    fontWeight: 600,
    color: '#333',
    background: 'transparent',
  },
};
