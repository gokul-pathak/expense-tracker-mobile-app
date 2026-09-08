-- Cloud-side integrity: what the database guarantees on its own.
-- Run with `supabase test db`. Requires the local Supabase/Postgres test image.
--
-- The client validates everything it downloads, but a client check only protects
-- the client that runs it. These assertions prove the database refuses bad
-- financial data regardless of which build, which version, or which device sent
-- it — including a future one with a bug.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'integrity-a@example.test', 'not-used', now(), '{}', '{}', now(), now());

-- Structural guarantees, independent of any data.
select is(
  (select count(*) from information_schema.tables
    where table_schema = 'sync' and table_type = 'BASE TABLE'),
  6::bigint,
  'the sync schema holds exactly the five domain tables and the change feed'
);
select col_is_pk('sync', 'accounts', 'sync_id', 'an account is identified by its global sync id');
select col_is_pk('sync', 'categories', 'sync_id', 'a category is identified by its global sync id');
select col_is_pk('sync', 'people', 'sync_id', 'a person is identified by its global sync id');
select col_is_pk('sync', 'settings', 'sync_id', 'a settings row is identified by its global sync id');
select col_is_pk('sync', 'transactions', 'sync_id', 'a transaction is identified by its global sync id');
select col_is_unique('sync', 'settings', 'user_id', 'a user can only ever have one settings row');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

insert into sync.accounts (sync_id, user_id, name, type, opening_balance_minor, currency, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Cash', 'cash', 100000, 'NPR', 1, 1);
insert into sync.categories (sync_id, user_id, name, type, system_key, is_default, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'Food', 'expense', 'expense_food', true, 1, 1),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'Salary', 'income', 'income_salary', true, 1, 1);
insert into sync.people (sync_id, user_id, name, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', 'Ram', 1, 1);

-- Money is refused unless it is a positive integer number of minor units.
select throws_ok($$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000a1', 'expense', 0, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 1, 'zero', 1, 1)$$, null, null, 'a zero amount is refused');
select throws_ok($$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000a1', 'expense', -100, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 1, 'negative', 1, 1)$$, null, null, 'a negative amount is refused');

-- Transaction shape: each type must carry the relations that give it meaning.
select throws_ok($$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, source_account_sync_id, destination_account_sync_id, transaction_date, title, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000a1', 'transfer', 100, 'NPR', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 1, 'self', 1, 1)$$, null, null, 'a transfer to the same account is refused');
select throws_ok($$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, source_account_sync_id, transaction_date, title, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a1', 'expense', 100, 'NPR', 'a0000000-0000-0000-0000-000000000001', 1, 'uncategorised', 1, 1)$$, null, null, 'an expense without a category is refused');
select throws_ok($$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, source_account_sync_id, transaction_date, title, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-0000000000a1', 'lend', 100, 'NPR', 'a0000000-0000-0000-0000-000000000001', 1, 'nobody', 1, 1)$$, null, null, 'a lend without a person is refused');
select throws_ok($$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, person_sync_id, transaction_date, title, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-0000000000a1', 'expense', 100, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', 1, 'both', 1, 1)$$, null, null, 'an expense carrying a person is refused');

-- An unrecognised type cannot be stored at all.
select throws_ok($$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, source_account_sync_id, transaction_date, title, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-0000000000a1', 'nonsense', 100, 'NPR', 'a0000000-0000-0000-0000-000000000001', 1, 'bad', 1, 1)$$, null, null, 'an unknown transaction type is refused');

-- A relation must exist before something can point at it.
select throws_ok($$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-0000000000a1', 'expense', 100, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 1, 'ghost', 1, 1)$$, null, null, 'a transaction pointing at a missing account is refused');

-- Built-in identity: one category per system key per user.
select throws_ok($$insert into sync.categories (sync_id, user_id, name, type, system_key, is_default, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000018', '00000000-0000-0000-0000-0000000000a1', 'Food again', 'expense', 'expense_food', true, 1, 1)$$, null, null, 'a duplicate built-in category is refused');

-- Custom categories are free to repeat a name, and carry no system key.
select lives_ok($$insert into sync.categories (sync_id, user_id, name, type, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000019', '00000000-0000-0000-0000-0000000000a1', 'Food', 'expense', 1, 1)$$, 'a custom category may share a name with a built-in one');

-- Settings cardinality is enforced by the database, not by the client.
select throws_ok($$insert into sync.settings (sync_id, user_id, default_currency, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-0000000000a1', 'USD', 1, 1); insert into sync.settings (sync_id, user_id, default_currency, created_at, updated_at) values ('a0000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-0000000000a1', 'EUR', 1, 1)$$, null, null, 'a second settings row for one user is refused');

-- Deletion is representable as a tombstone, and the row survives it.
insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-0000000000a1', 'expense', 500, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 1, 'Lunch', 1, 1);
update sync.transactions set deleted_at = 9000, updated_at = 9000 where sync_id = 'a0000000-0000-0000-0000-000000000030';
select is(
  (select count(*) from sync.transactions where sync_id = 'a0000000-0000-0000-0000-000000000030' and deleted_at is not null),
  1::bigint,
  'a deleted transaction is retained as a tombstone so other devices learn of it'
);

-- No duplicate logical entity for one owner, across every table.
select is(
  (select count(*) from (
    select user_id, sync_id from sync.accounts
    union all select user_id, sync_id from sync.categories
    union all select user_id, sync_id from sync.people
    union all select user_id, sync_id from sync.settings
    union all select user_id, sync_id from sync.transactions
    group by user_id, sync_id having count(*) > 1
  ) duplicates),
  0::bigint,
  'no owner has two rows sharing one global identity'
);

-- The change feed describes only real, owned records.
select is(
  (select count(*) from sync.sync_changes c
    where c.entity_type = 'transactions'
      and not exists (select 1 from sync.transactions t where t.sync_id = c.entity_sync_id)),
  0::bigint,
  'every transaction change refers to a transaction that exists'
);
select is(
  (select count(*) from sync.sync_changes where server_revision < 1),
  0::bigint,
  'every recorded change carries a real revision'
);

select * from finish();
rollback;
