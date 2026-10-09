import { NextResponse } from 'next/server';
import { curatorConfigured, curateOnce } from '@/lib/spotify-curator';
import { getJob, runJobNow } from '@/lib/curator-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/curator/run  { jobId }  → run one job now
export async function POST(request) {
  if (!curatorConfigured()) {
    return NextResponse.json(
      { error: 'Curator not configured. Set SPOTIFY_CURATOR_* env vars in Vercel.' },
      { status: 503 }
    );
  }
  let jobId;
  try {
    ({ jobId } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 });

  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  // Same per-job lease as the cron route, so a manual run never overlaps a scheduled one.
  const r = await runJobNow(job, curateOnce);
  if (r.skipped) {
    return NextResponse.json({ error: `Job not run: ${r.skipped}`, skipped: r.skipped }, { status: r.held ? 409 : 503 });
  }
  if (r.error) return NextResponse.json({ error: r.error.message, result: r.result }, { status: 502 });
  return NextResponse.json({ result: r.result });
}
