-- M10A cloud schema for investments. Same conventions as the M7B financial
-- tables, M8A budgets and M8C recurring transactions: ownership-safe foreign keys,
-- a server revision per row, one monotonic change feed, row level security
-- forced, and no grant to anon.
--
-- Three tables and one column:
--
--   investment_assets   something a person owns; no figures of its own
--   investment_trades   buy, sell, dividend or standalone fee: the source of
--                       quantity, cost basis and gain
--   investment_prices   a manual price for one asset on one calendar day
--   transactions.investment_trade_sync_id
--                       the trade whose cash a transaction is
--
-- No holding, cost basis, gain or value is stored here or anywhere else: every
-- device replays the trades. Quantities are integers of 10^-8 of a unit and
-- money is integer minor units, both `bigint`, never `numeric` or `real`.

create table sync.investment_assets (
  sync_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  name text not null,
  symbol text,
  asset_type text not null check (asset_type in (
    'stock', 'mutual_fund', 'etf', 'bond', 'crypto', 'fixed_deposit', 'other'
  )),
  currency text not null,
  is_archived boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now(),
  server_revision bigint not null default 0,
  unique (sync_id, user_id)
);

create index investment_assets_user_revision_idx
  on sync.investment_assets (user_id, server_revision);

create table sync.investment_trades (
  sync_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  asset_sync_id uuid not null,
  -- The account the cash moved through.
  account_sync_id uuid not null,
  trade_type text not null check (trade_type in ('buy', 'sell', 'dividend', 'fee')),
  trade_date bigint not null,
  quantity_minor bigint,
  unit_price_minor bigint,
  fee_minor bigint not null default 0,
  amount_minor bigint,
  currency text not null,
  note text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now(),
  server_revision bigint not null default 0,
  unique (sync_id, user_id),
  -- A buy or sell has a quantity, a price and a fee; a dividend or standalone fee
  -- has only an amount.
  check (
    (trade_type in ('buy', 'sell')
      and quantity_minor > 0 and unit_price_minor > 0 and fee_minor >= 0
      and amount_minor is null)
    or (trade_type in ('dividend', 'fee')
      and quantity_minor is null and unit_price_minor is null and fee_minor = 0
      and amount_minor > 0)
  ),
  foreign key (asset_sync_id, user_id) references sync.investment_assets(sync_id, user_id),
  foreign key (account_sync_id, user_id) references sync.accounts(sync_id, user_id)
);

create index investment_trades_user_revision_idx
  on sync.investment_trades (user_id, server_revision);
create index investment_trades_account_idx
  on sync.investment_trades (user_id, account_sync_id);
-- Exactly the replay order the holdings guard and every client use.
create index investment_trades_replay_idx
  on sync.investment_trades (user_id, asset_sync_id, trade_date, created_at, sync_id)
  where deleted_at is null;

create table sync.investment_prices (
  sync_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  asset_sync_id uuid not null,
  price_minor bigint not null check (price_minor > 0),
  -- A calendar day, never an instant.
  price_date date not null,
  currency text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now(),
  server_revision bigint not null default 0,
  unique (sync_id, user_id),
  foreign key (asset_sync_id, user_id) references sync.investment_assets(sync_id, user_id)
);

create index investment_prices_user_revision_idx
  on sync.investment_prices (user_id, server_revision);
create index investment_prices_asset_idx
  on sync.investment_prices (user_id, asset_sync_id, price_date);

-- Investment cash names its trade. The link lives on the child, as the recurring
-- link does, so push can upload the trade first without a cycle. MATCH SIMPLE: an
-- ordinary transaction's null link is unconstrained, while a named trade must
-- belong to the same user.
alter table sync.transactions add column investment_trade_sync_id uuid;
alter table sync.transactions add constraint transactions_investment_trade_fk
  foreign key (investment_trade_sync_id, user_id)
  references sync.investment_trades(sync_id, user_id);

-- `investment` and `investment_return` exist only as a trade's cash, and a trade's
-- cash is one of those or a dividend's income. NOT VALID: no client has ever been
-- able to upload either type, so there is nothing old to re-check, and a stray
-- row must not block this migration.
alter table sync.transactions add constraint transactions_investment_link_check
  check (
    (investment_trade_sync_id is null and type not in ('investment', 'investment_return'))
    or (investment_trade_sync_id is not null
      and type in ('investment', 'investment_return', 'income')
      and recurring_occurrence_sync_id is null)
  ) not valid;

-- Cash out of one account to an investment, or back into one. Never a category or
-- a person.
alter table sync.transactions add constraint transactions_investment_shape_check
  check (
    (type <> 'investment' or (
      source_account_sync_id is not null and destination_account_sync_id is null
      and category_sync_id is null and person_sync_id is null))
    and (type <> 'investment_return' or (
      destination_account_sync_id is not null and source_account_sync_id is null
      and category_sync_id is null and person_sync_id is null))
  ) not valid;

-- One cash transaction per trade.
create unique index transactions_investment_trade_unique
  on sync.transactions (user_id, investment_trade_sync_id)
  where investment_trade_sync_id is not null;

-- The change feed has to be able to name the new tables.
alter table sync.sync_changes drop constraint if exists sync_changes_entity_type_check;
alter table sync.sync_changes add constraint sync_changes_entity_type_check
  check (entity_type in (
    'accounts', 'categories', 'people', 'settings', 'transactions', 'budgets',
    'recurring_templates', 'recurring_occurrences',
    'investment_assets', 'investment_trades', 'investment_prices'
  ));

create trigger investment_assets_record_change
  before insert or update on sync.investment_assets
  for each row execute function sync.record_change();
create trigger investment_trades_record_change
  before insert or update on sync.investment_trades
  for each row execute function sync.record_change();
create trigger investment_prices_record_change
  before insert or update on sync.investment_prices
  for each row execute function sync.record_change();

-- A trade's asset and type never change. A different asset or a different kind of
-- event is a different trade, and the holdings guard below replays one asset: a
-- trade that could move between assets would escape it.
--
-- BEFORE UPDATE triggers fire in name order, so this runs before
-- `investment_trades_record_change` and a refused change is never recorded.
create or replace function sync.guard_investment_trade_identity()
returns trigger
language plpgsql
set search_path = sync, pg_temp
as $$
begin
  if new.asset_sync_id is distinct from old.asset_sync_id
    or new.trade_type is distinct from old.trade_type then
    raise exception 'an investment trade''s asset and type are immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger investment_trades_guard_identity
  before update on sync.investment_trades
  for each row execute function sync.guard_investment_trade_identity();

-- No holding may ever be negative, at any point in its history.
--
-- Two devices can each sell 7 of the same 10 shares while offline, each valid on
-- its own. Whichever uploads second is refused here, so the cloud never holds a
-- history that sells more than it held, whatever order uploads arrive in. The
-- refused device keeps its sale, reports the upload failure, and its download of
-- the other sale is refused by the same rule on the device, so a person decides.
--
-- The check replays the asset's live trades in exactly the order every client
-- replays them: trade date, then entry time, then identity. It is a deferred
-- constraint trigger so a statement that adds a buy and the sale resting on it is
-- judged on the result, not on whichever row the statement happened to write first.
create or replace function sync.guard_investment_holdings()
returns trigger
language plpgsql
set search_path = sync, pg_temp
as $$
begin
  if exists (
    select 1
    from (
      select sum(
               case t.trade_type
                 when 'buy' then t.quantity_minor
                 when 'sell' then -t.quantity_minor
                 else 0
               end
             ) over (
               order by t.trade_date, t.created_at, t.sync_id
               rows between unbounded preceding and current row
             ) as holding
      from sync.investment_trades t
      where t.user_id = new.user_id
        and t.asset_sync_id = new.asset_sync_id
        and t.deleted_at is null
    ) replay
    where replay.holding < 0
  ) then
    raise exception 'investment holding would become negative'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger investment_trades_holdings_guard
  after insert or update on sync.investment_trades
  deferrable initially deferred
  for each row execute function sync.guard_investment_holdings();

alter table sync.investment_assets enable row level security;
alter table sync.investment_assets force row level security;
alter table sync.investment_trades enable row level security;
alter table sync.investment_trades force row level security;
alter table sync.investment_prices enable row level security;
alter table sync.investment_prices force row level security;

create policy investment_assets_owner on sync.investment_assets for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy investment_trades_owner on sync.investment_trades for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy investment_prices_owner on sync.investment_prices for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on sync.investment_assets, sync.investment_trades, sync.investment_prices
  from public, anon;
revoke all on function sync.guard_investment_trade_identity() from public, anon, authenticated;
revoke all on function sync.guard_investment_holdings() from public, anon, authenticated;
grant select, insert, update, delete
  on sync.investment_assets, sync.investment_trades, sync.investment_prices to authenticated;

-- Deliberately not enforced here: that a trade's currency matches its asset's and
-- its account's, and that a trade's cash transaction carries the amount and the
-- account the trade implies. A check constraint cannot run the subquery that would
-- need. The client refuses both on the way out and on the way in, in
-- `investment.service.ts` and `remote-domain-validation.ts`, and
-- `verifySyncIntegrity` reports a mismatch if one ever exists.
