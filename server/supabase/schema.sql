-- Apply in the Supabase SQL editor. All IDs are UUIDs in the hosted database.
create extension if not exists pgcrypto;
create table if not exists pods (
  id uuid primary key default gen_random_uuid(), name text not null unique,
  lead_employee_id uuid, created_at timestamptz not null default now()
);
create table if not exists employees (
  id uuid primary key default gen_random_uuid(), employee_code text not null unique,
  name text not null, email text not null unique, pod_id uuid references pods(id),
  role text not null default 'Operations Associate', active boolean not null default true,
  weekly_offs smallint[] not null default '{0,6}', preferred_offs smallint[] not null default '{}', created_at timestamptz not null default now(),
  check (weekly_offs <@ array[0,1,2,3,4,5,6]::smallint[]), check (preferred_offs <@ array[0,1,2,3,4,5,6]::smallint[])
);
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pods_lead_employee_id_fkey'
      and conrelid = 'pods'::regclass
  ) then
    alter table pods add constraint pods_lead_employee_id_fkey
      foreign key (lead_employee_id) references employees(id) on delete set null;
  end if;
end $$;
create table if not exists processes (
  id uuid primary key default gen_random_uuid(), name text not null unique, active boolean not null default true,
  operating_days smallint[] not null default '{1,2,3,4,5}', holiday_policy text not null default 'closed' check (holiday_policy in ('operate','closed')),
  min_staff integer not null default 1 check (min_staff > 0)
);
create table if not exists brands (
  id uuid primary key default gen_random_uuid(), name text not null unique, active boolean not null default true,
  timezone text not null default 'Asia/Kolkata', operating_days smallint[] not null default '{1,2,3,4,5}',
  holiday_policy text not null default 'closed' check (holiday_policy in ('operate','closed')),
  min_staff integer not null default 1 check (min_staff > 0), daily_minimums jsonb not null default '{}'
);
create table if not exists employee_brands (
  employee_id uuid not null references employees(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  is_primary boolean not null default false, primary key(employee_id, brand_id)
);
alter table employee_brands add column if not exists is_primary boolean not null default false;
create table if not exists brand_processes (
  brand_id uuid not null references brands(id) on delete cascade,
  process_id uuid not null references processes(id) on delete cascade,
  min_staff integer not null default 1 check (min_staff > 0), primary key(brand_id, process_id)
);
create table if not exists employee_processes (
  employee_id uuid not null references employees(id) on delete cascade,
  process_id uuid not null references processes(id) on delete cascade, primary key(employee_id, process_id)
);
create table if not exists holidays (
  id uuid primary key default gen_random_uuid(), date date not null, name text not null, scope text not null default 'all'
);
create table if not exists availability (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references employees(id) on delete cascade,
  date date not null, type text not null check (type in ('leave','comp_off','public_holiday')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')), note text,
  unique(employee_id,date,type)
);
create table if not exists rosters (
  id uuid primary key default gen_random_uuid(), month date not null unique,
  status text not null default 'needs_review' check (status in ('needs_review','validated')),
  generated_at timestamptz not null default now(), validated_at timestamptz
);
create table if not exists roster_entries (
  id uuid primary key default gen_random_uuid(), roster_id uuid not null references rosters(id) on delete cascade,
  work_date date not null, brand_id uuid not null references brands(id), process_id uuid not null references processes(id),
  employee_id uuid not null references employees(id), source text not null default 'generated' check (source in ('generated','manual')),
  unique(roster_id,work_date,brand_id,process_id,employee_id)
);
create index if not exists availability_date_idx on availability(date,employee_id) where status='approved';
create index if not exists roster_entry_date_idx on roster_entries(work_date,brand_id,process_id);
create index if not exists employee_pod_idx on employees(pod_id) where active=true;

-- The API uses a server-only service key. No browser-facing roles need table access.
alter table pods enable row level security;
alter table employees enable row level security;
alter table processes enable row level security;
alter table brands enable row level security;
alter table employee_brands enable row level security;
alter table brand_processes enable row level security;
alter table employee_processes enable row level security;
alter table holidays enable row level security;
alter table availability enable row level security;
alter table rosters enable row level security;
alter table roster_entries enable row level security;
