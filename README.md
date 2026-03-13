# Rise Smart Links

Fast music landing pages with Facebook Conversions API tracking, built for Vercel.

Designed to replicate the Hypeddit smart link experience but with full control over Facebook CAPI tracking, faster load times, and your own domain.

## Features

- **Hypeddit-style design**: Blurred cover art background, centered artwork, song title, artist name, streaming service buttons
- **Mobile-first**: Responsive layout optimized for mobile (where most FB ad traffic lands)
- **Facebook Pixel** (browser-side): PageView + custom SmartLinkVisit + SmartLinkClick events
- **Facebook Conversions API** (server-side): Same events sent server-side for iOS 14.5+ tracking reliability
- **Event deduplication**: Shared event IDs between browser pixel and CAPI to prevent double-counting
- **OG/Twitter meta tags**: Proper social sharing previews with cover art
- **API-driven**: Create new smart link pages via API
- **Sub-100KB page load**: Minimal JS, inline styles, no external CSS frameworks

## Architecture

```
/app
  /[slug]/page.js          - Server component: fetches link data, generates meta tags
  /[slug]/SmartLinkClient.js - Client component: visual UI, FB pixel, CAPI calls
  /api/track/route.js      - Server-side FB Conversions API endpoint
  /api/create-link/route.js - API to create new smart links
/lib
  /fb-capi.js              - Facebook Conversions API helper (SHA-256 hashing, event sending)
  /links.js                - Link data store (replace with DB for production)
```

## Tracking Flow

1. User lands on `/my-song` from a Facebook ad
2. **Browser**: FB Pixel fires `PageView` + `SmartLinkVisit` with event IDs
3. **Server**: Same events sent to FB CAPI via `/api/track` with matching event IDs
4. FB deduplicates using the shared event_id
5. User clicks "Play" on Spotify
6. **Browser + Server**: `SmartLinkClick` event fires with platform info
7. User redirects to Spotify

## Setup

### 1. Clone & Install
```bash
git clone <repo>
cd rise-smartlink
npm install
```

### 2. Environment Variables
```bash
cp .env.example .env.local
```

Edit `.env.local`:
```
FB_PIXEL_ID=your_pixel_id
FB_ACCESS_TOKEN=your_capi_access_token
```

### 3. Deploy to Vercel
```bash
npx vercel
# or connect your GitHub repo to Vercel
```

Set the same env vars in Vercel dashboard > Settings > Environment Variables.

## API Usage

### Create a Smart Link
```bash
POST /api/create-link
Content-Type: application/json

{
  "slug": "my-new-song",
  "title": "My New Song",
  "artist": "Artist Name",
  "coverUrl": "https://i.scdn.co/image/...",
  "spotifyUrl": "https://open.spotify.com/track/...",
  "appleMusicUrl": "https://music.apple.com/...",     // optional
  "soundcloudUrl": "https://soundcloud.com/...",      // optional
  "genre": "Pop",                                     // optional
  "fbPixelId": "123456789",                           // optional, falls back to env
  "fbAccessToken": "EAAG...",                         // optional, falls back to env
  "bgColor": "#1a1a2e"                                // optional
}
```

The page is then live at `https://yourdomain.com/my-new-song`

### Custom Events Tracked

| Event | When | Custom Data |
|-------|------|-------------|
| `PageView` | Page load | - |
| `SmartLinkVisit` | Page load | artist_name, title, genre |
| `SmartLinkClick` | Button click | artist_name, title, genre, platform |

## Production Notes

### Replace In-Memory Store with a Database
The current `lib/links.js` uses an in-memory Map. For production, swap it with:
- **Vercel KV** (Redis) - simplest for Vercel
- **Vercel Postgres** - if you need SQL
- **Supabase** - free tier, Postgres
- **PlanetScale** - MySQL

### Facebook Cookie Handling
The page reads `_fbc` and `_fbp` cookies automatically. These are set by the FB Pixel script. The CAPI calls include them for user matching.

### Custom Domain
Point your domain (e.g., `music.rise.la`) to Vercel for branded smart links.
