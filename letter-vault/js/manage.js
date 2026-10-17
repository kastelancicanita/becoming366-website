(function () {
  "use strict";

  const mgmt = {
    session: null,
    letterId: null,
    metadata: null,
    selectedMode: null,
    authChannel: null,
    deliveryCapabilities: null,
    returnStep: "step-entry",
    collectionWide: false,
  };

  const $ = (id) => document.getElementById(id);

  function parseApiResponse(r, text) {
    let json = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = {
          status: "error",
          message: text.slice(0, 200) || "Unexpected server response.",
        };
      }
    }
    return { status: r.status, json };
  }

  function vaultApi(path, opts) {
    const headers = {
      "Content-Type": "application/json",
      ...(opts && opts.headers),
    };
    if (window.LvVaultState?.session) {
      headers["X-Letter-Vault-Session"] = window.LvVaultState.session;
    }
    return fetch(window.LETTER_VAULT_API + path, {
      ...opts,
      headers,
    }).then(async (r) => parseApiResponse(r, await r.text()));
  }

  function hasActiveVaultSession() {
    return Boolean(window.LvVaultState?.session);
  }

  function deliveryCapabilitiesFrom(source) {
    if (source && typeof source.surprise_delivery_email_available === "boolean") {
      return {
        surprise_delivery_email_available: source.surprise_delivery_email_available,
        surprise_unavailable_message: source.surprise_unavailable_message ?? null,
        surprise_declaration_text: source.surprise_declaration_text ?? null,
      };
    }
    if (mgmt.deliveryCapabilities) return mgmt.deliveryCapabilities;
    if (window.LvVaultState?.surprise_delivery_email_available !== undefined) {
      return {
        surprise_delivery_email_available:
          window.LvVaultState.surprise_delivery_email_available,
        surprise_unavailable_message:
          window.LvVaultState.surprise_unavailable_message ?? null,
        surprise_declaration_text:
          window.LvVaultState.surprise_declaration_text ?? null,
      };
    }
    return {
      surprise_delivery_email_available:
        window.LETTER_VAULT_UI_ENV !== "production",
      surprise_unavailable_message: null,
      surprise_declaration_text: null,
    };
  }

  function storeDeliveryCapabilities(source) {
    mgmt.deliveryCapabilities = deliveryCapabilitiesFrom(source);
    if (window.LvVaultState) {
      window.LvVaultState.surprise_delivery_email_available =
        mgmt.deliveryCapabilities.surprise_delivery_email_available;
      window.LvVaultState.surprise_unavailable_message =
        mgmt.deliveryCapabilities.surprise_unavailable_message;
      window.LvVaultState.surprise_declaration_text =
        mgmt.deliveryCapabilities.surprise_declaration_text;
    }
  }

  function updateManageDeliveryIntro() {
    const el = $("manage-delivery-sub");
    if (!el) return;
    if (mgmt.collectionWide) {
      el.textContent =
        "Add or change where letters in this collection will be delivered. Your letters stay sealed.";
    } else {
      el.textContent =
        "Add or change where this letter will be delivered. Your letter stays sealed.";
    }
  }

  function collectionDeliverySummaryStatus(collection) {
    if (!collection) return "Not added yet";
    if (collection.delivery_email_pending_verification) {
      const masked =
        collection.pending_delivery_email_masked ||
        collection.delivery_email_masked ||
        "";
      return masked ? "Pending verification · " + masked : "Pending verification";
    }
    if (!collection.has_delivery_email) return "Not added yet";
    return collection.delivery_email_masked || "Added";
  }

  function updateSaveButtonState() {
    const btn = $("btn-save-delivery-email");
    if (!btn) return;
    // Always clickable — saveDeliveryEmail shows clear errors if something is missing.
    // (Disabled buttons + hover styling that matched "selected" blocked users from saving.)
    btn.disabled = false;
  }

  function updateSurpriseDeclarationVisibility(surpriseAvailable) {
    const declarationBlock = $("mgmt-surprise-declaration");
    const declarationCheck = $("mgmt-surprise-declaration-check");
    if (!declarationBlock) return;

    const showDeclaration =
      surpriseAvailable === true && mgmt.selectedMode === "surprise";

    declarationBlock.hidden = !showDeclaration;
    if (!showDeclaration && declarationCheck) {
      declarationCheck.checked = false;
    }
    updateSaveButtonState();
  }

  function applySurpriseModeUi(capabilitySource) {
    const caps = deliveryCapabilitiesFrom(capabilitySource);
    const surpriseBtn = $("btn-manage-mode-surprise");
    const verifyBtn = $("btn-manage-mode-verify");
    const notice = $("mgmt-surprise-unavailable");
    const declarationText = $("mgmt-surprise-declaration-text");
    if (!surpriseBtn || !verifyBtn) return;

    const surpriseAvailable = caps.surprise_delivery_email_available === true;

    if (!surpriseAvailable) {
      surpriseBtn.hidden = true;
      surpriseBtn.disabled = true;
      if (notice) notice.hidden = false;
      if (mgmt.selectedMode === "surprise") {
        mgmt.selectedMode = "verify_now";
        document.querySelectorAll(".mgmt-mode-btn").forEach((b) => b.classList.remove("selected"));
        verifyBtn.classList.add("selected");
      }
    } else {
      surpriseBtn.hidden = false;
      surpriseBtn.disabled = false;
      if (notice) notice.hidden = true;
      if (declarationText && caps.surprise_declaration_text) {
        declarationText.textContent = caps.surprise_declaration_text;
      }
    }
    updateSurpriseDeclarationVisibility(surpriseAvailable);
  }

  function formatDeliverySummaryDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  function deliveryEmailMetadataStatus(meta) {
    if (!meta) return "Not added yet";
    if (meta.delivery_email_pending_verification) {
      const masked =
        meta.pending_delivery_email_masked || meta.delivery_email_masked || "";
      return masked ? "Pending verification · " + masked : "Pending verification";
    }
    if (meta.has_delivery_email) {
      const masked = meta.delivery_email_masked || "";
      return masked ? "Added · " + masked : "Added";
    }
    return "Not added yet";
  }

  function renderDeliverySummary(letterId, deliveryAt, emailStatus) {
    $("mgmt-letter-summary").innerHTML =
      "<p><strong>Letter ID</strong> " +
      (letterId || "—") +
      "</p><p><strong>Delivery</strong> " +
      formatDeliverySummaryDate(deliveryAt) +
      "</p><p><strong>Current delivery email</strong> " +
      (emailStatus || "Not added yet") +
      "</p>";
  }

  function renderManagementCancelActions(context) {
    const wrap = $("mgmt-cancel-actions");
    const saveBtn = $("btn-save-delivery-email");
    if (!wrap || !window.LvCancel) return;
    wrap.innerHTML = "";
    const cancelled =
      context?.letter_status === "CANCELLED" ||
      context?.delivery_status === "CANCELLED";
    if (cancelled) {
      wrap.innerHTML =
        '<p class="slot-status-cancelled">CANCELLED</p>' +
        '<p class="vault-hint">This letter will not be delivered.</p>';
      if (saveBtn) saveBtn.hidden = true;
      document
        .querySelectorAll(".mgmt-mode-btn, #mgmt-delivery-email")
        .forEach((el) => {
          if (el) el.disabled = true;
        });
      return;
    }
    if (saveBtn) saveBtn.hidden = false;
    document
      .querySelectorAll(".mgmt-mode-btn, #mgmt-delivery-email")
      .forEach((el) => {
        if (el) el.disabled = false;
      });
    if (!context?.cancellable) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "link-btn-destructive";
    btn.textContent = "CANCEL THIS LETTER";
    btn.addEventListener("click", () => {
      LvCancel.openCancelLetter(null, {
        publicLetterId: mgmt.letterId,
        deliveryAt: context.delivery_at || context.scheduled_delivery_at,
        channel: mgmt.authChannel === "management" ? "management" : "vault",
        managementSession: mgmt.session,
        onSuccess: () => {
          if (mgmt.authChannel === "management") {
            LvManage.openManagementSession();
          } else {
            renderManagementCancelActions({
              letter_status: "CANCELLED",
              delivery_status: "CANCELLED",
            });
          }
        },
        onError: showMgmtError,
      });
    });
    wrap.appendChild(btn);
  }

  function mgmtApi(path, opts) {
    const headers = {
      "Content-Type": "application/json",
      ...(opts && opts.headers),
    };
    if (mgmt.session) {
      headers["X-Letter-Vault-Management-Session"] = mgmt.session;
    }
    return fetch(window.LETTER_VAULT_API + path, {
      ...opts,
      headers,
    }).then(async (r) => parseApiResponse(r, await r.text()));
  }

  function showMgmtError(msg) {
    const el = $("mgmt-error");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      return;
    }
    el.textContent = msg;
    el.hidden = false;
  }

  function showStep(id) {
    document.querySelectorAll(".vault-step").forEach((s) => {
      s.classList.toggle("active", s.id === id);
    });
  }

  const MGMT_STORE_KEY = "lv_mgmt_session_v1";

  function persistMgmtSession() {
    if (!mgmt.session || !mgmt.letterId) return;
    sessionStorage.setItem(
      MGMT_STORE_KEY,
      JSON.stringify({ session: mgmt.session, letterId: mgmt.letterId }),
    );
  }

  function restoreMgmtSession() {
    try {
      const raw = sessionStorage.getItem(MGMT_STORE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.session) mgmt.session = parsed.session;
      if (parsed?.letterId) mgmt.letterId = parsed.letterId;
    } catch {
      /* ignore */
    }
  }

  function clearMgmtSession() {
    mgmt.session = null;
    mgmt.letterId = null;
    mgmt.metadata = null;
    sessionStorage.removeItem(MGMT_STORE_KEY);
  }

  function canReuseMgmtSession(letterId) {
    return Boolean(mgmt.session && mgmt.letterId === letterId);
  }

  function deliveryEmailStatusText(slot) {
    if (!slot) return "Not added yet";
    if (slot.delivery_email_pending_verification) {
      const masked =
        slot.pending_delivery_email_masked || slot.delivery_email_masked || "";
      return masked ? "Pending verification · " + masked : "Pending verification";
    }
    if (slot.has_delivery_email) {
      const masked = slot.delivery_email_masked || "";
      return masked ? "Added · " + masked : "Added";
    }
    return "Not added yet";
  }

  function deliveryEmailDashboardStatus(slot) {
    if (!slot) return "Not added yet";
    if (slot.delivery_email_pending_verification) {
      const masked =
        slot.pending_delivery_email_masked || slot.delivery_email_masked || "";
      return masked ? "Pending verification · " + masked : "Pending verification";
    }
    if (!slot.has_delivery_email) return "Not added yet";
    const masked = slot.delivery_email_masked || "";
    if (slot.delivery_email_mode === "surprise") {
      return masked ? "Added · " + masked : "Added";
    }
    if (slot.delivery_email_mode === "verified") {
      return masked ? "Added · " + masked : "Added";
    }
    return masked ? "Added · " + masked : "Added";
  }

  async function refreshVaultSlotsAfterDeliverySave() {
    if (!hasActiveVaultSession() || !window.LvVaultRefreshState) return;
    await window.LvVaultRefreshState();
  }

  window.LvManage = {
    returnStep: "step-entry",
    getSession: function () {
      return mgmt.session;
    },
    deliveryEmailStatusText: deliveryEmailStatusText,

    deliveryEmailDashboardStatus: deliveryEmailDashboardStatus,

    deliveryEmailLabel: function (slot) {
      return "Delivery email: " + deliveryEmailDashboardStatus(slot);
    },

    deliveryEmailActionLabel: function (slot) {
      if (slot?.delivery_email_pending_verification) {
        return "UPDATE DELIVERY EMAIL →";
      }
      return slot?.has_delivery_email
        ? "CHANGE DELIVERY EMAIL →"
        : "ADD DELIVERY EMAIL →";
    },

    renderSuccessDeliveryBlock: function (slot) {
      const block = $("success-email-block");
      if (!block) return;
      const status = deliveryEmailStatusText(slot);
      const hasEmail = Boolean(slot.has_delivery_email);
      block.innerHTML =
        '<p class="success-receipt-label">Delivery email</p>' +
        '<p class="success-receipt-value success-email-status">' +
        status +
        "</p>" +
        (hasEmail && !slot.delivery_email_pending_verification
          ? ""
          : '<p class="success-email-note">That\'s okay. You can add it securely whenever you\'re ready.</p>') +
        '<button type="button" class="success-delivery-link delivery-email-action" id="success-delivery-action">' +
        LvManage.deliveryEmailActionLabel(slot) +
        "</button>";
      $("success-delivery-action")?.addEventListener("click", () => {
        LvManage.openDeliveryEmail(slot.public_letter_id, slot);
      });
    },

    openDeliveryEmail: function (letterId, slot, returnStep) {
      if (slot?.uses_collection_delivery && hasActiveVaultSession()) {
        LvManage.openCollectionDeliveryEmail(returnStep);
        return;
      }
      if (hasActiveVaultSession()) {
        LvManage.openVaultDeliveryEmail(letterId, slot, returnStep);
        return;
      }
      LvManage.requestSecureLink(letterId);
    },

    openCollectionDeliveryEmail: function (returnStep) {
      showMgmtError("");
      mgmt.authChannel = "vault";
      mgmt.collectionWide = true;
      mgmt.letterId = null;
      mgmt.session = null;
      mgmt.metadata = null;
      mgmt.returnStep =
        returnStep ||
        (document.getElementById("step-collection")?.classList.contains("active")
          ? "step-collection"
          : "step-entry");
      window.LvManage.returnStep = mgmt.returnStep;
      storeDeliveryCapabilities(window.LvVaultState);
      const collection = window.LvVaultState?.collection;
      const recipientLine =
        collection?.shared_recipient_display || "—";
      $("mgmt-letter-summary").innerHTML =
        "<p><strong>Collection recipient</strong> " +
        recipientLine +
        "</p><p><strong>Current collection delivery email</strong> " +
        collectionDeliverySummaryStatus(collection) +
        "</p>";
      updateManageDeliveryIntro();
      $("mgmt-delivery-email").value = "";
      mgmt.selectedMode = null;
      document.querySelectorAll(".mgmt-mode-btn").forEach((b) => b.classList.remove("selected"));
      if ($("mgmt-surprise-declaration-check")) {
        $("mgmt-surprise-declaration-check").checked = false;
      }
      applySurpriseModeUi(window.LvVaultState);
      showStep("step-manage-delivery");
    },

    renderPredefinedSuccessDeliveryBlock: function () {
      const block = $("success-email-block");
      if (!block) return;
      const collection = window.LvVaultState?.collection;
      let status = "Not added yet";
      if (collection?.delivery_email_pending_verification) {
        const masked =
          collection.pending_delivery_email_masked ||
          collection.delivery_email_masked ||
          "";
        status = masked ? "Pending verification · " + masked : "Pending verification";
      } else if (collection?.has_delivery_email) {
        const masked = collection.delivery_email_masked || "";
        status = masked ? "Added · " + masked : "Added";
      }
      block.innerHTML =
        '<p class="success-receipt-label">Collection delivery email</p>' +
        '<p class="success-receipt-value success-email-status">' +
        status +
        "</p>" +
        (collection?.has_delivery_email && !collection.delivery_email_pending_verification
          ? ""
          : '<p class="success-email-note">That\'s okay. You can add it for the whole collection from your dashboard whenever you\'re ready.</p>') +
        '<button type="button" class="success-delivery-link delivery-email-action" id="success-delivery-action">' +
        (collection?.delivery_email_pending_verification
          ? "UPDATE COLLECTION DELIVERY EMAIL →"
          : collection?.has_delivery_email
            ? "CHANGE COLLECTION DELIVERY EMAIL →"
            : "ADD COLLECTION DELIVERY EMAIL →") +
        "</button>";
      $("success-delivery-action")?.addEventListener("click", () => {
        LvManage.openCollectionDeliveryEmail("step-success");
      });
    },

    openVaultDeliveryEmail: function (letterId, slot, returnStep) {
      showMgmtError("");
      mgmt.authChannel = "vault";
      mgmt.collectionWide = false;
      mgmt.letterId = letterId;
      mgmt.session = null;
      mgmt.metadata = null;
      mgmt.returnStep =
        returnStep ||
        (document.getElementById("step-collection")?.classList.contains("active")
          ? "step-collection"
          : document.getElementById("step-success")?.classList.contains("active")
            ? "step-success"
            : "step-entry");
      window.LvManage.returnStep = mgmt.returnStep;
      storeDeliveryCapabilities(window.LvVaultState);
      renderDeliverySummary(
        letterId,
        slot?.delivery_at || null,
        deliveryEmailDashboardStatus(slot),
      );
      updateManageDeliveryIntro();
      $("mgmt-delivery-email").value = "";
      mgmt.selectedMode = null;
      document.querySelectorAll(".mgmt-mode-btn").forEach((b) => b.classList.remove("selected"));
      if ($("mgmt-surprise-declaration-check")) {
        $("mgmt-surprise-declaration-check").checked = false;
      }
      applySurpriseModeUi(window.LvVaultState);
      renderManagementCancelActions({
        cancellable: slot?.cancellable,
        letter_status: slot?.letter_status,
        delivery_at: slot?.delivery_at,
      });
      showStep("step-manage-delivery");
    },

    requestSecureLink: async function (letterId) {
      const lid = letterId || $("success-letter-id")?.textContent?.trim();
      if (!lid) return;
      restoreMgmtSession();
      if (canReuseMgmtSession(lid)) {
        mgmt.letterId = lid;
        await LvManage.openManagementSession();
        return;
      }
      if (mgmt.session) {
        clearMgmtSession();
      }
      $("manage-letter-id").value = lid;
      if (window.LvVaultState?.purchaserEmail) {
        $("manage-email").value = window.LvVaultState.purchaserEmail;
      }
      showStep("step-manage-entry");
      showMgmtError("");
    },

    submitSecureLinkRequest: async function () {
      showMgmtError("");
      const letterId = $("manage-letter-id").value.trim();
      const email = $("manage-email").value.trim();
      await fetch(window.LETTER_VAULT_API + "/v1/staging/management/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ letter_id: letterId, purchaser_email: email }),
      });
      $("manage-request-letter-id").textContent = letterId;
      showStep("step-manage-sent");
    },

    tryOpenFromUrl: function () {
      const params = new URLSearchParams(window.location.search);
      const activateToken = params.get("management_token");
      if (activateToken) {
        window.history.replaceState({}, "", window.location.pathname);
        LvManage.activateFromEmailToken(activateToken);
        return true;
      }
      const session = params.get("management_session");
      if (!session) return false;
      mgmt.session = session;
      mgmt.letterId = params.get("letter_id");
      persistMgmtSession();
      window.history.replaceState({}, "", window.location.pathname);
      LvManage.openManagementSession();
      return true;
    },

    activateFromEmailToken: async function (rawToken) {
      showMgmtError("");
      const res = await fetch(
        window.LETTER_VAULT_API + "/v1/staging/management/activate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: rawToken }),
        },
      );
      const json = await res.json().catch(function () {
        return {};
      });
      if (res.status !== 200 || json.status !== "ok" || !json.session_token) {
        showMgmtError(
          "This secure link has expired. Request a new one from Manage my Vault.",
        );
        showStep("step-manage-entry");
        return;
      }
      mgmt.session = json.session_token;
      mgmt.letterId = json.public_letter_id || null;
      persistMgmtSession();
      LvManage.openManagementSession();
    },

    openManagementSession: async function () {
      showMgmtError("");
      mgmt.authChannel = "management";
      const res = await mgmtApi("/v1/staging/management/session");
      if (res.status !== 200 || res.json.status !== "ok") {
        clearMgmtSession();
        showMgmtError("This secure link has expired. Request a new one from Manage my Vault.");
        showStep("step-manage-entry");
        return;
      }
      mgmt.metadata = res.json.management;
      storeDeliveryCapabilities(res.json);
      $("mgmt-letter-summary").innerHTML =
        "<p><strong>Letter ID</strong> " +
        (mgmt.letterId || "—") +
        "</p><p><strong>Delivery</strong> " +
        (mgmt.metadata.scheduled_delivery_at
          ? new Date(mgmt.metadata.scheduled_delivery_at).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
              timeZone: "UTC",
            })
          : "—") +
        "</p><p><strong>Current delivery email</strong> " +
        deliveryEmailMetadataStatus(mgmt.metadata) +
        "</p>";
      updateManageDeliveryIntro();
      $("mgmt-delivery-email").value = "";
      mgmt.selectedMode = null;
      document.querySelectorAll(".mgmt-mode-btn").forEach((b) => b.classList.remove("selected"));
      if ($("mgmt-surprise-declaration-check")) {
        $("mgmt-surprise-declaration-check").checked = false;
      }
      applySurpriseModeUi(res.json);
      renderManagementCancelActions(mgmt.metadata);
      persistMgmtSession();
      showStep("step-manage-delivery");
    },

    selectMode: function (mode, btn) {
      mgmt.selectedMode = mode;
      document.querySelectorAll(".mgmt-mode-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      updateSurpriseDeclarationVisibility(
        deliveryCapabilitiesFrom(mgmt.deliveryCapabilities ?? window.LvVaultState)
          .surprise_delivery_email_available === true,
      );
    },

    saveDeliveryEmail: async function () {
      showMgmtError("");
      const saveBtn = $("btn-save-delivery-email");
      const email = $("mgmt-delivery-email").value.trim();
      if (!email) {
        showMgmtError("Please enter a delivery email address.");
        return;
      }
      if (!mgmt.selectedMode) {
        showMgmtError("Please tap KEEP IT A SURPRISE or VERIFY THE ADDRESS NOW above.");
        return;
      }
      if (
        mgmt.selectedMode === "surprise" &&
        !$("mgmt-surprise-declaration-check")?.checked
      ) {
        showMgmtError("Please confirm the personal delivery declaration.");
        return;
      }
      if (mgmt.authChannel === "vault" && !hasActiveVaultSession()) {
        showMgmtError(
          "Your Vault session expired. Go back, enter your access code again, then add delivery email.",
        );
        return;
      }

      const payload = {
        delivery_email_mode: mgmt.selectedMode,
      };
      if (mgmt.selectedMode === "surprise") {
        payload.surprise_personal_declaration_accepted = true;
      }

      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "SAVING…";
      }

      try {
        let res;
        if (mgmt.authChannel === "vault" && hasActiveVaultSession() && mgmt.collectionWide) {
          res = await vaultApi("/v1/vault/collection/delivery-email", {
            method: "POST",
            body: JSON.stringify({
              delivery_email: email,
              ...payload,
            }),
          });
        } else if (mgmt.authChannel === "vault" && hasActiveVaultSession()) {
          res = await vaultApi("/v1/vault/delivery-email", {
            method: "POST",
            body: JSON.stringify({
              public_letter_id: mgmt.letterId,
              delivery_email: email,
              ...payload,
            }),
          });
        } else {
          res = await mgmtApi("/v1/staging/management/delivery-email/request", {
            method: "POST",
            body: JSON.stringify({
              new_delivery_email: email,
              ...payload,
            }),
          });
        }

        if (res.status !== 200 || res.json.status !== "ok") {
          if (
            res.json.error === "surprise_schema_not_ready" ||
            res.json.error === "surprise_declaration_table_missing"
          ) {
            showMgmtError(
              res.json.message ||
                "Surprise delivery needs Supabase migrations 009 and 010. Open Supabase → SQL Editor, run the SQL from the chat, then try again.",
            );
            return;
          }
          showMgmtError(
            res.json.message || "We couldn't save that address. Please try again.",
          );
          return;
        }
        $("mgmt-result-copy").textContent = res.json.message;
        const detailEl = $("mgmt-result-detail");
        if (mgmt.selectedMode === "surprise") {
          if (detailEl) {
            detailEl.textContent = "";
            detailEl.hidden = true;
          }
        } else if (detailEl) {
          detailEl.hidden = false;
          detailEl.textContent =
            "Check the new address for a verification email. The current address stays active until verification succeeds.";
        }
        if (mgmt.authChannel === "vault") {
          await refreshVaultSlotsAfterDeliverySave();
        }
        showStep("step-manage-done");
      } catch {
        showMgmtError("Network error — please check your connection and try again.");
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = "SAVE DELIVERY EMAIL →";
        }
      }
    },
  };

  $("btn-save-delivery-email")?.addEventListener("click", () => LvManage.saveDeliveryEmail());
  ["input", "change", "keyup", "paste"].forEach(function (evt) {
    $("mgmt-delivery-email")?.addEventListener(evt, function () {
      if (evt === "paste") {
        setTimeout(updateSaveButtonState, 0);
      } else {
        updateSaveButtonState();
      }
    });
  });
  $("mgmt-surprise-declaration-check")?.addEventListener("change", updateSaveButtonState);
  $("btn-manage-done")?.addEventListener("click", async () => {
    const target = mgmt.returnStep || "step-entry";
    if (hasActiveVaultSession() && window.LvVaultRefreshState) {
      await window.LvVaultRefreshState();
    }
    if (target === "step-collection" && window.LvVaultRenderCollection) {
      window.LvVaultRenderCollection();
    } else if (target === "step-success") {
      const vs = window.LvVaultState;
      if (vs?.collection?.collection_wide_delivery) {
        LvManage.renderPredefinedSuccessDeliveryBlock();
      }
    }
    showStep(target);
  });
  $("btn-manage-mode-surprise")?.addEventListener("click", function () {
    LvManage.selectMode("surprise", this);
  });
  $("btn-manage-mode-verify")?.addEventListener("click", function () {
    LvManage.selectMode("verify_now", this);
  });
})();
