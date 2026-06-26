/**
 * Per-playlist "first added" date store, in Supabase Postgres.
 * Falls back to in-memory map for local dev.
 *
 * Shape: table curator_dates (playlist_id TEXT PK, track_dates JSONB)
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAvailable = !!(supabaseUrl && supabaseKey);
let _client = null;
function getClient() {
  if (!_client && supabaseAvailable) _client = createClient(supabaseUrl, supabaseKey);
  return _client;
}

const mem = new Map();

export async function getDates(playlistId) {
  if (!supabaseAvailable) return mem.get(playlistId) || {};
  try {
    const { data, error } = await getClient()
      .from('curator_dates')
      .select('track_dates')
      .eq('playlist_id', playlistId)
      .single();
    if (error || !data) return {};
    return data.track_dates || {};
  } catch (err) {
    console.error('[curator-dates] get error:', err);
    return {};
  }
}

export async function saveDates(playlistId, map) {
  if (!supabaseAvailable) {
    mem.set(playlistId, map);
    return;
  }
  try {
    await getClient()
      .from('curator_dates')
      .upsert({ playlist_id: playlistId, track_dates: map }, { onConflict: 'playlist_id' });
  } catch (err) {
    console.error('[curator-dates] save error:', err);
  }
}
