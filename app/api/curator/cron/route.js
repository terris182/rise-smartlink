import { NextResponse } from 'next/server';
import { curatorConfigured, curateOnce } from '@/lib/spotify-curator';
import { getAllJobs, recordRun } from '@/lib/curator-jobs';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store'; // WHI-883: never serve deploy-time cached data reads
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/curator/cron — runs every active job whose cadence is 'daily'.
 * Triggered by Vercel Cron (see vercel.json). Protected by CRON_SECRET:
 * Vercel sends "Authorization: Bearer <CRON_SECRET>". A ?secret= param also works.
 */
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization') || '';
    const qp = new URL(request.url).searchParams.get('secret') || '';
    if (auth !== `Bearer ${secret}` && qp !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  if (!curatorConfigured()) {
    return NextResponse.json({ error: 'Curator not configured' }, { status: 503 });
  }

  // Cron fires hourly; run each daily job at its chosen PST hour, once per PST day.
  const tz = 'America/Los_Angeles';
  const curHour = parseInt(new Date().toLocaleString('en-US', { timeZone: tz, hour12: false, hour: '2-digit' }), 10) % 24;
  const curDayPST = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const force = new URL(request.url).searchParams.get('force') === '1';

  const slotFmt = { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false };
  const curSlot = new Date().toLocaleString('en-US', slotFmt); // unique per PST hour
  const jobs = (await getAllJobs()).filter((j) => {
    if (!j.active || j.cadence !== 'daily') return false;
    if (force) return true;
    const hours = (Array.isArray(j.dailyHours) && j.dailyHours.length ? j.dailyHours : [j.dailyHour ?? 2]).map(Number);
    if (!hours.includes(curHour)) return false;
    // Run once per PST hour-slot (guards against retries; supports multiple times/day).
    const lastSlot = j.lastRun ? new Date(j.lastRun).toLocaleString('en-US', slotFmt) : null;
    return lastSlot !== curSlot;
  });
  const runs = [];
  for (const job of jobs) {
    try {
      const result = await curateOnce(job);
      await recordRun(job.id, { ...result, at: new Date().toISOString() });
      runs.push({ id: job.id, name: job.name, ok: true, ...result });
    } catch (err) {
      await recordRun(job.id, { ok: false, message: err.message, at: new Date().toISOString() });
      runs.push({ id: job.id, name: job.name, ok: false, message: err.message });
    }
  }
  return NextResponse.json({ ran: runs.length, runs });
}
