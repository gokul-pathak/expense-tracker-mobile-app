-- The budget table's contract: isolation, ownership-safe references, and the
-- uniqueness rule that makes one plan per month mean something.
-- Run with `supabase test db`. Requires the local Supabase/Postgres test image.
--
-- A failure here is a release blocker for the same reason the other row level
-- security suites are: a gap is one user reading or corrupting another user's
-- financial planning.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'budget-a@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'budget-b@example.test', 'not-used', now(), '{}', '{}', now(), now());

insert into sync.categories (sync_id, user_id, name, type, system_key, is_default, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'Food', 'expense', 'expense_food', true, 1, 1),
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2', 'Food', 'expense', 'expense_food', true, 1, 1);

insert into sync.budgets (sync_id, user_id, category_sync_id, period_month, amount_minor, currency, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000002', '2026-09', 1500000, 'NPR', 1, 1),
  ('b0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-000000000002', '2026-09', 1500000, 'NPR', 1, 1);

-- Structure ------------------------------------------------------------------

select has_table('sync', 'budgets', 'the budgets table exists');
select col_type_is(
  'sync', 'budgets', 'amount_minor', 'bigint',
  'a budget amount is an exact integer of minor units, never a floating point value'
);
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'sync' and c.relname = 'budgets'
      and (c.relrowsecurity = false or c.relforcerowsecurity = false)),
  0::bigint,
  'row level security is enabled and forced on budgets'
);
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'sync' and table_name = 'budgets' and grantee = 'anon'),
  0::bigint,
  'anon holds no grant on budgets'
);
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'sync' and table_name = 'budgets' and grantee = 'authenticated'),
  4::bigint,
  'authenticated callers may select, insert, update and delete their own budgets'
);
select ok(
  (select count(*) from sync.sync_changes where entity_type = 'budgets') = 2,
  'the change feed records a budget write, so other devices learn about it'
);

-- Constraints ----------------------------------------------------------------

select throws_ok(
  $$insert into sync.budgets (sync_id, user_id, period_month, amount_minor, currency, created_at, updated_at)
    values ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', '2026-09', 0, 'NPR', 1, 1)$$,
  '23514',
  null,
  'a budget amount of zero is refused'
);
select throws_ok(
  $$insert into sync.budgets (sync_id, user_id, period_month, amount_minor, currency, created_at, updated_at)
    values ('a0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a1', '2026-13', 1000, 'NPR', 1, 1)$$,
  '23514',
  null,
  'a month outside 01-12 is refused'
);
select throws_ok(
  $$insert into sync.budgets (sync_id, user_id, period_month, amount_minor, currency, created_at, updated_at)
    values ('a0000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000a1', '2026-09-17', 1000, 'NPR', 1, 1)$$,
  '23514',
  null,
  'a full date is refused: a month is an identity, not an instant'
);
select throws_ok(
  $$insert into sync.budgets (sync_id, user_id, category_sync_id, period_month, amount_minor, currency, created_at, updated_at)
    values ('a0000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000002', '2026-09', 999, 'NPR', 1, 1)$$,
  '23505',
  null,
  'a second live budget for the same month, currency and category is refused'
);

-- The overall budget's null category must still collide with itself.
insert into sync.budgets (sync_id, user_id, period_month, amount_minor, currency, created_at, updated_at)
values ('a0000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-0000000000a1', '2026-09', 4000000, 'NPR', 1, 1);
select throws_ok(
  $$insert into sync.budgets (sync_id, user_id, period_month, amount_minor, currency, created_at, updated_at)
    values ('a0000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-0000000000a1', '2026-09', 5000000, 'NPR', 1, 1)$$,
  '23505',
  null,
  'a second overall budget for one month is refused, despite the null category'
);
select lives_ok(
  $$insert into sync.budgets (sync_id, user_id, period_month, amount_minor, currency, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000a1', '2026-09', 5000000, 'USD', 1, 1)$$,
  'a different currency is a different plan and is allowed'
);

-- A tombstoned plan releases its month, so the same budget can be recreated.
update sync.budgets set deleted_at = 2 where sync_id = 'a0000000-0000-0000-0000-00000000000e';
select lives_ok(
  $$insert into sync.budgets (sync_id, user_id, period_month, amount_minor, currency, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000a1', '2026-09', 6000000, 'NPR', 1, 1)$$,
  'a deleted budget no longer occupies its month'
);

-- Isolation ------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-0000-0000-0000000000a1", "role": "authenticated"}';

select is(
  (select count(*) from sync.budgets where user_id = '00000000-0000-0000-0000-0000000000b2'),
  0::bigint,
  'a user cannot read another user''s budgets'
);
select is(
  (select count(*) from sync.budgets where user_id = '00000000-0000-0000-0000-0000000000a1'),
  4::bigint,
  'a user reads exactly their own budgets, including the tombstoned one'
);
select throws_ok(
  $$insert into sync.budgets (sync_id, user_id, period_month, amount_minor, currency, created_at, updated_at)
    values ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', '2026-10', 1000, 'NPR', 1, 1)$$,
  '42501',
  null,
  'a user cannot insert a budget owned by someone else'
);
select is(
  (select count(*) from (
    update sync.budgets set amount_minor = 1
      where sync_id = 'b0000000-0000-0000-0000-000000000009' returning 1
  ) as updated),
  0::bigint,
  'a user cannot update another user''s budget: the row is not visible to them'
);
select is(
  (select count(*) from (
    delete from sync.budgets where sync_id = 'b0000000-0000-0000-0000-000000000009' returning 1
  ) as removed),
  0::bigint,
  'a user cannot delete another user''s budget'
);

-- The ownership-safe foreign key: the category must belong to the same account.
select throws_ok(
  $$insert into sync.budgets (sync_id, user_id, category_sync_id, period_month, amount_minor, currency, created_at, updated_at)
    values ('c0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-000000000002', '2026-11', 1000, 'NPR', 1, 1)$$,
  '23503',
  null,
  'a budget cannot reference another user''s category'
);
select lives_ok(
  $$insert into sync.budgets (sync_id, user_id, period_month, amount_minor, currency, created_at, updated_at)
    values ('c0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', '2026-12', 1000, 'NPR', 1, 1)$$,
  'an overall budget needs no category and is accepted'
);

select * from finish();
rollback;
