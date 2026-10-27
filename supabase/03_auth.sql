-- Sales Hub - 03 auth (admin-only access)
-- Run after 01_schema.sql and 02_data.sql. Contains no personal data.
-- Result: only users listed in app_users with role 'admin' can read or write the mapping tables.
-- Anyone else (even if signed in) sees nothing. The anon (not signed in) role has no access at all.

begin;

create table public.app_users (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  role        text not null check (role in ('admin')),
  created_at  timestamptz not null default now()
);

alter table public.app_users enable row level security;
revoke all on public.app_users from anon;
grant select on public.app_users to authenticated;

create policy "users read own role"
  on public.app_users for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_users
    where user_id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Replace the read-for-everyone-signed-in policies with admin-only full access.
do $$
declare t text;
begin
  foreach t in array array[
    'lines', 'regions', 'districts', 'bricks', 'boxes', 'brick_box_map',
    'employees', 'box_assignments', 'products', 'product_codes'
  ]
  loop
    execute format('drop policy if exists "authenticated can read" on public.%I', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format(
      'create policy "admin full access" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t
    );
  end loop;
end $$;

commit;
