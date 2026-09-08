-- The full row level security matrix, table by table.
-- Run with `supabase test db`. Requires the local Supabase/Postgres test image.
--
-- `rls.sql` proves the shape of the policies. This proves the matrix: for every
-- client-accessible table, every operation, in both directions. Passing this is
-- a release blocker — a gap here is one user reading another user's finances.
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'matrix-a@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'matrix-b@example.test', 'not-used', now(), '{}', '{}', now(), now());

-- One populated account per user, created before any role is assumed.
insert into sync.accounts (sync_id, user_id, name, type, currency, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'A cash', 'cash', 'NPR', 1, 1),
  ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'B cash', 'cash', 'NPR', 1, 1);
insert into sync.categories (sync_id, user_id, name, type, system_key, is_default, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'Food', 'expense', 'expense_food', true, 1, 1),
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2', 'Food', 'expense', 'expense_food', true, 1, 1);
insert into sync.people (sync_id, user_id, name, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'A person', 1, 1),
  ('b0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b2', 'B person', 1, 1);
insert into sync.settings (sync_id, user_id, default_currency, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', 'NPR', 1, 1),
  ('b0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b2', 'NPR', 1, 1);
insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a1', 'expense', 100, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 1, 'A lunch', 1, 1),
  ('b0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000b2', 'expense', 100, 'NPR', 'b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 1, 'B lunch', 1, 1);

-- Every client-accessible table has row level security enabled and forced.
select is(
  (select count(*) from pg_tables
    where schemaname = 'sync' and rowsecurity = false),
  0::bigint,
  'every table in the sync schema has row level security enabled'
);
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'sync' and c.relkind = 'r' and c.relforcerowsecurity = false),
  0::bigint,
  'row level security is forced, so even a table owner is subject to it'
);

-- Anonymous callers have no grants at all on financial data.
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'sync' and grantee = 'anon'),
  0::bigint,
  'anon holds no grant on any sync table'
);
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'sync' and grantee = 'authenticated'
      and table_name = 'sync_changes' and privilege_type <> 'SELECT'),
  0::bigint,
  'the change feed is read-only for authenticated callers'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

-- SELECT: own rows only, on every table.
select is((select count(*) from sync.accounts), 1::bigint, 'A selects only its own accounts');
select is((select count(*) from sync.categories), 1::bigint, 'A selects only its own categories');
select is((select count(*) from sync.people), 1::bigint, 'A selects only its own people');
select is((select count(*) from sync.settings), 1::bigint, 'A selects only its own settings');
select is((select count(*) from sync.transactions), 1::bigint, 'A selects only its own transactions');
select is((select count(*) from sync.sync_changes), 5::bigint, 'A selects only its own changes');

-- INSERT as self: allowed on every table.
select lives_ok($$insert into sync.accounts (sync_id, user_id, name, type, currency, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000a1', 'A bank', 'bank', 'NPR', 1, 1)$$, 'A inserts its own account');
select lives_ok($$insert into sync.categories (sync_id, user_id, name, type, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000a1', 'Coffee', 'expense', 1, 1)$$, 'A inserts its own category');
select lives_ok($$insert into sync.people (sync_id, user_id, name, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a1', 'A friend', 1, 1)$$, 'A inserts its own person');
select lives_ok($$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-0000000000a1', 'expense', 500, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 1, 'A snack', 1, 1)$$, 'A inserts its own transaction');

-- INSERT as another user: refused on every table.
select throws_ok($$insert into sync.accounts (sync_id, user_id, name, type, currency, created_at, updated_at) values ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'forged', 'cash', 'NPR', 1, 1)$$, '42501', null, 'A cannot insert an account as B');
select throws_ok($$insert into sync.categories (sync_id, user_id, name, type, created_at, updated_at) values ('c0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2', 'forged', 'expense', 1, 1)$$, '42501', null, 'A cannot insert a category as B');
select throws_ok($$insert into sync.people (sync_id, user_id, name, created_at, updated_at) values ('c0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b2', 'forged', 1, 1)$$, '42501', null, 'A cannot insert a person as B');
select throws_ok($$insert into sync.settings (sync_id, user_id, default_currency, created_at, updated_at) values ('c0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b2', 'USD', 1, 1)$$, '42501', null, 'A cannot insert settings as B');
select throws_ok($$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at) values ('c0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000b2', 'expense', 1, 'NPR', 'b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 1, 'forged', 1, 1)$$, '42501', null, 'A cannot insert a transaction as B');

-- UPDATE own rows: allowed.
select lives_ok($$update sync.accounts set name = 'A renamed' where sync_id = 'a0000000-0000-0000-0000-000000000001'$$, 'A updates its own account');
select lives_ok($$update sync.categories set name = 'Renamed' where sync_id = 'a0000000-0000-0000-0000-000000000002'$$, 'A updates its own category');
select lives_ok($$update sync.people set name = 'Renamed' where sync_id = 'a0000000-0000-0000-0000-000000000003'$$, 'A updates its own person');
select lives_ok($$update sync.settings set default_currency = 'USD' where sync_id = 'a0000000-0000-0000-0000-000000000004'$$, 'A updates its own settings');
select lives_ok($$update sync.transactions set amount_minor = 200 where sync_id = 'a0000000-0000-0000-0000-000000000005'$$, 'A updates its own transaction');

-- UPDATE another user's rows: invisible, so nothing changes.
update sync.accounts set name = 'stolen' where sync_id = 'b0000000-0000-0000-0000-000000000001';
update sync.categories set name = 'stolen' where sync_id = 'b0000000-0000-0000-0000-000000000002';
update sync.people set name = 'stolen' where sync_id = 'b0000000-0000-0000-0000-000000000003';
update sync.settings set default_currency = 'XXX' where sync_id = 'b0000000-0000-0000-0000-000000000004';
update sync.transactions set amount_minor = 999 where sync_id = 'b0000000-0000-0000-0000-000000000005';

-- Changing ownership of one's own row is refused outright.
select throws_ok($$update sync.accounts set user_id = '00000000-0000-0000-0000-0000000000b2' where sync_id = 'a0000000-0000-0000-0000-000000000001'$$, '42501', null, 'A cannot hand an account to B');
select throws_ok($$update sync.transactions set user_id = '00000000-0000-0000-0000-0000000000b2' where sync_id = 'a0000000-0000-0000-0000-000000000005'$$, '42501', null, 'A cannot hand a transaction to B');

-- DELETE another user's rows: invisible, so nothing is removed.
delete from sync.accounts where sync_id = 'b0000000-0000-0000-0000-000000000001';
delete from sync.categories where sync_id = 'b0000000-0000-0000-0000-000000000002';
delete from sync.people where sync_id = 'b0000000-0000-0000-0000-000000000003';
delete from sync.transactions where sync_id = 'b0000000-0000-0000-0000-000000000005';

-- Tombstoning is an ordinary update and follows the same rule.
select lives_ok($$update sync.transactions set deleted_at = 5000 where sync_id = 'a0000000-0000-0000-0000-000000000005'$$, 'A tombstones its own transaction');

-- Cross-user foreign keys: a transaction of A may not reference anything of B.
select throws_ok($$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-0000000000a1', 'expense', 1, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 1, 'bad', 1, 1)$$, null, null, 'A cannot spend from B''s account');
select throws_ok($$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-0000000000a1', 'expense', 1, 'NPR', 'b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 1, 'bad', 1, 1)$$, null, null, 'A cannot categorise with B''s category');
select throws_ok($$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, person_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-0000000000a1', 'lend', 1, 'NPR', 'b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 1, 'bad', 1, 1)$$, null, null, 'A cannot lend to B''s person');
select throws_ok($$update sync.transactions set source_account_sync_id = 'b0000000-0000-0000-0000-000000000001' where sync_id = 'a0000000-0000-0000-0000-000000000005'$$, null, null, 'A cannot repoint a transaction at B''s account');

-- Now confirm from B's side that nothing above touched B's data.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);

select is((select name from sync.accounts where sync_id = 'b0000000-0000-0000-0000-000000000001'), 'B cash', 'B''s account is untouched');
select is((select name from sync.categories where sync_id = 'b0000000-0000-0000-0000-000000000002'), 'Food', 'B''s category is untouched');
select is((select name from sync.people where sync_id = 'b0000000-0000-0000-0000-000000000003'), 'B person', 'B''s person is untouched');
select is((select default_currency from sync.settings where sync_id = 'b0000000-0000-0000-0000-000000000004'), 'NPR', 'B''s settings are untouched');
select is((select amount_minor from sync.transactions where sync_id = 'b0000000-0000-0000-0000-000000000005'), 100::bigint, 'B''s transaction is untouched');
select is((select count(*) from sync.accounts), 1::bigint, 'B still sees only its own accounts');
select is((select count(*) from sync.transactions), 1::bigint, 'B still sees only its own transactions');
select is(
  (select count(*) from sync.sync_changes where user_id <> '00000000-0000-0000-0000-0000000000b2'),
  0::bigint,
  'B cannot see A''s change feed'
);

-- Anonymous callers see nothing and can write nothing.
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is_empty('select * from sync.accounts', 'anon reads no accounts');
select is_empty('select * from sync.categories', 'anon reads no categories');
select is_empty('select * from sync.people', 'anon reads no people');
select is_empty('select * from sync.settings', 'anon reads no settings');
select is_empty('select * from sync.transactions', 'anon reads no transactions');
select is_empty('select * from sync.sync_changes', 'anon reads no change feed');
select throws_ok($$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at) values ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'expense', 1, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 1, 'anon', 1, 1)$$, '42501', null, 'anon cannot write a transaction');

select * from finish();
rollback;
