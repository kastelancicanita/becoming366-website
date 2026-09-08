-- Letter Vault Phase 5: scheduled future delivery (staging dummy data only)
-- delivery_at stored as timestamptz (UTC). Cron runs UTC.

create table if not exists public.letter_vault_letters (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  recipient_email text not null,
  delivery_at timestamptz not null,
  delivery_timezone text not null default 'UTC',
  status text not null default 'SEALED'
    check (status in (
      'SEALED', 'PROCESSING', 'SENT', 'DELIVERED',
      'BOUNCED', 'BLOCKED', 'FAILED', 'RETRY_REQUIRED'
    )),
  ciphertext_b64 text not null,
  ciphertext_nonce_b64 text not null,
  wrapped_dek_b64 text not null,
  wrap_nonce_b64 text not null,
  master_key_version text not null default 'v1',
  content_hash text not null,
  processing_lease_until timestamptz,
  processing_claimed_by text,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  entitlement_ref uuid,
  last_error_category text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists letter_vault_letters_due_idx
  on public.letter_vault_letters (status, delivery_at);

create index if not exists letter_vault_letters_lease_idx
  on public.letter_vault_letters (status, processing_lease_until);

alter table public.letter_vault_letters enable row level security;

create table if not exists public.letter_vault_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  letter_id uuid not null references public.letter_vault_letters (id),
  attempt_number integer not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  provider_message_id text,
  result_status text not null,
  error_category text,
  error_code text,
  created_at timestamptz not null default now(),
  constraint letter_vault_delivery_attempts_unique
    unique (letter_id, attempt_number)
);

alter table public.letter_vault_delivery_attempts enable row level security;

create table if not exists public.letter_vault_scheduler_runs (
  id uuid primary key default gen_random_uuid(),
  run_started_at timestamptz not null default now(),
  run_finished_at timestamptz,
  trigger_source text not null,
  letters_due_count integer not null default 0,
  letters_claimed integer not null default 0,
  letters_sent integer not null default 0,
  letters_failed integer not null default 0,
  stale_recovered integer not null default 0,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  error_summary text
);

alter table public.letter_vault_scheduler_runs enable row level security;

-- Extend outbound email types (no schema change needed if text column)

update public.letter_vault_schema_meta
set schema_version = 'phase5',
    updated_at = now()
where singleton = true;

comment on table public.letter_vault_letters is
  'Phase 5 scheduled letters. Ciphertext only — plaintext exists briefly in Worker memory at delivery.';

comment on table public.letter_vault_scheduler_runs is
  'Phase 5 scheduler heartbeat. Distinguishes no-letters-due from scheduler-not-running.';
