/**
 * Analytics storage using Supabase (Postgres).
 * Drop-in replacement for the Vercel KV (Upstash Redis) implementation.
 *
 * Uses an events log table — one INSERT per event, no race conditions.
 * Table: link_analytics_events (id, slug, event_type, platform, country, device_type, os, occurred_at)
 *
 * getAnalytics() aggregates from the events log via SQL.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAvailable = !!(supabaseUrl && supabaseKey);

let _client = null;
function getClient() {
  if (!_client && supabaseAvailable) {
    _client = createClient(supabaseUrl, supabaseKey);
  }
  return _client;
}

// In-memory fallback for local dev
const memAnalytics = new Map();

function getToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

export async function recordVisit(slug, { country = '', region = '', city = '', deviceType = '', os = '' } = {}) {
  if (!supabaseAvailable) {
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
    await getClient().from('link_analytics_events').insert({
      slug,
      event_type: 'visit',
      platform: '',
      country: country || '',
      device_type: deviceType || '',
      os: os || '',
    });
  } catch (err) {
    console.error('[Analytics] recordVisit error:', err);
  }
}

export async function recordClick(slug, { platform = '', country = '', region = '', city = '', deviceType = '', os = '' } = {}) {
  if (!supabaseAvailable) {
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
    await getClient().from('link_analytics_events').insert({
      slug,
      event_type: 'click',
      platform: platform || '',
      country: country || '',
      device_type: deviceType || '',
      os: os || '',
    });
  } catch (err) {
    console.error('[Analytics] recordClick error:', err);
  }
}

/**
 * Aggregate analytics for a single slug from the events log.
 * Returns same shape as the old KV-based getAnalytics().
 */
export async function getAnalytics(slug) {
  if (!supabaseAvailable) {
    const key = `analytics:${slug}`;
    const d = memAnalytics.get(key) || { visits: 0, clicks: 0, platforms: {}, countriesV: {}, countriesC: {}, daily: {}, devices: {}, os: {} };
    return d;
  }
  try {
    // Fetch all events for this slug (last 90 days is plenty for dashboard)
    const since = new Date();
    since.setDate(since.getDate() - 90);

    const { data: events, error } = await getClient()
      .from('link_analytics_events')
      .select('event_type, platform, country, device_type, os, occurred_at')
      .eq('slug', slug)
      .gte('occurred_at', since.toISOString());

    if (error) throw error;

    const result = {
      visits: 0,
      clicks: 0,
      lastEvent: null,
      platforms: {},
      countriesVisits: {},
      countriesClicks: {},
      devices: {},
      os: {},
      daily: {},
    };

    for (const e of (events || [])) {
      const ts = new Date(e.occurred_at).getTime();
      if (!result.lastEvent || ts > result.lastEvent) result.lastEvent = ts;

      const dateStr = new Date(e.occurred_at).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      if (!result.daily[dateStr]) {
        result.daily[dateStr] = { visits: 0, clicks: 0, platforms: {}, countriesV: {}, countriesC: {} };
      }

      if (e.event_type === 'visit') {
        result.visits++;
        result.daily[dateStr].visits++;
        if (e.country) {
          result.countriesVisits[e.country] = (result.countriesVisits[e.country] || 0) + 1;
          result.daily[dateStr].countriesV[e.country] = (result.daily[dateStr].countriesV[e.country] || 0) + 1;
        }
        if (e.device_type) result.devices[e.device_type] = (result.devices[e.device_type] || 0) + 1;
        if (e.os) result.os[e.os] = (result.os[e.os] || 0) + 1;
      } else if (e.event_type === 'click') {
        result.clicks++;
        result.daily[dateStr].clicks++;
        if (e.platform) {
          result.platforms[e.platform] = (result.platforms[e.platform] || 0) + 1;
          result.daily[dateStr].platforms[e.platform] = (result.daily[dateStr].platforms[e.platform] || 0) + 1;
        }
        if (e.country) {
          result.countriesClicks[e.country] = (result.countriesClicks[e.country] || 0) + 1;
          result.daily[dateStr].countriesC[e.country] = (result.daily[dateStr].countriesC[e.country] || 0) + 1;
        }
        if (e.device_type) result.devices[e.device_type] = (result.devices[e.device_type] || 0) + 1;
        if (e.os) result.os[e.os] = (result.os[e.os] || 0) + 1;
      }
    }

    return result;
  } catch (err) {
    console.error('[Analytics] getAnalytics error:', err);
    return { visits: 0, clicks: 0, platforms: {}, countriesVisits: {}, countriesClicks: {}, daily: {}, devices: {}, os: {} };
  }
}

/**
 * Get summary analytics for all tracked slugs.
 */
export async function getAllAnalytics() {
  if (!supabaseAvailable) {
    const result = {};
    for (const [key, data] of memAnalytics) {
      const slug = key.replace('analytics:', '');
      result[slug] = { visits: data.visits, clicks: data.clicks };
    }
    return result;
  }
  try {
    const { data: events, error } = await getClient()
      .from('link_analytics_events')
      .select('slug, event_type, occurred_at');
    if (error) throw error;

    const result = {};
    for (const e of (events || [])) {
      if (!result[e.slug]) result[e.slug] = { visits: 0, clicks: 0, lastEvent: null };
      const ts = new Date(e.occurred_at).getTime();
      if (!result[e.slug].lastEvent || ts > result[e.slug].lastEvent) result[e.slug].lastEvent = ts;
      if (e.event_type === 'visit') result[e.slug].visits++;
      else if (e.event_type === 'click') result[e.slug].clicks++;
    }
    return result;
  } catch (err) {
    console.error('[Analytics] getAllAnalytics error:', err);
    return {};
  }
}
