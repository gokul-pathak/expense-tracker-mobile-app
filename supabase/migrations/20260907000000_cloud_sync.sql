-- M7B cloud schema. The mobile app does not yet read or write these financial tables.

create schema if not exists sync;
revoke all on schema sync from public;
grant usage on schema sync to authenticated;

create table sync.accounts (
  sync_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  name text not null,
  type text not null check (type in ('cash', 'bank', 'wallet', 'credit_card', 'other')),
  opening_balance_minor bigint not null default 0,
  currency text not null,
  icon text,
  is_archived boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now(),
  server_revision bigint not null default 0,
  unique (sync_id, user_id)
);

create table sync.categories (
  sync_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  name text not null,
  type text not null check (type in ('income', 'expense')),
  icon text,
  system_key text,
  is_default boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now(),
  server_revision bigint not null default 0,
  unique (sync_id, user_id)
);
create unique index categories_user_system_key_unique
  on sync.categories (user_id, system_key) where system_key is not null;

create table sync.people (
  sync_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  name text not null,
  note text,
  is_archived boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now(),
  server_revision bigint not null default 0,
  unique (sync_id, user_id)
);

create table sync.settings (
  sync_id uuid primary key,
  user_id uuid not null unique references auth.users(id) on delete restrict,
  default_currency text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now(),
  server_revision bigint not null default 0,
  unique (sync_id, user_id)
);

create table sync.transactions (
  sync_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  type text not null check (type in (
    'income', 'expense', 'transfer', 'lend', 'borrow',
    'repayment_received', 'repayment_paid', 'investment', 'investment_return'
  )),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null,
  category_sync_id uuid,
  source_account_sync_id uuid,
  destination_account_sync_id uuid,
  person_sync_id uuid,
  payment_mode text check (payment_mode is null or payment_mode in (
    'cash', 'debit_card', 'credit_card', 'bank_transfer', 'qr',
    'digital_wallet', 'cheque', 'other'
  )),
  transaction_date bigint not null,
  title text not null,
  note text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now(),
  server_revision bigint not null default 0,
  unique (sync_id, user_id),
  foreign key (category_sync_id, user_id) references sync.categories(sync_id, user_id),
  foreign key (source_account_sync_id, user_id) references sync.accounts(sync_id, user_id),
  foreign key (destination_account_sync_id, user_id) references sync.accounts(sync_id, user_id),
  foreign key (person_sync_id, user_id) references sync.people(sync_id, user_id),
  check (
    source_account_sync_id is null or destination_account_sync_id is null
    or source_account_sync_id <> destination_account_sync_id
  ),
  check (
    type not in ('expense', 'income', 'transfer', 'lend', 'borrow', 'repayment_received', 'repayment_paid')
    or (type = 'expense' and source_account_sync_id is not null and destination_account_sync_id is null and category_sync_id is not null and person_sync_id is null)
    or (type = 'income' and destination_account_sync_id is not null and source_account_sync_id is null and category_sync_id is not null and person_sync_id is null)
    or (type = 'transfer' and source_account_sync_id is not null and destination_account_sync_id is not null and category_sync_id is null and person_sync_id is null)
    or (type = 'lend' and source_account_sync_id is not null and destination_account_sync_id is null and person_sync_id is not null and category_sync_id is null)
    or (type = 'borrow' and destination_account_sync_id is not null and source_account_sync_id is null and person_sync_id is not null and category_sync_id is null)
    or (type = 'repayment_received' and destination_account_sync_id is not null and source_account_sync_id is null and person_sync_id is not null and category_sync_id is null)
    or (type = 'repayment_paid' and source_account_sync_id is not null and destination_account_sync_id is null and person_sync_id is not null and category_sync_id is null)
  )
);

-- A monotonic server sequence makes a pull cursor unambiguous; clients never write this table.
create sequence sync.change_sequence;
create table sync.sync_changes (
  sequence bigint primary key default nextval('sync.change_sequence'),
  user_id uuid not null references auth.users(id) on delete restrict,
  entity_type text not null check (entity_type in ('accounts', 'categories', 'people', 'settings', 'transactions')),
  entity_sync_id uuid not null,
  server_revision bigint not null,
  changed_at timestamptz not null default now()
);

create index accounts_user_revision_idx on sync.accounts (user_id, server_revision);
create index categories_user_revision_idx on sync.categories (user_id, server_revision);
create index people_user_revision_idx on sync.people (user_id, server_revision);
create index settings_user_revision_idx on sync.settings (user_id, server_revision);
create index transactions_user_revision_idx on sync.transactions (user_id, server_revision);
create index transactions_category_idx on sync.transactions (user_id, category_sync_id);
create index transactions_source_account_idx on sync.transactions (user_id, source_account_sync_id);
create index transactions_destination_account_idx on sync.transactions (user_id, destination_account_sync_id);
create index transactions_person_idx on sync.transactions (user_id, person_sync_id);
create index sync_changes_user_sequence_idx on sync.sync_changes (user_id, sequence);

create or replace function sync.record_change()
returns trigger
language plpgsql
security definer
set search_path = sync, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.server_revision := 1;
  else
    new.server_revision := old.server_revision + 1;
  end if;
  new.server_updated_at := now();
  insert into sync.sync_changes (user_id, entity_type, entity_sync_id, server_revision)
  values (new.user_id, tg_table_name, new.sync_id, new.server_revision);
  return new;
end;
$$;

create trigger accounts_record_change before insert or update on sync.accounts
  for each row execute function sync.record_change();
create trigger categories_record_change before insert or update on sync.categories
  for each row execute function sync.record_change();
create trigger people_record_change before insert or update on sync.people
  for each row execute function sync.record_change();
create trigger settings_record_change before insert or update on sync.settings
  for each row execute function sync.record_change();
create trigger transactions_record_change before insert or update on sync.transactions
  for each row execute function sync.record_change();

alter table sync.accounts enable row level security;
alter table sync.categories enable row level security;
alter table sync.people enable row level security;
alter table sync.settings enable row level security;
alter table sync.transactions enable row level security;
alter table sync.sync_changes enable row level security;
alter table sync.accounts force row level security;
alter table sync.categories force row level security;
alter table sync.people force row level security;
alter table sync.settings force row level security;
alter table sync.transactions force row level security;
alter table sync.sync_changes force row level security;

create policy accounts_owner on sync.accounts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy categories_owner on sync.categories for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy people_owner on sync.people for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy settings_owner on sync.settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy transactions_owner on sync.transactions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sync_changes_owner_read on sync.sync_changes for select to authenticated using (user_id = auth.uid());

revoke all on all tables in schema sync from anon;
revoke all on all sequences in schema sync from public, anon, authenticated;
revoke all on function sync.record_change() from public, anon, authenticated;
grant select, insert, update, delete on sync.accounts, sync.categories, sync.people, sync.settings, sync.transactions to authenticated;
grant select on sync.sync_changes to authenticated;
