-- M8A cloud schema for budgets. Same conventions as the M7B financial tables:
-- ownership-safe foreign keys, a server revision per row, one monotonic change
-- feed, row level security forced, and no grant to anon.

create table sync.budgets (
  sync_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  -- Null is the overall monthly budget. The composite foreign key is MATCH
  -- SIMPLE, so a null category is simply unconstrained, while a category that is
  -- named must belong to the same user: one account's budget can never point at
  -- another account's category.
  category_sync_id uuid,
  -- A month is calendar text, never an instant. A timestamp would make two
  -- devices in different time zones disagree about which month a plan is for.
  period_month text not null check (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now(),
  server_revision bigint not null default 0,
  unique (sync_id, user_id),
  foreign key (category_sync_id, user_id) references sync.categories(sync_id, user_id)
);

-- One live plan per user, month, currency and category.
--
-- An ordinary unique constraint would not do it: in PostgreSQL every null is
-- distinct from every other null, so the overall budget's null category would
-- let a user accumulate any number of overall budgets for one month. Collapsing
-- null onto the nil UUID makes those collide with each other. The nil UUID
-- cannot be a real identity, because every sync ID this app issues is a version
-- 4 UUID.
--
-- The index is partial so a tombstoned budget stops occupying its month: a plan
-- can be deleted and a new one created for the same month afterwards.
create unique index budgets_logical_unique on sync.budgets (
  user_id,
  period_month,
  currency,
  coalesce(category_sync_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where deleted_at is null;

create index budgets_user_revision_idx on sync.budgets (user_id, server_revision);
create index budgets_category_idx on sync.budgets (user_id, category_sync_id);
create index budgets_period_idx on sync.budgets (user_id, period_month);

-- The change feed has to be able to name the new table.
alter table sync.sync_changes drop constraint if exists sync_changes_entity_type_check;
alter table sync.sync_changes add constraint sync_changes_entity_type_check
  check (entity_type in ('accounts', 'categories', 'people', 'settings', 'transactions', 'budgets'));

create trigger budgets_record_change before insert or update on sync.budgets
  for each row execute function sync.record_change();

alter table sync.budgets enable row level security;
alter table sync.budgets force row level security;

create policy budgets_owner on sync.budgets for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on sync.budgets from public, anon;
grant select, insert, update, delete on sync.budgets to authenticated;

-- Deliberately not enforced here: that the referenced category is an *expense*
-- category. A check constraint cannot run the subquery that would need, and a
-- trigger doing it would be a second place for the rule to drift from the
-- domain. The client refuses such a budget on the way out and again on the way
-- in, in `budget.validation.ts` and `remote-domain-validation.ts`.
