-- The investment tables' contract: isolation, ownership-safe references from a
-- trade to its asset and account and from cash to its trade, the shape of each
-- trade type, one cash transaction per trade, an immutable asset and type, and a
-- holdings guard that no upload order can get past.
-- Run with `supabase test db`. Requires the local Supabase/Postgres test image.
--
-- A failure here is a release blocker: a gap is either one user reading or
-- trading against another user's records, or a portfolio that sells more than
-- it ever held.
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'investments-a@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'investments-b@example.test', 'not-used', now(), '{}', '{}', now(), now());

insert into sync.accounts (sync_id, user_id, name, type, opening_balance_minor, currency, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000a1', 'Bank', 'bank', 10000000, 'NPR', 1, 1),
  ('b0000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000b2', 'Bank', 'bank', 10000000, 'NPR', 1, 1);

insert into sync.categories (sync_id, user_id, name, type, system_key, is_default, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-0000000000a1', 'Investment Return', 'income', 'income_investment_return', true, 1, 1);

insert into sync.investment_assets (sync_id, user_id, name, asset_type, currency, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000a1', 'ABC Shares', 'stock', 'NPR', 1, 1),
  ('a0000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-0000000000a1', 'DEF Fund', 'mutual_fund', 'NPR', 1, 1),
  ('b0000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000b2', 'XYZ Shares', 'stock', 'NPR', 1, 1);

-- A and B each hold 10 units bought on day 1. A also has a dividend.
insert into sync.investment_trades (sync_id, user_id, asset_sync_id, account_sync_id, trade_type, trade_date, quantity_minor, unit_price_minor, fee_minor, amount_minor, currency, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000102', 'a0000000-0000-0000-0000-000000000101', 'buy', 86400000, 1000000000, 100000, 10000, null, 'NPR', 1, 1),
  ('a0000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000102', 'a0000000-0000-0000-0000-000000000101', 'dividend', 172800000, null, null, 0, 50000, 'NPR', 1, 1),
  ('b0000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-000000000102', 'b0000000-0000-0000-0000-000000000101', 'buy', 86400000, 1000000000, 100000, 0, null, 'NPR', 1, 1);

insert into sync.investment_prices (sync_id, user_id, asset_sync_id, price_minor, price_date, currency, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000102', 120000, '2026-09-10', 'NPR', 1, 1),
  ('b0000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-000000000102', 90000, '2026-09-10', 'NPR', 1, 1);

insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, source_account_sync_id, transaction_date, title, created_at, updated_at, investment_trade_sync_id) values
  ('a0000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-0000000000a1', 'investment', 1010000, 'NPR', 'a0000000-0000-0000-0000-000000000101', 86400000, 'Investment Purchase', 1, 1, 'a0000000-0000-0000-0000-000000000103');

-- Structure ------------------------------------------------------------------

select has_table('sync', 'investment_assets', 'the investment assets table exists');
select has_table('sync', 'investment_trades', 'the investment trades table exists');
select has_table('sync', 'investment_prices', 'the investment prices table exists');
select col_type_is(
  'sync', 'investment_trades', 'quantity_minor', 'bigint',
  'a quantity is an exact integer of 10^-8 units, never a floating point value'
);
select col_type_is(
  'sync', 'investment_trades', 'unit_price_minor', 'bigint',
  'a unit price is an exact integer of minor units'
);
select col_type_is(
  'sync', 'investment_prices', 'price_date', 'date',
  'a manual price is for a calendar date, not an instant'
);
select has_column('sync', 'transactions', 'investment_trade_sync_id', 'cash can name the trade it belongs to');
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'sync'
      and c.relname in ('investment_assets', 'investment_trades', 'investment_prices')
      and (c.relrowsecurity = false or c.relforcerowsecurity = false)),
  0::bigint,
  'row level security is enabled and forced on every investment table'
);
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'sync'
      and table_name in ('investment_assets', 'investment_trades', 'investment_prices')
      and grantee = 'anon'),
  0::bigint,
  'anon holds no grant on any investment table'
);
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'sync'
      and table_name in ('investment_assets', 'investment_trades', 'investment_prices')
      and grantee = 'authenticated'),
  12::bigint,
  'authenticated callers may select, insert, update and delete their own investment rows'
);
select ok(
  (select count(*) from sync.sync_changes
    where entity_type in ('investment_assets', 'investment_trades', 'investment_prices')) = 8,
  'the change feed records investment writes, so other devices learn about them'
);

-- Shape ----------------------------------------------------------------------

select throws_ok(
  $$insert into sync.investment_trades (sync_id, user_id, asset_sync_id, account_sync_id, trade_type, trade_date, quantity_minor, unit_price_minor, currency, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000102', 'a0000000-0000-0000-0000-000000000101', 'buy', 86400000, null, 100000, 'NPR', 1, 1)$$,
  '23514', null,
  'a buy without a quantity is refused'
);
select throws_ok(
  $$insert into sync.investment_trades (sync_id, user_id, asset_sync_id, account_sync_id, trade_type, trade_date, quantity_minor, unit_price_minor, currency, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000102', 'a0000000-0000-0000-0000-000000000101', 'buy', 86400000, -100, 100000, 'NPR', 1, 1)$$,
  '23514', null,
  'a negative quantity is refused'
);
select throws_ok(
  $$insert into sync.investment_trades (sync_id, user_id, asset_sync_id, account_sync_id, trade_type, trade_date, quantity_minor, amount_minor, currency, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000102', 'a0000000-0000-0000-0000-000000000101', 'dividend', 86400000, 100, 500, 'NPR', 1, 1)$$,
  '23514', null,
  'a dividend with a quantity is refused'
);
select throws_ok(
  $$insert into sync.investment_trades (sync_id, user_id, asset_sync_id, account_sync_id, trade_type, trade_date, quantity_minor, unit_price_minor, currency, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000113', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000102', 'a0000000-0000-0000-0000-000000000101', 'short', 86400000, 100, 100, 'NPR', 1, 1)$$,
  '23514', null,
  'there is no trade type for shorting'
);
select throws_ok(
  $$insert into sync.investment_prices (sync_id, user_id, asset_sync_id, price_minor, price_date, currency, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000114', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000102', 0, '2026-09-11', 'NPR', 1, 1)$$,
  '23514', null,
  'a price of zero is refused'
);
select throws_ok(
  $$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, source_account_sync_id, transaction_date, title, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000115', '00000000-0000-0000-0000-0000000000a1', 'investment', 100, 'NPR', 'a0000000-0000-0000-0000-000000000101', 1, 'Unexplained', 1, 1)$$,
  '23514', null,
  'investment cash that names no trade is refused'
);
select throws_ok(
  $$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, source_account_sync_id, transaction_date, title, created_at, updated_at, investment_trade_sync_id)
    values ('a0000000-0000-0000-0000-000000000116', '00000000-0000-0000-0000-0000000000a1', 'investment', 1010000, 'NPR', 'a0000000-0000-0000-0000-000000000101', 86400000, 'Again', 1, 1, 'a0000000-0000-0000-0000-000000000103')$$,
  '23505', null,
  'a second cash transaction for one trade is refused'
);
select throws_ok(
  $$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, source_account_sync_id, transaction_date, title, created_at, updated_at, investment_trade_sync_id)
    values ('a0000000-0000-0000-0000-000000000117', '00000000-0000-0000-0000-0000000000a1', 'investment', 500, 'NPR', 'a0000000-0000-0000-0000-000000000108', 'a0000000-0000-0000-0000-000000000101', 172800000, 'Mislabelled', 1, 1, 'a0000000-0000-0000-0000-000000000106')$$,
  '23514', null,
  'investment cash never carries a category'
);
select lives_ok(
  $$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, category_sync_id, destination_account_sync_id, transaction_date, title, created_at, updated_at, investment_trade_sync_id)
    values ('a0000000-0000-0000-0000-000000000118', '00000000-0000-0000-0000-0000000000a1', 'income', 50000, 'NPR', 'a0000000-0000-0000-0000-000000000108', 'a0000000-0000-0000-0000-000000000101', 172800000, 'Dividend', 1, 1, 'a0000000-0000-0000-0000-000000000106')$$,
  'a dividend is Investment Return income linked to its trade'
);
select throws_ok(
  $$update sync.investment_trades set asset_sync_id = 'a0000000-0000-0000-0000-000000000109'
      where sync_id = 'a0000000-0000-0000-0000-000000000103'$$,
  '23514', null,
  'a trade cannot move to another asset'
);
select throws_ok(
  $$update sync.investment_trades set trade_type = 'sell'
      where sync_id = 'a0000000-0000-0000-0000-000000000103'$$,
  '23514', null,
  'a buy cannot become a sell'
);

-- Holdings -------------------------------------------------------------------
-- The guard is deferred to commit, and this suite rolls back, so constraints are
-- checked at the end of each statement from here on.
set constraints all immediate;

select throws_ok(
  $$insert into sync.investment_trades (sync_id, user_id, asset_sync_id, account_sync_id, trade_type, trade_date, quantity_minor, unit_price_minor, fee_minor, currency, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000102', 'a0000000-0000-0000-0000-000000000101', 'sell', 259200000, 1100000000, 120000, 0, 'NPR', 2, 2)$$,
  '23514', null,
  'selling 11 of 10 units is refused'
);
select throws_ok(
  $$insert into sync.investment_trades (sync_id, user_id, asset_sync_id, account_sync_id, trade_type, trade_date, quantity_minor, unit_price_minor, fee_minor, currency, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000121', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000102', 'a0000000-0000-0000-0000-000000000101', 'sell', 43200000, 100000000, 120000, 0, 'NPR', 2, 2)$$,
  '23514', null,
  'selling before the units were bought is refused'
);
select lives_ok(
  $$insert into sync.investment_trades (sync_id, user_id, asset_sync_id, account_sync_id, trade_type, trade_date, quantity_minor, unit_price_minor, fee_minor, currency, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000122', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000102', 'a0000000-0000-0000-0000-000000000101', 'sell', 259200000, 700000000, 120000, 0, 'NPR', 2, 2)$$,
  'one device selling 7 of the 10 units is accepted'
);
select throws_ok(
  $$insert into sync.investment_trades (sync_id, user_id, asset_sync_id, account_sync_id, trade_type, trade_date, quantity_minor, unit_price_minor, fee_minor, currency, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000123', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000102', 'a0000000-0000-0000-0000-000000000101', 'sell', 345600000, 700000000, 125000, 0, 'NPR', 3, 3)$$,
  '23514', null,
  'a second device selling the same 7 units is refused'
);
select throws_ok(
  $$insert into sync.investment_trades (sync_id, user_id, asset_sync_id, account_sync_id, trade_type, trade_date, quantity_minor, unit_price_minor, fee_minor, currency, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000124', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000102', 'a0000000-0000-0000-0000-000000000101', 'sell', 172800000, 700000000, 125000, 0, 'NPR', 3, 3)$$,
  '23514', null,
  'the same second sale is refused even when it sorts before the first'
);
select throws_ok(
  $$update sync.investment_trades set deleted_at = 5
      where sync_id = 'a0000000-0000-0000-0000-000000000103'$$,
  '23514', null,
  'deleting the buy a later sale rests on is refused'
);
select throws_ok(
  $$update sync.investment_trades set quantity_minor = 500000000
      where sync_id = 'a0000000-0000-0000-0000-000000000103'$$,
  '23514', null,
  'shrinking the buy below a later sale is refused'
);
select lives_ok(
  $$insert into sync.investment_trades (sync_id, user_id, asset_sync_id, account_sync_id, trade_type, trade_date, quantity_minor, unit_price_minor, fee_minor, currency, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000126', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000109', 'a0000000-0000-0000-0000-000000000101', 'sell', 259200000, 500000000, 110000, 0, 'NPR', 4, 4),
           ('a0000000-0000-0000-0000-000000000125', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000109', 'a0000000-0000-0000-0000-000000000101', 'buy', 86400000, 500000000, 100000, 0, 'NPR', 4, 4)$$,
  'a statement is judged on its result: a sale written before its buy in one statement is accepted'
);
select lives_ok(
  $$update sync.investment_trades set deleted_at = 6
      where sync_id = 'a0000000-0000-0000-0000-000000000122'$$,
  'deleting a sale never undermines anything'
);
select lives_ok(
  $$update sync.investment_trades set deleted_at = 7
      where sync_id = 'a0000000-0000-0000-0000-000000000103'$$,
  'the buy may go once no sale rests on it'
);

-- Isolation --------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-0000-0000-0000000000a1", "role": "authenticated"}';

select is(
  (select count(*) from sync.investment_assets where user_id <> '00000000-0000-0000-0000-0000000000a1'),
  0::bigint,
  'a user sees none of another user''s assets'
);
select is(
  (select count(*) from sync.investment_trades where user_id <> '00000000-0000-0000-0000-0000000000a1'),
  0::bigint,
  'a user sees none of another user''s trades'
);
select is(
  (select count(*) from sync.investment_prices where user_id <> '00000000-0000-0000-0000-0000000000a1'),
  0::bigint,
  'a user sees none of another user''s prices'
);
select ok(
  (select count(*) from sync.investment_assets) = 2,
  'a user sees their own assets'
);
select is(
  (select count(*) from (
    update sync.investment_trades set note = 'forged'
      where sync_id = 'b0000000-0000-0000-0000-000000000103' returning 1
  ) as changed),
  0::bigint,
  'a user cannot change another user''s trade'
);
select is(
  (select count(*) from (
    delete from sync.investment_prices where sync_id = 'b0000000-0000-0000-0000-000000000104' returning 1
  ) as removed),
  0::bigint,
  'a user cannot delete another user''s price'
);
select throws_ok(
  $$insert into sync.investment_assets (sync_id, user_id, name, asset_type, currency, created_at, updated_at)
    values ('c0000000-0000-0000-0000-000000000130', '00000000-0000-0000-0000-0000000000b2', 'Forged', 'stock', 'NPR', 1, 1)$$,
  '42501', null,
  'a user cannot create an asset owned by another user'
);
select throws_ok(
  $$insert into sync.investment_trades (sync_id, user_id, asset_sync_id, account_sync_id, trade_type, trade_date, amount_minor, currency, created_at, updated_at)
    values ('c0000000-0000-0000-0000-000000000131', '00000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-000000000102', 'a0000000-0000-0000-0000-000000000101', 'dividend', 1, 100, 'NPR', 1, 1)$$,
  '23503', null,
  'a trade cannot reference another user''s asset'
);
select throws_ok(
  $$insert into sync.investment_trades (sync_id, user_id, asset_sync_id, account_sync_id, trade_type, trade_date, amount_minor, currency, created_at, updated_at)
    values ('c0000000-0000-0000-0000-000000000132', '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000102', 'b0000000-0000-0000-0000-000000000101', 'dividend', 1, 100, 'NPR', 1, 1)$$,
  '23503', null,
  'a trade cannot move cash through another user''s account'
);
select throws_ok(
  $$insert into sync.investment_prices (sync_id, user_id, asset_sync_id, price_minor, price_date, currency, created_at, updated_at)
    values ('c0000000-0000-0000-0000-000000000133', '00000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-000000000102', 100, '2026-09-12', 'NPR', 1, 1)$$,
  '23503', null,
  'a price cannot belong to another user''s asset'
);
select throws_ok(
  $$insert into sync.transactions (sync_id, user_id, type, amount_minor, currency, source_account_sync_id, transaction_date, title, created_at, updated_at, investment_trade_sync_id)
    values ('c0000000-0000-0000-0000-000000000134', '00000000-0000-0000-0000-0000000000a1', 'investment', 100, 'NPR', 'a0000000-0000-0000-0000-000000000101', 1, 'Forged', 1, 1, 'b0000000-0000-0000-0000-000000000103')$$,
  '23503', null,
  'cash cannot claim another user''s trade'
);

-- Anonymous callers ------------------------------------------------------------

reset role;
set local role anon;

select throws_ok(
  'select * from sync.investment_assets',
  '42501', null,
  'anon cannot read assets'
);
select throws_ok(
  'select * from sync.investment_trades',
  '42501', null,
  'anon cannot read trades'
);
select throws_ok(
  'select * from sync.investment_prices',
  '42501', null,
  'anon cannot read prices'
);
select throws_ok(
  $$insert into sync.investment_assets (sync_id, user_id, name, asset_type, currency, created_at, updated_at)
    values ('d0000000-0000-0000-0000-000000000140', '00000000-0000-0000-0000-0000000000a1', 'Anon', 'stock', 'NPR', 1, 1)$$,
  '42501', null,
  'anon cannot write an asset'
);

select * from finish();
rollback;
