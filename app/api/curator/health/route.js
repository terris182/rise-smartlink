import { NextResponse } from 'next/server';
import { curatorConfigured, getPlaylistTracks } from '@/lib/spotify-curator';
import { getAllJobs } from '@/lib/curator-jobs';
import { sendAlert } from '@/lib/email-alert';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store'; // WHI-883: never serve deploy-time cached data reads
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Failsafe checkup. Runs on a schedule (see vercel.json). For every active
 * daily job it verifies: (a) the submissions playlist was drained (0 tracks),
 * (b) the last run didn't error, (c) it actually ran recently. If anything is
 * off, it emails the alert recipient. Silent (no email) when everything's fine.
 *
 * Protected by CRON_SECRET. ?test=1 sends a delivery-test email.
 */
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  if (secret) {
    const auth = request.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}` && url.searchParams.get('secret') !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (url.searchParams.get('test') === '1') {
    const r = await sendAlert(
      'GudMuzik Curator — test alert',
      'This is a test of the curator failsafe alert. If you got this, alerts are working.'
    );
    return NextResponse.json({ test: true, email: r });
  }

  if (!curatorConfigured()) {
    const r = await sendAlert('GudMuzik Curator — DOWN', 'Curator is not configured (missing SPOTIFY_CURATOR_* env). No playlists are being curated.');
    return NextResponse.json({ ok: false, problems: ['not configured'], email: r }, { status: 200 });
  }

  const jobs = (await getAllJobs()).filter((j) => j.active && j.cadence === 'daily');
  const problems = [];
  const now = Date.now();

  for (const job of jobs) {
    const label = job.name || job.targetPlaylistId;
    // (a) Did songs make it from submissions onto the main playlist?
    // A song is "stuck" only if it was added BEFORE the last run and is STILL in
    // submissions — i.e. it survived a curation run. Freshly-submitted songs
    // (added after the last run) are just waiting for the next run, not a failure.
    if (job.sourcePlaylistId) {
      try {
        const subTracks = await getPlaylistTracks(job.sourcePlaylistId);
        const lastRunMs = job.lastRun ? new Date(job.lastRun).getTime() : 0;
        const stuck = subTracks.filter((t) => t.addedAt && new Date(t.addedAt).getTime() < lastRunMs - 60000);
        if (stuck.length) {
          problems.push(`"${label}": ${stuck.length} submission song(s) didn't make it onto the main playlist — still stuck after the last run (${stuck.slice(0, 5).map((t) => t.name).join(', ')}).`);
        }
      } catch (err) {
        problems.push(`"${label}": could not read submissions playlist (${err.message}).`);
      }
    }
    // (b) last run errored?
    if (job.lastResult && job.lastResult.ok === false) {
      problems.push(`"${label}": last run failed — ${job.lastResult.message || 'unknown error'}.`);
    }
    // (c) ran recently? (jobs run twice daily; >26h gap = a missed cycle)
    if (job.lastRun) {
      const ageH = (now - new Date(job.lastRun).getTime()) / 3600000;
      if (ageH > 26) {
        problems.push(`"${label}": hasn't run in ${Math.round(ageH)}h (last run ${new Date(job.lastRun).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT).`);
      }
    }
  }

  let email = { sent: false, reason: 'healthy — no email needed' };
  if (problems.length) {
    const body =
      `GudMuzik curator failsafe found ${problems.length} issue(s) at ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT:\n\n` +
      problems.map((p) => `• ${p}`).join('\n') +
      `\n\nDashboard: https://gudmuzik.com/curator`;
    email = await sendAlert(`GudMuzik Curator — ${problems.length} issue(s) found`, body);
  }

  return NextResponse.json({ ok: problems.length === 0, checked: jobs.length, problems, email });
}
