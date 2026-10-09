import { NextResponse } from 'next/server';
import { curatorConfigured, curateOnce } from '@/lib/spotify-curator';
import { runScheduledJobs } from '@/lib/curator-jobs';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store'; // WHI-883: never serve deploy-time cached data reads
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/curator/cron: runs every active job whose cadence is 'daily' and is due this PST hour.
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

  // Cron fires hourly at :00 (Vercel) and the Mac runner calls with force=1 at
  // :05. Both run only jobs due this PST hour, skip a job that already ran
  // successfully in this PST hour slot, and never overlap (per-job lease).
  // ?override=1 deliberately bypasses the slot guard (never the lease). WHI-2061.
  const params = new URL(request.url).searchParams;
  const out = await runScheduledJobs({
    force: params.get('force') === '1',
    override: params.get('override') === '1',
    curate: curateOnce,
  });
  return NextResponse.json(out);
}
