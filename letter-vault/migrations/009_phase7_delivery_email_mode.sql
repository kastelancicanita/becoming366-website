-- Phase 7: per-letter delivery email mode (surprise vs verified)

alter table public.letter_vault_letters
  add column if not exists delivery_email_mode text
    check (delivery_email_mode is null or delivery_email_mode in ('surprise', 'verified'));

comment on column public.letter_vault_letters.delivery_email_mode is
  'surprise = no recipient verification before delivery; verified = recipient must confirm address';

update public.letter_vault_schema_meta
set schema_version = 'phase7',
    updated_at = now()
where singleton = true;
