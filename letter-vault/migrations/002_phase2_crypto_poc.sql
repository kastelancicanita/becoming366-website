-- Letter Vault Phase 2: encryption proof-of-concept table (staging tests only)
-- Dummy data only. NOT the production letters schema.

create table if not exists public.letter_vault_crypto_poc (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  ciphertext_b64 text not null,
  ciphertext_nonce_b64 text not null,
  wrapped_dek_b64 text not null,
  wrap_nonce_b64 text not null,
  master_key_version text not null default 'v1',
  content_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.letter_vault_crypto_poc enable row level security;

-- No policies: service_role only (same pattern as phase 1).

update public.letter_vault_schema_meta
set schema_version = 'phase2',
    updated_at = now()
where singleton = true;

comment on table public.letter_vault_crypto_poc is
  'Phase 2 encryption POC only. Staging dummy payloads. Removed before production launch.';
