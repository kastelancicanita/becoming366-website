-- Letter Vault Phase 3: MVP entitlements + access codes (staging dummy data only)
-- ONE purchase = ONE letter (letters_allowed = 1 for MVP)

create table if not exists public.letter_vault_entitlements (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'manual_staging',
  external_order_ref text not null,
  access_code_hash text not null,
  purchaser_email text not null,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'refunded')),
  letters_allowed integer not null default 1
    check (letters_allowed >= 1),
  letters_used integer not null default 0
    check (letters_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint letter_vault_entitlements_usage_within_allowance
    check (letters_used <= letters_allowed)
);

create unique index if not exists letter_vault_entitlements_code_hash_idx
  on public.letter_vault_entitlements (access_code_hash);

create index if not exists letter_vault_entitlements_email_idx
  on public.letter_vault_entitlements (purchaser_email);

alter table public.letter_vault_entitlements enable row level security;

-- Rate-limit buckets for auth attempts (staging MVP brute-force protection)
create table if not exists public.letter_vault_auth_attempts (
  id bigserial primary key,
  bucket_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists letter_vault_auth_attempts_bucket_idx
  on public.letter_vault_auth_attempts (bucket_key, created_at desc);

alter table public.letter_vault_auth_attempts enable row level security;

-- Atomic entitlement consumption (prevents double-spend under concurrency)
create or replace function public.letter_vault_consume_entitlement(
  p_email text,
  p_code_hash text
)
returns table (
  consumed boolean,
  entitlement_id uuid,
  letters_used integer,
  letters_allowed integer,
  failure_reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_status text;
  v_used integer;
  v_allowed integer;
begin
  select e.id, e.status, e.letters_used, e.letters_allowed
  into v_id, v_status, v_used, v_allowed
  from public.letter_vault_entitlements e
  where e.purchaser_email = lower(trim(p_email))
    and e.access_code_hash = p_code_hash
  for update;

  if v_id is null then
    return query select false, null::uuid, null::integer, null::integer, 'not_found';
    return;
  end if;

  if v_status <> 'active' then
    return query select false, v_id, v_used, v_allowed, 'inactive';
    return;
  end if;

  if v_used >= v_allowed then
    return query select false, v_id, v_used, v_allowed, 'exhausted';
    return;
  end if;

  update public.letter_vault_entitlements
  set letters_used = letters_used + 1,
      updated_at = now()
  where id = v_id
    and status = 'active'
    and letters_used < letters_allowed
  returning letter_vault_entitlements.letters_used, letter_vault_entitlements.letters_allowed
  into v_used, v_allowed;

  if not found then
    return query select false, v_id, null::integer, null::integer, 'race_lost';
    return;
  end if;

  return query select true, v_id, v_used, v_allowed, null::text;
end;
$$;

GRANT EXECUTE ON FUNCTION public.letter_vault_consume_entitlement(text, text) TO service_role;

update public.letter_vault_schema_meta
set schema_version = 'phase3',
    updated_at = now()
where singleton = true;

comment on table public.letter_vault_entitlements is
  'Phase 3 MVP entitlements. Staging dummy data. access_code_hash only — never raw codes.';
