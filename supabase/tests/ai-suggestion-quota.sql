-- The AI suggestion quota: counts only, private to the database, and keyed to
-- the verified caller rather than to anything a client says.
-- Run with `supabase test db`. Requires the local Supabase/Postgres test image.
--
-- A failure here is a release blocker: without it, one session can spend the
-- project's provider budget without limit.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'quota-a@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'quota-b@example.test', 'not-used', now(), '{}', '{}', now(), now());

-- Structure ------------------------------------------------------------------

select has_table('ai_private', 'suggestion_usage', 'the usage counter table exists');
select columns_are(
  'ai_private', 'suggestion_usage',
  array['user_id', 'window_kind', 'window_start', 'request_count'],
  'the counter holds counts and nothing a receipt said'
);
select has_function('public', 'consume_expense_suggestion_quota', array[]::text[], 'the quota function exists');
select ok(not has_schema_privilege('authenticated', 'ai_private', 'usage'), 'signed-in users cannot reach the private schema');
select ok(not has_table_privilege('authenticated', 'ai_private.suggestion_usage', 'select'), 'signed-in users cannot read the counters');
select ok(not has_function_privilege('anon', 'public.consume_expense_suggestion_quota()', 'execute'), 'anonymous callers cannot reach the quota');
select ok(has_function_privilege('authenticated', 'public.consume_expense_suggestion_quota()', 'execute'), 'signed-in callers can');

-- Behaviour ------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

select is(
  (select bool_and((public.consume_expense_suggestion_quota() ->> 'allowed')::boolean) from generate_series(1, 6)),
  true,
  'six requests in one minute are allowed'
);
select is((public.consume_expense_suggestion_quota() ->> 'allowed')::boolean, false, 'the seventh in the same minute is refused');
select is((public.consume_expense_suggestion_quota() ->> 'allowed')::boolean, false, 'and a caller that keeps asking stays refused');
select throws_ok('select * from ai_private.suggestion_usage', '42501', null, 'the caller cannot read or reset the counters directly');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
select is((public.consume_expense_suggestion_quota() ->> 'allowed')::boolean, true, 'one person''s quota never spends another''s');

reset role;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok('select public.consume_expense_suggestion_quota()', '42501', null, 'no verified identity, no quota');
select is(
  (select request_count from ai_private.suggestion_usage where user_id = '00000000-0000-0000-0000-0000000000a1' and window_kind = 'day'),
  8,
  'every request counts toward the day, refused ones included'
);

select * from finish();
rollback;
