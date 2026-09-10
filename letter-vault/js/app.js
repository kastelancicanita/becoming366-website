(function () {
  "use strict";

  const API = window.LETTER_VAULT_API;
  const state = {
    session: null,
    entitlementId: null,
    productType: null,
    mechanism: null,
    displayTitle: null,
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
    milestoneOptions: [],
    purchaserEmail: null,
    recipientLocked: false,
    surprise_delivery_email_available: undefined,
    surprise_unavailable_message: null,
    surprise_declaration_text: null,
  };

  function applyDeliveryCapabilities(source) {
    if (!source || typeof source.surprise_delivery_email_available !== "boolean") {
      return;
    }
    state.surprise_delivery_email_available = source.surprise_delivery_email_available;
    state.surprise_unavailable_message = source.surprise_unavailable_message ?? null;
    state.surprise_declaration_text = source.surprise_declaration_text ?? null;
  }

  window.LvVaultState = state;

  const RECIPIENTS = [
    { label: "Myself", hint: "A letter for the person you're becoming." },
    { label: "My daughter", hint: "Words for her to carry someday." },
    { label: "My son", hint: "Words for him to carry someday." },
    { label: "My partner", hint: "Something you want them to remember." },
    { label: "My friend", hint: "Words worth keeping between friends." },
    { label: "Someone else", hint: "Tell us who they are to you." },
  ];

  const DATE_OPTIONS = [
    { label: "ONE YEAR FROM TODAY", hint: "Exactly one year from today.", action: "one_year" },
    { label: "ON A BIRTHDAY", hint: "Choose a milestone birthday.", action: "birthday" },
    { label: "ON AN ANNIVERSARY", hint: "Choose a future anniversary.", action: "anniversary" },
    { label: "CHOOSE A DATE", hint: "Pick any future date.", action: "pick" },
  ];

  const BIRTHDAY_MILESTONES = [18, 21, 30, 40, 50];

  const $ = (id) => document.getElementById(id);
  const steps = [...document.querySelectorAll(".vault-step")];

  function showStep(id) {
    steps.forEach((s) => s.classList.toggle("active", s.id === id));
    updateProgress(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  function api(path, opts) {
    const headers = { "Content-Type": "application/json" };
    if (state.session) headers["X-Letter-Vault-Session"] = state.session;
    return fetch(API + path, {
      ...opts,
      headers: { ...headers, ...(opts && opts.headers) },
    }).then((r) => r.json().then((j) => ({ status: r.status, json: j })));
  }

  function recipientContext() {
    if (!state.recipient) return {};
    if (state.recipient === "Someone else") {
      return { relationship: $("custom-relationship").value.trim() || "Someone special" };
    }
    return { relationship: state.recipient };
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

  function slotDateIsPredefined(slot) {
    return (
      slot.delivery_at &&
      state.inCollection &&
      (state.mechanism === "FIXED_MILESTONES" || state.mechanism === "RECURRING")
    );
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
    const singleSteps = ["step-recipient", "step-date", "step-write", "step-review"];
    if (state.flowMode === "single" && singleSteps.includes(stepId)) {
      bar.hidden = false;
      const idx = singleSteps.indexOf(stepId);
      bar.innerHTML =
        "<span class='progress-label'>Step " +
        (idx + 1) +
        " of 4</span>" +
        "<span class='progress-steps'>" +
        "<span>Recipient</span><span>Date</span><span>Write</span><span>Seal</span>" +
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
    state.dateLocked = true;
    state.recipientLocked = true;
    state.deliveryAt = slot.delivery_at;
    state.recipient = slot.recipient_context?.relationship || state.sharedRecipient || null;
    goWrite();
  }

  function openFreeCollectionSlot(slot) {
    state.currentSlot = slot;
    state.flowMode = "free-moment";
    state.dateLocked = false;
    state.recipientLocked = false;
    state.deliveryAt = slot.delivery_at || null;
    state.recipient = slot.recipient_context?.relationship || state.sharedRecipient || null;

    if (state.recipient && state.deliveryAt && isFutureDate(state.deliveryAt)) {
      goWrite();
      return;
    }
    if (!state.recipient && !state.sharedRecipient) {
      setupRecipientStep(true);
      showStep("step-recipient");
      return;
    }
    state.recipient = state.recipient || state.sharedRecipient;
    resetDateStep();
    showStep("step-date");
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
      slots: res.json.slots || [],
      inCollection: res.json.product_type === "COLLECTION",
      sharedRecipient: null,
      lettersAllowed: res.json.letters_allowed || null,
      selectedMilestoneAges: [],
      milestoneOptions: [],
      purchaserEmail: $("purchase-email").value.trim(),
    });
    applyDeliveryCapabilities(res.json);

    const firstRecipient = (res.json.slots || []).find(
      (s) => s.recipient_context?.relationship,
    )?.recipient_context?.relationship;
    if (firstRecipient) state.sharedRecipient = firstRecipient;

    if (res.json.needs_collection_init) {
      setupCollectionInit();
      showStep("step-collection-init");
      return;
    }
    if (res.json.needs_single_slot) {
      await api("/v1/vault/single/prepare", { method: "POST", body: "{}" });
      const st = await api("/v1/vault/state");
      state.slots = st.json.slots || [];
      applyDeliveryCapabilities(st.json);
    }
    if (state.inCollection && state.slots.length) {
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
  });

  function showAlreadySealedSingle(slot) {
    showError("");
    $("success-date").textContent = formatWrittenDate(slot.delivery_at);
    $("success-letter-id").textContent = slot.public_letter_id || "";
    $("btn-return-collection").hidden = true;
    if (window.LvManage) LvManage.renderSuccessDeliveryBlock(slot);
    showStep("step-success");
  }

  $("go-manage").addEventListener("click", () => showStep("step-manage-entry"));
  $("back-entry").addEventListener("click", () => showStep("step-entry"));

  $("form-manage").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (window.LvManage) await LvManage.submitSecureLinkRequest();
  });
  $("manage-sent-back").addEventListener("click", () => showStep("step-entry"));
  $("manage-delivery-back")?.addEventListener("click", () => showStep("step-entry"));

  function setupCollectionInit() {
    state.selectedMilestoneAges = [];
    state.milestoneOptions = [];
    $("btn-collection-init").textContent = "CREATE MY COLLECTION";
    $("btn-collection-init").disabled = false;

    $("collection-title-display").textContent = state.displayTitle || "Your Letter Collection";
    if (state.mechanism === "FIXED_MILESTONES") {
      $("collection-init-copy").textContent =
        "When was she born? We'll show future milestone birthdays you can choose from.";
      $("collection-init-fields").innerHTML =
        '<label for="base-date">Date of birth</label>' +
        '<input type="date" id="base-date" required>' +
        '<p class="vault-hint">Past milestones will not appear.</p>' +
        '<div id="milestone-picker" hidden></div>';
      $("btn-collection-init").disabled = true;
      $("btn-collection-init").textContent = "CREATE MY COLLECTION";
      setTimeout(function () {
        const bd = $("base-date");
        if (bd) bd.onchange = loadMilestoneOptions;
      }, 0);
    } else if (state.mechanism === "RECURRING") {
      const isAnniversary = /anniversary/i.test(state.displayTitle || "");
      $("collection-init-copy").textContent = isAnniversary
        ? "What date is your anniversary?"
        : "What is the birthday we should calculate from?";
      $("collection-init-fields").innerHTML =
        '<label for="base-date">' +
        (isAnniversary ? "Anniversary date" : "Date of birth") +
        '</label>' +
        '<input type="date" id="base-date" required>' +
        '<div id="recurring-preview" hidden></div>';
      $("btn-collection-init").disabled = true;
      $("btn-collection-init").textContent = "CREATE MY COLLECTION";
      setTimeout(function () {
        const bd = $("base-date");
        if (bd) bd.onchange = loadRecurringPreview;
      }, 0);
    } else {
      $("collection-init-copy").textContent =
        "We'll prepare your letter slots. You can choose each moment when you're ready.";
      $("collection-init-fields").innerHTML = "";
    }
  }

  async function loadRecurringPreview() {
    showError("");
    const bd = $("base-date")?.value;
    const panel = $("recurring-preview");
    if (!bd || !panel) return;
    const res = await api("/v1/vault/collection/recurring-preview", {
      method: "POST",
      body: JSON.stringify({ base_date: bd }),
    });
    if (res.status !== 200 || res.json.status !== "ok") {
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

  async function loadMilestoneOptions() {
    showError("");
    const dob = $("base-date")?.value;
    const picker = $("milestone-picker");
    if (!dob || !picker) return;

    const res = await api("/v1/vault/collection/milestone-options", {
      method: "POST",
      body: JSON.stringify({ base_date: dob }),
    });

    if (res.status !== 200 || res.json.status !== "ok") {
      showError(res.json.message || "Could not load milestone options.");
      picker.hidden = true;
      return;
    }

    state.milestoneOptions = res.json.future_valid_options || [];
    state.selectedMilestoneAges = [];
    state.lettersAllowed = res.json.letters_required;

    if (!res.json.sufficient) {
      showError(
        "Only " +
          res.json.future_valid_count +
          " future milestone birthdays are available for this date of birth, but this collection includes " +
          res.json.letters_required +
          " letters. Additional supported milestones may need to be added to this product.",
      );
      picker.hidden = true;
      $("btn-collection-init").disabled = true;
      return;
    }

    picker.hidden = false;
    picker.innerHTML =
      '<p class="vault-sub">Choose exactly ' +
      res.json.letters_required +
      " milestone birthdays for this collection.</p>" +
      '<p class="vault-hint" id="milestone-selection-count">0 of ' +
      res.json.letters_required +
      " selected</p>" +
      '<div class="choice-grid" id="milestone-option-grid"></div>';

    const grid = $("milestone-option-grid");
    state.milestoneOptions.forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-btn";
      btn.dataset.age = String(opt.age);
      btn.innerHTML =
        "<span class='choice-label'>" +
        opt.moment_label +
        "</span><span class='choice-hint'>" +
        opt.delivery_written +
        "</span>";
      btn.addEventListener("click", () => toggleMilestoneSelection(opt.age, btn));
      grid.appendChild(btn);
    });

    updateMilestoneSelectionUi();
  }

  function toggleMilestoneSelection(age, btn) {
    const required = state.lettersAllowed;
    const idx = state.selectedMilestoneAges.indexOf(age);
    if (idx >= 0) {
      state.selectedMilestoneAges.splice(idx, 1);
      btn.classList.remove("selected");
    } else {
      if (state.selectedMilestoneAges.length >= required) {
        showError("You can only select " + required + " milestones for this collection.");
        return;
      }
      state.selectedMilestoneAges.push(age);
      btn.classList.add("selected");
      showError("");
    }
    updateMilestoneSelectionUi();
  }

  function updateMilestoneSelectionUi() {
    const required = state.lettersAllowed;
    const countEl = $("milestone-selection-count");
    if (countEl) {
      countEl.textContent =
        state.selectedMilestoneAges.length + " of " + required + " selected";
    }
    $("btn-collection-init").disabled =
      state.mechanism === "FIXED_MILESTONES" &&
      state.selectedMilestoneAges.length !== required;
  }

  $("btn-collection-init").addEventListener("click", async () => {
    showError("");
    const body = {};
    const inferred =
      /my daughter/i.test(state.displayTitle || "") ? { relationship: "My daughter" } :
      /my son/i.test(state.displayTitle || "") ? { relationship: "My son" } :
      null;
    if (inferred) body.shared_recipient_context = inferred;
    const bd = $("base-date");
    if (bd && !bd.value) {
      showError("Please enter the date.");
      return;
    }
    if (bd) body.base_date = bd.value;
    if (state.mechanism === "FIXED_MILESTONES") {
      if (state.selectedMilestoneAges.length !== state.lettersAllowed) {
        showError("Please select exactly " + state.lettersAllowed + " milestone birthdays.");
        return;
      }
      body.selected_milestone_ages = [...state.selectedMilestoneAges];
    }
    const res = await api("/v1/vault/collection/init", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (res.status !== 200) {
      showError(res.json.message || "Could not create collection. Please try again.");
      return;
    }
    state.slots = res.json.slots || [];
    if (body.shared_recipient_context?.relationship) {
      state.sharedRecipient = body.shared_recipient_context.relationship;
    }
    renderCollection();
    showStep("step-collection");
  });

  function renderCollection() {
    $("collection-subtitle").textContent = state.displayTitle || "";
    const sealed = state.slots.filter((s) => s.slot_status === "SEALED").length;
    $("collection-progress").textContent = sealed + " of " + state.slots.length + " letters sealed";
    const emotional = $("collection-emotional");
    if (sealed > 0 && sealed < state.slots.length) {
      emotional.textContent =
        "One is waiting for her now. The others will be here whenever you're ready.";
      emotional.hidden = false;
    } else {
      emotional.hidden = true;
    }
    const list = $("slot-list");
    list.innerHTML = "";
    state.slots.forEach((slot) => {
      const li = document.createElement("li");
      li.className = "slot-item" + (slot.slot_status === "SEALED" ? " sealed" : "");
      const meta = document.createElement("div");
      meta.className = "slot-meta";
      const dateLine =
        slot.delivery_at && state.mechanism !== "FREE_COLLECTION"
          ? formatWrittenDate(slot.delivery_at)
          : slot.recipient_context?.relationship
            ? slot.recipient_context.relationship
            : "";
      meta.innerHTML =
        "<strong>" +
        (slot.slot_status === "SEALED" ? "🔒 " : "") +
        (slot.moment_label || "Letter " + slot.slot_index) +
        "</strong><span>" +
        dateLine +
        "</span>";
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
          if (slotDateIsPredefined(slot)) openPredefinedSlot(slot);
          else openFreeCollectionSlot(slot);
        });
        li.appendChild(btn);
      } else {
        const wrap = document.createElement("div");
        wrap.className = "slot-sealed-wrap";
        const span = document.createElement("span");
        span.textContent = "SEALED";
        span.className = "slot-status-sealed";
        wrap.appendChild(span);
        if (window.LvManage && slot.public_letter_id) {
          const emailLine = document.createElement("p");
          emailLine.className = "slot-delivery-email";
          emailLine.textContent = LvManage.deliveryEmailLabel(slot);
          wrap.appendChild(emailLine);
          const emailBtn = document.createElement("button");
          emailBtn.type = "button";
          emailBtn.className = "link-btn";
          emailBtn.textContent = LvManage.deliveryEmailActionLabel(slot);
          emailBtn.addEventListener("click", () => {
            LvManage.openDeliveryEmail(slot.public_letter_id, slot);
          });
          wrap.appendChild(emailBtn);
        }
        li.appendChild(wrap);
      }
      list.appendChild(li);
    });
  }

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
    resetDateStep();
    showStep("step-date");
  }

  function setupRecipientStep(freeMoment) {
    const grid = $("recipient-choices");
    grid.innerHTML = "";
    $("someone-else-fields").hidden = true;
    $("custom-relationship").value = "";
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
        if (r.label === "Someone else") {
          $("someone-else-fields").hidden = false;
          $("custom-relationship").focus();
          requestAnimationFrame(() => {
            $("someone-else-fields").scrollIntoView({ behavior: "smooth", block: "nearest" });
          });
        } else {
          resetDateStep();
          showStep("step-date");
        }
      });
      grid.appendChild(btn);
    });
    const customField = $("custom-relationship");
    customField.onchange = customField.onblur = continueFromSomeoneElse;
    customField.onkeydown = function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        continueFromSomeoneElse();
      }
    };
  }

  function resetDateStep() {
    $("date-extra").hidden = true;
    $("date-extra").innerHTML = "";
    $("date-confirm-panel").hidden = true;
    $("btn-confirm-date").hidden = true;
    state.deliveryAt = state.dateLocked ? state.deliveryAt : null;
    const grid = $("date-choices");
    grid.innerHTML = "";
    DATE_OPTIONS.forEach((o) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-btn";
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
      headline || "This letter will arrive";
    $("confirm-date-display").textContent = formatWrittenDate(iso);
    $("confirm-date-sub").textContent = subcopy || "We'll keep it until then.";
    $("btn-confirm-date").hidden = false;
  }

  function selectDateOption(action) {
    showError("");
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
        b.innerHTML =
          "<span class='choice-label'>" +
          age +
          "th birthday</span>";
        b.onclick = () => pickBirthdayMilestone(age);
        mg.appendChild(b);
      });
      const otherBtn = document.createElement("button");
      otherBtn.type = "button";
      otherBtn.className = "choice-btn";
      otherBtn.innerHTML = "<span class='choice-label'>Other</span><span class='choice-hint'>Choose another future birthday.</span>";
      otherBtn.onclick = () => {
        $("birthday-other").hidden = false;
      };
      mg.appendChild(otherBtn);
      $("other-age")?.addEventListener("change", function () {
        const age = parseInt(this.value, 10);
        if (age > 0) pickBirthdayMilestone(age);
      });
      return;
    }

    if (action === "anniversary") {
      extra.innerHTML =
        '<p class="vault-sub">Choose the anniversary date this letter should arrive.</p>' +
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
        showDateConfirm(iso, "We'll keep it until then.");
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
        showDateConfirm(iso, "We'll keep it until then.");
      });
    }
  }

  function pickBirthdayMilestone(age) {
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
    showDateConfirm(iso, "We'll keep it until then.");
  }

  $("btn-confirm-date").addEventListener("click", async () => {
    if (!state.deliveryAt || !isFutureDate(state.deliveryAt)) {
      showError("Please choose a future date.");
      return;
    }
    showError("");
    if (state.flowMode === "free-moment") {
      await api("/v1/vault/slots/" + state.currentSlot.slot_id, {
        method: "PATCH",
        body: JSON.stringify({
          delivery_at: state.deliveryAt,
          recipient_context: recipientContext(),
          moment_label: state.currentSlot.moment_label,
        }),
      });
    }
    goWrite();
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
    $("write-prompts").hidden = !$("write-prompts").hidden;
  });

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
    const forLabel =
      state.currentSlot?.moment_label && state.flowMode === "collection-write"
        ? state.currentSlot.moment_label
        : recipientContext().relationship || state.recipient;
    $("review-meta").innerHTML =
      "<p><strong>For:</strong> " +
      forLabel +
      "</p><p><strong>Delivery:</strong> " +
      formatWrittenDate(state.deliveryAt) +
      "</p><p><strong>Delivery email</strong><br>Not added yet</p>";
    $("seal-understand").checked = false;
    $("btn-seal").disabled = true;
    showStep("step-review");
  });

  $("seal-understand").addEventListener("change", function () {
    $("btn-seal").disabled = !this.checked;
  });
  $("btn-back-write").addEventListener("click", () => showStep("step-write"));

  $("btn-seal").addEventListener("click", async () => {
    showError("");
    $("btn-seal").disabled = true;
    let text = $("letter-body").value;
    const dear = $("dear-line").value.trim();
    if (dear) text = "Dear " + dear + ",\n\n" + text;

    await api("/v1/vault/slots/" + state.currentSlot.slot_id, {
      method: "PATCH",
      body: JSON.stringify({
        delivery_at: state.deliveryAt,
        recipient_context: recipientContext(),
        moment_label: state.currentSlot.moment_label,
      }),
    });

    const res = await api("/v1/vault/slots/" + state.currentSlot.slot_id + "/seal", {
      method: "POST",
      body: JSON.stringify({
        letter_text: text,
        delivery_at: state.deliveryAt,
        recipient_context: recipientContext(),
        moment_label: state.currentSlot.moment_label,
      }),
    });

    if (res.status !== 200 || res.json.status !== "ok") {
      showError(res.json.message || "We couldn't seal your letter. Please try again.");
      $("btn-seal").disabled = false;
      return;
    }

    LvDraft.clearDraft(state.entitlementId, state.currentSlot.slot_id);
    $("success-date").textContent = formatWrittenDate(res.json.delivery_at);
    $("success-letter-id").textContent = res.json.public_letter_id;
    $("btn-return-collection").hidden = !state.inCollection;

    const st = await api("/v1/vault/state");
    state.slots = st.json.slots || [];
    applyDeliveryCapabilities(st.json);
    const sealedSlot =
      state.slots.find((s) => s.public_letter_id === res.json.public_letter_id) ||
      state.currentSlot;
    if (window.LvManage) {
      LvManage.renderSuccessDeliveryBlock({
        ...sealedSlot,
        public_letter_id: res.json.public_letter_id,
        has_delivery_email: false,
      });
    }
    showStep("step-success");
  });

  $("btn-copy-id").addEventListener("click", () => {
    navigator.clipboard.writeText($("success-letter-id").textContent);
  });

  $("btn-return-collection").addEventListener("click", () => {
    renderCollection();
    showStep("step-collection");
  });

  window.addEventListener("popstate", () => {
    if ($("step-success").classList.contains("active")) {
      history.pushState(null, "", location.href);
    }
  });

  if (window.LvManage && LvManage.tryOpenFromUrl()) {
    /* opened management session from magic link */
  }
})();
