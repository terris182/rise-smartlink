// WHI-2061: cron overlap protection (Vercel cron at :00, Mac runner force=1 at :05).
// Run: npm run test:curator   (in-memory job store, fake curate function, no network)
import { test } from 'node:test';
import assert from 'node:assert/strict';

for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_CURATOR_URL', 'SUPABASE_CURATOR_SERVICE_ROLE_KEY']) delete process.env[k];

const jobs = await import('../lib/curator-jobs.js');
const { createJob, getJob, deleteJob, getAllJobs, recordRun, acquireLease, releaseLease, runScheduledJobs, runJobNow } = jobs;

const PIN = (n) => `spotify:track:${String(n).repeat(22).slice(0, 22)}`;
// 2026-10-09 17:05 UTC = 10:05 PDT
const AT_1005 = new Date('2026-10-09T17:05:00Z');
const AT_1000 = new Date('2026-10-09T17:00:30Z');

async function reset() {
  for (const j of await getAllJobs()) await deleteJob(j.id);
}
function fakeCurate() {
  const calls = [];
  const fn = async (job) => { calls.push(job.id); return { ok: true, message: 'fake run' }; };
  fn.calls = calls;
  return fn;
}
const daily = (name, hours) => createJob({ name, targetPlaylistId: name, mode: 'refresh', cadence: 'daily', dailyHours: hours, active: true });

test('(g1) force=1 only runs jobs due this PST hour', async () => {
  await reset();
  const due = await daily('due', [10]);
  const notDue = await daily('notdue', [22]);
  const curate = fakeCurate();
  const out = await runScheduledJobs({ force: true, now: AT_1005, curate });
  assert.deepEqual(curate.calls, [due.id]);
  assert.ok(!curate.calls.includes(notDue.id));
  assert.equal(out.ran, 1);
});

test('(g2) a job that already ran successfully this PST hour slot is skipped', async () => {
  await reset();
  const j = await daily('ran', [10]);
  await recordRun(j.id, { ok: true, at: AT_1000.toISOString() }, AT_1000);
  const curate = fakeCurate();
  const out = await runScheduledJobs({ force: true, now: AT_1005, curate });
  assert.deepEqual(curate.calls, []);
  assert.deepEqual(out.skipped.map((s) => [s.id, s.reason]), [[j.id, 'already ran this slot']]);
});

test('(r1) Mac runner at :05: a job Vercel already ran is reported in runs as ok + skipped, so no false alarm', async () => {
  await reset();
  const j = await daily('ran-at-00', [10]);
  await recordRun(j.id, { ok: true, message: 'Refreshed at :00', at: AT_1000.toISOString() }, AT_1000);
  const curate = fakeCurate();
  const out = await runScheduledJobs({ force: true, now: AT_1005, curate });
  assert.deepEqual(curate.calls, []);
  assert.equal(out.ran, 0, 'ran counts real executions only');
  assert.equal(out.runs.length, 1);
  const r = out.runs[0];
  assert.equal(r.id, j.id);
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'already ran this slot');
  assert.equal(r.lastResult.ok, true);
  assert.equal(r.lastResult.message, 'Refreshed at :00');
});

test('(r3) stale job list: a run finished between the list read and the lease is skipped without recordRun or curate', async () => {
  await reset();
  const j = await daily('race', [10]);
  const stale = await getAllJobs(); // read before the :00 run recorded its result
  await recordRun(j.id, { ok: true, message: 'Refreshed at :00', at: AT_1000.toISOString() }, AT_1000);
  const before = await getJob(j.id);
  const curate = fakeCurate();
  const out = await runScheduledJobs({ jobs: stale, force: true, now: AT_1005, curate });
  assert.deepEqual(curate.calls, [], 'Spotify never touched');
  const after = await getJob(j.id);
  assert.deepEqual(after.lastResult, before.lastResult, 'successful lastResult not overwritten');
  assert.equal(after.lastRun, before.lastRun);
  assert.equal(out.runs[0].ok, true);
  assert.equal(out.runs[0].skipped, true);
  assert.equal(out.runs[0].reason, 'already ran this slot');
  const lease = await acquireLease(j.id, { now: AT_1005 });
  assert.equal(lease.ok, true, 'lease released after the skip');
  await releaseLease(j.id, lease.token);
});

test('(g3) a job whose run this slot FAILED is retried by the :05 runner', async () => {
  await reset();
  const j = await daily('failed', [10]);
  await recordRun(j.id, { ok: false, message: 'boom', at: AT_1000.toISOString() }, AT_1000);
  const curate = fakeCurate();
  await runScheduledJobs({ force: true, now: AT_1005, curate });
  assert.deepEqual(curate.calls, [j.id]);
});

test('(g4) override=1 bypasses the slot guard deliberately', async () => {
  await reset();
  const j = await daily('override', [10]);
  await recordRun(j.id, { ok: true, at: AT_1000.toISOString() }, AT_1000);
  const curate = fakeCurate();
  await runScheduledJobs({ force: true, override: true, now: AT_1005, curate });
  assert.deepEqual(curate.calls, [j.id]);
});

test('(g5) a job whose lease is held by another run is skipped, even with override=1', async () => {
  await reset();
  const j = await daily('leased', [10]);
  const lease = await acquireLease(j.id, { now: AT_1005 });
  assert.equal(lease.ok, true);
  const curate = fakeCurate();
  const out = await runScheduledJobs({ force: true, override: true, now: AT_1005, curate });
  assert.deepEqual(curate.calls, []);
  assert.equal(out.skipped[0].reason, 'lease held');
  assert.equal(out.ran, 0);
  assert.deepEqual(
    out.runs.map((r) => [r.id, r.ok, r.skipped, r.reason]),
    [[j.id, true, true, 'lease held']],
    'lease-held skip also appears in runs as ok + skipped'
  );
  await releaseLease(j.id, lease.token);
  const again = await runScheduledJobs({ force: true, now: AT_1005, curate });
  assert.deepEqual(curate.calls, [j.id]);
  assert.equal(again.ran, 1);
});

test('(g6) the lease is released after a run (also when curate throws) and an expired lease can be taken', async () => {
  await reset();
  const j = await daily('release', [10]);
  const boom = async () => { throw new Error('spotify down'); };
  const out = await runScheduledJobs({ now: AT_1005, curate: boom });
  assert.equal(out.runs[0].ok, false);
  const l2 = await acquireLease(j.id, { now: AT_1005 });
  assert.equal(l2.ok, true, 'lease was released after the failed run');
  const later = new Date(AT_1005.getTime() + 60 * 60 * 1000);
  const l3 = await acquireLease(j.id, { now: later });
  assert.equal(l3.ok, true, 'a stale lease expires');
  await releaseLease(j.id, l3.token);
});

test('(g7) non-force cron keeps its due-hour and once-per-slot rules', async () => {
  await reset();
  const due = await daily('plain', [10]);
  await daily('plain-notdue', [3]);
  const curate = fakeCurate();
  await runScheduledJobs({ now: AT_1000, curate });
  await runScheduledJobs({ now: AT_1005, curate });
  assert.deepEqual(curate.calls, [due.id], 'second call in the same slot is skipped');
});

test('(g8) manual run respects the lease', async () => {
  await reset();
  const j = await daily('manual', [10]);
  const lease = await acquireLease(j.id);
  const curate = fakeCurate();
  const r = await runJobNow(await getJob(j.id), curate);
  assert.equal(r.skipped, 'lease held');
  assert.deepEqual(curate.calls, []);
  await releaseLease(j.id, lease.token);
  const r2 = await runJobNow(await getJob(j.id), curate);
  assert.equal(r2.result.ok, true);
});

test('pinnedUris validation: unique, 1..excludeTopN, Spotify track URIs', async () => {
  await reset();
  const ok = await createJob({ name: 'p', targetPlaylistId: 't', mode: 'refresh', pinnedUris: [PIN(1), PIN(2)] });
  assert.deepEqual(ok.pinnedUris, [PIN(1), PIN(2)]);
  assert.equal(ok.excludeTopN, 5, 'refresh/resort with pins defaults excludeTopN to 5');
  const noPins = await createJob({ name: 'np', targetPlaylistId: 't', mode: 'refresh' });
  assert.equal(noPins.pinnedUris, null);
  await assert.rejects(createJob({ name: 'd', targetPlaylistId: 't', mode: 'refresh', pinnedUris: [PIN(1), PIN(1)] }), /unique/i);
  await assert.rejects(createJob({ name: 'e', targetPlaylistId: 't', mode: 'refresh', pinnedUris: [] }), /pinnedUris/);
  const raised = await createJob({ name: 'l', targetPlaylistId: 't', mode: 'refresh', excludeTopN: 2, pinnedUris: [PIN(1), PIN(2), PIN(3)] });
  assert.equal(raised.excludeTopN, 5, 'excludeTopN raised to max(5, pins) instead of rejecting');
  await assert.rejects(createJob({ name: 'b', targetPlaylistId: 't', pinnedUris: ['not-a-uri'] }), /spotify:track/);
  const cleared = await jobs.updateJob(ok.id, { pinnedUris: null });
  assert.equal(cleared.pinnedUris, null);
  const kept = await jobs.updateJob(ok.id, { name: 'renamed' });
  assert.equal(kept.pinnedUris, null);
});

test('(r2) PUT with only { id, pinnedUris: 5 uris } succeeds on a job that had excludeTopN 3', async () => {
  await reset();
  const old = await createJob({ name: 'old', targetPlaylistId: 't', mode: 'refresh' });
  assert.equal(old.excludeTopN, 3);
  const five = [1, 2, 3, 4, 5].map(PIN);
  const upd = await jobs.updateJob(old.id, { id: old.id, pinnedUris: five });
  assert.deepEqual(upd.pinnedUris, five);
  assert.equal(upd.excludeTopN, 5);
  const six = [1, 2, 3, 4, 5, 6].map(PIN);
  const upd6 = await jobs.updateJob(old.id, { id: old.id, pinnedUris: six });
  assert.equal(upd6.excludeTopN, 6, 'max(5, pinnedUris.length)');
  const keep = await createJob({ name: 'big', targetPlaylistId: 't', mode: 'refresh', excludeTopN: 8, pinnedUris: five });
  assert.equal(keep.excludeTopN, 8, 'a larger excludeTopN is kept');
});

test('(r5) persistence errors are thrown (route answers 500), not reported as success', async () => {
  const { FakeSupabase } = await import('./helpers/fake-supabase.mjs');
  const db = new FakeSupabase();
  jobs.__setTestClient(db);
  try {
    const j = await createJob({ name: 'db', targetPlaylistId: 't', mode: 'refresh' });
    assert.equal(db.rows.has(j.id), true);
    db.failWrites = 'database is read-only';
    await assert.rejects(jobs.updateJob(j.id, { id: j.id, name: 'renamed' }), (err) => {
      assert.equal(err.status, 500);
      assert.match(err.message, /database is read-only/);
      return true;
    });
    await assert.rejects(createJob({ name: 'x', targetPlaylistId: 't' }), (err) => err.status === 500);
    assert.equal((await getJob(j.id)).name, 'db', 'stored job unchanged');
    // validation errors stay 400-class (no status 500)
    db.failWrites = null;
    await assert.rejects(jobs.updateJob(j.id, { pinnedUris: ['bad'] }), (err) => err.status !== 500);
  } finally {
    jobs.__setTestClient(null);
  }
});
