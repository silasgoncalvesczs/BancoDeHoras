-- =====================================================================
-- Banco de Horas — schema do Supabase
-- Rode este arquivo inteiro em: Supabase Dashboard → SQL Editor → New query
-- (pode ser executado mais de uma vez sem erro)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Lançamentos
-- ---------------------------------------------------------------------
create table if not exists public.entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date        date not null,
  type        text not null check (type in ('credit', 'debit')),
  minutes     integer not null check (minutes > 0 and minutes < 100000),
  note        text not null default '' check (char_length(note) <= 120),
  -- caminho no bucket entry-images; sempre dentro da pasta do próprio usuário
  image_path  text check (image_path is null or image_path like user_id::text || '/%'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists entries_user_date_idx
  on public.entries (user_id, date desc, created_at desc);

alter table public.entries enable row level security;

drop policy if exists "entries: dono lê"      on public.entries;
drop policy if exists "entries: dono cria"    on public.entries;
drop policy if exists "entries: dono altera"  on public.entries;
drop policy if exists "entries: dono exclui"  on public.entries;

create policy "entries: dono lê" on public.entries
  for select to authenticated using (user_id = (select auth.uid()));
create policy "entries: dono cria" on public.entries
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "entries: dono altera" on public.entries
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "entries: dono exclui" on public.entries
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Meta de horas (1 linha por usuário)
-- ---------------------------------------------------------------------
create table if not exists public.goals (
  user_id       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  enabled       boolean not null default false,
  goal_minutes  integer not null default 0 check (goal_minutes >= 0 and goal_minutes < 100000),
  updated_at    timestamptz not null default now()
);

alter table public.goals enable row level security;

drop policy if exists "goals: dono lê"     on public.goals;
drop policy if exists "goals: dono cria"   on public.goals;
drop policy if exists "goals: dono altera" on public.goals;
drop policy if exists "goals: dono exclui" on public.goals;

create policy "goals: dono lê" on public.goals
  for select to authenticated using (user_id = (select auth.uid()));
create policy "goals: dono cria" on public.goals
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "goals: dono altera" on public.goals
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "goals: dono exclui" on public.goals
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists entries_set_updated_at on public.entries;
create trigger entries_set_updated_at
  before update on public.entries
  for each row execute function public.set_updated_at();

drop trigger if exists goals_set_updated_at on public.goals;
create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Realtime (sincroniza entre aparelhos abertos ao mesmo tempo)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'entries'
  ) then
    alter publication supabase_realtime add table public.entries;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'goals'
  ) then
    alter publication supabase_realtime add table public.goals;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Storage: fotos dos lançamentos (bucket privado, 1 pasta por usuário)
-- Caminho dos arquivos: {user_id}/{entry_id}-{timestamp}.jpg
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('entry-images', 'entry-images', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "entry-images: dono lê"     on storage.objects;
drop policy if exists "entry-images: dono envia"  on storage.objects;
drop policy if exists "entry-images: dono altera" on storage.objects;
drop policy if exists "entry-images: dono exclui" on storage.objects;

create policy "entry-images: dono lê" on storage.objects
  for select to authenticated
  using (bucket_id = 'entry-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "entry-images: dono envia" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'entry-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "entry-images: dono altera" on storage.objects
  for update to authenticated
  using (bucket_id = 'entry-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'entry-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "entry-images: dono exclui" on storage.objects
  for delete to authenticated
  using (bucket_id = 'entry-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
