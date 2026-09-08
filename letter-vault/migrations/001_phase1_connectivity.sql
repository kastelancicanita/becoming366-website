-- Letter Vault Phase 1: connectivity proof only
-- NOT the full product schema. Safe to run on empty staging project.

create table if not exists public.letter_vault_schema_meta (
  singleton boolean primary key default true check (singleton = true),
  schema_version text not null,
  updated_at timestamptz not null default now()
);

insert into public.letter_vault_schema_meta (singleton, schema_version)
values (true, 'phase1')
on conflict (singleton) do update
  set schema_version = excluded.schema_version,
      updated_at = now();

-- Worker uses service_role key server-side only (never expose to browser).
alter table public.letter_vault_schema_meta enable row level security;

-- No policies: only service_role (bypasses RLS) can read. Anon/authenticated blocked.

comment on table public.letter_vault_schema_meta is
  'Phase 1 connectivity table. Full Vault schema added in later migrations.';
