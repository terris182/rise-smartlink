/**
 * Analytics storage using Vercel KV (Redis).
 *
 * Stores event counts and breakdowns for each smart link page:
 * - Total visits and clicks per slug
 * - Clicks per platform (spotify, apple_music)
 * - Visits/clicks per country
 * - Daily time series for visits and clicks
 *
 * KV key structure:
 *   analytics:{slug}:summary          → { visits, clicks, lastEvent }
 *   analytics:{slug}:platforms        → { spotify: N, apple_music: N }
 *   analytics:{slug}:countries        → { US: N, GB: N, ... }
 *   analytics:{slug}:daily:{YYYY-MM-DD}:visits  → count
 *   analytics:{slug}:daily:{YYYY-MM-DD}:clicks  → count
 *   analytics:all-slugs               → Set of all slugs with analytics
 */

import { kv } from '@vercel/kv';

const kvAvailable = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// In-memory fallback for local dev
const memAnalytics = new Map();

function getToday() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Record a page visit event.
 */
export async function recordVisit(slug, { country = '', region = '', city = '', deviceType = '', os = '' } = {}) {
  if (!kvAvailable) {
    // In-memory fallback
    const key = `analytics:${slug}`;
    const existing = memAnalytics.get(key) || { visits: 0, clicks: 0, platforms: {}, countries: {}, daily: {} };
    existing.visits++;
    if (country) existing.countries[country] = (existing.countries[country] || 0) + 1;
    const today = getToday();
    if (!existing.daily[today]) existing.daily[today] = { visits: 0, clicks: 0 };
    existing.daily[today].visits++;
    memAnalytics.set(key, existing);
    return;
  }

  try {
    const prefix = `analytics:${slug}`;
    const today = getToday();

    // Pipeline multiple Redis commands
    const pipeline = kv.pipeline();

    // Increment visit count in summary
    pipeline.hincrby(`${prefix}:summary`, 'visits', 1);
    pipeline.hset(`${prefix}:summary`, { lastEvent: Date.now() });

    // Increment country counter
    if (country) {
      pipeline.hincrby(`${prefix}:countries`, country, 1);
    }

    // Increment daily visits
    pipeline.incrby(`${prefix}:daily:${today}:visits`, 1);
    // Set 90-day TTL on daily keys
    pipeline.expire(`${prefix}:daily:${today}:visits`, 90 * 86400);

    // Track device/OS
    if (deviceType) pipeline.hincrby(`${prefix}:devices`, deviceType, 1);
    if (os) pipeline.hincrby(`${prefix}:os`, os, 1);

    // Track this slug in the global set
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
    const existing = memAnalytics.get(key) || { visits: 0, clicks: 0, platforms: {}, countries: {}, daily: {} };
    existing.clicks++;
    if (platform) existing.platforms[platform] = (existing.platforms[platform] || 0) + 1;
    if (country) existing.countries[country] = (existing.countries[country] || 0) + 1;
    const today = getToday();
    if (!existing.daily[today]) existing.daily[today] = { visits: 0, clicks: 0 };
    existing.daily[today].clicks++;
    memAnalytics.set(key, existing);
    return;
  }

  try {
    const prefix = `analytics:${slug}`;
    const today = getToday();

    const pipeline = kv.pipeline();

    // Increment click count in summary
    pipeline.hincrby(`${prefix}:summary`, 'clicks', 1);
    pipeline.hset(`${prefix}:summary`, { lastEvent: Date.now() });

    // Increment platform counter
    if (platform) {
      pipeline.hincrby(`${prefix}:platforms`, platform, 1);
    }

    // Increment country counter (for clicks)
    if (country) {
      pipeline.hincrby(`${prefix}:click-countries`, country, 1);
    }

    // Increment daily clicks
    pipeline.incrby(`${prefix}:daily:${today}:clicks`, 1);
    pipeline.expire(`${prefix}:daily:${today}:clicks`, 90 * 86400);

    // Track device/OS
    if (deviceType) pipeline.hincrby(`${prefix}:click-devices`, deviceType, 1);
    if (os) pipeline.hincrby(`${prefix}:click-os`, os, 1);

    // Track this slug in the global set
    pipeline.sadd('analytics:all-slugs', slug);

    await pipeline.exec();
  } catch (err) {
    console.error('[Analytics] recordClick error:', err);
  }
}

/**
 * Get analytics summary for a single slug.
 */
export async function getAnalytics(slug) {
  if (!kvAvailable) {
    const key = `analytics:${slug}`;
    return memAnalytics.get(key) || { visits: 0, clicks: 0, platforms: {}, countries: {}, daily: {} };
  }

  try {
    const prefix = `analytics:${slug}`;

    const [summary, platforms, countries, clickCountries, devices, os] = await Promise.all([
      kv.hgetall(`${prefix}:summary`),
      kv.hgetall(`${prefix}:platforms`),
      kv.hgetall(`${prefix}:countries`),
      kv.hgetall(`${prefix}:click-countries`),
      kv.hgetall(`${prefix}:devices`),
      kv.hgetall(`${prefix}:os`),
    ]);

    // Fetch last 30 days of daily data
    const daily = {};
    const now = new Date();
    const dailyPromises = [];
    for (let i = 0; i < 30; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      dailyPromises.push(
        Promise.all([
          kv.get(`${prefix}:daily:${dateStr}:visits`),
          kv.get(`${prefix}:daily:${dateStr}:clicks`),
        ]).then(([visits, clicks]) => {
          if (visits || clicks) {
            daily[dateStr] = { visits: visits || 0, clicks: clicks || 0 };
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
      countries: countries || {},
      clickCountries: clickCountries || {},
      devices: devices || {},
      os: os || {},
      daily,
    };
  } catch (err) {
    console.error('[Analytics] getAnalytics error:', err);
    return { visits: 0, clicks: 0, platforms: {}, countries: {}, daily: {} };
  }
}

/**
 * Get analytics for all tracked slugs (dashboard overview).
 */
export async function getAllAnalytics() {
  if (!kvAvailable) {
    const result = {};
    for (const [key, data] of memAnalytics) {
      const slug = key.replace('analytics:', '');
      result[slug] = data;
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
