-- M9C: a per-user limit on AI category suggestions.
--
-- Counts, and nothing else. No merchant text, no category names, no prompt and
-- no suggestion: the suggestion function sends those to the provider and keeps
-- none of them. What remains here is how many requests one person made in the
-- current minute and day, so a looping client or a stolen session cannot run
-- up an unbounded provider bill.
--
-- Not a sync entity and not in the sync schema. The app never reads it.

create schema if not exists ai_private;
revoke all on schema ai_private from public, anon, authenticated;

create table ai_private.suggestion_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  window_kind text not null check (window_kind in ('minute', 'day')),
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, window_kind, window_start)
);

-- No policies: no client role can touch the table. The quota function below is
-- the only way in, and it only ever writes the caller's own counters.
alter table ai_private.suggestion_usage enable row level security;
revoke all on ai_private.suggestion_usage from public, anon, authenticated;

-- Consumes one request from the caller's allowance and says whether it fits.
--
-- The caller is auth.uid(), from the verified JWT. There is no user argument
-- to forge. Refused requests are counted too, so a client that keeps asking
-- stays refused rather than getting through each time a window turns over.
create or replace function public.consume_expense_suggestion_quota()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  per_minute constant integer := 6;
  per_day constant integer := 100;
  minute_count integer;
  day_count integer;
begin
  if caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  insert into ai_private.suggestion_usage as usage (user_id, window_kind, window_start, request_count)
  values (caller, 'minute', date_trunc('minute', now()), 1)
  on conflict (user_id, window_kind, window_start)
  do update set request_count = usage.request_count + 1
  returning usage.request_count into minute_count;

  insert into ai_private.suggestion_usage as usage (user_id, window_kind, window_start, request_count)
  values (caller, 'day', date_trunc('day', now()), 1)
  on conflict (user_id, window_kind, window_start)
  do update set request_count = usage.request_count + 1
  returning usage.request_count into day_count;

  -- Old windows are worthless. Keep the table the size of its active users.
  delete from ai_private.suggestion_usage
  where user_id = caller and window_start < now() - interval '2 days';

  return jsonb_build_object('allowed', minute_count <= per_minute and day_count <= per_day);
end;
$$;

revoke all on function public.consume_expense_suggestion_quota() from public, anon, authenticated;
grant execute on function public.consume_expense_suggestion_quota() to authenticated;
