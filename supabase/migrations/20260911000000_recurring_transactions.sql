-- M8C cloud schema for recurring transactions. Same conventions as the M7B
-- financial tables and the M8A budgets: ownership-safe foreign keys, a server
-- revision per row, one monotonic change feed, row level security forced, and no
-- grant to anon.
--
-- Two tables and one column:
--
--   recurring_templates     a plan to record an expense or income on a schedule
--   recurring_occurrences   a decision about one scheduled date: generated or skipped
--   transactions.recurring_occurrence_sync_id
--                           the occurrence a generated transaction came from
--
-- A template has no financial effect. Only the generated transaction counts, and
-- it is an ordinary row in sync.transactions.

create table sync.recurring_templates (
  sync_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  -- Only the two types whose effect is one row against one account and one
  -- category. Transfers, loans and repayments are not scheduled.
  type text not null check (type in ('expense', 'income')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null,
  category_sync_id uuid not null,
  -- The source account of an expense, the destination account of an income.
  account_sync_id uuid not null,
  payment_mode text check (payment_mode is null or payment_mode in (
    'cash', 'debit_card', 'credit_card', 'bank_transfer', 'qr',
    'digital_wallet', 'cheque', 'other'
  )),
  title text not null,
  note text,
  -- Calendar dates, never instants: "the 1st" is the 1st on every device.
  start_date date not null,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  -- `interval` is a reserved word in PostgreSQL.
  interval_count integer not null check (interval_count between 1 and 999),
  -- Inclusive.
  end_date date,
  is_paused boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now(),
  server_revision bigint not null default 0,
  unique (sync_id, user_id),
  check (end_date is null or end_date >= start_date),
  foreign key (category_sync_id, user_id) references sync.categories(sync_id, user_id),
  foreign key (account_sync_id, user_id) references sync.accounts(sync_id, user_id)
);

create index recurring_templates_user_revision_idx
  on sync.recurring_templates (user_id, server_revision);
create index recurring_templates_category_idx
  on sync.recurring_templates (user_id, category_sync_id);
create index recurring_templates_account_idx
  on sync.recurring_templates (user_id, account_sync_id);

create table sync.recurring_occurrences (
  -- Not random. The client derives it as a version 5 UUID of the template's
  -- identity and the date, so two devices that handle the same date offline
  -- upload the same identity and converge on one row.
  sync_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  template_sync_id uuid not null,
  occurrence_date date not null,
  status text not null check (status in ('generated', 'skipped')),
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now(),
  server_revision bigint not null default 0,
  unique (sync_id, user_id),
  -- Defence in depth behind the deterministic identity: one row per template and
  -- date, whatever identity a faulty client might send. Not partial: a retired
  -- occurrence is revived under its own identity rather than duplicated.
  unique (user_id, template_sync_id, occurrence_date),
  foreign key (template_sync_id, user_id) references sync.recurring_templates(sync_id, user_id)
);

create index recurring_occurrences_user_revision_idx
  on sync.recurring_occurrences (user_id, server_revision);

-- The generated transaction points at its occurrence. The link lives on the
-- child so the two rows cannot disagree about each other, and push can upload
-- the occurrence first without a cycle. MATCH SIMPLE: a manually entered
-- transaction's null occurrence is unconstrained, while a named one must belong
-- to the same user.
alter table sync.transactions add column recurring_occurrence_sync_id uuid;
alter table sync.transactions add constraint transactions_recurring_occurrence_fk
  foreign key (recurring_occurrence_sync_id, user_id)
  references sync.recurring_occurrences(sync_id, user_id);
alter table sync.transactions add constraint transactions_recurring_type_check
  check (recurring_occurrence_sync_id is null or type in ('expense', 'income'));

-- One logical transaction per occurrence.
create unique index transactions_recurring_occurrence_unique
  on sync.transactions (user_id, recurring_occurrence_sync_id)
  where recurring_occurrence_sync_id is not null;

-- The change feed has to be able to name the new tables.
alter table sync.sync_changes drop constraint if exists sync_changes_entity_type_check;
alter table sync.sync_changes add constraint sync_changes_entity_type_check
  check (entity_type in (
    'accounts', 'categories', 'people', 'settings', 'transactions', 'budgets',
    'recurring_templates', 'recurring_occurrences'
  ));

create trigger recurring_templates_record_change
  before insert or update on sync.recurring_templates
  for each row execute function sync.record_change();
create trigger recurring_occurrences_record_change
  before insert or update on sync.recurring_occurrences
  for each row execute function sync.record_change();

-- Generated wins over skipped.
--
-- Two offline devices can decide the same date differently: one generates the
-- rent, the other skips it. A real transaction exists on one of them, and a
-- stale skip must not be allowed to erase the record of it, in whichever order
-- the two uploads arrive. So a generated occurrence never becomes skipped. The
-- client applies the same rule when it downloads, so both sides agree.
--
-- An occurrence's identity is derived from its template and date, so those two
-- columns can never change either: a row that did would be carrying an identity
-- that no longer describes it.
--
-- BEFORE UPDATE triggers fire in name order, so this runs before
-- `recurring_occurrences_record_change` and the change feed records the row
-- exactly as stored.
create or replace function sync.guard_recurring_occurrence()
returns trigger
language plpgsql
set search_path = sync, pg_temp
as $$
begin
  if new.template_sync_id is distinct from old.template_sync_id
    or new.occurrence_date is distinct from old.occurrence_date then
    raise exception 'recurring occurrence identity is immutable'
      using errcode = '23514';
  end if;
  if old.status = 'generated' and new.status <> 'generated' then
    new.status := 'generated';
  end if;
  return new;
end;
$$;

create trigger recurring_occurrences_guard
  before update on sync.recurring_occurrences
  for each row execute function sync.guard_recurring_occurrence();

alter table sync.recurring_templates enable row level security;
alter table sync.recurring_templates force row level security;
alter table sync.recurring_occurrences enable row level security;
alter table sync.recurring_occurrences force row level security;

create policy recurring_templates_owner on sync.recurring_templates for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy recurring_occurrences_owner on sync.recurring_occurrences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on sync.recurring_templates, sync.recurring_occurrences from public, anon;
revoke all on function sync.guard_recurring_occurrence() from public, anon, authenticated;
grant select, insert, update, delete
  on sync.recurring_templates, sync.recurring_occurrences to authenticated;

-- Deliberately not enforced here: that the category's type matches the
-- template's type, and that the account's currency matches the template's. A
-- check constraint cannot run the subquery that would need, and a trigger doing
-- it would be a second place for the rule to drift from the domain. The client
-- refuses such a template on the way out and again on the way in, in
-- `recurring.validation.ts` and `remote-domain-validation.ts`.
