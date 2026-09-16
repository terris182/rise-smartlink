import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/meta-targeting  (WHI-1483, Rise "Custom" targeting)
 *
 * Server-side proxy for the Meta Marketing API targeting search, so the
 * system token never reaches a Bubble page expression. Called by the Rise
 * Bubble app (API Connector, header x-rise-key) from the campaign wizard
 * and from the ad-set build backend workflow.
 *
 * type=interest&q=taylor            -> [{id,name,size,path}]           adinterest search
 * type=country&q=united             -> [{id:"US",name:"United States"}] adgeolocation (countries only)
 * type=genre&genre=Pop              -> {id,name,size}                  the genre's Meta interest
 * type=suggest&genre=Pop            -> [{id,name,size}]                artists Meta knows for that genre
 * type=targeting_json&targeting=global|big5|custom
 *      &countries=US|United States,CA|Canada   (only used for custom)
 *      &interests=6003...|Pop music,6003...|Dua Lipa  (only used for custom)
 *      &genre=Pop &custom_audiences=123,456
 *                                   -> {targeting:" <json string>" (leading space so the Bubble connector keeps it as text), dropped, mode, countries, interests}
 *
 * Every ad set targets Spotify (interest 6002969794329) AND one of the
 * chosen interests (two flexible_spec entries), age 18 to 65.
 */

const GRAPH = 'https://graph.facebook.com/v22.0';
const SPOTIFY_INTEREST = { id: '6002969794329', name: 'Spotify' };
const BIG5 = ['US', 'CA', 'GB', 'AU', 'NZ'];
const BIG5_NAMES = { US: 'United States', CA: 'Canada', GB: 'United Kingdom', AU: 'Australia', NZ: 'New Zealand' };

// Rise genre (option set spotify_genre display) -> Meta interest search term.
const GENRE_TERM = {
  'Pop': 'Pop music', 'Rock': 'Rock music', 'Hip-hop': 'Hip hop music', 'Hip hop': 'Hip hop music',
  'Country': 'Country music', 'Electronic': 'Electronic music', 'Electronica': 'Electronic music',
  'Dance': 'Dance music', 'Disco': 'Disco', 'Folk': 'Folk music', 'Indie': 'Indie rock',
  'Alternative': 'Alternative rock', 'R&B': 'Rhythm and blues music', 'Soul': 'Soul music',
  'Latin': 'Latin music', 'Reggaeton': 'Reggaeton', 'Jazz': 'Jazz', 'Metal': 'Heavy metal music',
  'Christian/Gospel': 'Christian music', 'Gospel': 'Gospel music', 'Classical': 'Classical music',
  'Blues': 'Blues', 'World': 'World music', 'Comedy': 'Comedy', 'Podcast': 'Podcasts',
  'Acoustic': 'Acoustic music', 'Singer-Songwriter': 'Singer-songwriter', 'Ambient': 'Ambient music',
  'Chill': 'Chill-out music', 'Sleep': 'Ambient music', 'Lo-Fi Beats': 'Lo-fi music', 'Punk': 'Punk rock',
};

// Curated artist names per genre. Only names Meta returns as a targetable
// interest are ever shown (resolved through adinterest search, cached 24h).
const GENRE_ARTISTS = {
  'Pop': ['Taylor Swift', 'Dua Lipa', 'Olivia Rodrigo', 'Harry Styles', 'Sabrina Carpenter', 'Ariana Grande', 'Ed Sheeran', 'Billie Eilish'],
  'Rock': ['Foo Fighters', 'The Killers', 'Arctic Monkeys', 'Imagine Dragons', 'Red Hot Chili Peppers', 'Green Day', 'Coldplay', 'Paramore'],
  'Hip-hop': ['Drake', 'Kendrick Lamar', 'J. Cole', 'Travis Scott', 'Lil Baby', 'Future', '21 Savage', 'Tyler, the Creator'],
  'Country': ['Morgan Wallen', 'Luke Combs', 'Zach Bryan', 'Chris Stapleton', 'Lainey Wilson', 'Kane Brown', 'Jelly Roll', 'Kacey Musgraves'],
  'Electronic': ['Calvin Harris', 'Fred again..', 'Skrillex', 'ODESZA', 'Zedd', 'Marshmello', 'Tiësto', 'Kygo'],
  'Folk': ['Mumford & Sons', 'The Lumineers', 'Bon Iver', 'Noah Kahan', 'Hozier', 'Gregory Alan Isakov', 'Fleet Foxes', 'Iron & Wine'],
  'Indie': ['Tame Impala', 'Phoebe Bridgers', 'Vampire Weekend', 'The 1975', 'boygenius', 'Mac DeMarco', 'Arcade Fire', 'Beach House'],
  'Alternative': ['Twenty One Pilots', 'Radiohead', 'The Strokes', 'Cage the Elephant', 'Glass Animals', 'Bleachers', 'Weezer', 'alt-J'],
  'R&B': ['SZA', 'The Weeknd', 'H.E.R.', 'Frank Ocean', 'Daniel Caesar', 'Giveon', 'Summer Walker', 'Leon Bridges'],
  'Latin': ['Bad Bunny', 'Karol G', 'Peso Pluma', 'Shakira', 'J Balvin', 'Rauw Alejandro', 'Feid', 'Maluma'],
  'Jazz': ['Norah Jones', 'Kamasi Washington', 'Snarky Puppy', 'Gregory Porter', 'Esperanza Spalding', 'Robert Glasper', 'Laufey', 'Jacob Collier'],
  'Metal': ['Metallica', 'Slipknot', 'Ghost', 'Sleep Token', 'Bring Me the Horizon', 'Avenged Sevenfold', 'Gojira', 'Spiritbox'],
  'Christian/Gospel': ['Lauren Daigle', 'Elevation Worship', 'Maverick City Music', 'Kirk Franklin', 'Brandon Lake', 'Hillsong UNITED', 'Tasha Cobbs Leonard', 'Chris Tomlin'],
  'Classical': ['Ludovico Einaudi', 'Yo-Yo Ma', 'Max Richter', 'Lang Lang', 'Hans Zimmer', 'Andrea Bocelli', 'Ólafur Arnalds', 'Joshua Bell'],
  'Blues': ['Gary Clark Jr.', 'Joe Bonamassa', 'Buddy Guy', 'Marcus King', 'Susan Tedeschi', "Keb' Mo'", 'B.B. King', 'Tedeschi Trucks Band'],
  'World': ['Burna Boy', 'Wizkid', 'Rema', 'Tems', 'Diljit Dosanjh', 'Angélique Kidjo', 'Stromae', 'Rosalía'],
  'Comedy': ['Kevin Hart', 'Bo Burnham', 'John Mulaney', 'Nate Bargatze', 'Ali Wong', 'Matt Rife', 'Theo Von', 'Dave Chappelle'],
  'Podcast': ['Joe Rogan', 'Call Her Daddy', 'Crime Junkie', 'The Daily', 'SmartLess', 'This American Life', 'Armchair Expert', 'Huberman Lab'],
  'Punk': ['Green Day', 'blink-182', 'The Offspring', 'Rise Against', 'Turnstile', 'Sum 41', 'Bad Religion', 'IDLES'],
  'Ambient': ['Brian Eno', 'Tycho', 'Bonobo', 'Nils Frahm', 'Ólafur Arnalds', 'Boards of Canada', 'Aphex Twin', 'Lofi Girl'],
};
const GENRE_ALIAS = {
  'Dance': 'Electronic', 'Electronica': 'Electronic', 'Disco': 'Electronic', 'Reggaeton': 'Latin', 'Gospel': 'Christian/Gospel',
  'Soul': 'R&B', 'Acoustic': 'Folk', 'Singer-Songwriter': 'Folk', 'Chill': 'Ambient', 'Sleep': 'Ambient', 'Lo-Fi Beats': 'Ambient',
  'Hip hop': 'Hip-hop',
};

const cache = new Map(); // key -> {at, value}
const TTL = 24 * 3600 * 1000;
function cached(key) { const c = cache.get(key); return c && Date.now() - c.at < TTL ? c.value : null; }
function remember(key, value) { cache.set(key, { at: Date.now(), value }); return value; }

function token() { return process.env.META_TARGETING_TOKEN || process.env.FB_ACCESS_TOKEN || ''; }

async function graphSearch(params) {
  const u = new URL(GRAPH + '/search');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('access_token', token());
  const r = await fetch(u.toString(), { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('meta ' + r.status + ' ' + (j.error && j.error.message ? j.error.message : ''));
  return j.data || [];
}

const trimInterest = (x) => ({ id: String(x.id), name: x.name, size: x.audience_size_upper_bound || x.audience_size_lower_bound || x.audience_size || 0, path: Array.isArray(x.path) ? x.path.slice(-2).join(' / ') : '' });

async function searchInterests(q, limit = 10) {
  const data = await graphSearch({ type: 'adinterest', q, limit: String(limit) });
  return data.map(trimInterest);
}

async function searchCountries(q) {
  const data = await graphSearch({ type: 'adgeolocation', location_types: '["country"]', q, limit: '10' });
  return data.map((x) => ({ id: x.country_code || x.key, name: x.name }));
}

async function validInterests(names) {
  if (!names.length) return [];
  const data = await graphSearch({ type: 'adinterestvalid', interest_list: JSON.stringify(names) });
  return data.filter((x) => x.valid).map(trimInterest);
}

function genreKey(genre) { return GENRE_ALIAS[genre] || genre; }

async function genreInterest(genre) {
  const key = 'genre:' + genre;
  const hit = cached(key); if (hit) return hit;
  const term = GENRE_TERM[genre] || GENRE_TERM[genreKey(genre)] || (genre + ' music');
  const found = await searchInterests(term, 8);
  const lower = term.toLowerCase();
  let best = found.find((x) => x.name.toLowerCase() === lower) || found.find((x) => x.name.toLowerCase().startsWith(lower)) || found[0] || null;
  if (best) remember(key, best);
  return best;
}

async function artistSuggestions(genre) {
  const key = 'suggest:' + genreKey(genre);
  const hit = cached(key); if (hit) return hit;
  const names = GENRE_ARTISTS[genreKey(genre)] || [];
  const out = [];
  for (const n of names) {
    try {
      const found = await searchInterests(n, 3);
      const exact = found.find((x) => x.name.toLowerCase() === n.toLowerCase());
      if (exact) out.push(exact);
    } catch (e) { /* skip this name */ }
  }
  return remember(key, out);
}

// "US|United States,CA|Canada" -> [{id, name}]
function parsePairs(s) {
  return String(s || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    const i = x.indexOf('|');
    return i < 0 ? { id: x, name: x } : { id: x.slice(0, i).trim(), name: x.slice(i + 1).trim() };
  }).filter((x) => x.id);
}

// parity with Main's lAauf (Update Ad Set Targeting), which sent home + recent + frequently_in; Main's create step sent none (Meta default home,recent)
const LOCATION_TYPES = ['home', 'recent', 'frequently_in'];

async function buildTargeting(p) {
  const targeting = String(p.get('targeting') || 'big5').toLowerCase().replace(/\s+/g, '');
  const dropped = [];
  // advantage_audience 0: Meta requires the flag (subcode 1870227) and 0 keeps the chosen interests/countries authoritative.
  const obj = { age_min: 18, age_max: 65, targeting_automation: { advantage_audience: 0 } };

  // geo
  if (targeting === 'global') {
    // Meta refuses worldwide without a Taiwan regulated-ads declaration (subcode 3858498), so exclude TW and SG (Singapore needs the same, 3858550). Meta accepted worldwide minus these two on 2026-09-15.
    obj.geo_locations = { country_groups: ['worldwide'], location_types: LOCATION_TYPES };
    obj.excluded_geo_locations = { countries: ['TW', 'SG'] };
  } else {
    let codes = targeting === 'custom' ? parsePairs(p.get('countries')).map((c) => c.id.toUpperCase()) : BIG5;
    codes = codes.filter((c) => /^[A-Z]{2}$/.test(c));
    if (!codes.length) { dropped.push('no valid countries, used Big 5'); codes = BIG5; }
    obj.geo_locations = { countries: codes, location_types: LOCATION_TYPES };
  }

  // interests (second layer)
  let interests = [];
  const genre = p.get('genre') || '';
  if (targeting === 'custom') {
    const wanted = parsePairs(p.get('interests'));
    if (wanted.length) {
      const valid = await validInterests(wanted.map((w) => w.name));
      const validIds = new Set(valid.map((v) => v.id));
      const validNames = new Map(valid.map((v) => [v.name.toLowerCase(), v]));
      for (const w of wanted) {
        const v = validIds.has(w.id) ? { id: w.id, name: w.name } : validNames.get(w.name.toLowerCase());
        if (v) interests.push({ id: v.id, name: v.name }); else dropped.push('invalid interest ' + w.name);
      }
    }
  }
  if (!interests.length) {
    const g = genre ? await genreInterest(genre) : null;
    if (g) interests.push({ id: g.id, name: g.name });
    else dropped.push('no genre interest for "' + genre + '"');
  }
  obj.flexible_spec = [{ interests: [SPOTIFY_INTEREST] }];
  if (interests.length) obj.flexible_spec.push({ interests });

  // accepts "123,456", or Bubble's pre-formatted '{"id":"123"},{"id":"456"}' (custom_audiences_json): any digit run of 5+ is an id
  const ca = [...new Set((String(p.get('custom_audiences') || '').match(/\d{5,}/g) || []))];
  if (ca.length) obj.custom_audiences = ca.map((id) => ({ id }));

  // targeting is the JSON string Bubble passes straight to Meta; no nested object in the response (Bubble's connector
  // could not consume the nested flexible_spec object at runtime, 2026-09-15)
  return { targeting: " " + JSON.stringify(obj), dropped: dropped.join('; '), mode: targeting, countries: (obj.geo_locations.countries || ['worldwide']).join(','), interests: interests.map((i) => i.name).join(',') };
}

export async function GET(request) {
  const url = new URL(request.url);
  const p = url.searchParams;
  const key = process.env.META_TARGETING_KEY;
  if (key && request.headers.get('x-rise-key') !== key && p.get('key') !== key) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!token()) return NextResponse.json({ error: 'META_TARGETING_TOKEN not configured' }, { status: 500 });
  const type = p.get('type') || '';
  try {
    if (type === 'interest' && /^suggest:/i.test(p.get('q') || '')) {
      // suggested artists served through the interest-search call: Bubble's server intermittently 500s the dedicated
      // "suggest artists" connector call (UnexpectedError, 2026-09-15) while the search call is reliable
      return NextResponse.json({ results: await artistSuggestions((p.get('q') || '').replace(/^suggest:/i, '').trim()) });
    }
    if (type === 'interest') {
      const q = (p.get('q') || '').trim();
      if (q.length < 2) return NextResponse.json({ results: [] });
      return NextResponse.json({ results: await searchInterests(q, 10) });
    }
    if (type === 'country') {
      const q = (p.get('q') || '').trim();
      if (q.length < 2) return NextResponse.json({ results: [] });
      return NextResponse.json({ results: await searchCountries(q) });
    }
    if (type === 'genre') {
      const g = await genreInterest(p.get('genre') || '');
      return NextResponse.json({ results: g ? [g] : [] });
    }
    if (type === 'suggest') {
      return NextResponse.json({ results: await artistSuggestions(p.get('genre') || '') });
    }
    if (type === 'big5') {
      return NextResponse.json({ results: BIG5.map((c) => ({ id: c, name: BIG5_NAMES[c] })) });
    }
    if (type === 'targeting_json') {
      return NextResponse.json(await buildTargeting(p));
    }
    return NextResponse.json({ error: 'unknown type' }, { status: 400 });
  } catch (e) {
    console.error('[meta-targeting]', type, e.message);
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
