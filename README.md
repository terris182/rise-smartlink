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

### Reuse an Existing Link (find-or-create)

By default `POST /api/create-link` always mints a new slug and appends `-1`, `-2` when the slug is taken. When ad setup is resumed this produces a second link (for example `leela-1`) for the same song, which splits traffic and pixel data. Callers that want the existing link back can opt in.

**Opt-in flag on create-link**

```bash
POST /api/create-link
Content-Type: application/json

{
  "spotifyUrl": "https://open.spotify.com/track/<trackId>?si=abc",
  "artist": "Artist Name",
  "reuseExisting": true,
  "dealId": "12345"
}
```

- `reuseExisting` (boolean, or the string `"true"`): when set, the existing link for the same song is returned instead of creating a new one. When omitted or false, behavior and response are exactly as before.
- `dealId` (optional string): stored in the reuse index when a new link is created. When `reuseExisting` is set it is checked first.

Match order when `reuseExisting` is set:

1. `dealId`, if it was indexed when a link was created and that link points at the same Spotify track (or the request is not a track URL).
2. Spotify track id plus artist. The track id is parsed from the URL, so `?si=` and other query strings do not matter. The artist is the name from the request, or the one fetched from Spotify when omitted.
3. For links created before the index existed: if the generated slug or one of its `-N` variants (`leela`, `leela-1`, and so on) already points at the same track id, that link is returned. This is a read only check.

Only Spotify track URLs are matched by song. Album and playlist URLs fall through to normal creation unless a `dealId` match exists.

**Response**

Same shape as a normal create, plus `reused: true`:

```json
{
  "success": true,
  "link": { "slug": "artist/leela", "title": "Leela", "artist": "Artist", "spotifyUrl": "https://open.spotify.com/track/<trackId>" },
  "url": "https://gudmuzik.com/artist/leela",
  "reused": true
}
```

`link` carries the same fields a normal create returns. `reused` is absent when a new link was created.

**Lookup endpoint**

```
GET /api/find-link?spotifyUrl=<spotify track url>&artist=<artist name>
GET /api/find-link?dealId=<deal id>
```

Read only, no auth, same posture as `/api/get-link`. Returns `200` with `{ success, link, url, matchedBy }` where `link` has the same fields as `/api/get-link` (access token and pixel id stripped) and `matchedBy` is `"dealId"` or `"spotifyTrack"`. Returns `404` when nothing matches and `400` when neither param is given.

**Index notes**

- Index entries (`linkidx:track:<trackId>:<artistSlug>` and `linkidx:deal:<dealId>`) are written only when a new link is created, never on reuse, and never overwrite an existing entry, so the first link for a song stays canonical.
- No existing links are modified or deleted. Links created before this change are not indexed (no backfill); they are found only through the slug variant check above.
- Lookups re-read the link and re-check its Spotify track id, so a stale index entry never returns a different song.
- Run the matcher tests with `npm test`.

### API key for create-link and update-link (optional)

`POST /api/create-link` and `PUT`/`POST /api/update-link` can require a shared key. The check is off until `SMARTLINK_API_KEY` is set in the environment, so nothing changes until then. When it is set, send the key in either header form:

```
Authorization: Bearer <key>
x-api-key: <key>
```

Requests with a missing or wrong key get `401 {"error":"Unauthorized"}`.

**Bubble:** before the key is set, add one of these headers (for example `x-api-key`, marked Private) to every Bubble API Connector call that hits `create-link` or `update-link`. If the key is set first, those calls will start failing with 401.

`/api/debug` is behind the dashboard login cookie (`gm_auth`) and returns 401 without it.

### Tests
```bash
npm test
```

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
