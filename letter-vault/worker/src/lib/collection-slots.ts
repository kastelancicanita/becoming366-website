/**
 * Collection slot generation — milestone, recurring, free collection.
 *
 * FIXED_MILESTONES product behavior:
 * 1. Template defines supported milestone ages (configurable per Etsy product).
 * 2. After DOB, only future-valid milestones from that set are offered.
 * 3. Customer selects exactly letters_allowed milestones — no auto-replacement ages.
 * 4. If fewer future-valid options than purchased count, return a clear validation error.
 */

export type CollectionMechanism =
  | "SINGLE"
  | "FIXED_MILESTONES"
  | "RECURRING"
  | "FREE_COLLECTION";

export interface RecipientContext {
  relationship?: string;
  custom_label?: string;
}

export interface SlotDraft {
  slot_index: number;
  moment_label: string;
  delivery_at: string | null;
  recipient_context?: RecipientContext;
}

export interface TemplateConfig {
  milestones?: number[];
  milestone_label_prefix?: string;
  recurring_type?: "birthday" | "anniversary";
  recurring_count?: number;
}

/** Default supported ages for staging daughter milestone product. */
export const DEFAULT_SUPPORTED_MILESTONES = [16, 18, 21, 25, 30, 40, 50];

export interface MilestoneOption {
  age: number;
  moment_label: string;
  delivery_at: string;
  delivery_written: string;
}

export type MilestoneValidationError =
  | "milestone_count_mismatch"
  | "duplicate_milestones"
  | "unsupported_milestone"
  | "milestone_in_past"
  | "insufficient_future_milestone_options";

export interface MilestoneValidationResult {
  ok: boolean;
  code?: MilestoneValidationError;
  message?: string;
  future_valid_count?: number;
  required_count?: number;
}

function addYears(base: Date, years: number): Date {
  const d = new Date(base);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

function toUtcNoonIso(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}T12:00:00.000Z`;
}

export function isFutureDelivery(iso: string, now = new Date()): boolean {
  return new Date(iso).getTime() > now.getTime();
}

export function formatWrittenDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function ordinalSuffix(age: number): string {
  const mod100 = age % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (age % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

export function supportedMilestoneAges(config?: TemplateConfig): number[] {
  return config?.milestones?.length
    ? [...config.milestones]
    : [...DEFAULT_SUPPORTED_MILESTONES];
}

export function formatMilestoneLabel(age: number, config?: TemplateConfig): string {
  const prefix = config?.milestone_label_prefix ?? "Her";
  return `${prefix} ${age}${ordinalSuffix(age)} Birthday`;
}

export function listFutureValidMilestoneOptions(
  dobIso: string,
  config?: TemplateConfig,
  now = new Date(),
): MilestoneOption[] {
  const base = new Date(`${dobIso.slice(0, 10)}T12:00:00.000Z`);
  const options: MilestoneOption[] = [];

  for (const age of supportedMilestoneAges(config)) {
    const iso = toUtcNoonIso(addYears(base, age));
    if (!isFutureDelivery(iso, now)) continue;
    options.push({
      age,
      moment_label: formatMilestoneLabel(age, config),
      delivery_at: iso,
      delivery_written: formatWrittenDate(iso),
    });
  }

  return options;
}

export function validateMilestoneSelection(
  dobIso: string,
  selectedAges: number[],
  requiredCount: number,
  config?: TemplateConfig,
  now = new Date(),
): MilestoneValidationResult {
  const supported = supportedMilestoneAges(config);
  const futureValid = listFutureValidMilestoneOptions(dobIso, config, now);
  const futureValidAges = new Set(futureValid.map((o) => o.age));

  if (futureValid.length < requiredCount) {
    return {
      ok: false,
      code: "insufficient_future_milestone_options",
      message: `Only ${futureValid.length} future milestone birthdays are available for this date of birth, but this collection includes ${requiredCount} letters. Additional supported milestones may need to be added to this product.`,
      future_valid_count: futureValid.length,
      required_count: requiredCount,
    };
  }

  if (selectedAges.length !== requiredCount) {
    return {
      ok: false,
      code: "milestone_count_mismatch",
      message: `Select exactly ${requiredCount} milestone birthdays.`,
      required_count: requiredCount,
    };
  }

  if (new Set(selectedAges).size !== selectedAges.length) {
    return {
      ok: false,
      code: "duplicate_milestones",
      message: "Each milestone birthday can only be selected once.",
    };
  }

  for (const age of selectedAges) {
    if (!supported.includes(age)) {
      return {
        ok: false,
        code: "unsupported_milestone",
        message: `Milestone age ${age} is not supported for this product.`,
      };
    }
    if (!futureValidAges.has(age)) {
      return {
        ok: false,
        code: "milestone_in_past",
        message: `The ${age}${ordinalSuffix(age)} birthday has already passed. Choose future milestones only.`,
      };
    }
  }

  return { ok: true };
}

export function generateFixedMilestoneSlotsFromSelection(
  dobIso: string,
  selectedAges: number[],
  sharedRecipient: RecipientContext | undefined,
  config?: TemplateConfig,
  now = new Date(),
): SlotDraft[] {
  const validation = validateMilestoneSelection(
    dobIso,
    selectedAges,
    selectedAges.length,
    config,
    now,
  );
  if (!validation.ok) {
    throw new Error(validation.code ?? "milestone_selection_invalid");
  }

  const sorted = [...selectedAges].sort((a, b) => a - b);
  const base = new Date(`${dobIso.slice(0, 10)}T12:00:00.000Z`);

  return sorted.map((age, index) => {
    const iso = toUtcNoonIso(addYears(base, age));
    return {
      slot_index: index + 1,
      moment_label: formatMilestoneLabel(age, config),
      delivery_at: iso,
      recipient_context: sharedRecipient,
    };
  });
}

export function previewRecurringSlots(
  baseDateIso: string,
  count: number,
  config?: TemplateConfig,
  now = new Date(),
): MilestoneOption[] {
  const drafts = generateRecurringSlots(
    baseDateIso,
    count,
    undefined,
    config,
    now,
  );
  return drafts.map((s) => ({
    age: s.slot_index,
    moment_label: s.moment_label,
    delivery_at: s.delivery_at!,
    delivery_written: formatWrittenDate(s.delivery_at!),
  }));
}

/** Next N future anniversary/birthday occurrences from base month/day. */
export function generateRecurringSlots(
  baseDateIso: string,
  count: number,
  sharedRecipient: RecipientContext | undefined,
  config?: TemplateConfig,
  now = new Date(),
): SlotDraft[] {
  const base = new Date(`${baseDateIso.slice(0, 10)}T12:00:00.000Z`);
  const type = config?.recurring_type ?? "birthday";
  const labelPrefix = type === "anniversary" ? "Anniversary" : "Birthday";
  const slots: SlotDraft[] = [];
  let year = now.getUTCFullYear();

  while (slots.length < count && year < now.getUTCFullYear() + 120) {
    const candidate = new Date(
      Date.UTC(year, base.getUTCMonth(), base.getUTCDate(), 12, 0, 0),
    );
    const iso = toUtcNoonIso(candidate);
    if (isFutureDelivery(iso, now)) {
      slots.push({
        slot_index: slots.length + 1,
        moment_label: `${labelPrefix} ${slots.length + 1}`,
        delivery_at: iso,
        recipient_context: sharedRecipient,
      });
    }
    year++;
  }

  if (slots.length < count) {
    throw new Error("insufficient_future_recurring_dates");
  }

  return slots;
}

export function generateFreeCollectionSlots(count: number): SlotDraft[] {
  return Array.from({ length: count }, (_, i) => ({
    slot_index: i + 1,
    moment_label: `Letter ${i + 1}`,
    delivery_at: null,
  }));
}

export function generateSingleSlot(): SlotDraft {
  return {
    slot_index: 1,
    moment_label: "Your letter",
    delivery_at: null,
  };
}

export function generateCollectionSlots(
  mechanism: CollectionMechanism,
  slotCount: number,
  baseDateIso: string | null,
  sharedRecipient: RecipientContext | undefined,
  config?: TemplateConfig,
  selectedMilestoneAges?: number[],
): SlotDraft[] {
  switch (mechanism) {
    case "FIXED_MILESTONES":
      if (!baseDateIso) throw new Error("base_date_required");
      if (!selectedMilestoneAges?.length) {
        throw new Error("selected_milestone_ages_required");
      }
      return generateFixedMilestoneSlotsFromSelection(
        baseDateIso,
        selectedMilestoneAges,
        sharedRecipient,
        config,
      );
    case "RECURRING":
      if (!baseDateIso) throw new Error("base_date_required");
      return generateRecurringSlots(
        baseDateIso,
        slotCount,
        sharedRecipient,
        config,
      );
    case "FREE_COLLECTION":
      return generateFreeCollectionSlots(slotCount);
    case "SINGLE":
      return [generateSingleSlot()];
    default:
      throw new Error("unknown_mechanism");
  }
}

/** Calculate milestone birthday delivery from DOB + age; null if in past. */
export function milestoneDeliveryFromDob(
  dobIso: string,
  age: number,
  now = new Date(),
): string | null {
  const base = new Date(`${dobIso.slice(0, 10)}T12:00:00.000Z`);
  const iso = toUtcNoonIso(addYears(base, age));
  return isFutureDelivery(iso, now) ? iso : null;
}

export function generatePublicLetterId(uuid: string): string {
  const hex = uuid.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `LV-${hex}`;
}

export const MAX_LETTER_LENGTH = 15_000;

export function validateLetterLength(text: string): boolean {
  return [...text].length <= MAX_LETTER_LENGTH;
}

export function letterCharCount(text: string): number {
  return [...text].length;
}
