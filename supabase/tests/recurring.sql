-- The recurring tables' contract: isolation, ownership-safe references along
-- the whole template -> occurrence -> transaction chain, one decision per date,
-- one transaction per occurrence, and a generated date that no upload order can
-- turn back into a skipped one.
-- Run with `supabase test db`. Requires the local Supabase/Postgres test image.
--
-- A failure here is a release blocker for the same reason the other row level
-- security suites are: a gap is one user reading, or scheduling money against,
-- another user's accounts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'recurring-a@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'recurring-b@example.test', 'not-used', now(), '{}', '{}', now(), now());

insert into sync.accounts (sync_id, user_id, name, type, opening_balance_minor, currency, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Bank', 'bank', 0, 'NPR', 1, 1),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000a1', 'Cash', 'cash', 0, 'NPR', 1, 1),
  ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'Bank', 'bank', 0, 'NPR', 1, 1);

insert into sync.categories (sync_id, user_id, name, type, is_default, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'Rent', 'expense', false, 1, 1),
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2', 'Rent', 'expense', false, 1, 1);

insert into sync.recurring_templates (sync_id, user_id, type, amount_minor, currency, category_sync_id, account_sync_id, title, start_date, frequency, interval_count, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'expense', 2000000, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Rent', '2026-09-01', 'monthly', 1, 1, 1),
  ('b0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b2', 'expense', 2000000, 'NPR', 'b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'Rent', '2026-09-01', 'monthly', 1, 1, 1);

insert into sync.recurring_occurrences (sync_id, user_id, template_sync_id, occurrence_date, status, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000003', '2026-09-01', 'generated', 1, 1),
  ('b0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-000000000003', '2026-09-01', 'skipped', 1, 1);

insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at, recurring_occurrence_sync_id) values
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a1', 'expense', 2000000, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 1, 'Rent', 1, 1, 'a0000000-0000-0000-0000-000000000004');

-- Structure ------------------------------------------------------------------

select has_table('sync', 'recurring_templates', 'the recurring templates table exists');
select has_table('sync', 'recurring_occurrences', 'the recurring occurrences table exists');
select col_type_is(
  'sync', 'recurring_templates', 'amount_minor', 'bigint',
  'a template amount is an exact integer of minor units, never a floating point value'
);
select col_type_is(
  'sync', 'recurring_templates', 'start_date', 'date',
  'a schedule starts on a calendar date, not an instant'
);
select col_type_is(
  'sync', 'recurring_occurrences', 'occurrence_date', 'date',
  'an occurrence is a calendar date, not an instant'
);
select has_column('sync', 'transactions', 'recurring_occurrence_sync_id', 'a transaction can name its occurrence');
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'sync' and c.relname in ('recurring_templates', 'recurring_occurrences')
      and (c.relrowsecurity = false or c.relforcerowsecurity = false)),
  0::bigint,
  'row level security is enabled and forced on both recurring tables'
);
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'sync' and table_name in ('recurring_templates', 'recurring_occurrences')
      and grantee = 'anon'),
  0::bigint,
  'anon holds no grant on either recurring table'
);
select ok(
  not has_table_privilege('anon', 'sync.recurring_templates', 'SELECT')
    and not has_table_privilege('anon', 'sync.recurring_templates', 'INSERT')
    and not has_table_privilege('anon', 'sync.recurring_occurrences', 'SELECT')
    and not has_table_privilege('anon', 'sync.recurring_occurrences', 'INSERT'),
  'anon can neither read nor write recurring data'
);
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'sync' and table_name in ('recurring_templates', 'recurring_occurrences')
      and grantee = 'authenticated'),
  8::bigint,
  'authenticated callers may select, insert, update and delete their own recurring rows'
);
select ok(
  (select count(*) from sync.sync_changes
    where entity_type in ('recurring_templates', 'recurring_occurrences')) = 4,
  'the change feed records recurring writes, so other devices learn about them'
);

-- Constraints ----------------------------------------------------------------

select throws_ok(
  $$insert into sync.recurring_templates (sync_id, user_id, type, amount_minor, currency, category_sync_id, account_sync_id, title, start_date, frequency, interval_count, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000a1', 'transfer', 1000, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '', '2026-09-01', 'monthly', 1, 1, 1)$$,
  '23514', null,
  'a template can only be an expense or an income'
);
select throws_ok(
  $$insert into sync.recurring_templates (sync_id, user_id, type, amount_minor, currency, category_sync_id, account_sync_id, title, start_date, frequency, interval_count, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000a1', 'expense', 1000, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '', '2026-09-01', 'monthly', 0, 1, 1)$$,
  '23514', null,
  'an interval of zero is refused'
);
select throws_ok(
  $$insert into sync.recurring_templates (sync_id, user_id, type, amount_minor, currency, category_sync_id, account_sync_id, title, start_date, frequency, interval_count, end_date, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000a1', 'expense', 1000, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '', '2026-09-01', 'monthly', 1, '2026-08-31', 1, 1)$$,
  '23514', null,
  'a schedule cannot end before it starts'
);
select throws_ok(
  $$insert into sync.recurring_templates (sync_id, user_id, type, amount_minor, currency, category_sync_id, account_sync_id, title, start_date, frequency, interval_count, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a1', 'expense', 0, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '', '2026-09-01', 'monthly', 1, 1, 1)$$,
  '23514', null,
  'a template amount of zero is refused'
);
select throws_ok(
  $$insert into sync.recurring_occurrences (sync_id, user_id, template_sync_id, occurrence_date, status, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000003', '2026-09-01', 'skipped', 1, 1)$$,
  '23505', null,
  'a second decision for the same template and date is refused, whatever its identity'
);
select throws_ok(
  $$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at, recurring_occurrence_sync_id)
    values ('a0000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-0000000000a1', 'expense', 2000000, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 1, 'Rent again', 1, 1, 'a0000000-0000-0000-0000-000000000004')$$,
  '23505', null,
  'a second transaction for one occurrence is refused'
);
select throws_ok(
  $$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, source_account_sync_id, destination_account_sync_id, transaction_date, title, created_at, updated_at, recurring_occurrence_sync_id)
    values ('a0000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-0000000000a1', 'transfer', 100, 'NPR', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000006', 1, 'Transfer', 1, 1, 'a0000000-0000-0000-0000-000000000004')$$,
  '23514', null,
  'only an expense or an income can be generated'
);
select lives_ok(
  $$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-0000000000a1', 'expense', 100, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 1, 'Lunch', 1, 1),
           ('a0000000-0000-0000-0000-000000000018', '00000000-0000-0000-0000-0000000000a1', 'expense', 100, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 1, 'Tea', 1, 1)$$,
  'hand-entered transactions share a null occurrence freely'
);

-- Generated wins over skipped ---------------------------------------------------

update sync.recurring_occurrences set status = 'skipped', updated_at = 2
  where sync_id = 'a0000000-0000-0000-0000-000000000004';
select is(
  (select status from sync.recurring_occurrences where sync_id = 'a0000000-0000-0000-0000-000000000004'),
  'generated',
  'a stale skip cannot turn a generated occurrence back into a skipped one'
);
select is(
  (select updated_at from sync.recurring_occurrences where sync_id = 'a0000000-0000-0000-0000-000000000004'),
  2::bigint,
  'the rest of the upload still lands; only the downgrade is refused'
);
update sync.recurring_occurrences set status = 'generated'
  where sync_id = 'b0000000-0000-0000-0000-000000000004';
select is(
  (select status from sync.recurring_occurrences where sync_id = 'b0000000-0000-0000-0000-000000000004'),
  'generated',
  'a skipped occurrence can still become generated'
);
select throws_ok(
  $$update sync.recurring_occurrences set occurrence_date = '2026-10-01'
      where sync_id = 'a0000000-0000-0000-0000-000000000004'$$,
  '23514', null,
  'an occurrence cannot move to another date: its identity is derived from that date'
);
select lives_ok(
  $$update sync.recurring_occurrences set deleted_at = 3
      where sync_id = 'a0000000-0000-0000-0000-000000000004'$$,
  'a generated occurrence can still be retired as a tombstone'
);
select is(
  (select status from sync.recurring_occurrences where sync_id = 'a0000000-0000-0000-0000-000000000004'),
  'generated',
  'and retiring it does not change what it was'
);

-- Isolation ------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-0000-0000-0000000000a1", "role": "authenticated"}';

select is(
  (select count(*) from sync.recurring_templates where user_id = '00000000-0000-0000-0000-0000000000b2'),
  0::bigint,
  'a user cannot read another user''s templates'
);
select is(
  (select count(*) from sync.recurring_occurrences where user_id = '00000000-0000-0000-0000-0000000000b2'),
  0::bigint,
  'a user cannot read another user''s occurrences'
);
select is(
  (select count(*) from sync.recurring_templates),
  1::bigint,
  'a user reads exactly their own templates'
);
select throws_ok(
  $$insert into sync.recurring_templates (sync_id, user_id, type, amount_minor, currency, category_sync_id, account_sync_id, title, start_date, frequency, interval_count, created_at, updated_at)
    values ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'expense', 1000, 'NPR', 'b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', '', '2026-09-01', 'monthly', 1, 1, 1)$$,
  '42501', null,
  'a user cannot insert a template owned by someone else'
);
select throws_ok(
  $$insert into sync.recurring_occurrences (sync_id, user_id, template_sync_id, occurrence_date, status, created_at, updated_at)
    values ('c0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-000000000003', '2026-10-01', 'skipped', 1, 1)$$,
  '42501', null,
  'a user cannot insert an occurrence owned by someone else'
);
select is(
  (select count(*) from (
    update sync.recurring_templates set amount_minor = 1
      where sync_id = 'b0000000-0000-0000-0000-000000000003' returning 1
  ) as updated),
  0::bigint,
  'a user cannot update another user''s template: the row is not visible to them'
);
select is(
  (select count(*) from (
    delete from sync.recurring_occurrences where sync_id = 'b0000000-0000-0000-0000-000000000004' returning 1
  ) as removed),
  0::bigint,
  'a user cannot delete another user''s occurrence'
);
select throws_ok(
  $$insert into sync.recurring_templates (sync_id, user_id, type, amount_minor, currency, category_sync_id, account_sync_id, title, start_date, frequency, interval_count, created_at, updated_at)
    values ('c0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'expense', 1000, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', '', '2026-09-01', 'monthly', 1, 1, 1)$$,
  '23503', null,
  'a template cannot schedule money against another user''s account'
);
select throws_ok(
  $$insert into sync.recurring_templates (sync_id, user_id, type, amount_minor, currency, category_sync_id, account_sync_id, title, start_date, frequency, interval_count, created_at, updated_at)
    values ('c0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', 'expense', 1000, 'NPR', 'b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '', '2026-09-01', 'monthly', 1, 1, 1)$$,
  '23503', null,
  'a template cannot use another user''s category'
);
select throws_ok(
  $$insert into sync.recurring_occurrences (sync_id, user_id, template_sync_id, occurrence_date, status, created_at, updated_at)
    values ('c0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-000000000003', '2026-10-01', 'skipped', 1, 1)$$,
  '23503', null,
  'an occurrence cannot belong to another user''s template'
);
select throws_ok(
  $$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at, recurring_occurrence_sync_id)
    values ('c0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000a1', 'expense', 1000, 'NPR', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 1, 'Forged', 1, 1, 'b0000000-0000-0000-0000-000000000004')$$,
  '23503', null,
  'a transaction cannot claim another user''s occurrence'
);
select lives_ok(
  $$update sync.recurring_templates set is_paused = true
      where sync_id = 'a0000000-0000-0000-0000-000000000003'$$,
  'a user can pause their own template'
);

select * from finish();
rollback;
