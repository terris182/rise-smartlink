import { NextResponse } from 'next/server';
import { getAllJobs, createJob, updateJob, deleteJob } from '@/lib/curator-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/curator/jobs → all jobs
export async function GET() {
  const jobs = await getAllJobs();
  return NextResponse.json({ jobs });
}

// POST /api/curator/jobs → create a job
export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.targetPlaylistId) {
      return NextResponse.json({ error: 'targetPlaylistId is required' }, { status: 400 });
    }
    // Insert mode needs a submissions playlist; resort can run on the target alone.
    if (body.mode !== 'resort' && !body.sourcePlaylistId) {
      return NextResponse.json({ error: 'sourcePlaylistId is required for the auto-curator (insert) mode' }, { status: 400 });
    }
    if (body.sourcePlaylistId && body.sourcePlaylistId === body.targetPlaylistId) {
      return NextResponse.json({ error: 'Source and target playlists must be different' }, { status: 400 });
    }
    const job = await createJob(body);
    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

// PUT /api/curator/jobs → update a job (body must include id)
export async function PUT(request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const job = await updateJob(body.id, body);
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

// DELETE /api/curator/jobs?id=... → delete a job
export async function DELETE(request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  await deleteJob(id);
  return NextResponse.json({ ok: true });
}
