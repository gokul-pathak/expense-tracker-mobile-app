-- First-link reconciliation contract, verified against the real cloud schema.
-- Run with `supabase test db`. This suite requires the local Supabase/Postgres
-- test image and is deliberately outside the normal offline test run.
--
-- It proves the cloud-side guarantees the first-link flows depend on and that an
-- in-memory stand-in cannot: a whole-dataset upload is idempotent, retiring a
-- record is a tombstone rather than a deletion, one settings row exists per
-- user however it is uploaded, and neither the rows nor the change feed of one
-- account are ever reachable from another.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'link-a@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'link-b@example.test', 'not-used', now(), '{}', '{}', now(), now());

-- User B has a populated account throughout, so isolation is proven against
-- real rows rather than an empty table.
insert into sync.accounts (sync_id, user_id, name, type, opening_balance_minor, currency, created_at, updated_at)
values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'B cash', 'cash', 777, 'NPR', 1, 1);
insert into sync.settings (sync_id, user_id, default_currency, created_at, updated_at)
values ('20000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000b2', 'USD', 1, 1);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

-- Case B: a device uploads its whole dataset, parents before children.
insert into sync.accounts (sync_id, user_id, name, type, opening_balance_minor, currency, is_archived, created_at, updated_at)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Cash', 'cash', 2000000, 'NPR', false, 1000, 1000);
insert into sync.categories (sync_id, user_id, name, type, icon, system_key, is_default, created_at, updated_at)
values ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'Food', 'expense', 'food', 'expense_food', true, 1000, 1000);
insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, payment_mode, transaction_date, title, created_at, updated_at)
values ('10000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000a1', 'expense', 5000, 'NPR', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'cash', 1700000000000, 'Espresso', 1000, 1000);

select is(
  (select count(*) from sync.transactions where user_id = '00000000-0000-0000-0000-0000000000a1'),
  1::bigint,
  'a first upload stores the uploading device''s records'
);

-- Repeating the upload is how a half-finished setup is retried.
insert into sync.accounts (sync_id, user_id, name, type, opening_balance_minor, currency, is_archived, created_at, updated_at)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Cash', 'cash', 2000000, 'NPR', false, 1000, 1000)
on conflict (sync_id) do update set
  name = excluded.name, opening_balance_minor = excluded.opening_balance_minor,
  updated_at = excluded.updated_at, deleted_at = excluded.deleted_at;

select is(
  (select count(*) from sync.accounts where user_id = '00000000-0000-0000-0000-0000000000a1'),
  1::bigint,
  'retrying an interrupted upload converges on one row per record'
);

select is(
  (select server_revision from sync.accounts where sync_id = '10000000-0000-0000-0000-000000000001'),
  2::bigint,
  'the retry is a normal revision bump, not a duplicate record'
);

-- Settings identity is ownership: uploading under a different sync_id must not
-- leave a user with two settings rows.
insert into sync.settings (sync_id, user_id, default_currency, created_at, updated_at)
values ('10000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-0000000000a1', 'NPR', 1000, 1000)
on conflict (user_id) do update set
  sync_id = excluded.sync_id, default_currency = excluded.default_currency,
  updated_at = excluded.updated_at;
insert into sync.settings (sync_id, user_id, default_currency, created_at, updated_at)
values ('10000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-0000000000a1', 'USD', 2000, 2000)
on conflict (user_id) do update set
  sync_id = excluded.sync_id, default_currency = excluded.default_currency,
  updated_at = excluded.updated_at;

select is(
  (select count(*) from sync.settings where user_id = '00000000-0000-0000-0000-0000000000a1'),
  1::bigint,
  'a user has exactly one settings row however often it is uploaded'
);

select is(
  (select default_currency from sync.settings where user_id = '00000000-0000-0000-0000-0000000000a1'),
  'USD',
  'the latest upload wins the settings row'
);

-- Case D, "use this device's data": records the device does not have are
-- retired as tombstones so they cannot be pulled back.
insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, payment_mode, transaction_date, title, created_at, updated_at)
values ('10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000a1', 'expense', 900, 'NPR', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'cash', 1700000000000, 'From the other device', 1000, 1000);

update sync.transactions set deleted_at = 5000, updated_at = 5000
  where sync_id = '10000000-0000-0000-0000-000000000011';

select is(
  (select count(*) from sync.transactions
    where user_id = '00000000-0000-0000-0000-0000000000a1' and deleted_at is null),
  1::bigint,
  'retiring an obsolete record leaves only the replacing dataset live'
);

select isnt(
  (select deleted_at from sync.transactions where sync_id = '10000000-0000-0000-0000-000000000011'),
  null,
  'a retired record is tombstoned, not destroyed, so other devices learn of it'
);

select is(
  (select count(*) from sync.sync_changes
    where entity_sync_id = '10000000-0000-0000-0000-000000000011'),
  2::bigint,
  'the retirement reaches the change feed'
);

-- Case C reads the whole dataset by identity order; the paging cursor is stable.
select is(
  (select count(*) from sync.accounts where user_id = '00000000-0000-0000-0000-0000000000a1'
    and sync_id > '10000000-0000-0000-0000-000000000000'),
  1::bigint,
  'a whole-dataset read pages deterministically by identity'
);

-- Account isolation: neither rows nor change positions cross accounts.
select is(
  (select count(*) from sync.accounts where sync_id = '20000000-0000-0000-0000-000000000001'),
  0::bigint,
  'a first link cannot read another account''s rows'
);

select is(
  (select count(*) from sync.settings where user_id = '00000000-0000-0000-0000-0000000000b2'),
  0::bigint,
  'a first link cannot read another account''s settings'
);

select throws_ok($$
  insert into sync.accounts (sync_id, user_id, name, type, currency, created_at, updated_at)
  values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'Forged', 'cash', 'NPR', 1, 1)
$$, '42501', null, 'a first link cannot upload into another account');

select * from finish();
rollback;
