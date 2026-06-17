import { NextResponse } from 'next/server';
import { curatorConfigured, curateOnce } from '@/lib/spotify-curator';
import { getJob, recordRun } from '@/lib/curator-jobs';

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

  try {
    const result = await curateOnce(job);
    await recordRun(jobId, { ...result, at: new Date().toISOString() });
    return NextResponse.json({ result });
  } catch (err) {
    const result = { ok: false, message: err.message, at: new Date().toISOString() };
    await recordRun(jobId, result);
    return NextResponse.json({ error: err.message, result }, { status: 502 });
  }
}
