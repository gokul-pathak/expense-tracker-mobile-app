-- Pull contract, verified against the real cloud schema.
-- Run with `supabase test db`. This suite requires the local Supabase/Postgres
-- test image and is deliberately outside the normal offline test run.
--
-- It proves the guarantees the pull engine depends on and cannot verify with an
-- in-memory stand-in: the change feed is a single monotonic server sequence,
-- every mutation appends to it, tombstones arrive through it like any other
-- change, row level security confines it to its owner, and BIGINT money survives
-- the round trip exactly.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'pull-a@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'pull-b@example.test', 'not-used', now(), '{}', '{}', now(), now());

-- User B's data exists throughout, so isolation is proven against real rows.
insert into sync.accounts (sync_id, user_id, name, type, opening_balance_minor, currency, created_at, updated_at)
values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'B cash', 'cash', 777, 'NPR', 1, 1);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

-- One device writes; the other device's pull is the reader below.
insert into sync.accounts (sync_id, user_id, name, type, opening_balance_minor, currency, is_archived, created_at, updated_at)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Cash', 'cash', 100000, 'NPR', false, 1000, 1000);

insert into sync.categories (sync_id, user_id, name, type, icon, system_key, is_default, created_at, updated_at)
values ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'Food', 'expense', 'food', 'expense_food', true, 1000, 1000);

-- Every mutation appends exactly one change, so nothing can be missed.
select is(
  (select count(*) from sync.sync_changes where user_id = '00000000-0000-0000-0000-0000000000a1'),
  2::bigint,
  'each insert appends one change for its owner'
);

select is(
  (select server_revision from sync.accounts where sync_id = '10000000-0000-0000-0000-000000000001'),
  1::bigint,
  'a new row starts at revision 1'
);

-- The cursor is a single sequence across every table, so ordering is total.
select is(
  (select count(distinct sequence) from sync.sync_changes where user_id = '00000000-0000-0000-0000-0000000000a1'),
  2::bigint,
  'change positions are unique across tables'
);

-- An incremental read after a cursor returns only newer changes.
create temporary table cursor_after_first as
  select max(sequence) as position from sync.sync_changes
  where user_id = '00000000-0000-0000-0000-0000000000a1';

update sync.accounts set name = 'Wallet', updated_at = 2000
  where sync_id = '10000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from sync.sync_changes
    where user_id = '00000000-0000-0000-0000-0000000000a1'
      and sequence > (select position from cursor_after_first)),
  1::bigint,
  'an incremental read after the cursor returns only the newer change'
);

select is(
  (select server_revision from sync.accounts where sync_id = '10000000-0000-0000-0000-000000000001'),
  2::bigint,
  'an update advances the row revision'
);

select is(
  (select name from sync.accounts where sync_id = '10000000-0000-0000-0000-000000000001'),
  'Wallet',
  'pull reads current row state, not a diff'
);

-- A transaction and its parents, so dependency-safe application has real data.
insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, payment_mode, transaction_date, title, created_at, updated_at)
values ('10000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000a1', 'expense', 9007199254740991, 'NPR', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'cash', 1700000000000, 'Lunch', 1000, 1000);

select is(
  (select amount_minor from sync.transactions where sync_id = '10000000-0000-0000-0000-000000000010'),
  9007199254740991::bigint,
  'the largest safely representable amount survives the round trip exactly'
);

-- A deletion is an ordinary change carrying deleted_at, so pull receives it.
update sync.transactions set deleted_at = 3000, updated_at = 3000
  where sync_id = '10000000-0000-0000-0000-000000000010';

select is(
  (select count(*) from sync.sync_changes
    where entity_type = 'transactions'
      and entity_sync_id = '10000000-0000-0000-0000-000000000010'),
  2::bigint,
  'a tombstone reaches the change feed like any other change'
);

select isnt(
  (select deleted_at from sync.transactions where sync_id = '10000000-0000-0000-0000-000000000010'),
  null,
  'the tombstoned row is still readable, so the deletion can be applied'
);

-- Archiving is domain state and must not look like a deletion.
update sync.accounts set is_archived = true, updated_at = 4000
  where sync_id = '10000000-0000-0000-0000-000000000001';

select is(
  (select deleted_at from sync.accounts where sync_id = '10000000-0000-0000-0000-000000000001'),
  null,
  'an archive arrives as an update, never as a tombstone'
);

-- Isolation: the client also checks ownership, but the database is the boundary.
select is(
  (select count(*) from sync.accounts where sync_id = '20000000-0000-0000-0000-000000000001'),
  0::bigint,
  'pull cannot read another user''s rows'
);

select is(
  (select count(*) from sync.sync_changes where user_id = '00000000-0000-0000-0000-0000000000b2'),
  0::bigint,
  'pull cannot read another user''s change feed'
);

-- The change feed is server-owned; a device may only read it.
select throws_ok($$
  insert into sync.sync_changes (user_id, entity_type, entity_sync_id, server_revision)
  values ('00000000-0000-0000-0000-0000000000a1', 'accounts', '10000000-0000-0000-0000-000000000001', 99)
$$, '42501', null, 'a device cannot write its own change positions');

-- A client-supplied revision is ignored: the trigger is the only writer.
update sync.accounts set server_revision = 99, updated_at = 5000
  where sync_id = '10000000-0000-0000-0000-000000000001';

select is(
  (select server_revision from sync.accounts where sync_id = '10000000-0000-0000-0000-000000000001'),
  4::bigint,
  'the trigger assigns the revision and ignores any client value'
);

select * from finish();
rollback;
