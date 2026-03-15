/**
 * Analytics storage using Vercel KV (Redis).
 *
 * Tracks visits and clicks with full breakdowns:
 * - Total visits/clicks per slug
 * - Per-platform clicks (spotify, apple_music) — with visits as the denominator for CTR
 * - Per-country visits AND clicks — so we can compute CTR per country
 * - Daily time series for visits/clicks (30 days, Hypeddit-style charts)
 * - Daily per-platform and per-country breakdowns
 * - Device type and OS breakdowns
 *
 * KV key structure:
 *   analytics:{slug}:summary                         → { visits, clicks, lastEvent }
 *   analytics:{slug}:platforms                        → { spotify: N, apple_music: N }
 *   analytics:{slug}:countries:visits                 → { US: N, GB: N, ... }
 *   analytics:{slug}:countries:clicks                 → { US: N, GB: N, ... }
 *   analytics:{slug}:daily:{YYYY-MM-DD}              → { visits: N, clicks: N }
 *   analytics:{slug}:daily-platforms:{YYYY-MM-DD}     → { spotify: N, apple_music: N }
 *   analytics:{slug}:daily-countries:{YYYY-MM-DD}:v   → { US: N, ... }
 *   analytics:{slug}:daily-countries:{YYYY-MM-DD}:c   → { US: N, ... }
 *   analytics:{slug}:devices                          → { mobile: N, desktop: N, tablet: N }
 *   analytics:{slug}:os                               → { iOS: N, Android: N, ... }
 *   analytics:all-slugs                               → Set of all slugs
 */

import { kv } from '@vercel/kv';

const kvAvailable = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// In-memory fallback for local dev
const memAnalytics = new Map();

function getToday() {
  return new Date().toISOString().split('T')[0];
}

const TTL_90_DAYS = 90 * 86400;

/**
 * Record a page visit event.
 */
export async function recordVisit(slug, { country = '', region = '', city = '', deviceType = '', os = '' } = {}) {
  if (!kvAvailable) {
    const key = `analytics:${slug}`;
    const d = memAnalytics.get(key) || { visits: 0, clicks: 0, platforms: {}, countriesV: {}, countriesC: {}, daily: {}, devices: {}, os: {} };
    d.visits++;
    if (country) d.countriesV[country] = (d.countriesV[country] || 0) + 1;
    const today = getToday();
    if (!d.daily[today]) d.daily[today] = { visits: 0, clicks: 0, platforms: {}, countriesV: {}, countriesC: {} };
    d.daily[today].visits++;
    if (country) d.daily[today].countriesV[country] = (d.daily[today].countriesV[country] || 0) + 1;
    if (deviceType) d.devices[deviceType] = (d.devices[deviceType] || 0) + 1;
    if (os) d.os[os] = (d.os[os] || 0) + 1;
    memAnalytics.set(key, d);
    return;
  }

  try {
    const p = `analytics:${slug}`;
    const today = getToday();
    const pipeline = kv.pipeline();

    pipeline.hincrby(`${p}:summary`, 'visits', 1);
    pipeline.hset(`${p}:summary`, { lastEvent: Date.now() });

    if (country) pipeline.hincrby(`${p}:countries:visits`, country, 1);

    // Daily aggregate
    pipeline.hincrby(`${p}:daily:${today}`, 'visits', 1);
    pipeline.expire(`${p}:daily:${today}`, TTL_90_DAYS);

    // Daily per-country visits
    if (country) {
      pipeline.hincrby(`${p}:daily-countries:${today}:v`, country, 1);
      pipeline.expire(`${p}:daily-countries:${today}:v`, TTL_90_DAYS);
    }

    if (deviceType) pipeline.hincrby(`${p}:devices`, deviceType, 1);
    if (os) pipeline.hincrby(`${p}:os`, os, 1);

    pipeline.sadd('analytics:all-slugs', slug);

    await pipeline.exec();
  } catch (err) {
    console.error('[Analytics] recordVisit error:', err);
  }
}

/**
 * Record a button click event.
 */
export async function recordClick(slug, { platform = '', country = '', region = '', city = '', deviceType = '', os = '' } = {}) {
  if (!kvAvailable) {
    const key = `analytics:${slug}`;
    const d = memAnalytics.get(key) || { visits: 0, clicks: 0, platforms: {}, countriesV: {}, countriesC: {}, daily: {}, devices: {}, os: {} };
    d.clicks++;
    if (platform) d.platforms[platform] = (d.platforms[platform] || 0) + 1;
    if (country) d.countriesC[country] = (d.countriesC[country] || 0) + 1;
    const today = getToday();
    if (!d.daily[today]) d.daily[today] = { visits: 0, clicks: 0, platforms: {}, countriesV: {}, countriesC: {} };
    d.daily[today].clicks++;
    if (platform) d.daily[today].platforms[platform] = (d.daily[today].platforms[platform] || 0) + 1;
    if (country) d.daily[today].countriesC[country] = (d.daily[today].countriesC[country] || 0) + 1;
    memAnalytics.set(key, d);
    return;
  }

  try {
    const p = `analytics:${slug}`;
    const today = getToday();
    const pipeline = kv.pipeline();

    pipeline.hincrby(`${p}:summary`, 'clicks', 1);
    pipeline.hset(`${p}:summary`, { lastEvent: Date.now() });

    if (platform) pipeline.hincrby(`${p}:platforms`, platform, 1);
    if (country) pipeline.hincrby(`${p}:countries:clicks`, country, 1);

    // Daily aggregate
    pipeline.hincrby(`${p}:daily:${today}`, 'clicks', 1);
    pipeline.expire(`${p}:daily:${today}`, TTL_90_DAYS);

    // Daily per-platform
    if (platform) {
      pipeline.hincrby(`${p}:daily-platforms:${today}`, platform, 1);
      pipeline.expire(`${p}:daily-platforms:${today}`, TTL_90_DAYS);
    }

    // Daily per-country clicks
    if (country) {
      pipeline.hincrby(`${p}:daily-countries:${today}:c`, country, 1);
      pipeline.expire(`${p}:daily-countries:${today}:c`, TTL_90_DAYS);
    }

    if (deviceType) pipeline.hincrby(`${p}:click-devices`, deviceType, 1);
    if (os) pipeline.hincrby(`${p}:click-os`, os, 1);

    pipeline.sadd('analytics:all-slugs', slug);

    await pipeline.exec();
  } catch (err) {
    console.error('[Analytics] recordClick error:', err);
  }
}

/**
 * Get detailed analytics for a single slug.
 */
export async function getAnalytics(slug) {
  if (!kvAvailable) {
    const key = `analytics:${slug}`;
    const d = memAnalytics.get(key) || { visits: 0, clicks: 0, platforms: {}, countriesV: {}, countriesC: {}, daily: {}, devices: {}, os: {} };
    return d;
  }

  try {
    const p = `analytics:${slug}`;

    const [summary, platforms, countriesVisits, countriesClicks, devices, os] = await Promise.all([
      kv.hgetall(`${p}:summary`),
      kv.hgetall(`${p}:platforms`),
      kv.hgetall(`${p}:countries:visits`),
      kv.hgetall(`${p}:countries:clicks`),
      kv.hgetall(`${p}:devices`),
      kv.hgetall(`${p}:os`),
    ]);

    // Fetch last 30 days of daily data (aggregate + platform + country breakdowns)
    const daily = {};
    const now = new Date();
    const dailyPromises = [];

    for (let i = 0; i < 30; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      dailyPromises.push(
        Promise.all([
          kv.hgetall(`${p}:daily:${dateStr}`),
          kv.hgetall(`${p}:daily-platforms:${dateStr}`),
          kv.hgetall(`${p}:daily-countries:${dateStr}:v`),
          kv.hgetall(`${p}:daily-countries:${dateStr}:c`),
        ]).then(([agg, plat, cV, cC]) => {
          if (agg || plat || cV || cC) {
            daily[dateStr] = {
              visits: agg?.visits || 0,
              clicks: agg?.clicks || 0,
              platforms: plat || {},
              countriesV: cV || {},
              countriesC: cC || {},
            };
          }
        })
      );
    }
    await Promise.all(dailyPromises);

    return {
      visits: summary?.visits || 0,
      clicks: summary?.clicks || 0,
      lastEvent: summary?.lastEvent || null,
      platforms: platforms || {},
      countriesVisits: countriesVisits || {},
      countriesClicks: countriesClicks || {},
      devices: devices || {},
      os: os || {},
      daily,
    };
  } catch (err) {
    console.error('[Analytics] getAnalytics error:', err);
    return { visits: 0, clicks: 0, platforms: {}, countriesVisits: {}, countriesClicks: {}, daily: {}, devices: {}, os: {} };
  }
}

/**
 * Get analytics overview for all tracked slugs.
 */
export async function getAllAnalytics() {
  if (!kvAvailable) {
    const result = {};
    for (const [key, data] of memAnalytics) {
      const slug = key.replace('analytics:', '');
      result[slug] = { visits: data.visits, clicks: data.clicks };
    }
    return result;
  }

  try {
    const slugs = await kv.smembers('analytics:all-slugs');
    if (!slugs || slugs.length === 0) return {};

    const results = {};
    await Promise.all(
      slugs.map(async (slug) => {
        const summary = await kv.hgetall(`analytics:${slug}:summary`);
        results[slug] = {
          visits: summary?.visits || 0,
          clicks: summary?.clicks || 0,
          lastEvent: summary?.lastEvent || null,
        };
      })
    );

    return results;
  } catch (err) {
    console.error('[Analytics] getAllAnalytics error:', err);
    return {};
  }
}
