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

-- Internal data: RLS on with no policies = service role only (the route uses the service role key).
alter table meta_interest_blocklist enable row level security;

-- Atomic note: inserts the row or bumps its count, so concurrent requests never lose a count.
create or replace function note_meta_interest(
  p_key text, p_kind text, p_interest_id text, p_name text, p_reason text, p_campaign_id text
) returns void language sql security invoker as $$
  insert into meta_interest_blocklist (key, kind, interest_id, name, reason, campaign_id)
  values (p_key, p_kind, p_interest_id, p_name, p_reason, p_campaign_id)
  on conflict (key) do update set
    count = meta_interest_blocklist.count + 1,
    last_seen = now(),
    campaign_id = coalesce(meta_interest_blocklist.campaign_id, excluded.campaign_id);
$$;
revoke all on function note_meta_interest(text, text, text, text, text, text) from public, anon, authenticated;
