-- WHI-2305: internal note of Meta targeting inputs that failed validation.
-- kind 'interest': an interest Meta rejected; the interest search stops offering it.
-- kind 'no_countries': a Custom targeting request that arrived with no valid countries (Big 5 used).
-- Additive and safe to run before or after the code deploys: the route works without the table (it just skips the note).
create table if not exists meta_interest_blocklist (
  key text primary key,
  kind text not null,
  interest_id text,
  name text,
  reason text,
  campaign_id text,
  count integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists meta_interest_blocklist_kind_idx on meta_interest_blocklist (kind);
