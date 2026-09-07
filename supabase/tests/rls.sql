-- Run with `supabase test db`. This suite requires the local Supabase/Postgres test image.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'a@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'b@example.test', 'not-used', now(), '{}', '{}', now(), now());

insert into sync.accounts (sync_id, user_id, name, type, currency, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'A cash', 'cash', 'NPR', 1, 1),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2', 'B cash', 'cash', 'NPR', 1, 1);
insert into sync.categories (sync_id, user_id, name, type, system_key, is_default, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'Food', 'expense', 'expense_food', true, 1, 1),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b2', 'Food', 'expense', 'expense_food', true, 1, 1);
insert into sync.people (sync_id, user_id, name, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a1', 'A person', 1, 1),
  ('20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000b2', 'B person', 1, 1);
insert into sync.settings (sync_id, user_id, default_currency, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000a1', 'NPR', 1, 1),
  ('20000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000b2', 'NPR', 1, 1);
insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at)
values ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000a1', 'expense', 100, 'NPR', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 1, 'Lunch', 1, 1);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select is((select count(*) from sync.accounts), 1::bigint, 'A reads only A accounts');
select is((select count(*) from sync.categories), 1::bigint, 'A reads only A categories');
select is((select count(*) from sync.people), 1::bigint, 'A reads only A people');
select is((select count(*) from sync.settings), 1::bigint, 'A reads only A settings');
select is((select count(*) from sync.transactions), 1::bigint, 'A reads only A transactions');
select lives_ok($$insert into sync.accounts (sync_id, user_id, name, type, currency, created_at, updated_at) values ('10000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000a1', 'A bank', 'bank', 'NPR', 1, 1)$$, 'A inserts own account');
select throws_ok($$insert into sync.accounts (sync_id, user_id, name, type, currency, created_at, updated_at) values ('20000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000b2', 'B bank', 'bank', 'NPR', 1, 1)$$, '42501', null, 'A cannot insert as B');
update sync.accounts set name = 'stolen' where sync_id = '20000000-0000-0000-0000-000000000002';
select is((select name from sync.accounts where sync_id = '20000000-0000-0000-0000-000000000002'), null, 'A cannot update B');
select throws_ok($$update sync.accounts set user_id = '00000000-0000-0000-0000-0000000000b2' where sync_id = '10000000-0000-0000-0000-000000000001'$$, '42501', null, 'A cannot change owner');
delete from sync.accounts where sync_id = '20000000-0000-0000-0000-000000000002';
select is((select count(*) from sync.accounts), 2::bigint, 'A cannot delete B');
select throws_ok($$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at) values ('10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000a1', 'expense', 1, 'NPR', '20000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', 1, 'bad', 1, 1)$$, null, null, 'cross-owner transaction is rejected');
select throws_ok($$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at) values ('10000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000a1', 'expense', 0, 'NPR', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 1, 'bad', 1, 1)$$, null, null, 'non-positive amount is rejected');
select throws_ok($$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, source_account_sync_id, destination_account_sync_id, transaction_date, title, created_at, updated_at) values ('10000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a1', 'transfer', 1, 'NPR', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1, 'bad', 1, 1)$$, null, null, 'same-account transfer is rejected');
select throws_ok($$insert into sync.categories (sync_id, user_id, name, type, system_key, is_default, created_at, updated_at) values ('10000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-0000000000a1', 'Food 2', 'expense', 'expense_food', true, 1, 1)$$, null, null, 'duplicate built-in category is rejected');
select throws_ok($$insert into sync.settings (sync_id, user_id, default_currency, created_at, updated_at) values ('10000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-0000000000a1', 'USD', 1, 1)$$, null, null, 'duplicate settings are rejected');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is_empty('select * from sync.accounts', 'anon cannot read accounts');
select is_empty('select * from sync.categories', 'anon cannot read categories');
select is_empty('select * from sync.people', 'anon cannot read people');
select is_empty('select * from sync.settings', 'anon cannot read settings');
select is_empty('select * from sync.transactions', 'anon cannot read transactions');
select throws_ok($$insert into sync.accounts (sync_id, user_id, name, type, currency, created_at, updated_at) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'bad', 'cash', 'NPR', 1, 1)$$, '42501', null, 'anon cannot create accounts');
select * from finish();
rollback;
