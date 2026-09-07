-- Push contract, verified against the real cloud schema.
-- Run with `supabase test db`. This suite requires the local Supabase/Postgres
-- test image and is deliberately outside the normal offline test run.
--
-- It proves the guarantees the push engine depends on: the same statement the
-- Supabase client issues (`insert ... on conflict do update`) is idempotent,
-- carries tombstones instead of deleting rows, is confined to the signed-in
-- owner by row level security, and accepts every transaction type unchanged.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'push-a@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'push-b@example.test', 'not-used', now(), '{}', '{}', now(), now());

-- User B already owns an account, so cross-user references can be attempted.
insert into sync.accounts (sync_id, user_id, name, type, currency, created_at, updated_at)
values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'B cash', 'cash', 'NPR', 1, 1);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

-- Parents first, exactly as the push phases upload them.
select lives_ok($$
  insert into sync.accounts (sync_id, user_id, name, type, opening_balance_minor, currency, is_archived, created_at, updated_at)
  values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Cash', 'cash', 100000, 'NPR', false, 1000, 1000)
  on conflict (sync_id) do update set name = excluded.name, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
$$, 'push upserts an account for the signed-in owner');

select lives_ok($$
  insert into sync.accounts (sync_id, user_id, name, type, opening_balance_minor, currency, is_archived, created_at, updated_at)
  values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'Bank', 'bank', 500000, 'NPR', false, 1000, 1000)
  on conflict (sync_id) do update set name = excluded.name
$$, 'push upserts a second account');

select lives_ok($$
  insert into sync.categories (sync_id, user_id, name, type, icon, system_key, is_default, created_at, updated_at)
  values ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'Food', 'expense', 'food', 'expense_food', true, 1000, 1000)
  on conflict (sync_id) do update set name = excluded.name
$$, 'push upserts a built-in category with its system key');

select lives_ok($$
  insert into sync.people (sync_id, user_id, name, is_archived, created_at, updated_at)
  values ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', 'Ram', false, 1000, 1000)
  on conflict (sync_id) do update set name = excluded.name
$$, 'push upserts a person');

-- Settings is one row per user, so ownership is its conflict target.
select lives_ok($$
  insert into sync.settings (sync_id, user_id, default_currency, created_at, updated_at)
  values ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a1', 'NPR', 1000, 1000)
  on conflict (user_id) do update set sync_id = excluded.sync_id, default_currency = excluded.default_currency
$$, 'push upserts the user-global settings row');

select lives_ok($$
  insert into sync.settings (sync_id, user_id, default_currency, created_at, updated_at)
  values ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a1', 'USD', 1000, 2000)
  on conflict (user_id) do update set sync_id = excluded.sync_id, default_currency = excluded.default_currency, updated_at = excluded.updated_at
$$, 'repeated settings push updates rather than duplicating');

select is((select count(*) from sync.settings), 1::bigint, 'one settings row survives repeated pushes');

-- Every transaction type keeps its own meaning in the cloud.
select lives_ok($$
  insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, destination_account_sync_id, person_sync_id, payment_mode, transaction_date, title, created_at, updated_at)
  values
    ('10000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000a1', 'expense', 1299, 'NPR', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', null, null, 'cash', 900, 'Lunch', 1000, 1000),
    ('10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000a1', 'income', 80000, 'NPR', '10000000-0000-0000-0000-000000000003', null, '10000000-0000-0000-0000-000000000002', null, 'bank_transfer', 900, 'Salary', 1000, 1000),
    ('10000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000a1', 'transfer', 25000, 'NPR', null, '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', null, null, 900, 'Transfer', 1000, 1000),
    ('10000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a1', 'lend', 30000, 'NPR', null, '10000000-0000-0000-0000-000000000001', null, '10000000-0000-0000-0000-000000000004', null, 900, 'Lend', 1000, 1000),
    ('10000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-0000000000a1', 'borrow', 20000, 'NPR', null, null, '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', null, 900, 'Borrow', 1000, 1000),
    ('10000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-0000000000a1', 'repayment_received', 10000, 'NPR', null, null, '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', null, 900, 'Repayment received', 1000, 1000),
    ('10000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-0000000000a1', 'repayment_paid', 5000, 'NPR', null, '10000000-0000-0000-0000-000000000001', null, '10000000-0000-0000-0000-000000000004', null, 900, 'Repayment paid', 1000, 1000)
  on conflict (sync_id) do update set amount_minor = excluded.amount_minor, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
$$, 'push uploads every transaction type with its own semantics');

select is((select count(*) from sync.transactions where user_id = '00000000-0000-0000-0000-0000000000a1'), 7::bigint, 'all seven transaction types are stored');
select is((select amount_minor from sync.transactions where sync_id = '10000000-0000-0000-0000-000000000010'), 1299::bigint, 'money stays in exact minor units');
select is((select transaction_date from sync.transactions where sync_id = '10000000-0000-0000-0000-000000000010'), 900::bigint, 'the financial date is preserved independently of sync time');

-- Replaying the same operation must converge, not duplicate.
select lives_ok($$
  insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at)
  values ('10000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000a1', 'expense', 1499, 'NPR', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 900, 'Lunch', 1000, 2000)
  on conflict (sync_id) do update set amount_minor = excluded.amount_minor, updated_at = excluded.updated_at
$$, 'replaying an operation is idempotent');
select is((select count(*) from sync.transactions where sync_id = '10000000-0000-0000-0000-000000000010'), 1::bigint, 'a replayed push leaves one cloud row');

-- A local deletion travels as a tombstone so other devices can observe it.
update sync.transactions set deleted_at = 5000, updated_at = 5000
  where sync_id = '10000000-0000-0000-0000-000000000010';
select is((select count(*) from sync.transactions where sync_id = '10000000-0000-0000-0000-000000000010' and deleted_at is not null), 1::bigint, 'a deletion is pushed as a tombstone on the same row');

-- Archiving is an ordinary update, never a cloud deletion.
update sync.accounts set is_archived = true, updated_at = 6000
  where sync_id = '10000000-0000-0000-0000-000000000001';
select is((select deleted_at from sync.accounts where sync_id = '10000000-0000-0000-0000-000000000001'), null, 'archiving does not tombstone the cloud row');

-- Ownership is the database's decision, not the client's.
select throws_ok($$
  insert into sync.accounts (sync_id, user_id, name, type, currency, created_at, updated_at)
  values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'Forged', 'cash', 'NPR', 1, 1)
$$, '42501', null, 'push cannot upload a row owned by another user');

select throws_ok($$
  insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, source_account_sync_id, person_sync_id, transaction_date, title, created_at, updated_at)
  values ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'lend', 100, 'NPR', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 1, 'Cross-user', 1, 1)
$$, null, null, 'push cannot reference another user''s account');

select * from finish();
rollback;
