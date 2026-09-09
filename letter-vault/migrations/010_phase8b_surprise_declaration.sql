-- Phase 8B S3: Surprise purchaser declaration audit metadata (no letter plaintext).

create table if not exists public.letter_vault_surprise_declarations (
  id uuid primary key default gen_random_uuid(),
  letter_id uuid not null references public.letter_vault_letters (id) on delete cascade,
  declaration_version text not null,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint letter_vault_surprise_declarations_letter_unique unique (letter_id)
);

create index if not exists letter_vault_surprise_declarations_letter_idx
  on public.letter_vault_surprise_declarations (letter_id);

alter table public.letter_vault_surprise_declarations enable row level security;

comment on table public.letter_vault_surprise_declarations is
  'Purchaser personal/non-commercial declaration for Surprise delivery. Metadata only — no letter content.';

update public.letter_vault_schema_meta
set schema_version = 'phase8b_s3',
    updated_at = now()
where singleton = true;
