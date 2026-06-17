import { NextResponse } from 'next/server';
import { curatorConfigured, curateOnce } from '@/lib/spotify-curator';
import { getAllJobs, recordRun } from '@/lib/curator-jobs';

export const dynamic = 'force-dynamic';
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

  const jobs = (await getAllJobs()).filter((j) => j.active && j.cadence === 'daily');
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
