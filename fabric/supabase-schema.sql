-- ============================================================
-- On Via Budget Tool — Supabase Schema
-- Kör i Supabase SQL Editor
-- ============================================================

-- Companies
create table companies (
  id                 serial primary key,
  name               text not null,
  org_number         text not null unique,
  fiscal_year_start  smallint not null default 1,
  created_at         timestamptz not null default now()
);

-- Cost centers
create table cost_centers (
  id          serial primary key,
  company_id  int not null references companies(id) on delete cascade,
  code        text not null,
  name        text not null,
  is_active   boolean not null default true,
  unique (company_id, code)
);

-- Accounts (synced from Fortnox)
create table accounts (
  id             serial primary key,
  company_id     int not null references companies(id) on delete cascade,
  account_number text not null,
  name           text not null,
  account_type   text not null check (account_type in ('income','expense','balance')),
  unique (company_id, account_number)
);

-- Account configuration (curation)
create table account_configs (
  id             serial primary key,
  account_id     int not null references accounts(id) on delete cascade unique,
  is_budgetable  boolean not null default true,
  is_calculated  boolean not null default false,
  formula        text,
  display_order  int not null default 0,
  section        text,
  notes          text
);

-- Scenarios
create table scenarios (
  id           serial primary key,
  company_id   int not null references companies(id) on delete cascade,
  name         text not null,
  year         int not null,
  is_approved  boolean not null default false,
  approved_by  text,
  approved_at  timestamptz,
  created_by   text not null,
  created_at   timestamptz not null default now()
);

-- Budget entries
create table budget_entries (
  id              bigserial primary key,
  scenario_id     int not null references scenarios(id) on delete cascade,
  account_id      int not null references accounts(id) on delete cascade,
  cost_center_id  int not null references cost_centers(id) on delete cascade,
  month           smallint not null check (month between 1 and 12),
  amount          numeric(18,2) not null default 0,
  updated_by      text not null,
  updated_at      timestamptz not null default now(),
  unique (scenario_id, account_id, cost_center_id, month)
);

-- Forecast snapshots
create table forecast_snapshots (
  id            serial primary key,
  scenario_id   int not null references scenarios(id) on delete cascade,
  name          text not null,
  snapshot_date date not null default current_date,
  created_by    text not null,
  created_at    timestamptz not null default now()
);

-- Forecast entries
create table forecast_entries (
  id              bigserial primary key,
  snapshot_id     int not null references forecast_snapshots(id) on delete cascade,
  account_id      int not null references accounts(id) on delete cascade,
  cost_center_id  int not null references cost_centers(id) on delete cascade,
  month           smallint not null check (month between 1 and 12),
  amount          numeric(18,2) not null default 0,
  unique (snapshot_id, account_id, cost_center_id, month)
);

-- User profiles
create table user_profiles (
  id           serial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade unique,
  display_name text not null,
  created_at   timestamptz not null default now()
);

-- User roles
create table user_roles (
  id              serial primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null check (role in ('admin','company_manager','cost_center_manager')),
  company_id      int references companies(id) on delete cascade,
  cost_center_id  int references cost_centers(id) on delete cascade
);

-- Budget comments
create table budget_comments (
  id              serial primary key,
  scenario_id     int not null references scenarios(id) on delete cascade,
  account_id      int not null references accounts(id) on delete cascade,
  cost_center_id  int not null references cost_centers(id) on delete cascade,
  month           smallint check (month between 1 and 12),
  comment         text not null,
  created_by      text not null,
  created_at      timestamptz not null default now()
);

-- Audit log
create table audit_log (
  id          bigserial primary key,
  table_name  text not null,
  record_id   bigint not null,
  action      text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_value   jsonb,
  new_value   jsonb,
  changed_by  text not null,
  changed_at  timestamptz not null default now()
);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table companies        enable row level security;
alter table cost_centers     enable row level security;
alter table accounts         enable row level security;
alter table account_configs  enable row level security;
alter table scenarios        enable row level security;
alter table budget_entries   enable row level security;
alter table forecast_snapshots enable row level security;
alter table forecast_entries enable row level security;
alter table user_profiles    enable row level security;
alter table user_roles       enable row level security;
alter table budget_comments  enable row level security;

-- Admin helper function
create or replace function is_admin()
returns boolean language sql security definer as $$
  select exists (
    select 1 from user_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

-- Companies: admins see all, others see their assigned companies
create policy "companies_select" on companies for select using (
  is_admin() or exists (
    select 1 from user_roles
    where user_id = auth.uid()
      and (company_id = companies.id or company_id is null)
  )
);
create policy "companies_all_admin" on companies for all using (is_admin());

-- Cost centers: same pattern
create policy "cost_centers_select" on cost_centers for select using (
  is_admin() or exists (
    select 1 from user_roles
    where user_id = auth.uid()
      and (
        (cost_center_id = cost_centers.id)
        or (company_id = cost_centers.company_id and cost_center_id is null)
      )
  )
);
create policy "cost_centers_all_admin" on cost_centers for all using (is_admin());

-- Accounts and configs: visible if user has access to the company
create policy "accounts_select" on accounts for select using (
  is_admin() or exists (
    select 1 from user_roles
    where user_id = auth.uid() and company_id = accounts.company_id
  )
);
create policy "accounts_all_admin" on accounts for all using (is_admin());

create policy "account_configs_select" on account_configs for select using (
  is_admin() or exists (
    select 1 from user_roles ur
    join accounts a on a.id = account_configs.account_id
    where ur.user_id = auth.uid() and ur.company_id = a.company_id
  )
);
create policy "account_configs_all_admin" on account_configs for all using (is_admin());

-- Scenarios
create policy "scenarios_select" on scenarios for select using (
  is_admin() or exists (
    select 1 from user_roles
    where user_id = auth.uid() and company_id = scenarios.company_id
  )
);
create policy "scenarios_all_admin" on scenarios for all using (is_admin());

-- Budget entries
create policy "budget_entries_select" on budget_entries for select using (
  is_admin() or exists (
    select 1 from user_roles ur
    join scenarios s on s.id = budget_entries.scenario_id
    where ur.user_id = auth.uid() and ur.company_id = s.company_id
  )
);
create policy "budget_entries_all_admin" on budget_entries for all using (is_admin());

-- User profiles: own row only (admins all)
create policy "user_profiles_own" on user_profiles for select using (
  user_id = auth.uid() or is_admin()
);
create policy "user_profiles_insert_own" on user_profiles for insert with check (
  user_id = auth.uid()
);

-- User roles: admins manage, users read own
create policy "user_roles_select_own" on user_roles for select using (
  user_id = auth.uid() or is_admin()
);
create policy "user_roles_all_admin" on user_roles for all using (is_admin());

-- ============================================================
-- Auto-create user profile on signup
-- ============================================================

create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into user_profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
