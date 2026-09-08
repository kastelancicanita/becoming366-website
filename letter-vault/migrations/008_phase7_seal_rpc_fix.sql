-- Fix: ambiguous letters_used in letter_vault_seal_slot_atomic (Phase 7 hotfix)

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
  v_new_used integer;
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
