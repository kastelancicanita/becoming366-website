-- Letter Vault Phase 6: management access + delivery email updates (staging dummy data only)

alter table public.letter_vault_letters
  add column if not exists purchaser_email text,
  add column if not exists delivery_email_verified_at timestamptz;

alter table public.letter_vault_letters
  alter column recipient_email drop not null;

alter table public.letter_vault_letters
  drop constraint if exists letter_vault_letters_status_check;

alter table public.letter_vault_letters
  add constraint letter_vault_letters_status_check
  check (status in (
    'SEALED', 'PROCESSING', 'SENT', 'DELIVERED',
    'BOUNCED', 'BLOCKED', 'FAILED', 'RETRY_REQUIRED',
    'AWAITING_DELIVERY_EMAIL'
  ));

create table if not exists public.letter_vault_management_tokens (
  id uuid primary key default gen_random_uuid(),
  letter_id uuid not null references public.letter_vault_letters (id),
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists letter_vault_management_tokens_hash_idx
  on public.letter_vault_management_tokens (token_hash);

alter table public.letter_vault_management_tokens enable row level security;

create table if not exists public.letter_vault_management_sessions (
  id uuid primary key default gen_random_uuid(),
  letter_id uuid not null references public.letter_vault_letters (id),
  session_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists letter_vault_management_sessions_hash_idx
  on public.letter_vault_management_sessions (session_hash);

alter table public.letter_vault_management_sessions enable row level security;

create table if not exists public.letter_vault_delivery_email_changes (
  id uuid primary key default gen_random_uuid(),
  letter_id uuid not null references public.letter_vault_letters (id),
  new_email text not null,
  token_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  verified_at timestamptz,
  previous_active_email text,
  created_at timestamptz not null default now()
);

create unique index if not exists letter_vault_delivery_email_changes_token_idx
  on public.letter_vault_delivery_email_changes (token_hash);

alter table public.letter_vault_delivery_email_changes enable row level security;

create table if not exists public.letter_vault_delivery_email_audit (
  id uuid primary key default gen_random_uuid(),
  letter_id uuid not null references public.letter_vault_letters (id),
  action text not null,
  email_masked text not null,
  created_at timestamptz not null default now()
);

alter table public.letter_vault_delivery_email_audit enable row level security;

update public.letter_vault_schema_meta
set schema_version = 'phase6',
    updated_at = now()
where singleton = true;

comment on table public.letter_vault_management_tokens is
  'Phase 6 one-time management magic link hashes only.';
