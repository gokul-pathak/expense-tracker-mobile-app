-- M9D: a per-user limit on Spending Insights explanations.
--
-- Counts only, exactly like the M9C suggestion quota, and separate from it so
-- one feature cannot spend the other's allowance. No question, no figures, no
-- category or person name and no explanation is ever stored: the insight
-- function keeps none of them. The app never reads this table.

create table ai_private.insight_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  window_kind text not null check (window_kind in ('minute', 'day')),
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, window_kind, window_start)
);

alter table ai_private.insight_usage enable row level security;
revoke all on ai_private.insight_usage from public, anon, authenticated;

-- Consumes one explanation from the caller's allowance. The caller is
-- auth.uid(); there is no argument to forge, and refused requests count too.
create or replace function public.consume_financial_insight_quota()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  per_minute constant integer := 5;
  per_day constant integer := 50;
  minute_count integer;
  day_count integer;
begin
  if caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  insert into ai_private.insight_usage as usage (user_id, window_kind, window_start, request_count)
  values (caller, 'minute', date_trunc('minute', now()), 1)
  on conflict (user_id, window_kind, window_start)
  do update set request_count = usage.request_count + 1
  returning usage.request_count into minute_count;

  insert into ai_private.insight_usage as usage (user_id, window_kind, window_start, request_count)
  values (caller, 'day', date_trunc('day', now()), 1)
  on conflict (user_id, window_kind, window_start)
  do update set request_count = usage.request_count + 1
  returning usage.request_count into day_count;

  delete from ai_private.insight_usage
  where user_id = caller and window_start < now() - interval '2 days';

  return jsonb_build_object('allowed', minute_count <= per_minute and day_count <= per_day);
end;
$$;

revoke all on function public.consume_financial_insight_quota() from public, anon, authenticated;
grant execute on function public.consume_financial_insight_quota() to authenticated;
