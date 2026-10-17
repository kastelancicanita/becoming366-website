(function () {
  "use strict";

  const API = window.LETTER_VAULT_API;
  const state = {
    session: null,
    entitlementId: null,
    productType: null,
    mechanism: null,
    displayTitle: null,
    templateConfig: null,
    sharedRecipient: null,
    slots: [],
    currentSlot: null,
    recipient: null,
    deliveryAt: null,
    dearLine: "",
    inCollection: false,
    flowMode: "single", // single | collection-write | free-moment
    dateLocked: false,
    lettersAllowed: null,
    selectedMilestoneAges: [],
    selectedAnniversaryNumbers: [],
    milestoneOptions: [],
    purchaserEmail: null,
    recoveryToken: null,
    recipientLocked: false,
    surprise_delivery_email_available: undefined,
    surprise_unavailable_message: null,
    surprise_declaration_text: null,
    reviewDeliveryChoice: null,
    reviewDeliveryMode: null,
    collection: null,
    needsRecipientSetup: false,
    collectionInitRecipient: null,
    purchaserPolicyAccepted: false,
    purchaserPolicyBody: null,
    minorGuardianScopes: [],
    privacySafetyPath: "privacy-safety/",
    pendingAfterPurchaserPromise: null,
    pendingMinorGuardianScope: null,
    pendingMinorGuardianContinue: null,
    pendingMinorGuardianPanelId: null,
    pendingAfterAgeDecision: null,
    activeAgePanelId: null,
    pendingAfterSenderName: null,
    pendingCollectionInitBody: null,
    recipientIsMinor: null,
    collectionRecipientIsMinor: null,
    fixedMilestonesGuardianConfirmedForInit: false,
    fixedMilestonesGuardianModalPending: false,
    birthdayRecurringGuardianConfirmedForInit: false,
    birthdayRecurringGuardianModalPending: false,
    collectionInitPending: false,
    collectionInitInProgress: false,
    dateConfirmPending: false,
    sealPending: false,
    anniversaryPartnerAgeConfirmed18Plus: false,
    anniversaryPartnerAgeBlocked: false,
    anniversaryPartnerAgeModalPending: false,
  };

  const SENDER_DISPLAY_NAME_MAX = 80;

  function applyDeliveryCapabilities(source) {
    if (!source || typeof source.surprise_delivery_email_available !== "boolean") {
      return;
    }
    state.surprise_delivery_email_available = source.surprise_delivery_email_available;
    state.surprise_unavailable_message = source.surprise_unavailable_message ?? null;
    state.surprise_declaration_text = source.surprise_declaration_text ?? null;
  }

  function applyPrivacyFromResponse(source) {
    if (!source) return;
    state.purchaserPolicyAccepted = source.purchaser_policy_accepted === true;
    state.minorGuardianScopes =
      source.minor_guardian_scopes_accepted ||
      source.minor_guardian_relationships_accepted ||
      [];
    if (source.privacy_safety_path) {
      state.privacySafetyPath = String(source.privacy_safety_path).replace(/^\//, "");
    }
    if (source.purchaser_policy_body) {
      state.purchaserPolicyBody = source.purchaser_policy_body;
      const el = $("purchaser-promise-body");
      if (el) el.textContent = source.purchaser_policy_body;
    }
  }

  function hasMinorGuardianFor(scopeKey) {
    return (state.minorGuardianScopes || []).includes(scopeKey);
  }

  function currentSlotMinorScopeKey() {
    ensureCurrentSlotForAgeScope();
    const slotId = state.currentSlot?.slot_id;
    return slotId ? "slot:" + slotId : "slot:unknown";
  }

  function ensureCurrentSlotForAgeScope() {
    if (
      (state.flowMode === "single" || state.flowMode === "free-moment") &&
      !state.currentSlot?.slot_id &&
      state.slots?.[0]?.slot_id
    ) {
      state.currentSlot = state.slots[0];
    }
  }

  function collectionMinorScopeKey() {
    return "collection_shared";
  }

  function isMyselfRecipient() {
    return state.recipient === "Myself";
  }

  function needsSenderDisplayNameForCurrentFlow() {
    if (isMyselfRecipient()) return false;
    if (state.flowMode === "collection-write" && isPredefinedCollection()) {
      return false;
    }
    return true;
  }

  function proceedToDateStep() {
    resetDateStep();
    showStep("step-date");
  }

  function proceedAfterRecipientAgeDecision(nextStepFn) {
    if (!needsSenderDisplayNameForCurrentFlow()) {
      nextStepFn();
      return;
    }
    state.pendingAfterSenderName = nextStepFn;
    const input = $("sender-display-name");
    if (input) input.value = "";
    showStep("step-sender-name");
  }

  function promptSenderNameForCollectionInit(body) {
    state.pendingCollectionInitBody = body;
    state.pendingAfterSenderName = function () {
      state.pendingCollectionInitBody = null;
      submitCollectionInit(body);
    };
    const input = $("sender-display-name");
    if (input) input.value = "";
    showStep("step-sender-name");
  }

  async function continueFromSenderNameStep() {
    showError("");
    const name = $("sender-display-name")?.value.trim() || "";
    if (!name) {
      showError("Please enter your name.");
      return;
    }
    if (name.length > SENDER_DISPLAY_NAME_MAX) {
      showError("Name is too long.");
      return;
    }
    const continueFn = state.pendingAfterSenderName;
    state.pendingAfterSenderName = null;

    if (state.pendingCollectionInitBody) {
      state.pendingCollectionInitBody.sender_display_name = name;
      continueFn?.();
      return;
    }

    if (!state.currentSlot?.slot_id) {
      showError("Something went wrong. Please refresh and try again.");
      return;
    }
    const res = await api("/v1/vault/slots/" + state.currentSlot.slot_id, {
      method: "PATCH",
      body: JSON.stringify({ sender_display_name: name }),
    });
    if (res.status !== 200) {
      showError(res.json.message || "Could not save your name.");
      state.pendingAfterSenderName = continueFn;
      return;
    }
    continueFn?.();
  }

  function hideRecipientAgePanel(panelId) {
    const el = $(panelId);
    if (el) el.hidden = true;
    const modal = $("recipient-age-modal");
    if (modal) {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("recipient-age-modal-open");
    state.activeAgePanelId = null;
  }

  function minorScopeKeyForAgePanel(panelId) {
    if (panelId === "recipient-age-panel") {
      return currentSlotMinorScopeKey();
    }
    return collectionMinorScopeKey();
  }

  function resetRecipientAgeModalViews() {
    const ageView = $("recipient-age-modal-age-view");
    const guardianView = $("recipient-age-modal-guardian-view");
    const partnerAgeView = $("recipient-age-modal-partner-age-view");
    const partnerBlockedView = $("recipient-age-modal-partner-blocked-view");
    if (ageView) ageView.hidden = false;
    if (guardianView) guardianView.hidden = true;
    if (partnerAgeView) partnerAgeView.hidden = true;
    if (partnerBlockedView) partnerBlockedView.hidden = true;
    const modal = $("recipient-age-modal");
    if (modal) modal.setAttribute("aria-labelledby", "recipient-age-modal-heading");
    if ($("recipient-age-modal-guardian-check")) {
      $("recipient-age-modal-guardian-check").checked = false;
    }
  }

  function isAnniversaryPartnerInitFlow() {
    return (
      state.mechanism === "RECURRING" &&
      recurringCollectionType() === "anniversary" &&
      state.collectionInitRecipient === "My partner"
    );
  }

  function setAnniversarySetupFieldsVisible(visible) {
    const fields = $("collection-init-fields");
    if (!fields) return;
    const baseDateLabel = fields.querySelector('label[for="base-date"]');
    const baseDate = $("base-date");
    const picker = $("anniversary-number-picker");
    if (baseDateLabel) baseDateLabel.hidden = !visible;
    if (baseDate) {
      baseDate.hidden = !visible;
      if (!visible) baseDate.value = "";
    }
    if (picker) {
      picker.hidden = true;
      if (!visible) picker.innerHTML = "";
    }
    state.selectedAnniversaryNumbers = [];
    if (state.mechanism === "RECURRING" && recurringCollectionType() === "anniversary") {
      $("btn-collection-init").disabled = true;
    }
  }

  function resetAnniversaryPartnerAgeGate() {
    state.anniversaryPartnerAgeConfirmed18Plus = false;
    state.anniversaryPartnerAgeBlocked = false;
    state.anniversaryPartnerAgeModalPending = false;
    if (state.mechanism === "RECURRING" && recurringCollectionType() === "anniversary") {
      setAnniversarySetupFieldsVisible(false);
    }
  }

  function showAnniversaryPartnerAgeModal() {
    state.activeAgePanelId = "collection-init-age-panel";
    const ageView = $("recipient-age-modal-age-view");
    const guardianView = $("recipient-age-modal-guardian-view");
    const partnerAgeView = $("recipient-age-modal-partner-age-view");
    const partnerBlockedView = $("recipient-age-modal-partner-blocked-view");
    if (ageView) ageView.hidden = true;
    if (guardianView) guardianView.hidden = true;
    if (partnerBlockedView) partnerBlockedView.hidden = true;
    if (partnerAgeView) partnerAgeView.hidden = false;
    const modal = $("recipient-age-modal");
    if (modal) {
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
      modal.setAttribute(
        "aria-labelledby",
        "recipient-age-modal-partner-age-heading",
      );
      document.body.classList.add("recipient-age-modal-open");
    }
    $("recipient-age-modal-partner-yes")?.focus();
  }

  function showAnniversaryPartnerBlockedView() {
    const ageView = $("recipient-age-modal-age-view");
    const guardianView = $("recipient-age-modal-guardian-view");
    const partnerAgeView = $("recipient-age-modal-partner-age-view");
    const partnerBlockedView = $("recipient-age-modal-partner-blocked-view");
    if (ageView) ageView.hidden = true;
    if (guardianView) guardianView.hidden = true;
    if (partnerAgeView) partnerAgeView.hidden = true;
    if (partnerBlockedView) partnerBlockedView.hidden = false;
    $("recipient-age-modal")?.setAttribute(
      "aria-labelledby",
      "recipient-age-modal-partner-blocked-heading",
    );
    $("btn-recipient-age-modal-partner-choose-recipient")?.focus();
  }

  function handleAnniversaryPartnerAgeYes() {
    showError("");
    state.anniversaryPartnerAgeConfirmed18Plus = true;
    state.anniversaryPartnerAgeBlocked = false;
    state.anniversaryPartnerAgeModalPending = false;
    state.collectionRecipientIsMinor = false;
    hideRecipientAgePanel("collection-init-age-panel");
    setAnniversarySetupFieldsVisible(true);
  }

  function handleAnniversaryPartnerAgeNo() {
    showError("");
    state.anniversaryPartnerAgeConfirmed18Plus = false;
    state.anniversaryPartnerAgeBlocked = true;
    state.anniversaryPartnerAgeModalPending = false;
    state.collectionRecipientIsMinor = true;
    setAnniversarySetupFieldsVisible(false);
    showAnniversaryPartnerBlockedView();
  }

  function chooseDifferentRecipientFromAnniversaryPartnerBlocked() {
    showError("");
    state.anniversaryPartnerAgeModalPending = false;
    hideRecipientAgePanel("collection-init-age-panel");
    resetCollectionInitRecipientSelection();
    showStep("step-collection-init");
    $("collection-init-recipient-grid")?.querySelector(".choice-btn")?.focus();
  }

  function maybePromptAnniversaryPartnerAgeGate() {
    if (!isAnniversaryPartnerInitFlow()) return;
    showError("");
    const ctx = readSharedRecipientContext({
      someoneElseInput: "collection-init-custom-relationship",
      nameInput: "collection-init-recipient-name",
    });
    if (!ctx) {
      resetAnniversaryPartnerAgeGate();
      return;
    }
    if (state.anniversaryPartnerAgeConfirmed18Plus) {
      setAnniversarySetupFieldsVisible(true);
      if ($("base-date")?.value) {
        setupAnniversaryNumberPicker();
      }
      return;
    }
    if (state.anniversaryPartnerAgeBlocked) {
      setAnniversarySetupFieldsVisible(false);
      const modal = $("recipient-age-modal");
      if (modal?.hidden) {
        showAnniversaryPartnerAgeModal();
      }
      showAnniversaryPartnerBlockedView();
      return;
    }
    setAnniversarySetupFieldsVisible(false);
    const partnerAgeView = $("recipient-age-modal-partner-age-view");
    const modalOpen =
      $("recipient-age-modal") &&
      !$("recipient-age-modal").hidden &&
      partnerAgeView &&
      !partnerAgeView.hidden;
    if (modalOpen || state.anniversaryPartnerAgeModalPending) {
      return;
    }
    state.anniversaryPartnerAgeModalPending = true;
    showAnniversaryPartnerAgeModal();
  }

  function showRecipientAgeModalGuardianView() {
    const ageView = $("recipient-age-modal-age-view");
    const guardianView = $("recipient-age-modal-guardian-view");
    if (ageView) ageView.hidden = true;
    if (guardianView) guardianView.hidden = false;
    $("recipient-age-modal")?.setAttribute(
      "aria-labelledby",
      "recipient-age-modal-guardian-heading",
    );
    $("recipient-age-modal-guardian-check")?.focus();
  }

  function showRecipientAgePanel(panelId, afterDecision) {
    if (state.recipient === "Myself") {
      state.recipientIsMinor = false;
      afterDecision();
      return;
    }
    ensureCurrentSlotForAgeScope();
    state.pendingAfterAgeDecision = afterDecision;
    state.activeAgePanelId = panelId;
    resetRecipientAgeModalViews();
    const modal = $("recipient-age-modal");
    if (modal) {
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
      document.body.classList.add("recipient-age-modal-open");
      modal.querySelectorAll(".choice-btn").forEach((b) => {
        b.classList.remove("selected");
        b.setAttribute("aria-pressed", "false");
      });
      $("recipient-age-modal-no")?.focus();
    }
  }

  function handleAgeModalYes() {
    ensureCurrentSlotForAgeScope();
    const panelId = state.activeAgePanelId || "recipient-age-panel";
    const scopeKey = minorScopeKeyForAgePanel(panelId);
    if (panelId === "recipient-age-panel") {
      state.recipientIsMinor = true;
    } else {
      state.collectionRecipientIsMinor = true;
    }
    requireMinorGuardianIfNeeded(
      scopeKey,
      function () {
        hideRecipientAgePanel(panelId);
        const proceed = state.pendingAfterAgeDecision || function () {};
        state.pendingAfterAgeDecision = null;
        proceed();
      },
      panelId,
    );
  }

  function resolveAgeModalChoice(isMinor) {
    const panelId = state.activeAgePanelId || "recipient-age-panel";
    resolveRecipientAgeChoice(
      isMinor,
      minorScopeKeyForAgePanel(panelId),
      panelId,
    );
  }

  function resolveRecipientAgeChoice(isMinor, scopeKey, panelId, afterDecision) {
    hideRecipientAgePanel(panelId);
    if (panelId === "recipient-age-panel") {
      state.recipientIsMinor = isMinor;
    } else {
      state.collectionRecipientIsMinor = isMinor;
    }
    const proceed =
      afterDecision || state.pendingAfterAgeDecision || function () {};
    state.pendingAfterAgeDecision = null;
    if (isMinor) {
      requireMinorGuardianIfNeeded(scopeKey, proceed, panelId);
    } else {
      proceed();
    }
  }

  function showPurchaserPromiseIfNeeded(continueFn) {
    if (state.purchaserPolicyAccepted) {
      continueFn();
      return;
    }
    state.pendingAfterPurchaserPromise = continueFn;
    if (state.purchaserPolicyBody && $("purchaser-promise-body")) {
      $("purchaser-promise-body").textContent = state.purchaserPolicyBody;
    }
    showStep("step-purchaser-promise");
  }

  function clearPendingMinorGuardianConfirmation() {
    state.pendingMinorGuardianScope = null;
    state.pendingMinorGuardianContinue = null;
    state.pendingMinorGuardianPanelId = null;
    state.fixedMilestonesGuardianModalPending = false;
  }

  function resetMinorAgeChoiceForPanel(panelId) {
    if (panelId === "recipient-age-panel") {
      state.recipientIsMinor = null;
    } else {
      state.collectionRecipientIsMinor = null;
    }
  }

  function resetBirthdayRecurringGuardianGate() {
    state.birthdayRecurringGuardianConfirmedForInit = false;
    state.birthdayRecurringGuardianModalPending = false;
    const panel = $("recurring-preview");
    if (panel) {
      panel.hidden = true;
      panel.innerHTML = "";
    }
    if (isBirthdayRecurring()) {
      $("btn-collection-init").disabled = true;
    }
  }

  function resetFixedMilestonesGuardianGate() {
    state.fixedMilestonesGuardianConfirmedForInit = false;
    state.fixedMilestonesGuardianModalPending = false;
    hideFixedMilestonesMilestonePicker();
  }

  function hideFixedMilestonesMilestonePicker() {
    const picker = $("milestone-age-picker");
    if (picker) {
      picker.hidden = true;
      picker.innerHTML = "";
    }
    state.selectedMilestoneAges = [];
    if (state.mechanism === "FIXED_MILESTONES") {
      $("btn-collection-init").disabled = true;
    }
  }

  function resetCollectionInitRecipientSelection() {
    state.collectionInitRecipient = null;
    state.collectionRecipientIsMinor = null;
    resetFixedMilestonesGuardianGate();
    resetBirthdayRecurringGuardianGate();
    resetAnniversaryPartnerAgeGate();
    const grid = $("collection-init-recipient-grid");
    if (grid) {
      grid.querySelectorAll(".choice-btn").forEach((b) => {
        b.classList.remove("selected");
        b.setAttribute("aria-pressed", "false");
      });
    }
    const someoneElse = $("collection-init-someone-else");
    if (someoneElse) someoneElse.hidden = true;
    const nameFields = $("collection-init-name-fields");
    if (nameFields) nameFields.hidden = true;
    const customRel = $("collection-init-custom-relationship");
    if (customRel) customRel.value = "";
    const nameInput = $("collection-init-recipient-name");
    if (nameInput) nameInput.value = "";
    refreshCollectionInitRecipientDisplay();
  }

  function chooseDifferentRecipientFromMinorGuardian() {
    showError("");
    const panelId =
      state.pendingMinorGuardianPanelId ||
      state.activeAgePanelId ||
      "recipient-age-panel";
    clearPendingMinorGuardianConfirmation();
    state.pendingAfterAgeDecision = null;
    resetMinorAgeChoiceForPanel(panelId);
    if ($("recipient-age-modal-guardian-check")) {
      $("recipient-age-modal-guardian-check").checked = false;
    }
    if ($("minor-guardian-check")) {
      $("minor-guardian-check").checked = false;
    }
    hideRecipientAgePanel(panelId);
    if (panelId === "recipient-age-panel") {
      setupRecipientStep(isFreeCollectionRecipientFlow(), null);
      showStep("step-recipient");
      $("recipient-choices")?.querySelector(".choice-btn")?.focus();
      return;
    }
    if (panelId === "collection-init-age-panel") {
      resetCollectionInitRecipientSelection();
      showStep("step-collection-init");
      $("collection-init-recipient-grid")?.querySelector(".choice-btn")?.focus();
      return;
    }
    if (panelId === "collection-recipient-age-panel") {
      setupCollectionRecipientSetup();
      showStep("step-collection-recipient-setup");
      $("collection-recipient-choices")?.querySelector(".choice-btn")?.focus();
    }
  }

  function requireMinorGuardianIfNeeded(scopeKey, continueFn, panelId) {
    state.pendingMinorGuardianScope = scopeKey;
    state.pendingMinorGuardianContinue = continueFn;
    state.pendingMinorGuardianPanelId =
      panelId || state.activeAgePanelId || "recipient-age-panel";
    if ($("recipient-age-modal-guardian-check")) {
      $("recipient-age-modal-guardian-check").checked = false;
    }
    if ($("minor-guardian-check")) {
      $("minor-guardian-check").checked = false;
    }
    const ageModalOpen =
      $("recipient-age-modal") &&
      !$("recipient-age-modal").hidden;
    if (ageModalOpen) {
      showRecipientAgeModalGuardianView();
      return;
    }
    showStep("step-minor-guardian");
  }

  async function submitMinorGuardianConfirmation() {
    showError("");
    const guardianView = $("recipient-age-modal-guardian-view");
    const useModalGuardian =
      guardianView &&
      !guardianView.hidden &&
      $("recipient-age-modal") &&
      !$("recipient-age-modal").hidden;
    const confirmed = useModalGuardian
      ? $("recipient-age-modal-guardian-check")?.checked
      : $("minor-guardian-check")?.checked;
    if (!confirmed) {
      showError("Please confirm you are the parent or legal guardian.");
      return false;
    }
    const scopeKey = state.pendingMinorGuardianScope;
    if (!scopeKey) return false;
    if (!hasMinorGuardianFor(scopeKey)) {
      const res = await api("/v1/vault/privacy/accept-minor-guardian", {
        method: "POST",
        body: JSON.stringify({
          scope_key: scopeKey,
          guardian_declaration_accepted: true,
        }),
      });
      if (isSessionExpiredResponse(res)) {
        handleSessionExpired();
        return false;
      }
      if (res.networkError || res.status !== 200 || res.json.status !== "ok") {
        showError(res.json.message || "Something went wrong. Please try again.");
        return false;
      }
      applyPrivacyFromResponse(res.json);
      if (res.json.minor_guardian_scopes_accepted) {
        state.minorGuardianScopes = res.json.minor_guardian_scopes_accepted;
      }
    }
    const next = state.pendingMinorGuardianContinue;
    clearPendingMinorGuardianConfirmation();
    if (next) next();
    return true;
  }

  function effectiveRecipientRelationship() {
    if (state.recipient === "Someone else") {
      return $("custom-relationship")?.value.trim() || "Someone special";
    }
    return state.recipient || "";
  }

  window.LvVaultState = state;

  const VAULT_STORE_KEY = "lv_vault_session_v1";

  function parseVaultSessionRaw(raw) {
    try {
      const data = JSON.parse(raw);
      if (!data?.session || !data?.entitlementId) return null;
      return {
        session: data.session,
        entitlementId: data.entitlementId,
        purchaserEmail: data.purchaserEmail || "",
        lastStep: data.lastStep || null,
        currentSlotId: data.currentSlotId || null,
        lastPublicLetterId: data.lastPublicLetterId || null,
        flowMode: data.flowMode || null,
      };
    } catch {
      return null;
    }
  }

  function clearVaultSessionStorage() {
    try {
      sessionStorage.removeItem(VAULT_STORE_KEY);
    } catch {}
  }

  function persistVaultSession(overrides) {
    if (!state.session || !state.entitlementId) return;
    const payload = {
      session: state.session,
      entitlementId: state.entitlementId,
      purchaserEmail: state.purchaserEmail || "",
      lastStep: overrides?.lastStep || null,
      currentSlotId: state.currentSlot?.slot_id || null,
      lastPublicLetterId: overrides?.lastPublicLetterId || null,
      flowMode: state.flowMode || null,
    };
    const activeStep = document.querySelector(".vault-step.active")?.id;
    if (!payload.lastStep && activeStep && activeStep !== "step-entry") {
      payload.lastStep = activeStep;
    }
    try {
      sessionStorage.setItem(VAULT_STORE_KEY, JSON.stringify(payload));
    } catch {}
  }

  function restoreVaultSessionFromStorage() {
    try {
      return parseVaultSessionRaw(sessionStorage.getItem(VAULT_STORE_KEY));
    } catch {
      return null;
    }
  }

  function applySharedRecipientFromSlots() {
    if (state.mechanism === "FREE_COLLECTION") return;
    const sharedCtx = state.collection?.shared_recipient_context;
    if (sharedCtx?.relationship) {
      state.sharedRecipient = sharedCtx.relationship;
      return;
    }
    const firstRecipient = (state.slots || []).find(
      (s) => s.recipient_context?.relationship,
    )?.recipient_context?.relationship;
    if (firstRecipient) state.sharedRecipient = firstRecipient;
  }

  function applyVaultPayloadFromApi(json, purchaserEmail) {
    state.productType = json.product_type;
    state.mechanism = json.collection_mechanism;
    state.displayTitle = json.display_title;
    state.templateConfig = json.template_config || null;
    state.slots = json.slots || [];
    state.collectionInitInProgress = json.collection_init_in_progress === true;
    state.inCollection = json.product_type === "COLLECTION";
    state.lettersAllowed = json.letters_allowed || null;
    if (purchaserEmail) state.purchaserEmail = purchaserEmail;
    applyDeliveryCapabilities(json);
    applyPrivacyFromResponse(json);
    applyCollectionFromResponse(json);
    applySharedRecipientFromSlots();
  }

  const RECIPIENTS = [
    { label: "Myself", hint: "A letter for the person you're becoming." },
    { label: "My daughter", hint: "Words for her to carry someday." },
    { label: "My son", hint: "Words for him to carry someday." },
    { label: "My partner", hint: "Something you want them to remember." },
    { label: "My friend", hint: "Words worth keeping between friends." },
    { label: "Someone else", hint: "Tell us who they are to you." },
  ];

  const ANNIVERSARY_RECIPIENTS = [
    { label: "Myself", hint: "An important personal anniversary — a date that matters to you." },
    { label: "My partner", hint: "Marriage, relationship, first date, engagement, or another shared anniversary." },
  ];

  function predefinedRecipientsForCollection() {
    if (
      state.mechanism === "RECURRING" &&
      recurringCollectionType() === "anniversary"
    ) {
      return ANNIVERSARY_RECIPIENTS;
    }
    return RECIPIENTS;
  }

  const DATE_OPTIONS = [
    { label: "ONE YEAR FROM TODAY", hint: "Exactly one year from today.", action: "one_year" },
    { label: "ON A BIRTHDAY", hint: "Choose a milestone birthday.", action: "birthday" },
    { label: "ON AN ANNIVERSARY", hint: "Choose a future anniversary.", action: "anniversary" },
    { label: "CHOOSE A DATE", hint: "Pick any future date.", action: "pick" },
  ];

  const FREE_MOMENT_DATE_OPTIONS = [
    { label: "ONE YEAR FROM TODAY", hint: "Exactly one year from today.", action: "one_year" },
    {
      label: "CHOOSE A DATE",
      hint:
        "Pick any future date — a birthday, anniversary, milestone, or simply a day that matters.",
      action: "pick",
    },
  ];

  const CANONICAL_RECIPIENT_LABELS = new Set([
    "Myself",
    "My daughter",
    "My son",
    "My partner",
    "My friend",
    "Someone else",
  ]);

  function normalizeUserEnteredDisplayText(value) {
    if (value == null || typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return "";
    const idx = trimmed.search(/\S/);
    if (idx < 0) return trimmed;
    return (
      trimmed.slice(0, idx) +
      trimmed.charAt(idx).toUpperCase() +
      trimmed.slice(idx + 1)
    );
  }

  function dateOptionsForCurrentFlow() {
    if (isFreeCollectionRecipientFlow()) {
      return FREE_MOMENT_DATE_OPTIONS;
    }
    return DATE_OPTIONS;
  }

  function sealedSlotActionParent(li, slot) {
    if (state.mechanism === "FREE_COLLECTION" && slot.slot_status === "SEALED") {
      let wrap = li.querySelector(".slot-sealed-actions");
      if (!wrap) {
        wrap = document.createElement("div");
        wrap.className = "slot-sealed-actions";
        li.appendChild(wrap);
      }
      return wrap;
    }
    return li;
  }

  const BIRTHDAY_MILESTONES = [18, 21, 30, 40, 50];

  const $ = (id) => document.getElementById(id);
  const steps = [...document.querySelectorAll(".vault-step")];

  function showStep(id) {
    steps.forEach((s) => s.classList.toggle("active", s.id === id));
    updateProgress(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (state.session && state.entitlementId && id !== "step-entry") {
      persistVaultSession({ lastStep: id });
    }
  }

  function exitToEntry() {
    clearVaultSessionStorage();
    state.session = null;
    state.entitlementId = null;
    showStep("step-entry");
  }

  function showError(msg) {
    const el = $("vault-error");
    if (!msg) {
      el.hidden = true;
      return;
    }
    el.textContent = msg;
    el.hidden = false;
  }

  window.LvVaultShowError = showError;

  function ordinalAgeLabel(age) {
    const mod100 = age % 100;
    const mod10 = age % 10;
    let suffix = "th";
    if (mod10 === 1 && mod100 !== 11) suffix = "st";
    else if (mod10 === 2 && mod100 !== 12) suffix = "nd";
    else if (mod10 === 3 && mod100 !== 13) suffix = "rd";
    return age + suffix + " birthday";
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /** Serif title with sans-serif age so milestone numbers stay easy to scan. */
  function formatMilestoneTitleHtml(label) {
    if (!label) return "";
    const safe = escapeHtml(label);
    return safe.replace(
      /(\d+(?:st|nd|rd|th))(\s+(?:Birthday|Anniversary))/i,
      '<span class="milestone-age">$1</span>$2',
    );
  }

  function slotTitleHtml(slot) {
    const base = slot.moment_label || "Letter " + slot.slot_index;
    const prefix = slot.slot_status === "SEALED" ? "🔒 " : "";
    if (/\d+(?:st|nd|rd|th)\s+(?:Birthday|Anniversary)/i.test(base)) {
      return prefix + formatMilestoneTitleHtml(base);
    }
    return prefix + escapeHtml(base);
  }

  function formatWrittenDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  function isFutureDate(iso) {
    return new Date(iso).getTime() > Date.now();
  }

  /** Current age from DOB; minor when age is under 18 (FIXED_MILESTONES init only). */
  function isCurrentlyUnder18FromDob(dobStr) {
    if (!dobStr) return false;
    const dob = new Date(dobStr.includes("T") ? dobStr : dobStr + "T12:00:00.000Z");
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    let age = today.getUTCFullYear() - dob.getUTCFullYear();
    const monthDiff = today.getUTCMonth() - dob.getUTCMonth();
    const dayDiff = today.getUTCDate() - dob.getUTCDate();
    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
      age -= 1;
    }
    return age < 18;
  }

  function api(path, opts) {
    const headers = { "Content-Type": "application/json" };
    if (state.session) headers["X-Letter-Vault-Session"] = state.session;
    return fetch(API + path, {
      ...opts,
      headers: { ...headers, ...(opts && opts.headers) },
    })
      .then((r) =>
        r.json().then(
          (j) => ({ status: r.status, json: j || {}, networkError: false }),
          () => ({
            status: r.status,
            json: { status: "error", message: "Something went wrong. Please try again." },
            networkError: false,
          }),
        ),
      )
      .catch(() => ({
        status: 0,
        json: {
          status: "error",
          message:
            "We couldn't reach the Letter Vault. Check your connection and try again.",
        },
        networkError: true,
      }));
  }

  function isFreeCollectionRecipientFlow() {
    return state.flowMode === "free-moment" && state.mechanism === "FREE_COLLECTION";
  }

  function isPredefinedCollection() {
    return state.mechanism === "FIXED_MILESTONES" || state.mechanism === "RECURRING";
  }

  function isPredefinedCollectionWrite() {
    return state.flowMode === "collection-write" && isPredefinedCollection();
  }

  function applyCollectionFromResponse(json) {
    if (json && Object.prototype.hasOwnProperty.call(json, "collection")) {
      state.collection = json.collection || null;
    }
    if (json && typeof json.needs_recipient_setup === "boolean") {
      state.needsRecipientSetup = json.needs_recipient_setup;
    }
  }

  function isBirthdayRecurring() {
    return state.mechanism === "RECURRING" && recurringCollectionType() === "birthday";
  }

  function collectionAwaitingInit() {
    return (
      state.inCollection &&
      Boolean(state.mechanism) &&
      state.mechanism !== "SINGLE" &&
      !state.collection &&
      (!state.slots || state.slots.length === 0)
    );
  }

  function isSessionExpiredResponse(res) {
    return Boolean(res && res.json && res.json.code === "vault_session_expired");
  }

  const COLLECTION_INIT_MAX_ATTEMPTS = 3;

  function isCollectionInitInProgressResponse(res) {
    return Boolean(
      res &&
        res.status === 409 &&
        res.json &&
        res.json.code === "collection_init_in_progress",
    );
  }

  function waitForCollectionInitRetry(attempt) {
    return new Promise(function (resolve) {
      setTimeout(resolve, 250 * attempt);
    });
  }

  function handleSessionExpired() {
    clearVaultSessionStorage();
    state.session = null;
    state.entitlementId = null;
    showError("Your session expired. Enter your access code again to continue.");
    showStep("step-entry");
  }

  function collectionDeliveryDashboardStatus() {
    const c = state.collection;
    if (!c) return "Not added yet";
    if (c.delivery_email_pending_verification) {
      const masked = c.pending_delivery_email_masked || c.delivery_email_masked || "";
      return masked ? "Pending verification · " + masked : "Pending verification";
    }
    if (!c.has_delivery_email) return "Not added yet";
    const masked = c.delivery_email_masked || "";
    if (c.delivery_email_mode === "surprise") {
      return masked ? "Added · " + masked : "Added";
    }
    return masked ? "Added · " + masked : "Added";
  }

  function collectionDeliveryActionLabel() {
    const c = state.collection;
    if (c?.delivery_email_pending_verification) return "UPDATE COLLECTION DELIVERY EMAIL →";
    return c?.has_delivery_email
      ? "CHANGE COLLECTION DELIVERY EMAIL →"
      : "ADD COLLECTION DELIVERY EMAIL →";
  }

  function formatRecipientDisplay(ctx) {
    if (!ctx?.relationship) return "—";
    const relationship = CANONICAL_RECIPIENT_LABELS.has(ctx.relationship)
      ? ctx.relationship
      : normalizeUserEnteredDisplayText(ctx.relationship);
    const name = ctx.recipient_name?.trim();
    if (name) {
      return normalizeUserEnteredDisplayText(name) + " · " + relationship;
    }
    return relationship;
  }

  function recipientNameLabelForRelationship(relationship) {
    if (relationship === "My daughter") return "Her name";
    if (relationship === "My son") return "His name";
    if (relationship === "Myself") return "Your name";
    return "Their name";
  }

  function recipientNamePlaceholderForRelationship(relationship) {
    if (relationship === "My daughter") return "e.g. Emma";
    if (relationship === "My son") return "e.g. Leo";
    if (relationship === "Myself") return "e.g. Ana";
    return "e.g. Emma";
  }

  function hideFreeCollectionNameFields() {
    const el = $("free-collection-name-fields");
    if (el) el.hidden = true;
  }

  function showFreeCollectionNameFields() {
    if (!isFreeCollectionRecipientFlow() || !state.recipient) {
      hideFreeCollectionNameFields();
      return;
    }
    $("recipient-name-label").textContent = recipientNameLabelForRelationship(state.recipient);
    $("recipient-name").placeholder = recipientNamePlaceholderForRelationship(state.recipient);
    $("free-collection-name-fields").hidden = false;
  }

  function sharedCollectionRecipientContext() {
    return (
      state.collection?.shared_recipient_context ||
      state.currentSlot?.recipient_context ||
      null
    );
  }

  function authoritativeRecipientContext() {
    if (isPredefinedCollectionWrite()) {
      const shared = sharedCollectionRecipientContext();
      if (shared?.relationship) {
        const ctx = { relationship: shared.relationship };
        const name = shared.recipient_name?.trim();
        if (name) ctx.recipient_name = name;
        return ctx;
      }
    }
    return recipientContext();
  }

  function recipientContext() {
    if (!state.recipient) return {};
    const ctx = {};
    if (state.recipient === "Someone else") {
      const rel = $("custom-relationship").value.trim() || "Someone special";
      ctx.relationship = normalizeUserEnteredDisplayText(rel);
    } else {
      ctx.relationship = state.recipient;
    }
    if (isFreeCollectionRecipientFlow()) {
      const name = $("recipient-name")?.value.trim();
      if (name) ctx.recipient_name = normalizeUserEnteredDisplayText(name);
    }
    if (state.recipient !== "Myself" && state.recipientIsMinor === true) {
      ctx.recipient_is_minor = true;
    } else if (state.recipient !== "Myself" && state.recipientIsMinor === false) {
      ctx.recipient_is_minor = false;
    }
    return ctx;
  }

  function recipientPronounObject(relationship) {
    if (relationship === "My daughter") return "her";
    if (relationship === "My son") return "him";
    if (relationship === "Myself") return "you";
    return "them";
  }

  function collectionEmotionalLine(sealed, total) {
    if (sealed <= 0 || sealed >= total) return null;
    const remaining = total - sealed;
    const relationship =
      state.collection?.shared_recipient_context?.relationship || state.sharedRecipient;
    const pronoun = recipientPronounObject(relationship);
    const amount = remaining === 1 ? "One letter is" : remaining + " letters are";
    return amount + " still waiting for " + pronoun + ".";
  }

  const COLLECTION_HEADING = "Your Letter Collection";

  function collectionSubtitleText(text) {
    const value = (text || "").trim();
    if (!value || value.toLowerCase() === COLLECTION_HEADING.toLowerCase()) return "";
    return value;
  }

  function showCollectionSubtitle(element, text) {
    if (!element) return;
    const value = collectionSubtitleText(text);
    element.textContent = value;
    element.hidden = !value;
  }

  function collectionDashboardSubtitle() {
    if (isPredefinedCollection()) {
      const relationship =
        state.collection?.shared_recipient_context?.relationship || state.sharedRecipient;
      return collectionSubtitleText(predefinedCollectionHeadline(relationship));
    }
    return collectionSubtitleText(state.displayTitle || "");
  }

  function recurringCollectionType() {
    const rt = state.templateConfig?.recurring_type;
    return rt === "anniversary" ? "anniversary" : "birthday";
  }

  function plannedLetterCount() {
    const count = Number(state.lettersAllowed);
    return Number.isInteger(count) && count > 0 ? count : null;
  }

  function futureOccasionPhrase(noun) {
    const count = plannedLetterCount();
    if (!count) return "the future " + noun + "s these letters are for";
    if (count === 1) return "the future " + noun + " this letter is for";
    return "the " + count + " future " + noun + "s these letters are for";
  }

  function recurringInitCopy(relationship) {
    const isAnniversary = recurringCollectionType() === "anniversary";
    if (!relationship) {
      return isAnniversary
        ? "Choose who these letters are for, then enter your anniversary date."
        : "Choose who these letters are for, then enter the date of birth we should calculate from.";
    }
    if (isAnniversary) {
      return (
        "What is your original anniversary date? Then choose " +
        futureOccasionPhrase("anniversary") +
        "."
      );
    }
    if (relationship === "My daughter") {
      return "When was she born? We'll calculate future letter dates from that birthday.";
    }
    if (relationship === "My son") {
      return "When was he born? We'll calculate future letter dates from that birthday.";
    }
    if (relationship === "Myself") {
      return "When were you born? We'll calculate future letter dates from that birthday.";
    }
    return "What is their date of birth? We'll calculate future letter dates from that birthday.";
  }

  function recurringBaseDateLabel() {
    return recurringCollectionType() === "anniversary" ? "Anniversary date" : "Date of birth";
  }

  function reviewDeliveryLaterHint() {
    if (state.inCollection) {
      return "Seal now — add the delivery email from your collection dashboard whenever you're ready.";
    }
    return "Seal now — add the delivery email later using your Letter ID and a secure management link.";
  }

  function sealDeliveryEmailErrorFallback() {
    if (state.inCollection) {
      return "Your letter is sealed, but we couldn't save the delivery email. Add it from your collection dashboard.";
    }
    return "Your letter is sealed, but we couldn't save the delivery email. Use your Letter ID and a secure management link to add it later.";
  }

  function syncReviewDeliveryCopy() {
    const laterHint = $("review-delivery-later-hint");
    if (laterHint) laterHint.textContent = reviewDeliveryLaterHint();
  }

  function continueFromRecipientStep() {
    showError("");
    if (state.recipient === "Someone else") {
      const rel = $("custom-relationship").value.trim();
      if (!rel) {
        showError("Please tell us who this person is to you.");
        return;
      }
    }
    if (isFreeCollectionRecipientFlow()) {
      const name = $("recipient-name").value.trim();
      if (state.recipient !== "Myself" && !name) {
        showError("Please enter their name so you can tell your letters apart.");
        return;
      }
    }
    showRecipientAgePanel("recipient-age-panel", function () {
      proceedAfterRecipientAgeDecision(proceedToDateStep);
    });
  }

  function addYearsFromDate(dateStr, years) {
    const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T12:00:00.000Z");
    d.setUTCFullYear(d.getUTCFullYear() + years);
    return d.toISOString();
  }

  function oneYearFromToday() {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    d.setUTCHours(12, 0, 0, 0);
    return d.toISOString();
  }

  function slotUsesPredefinedFlow() {
    return state.inCollection && isPredefinedCollection();
  }

  function slotRecipientIsPredefined(slot) {
    return Boolean(
      state.inCollection &&
        slot.recipient_context?.relationship &&
        state.mechanism !== "FREE_COLLECTION",
    );
  }

  function updateProgress(stepId) {
    const bar = $("vault-progress");
    if (!bar) return;
    if (state.flowMode === "single") {
      const steps = [{ id: "step-recipient", label: "Recipient" }];
      if (needsSenderDisplayNameForCurrentFlow()) {
        steps.push({ id: "step-sender-name", label: "Your name" });
      }
      steps.push(
        { id: "step-date", label: "Date" },
        { id: "step-write", label: "Write" },
        { id: "step-review", label: "Seal" },
      );
      const idx = steps.findIndex((step) => step.id === stepId);
      if (idx === -1) {
        bar.hidden = true;
        return;
      }
      bar.hidden = false;
      bar.innerHTML =
        "<span class='progress-label'>Step " +
        (idx + 1) +
        " of " +
        steps.length +
        "</span>" +
        "<span class='progress-steps'>" +
        steps.map((step) => "<span>" + step.label + "</span>").join("") +
        "</span>";
      return;
    }
    if (state.flowMode === "collection-write" && (stepId === "step-write" || stepId === "step-review")) {
      bar.hidden = false;
      bar.innerHTML =
        "<span class='progress-label'>Write & seal this letter</span>";
      return;
    }
    if (state.flowMode === "free-moment" && (stepId === "step-recipient" || stepId === "step-date" || stepId === "step-write" || stepId === "step-review")) {
      bar.hidden = false;
      bar.innerHTML = "<span class='progress-label'>Choose this letter's moment</span>";
      return;
    }
    bar.hidden = true;
  }

  function openPredefinedSlot(slot) {
    state.currentSlot = slot;
    state.flowMode = "collection-write";
    state.dateLocked = Boolean(slot.delivery_at);
    state.recipientLocked = true;
    state.deliveryAt = slot.delivery_at || null;
    const shared = sharedCollectionRecipientContext();
    state.recipient =
      shared?.relationship || slot.recipient_context?.relationship || state.sharedRecipient || null;
    goWrite();
  }

  function openFreeCollectionSlot(slot) {
    state.currentSlot = slot;
    state.flowMode = "free-moment";
    state.dateLocked = false;
    state.recipientLocked = false;
    state.deliveryAt = slot.delivery_at || null;
    state.recipient = null;
    state.dearLine = "";
    setupRecipientStep(true, slot.recipient_context || null);
    showStep("step-recipient");
  }

  function startSingleFlow(slot) {
    state.currentSlot = slot;
    state.flowMode = "single";
    state.dateLocked = false;
    state.recipientLocked = false;
    state.deliveryAt = slot?.delivery_at || null;
    setupRecipientStep(false);
    showStep("step-recipient");
  }

  // --- Entry ---
  $("form-entry").addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const res = await api("/v1/vault/enter", {
      method: "POST",
      body: JSON.stringify({
        access_code: $("access-code").value.trim(),
        purchaser_email: $("purchase-email").value.trim(),
      }),
    });
    if (res.status !== 200 || res.json.status !== "ok") {
      showError("We couldn't verify those details. Check your access code and purchase email and try again.");
      return;
    }
    Object.assign(state, {
      session: res.json.vault_session_token,
      entitlementId: res.json.entitlement_id,
      productType: res.json.product_type,
      mechanism: res.json.collection_mechanism,
      displayTitle: res.json.display_title,
      templateConfig: res.json.template_config || null,
      slots: res.json.slots || [],
      collectionInitInProgress: res.json.collection_init_in_progress === true,
      inCollection: res.json.product_type === "COLLECTION",
      sharedRecipient: null,
      lettersAllowed: res.json.letters_allowed || null,
      selectedMilestoneAges: [],
      selectedAnniversaryNumbers: [],
      milestoneOptions: [],
      purchaserEmail: $("purchase-email").value.trim(),
    });
    applyDeliveryCapabilities(res.json);
    applyPrivacyFromResponse(res.json);
    applyCollectionFromResponse(res.json);
    persistVaultSession();

    if (state.mechanism !== "FREE_COLLECTION") {
      const sharedCtx = res.json.collection?.shared_recipient_context;
      if (sharedCtx?.relationship) {
        state.sharedRecipient = sharedCtx.relationship;
      } else {
        const firstRecipient = (res.json.slots || []).find(
          (s) => s.recipient_context?.relationship,
        )?.recipient_context?.relationship;
        if (firstRecipient) state.sharedRecipient = firstRecipient;
      }
    }

    showPurchaserPromiseIfNeeded(function () {
      continueAfterVaultEnter(res.json);
    });
  });

  async function continueAfterVaultEnter(enterJson) {
    if (enterJson.collection_init_in_progress || enterJson.needs_collection_init) {
      setupCollectionInit();
      showStep("step-collection-init");
      return;
    }
    if (enterJson.needs_single_slot) {
      const prepared = await api("/v1/vault/single/prepare", { method: "POST", body: "{}" });
      if (isSessionExpiredResponse(prepared)) {
        handleSessionExpired();
        return;
      }
      if (prepared.networkError || prepared.status !== 200) {
        showError(prepared.json?.message || "Could not prepare your letter. Please try again.");
        return;
      }
      const st = await api("/v1/vault/state");
      if (isSessionExpiredResponse(st)) {
        handleSessionExpired();
        return;
      }
      if (st.networkError || st.status !== 200) {
        showError(st.json?.message || "Could not prepare your letter. Please try again.");
        return;
      }
      state.slots = st.json.slots || [];
      applyDeliveryCapabilities(st.json);
      applyPrivacyFromResponse(st.json);
      applyCollectionFromResponse(st.json);
    }
    if (state.inCollection && state.slots.length) {
      if (enterJson.needs_recipient_setup && isPredefinedCollection()) {
        setupCollectionRecipientSetup();
        showStep("step-collection-recipient-setup");
        return;
      }
      renderCollection();
      showStep("step-collection");
    } else if (
      state.slots.length === 1 &&
      state.slots[0].slot_status === "SEALED"
    ) {
      showAlreadySealedSingle(state.slots[0]);
    } else {
      startSingleFlow(state.slots[0]);
    }
  }

  $("btn-purchaser-promise-continue")?.addEventListener("click", async function () {
    showError("");
    const res = await api("/v1/vault/privacy/accept-purchaser-policy", {
      method: "POST",
      body: "{}",
    });
    if (res.status !== 200 || res.json.status !== "ok") {
      showError("Something went wrong. Please try again.");
      return;
    }
    applyPrivacyFromResponse(res.json);
    state.purchaserPolicyAccepted = true;
    const next = state.pendingAfterPurchaserPromise;
    state.pendingAfterPurchaserPromise = null;
    if (next) next();
  });

  $("btn-minor-guardian-continue")?.addEventListener("click", async function () {
    await submitMinorGuardianConfirmation();
  });
  $("btn-minor-guardian-choose-recipient")?.addEventListener(
    "click",
    chooseDifferentRecipientFromMinorGuardian,
  );

  function showSuccessScreen(slot, options) {
    if (!options?.keepError) showError("");
    $("success-date").textContent = formatWrittenDate(slot.delivery_at);
    $("success-letter-id").textContent = slot.public_letter_id || "";
    const hideReturn =
      options?.hideReturnCollection ?? false;
    $("btn-return-collection").hidden = hideReturn || !state.inCollection;
    if (window.LvManage) {
      if (
        isPredefinedCollectionWrite() ||
        (state.inCollection && state.collection?.collection_wide_delivery)
      ) {
        LvManage.renderPredefinedSuccessDeliveryBlock();
      } else {
        LvManage.renderSuccessDeliveryBlock(slot);
      }
    }
    renderSuccessCancelActions(slot);
    showStep("step-success");
    persistVaultSession({
      lastStep: "step-success",
      lastPublicLetterId: slot.public_letter_id || null,
    });
  }

  function routeAfterVaultSessionReady(restoreHints) {
    const lastStep = restoreHints?.lastStep || null;
    const currentSlotId = restoreHints?.currentSlotId || null;
    const lastPublicLetterId = restoreHints?.lastPublicLetterId || null;
    const flowMode = restoreHints?.flowMode || null;

    if (state.collectionInitInProgress || collectionAwaitingInit()) {
      setupCollectionInit();
      showStep("step-collection-init");
      return;
    }

    if (lastStep === "step-success" && lastPublicLetterId) {
      const slot = state.slots.find(
        (s) => s.public_letter_id === lastPublicLetterId,
      );
      if (slot) {
        showSuccessScreen(slot);
        return;
      }
    }

    if (lastStep === "step-write" && currentSlotId) {
      const slot = state.slots.find((s) => s.slot_id === currentSlotId);
      if (slot && slot.slot_status !== "SEALED") {
        if (flowMode === "collection-write" || isPredefinedCollection()) {
          openPredefinedSlot(slot);
          return;
        }
        if (flowMode === "free-moment") {
          openFreeCollectionSlot(slot);
          return;
        }
        if (slot.delivery_at && slot.recipient_context?.relationship) {
          state.currentSlot = slot;
          state.flowMode = "single";
          state.dateLocked = Boolean(slot.delivery_at);
          state.recipientLocked = false;
          state.deliveryAt = slot.delivery_at;
          state.recipient = slot.recipient_context.relationship;
          state.dearLine = slot.recipient_context.recipient_name || "";
          goWrite();
          return;
        }
      }
    }

    if (
      lastStep === "step-collection-recipient-setup" &&
      state.needsRecipientSetup &&
      isPredefinedCollection()
    ) {
      setupCollectionRecipientSetup();
      showStep("step-collection-recipient-setup");
      return;
    }

    if (state.inCollection && state.slots.length) {
      if (state.needsRecipientSetup && isPredefinedCollection()) {
        setupCollectionRecipientSetup();
        showStep("step-collection-recipient-setup");
        return;
      }
      renderCollection();
      showStep("step-collection");
    } else if (
      state.slots.length === 1 &&
      state.slots[0].slot_status === "SEALED"
    ) {
      showAlreadySealedSingle(state.slots[0]);
    } else if (state.slots.length === 1) {
      startSingleFlow(state.slots[0]);
    } else {
      renderCollection();
      showStep("step-collection");
    }
  }

  async function tryRestoreVaultSession() {
    const stored = restoreVaultSessionFromStorage();
    if (!stored) return false;

    state.session = stored.session;
    state.entitlementId = stored.entitlementId;
    state.purchaserEmail = stored.purchaserEmail || null;

    const st = await api("/v1/vault/state");
    if (st.status !== 200 || st.json.status !== "ok") {
      clearVaultSessionStorage();
      state.session = null;
      state.entitlementId = null;
      return false;
    }

    applyVaultPayloadFromApi(st.json, stored.purchaserEmail);
    showPurchaserPromiseIfNeeded(function () {
      routeAfterVaultSessionReady(stored);
    });
    return true;
  }

  function renderSuccessCancelActions(slot) {
    const wrap = $("success-cancel-actions");
    if (!wrap || !window.LvCancel) return;
    wrap.innerHTML = "";
    if (LvCancel.isSlotCancelled(slot)) {
      wrap.innerHTML =
        '<p class="slot-status-cancelled">CANCELLED</p>' +
        (!state.inCollection
          ? '<p class="vault-hint">This letter has been cancelled.<br>It will not be delivered. No further action is needed.</p>'
          : '<p class="vault-hint">This letter will not be delivered. It remains in your Vault as a record.</p>');
      return;
    }
    if (!LvCancel.isSlotCancellable(slot)) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "link-btn-destructive";
    btn.textContent = "CANCEL THIS LETTER";
    btn.addEventListener("click", () => {
      LvCancel.openCancelLetter(slot, {
        onSuccess: () => {
          renderSuccessCancelActions(
            state.slots.find((s) => s.public_letter_id === slot.public_letter_id) ||
              { ...slot, letter_status: "CANCELLED", cancellable: false },
          );
        },
        onError: showError,
      });
    });
    wrap.appendChild(btn);
  }

  function showAlreadySealedSingle(slot) {
    showSuccessScreen(slot, { hideReturnCollection: true });
  }

  function renderRecoveryConfirmSummary(purchase) {
    const wrap = $("recovery-confirm-summary");
    if (!wrap || !purchase) return;
    wrap.innerHTML =
      '<div class="review-summary-item">' +
      '<p class="review-summary-label">Purchase</p>' +
      '<p class="review-summary-value">' +
      (purchase.display_title || purchase.product_label || "Letter Vault purchase") +
      "</p></div>" +
      '<div class="review-summary-item">' +
      '<p class="review-summary-label">Purchased</p>' +
      '<p class="review-summary-value">' +
      (purchase.purchase_month_year || "—") +
      "</p></div>" +
      '<div class="review-summary-item">' +
      '<p class="review-summary-label">Progress</p>' +
      '<p class="review-summary-value">' +
      (purchase.progress_label || "—") +
      "</p></div>";
  }

  async function loadRecoveryPreview(rawToken) {
    showError("");
    state.recoveryToken = rawToken;
    const res = await api("/v1/vault/access-recovery/preview", {
      method: "POST",
      body: JSON.stringify({ recovery_token: rawToken }),
    });
    if (res.status !== 200 || res.json.status !== "ok") {
      showError("This recovery link is invalid or has expired. You can request a new one from the Vault entry screen.");
      showStep("step-entry");
      state.recoveryToken = null;
      return false;
    }
    renderRecoveryConfirmSummary(res.json.purchase);
    showStep("step-recovery-confirm");
    return true;
  }

  function tryOpenRecoveryFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const rawToken = params.get("recovery_token")?.trim();
    if (!rawToken) return false;
    window.history.replaceState({}, "", window.location.pathname);
    loadRecoveryPreview(rawToken);
    return true;
  }

  const RECOVERY_REQUEST_BUTTON_LABEL = "SEND RECOVERY INSTRUCTIONS →";
  const RECOVERY_REQUEST_NEUTRAL =
    "If we found a Letter Vault purchase for this email, we've sent recovery instructions.";
  let recoveryRequestPending = false;

  function showRecoveryRequestStatus(message, kind) {
    const el = $("recovery-request-status");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("is-error", kind === "error");
    el.hidden = !message;
  }

  function setRecoveryRequestPending(pending) {
    recoveryRequestPending = pending;
    const btn = $("btn-recovery-request");
    const form = $("form-recovery-request");
    if (btn) {
      btn.disabled = pending;
      btn.textContent = pending ? "SENDING…" : RECOVERY_REQUEST_BUTTON_LABEL;
      btn.setAttribute("aria-busy", pending ? "true" : "false");
    }
    if (form) form.setAttribute("aria-busy", pending ? "true" : "false");
  }

  $("go-recovery-request")?.addEventListener("click", () => {
    showError("");
    showRecoveryRequestStatus("", "ok");
    setRecoveryRequestPending(false);
    $("recovery-email").value = $("purchase-email")?.value?.trim() || "";
    showStep("step-recovery-request");
  });
  $("back-entry-from-recovery")?.addEventListener("click", exitToEntry);
  $("back-entry-from-recovery-confirm")?.addEventListener("click", exitToEntry);
  $("btn-recovery-success-entry")?.addEventListener("click", exitToEntry);

  $("form-recovery-request")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (recoveryRequestPending) return;
    showError("");
    const email = $("recovery-email").value.trim();
    if (!email) {
      showRecoveryRequestStatus(
        "Please enter the email address you used for your purchase.",
        "error",
      );
      return;
    }
    setRecoveryRequestPending(true);
    showRecoveryRequestStatus("Sending your request…", "pending");
    try {
      const res = await api("/v1/vault/access-recovery/request", {
        method: "POST",
        body: JSON.stringify({ purchaser_email: email }),
      });
      if (res.status === 429) {
        showRecoveryRequestStatus("Too many attempts. Please wait and try again.", "error");
        return;
      }
      if (res.status !== 200 || res.json?.status !== "ok") {
        showRecoveryRequestStatus(
          "We couldn't send the recovery request. Please try again.",
          "error",
        );
        return;
      }
      showRecoveryRequestStatus(RECOVERY_REQUEST_NEUTRAL, "ok");
    } catch {
      showRecoveryRequestStatus(
        "We couldn't send the recovery request. Please check your connection and try again.",
        "error",
      );
    } finally {
      setRecoveryRequestPending(false);
    }
  });

  $("btn-recovery-complete")?.addEventListener("click", async () => {
    showError("");
    if (!state.recoveryToken) {
      showError("This recovery link is invalid or has expired.");
      showStep("step-entry");
      return;
    }
    const res = await api("/v1/vault/access-recovery/complete", {
      method: "POST",
      body: JSON.stringify({ recovery_token: state.recoveryToken }),
    });
    state.recoveryToken = null;
    if (res.status !== 200 || res.json.status !== "ok") {
      showError("This recovery link is invalid or has expired. You can request a new one from the Vault entry screen.");
      showStep("step-entry");
      return;
    }
    if ($("recovery-success-message")) {
      $("recovery-success-message").textContent =
        res.json.message ||
        "Your new access code has been sent to your purchase email. Use it with the same email address to enter your Vault.";
    }
    showStep("step-recovery-success");
  });

  $("go-manage").addEventListener("click", () => showStep("step-manage-entry"));
  $("back-entry").addEventListener("click", exitToEntry);

  $("form-manage").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (window.LvManage) await LvManage.submitSecureLinkRequest();
  });
  $("manage-sent-back").addEventListener("click", exitToEntry);
  $("manage-delivery-back")?.addEventListener("click", () => {
    if (window.LvManage?.returnStep) {
      showStep(window.LvManage.returnStep);
      return;
    }
    showStep(state.inCollection ? "step-collection" : "step-entry");
  });

  function effectiveCollectionInitRelationship() {
    if (!state.collectionInitRecipient) return null;
    if (state.collectionInitRecipient === "Someone else") {
      const rel = $("collection-init-custom-relationship")?.value.trim();
      return rel ? normalizeUserEnteredDisplayText(rel) : null;
    }
    return state.collectionInitRecipient;
  }

  function predefinedCollectionHeadline(relationship) {
    const count = state.lettersAllowed;
    const unit =
      state.mechanism === "FIXED_MILESTONES"
        ? "milestone letter" + (count === 1 ? "" : "s")
        : "letter" + (count === 1 ? "" : "s");
    const base = count ? count + " " + unit : "Your letter collection";
    if (!relationship) return base;
    return base + " for " + relationship;
  }

  function milestoneInitBirthCopy(relationship) {
    const choice = futureOccasionPhrase("birthday");
    if (!relationship) {
      return "Choose who these letters are for, then enter their date of birth.";
    }
    if (relationship === "My daughter") {
      return "When was she born? Then choose " + choice + ".";
    }
    if (relationship === "My son") {
      return "When was he born? Then choose " + choice + ".";
    }
    if (relationship === "Myself") {
      return "When were you born? Then choose " + choice + ".";
    }
    return "What is their date of birth? Then choose " + choice + ".";
  }

  function milestoneBirthdayIsoFromDob(dobIso, age) {
    const base = new Date(dobIso.slice(0, 10) + "T12:00:00.000Z");
    base.setUTCFullYear(base.getUTCFullYear() + age);
    const y = base.getUTCFullYear();
    const m = String(base.getUTCMonth() + 1).padStart(2, "0");
    const d = String(base.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + d + "T12:00:00.000Z";
  }

  function milestoneAgePreviewLine(dob, age) {
    if (!dob || age == null || !Number.isInteger(age) || age < 1) return "";
    const iso = milestoneBirthdayIsoFromDob(dob, age);
    if (!isFutureDate(iso)) {
      return "This birthday has already passed.";
    }
    return "→ " + ordinalAgeLabel(age) + " · " + formatWrittenDate(iso);
  }

  function collectionInitRecipientContextForApi() {
    const relationship = effectiveCollectionInitRelationship();
    if (!relationship) return undefined;
    const ctx = { relationship };
    const name = $("collection-init-recipient-name")?.value.trim();
    if (name) ctx.recipient_name = normalizeUserEnteredDisplayText(name);
    return ctx;
  }

  function refreshCollectionInitRecipientDisplay() {
    const relationship = effectiveCollectionInitRelationship();
    const titleEl = $("collection-title-display");
    const copyEl = $("collection-init-copy");
    if (titleEl) {
      showCollectionSubtitle(titleEl, predefinedCollectionHeadline(relationship));
    }
    if (copyEl && state.mechanism === "FIXED_MILESTONES") {
      copyEl.textContent = milestoneInitBirthCopy(relationship);
    }
    if (copyEl && state.mechanism === "RECURRING") {
      copyEl.textContent = recurringInitCopy(relationship);
    }
    if (state.mechanism === "RECURRING") {
      const baseLabel = $("collection-init-fields")?.querySelector('label[for="base-date"]');
      if (baseLabel) baseLabel.textContent = recurringBaseDateLabel();
      if (recurringCollectionType() === "anniversary") {
        if (state.collectionInitRecipient === "Myself") {
          state.collectionRecipientIsMinor = false;
          setAnniversarySetupFieldsVisible(true);
          if ($("base-date")?.value) {
            setupAnniversaryNumberPicker();
          }
        } else if (state.collectionInitRecipient === "My partner") {
          maybePromptAnniversaryPartnerAgeGate();
        } else {
          setAnniversarySetupFieldsVisible(false);
        }
      } else if ($("base-date")?.value) {
        maybeRevealBirthdayRecurringPreview();
      }
    }
    if (state.mechanism === "FIXED_MILESTONES" && $("base-date")?.value) {
      maybeRevealFixedMilestonesMilestonePicker();
    }
  }

  function predefinedRecipientFieldsHtml() {
    if (!isPredefinedCollection()) return "";
    return (
      '<p class="vault-sub">Who are these letters for?</p>' +
      '<div class="choice-grid" id="collection-init-recipient-grid"></div>' +
      '<div id="collection-init-someone-else" hidden>' +
      '<label for="collection-init-custom-relationship">Who is this person to you?</label>' +
      '<input type="text" id="collection-init-custom-relationship" placeholder="e.g. Sister, grandmother, colleague">' +
      "</div>" +
      '<div id="collection-init-name-fields" hidden>' +
      '<label for="collection-init-recipient-name" id="collection-init-recipient-name-label">Their name</label>' +
      '<input type="text" id="collection-init-recipient-name" placeholder="e.g. Emma" autocomplete="name">' +
      "</div>" +
      (state.mechanism === "FIXED_MILESTONES" || isBirthdayRecurring()
        ? ""
        : '<div id="collection-init-age-panel" class="recipient-age-panel" hidden>' +
          '<p class="vault-sub">Is this person under 18?</p>' +
          '<div class="choice-grid recipient-age-grid">' +
          '<button type="button" class="choice-btn" data-collection-age="no"><span class="choice-label">NO</span></button>' +
          '<button type="button" class="choice-btn" data-collection-age="yes"><span class="choice-label">YES</span></button>' +
          "</div></div>")
    );
  }

  function setupPredefinedRecipientGrid(gridId, someoneElseId, nameFieldsId, nameLabelId, nameInputId, onSelect, recipients) {
    const grid = $(gridId);
    if (!grid) return;
    grid.innerHTML = "";
    state.collectionInitRecipient = null;
    const choices = recipients || RECIPIENTS;
    choices.forEach((r) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-btn";
      btn.setAttribute("aria-pressed", "false");
      btn.innerHTML =
        "<span class='choice-label'>" + r.label + "</span><span class='choice-hint'>" + r.hint + "</span>";
      btn.addEventListener("click", () => {
        if (state.mechanism === "FIXED_MILESTONES") {
          resetFixedMilestonesGuardianGate();
        } else if (isBirthdayRecurring()) {
          resetBirthdayRecurringGuardianGate();
        } else if (
          state.mechanism === "RECURRING" &&
          recurringCollectionType() === "anniversary"
        ) {
          resetAnniversaryPartnerAgeGate();
        }
        state.collectionInitRecipient = r.label;
        grid.querySelectorAll(".choice-btn").forEach((b) => {
          const on = b === btn;
          b.classList.toggle("selected", on);
          b.setAttribute("aria-pressed", on ? "true" : "false");
        });
        const someoneElse = $(someoneElseId);
        if (someoneElse) someoneElse.hidden = r.label !== "Someone else";
        const nameFields = $(nameFieldsId);
        if (r.label === "Someone else") {
          if (nameFields) nameFields.hidden = false;
          if (nameLabelId && nameInputId) {
            $(nameLabelId).textContent = recipientNameLabelForRelationship("Someone else");
            $(nameInputId).placeholder = recipientNamePlaceholderForRelationship("Someone else");
          }
        } else if (onSelect) {
          onSelect(r.label);
        }
        refreshCollectionInitRecipientDisplay();
      });
      grid.appendChild(btn);
    });
    const nameFields = $(nameFieldsId);
    if (nameFields) nameFields.hidden = true;
  }

  function showCollectionInitNameFields(relationship) {
    const fields = $("collection-init-name-fields");
    if (!fields) return;
    $("collection-init-recipient-name-label").textContent =
      recipientNameLabelForRelationship(relationship);
    $("collection-init-recipient-name").placeholder =
      recipientNamePlaceholderForRelationship(relationship);
    fields.hidden = false;
  }

  function readSharedRecipientContext(fieldIds) {
    const relInput = state.collectionInitRecipient;
    if (!relInput) return null;
    const someoneElseEl = $(fieldIds.someoneElseInput);
    const nameEl = $(fieldIds.nameInput);
    const relationship =
      relInput === "Someone else"
        ? normalizeUserEnteredDisplayText(
            someoneElseEl?.value.trim() || "Someone special",
          )
        : relInput;
    const name = nameEl?.value.trim() || "";
    if (!relationship || (relInput !== "Myself" && !name)) return null;
    const ctx = { relationship };
    if (name) ctx.recipient_name = normalizeUserEnteredDisplayText(name);
    if (relInput !== "Myself" && isBirthdayRecurring() && $("base-date")?.value) {
      ctx.recipient_is_minor = isCurrentlyUnder18FromDob($("base-date").value);
    } else if (relInput !== "Myself" && state.collectionRecipientIsMinor === true) {
      ctx.recipient_is_minor = true;
    } else if (relInput !== "Myself" && state.collectionRecipientIsMinor === false) {
      ctx.recipient_is_minor = false;
    }
    return ctx;
  }

  function setupCollectionInit() {
    state.selectedMilestoneAges = [];
    state.milestoneOptions = [];
    state.collectionInitRecipient = null;
    state.fixedMilestonesGuardianConfirmedForInit = false;
    state.fixedMilestonesGuardianModalPending = false;
    state.birthdayRecurringGuardianConfirmedForInit = false;
    state.birthdayRecurringGuardianModalPending = false;
    state.anniversaryPartnerAgeConfirmed18Plus = false;
    state.anniversaryPartnerAgeBlocked = false;
    state.anniversaryPartnerAgeModalPending = false;
    $("btn-collection-init").textContent = "CREATE MY COLLECTION";
    $("btn-collection-init").disabled = false;

    if (state.mechanism === "FIXED_MILESTONES") {
      $("collection-init-fields").innerHTML =
        predefinedRecipientFieldsHtml() +
        '<label for="base-date">Date of birth</label>' +
        '<input type="date" id="base-date" required>' +
        '<div id="milestone-age-picker" hidden></div>';
      setupPredefinedRecipientGrid(
        "collection-init-recipient-grid",
        "collection-init-someone-else",
        "collection-init-name-fields",
        "collection-init-recipient-name-label",
        "collection-init-recipient-name",
        showCollectionInitNameFields,
        predefinedRecipientsForCollection(),
      );
      refreshCollectionInitRecipientDisplay();
      $("collection-init-custom-relationship")?.addEventListener(
        "input",
        refreshCollectionInitRecipientDisplay,
      );
      $("btn-collection-init").disabled = true;
      $("btn-collection-init").textContent = "CREATE MY COLLECTION";
      setTimeout(function () {
        const bd = $("base-date");
        if (bd) {
          bd.onchange = onFixedMilestonesDobChange;
          bd.oninput = onFixedMilestonesDobChange;
        }
        $("collection-init-recipient-name")?.addEventListener(
          "input",
          maybeRevealFixedMilestonesMilestonePicker,
        );
      }, 0);
    } else if (state.mechanism === "RECURRING") {
      $("collection-init-copy").textContent = recurringInitCopy(null);
      const isAnniversary = recurringCollectionType() === "anniversary";
      $("collection-init-fields").innerHTML =
        predefinedRecipientFieldsHtml() +
        '<label for="base-date">' +
        recurringBaseDateLabel() +
        '</label>' +
        '<input type="date" id="base-date" required>' +
        (isAnniversary
          ? '<div id="anniversary-number-picker" hidden></div>'
          : '<div id="recurring-preview" hidden></div>');
      setupPredefinedRecipientGrid(
        "collection-init-recipient-grid",
        "collection-init-someone-else",
        "collection-init-name-fields",
        "collection-init-recipient-name-label",
        "collection-init-recipient-name",
        showCollectionInitNameFields,
        predefinedRecipientsForCollection(),
      );
      refreshCollectionInitRecipientDisplay();
      if (isAnniversary) {
        setAnniversarySetupFieldsVisible(false);
      }
      $("collection-init-custom-relationship")?.addEventListener(
        "input",
        refreshCollectionInitRecipientDisplay,
      );
      $("btn-collection-init").disabled = true;
      $("btn-collection-init").textContent = "CREATE MY COLLECTION";
      setTimeout(function () {
        const bd = $("base-date");
        if (bd) {
          bd.onchange = isAnniversary
            ? setupAnniversaryNumberPicker
            : function () {
                state.birthdayRecurringGuardianConfirmedForInit = false;
                state.birthdayRecurringGuardianModalPending = false;
                hideRecipientAgePanel("collection-init-age-panel");
                maybeRevealBirthdayRecurringPreview();
              };
        }
        if (!isAnniversary) {
          $("collection-init-recipient-name")?.addEventListener(
            "input",
            maybeRevealBirthdayRecurringPreview,
          );
        }
        if (isAnniversary) {
          $("collection-init-recipient-name")?.addEventListener(
            "input",
            maybePromptAnniversaryPartnerAgeGate,
          );
        }
      }, 0);
    } else {
      showCollectionSubtitle($("collection-title-display"), state.displayTitle || "");
      const count = plannedLetterCount();
      const slotWord = count === 1 ? "letter slot" : "letter slots";
      $("collection-init-copy").textContent = count
        ? "We'll prepare " + count + " " + slotWord + ". You can choose each moment when you're ready."
        : "We'll prepare your letter slots. You can choose each moment when you're ready.";
      $("collection-init-fields").innerHTML = "";
    }
  }

  function ordinalAnniversaryLabel(number) {
    const mod100 = number % 100;
    const mod10 = number % 10;
    let suffix = "th";
    if (mod10 === 1 && mod100 !== 11) suffix = "st";
    else if (mod10 === 2 && mod100 !== 12) suffix = "nd";
    else if (mod10 === 3 && mod100 !== 13) suffix = "rd";
    return number + suffix + " anniversary";
  }

  function anniversaryPreviewLine(baseDate, number) {
    if (!baseDate || number == null || !Number.isInteger(number) || number < 1) return "";
    const iso = milestoneBirthdayIsoFromDob(baseDate, number);
    if (!isFutureDate(iso)) {
      return "This anniversary has already passed.";
    }
    return "→ " + ordinalAnniversaryLabel(number) + " · " + formatWrittenDate(iso);
  }

  function setupAnniversaryNumberPicker() {
    showError("");
    if (
      isAnniversaryPartnerInitFlow() &&
      !state.anniversaryPartnerAgeConfirmed18Plus
    ) {
      return;
    }
    const baseDate = $("base-date")?.value;
    const picker = $("anniversary-number-picker");
    if (!baseDate || !picker) return;

    const count = state.lettersAllowed || 5;
    state.selectedAnniversaryNumbers = [];
    picker.hidden = false;

    let rows = "";
    for (let i = 1; i <= count; i++) {
      rows +=
        '<div class="milestone-age-row">' +
        '<label for="anniversary-number-' +
        i +
        '">LETTER ' +
        i +
        " — ANNIVERSARY</label>" +
        '<input type="number" id="anniversary-number-' +
        i +
        '" class="milestone-age-input" min="1" step="1" inputmode="numeric" autocomplete="off">' +
        '<p class="milestone-age-preview" id="anniversary-number-preview-' +
        i +
        '" aria-live="polite"></p>' +
        "</div>";
    }

    picker.innerHTML =
      '<p class="vault-sub milestone-age-heading">CHOOSE THE ' +
      count +
      " ANNIVERSARIES THESE LETTERS ARE FOR</p>" +
      rows +
      '<p id="anniversary-selection-error" class="vault-error" hidden role="alert"></p>';

    for (let i = 1; i <= count; i++) {
      const input = $("anniversary-number-" + i);
      if (input) {
        input.addEventListener("input", updateAnniversaryNumberPickerUi);
      }
    }

    updateAnniversaryNumberPickerUi();
  }

  function readAnniversaryNumberInputs() {
    const count = state.lettersAllowed || 5;
    const numbers = [];
    for (let i = 1; i <= count; i++) {
      const raw = $("anniversary-number-" + i)?.value.trim();
      if (!raw) return null;
      const number = Number(raw);
      if (!Number.isInteger(number) || number < 1) return null;
      numbers.push(number);
    }
    return numbers;
  }

  function validateAnniversaryNumberInputsClient(baseDate, numbers) {
    if (!numbers || numbers.length !== (state.lettersAllowed || 5)) {
      return "Please enter exactly " + (state.lettersAllowed || 5) + " anniversary numbers.";
    }
    if (new Set(numbers).size !== numbers.length) {
      return "Each anniversary number can only be used once.";
    }
    for (const number of numbers) {
      if (!Number.isInteger(number) || number < 1) {
        return "Each anniversary number must be a positive whole number.";
      }
      const iso = milestoneBirthdayIsoFromDob(baseDate, number);
      if (!isFutureDate(iso)) {
        return "The " + ordinalAnniversaryLabel(number) + " has already passed. Choose future anniversaries only.";
      }
    }
    return null;
  }

  function updateAnniversaryNumberPickerUi() {
    const baseDate = $("base-date")?.value;
    const count = state.lettersAllowed || 5;
    if (!baseDate) return;

    for (let i = 1; i <= count; i++) {
      const input = $("anniversary-number-" + i);
      const preview = $("anniversary-number-preview-" + i);
      if (!input || !preview) continue;
      const raw = input.value.trim();
      if (!raw) {
        preview.textContent = "";
        continue;
      }
      const number = Number(raw);
      preview.textContent = anniversaryPreviewLine(baseDate, number);
    }

    const numbers = readAnniversaryNumberInputs();
    const validationError = describeAnniversaryInputProblem(baseDate, count);
    state.selectedAnniversaryNumbers = numbers && !validationError ? numbers : [];
    const errEl = $("anniversary-selection-error");
    if (errEl) {
      errEl.textContent = validationError || "";
      errEl.hidden = !validationError;
    }
    $("btn-collection-init").disabled =
      state.mechanism === "RECURRING" &&
      recurringCollectionType() === "anniversary" &&
      !state.selectedAnniversaryNumbers.length;
  }

  function describeAnniversaryInputProblem(baseDate, count) {
    const seen = new Set();
    let filled = 0;
    for (let i = 1; i <= count; i++) {
      const raw = $("anniversary-number-" + i)?.value.trim();
      if (!raw) continue;
      filled += 1;
      const number = Number(raw);
      if (!Number.isInteger(number) || number < 1) {
        return "Each anniversary number must be a positive whole number.";
      }
      if (seen.has(number)) return "Each anniversary number can only be used once.";
      seen.add(number);
      if (!isFutureDate(milestoneBirthdayIsoFromDob(baseDate, number))) {
        return (
          "The " +
          ordinalAnniversaryLabel(number) +
          " has already passed. Choose future anniversaries only."
        );
      }
    }
    if (filled === count) {
      return validateAnniversaryNumberInputsClient(baseDate, readAnniversaryNumberInputs());
    }
    return null;
  }

  function maybeRevealBirthdayRecurringPreview() {
    if (!isBirthdayRecurring()) return;
    showError("");
    const dob = $("base-date")?.value;
    if (!dob) {
      resetBirthdayRecurringGuardianGate();
      return;
    }
    if (state.collectionInitRecipient === "Myself") {
      state.collectionRecipientIsMinor = false;
      state.birthdayRecurringGuardianConfirmedForInit = true;
      loadRecurringPreview();
      return;
    }
    const ctx = readSharedRecipientContext({
      someoneElseInput: "collection-init-custom-relationship",
      nameInput: "collection-init-recipient-name",
    });
    if (!ctx) {
      resetBirthdayRecurringGuardianGate();
      return;
    }
    const isMinor = isCurrentlyUnder18FromDob(dob);
    state.collectionRecipientIsMinor = isMinor;
    if (!isMinor) {
      state.birthdayRecurringGuardianConfirmedForInit = true;
      loadRecurringPreview();
      return;
    }
    if (state.birthdayRecurringGuardianConfirmedForInit) {
      loadRecurringPreview();
      return;
    }
    const guardianView = $("recipient-age-modal-guardian-view");
    const modalOpen =
      $("recipient-age-modal") &&
      !$("recipient-age-modal").hidden &&
      guardianView &&
      !guardianView.hidden;
    if (modalOpen || state.birthdayRecurringGuardianModalPending) return;
    const panel = $("recurring-preview");
    if (panel) panel.hidden = true;
    $("btn-collection-init").disabled = true;
    state.birthdayRecurringGuardianModalPending = true;
    showCollectionInitGuardianModal(function () {
      state.birthdayRecurringGuardianModalPending = false;
      state.birthdayRecurringGuardianConfirmedForInit = true;
      loadRecurringPreview();
    });
  }

  async function loadRecurringPreview() {
    showError("");
    if (recurringCollectionType() === "anniversary") {
      setupAnniversaryNumberPicker();
      return;
    }
    if (
      isBirthdayRecurring() &&
      state.collectionInitRecipient !== "Myself" &&
      state.collectionRecipientIsMinor &&
      !state.birthdayRecurringGuardianConfirmedForInit
    ) {
      $("btn-collection-init").disabled = true;
      return;
    }
    const bd = $("base-date")?.value;
    const panel = $("recurring-preview");
    if (!bd || !panel) return;
    const res = await api("/v1/vault/collection/recurring-preview", {
      method: "POST",
      body: JSON.stringify({ base_date: bd }),
    });
    if (isSessionExpiredResponse(res)) {
      handleSessionExpired();
      return;
    }
    if (res.networkError || res.status !== 200 || res.json.status !== "ok") {
      showError(res.json.message || "Could not preview dates.");
      panel.hidden = true;
      $("btn-collection-init").disabled = true;
      return;
    }
    panel.hidden = false;
    const lines = (res.json.preview_slots || [])
      .map((s) => "<li>" + s.delivery_written + "</li>")
      .join("");
    panel.innerHTML =
      '<p class="vault-sub">Your letters will arrive on:</p><ul class="recurring-preview-list">' +
      lines +
      "</ul>";
    $("btn-collection-init").disabled = false;
  }

  function onFixedMilestonesDobChange() {
    state.fixedMilestonesGuardianConfirmedForInit = false;
    state.fixedMilestonesGuardianModalPending = false;
    maybeRevealFixedMilestonesMilestonePicker();
  }

  function maybeRevealFixedMilestonesMilestonePicker() {
    if (state.mechanism !== "FIXED_MILESTONES") return;
    showError("");
    const dob = $("base-date")?.value;
    if (!dob) {
      resetFixedMilestonesGuardianGate();
      return;
    }
    if (state.collectionInitRecipient === "Myself") {
      state.collectionRecipientIsMinor = false;
      state.fixedMilestonesGuardianConfirmedForInit = true;
      setupMilestoneAgePicker();
      return;
    }
    const ctx = readSharedRecipientContext({
      someoneElseInput: "collection-init-custom-relationship",
      nameInput: "collection-init-recipient-name",
    });
    if (!ctx) {
      hideFixedMilestonesMilestonePicker();
      return;
    }
    const isMinor = isCurrentlyUnder18FromDob(dob);
    state.collectionRecipientIsMinor = isMinor;
    if (!isMinor) {
      state.fixedMilestonesGuardianConfirmedForInit = true;
      setupMilestoneAgePicker();
      return;
    }
    hideFixedMilestonesMilestonePicker();
    if (state.fixedMilestonesGuardianConfirmedForInit) {
      setupMilestoneAgePicker();
      return;
    }
    const guardianView = $("recipient-age-modal-guardian-view");
    const modalOpen =
      $("recipient-age-modal") &&
      !$("recipient-age-modal").hidden &&
      guardianView &&
      !guardianView.hidden;
    if (modalOpen || state.fixedMilestonesGuardianModalPending) {
      return;
    }
    state.fixedMilestonesGuardianModalPending = true;
    showCollectionInitGuardianModal(function () {
      state.fixedMilestonesGuardianModalPending = false;
      state.fixedMilestonesGuardianConfirmedForInit = true;
      setupMilestoneAgePicker();
    });
  }

  function setupMilestoneAgePicker() {
    showError("");
    const dob = $("base-date")?.value;
    const picker = $("milestone-age-picker");
    if (!dob || !picker) return;

    const count = state.lettersAllowed || 5;
    state.selectedMilestoneAges = [];
    picker.hidden = false;

    let rows = "";
    for (let i = 1; i <= count; i++) {
      rows +=
        '<div class="milestone-age-row">' +
        '<label for="milestone-age-' +
        i +
        '">LETTER ' +
        i +
        " — AGE</label>" +
        '<input type="number" id="milestone-age-' +
        i +
        '" class="milestone-age-input" min="1" step="1" inputmode="numeric" autocomplete="off">' +
        '<p class="milestone-age-preview" id="milestone-age-preview-' +
        i +
        '" aria-live="polite"></p>' +
        "</div>";
    }

    picker.innerHTML =
      '<p class="vault-sub milestone-age-heading">CHOOSE THE ' +
      count +
      " BIRTHDAYS THESE LETTERS ARE FOR</p>" +
      rows +
      '<p id="milestone-selection-error" class="vault-error" hidden role="alert"></p>';

    for (let i = 1; i <= count; i++) {
      const input = $("milestone-age-" + i);
      if (input) {
        input.addEventListener("input", updateMilestoneAgePickerUi);
      }
    }

    updateMilestoneAgePickerUi();
  }

  function readMilestoneAgeInputs() {
    const count = state.lettersAllowed || 5;
    const ages = [];
    for (let i = 1; i <= count; i++) {
      const raw = $("milestone-age-" + i)?.value.trim();
      if (!raw) return null;
      const age = Number(raw);
      if (!Number.isInteger(age) || age < 1) return null;
      ages.push(age);
    }
    return ages;
  }

  function validateMilestoneAgeInputsClient(dob, ages) {
    if (!ages || ages.length !== (state.lettersAllowed || 5)) {
      return "Please enter exactly " + (state.lettersAllowed || 5) + " birthday ages.";
    }
    if (new Set(ages).size !== ages.length) {
      return "Each birthday age can only be used once.";
    }
    for (const age of ages) {
      if (!Number.isInteger(age) || age < 1) {
        return "Each birthday age must be a positive whole number.";
      }
      const iso = milestoneBirthdayIsoFromDob(dob, age);
      if (!isFutureDate(iso)) {
        return "The " + ordinalAgeLabel(age) + " has already passed. Choose future birthdays only.";
      }
    }
    return null;
  }

  function updateMilestoneAgePickerUi() {
    const dob = $("base-date")?.value;
    const count = state.lettersAllowed || 5;
    if (!dob) return;

    for (let i = 1; i <= count; i++) {
      const input = $("milestone-age-" + i);
      const preview = $("milestone-age-preview-" + i);
      if (!input || !preview) continue;
      const raw = input.value.trim();
      if (!raw) {
        preview.textContent = "";
        continue;
      }
      const age = Number(raw);
      preview.textContent = milestoneAgePreviewLine(dob, age);
    }

    const ages = readMilestoneAgeInputs();
    const validationError = describeMilestoneInputProblem(dob, count);
    state.selectedMilestoneAges = ages && !validationError ? ages : [];
    const errEl = $("milestone-selection-error");
    if (errEl) {
      errEl.textContent = validationError || "";
      errEl.hidden = !validationError;
    }
    $("btn-collection-init").disabled =
      state.mechanism === "FIXED_MILESTONES" && !state.selectedMilestoneAges.length;
  }

  function describeMilestoneInputProblem(dob, count) {
    const seen = new Set();
    let filled = 0;
    for (let i = 1; i <= count; i++) {
      const raw = $("milestone-age-" + i)?.value.trim();
      if (!raw) continue;
      filled += 1;
      const age = Number(raw);
      if (!Number.isInteger(age) || age < 1) {
        return "Each birthday age must be a positive whole number.";
      }
      if (seen.has(age)) return "Each birthday age can only be used once.";
      seen.add(age);
      if (!isFutureDate(milestoneBirthdayIsoFromDob(dob, age))) {
        return "The " + ordinalAgeLabel(age) + " has already passed. Choose future birthdays only.";
      }
    }
    if (filled === count) {
      return validateMilestoneAgeInputsClient(dob, readMilestoneAgeInputs());
    }
    return null;
  }

  function setupCollectionRecipientSetup() {
    setupPredefinedRecipientGrid(
      "collection-recipient-choices",
      "collection-recipient-someone-else",
      "collection-recipient-name-fields",
      "collection-recipient-name-label",
      "collection-recipient-name",
      function (relationship) {
        $("collection-recipient-name-label").textContent =
          recipientNameLabelForRelationship(relationship);
        $("collection-recipient-name").placeholder =
          recipientNamePlaceholderForRelationship(relationship);
        $("collection-recipient-name-fields").hidden = false;
      },
      predefinedRecipientsForCollection(),
    );
    $("collection-custom-relationship").value = "";
    $("collection-recipient-name").value = "";
    state.collectionInitRecipient = null;
  }

  async function saveCollectionRecipientSetup() {
    const ctx = readSharedRecipientContext({
      someoneElseInput: "collection-custom-relationship",
      nameInput: "collection-recipient-name",
    });
    if (!ctx) {
      showError("Please choose who this collection is for and enter their name.");
      return;
    }
    const res = await api("/v1/vault/collection/recipient-setup", {
      method: "POST",
      body: JSON.stringify({ shared_recipient_context: ctx }),
    });
    if (res.status !== 200 || res.json.status !== "ok") {
      showError(res.json.message || "Could not save recipient.");
      return;
    }
    state.slots = res.json.slots || state.slots;
    applyCollectionFromResponse(res.json);
    if (ctx.relationship) state.sharedRecipient = ctx.relationship;
    renderCollection();
    showStep("step-collection");
  }

  $("btn-collection-recipient-save")?.addEventListener("click", async () => {
    showError("");
    const ctx = readSharedRecipientContext({
      someoneElseInput: "collection-custom-relationship",
      nameInput: "collection-recipient-name",
    });
    if (!ctx) {
      showError("Please choose who this collection is for and enter their name.");
      return;
    }
    if (ctx.relationship === "Myself") {
      state.collectionRecipientIsMinor = false;
      saveCollectionRecipientSetup();
      return;
    }
    showRecipientAgePanel("collection-recipient-age-panel", function () {
      saveCollectionRecipientSetup();
    });
  });

  function validateFixedMilestonesInitInputs() {
    const bd = $("base-date");
    if (!bd?.value) {
      return "Please enter the date.";
    }
    const ages = readMilestoneAgeInputs();
    return validateMilestoneAgeInputsClient(bd.value, ages);
  }

  function showCollectionInitGuardianModal(continueFn) {
    state.activeAgePanelId = "collection-init-age-panel";
    const modal = $("recipient-age-modal");
    if (modal) {
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
      document.body.classList.add("recipient-age-modal-open");
    }
    requireMinorGuardianIfNeeded(
      collectionMinorScopeKey(),
      continueFn,
      "collection-init-age-panel",
    );
  }

  function restoreCollectionInitButton() {
    const btn = $("btn-collection-init");
    if (!btn) return;
    const onCollection = $("step-collection")?.classList.contains("active");
    const onEntry = $("step-entry")?.classList.contains("active");
    if (onCollection || onEntry) return;
    btn.textContent = "CREATE MY COLLECTION";
    if (state.mechanism === "FIXED_MILESTONES") {
      updateMilestoneAgePickerUi();
      return;
    }
    if (isBirthdayRecurring()) {
      btn.disabled = $("recurring-preview")?.hidden !== false;
      return;
    }
    if (state.mechanism === "RECURRING" && recurringCollectionType() === "anniversary") {
      updateAnniversaryNumberPickerUi();
      return;
    }
    btn.disabled = false;
  }

  async function showExistingCollectionIfPresent() {
    const st = await api("/v1/vault/state");
    if (isSessionExpiredResponse(st)) {
      handleSessionExpired();
      return true;
    }
    if (st.networkError || st.status !== 200 || st.json.status !== "ok") return false;
    applyVaultPayloadFromApi(st.json, state.purchaserEmail);
    if (state.collectionInitInProgress || collectionAwaitingInit()) return false;
    if (state.collection || (state.slots && state.slots.length)) {
      if (state.needsRecipientSetup && isPredefinedCollection()) {
        setupCollectionRecipientSetup();
        showStep("step-collection-recipient-setup");
        return true;
      }
      renderCollection();
      showStep("step-collection");
      return true;
    }
    return false;
  }

  async function submitCollectionInit(body) {
    if (state.collectionInitPending) return;
    const bd = $("base-date");
    if (bd && !bd.value) {
      showError("Please enter the date.");
      return;
    }
    if (bd) body.base_date = bd.value;
    if (state.mechanism === "FIXED_MILESTONES") {
      const ages = readMilestoneAgeInputs();
      const ageError = validateMilestoneAgeInputsClient(bd.value, ages);
      if (ageError) {
        showError(ageError);
        return;
      }
      body.selected_milestone_ages = [...ages];
    }
    if (
      state.mechanism === "RECURRING" &&
      recurringCollectionType() === "anniversary"
    ) {
      const numbers = readAnniversaryNumberInputs();
      const anniversaryError = validateAnniversaryNumberInputsClient(
        bd.value,
        numbers,
      );
      if (anniversaryError) {
        showError(anniversaryError);
        return;
      }
      body.selected_anniversary_numbers = [...numbers];
    }
    state.collectionInitPending = true;
    const btn = $("btn-collection-init");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "CREATING…";
      btn.setAttribute("aria-busy", "true");
    }
    try {
      let res = null;
      for (let attempt = 1; attempt <= COLLECTION_INIT_MAX_ATTEMPTS; attempt += 1) {
        res = await api("/v1/vault/collection/init", {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (res.networkError || isSessionExpiredResponse(res)) break;
        if (!isCollectionInitInProgressResponse(res)) break;
        if (attempt === COLLECTION_INIT_MAX_ATTEMPTS) break;
        await waitForCollectionInitRetry(attempt);
      }
      if (res.networkError) {
        showError(res.json.message);
        return;
      }
      if (isSessionExpiredResponse(res)) {
        handleSessionExpired();
        return;
      }
      if (isCollectionInitInProgressResponse(res)) {
        state.collectionInitInProgress = true;
        showError(
          res.json.message ||
            "Your collection is still being created. Please wait a moment and try again.",
        );
        return;
      }
      if (res.status === 409) {
        const recovered = await showExistingCollectionIfPresent();
        if (!recovered) {
          showError(res.json.message || "Could not create collection. Please try again.");
        }
        return;
      }
      if (res.status !== 200 || res.json.status !== "ok") {
        showError(res.json.message || "Could not create collection. Please try again.");
        return;
      }
      state.collectionInitInProgress = false;
      state.slots = res.json.slots || [];
      applyCollectionFromResponse(res.json);
      if (!state.collection && state.slots.length === 0) {
        showError("Could not create collection. Please try again.");
        return;
      }
      if (state.lettersAllowed && state.slots.length !== state.lettersAllowed) {
        state.collectionInitInProgress = true;
        showError(
          "Your collection is still being created. Please wait a moment and try again.",
        );
        return;
      }
      if (body.shared_recipient_context?.relationship) {
        state.sharedRecipient = body.shared_recipient_context.relationship;
      }
      renderCollection();
      showStep("step-collection");
    } finally {
      state.collectionInitPending = false;
      if (btn) btn.setAttribute("aria-busy", "false");
      restoreCollectionInitButton();
    }
  }

  $("btn-collection-init").addEventListener("click", async () => {
    if (state.collectionInitPending) return;
    showError("");
    const body = {};
    if (isPredefinedCollection()) {
      const ctx = readSharedRecipientContext({
        someoneElseInput: "collection-init-custom-relationship",
        nameInput: "collection-init-recipient-name",
      });
      if (!ctx) {
        showError("Please choose who these letters are for and enter their name.");
        return;
      }
      body.shared_recipient_context = ctx;
      if (ctx.relationship === "Myself") {
        state.collectionRecipientIsMinor = false;
        await submitCollectionInit(body);
        return;
      }
      if (state.mechanism === "FIXED_MILESTONES") {
        const initError = validateFixedMilestonesInitInputs();
        if (initError) {
          showError(initError);
          return;
        }
        const dob = $("base-date")?.value;
        if (dob) {
          state.collectionRecipientIsMinor = isCurrentlyUnder18FromDob(dob);
        }
        if (
          state.collectionRecipientIsMinor &&
          !state.fixedMilestonesGuardianConfirmedForInit
        ) {
          showError("Please confirm you are the parent or legal guardian.");
          maybeRevealFixedMilestonesMilestonePicker();
          return;
        }
        const refreshed = readSharedRecipientContext({
          someoneElseInput: "collection-init-custom-relationship",
          nameInput: "collection-init-recipient-name",
        });
        if (refreshed) body.shared_recipient_context = refreshed;
        promptSenderNameForCollectionInit(body);
        return;
      }
      if (isBirthdayRecurring()) {
        const dob = $("base-date")?.value;
        if (!dob) {
          showError("Please enter the date.");
          return;
        }
        state.collectionRecipientIsMinor = isCurrentlyUnder18FromDob(dob);
        if (
          state.collectionRecipientIsMinor &&
          !state.birthdayRecurringGuardianConfirmedForInit
        ) {
          showError("Please confirm you are the parent or legal guardian.");
          maybeRevealBirthdayRecurringPreview();
          return;
        }
        const refreshedBirthday = readSharedRecipientContext({
          someoneElseInput: "collection-init-custom-relationship",
          nameInput: "collection-init-recipient-name",
        });
        if (refreshedBirthday) body.shared_recipient_context = refreshedBirthday;
        promptSenderNameForCollectionInit(body);
        return;
      }
      if (isAnniversaryPartnerInitFlow()) {
        if (!state.anniversaryPartnerAgeConfirmed18Plus) {
          showError(
            "Please confirm whether your partner is 18 or older before continuing.",
          );
          maybePromptAnniversaryPartnerAgeGate();
          return;
        }
        state.collectionRecipientIsMinor = false;
        const refreshedPartner = readSharedRecipientContext({
          someoneElseInput: "collection-init-custom-relationship",
          nameInput: "collection-init-recipient-name",
        });
        if (refreshedPartner) body.shared_recipient_context = refreshedPartner;
        promptSenderNameForCollectionInit(body);
        return;
      }
      showRecipientAgePanel("collection-init-age-panel", function () {
        const refreshed = readSharedRecipientContext({
          someoneElseInput: "collection-init-custom-relationship",
          nameInput: "collection-init-recipient-name",
        });
        if (refreshed) body.shared_recipient_context = refreshed;
        promptSenderNameForCollectionInit(body);
      });
      return;
    }
    await submitCollectionInit(body);
  });

  function slotRecipientLabel(slot) {
    if (isPredefinedCollection()) {
      return (
        formatRecipientDisplay(slot.recipient_context) !== "—"
          ? formatRecipientDisplay(slot.recipient_context)
          : formatRecipientDisplay(state.collection?.shared_recipient_context)
      );
    }
    return formatRecipientDisplay(slot.recipient_context);
  }

  function renderCollectionDeliveryPanel() {
    const panel = $("collection-delivery-panel");
    if (!panel) return;
    if (!isPredefinedCollection()) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const recipientLine =
      state.collection?.shared_recipient_display ||
      formatRecipientDisplay(state.collection?.shared_recipient_context) ||
      "—";
    panel.innerHTML =
      '<div class="review-summary-item">' +
      '<p class="review-summary-label">Collection recipient</p>' +
      '<p class="review-summary-value">' +
      recipientLine +
      "</p></div>" +
      '<div class="review-summary-item">' +
      '<p class="review-summary-label">Collection delivery email</p>' +
      '<p class="review-summary-value">' +
      collectionDeliveryDashboardStatus() +
      "</p></div>" +
      '<button type="button" class="link-btn" id="collection-delivery-action">' +
      collectionDeliveryActionLabel() +
      "</button>";
    $("collection-delivery-action")?.addEventListener("click", () => {
      if (window.LvManage) LvManage.openCollectionDeliveryEmail("step-collection");
    });
  }

  function renderCollectionCancelActions() {
    const wrap = $("collection-cancel-actions");
    if (!wrap || !window.LvCancel) return;
    const cancellable = state.slots.filter((s) => LvCancel.isSlotCancellable(s));
    if (!state.inCollection || cancellable.length === 0) {
      wrap.hidden = true;
      wrap.innerHTML = "";
      return;
    }
    wrap.hidden = false;
    wrap.innerHTML = "";
    const bulkBtn = document.createElement("button");
    bulkBtn.type = "button";
    bulkBtn.className = "link-btn-destructive";
    bulkBtn.textContent = "CANCEL ALL REMAINING LETTERS";
    bulkBtn.addEventListener("click", () => {
      LvCancel.openCancelAllRemaining({
        eligibleCount: cancellable.length,
        onSuccess: () => {
          renderCollection();
        },
        onPartial: (note) => {
          showError(note);
          renderCollection();
        },
        onError: showError,
      });
    });
    wrap.appendChild(bulkBtn);
  }

  function renderCollection() {
    showCollectionSubtitle($("collection-subtitle"), collectionDashboardSubtitle());
    const sealed = state.slots.filter((s) => s.slot_status === "SEALED").length;
    $("collection-progress").textContent = sealed + " of " + state.slots.length + " letters sealed";
    renderCollectionDeliveryPanel();
    const emotional = $("collection-emotional");
    const emotionalLine = collectionEmotionalLine(sealed, state.slots.length);
    if (emotionalLine) {
      emotional.textContent = emotionalLine;
      emotional.hidden = false;
    } else {
      emotional.hidden = true;
    }
    const list = $("slot-list");
    list.innerHTML = "";
    state.slots.forEach((slot) => {
      const cancelled =
        window.LvCancel && LvCancel.isSlotCancelled(slot);
      const li = document.createElement("li");
      li.className =
        "slot-item" +
        (slot.slot_status === "SEALED" ? " sealed" : "") +
        (cancelled ? " cancelled" : "");
      const meta = document.createElement("div");
      meta.className = "slot-meta";
      let detailsHtml =
        '<strong class="slot-milestone-title">' + slotTitleHtml(slot) + "</strong>";
      if (cancelled) {
        detailsHtml +=
          '<p class="slot-status-cancelled">CANCELLED</p>';
      }
      detailsHtml +=
        '<p class="slot-detail-line"><span class="slot-detail-label">For</span> ' +
        slotRecipientLabel(slot) +
        "</p>";
      if (slot.delivery_at) {
        detailsHtml +=
          '<p class="slot-detail-line"><span class="slot-detail-label">Delivery</span> ' +
          formatWrittenDate(slot.delivery_at) +
          "</p>";
      } else if (slot.slot_status === "UNWRITTEN") {
        detailsHtml +=
          '<p class="slot-detail-line slot-detail-muted">Delivery date not chosen yet</p>';
      }
      if (slot.slot_status === "SEALED" && window.LvManage && !slot.uses_collection_delivery) {
        detailsHtml +=
          '<p class="slot-detail-line"><span class="slot-detail-label">Delivery email</span> ' +
          LvManage.deliveryEmailDashboardStatus(slot) +
          "</p>";
      }
      meta.innerHTML = detailsHtml;
      li.appendChild(meta);
      if (slot.slot_status === "UNWRITTEN") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "link-btn";
        if (state.mechanism === "FREE_COLLECTION") {
          btn.textContent = slot.delivery_at ? "WRITE LETTER →" : "CHOOSE A MOMENT →";
        } else {
          btn.textContent = "WRITE LETTER →";
        }
        btn.addEventListener("click", () => {
          showError("");
          if (slotUsesPredefinedFlow()) openPredefinedSlot(slot);
          else openFreeCollectionSlot(slot);
        });
        li.appendChild(btn);
      } else if (
        window.LvManage &&
        slot.public_letter_id &&
        !slot.uses_collection_delivery &&
        !cancelled
      ) {
        const emailBtn = document.createElement("button");
        emailBtn.type = "button";
        emailBtn.className = "link-btn slot-email-action";
        emailBtn.textContent = LvManage.deliveryEmailActionLabel(slot);
        emailBtn.addEventListener("click", () => {
          LvManage.openDeliveryEmail(slot.public_letter_id, slot, "step-collection");
        });
        sealedSlotActionParent(li, slot).appendChild(emailBtn);
      }
      if (
        window.LvCancel &&
        LvCancel.isSlotCancellable(slot) &&
        slot.public_letter_id
      ) {
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "link-btn-destructive slot-cancel-action";
        cancelBtn.textContent = "CANCEL THIS LETTER";
        cancelBtn.addEventListener("click", () => {
          LvCancel.openCancelLetter(slot, {
            onSuccess: () => renderCollection(),
            onError: showError,
          });
        });
        sealedSlotActionParent(li, slot).appendChild(cancelBtn);
      }
      list.appendChild(li);
    });
    renderCollectionCancelActions();
  }

  window.LvVaultRenderCollection = renderCollection;

  async function refreshVaultState(options) {
    const st = await api("/v1/vault/state");
    if (st.status === 200 && st.json.status === "ok") {
      state.slots = st.json.slots || [];
      if (st.json.template_config !== undefined) {
        state.templateConfig = st.json.template_config;
      }
      applyDeliveryCapabilities(st.json);
      applyCollectionFromResponse(st.json);
      persistVaultSession();
      return true;
    }
    if (isSessionExpiredResponse(st)) {
      if (options?.redirectOnExpiry === false) {
        clearVaultSessionStorage();
        state.session = null;
        state.entitlementId = null;
      } else {
        handleSessionExpired();
      }
    }
    return false;
  }

  window.LvVaultRefreshState = refreshVaultState;

  function setRecipientSelection(grid, selectedBtn) {
    grid.querySelectorAll(".choice-btn").forEach((b) => {
      const on = b === selectedBtn;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function continueFromSomeoneElse() {
    const value = $("custom-relationship").value.trim();
    if (state.recipient !== "Someone else" || !value) return;
    if (isFreeCollectionRecipientFlow()) {
      showFreeCollectionNameFields();
      return;
    }
    showRecipientAgePanel("recipient-age-panel", function () {
      proceedAfterRecipientAgeDecision(proceedToDateStep);
    });
  }

  function setupRecipientStep(freeMoment, preselectContext) {
    const grid = $("recipient-choices");
    grid.innerHTML = "";
    $("someone-else-fields").hidden = true;
    $("custom-relationship").value = "";
    $("recipient-name").value = "";
    hideFreeCollectionNameFields();
    hideRecipientAgePanel("recipient-age-panel");
    state.recipient = null;
    state.recipientIsMinor = null;

    const presetCtx =
      preselectContext && typeof preselectContext === "object"
        ? preselectContext
        : preselectContext
          ? { relationship: String(preselectContext) }
          : null;
    const presetRel = presetCtx?.relationship?.trim() || "";
    const presetName = presetCtx?.recipient_name?.trim() || "";
    const presetMatch = RECIPIENTS.find((r) => r.label === presetRel);

    RECIPIENTS.forEach((r) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-btn";
      btn.setAttribute("aria-pressed", "false");
      btn.innerHTML =
        "<span class='choice-label'>" +
        r.label +
        "</span><span class='choice-hint'>" +
        r.hint +
        "</span>";
      btn.addEventListener("click", () => {
        state.recipient = r.label;
        setRecipientSelection(grid, btn);
        if (isFreeCollectionRecipientFlow()) {
          if (r.label === "Someone else") {
            $("someone-else-fields").hidden = false;
            $("custom-relationship").focus();
          } else {
            $("someone-else-fields").hidden = true;
            $("custom-relationship").value = "";
          }
          showFreeCollectionNameFields();
          requestAnimationFrame(() => {
            (r.label === "Someone else" ? $("someone-else-fields") : $("free-collection-name-fields"))?.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
            });
          });
          return;
        }
        if (r.label === "Someone else") {
          $("someone-else-fields").hidden = false;
          $("custom-relationship").focus();
          requestAnimationFrame(() => {
            $("someone-else-fields").scrollIntoView({ behavior: "smooth", block: "nearest" });
          });
        } else if (r.label === "Myself") {
          state.recipientIsMinor = false;
          resetDateStep();
          showStep("step-date");
        } else {
          showRecipientAgePanel("recipient-age-panel", function () {
            proceedAfterRecipientAgeDecision(proceedToDateStep);
          });
        }
      });
      grid.appendChild(btn);
      if (presetMatch && r.label === presetMatch.label) {
        state.recipient = r.label;
        setRecipientSelection(grid, btn);
      }
    });

    if (presetRel && !presetMatch) {
      state.recipient = "Someone else";
      $("someone-else-fields").hidden = false;
      $("custom-relationship").value = presetRel;
      grid.querySelectorAll(".choice-btn").forEach((b) => {
        const on = b.querySelector(".choice-label")?.textContent === "Someone else";
        b.classList.toggle("selected", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }

    if (isFreeCollectionRecipientFlow() && state.recipient) {
      if (state.recipient === "Someone else") {
        $("someone-else-fields").hidden = false;
      }
      if (presetName) $("recipient-name").value = presetName;
      showFreeCollectionNameFields();
    }

    const customField = $("custom-relationship");
    customField.onchange = customField.onblur = continueFromSomeoneElse;
    customField.onkeydown = function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        continueFromSomeoneElse();
      }
    };
  }

  $("btn-recipient-continue")?.addEventListener("click", continueFromRecipientStep);
  $("btn-sender-name-continue")?.addEventListener("click", continueFromSenderNameStep);
  $("sender-display-name")?.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      continueFromSenderNameStep();
    }
  });
  $("recipient-name")?.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      continueFromRecipientStep();
    }
  });

  function setDateOptionSelection(action) {
    $("date-choices").querySelectorAll(".choice-btn").forEach((b) => {
      const on = b.dataset.dateAction === action;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function setMilestoneSelection(selectedBtn) {
    $("milestone-grid")?.querySelectorAll(".choice-btn").forEach((b) => {
      const on = b === selectedBtn;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function resetDateStep() {
    $("date-extra").hidden = true;
    $("date-extra").innerHTML = "";
    $("date-confirm-panel").hidden = true;
    $("btn-confirm-date").hidden = true;
    state.deliveryAt = state.dateLocked ? state.deliveryAt : null;
    const grid = $("date-choices");
    grid.innerHTML = "";
    dateOptionsForCurrentFlow().forEach((o) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-btn";
      btn.dataset.dateAction = o.action;
      btn.setAttribute("aria-pressed", "false");
      btn.innerHTML =
        "<span class='choice-label'>" +
        o.label +
        "</span><span class='choice-hint'>" +
        o.hint +
        "</span>";
      btn.addEventListener("click", () => selectDateOption(o.action));
      grid.appendChild(btn);
    });
  }

  function showDateConfirm(iso, subcopy, headline) {
    state.deliveryAt = iso;
    $("date-extra").hidden = true;
    $("date-confirm-panel").hidden = false;
    $("date-confirm-panel").querySelector(".date-confirm-label").textContent =
      headline || "Your letter will arrive";
    $("confirm-date-display").textContent = formatWrittenDate(iso);
    $("confirm-date-sub").textContent = subcopy || "We'll keep it until then.";
    $("btn-confirm-date").hidden = false;
  }

  function selectDateOption(action) {
    showError("");
    setDateOptionSelection(action);
    $("date-confirm-panel").hidden = true;
    $("btn-confirm-date").hidden = true;
    const extra = $("date-extra");
    extra.hidden = false;
    extra.innerHTML = "";

    if (action === "one_year") {
      const iso = oneYearFromToday();
      showDateConfirm(iso, "We'll keep it until then.", "Your letter will arrive");
      return;
    }

    if (action === "birthday") {
      extra.innerHTML =
        '<p class="vault-sub">Choose a milestone birthday and we\'ll calculate the date for you.</p>' +
        '<label for="dob-input">Date of birth</label>' +
        '<input type="date" id="dob-input">' +
        '<div class="choice-grid" id="milestone-grid"></div>' +
        '<p class="vault-hint" id="milestone-error" hidden>This milestone has already passed. Please choose another.</p>' +
        '<div id="birthday-other" hidden><label for="other-age">Future age (years)</label><input type="number" id="other-age" min="1" max="120" placeholder="e.g. 25"></div>';
      const mg = $("milestone-grid");
      BIRTHDAY_MILESTONES.forEach((age) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "choice-btn";
        b.setAttribute("aria-pressed", "false");
        b.dataset.milestoneAge = String(age);
        b.innerHTML = "<span class='choice-label'>" + ordinalAgeLabel(age) + "</span>";
        b.onclick = () => pickBirthdayMilestone(age, b);
        mg.appendChild(b);
      });
      const otherBtn = document.createElement("button");
      otherBtn.type = "button";
      otherBtn.className = "choice-btn";
      otherBtn.setAttribute("aria-pressed", "false");
      otherBtn.innerHTML =
        "<span class='choice-label'>Other</span><span class='choice-hint'>Choose another future birthday.</span>";
      otherBtn.onclick = () => {
        setMilestoneSelection(otherBtn);
        $("birthday-other").hidden = false;
      };
      mg.appendChild(otherBtn);
      $("other-age")?.addEventListener("change", function () {
        const age = parseInt(this.value, 10);
        if (age > 0) pickBirthdayMilestone(age, otherBtn);
      });
      const dobInput = $("dob-input");
      if (dobInput) {
        const syncBirthdayFromDob = () => refreshBirthdayMilestoneFromDob();
        dobInput.addEventListener("change", syncBirthdayFromDob);
        dobInput.addEventListener("input", syncBirthdayFromDob);
        dobInput.addEventListener("blur", syncBirthdayFromDob);
      }
      return;
    }

    if (action === "anniversary") {
      extra.innerHTML =
        '<p class="vault-sub">Choose the anniversary date you\'d like this letter to arrive.</p>' +
        '<label for="anniversary-date">Future anniversary date</label>' +
        '<input type="date" id="anniversary-date" min="' +
        new Date().toISOString().slice(0, 10) +
        '">';
      $("anniversary-date").addEventListener("change", function () {
        if (!this.value) return;
        const iso = this.value + "T12:00:00.000Z";
        if (!isFutureDate(iso)) {
          showError("Please choose a future date.");
          return;
        }
        showDateConfirm(iso, "We'll keep it until then.", "Your letter will arrive");
      });
      return;
    }

    if (action === "pick") {
      extra.innerHTML =
        '<label for="pick-date">Choose a future date</label>' +
        '<input type="date" id="pick-date" min="' +
        new Date().toISOString().slice(0, 10) +
        '">';
      $("pick-date").addEventListener("change", function () {
        if (!this.value) return;
        const iso = this.value + "T12:00:00.000Z";
        if (!isFutureDate(iso)) {
          showError("Please choose a future date.");
          return;
        }
        showDateConfirm(iso, "We'll keep it until then.", "Your letter will arrive");
      });
    }
  }

  function refreshBirthdayMilestoneFromDob() {
    const dob = $("dob-input")?.value;
    if (!dob) return;
    const grid = $("milestone-grid");
    const selectedBtn = grid?.querySelector('.choice-btn[aria-pressed="true"]');
    if (!selectedBtn) return;
    const presetAge = parseInt(selectedBtn.dataset.milestoneAge || "", 10);
    if (presetAge > 0) {
      pickBirthdayMilestone(presetAge, selectedBtn);
      return;
    }
    const otherAge = parseInt($("other-age")?.value || "", 10);
    if (otherAge > 0 && !$("birthday-other")?.hidden) {
      pickBirthdayMilestone(otherAge, selectedBtn);
    }
  }

  function pickBirthdayMilestone(age, selectedBtn) {
    if (selectedBtn) setMilestoneSelection(selectedBtn);
    const dob = $("dob-input")?.value;
    const err = $("milestone-error");
    if (!dob) {
      showError("Please enter a date of birth first.");
      return;
    }
    const iso = addYearsFromDate(dob, age);
    if (!isFutureDate(iso)) {
      if (err) err.hidden = false;
      showError("This milestone has already passed. Please choose another future birthday.");
      return;
    }
    if (err) err.hidden = true;
    showError("");
    showDateConfirm(iso, "We'll keep it until then.", "Your letter will arrive");
  }

  $("btn-confirm-date").addEventListener("click", async () => {
    if (state.dateConfirmPending) return;
    if (!state.deliveryAt || !isFutureDate(state.deliveryAt)) {
      showError("Please choose a future date.");
      return;
    }
    state.dateConfirmPending = true;
    const btn = $("btn-confirm-date");
    if (btn) btn.disabled = true;
    try {
      showError("");
      if (state.flowMode === "free-moment") {
        const saved = await api("/v1/vault/slots/" + state.currentSlot.slot_id, {
          method: "PATCH",
          body: JSON.stringify({
            delivery_at: state.deliveryAt,
            recipient_context: recipientContext(),
            moment_label: state.currentSlot.moment_label,
          }),
        });
        if (saved.networkError) {
          showError(saved.json.message);
          return;
        }
        if (isSessionExpiredResponse(saved)) {
          handleSessionExpired();
          return;
        }
        if (saved.status !== 200) {
          showError(saved.json.message || "Could not save this date. Please try again.");
          return;
        }
      }
      goWrite();
    } finally {
      state.dateConfirmPending = false;
      if (btn && !$("step-entry")?.classList.contains("active")) btn.disabled = false;
    }
  });

  function goWrite() {
    const moment =
      state.currentSlot?.moment_label && state.flowMode === "collection-write"
        ? state.currentSlot.moment_label + " · "
        : "";
    $("write-delivery-note").textContent =
      moment +
      "This letter will stay sealed until " +
      formatWrittenDate(state.deliveryAt) +
      ".";
    const draft = LvDraft.loadDraft(state.entitlementId, state.currentSlot.slot_id);
    $("letter-body").value = draft;
    $("dear-line").value = state.dearLine;
    $("draft-saved").hidden = !draft;
    updateCharCount();
    showStep("step-write");
  }

  $("letter-body").addEventListener("input", () => {
    LvDraft.saveDraft(state.entitlementId, state.currentSlot.slot_id, $("letter-body").value);
    $("draft-saved").hidden = false;
    updateCharCount();
  });

  function updateCharCount() {
    const n = LvDraft.charCount($("letter-body").value);
    $("char-count").textContent = n;
    $("char-count").style.color = n > LvDraft.MAX_CHARS ? "#991b1b" : "";
  }

  $("toggle-prompts").addEventListener("click", () => {
    const panel = $("write-prompts");
    const toggle = $("toggle-prompts");
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    toggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
  });

  function resetReviewDeliveryUi() {
    state.reviewDeliveryChoice = null;
    state.reviewDeliveryMode = null;
    $("review-delivery-fields").hidden = true;
    $("review-delivery-email").value = "";
    $("review-surprise-declaration-check").checked = false;
    $("review-surprise-declaration").hidden = true;
    document.querySelectorAll(".review-delivery-choice").forEach((b) => {
      b.classList.remove("selected");
      b.setAttribute("aria-pressed", "false");
    });
    document.querySelectorAll(".review-mode-btn").forEach((b) => {
      b.classList.remove("selected");
      b.setAttribute("aria-pressed", "false");
    });
    applyReviewSurpriseModeUi();
    updateSealButtonState();
  }

  function applyReviewSurpriseModeUi() {
    const surpriseAvailable = state.surprise_delivery_email_available === true;
    const surpriseBtn = $("review-mode-surprise");
    const notice = $("review-surprise-unavailable");
    const declarationText = $("review-surprise-declaration-text");
    if (!surpriseBtn) return;
    if (!surpriseAvailable) {
      surpriseBtn.hidden = true;
      if (notice) notice.hidden = false;
      if (state.reviewDeliveryMode === "surprise") {
        state.reviewDeliveryMode = null;
        document.querySelectorAll(".review-mode-btn").forEach((b) => {
          b.classList.remove("selected");
          b.setAttribute("aria-pressed", "false");
        });
      }
    } else {
      surpriseBtn.hidden = false;
      if (notice) notice.hidden = true;
      if (declarationText && state.surprise_declaration_text) {
        declarationText.textContent = state.surprise_declaration_text;
      }
    }
    const showDeclaration =
      surpriseAvailable && state.reviewDeliveryMode === "surprise";
    $("review-surprise-declaration").hidden = !showDeclaration;
    if (!showDeclaration && $("review-surprise-declaration-check")) {
      $("review-surprise-declaration-check").checked = false;
    }
  }

  function syncDeliveryMissingWarning() {
    const el = $("review-delivery-missing-warning");
    if (!el) return;
    const missing = isPredefinedCollectionWrite()
      ? !state.collection?.has_delivery_email
      : state.reviewDeliveryChoice === "later";
    el.hidden = !missing;
    el.textContent = missing
      ? "No delivery email yet. You can seal this letter now and add the address later. It will not be sent until a delivery email is saved."
      : "";
  }

  function updateSealButtonState() {
    const understood = $("seal-understand")?.checked;
    if (isPredefinedCollectionWrite()) {
      $("btn-seal").disabled = !understood;
      syncDeliveryMissingWarning();
      return;
    }
    const choice = state.reviewDeliveryChoice;
    let deliveryReady = choice === "later";
    if (choice === "now") {
      const email = $("review-delivery-email")?.value.trim();
      if (!email) {
        deliveryReady = false;
      } else if (!state.reviewDeliveryMode) {
        deliveryReady = false;
      } else if (
        state.reviewDeliveryMode === "surprise" &&
        state.surprise_delivery_email_available === true &&
        !$("review-surprise-declaration-check")?.checked
      ) {
        deliveryReady = false;
      } else {
        deliveryReady = true;
      }
    }
    $("btn-seal").disabled = !(understood && choice && deliveryReady);
    syncDeliveryMissingWarning();
  }

  function selectReviewDeliveryChoice(choice, btn) {
    state.reviewDeliveryChoice = choice;
    document.querySelectorAll(".review-delivery-choice").forEach((b) => {
      const on = b === btn;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("review-delivery-fields").hidden = choice !== "now";
    if (choice !== "now") {
      state.reviewDeliveryMode = null;
      $("review-delivery-email").value = "";
      document.querySelectorAll(".review-mode-btn").forEach((b) => {
        b.classList.remove("selected");
        b.setAttribute("aria-pressed", "false");
      });
    }
    applyReviewSurpriseModeUi();
    updateSealButtonState();
  }

  $("review-delivery-now")?.addEventListener("click", function () {
    selectReviewDeliveryChoice("now", this);
  });
  $("review-delivery-later")?.addEventListener("click", function () {
    selectReviewDeliveryChoice("later", this);
  });
  $("review-mode-surprise")?.addEventListener("click", function () {
    state.reviewDeliveryMode = "surprise";
    document.querySelectorAll(".review-mode-btn").forEach((b) => {
      const on = b === this;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    applyReviewSurpriseModeUi();
    updateSealButtonState();
  });
  $("review-mode-verify")?.addEventListener("click", function () {
    state.reviewDeliveryMode = "verify_now";
    document.querySelectorAll(".review-mode-btn").forEach((b) => {
      const on = b === this;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    applyReviewSurpriseModeUi();
    updateSealButtonState();
  });
  $("review-delivery-email")?.addEventListener("input", updateSealButtonState);
  $("review-surprise-declaration-check")?.addEventListener("change", updateSealButtonState);

  $("btn-to-review").addEventListener("click", () => {
    if (LvDraft.charCount($("letter-body").value) > LvDraft.MAX_CHARS) {
      showError("Letter is too long (max 15,000 characters).");
      return;
    }
    if (!$("letter-body").value.trim()) {
      showError("Please write something before sealing.");
      return;
    }
    showError("");
    const reviewRecipient = authoritativeRecipientContext();
    const forLabel = isPredefinedCollectionWrite()
      ? formatRecipientDisplay(sharedCollectionRecipientContext() || reviewRecipient)
      : formatRecipientDisplay(reviewRecipient) !== "—"
        ? formatRecipientDisplay(reviewRecipient)
        : state.recipient || "—";
    let reviewMetaHtml =
      '<div class="review-summary-item">' +
      '<p class="review-summary-label">For</p>' +
      '<p class="review-summary-value">' +
      forLabel +
      "</p></div>";
    if (isPredefinedCollectionWrite() && state.currentSlot?.moment_label) {
      reviewMetaHtml +=
        '<div class="review-summary-item">' +
        '<p class="review-summary-label">Occasion</p>' +
        '<p class="review-summary-value">' +
        escapeHtml(state.currentSlot.moment_label) +
        "</p></div>";
    }
    reviewMetaHtml +=
      '<div class="review-summary-item">' +
      '<p class="review-summary-label">Delivery date</p>' +
      '<p class="review-summary-value">' +
      formatWrittenDate(state.deliveryAt) +
      "</p></div>";
    $("review-meta").innerHTML = reviewMetaHtml;
    syncReviewDeliveryCopy();
    const deliverySection = $("review-delivery-section");
    if (isPredefinedCollectionWrite()) {
      if (deliverySection) deliverySection.hidden = true;
      state.reviewDeliveryChoice = "later";
    } else {
      if (deliverySection) deliverySection.hidden = false;
      resetReviewDeliveryUi();
    }
    updateSealButtonState();
    showStep("step-review");
  });

  function backFromSenderName() {
    showError("");
    if (state.pendingCollectionInitBody) {
      showStep("step-collection-init");
      return;
    }
    showStep("step-recipient");
  }

  function backFromDateStep() {
    showError("");
    if (needsSenderDisplayNameForCurrentFlow()) {
      showStep("step-sender-name");
      return;
    }
    showStep("step-recipient");
  }

  function backFromWriteStep() {
    showError("");
    if (state.flowMode === "collection-write") {
      renderCollection();
      showStep("step-collection");
      return;
    }
    showStep("step-date");
  }

  $("btn-back-from-sender")?.addEventListener("click", backFromSenderName);
  $("btn-back-from-date")?.addEventListener("click", backFromDateStep);
  $("btn-back-from-write")?.addEventListener("click", backFromWriteStep);

  $("seal-understand").addEventListener("change", updateSealButtonState);
  $("btn-back-write").addEventListener("click", () => showStep("step-write"));

  $("btn-seal").addEventListener("click", async () => {
    if (state.sealPending) return;
    state.sealPending = true;
    const btn = $("btn-seal");
    showError("");
    btn.disabled = true;
    btn.textContent = "SEALING…";
    btn.setAttribute("aria-busy", "true");
    let sealedOk = false;
    try {
      let text = $("letter-body").value;
      const dear = $("dear-line").value.trim();
      if (dear) text = "Dear " + dear + ",\n\n" + text;

      const saved = await api("/v1/vault/slots/" + state.currentSlot.slot_id, {
        method: "PATCH",
        body: JSON.stringify({
          delivery_at: state.deliveryAt,
          recipient_context: authoritativeRecipientContext(),
          moment_label: state.currentSlot.moment_label,
        }),
      });
      if (saved.networkError) {
        showError(saved.json.message);
        return;
      }
      if (isSessionExpiredResponse(saved)) {
        handleSessionExpired();
        return;
      }
      if (saved.status !== 200) {
        showError(saved.json.message || "We couldn't save this letter. Nothing was sealed.");
        return;
      }

      const res = await api("/v1/vault/slots/" + state.currentSlot.slot_id + "/seal", {
        method: "POST",
        body: JSON.stringify({
          letter_text: text,
          delivery_at: state.deliveryAt,
          recipient_context: authoritativeRecipientContext(),
          moment_label: state.currentSlot.moment_label,
        }),
      });
      if (res.networkError) {
        showError(
          "We couldn't confirm whether the letter was sealed. Check your connection and try again. Sealing again will not create a second letter.",
        );
        return;
      }
      if (isSessionExpiredResponse(res)) {
        handleSessionExpired();
        return;
      }
      if (res.status === 409) {
        const refreshed = await refreshVaultState();
        if ($("step-entry")?.classList.contains("active")) return;
        const existing = refreshed
          ? state.slots.find(
              (slot) =>
                slot.slot_id === state.currentSlot.slot_id && slot.slot_status === "SEALED",
            )
          : null;
        if (existing) {
          LvDraft.clearDraft(state.entitlementId, state.currentSlot.slot_id);
          sealedOk = true;
          showSuccessScreen(existing);
          return;
        }
        showError(
          refreshed
            ? res.json.message || "This letter is already sealed or unavailable."
            : "We couldn't confirm whether the letter was sealed. Check your connection and try again. Sealing again will not create a second letter.",
        );
        return;
      }
      if (res.status !== 200 || res.json.status !== "ok") {
        if (res.json?.code === "minor_guardian_required" && (state.mechanism === "FIXED_MILESTONES" || isBirthdayRecurring())) {
          requireMinorGuardianIfNeeded(collectionMinorScopeKey(), function () {
            showStep("step-review");
          });
          return;
        }
        showError(res.json.message || "We couldn't seal your letter. Please try again.");
        return;
      }

      let keepDeliveryError = false;
      if (state.reviewDeliveryChoice === "now" && !isPredefinedCollectionWrite()) {
        const email = $("review-delivery-email").value.trim();
        const mode = state.reviewDeliveryMode === "surprise" ? "surprise" : "verify_now";
        const deliveryPayload = {
          public_letter_id: res.json.public_letter_id,
          delivery_email: email,
          delivery_email_mode: mode,
        };
        if (mode === "surprise") {
          deliveryPayload.surprise_personal_declaration_accepted = true;
        }
        const deliveryRes = await api("/v1/vault/delivery-email", {
          method: "POST",
          body: JSON.stringify(deliveryPayload),
        });
        if (deliveryRes.networkError || deliveryRes.status !== 200 || deliveryRes.json.status !== "ok") {
          showError(deliveryRes.json?.message || sealDeliveryEmailErrorFallback());
          keepDeliveryError = true;
        }
      }

      LvDraft.clearDraft(state.entitlementId, state.currentSlot.slot_id);
      await refreshVaultState({ redirectOnExpiry: false });
      const sealedSlot =
        state.slots.find((s) => s.public_letter_id === res.json.public_letter_id) ||
        state.currentSlot;
      sealedOk = true;
      showSuccessScreen({
        ...sealedSlot,
        public_letter_id: res.json.public_letter_id,
        letter_status: "SEALED",
        cancellable: true,
        delivery_at: res.json.delivery_at || sealedSlot?.delivery_at,
      }, { keepError: keepDeliveryError });
    } finally {
      state.sealPending = false;
      btn.setAttribute("aria-busy", "false");
      if (!sealedOk && !$("step-entry")?.classList.contains("active")) {
        btn.textContent = "SEAL MY LETTER 🔒";
        updateSealButtonState();
      }
    }
  });

  $("btn-copy-id").addEventListener("click", () => {
    navigator.clipboard.writeText($("success-letter-id").textContent);
  });

  $("btn-return-collection").addEventListener("click", async () => {
    if (window.LvVaultRefreshState) {
      await window.LvVaultRefreshState();
    }
    renderCollection();
    showStep("step-collection");
  });

  window.addEventListener("popstate", () => {
    if ($("step-success").classList.contains("active")) {
      history.pushState(null, "", location.href);
    }
  });

  function wireCollectionAgeButtons(panelId) {
    const panel = $(panelId);
    if (!panel) return;
    panel.querySelectorAll("[data-collection-age]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const isMinor = btn.getAttribute("data-collection-age") === "yes";
        resolveRecipientAgeChoice(isMinor, collectionMinorScopeKey(), panelId);
      });
    });
  }

  $("recipient-age-modal-no")?.addEventListener("click", () => {
    resolveAgeModalChoice(false);
  });
  $("recipient-age-modal-yes")?.addEventListener("click", () => {
    handleAgeModalYes();
  });
  $("btn-recipient-age-modal-guardian-continue")?.addEventListener(
    "click",
    async function () {
      await submitMinorGuardianConfirmation();
    },
  );
  $("btn-recipient-age-modal-guardian-choose-recipient")?.addEventListener(
    "click",
    chooseDifferentRecipientFromMinorGuardian,
  );
  $("recipient-age-modal-partner-yes")?.addEventListener(
    "click",
    handleAnniversaryPartnerAgeYes,
  );
  $("recipient-age-modal-partner-no")?.addEventListener(
    "click",
    handleAnniversaryPartnerAgeNo,
  );
  $("btn-recipient-age-modal-partner-choose-recipient")?.addEventListener(
    "click",
    chooseDifferentRecipientFromAnniversaryPartnerBlocked,
  );
  wireCollectionAgeButtons("collection-recipient-age-panel");

  (async function initVaultFromStorage() {
    if (window.LvManage && LvManage.tryOpenFromUrl()) return;
    if (tryOpenRecoveryFromUrl()) return;
    await tryRestoreVaultSession();
  })();
})();
