-- Phase 8B S4: MailerSend webhook recipient suppression (metadata only).

create table if not exists public.letter_vault_recipient_suppressions (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  reason text not null
    check (reason in ('hard_bounce', 'spam_complaint', 'on_hold')),
  provider text not null default 'mailersend',
  source_event_type text,
  source_provider_message_id text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint letter_vault_recipient_suppressions_email_unique unique (recipient_email)
);

create index if not exists letter_vault_recipient_suppressions_active_idx
  on public.letter_vault_recipient_suppressions (recipient_email)
  where resolved_at is null;

alter table public.letter_vault_recipient_suppressions enable row level security;

comment on table public.letter_vault_recipient_suppressions is
  'Surprise delivery suppression after hard bounce/complaint. No letter plaintext.';

update public.letter_vault_schema_meta
set schema_version = 'phase8b_s4',
    updated_at = now()
where singleton = true;
