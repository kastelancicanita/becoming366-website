-- Letter Vault Phase 7: collections, slots, vault sessions (staging only)

-- Entitlement product model
alter table public.letter_vault_entitlements
  add column if not exists product_type text not null default 'SINGLE'
    check (product_type in ('SINGLE', 'COLLECTION')),
  add column if not exists collection_mechanism text
    check (
      collection_mechanism is null
      or collection_mechanism in (
        'SINGLE', 'FIXED_MILESTONES', 'RECURRING', 'FREE_COLLECTION'
      )
    ),
  add column if not exists display_title text,
  add column if not exists template_key text,
  add column if not exists template_config jsonb;

-- Collections (one per multi-letter entitlement)
create table if not exists public.letter_vault_collections (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null unique
    references public.letter_vault_entitlements (id),
  display_title text not null,
  collection_mechanism text not null
    check (collection_mechanism in (
      'FIXED_MILESTONES', 'RECURRING', 'FREE_COLLECTION'
    )),
  shared_recipient_context jsonb,
  base_date date,
  slot_count integer not null check (slot_count >= 1),
  initialized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists letter_vault_collections_entitlement_idx
  on public.letter_vault_collections (entitlement_id);

alter table public.letter_vault_collections enable row level security;

-- Letter slots (pre-allocated; UNWRITTEN until sealed)
create table if not exists public.letter_vault_letter_slots (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null
    references public.letter_vault_entitlements (id),
  collection_id uuid references public.letter_vault_collections (id),
  slot_index integer not null check (slot_index >= 1),
  moment_label text,
  recipient_context jsonb,
  delivery_at timestamptz,
  delivery_timezone text not null default 'UTC',
  slot_status text not null default 'UNWRITTEN'
    check (slot_status in ('UNWRITTEN', 'SEALED')),
  letter_id uuid references public.letter_vault_letters (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint letter_vault_slots_unique_index unique (entitlement_id, slot_index)
);

create index if not exists letter_vault_letter_slots_entitlement_idx
  on public.letter_vault_letter_slots (entitlement_id);

create index if not exists letter_vault_letter_slots_collection_idx
  on public.letter_vault_letter_slots (collection_id);

alter table public.letter_vault_letter_slots enable row level security;

-- Vault writing sessions (short-lived; does not consume entitlement)
create table if not exists public.letter_vault_vault_sessions (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null
    references public.letter_vault_entitlements (id),
  session_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists letter_vault_vault_sessions_hash_idx
  on public.letter_vault_vault_sessions (session_hash);

alter table public.letter_vault_vault_sessions enable row level security;

-- Extend letters for Phase 7
alter table public.letter_vault_letters
  add column if not exists slot_id uuid references public.letter_vault_letter_slots (id),
  add column if not exists public_letter_id text,
  add column if not exists recipient_context jsonb,
  add column if not exists moment_label text;

create unique index if not exists letter_vault_letters_public_id_idx
  on public.letter_vault_letters (public_letter_id)
  where public_letter_id is not null;

-- Extend management tokens to support collection-wide access via any letter
comment on column public.letter_vault_letters.public_letter_id is
  'Customer-facing LV-XXXXXXXX reference for management.';

-- Atomic seal: consume slot + increment letters_used + insert letter row metadata
create or replace function public.letter_vault_seal_slot_atomic(
  p_slot_id uuid,
  p_entitlement_id uuid,
  p_purchaser_email text,
  p_label text,
  p_delivery_at timestamptz,
  p_delivery_timezone text,
  p_recipient_context jsonb,
  p_moment_label text,
  p_ciphertext_b64 text,
  p_ciphertext_nonce_b64 text,
  p_wrapped_dek_b64 text,
  p_wrap_nonce_b64 text,
  p_master_key_version text,
  p_content_hash text,
  p_recipient_email text default null
)
returns table (
  letter_id uuid,
  public_letter_id text,
  letters_used integer,
  letters_allowed integer
)
language plpgsql
as $$
declare
  v_entitlement public.letter_vault_entitlements%rowtype;
  v_slot public.letter_vault_letter_slots%rowtype;
  v_letter_id uuid;
  v_public_id text;
begin
  select * into v_entitlement
  from public.letter_vault_entitlements
  where id = p_entitlement_id
  for update;

  if not found then
    raise exception 'entitlement_not_found';
  end if;

  if v_entitlement.purchaser_email <> lower(trim(p_purchaser_email)) then
    raise exception 'purchaser_mismatch';
  end if;

  if v_entitlement.status <> 'active' then
    raise exception 'entitlement_inactive';
  end if;

  if v_entitlement.letters_used >= v_entitlement.letters_allowed then
    raise exception 'allocation_exhausted';
  end if;

  select * into v_slot
  from public.letter_vault_letter_slots
  where id = p_slot_id
    and entitlement_id = p_entitlement_id
  for update;

  if not found then
    raise exception 'slot_not_found';
  end if;

  if v_slot.slot_status <> 'UNWRITTEN' then
    raise exception 'slot_already_sealed';
  end if;

  insert into public.letter_vault_letters (
    label,
    purchaser_email,
    recipient_email,
    delivery_at,
    delivery_timezone,
    status,
    ciphertext_b64,
    ciphertext_nonce_b64,
    wrapped_dek_b64,
    wrap_nonce_b64,
    master_key_version,
    content_hash,
    entitlement_ref,
    slot_id,
    public_letter_id,
    recipient_context,
    moment_label,
    delivery_email_verified_at
  ) values (
    p_label,
    lower(trim(p_purchaser_email)),
    p_recipient_email,
    p_delivery_at,
    coalesce(p_delivery_timezone, 'UTC'),
    'SEALED',
    p_ciphertext_b64,
    p_ciphertext_nonce_b64,
    p_wrapped_dek_b64,
    p_wrap_nonce_b64,
    p_master_key_version,
    p_content_hash,
    p_entitlement_id,
    p_slot_id,
    null,
    p_recipient_context,
    p_moment_label,
    case when p_recipient_email is not null then now() else null end
  )
  returning id into v_letter_id;

  v_public_id := 'LV-' || upper(substr(replace(v_letter_id::text, '-', ''), 1, 8));

  update public.letter_vault_letters
  set public_letter_id = v_public_id
  where id = v_letter_id;

  update public.letter_vault_letter_slots
  set slot_status = 'SEALED',
      letter_id = v_letter_id,
      delivery_at = p_delivery_at,
      delivery_timezone = coalesce(p_delivery_timezone, 'UTC'),
      recipient_context = coalesce(p_recipient_context, recipient_context),
      moment_label = coalesce(p_moment_label, moment_label),
      updated_at = now()
  where id = p_slot_id;

  v_new_used := v_entitlement.letters_used + 1;

  update public.letter_vault_entitlements
  set letters_used = v_new_used,
      updated_at = now()
  where id = p_entitlement_id;

  return query
  select
    v_letter_id,
    v_public_id,
    v_new_used,
    v_entitlement.letters_allowed;
end;
$$;

update public.letter_vault_schema_meta
set schema_version = 'phase7',
    updated_at = now()
where singleton = true;

comment on table public.letter_vault_collections is
  'Phase 7 multi-letter collections linked to entitlements.';
comment on table public.letter_vault_letter_slots is
  'Phase 7 pre-allocated letter slots. UNWRITTEN until sealed.';
