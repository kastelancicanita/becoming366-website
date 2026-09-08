-- Letter Vault Phase 4: transactional email infrastructure (staging dummy data only)
-- Resend provider tracking + webhook dedupe. No letter plaintext.

create table if not exists public.letter_vault_email_outbound (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  email_type text not null default 'seal_confirmation',
  recipient_email text not null,
  provider text not null default 'resend',
  provider_message_id text,
  status text not null default 'queued'
    check (status in (
      'queued', 'sending', 'sent', 'delivered',
      'bounced', 'failed', 'complained', 'blocked'
    )),
  status_rank integer not null default 10,
  delivery_date date not null,
  letter_ref uuid,
  entitlement_ref uuid,
  last_event_type text,
  last_event_at timestamptz,
  error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint letter_vault_email_outbound_idempotency_unique unique (idempotency_key)
);

create index if not exists letter_vault_email_outbound_provider_msg_idx
  on public.letter_vault_email_outbound (provider_message_id);

alter table public.letter_vault_email_outbound enable row level security;

create table if not exists public.letter_vault_email_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null,
  provider_message_id text,
  event_type text not null,
  outbound_email_id uuid references public.letter_vault_email_outbound (id),
  status_applied text,
  received_at timestamptz not null default now(),
  constraint letter_vault_email_webhook_events_provider_event_unique
    unique (provider_event_id)
);

create index if not exists letter_vault_email_webhook_events_msg_idx
  on public.letter_vault_email_webhook_events (provider_message_id);

alter table public.letter_vault_email_webhook_events enable row level security;

update public.letter_vault_schema_meta
set schema_version = 'phase4',
    updated_at = now()
where singleton = true;

comment on table public.letter_vault_email_outbound is
  'Phase 4 transactional email state. Operational metadata only — no letter content.';

comment on table public.letter_vault_email_webhook_events is
  'Phase 4 Resend webhook dedupe log. Provider event IDs only.';
