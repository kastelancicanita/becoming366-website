(function () {
  "use strict";

  const mgmt = {
    session: null,
    letterId: null,
    metadata: null,
    selectedMode: null,
    authChannel: null,
    deliveryCapabilities: null,
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

  function renderDeliverySummary(letterId, deliveryAt, deliveryEmailMasked) {
    $("mgmt-letter-summary").innerHTML =
      "<p><strong>Letter ID</strong> " +
      (letterId || "—") +
      "</p><p><strong>Delivery</strong> " +
      formatDeliverySummaryDate(deliveryAt) +
      "</p><p><strong>Current delivery email</strong> " +
      (deliveryEmailMasked || "Not added yet") +
      "</p>";
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

  window.LvManage = {
    renderSuccessDeliveryBlock: function (slot) {
      const block = $("success-email-block");
      if (!block) return;
      const hasEmail = Boolean(slot.has_delivery_email);
      block.innerHTML =
        '<p class="success-email-label">Delivery email</p>' +
        '<p class="success-email-status">' +
        (hasEmail ? slot.delivery_email_masked : "Not added yet") +
        "</p>" +
        (hasEmail
          ? ""
          : '<p class="success-email-note">That\'s okay. You can add it securely whenever you\'re ready.</p>') +
        '<button type="button" class="link-btn delivery-email-action" id="success-delivery-action">' +
        (hasEmail ? "CHANGE DELIVERY EMAIL →" : "ADD DELIVERY EMAIL →") +
        "</button>";
      $("success-delivery-action")?.addEventListener("click", () => {
        LvManage.openDeliveryEmail(slot.public_letter_id, slot);
      });
    },

    openDeliveryEmail: function (letterId, slot) {
      if (hasActiveVaultSession()) {
        LvManage.openVaultDeliveryEmail(letterId, slot);
        return;
      }
      LvManage.requestSecureLink(letterId);
    },

    openVaultDeliveryEmail: function (letterId, slot) {
      showMgmtError("");
      mgmt.authChannel = "vault";
      mgmt.letterId = letterId;
      mgmt.session = null;
      mgmt.metadata = null;
      storeDeliveryCapabilities(window.LvVaultState);
      renderDeliverySummary(
        letterId,
        slot?.delivery_at || null,
        slot?.has_delivery_email ? slot.delivery_email_masked : null,
      );
      $("mgmt-delivery-email").value = "";
      mgmt.selectedMode = null;
      document.querySelectorAll(".mgmt-mode-btn").forEach((b) => b.classList.remove("selected"));
      if ($("mgmt-surprise-declaration-check")) {
        $("mgmt-surprise-declaration-check").checked = false;
      }
      applySurpriseModeUi(window.LvVaultState);
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
        (mgmt.metadata.delivery_email_masked || "Not added yet") +
        "</p>";
      $("mgmt-delivery-email").value = "";
      mgmt.selectedMode = null;
      document.querySelectorAll(".mgmt-mode-btn").forEach((b) => b.classList.remove("selected"));
      if ($("mgmt-surprise-declaration-check")) {
        $("mgmt-surprise-declaration-check").checked = false;
      }
      applySurpriseModeUi(res.json);
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
        if (mgmt.authChannel === "vault" && hasActiveVaultSession()) {
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
        $("mgmt-result-detail").textContent =
          mgmt.selectedMode === "surprise"
            ? "The recipient will not be contacted until delivery day."
            : "Check the new address for a verification email. The current address stays active until verification succeeds.";
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
  $("btn-manage-done")?.addEventListener("click", () => showStep("step-entry"));
  $("btn-manage-mode-surprise")?.addEventListener("click", function () {
    LvManage.selectMode("surprise", this);
  });
  $("btn-manage-mode-verify")?.addEventListener("click", function () {
    LvManage.selectMode("verify_now", this);
  });
})();
