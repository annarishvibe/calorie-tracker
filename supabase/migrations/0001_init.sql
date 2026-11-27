-- Ккал.Дневник · начальная схема базы данных (PostgreSQL / Supabase)
-- Выполнить в Supabase SQL Editor один раз.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  email text,
  age integer check (age between 10 and 120),
  weight_kg numeric(6,2) check (weight_kg between 20 and 400),
  height_cm numeric(6,2) check (height_cm between 100 and 250),
  sex text check (sex in ('male', 'female')),
  activity_level text not null default 'moderate'
    check (activity_level in ('sedentary', 'light', 'moderate', 'active', 'very_active')),
  goal text not null default 'maintain'
    check (goal in ('lose', 'maintain', 'gain')),
  meals_per_day integer not null default 4 check (meals_per_day between 2 and 8),
  daily_kcal integer check (daily_kcal between 800 and 10000),
  protein_g integer check (protein_g between 0 and 1000),
  fat_g integer check (fat_g between 0 and 500),
  carbs_g integer check (carbs_g between 0 and 2000),
  use_manual_targets boolean not null default false,
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Анкета и настройки пользователя Ккал.Дневника';

create table if not exists public.foods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'other',
  kcal numeric(7,2) not null default 0 check (kcal >= 0),
  protein numeric(7,2) not null default 0 check (protein >= 0),
  fat numeric(7,2) not null default 0 check (fat >= 0),
  carbs numeric(7,2) not null default 0 check (carbs >= 0),
  serving_g numeric(7,2) not null default 100 check (serving_g > 0),
  is_custom boolean not null default false,
  created_by uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint foods_custom_owner check (not is_custom or created_by is not null)
);

create index if not exists foods_name_trgm_idx on public.foods using gin (name gin_trgm_ops);
create index if not exists foods_category_idx on public.foods (category);

comment on table public.foods is 'База блюд: справочные и пользовательские записи';

create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null default current_date,
  meal_slot text not null check (meal_slot ~ '^meal_[1-8]$'),
  food_id uuid references public.foods(id) on delete set null,
  food_name text not null,
  grams numeric(7,2) not null check (grams > 0),
  kcal numeric(8,2) not null default 0 check (kcal >= 0),
  protein numeric(8,2) not null default 0 check (protein >= 0),
  fat numeric(8,2) not null default 0 check (fat >= 0),
  carbs numeric(8,2) not null default 0 check (carbs >= 0),
  created_at timestamptz not null default now()
);

create index if not exists diary_entries_user_date_idx on public.diary_entries (user_id, entry_date);
create index if not exists diary_entries_user_slot_idx on public.diary_entries (user_id, entry_date, meal_slot);

comment on table public.diary_entries is 'Приёмы пищи по дням; КБЖУ фиксируются на момент добавления';

create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  food_id uuid not null references public.foods(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, food_id)
);

create or replace view public.daily_totals with (security_invoker = true) as
select
  user_id,
  entry_date,
  round(sum(kcal)::numeric, 1) as kcal,
  round(sum(protein)::numeric, 1) as protein,
  round(sum(fat)::numeric, 1) as fat,
  round(sum(carbs)::numeric, 1) as carbs,
  count(*) as entries_count
from public.diary_entries
group by user_id, entry_date;

grant select on public.daily_totals to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.foods enable row level security;
alter table public.diary_entries enable row level security;
alter table public.favorites enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists foods_select_all on public.foods;
create policy foods_select_all on public.foods
  for select to anon, authenticated using (true);

drop policy if exists foods_insert_own on public.foods;
create policy foods_insert_own on public.foods
  for insert to authenticated
  with check (is_custom and created_by = auth.uid());

drop policy if exists foods_update_own on public.foods;
create policy foods_update_own on public.foods
  for update to authenticated
  using (is_custom and created_by = auth.uid())
  with check (is_custom and created_by = auth.uid());

drop policy if exists foods_delete_own on public.foods;
create policy foods_delete_own on public.foods
  for delete to authenticated
  using (is_custom and created_by = auth.uid());

drop policy if exists diary_select_own on public.diary_entries;
create policy diary_select_own on public.diary_entries
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists diary_insert_own on public.diary_entries;
create policy diary_insert_own on public.diary_entries
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists diary_update_own on public.diary_entries;
create policy diary_update_own on public.diary_entries
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists diary_delete_own on public.diary_entries;
create policy diary_delete_own on public.diary_entries
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists favorites_select_own on public.favorites;
create policy favorites_select_own on public.favorites
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists favorites_insert_own on public.favorites;
create policy favorites_insert_own on public.favorites
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists favorites_delete_own on public.favorites;
create policy favorites_delete_own on public.favorites
  for delete to authenticated using (auth.uid() = user_id);
