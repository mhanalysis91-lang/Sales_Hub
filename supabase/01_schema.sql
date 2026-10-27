-- Sales Hub - 01 schema (tables, constraints, RLS)
-- Run once in Supabase SQL Editor. Contains NO real data.
-- Date ranges use [valid_from, valid_to): valid_to is the first day the row is NO LONGER valid.
-- valid_to NULL = still valid (open-ended).

begin;

create extension if not exists btree_gist with schema extensions;

create table public.lines (
  id          int generated always as identity primary key,
  code        text not null unique,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.regions (
  id    int generated always as identity primary key,
  name  text not null unique
);

create table public.districts (
  id         int generated always as identity primary key,
  region_id  int not null references public.regions(id),
  name       text not null,
  unique (region_id, name)
);

create table public.bricks (
  id          int generated always as identity primary key,
  name        text not null unique,
  created_at  timestamptz not null default now()
);

create table public.boxes (
  id           int generated always as identity primary key,
  line_id      int not null references public.lines(id),
  district_id  int references public.districts(id),
  name         text not null,
  box_code     text not null unique,
  unique (line_id, name),
  unique (id, line_id)
);

-- Which box a brick belongs to inside a line, over time.
-- A brick can belong to only one box per line at any moment (enforced below).
create table public.brick_box_map (
  id          int generated always as identity primary key,
  brick_id    int not null references public.bricks(id),
  line_id     int not null,
  box_id      int not null,
  valid_from  date not null,
  valid_to    date,
  check (valid_to is null or valid_to > valid_from),
  foreign key (box_id, line_id) references public.boxes(id, line_id),
  exclude using gist (
    brick_id with =,
    line_id  with =,
    daterange(valid_from, valid_to, '[)') with &&
  )
);

create table public.employees (
  id                int generated always as identity primary key,
  full_name         text not null unique,
  arabic_name       text,
  title             text,
  line_id           int references public.lines(id),
  hire_date         date,
  resignation_date  date,
  status            text check (status in ('Active', 'In Active')),
  is_vacant         boolean not null default false,
  created_at        timestamptz not null default now()
);

-- Who covers a box and under which manager, over time.
create table public.box_assignments (
  id          int generated always as identity primary key,
  box_id      int not null references public.boxes(id),
  rep_id      int not null references public.employees(id),
  manager_id  int references public.employees(id),
  valid_from  date not null,
  valid_to    date,
  check (valid_to is null or valid_to > valid_from),
  exclude using gist (
    box_id with =,
    daterange(valid_from, valid_to, '[)') with &&
  )
);

create table public.products (
  id         int generated always as identity primary key,
  line_id    int not null references public.lines(id),
  name       text not null,
  is_active  boolean not null default true,
  unique (line_id, name)
);

-- One product can have several item codes (old and new codes).
create table public.product_codes (
  item_id         text primary key,
  product_id      int not null references public.products(id),
  arabic_name     text,
  approved_price  numeric(12, 2),
  public_price    numeric(12, 2)
);

create index on public.boxes (district_id);
create index on public.districts (region_id);
create index on public.brick_box_map (box_id);
create index on public.box_assignments (rep_id);
create index on public.box_assignments (manager_id);
create index on public.employees (line_id);
create index on public.products (line_id);
create index on public.product_codes (product_id);

-- Security: RLS on everywhere. Signed-in users can read; nobody can write through the API yet.
-- (Writes for now happen only from the SQL Editor. Admin write policies come with the edit screens.)
do $$
declare t text;
begin
  foreach t in array array[
    'lines', 'regions', 'districts', 'bricks', 'boxes', 'brick_box_map',
    'employees', 'box_assignments', 'products', 'product_codes'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy "authenticated can read" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

commit;
