create table if not exists public.hunting_guides (
  id text primary key,
  data jsonb not null,
  created_at bigint not null default 0,
  updated_at bigint not null default 0
);

create index if not exists hunting_guides_updated_at_idx
  on public.hunting_guides (updated_at desc);

alter table public.hunting_guides enable row level security;

drop policy if exists "Service role can manage hunting guides" on public.hunting_guides;
create policy "Service role can manage hunting guides"
  on public.hunting_guides
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
