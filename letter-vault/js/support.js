(function () {
  "use strict";

  const SUPPORT_STEPS = [
    "step-entry",
    "step-collection",
    "step-write",
    "step-review",
    "step-success",
    "step-manage-entry",
    "step-manage-delivery",
    "step-manage-done",
    "step-manage-sent",
  ];

  const MESSAGE_MAX = 2000;
  let currentScreen = "step-entry";

  const $ = (id) => document.getElementById(id);

  function activeVaultScreen() {
    const active = document.querySelector(".vault-step.active");
    return active?.id || currentScreen;
  }

  function prefillEmail() {
    const field = $("support-email");
    if (!field || field.value.trim()) return;
    const state = window.LvVaultState;
    if (state?.purchaserEmail) {
      field.value = state.purchaserEmail;
      return;
    }
    const purchase = $("purchase-email")?.value.trim();
    if (purchase) {
      field.value = purchase;
      return;
    }
    const manage = $("manage-email")?.value.trim();
    if (manage) field.value = manage;
  }

  function publicLetterHint() {
    const state = window.LvVaultState;
    if (state?.currentSlot?.public_letter_id) {
      return state.currentSlot.public_letter_id;
    }
    const successId = $("success-letter-id")?.textContent?.trim();
    if (successId && successId.startsWith("LV-")) return successId;
    return null;
  }

  function showSupportView(view) {
    $("support-form-view")?.classList.toggle("hidden", view !== "form");
    $("support-success-view")?.classList.toggle("hidden", view !== "success");
    $("support-error-view")?.classList.toggle("hidden", view !== "error");
  }

  function openModal() {
    currentScreen = activeVaultScreen();
    prefillEmail();
    $("support-message").value = "";
    $("support-form-error").hidden = true;
    showSupportView("form");
    $("support-modal")?.classList.add("open");
    $("support-modal")?.setAttribute("aria-hidden", "false");
    document.body.classList.add("support-modal-open");
    setTimeout(() => $("support-email")?.focus(), 50);
  }

  function closeModal() {
    $("support-modal")?.classList.remove("open");
    $("support-modal")?.setAttribute("aria-hidden", "true");
    document.body.classList.remove("support-modal-open");
  }

  async function submitSupport() {
    const email = $("support-email")?.value.trim();
    const message = $("support-message")?.value.trim();
    const errEl = $("support-form-error");
    const btn = $("support-send-btn");

    if (!email) {
      errEl.textContent = "Please enter your email address.";
      errEl.hidden = false;
      return;
    }
    if (!message || message.length < 10) {
      errEl.textContent = "Please tell us a little more so we can help.";
      errEl.hidden = false;
      return;
    }
    if (message.length > MESSAGE_MAX) {
      errEl.textContent = "Your message is too long. Please shorten it and try again.";
      errEl.hidden = false;
      return;
    }

    errEl.hidden = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "SENDING…";
    }

    const headers = { "Content-Type": "application/json" };
    if (window.LvVaultState?.session) {
      headers["X-Letter-Vault-Session"] = window.LvVaultState.session;
    }
    const mgmtSession = window.LvManage?.getSession?.();
    if (mgmtSession) {
      headers["X-Letter-Vault-Management-Session"] = mgmtSession;
    }

    const payload = {
      customer_email: email,
      message: message,
      vault_screen: currentScreen,
    };
    const hint = publicLetterHint();
    if (hint) payload.public_letter_id = hint;

    try {
      const res = await fetch(window.LETTER_VAULT_API + "/v1/vault/support/contact", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 200 && json.status === "ok") {
        showSupportView("success");
      } else {
        showSupportView("error");
      }
    } catch {
      showSupportView("error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "SEND MESSAGE →";
      }
    }
  }

  function injectSupportLinks() {
    SUPPORT_STEPS.forEach(function (stepId) {
      const step = $(stepId);
      if (!step || step.querySelector(".vault-support-footer")) return;
      const footer = document.createElement("p");
      footer.className = "vault-footer vault-support-footer";
      footer.innerHTML =
        '<button type="button" class="link-btn vault-support-open">NEED HELP? CONTACT US →</button>';
      step.appendChild(footer);
    });
  }

  function init() {
    injectSupportLinks();

    document.addEventListener("click", function (e) {
      const openBtn = e.target.closest(".vault-support-open");
      if (openBtn) {
        e.preventDefault();
        openModal();
        return;
      }
      if (e.target.matches("[data-support-close]")) {
        e.preventDefault();
        closeModal();
      }
      if (e.target.id === "support-modal-backdrop") {
        closeModal();
      }
    });

    $("support-send-btn")?.addEventListener("click", submitSupport);
    $("support-message")?.addEventListener("input", function () {
      const counter = $("support-message-count");
      if (counter) counter.textContent = String(this.value.length);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && $("support-modal")?.classList.contains("open")) {
        closeModal();
      }
    });
  }

  window.LvSupport = {
    open: openModal,
    close: closeModal,
    init: init,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
