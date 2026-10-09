-- WHI-2061: per-job run lease for the auto-curator.
-- The cron route (Vercel at :00, Mac runner at :05) and manual runs take the
-- lease with a conditional update before touching a playlist and clear it
-- afterwards, so two runs of the same job can never overlap.
-- pinnedUris needs no column: it lives in the job's JSONB `data` like the
-- other job settings.
-- Run this BEFORE deploying the matching code: without these columns every
-- lease attempt fails and jobs are skipped (fail closed).
alter table curator_jobs add column if not exists lease_until timestamptz;
alter table curator_jobs add column if not exists lease_token text;
