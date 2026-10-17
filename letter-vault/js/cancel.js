(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let pendingAction = null;

  function formatCancelDate(iso) {
    if (!iso) return "its scheduled date";
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  function showCancelModal(config) {
    pendingAction = config;
    const modal = $("cancel-modal");
    const title = $("cancel-modal-title");
    const body = $("cancel-modal-body");
    const confirmBtn = $("cancel-modal-confirm");
    if (!modal || !title || !body || !confirmBtn) return;

    title.textContent = config.title;
    body.innerHTML = config.bodyHtml;
    confirmBtn.textContent = config.confirmLabel || "CANCEL LETTER";
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("cancel-modal-open");
  }

  function hideCancelModal() {
    pendingAction = null;
    const modal = $("cancel-modal");
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("cancel-modal-open");
  }

  async function vaultApi(path, body) {
    const headers = { "Content-Type": "application/json" };
    if (window.LvVaultState?.session) {
      headers["X-Letter-Vault-Session"] = window.LvVaultState.session;
    }
    const res = await fetch(window.LETTER_VAULT_API + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body || {}),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  async function managementApi(path, sessionToken) {
    const res = await fetch(window.LETTER_VAULT_API + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Letter-Vault-Management-Session": sessionToken,
      },
      body: "{}",
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  function applySlotsFromCancelResponse(json) {
    if (json.slots && window.LvVaultState) {
      window.LvVaultState.slots = json.slots;
    }
    if (window.LvVaultRefreshState) {
      return window.LvVaultRefreshState();
    }
    return Promise.resolve();
  }

  window.LvCancel = {
    formatCancelDate,

    isSlotCancelled(slot) {
      return slot?.letter_status === "CANCELLED";
    },

    isSlotCancellable(slot) {
      return Boolean(slot?.cancellable);
    },

    openCancelLetter(slot, options) {
      const publicLetterId =
        options?.publicLetterId || slot?.public_letter_id || null;
      const deliveryAt = options?.deliveryAt || slot?.delivery_at || null;
      const channel = options?.channel || "vault";
      const mgmtSession = options?.managementSession || null;

      if (!publicLetterId && channel === "vault") return;

      showCancelModal({
        title: "CANCEL THIS LETTER?",
        bodyHtml:
          "<p>This letter is scheduled for <strong>" +
          formatCancelDate(deliveryAt) +
          "</strong>.</p>" +
          "<p>If you cancel it, it will not be delivered.</p>",
        confirmLabel: "CANCEL LETTER",
        async onConfirm() {
          let res;
          if (channel === "management" && mgmtSession) {
            res = await managementApi(
              "/v1/staging/management/letters/cancel",
              mgmtSession,
            );
          } else {
            res = await vaultApi("/v1/vault/letters/cancel", {
              public_letter_id: publicLetterId,
            });
          }
          hideCancelModal();
          if (res.status !== 200 || res.json.status !== "ok") {
            const msg =
              res.json.message || "Could not cancel this letter. Please try again.";
            if (options?.onError) options.onError(msg);
            else if (window.LvVaultShowError) window.LvVaultShowError(msg);
            return;
          }
          await applySlotsFromCancelResponse(res.json);
          if (options?.onSuccess) options.onSuccess(res.json);
          else if (window.LvVaultRenderCollection) window.LvVaultRenderCollection();
        },
      });
    },

    openCancelAllRemaining(options) {
      const eligibleCount =
        options?.eligibleCount ??
        (window.LvVaultState?.slots || []).filter((s) => s.cancellable).length;

      showCancelModal({
        title: "CANCEL ALL REMAINING LETTERS?",
        bodyHtml:
          "<p>This will cancel every eligible future unsent letter in this collection (" +
          eligibleCount +
          " letter" +
          (eligibleCount === 1 ? "" : "s") +
          ").</p>" +
          "<p>Letters that have already been sent or delivered will not be affected.</p>" +
          "<p>Cancelled letters remain visible in your Vault as historical records — nothing is deleted.</p>",
        confirmLabel: "CANCEL ALL REMAINING LETTERS",
        async onConfirm() {
          const res = await vaultApi("/v1/vault/collection/cancel-remaining", {});
          hideCancelModal();
          if (res.status !== 200 || res.json.status !== "ok") {
            const msg =
              res.json.message ||
              "Could not cancel remaining letters. Please try again.";
            if (options?.onError) options.onError(msg);
            else if (window.LvVaultShowError) window.LvVaultShowError(msg);
            return;
          }
          if (res.json.not_cancelled_in_progress_count > 0) {
            const note =
              res.json.not_cancelled_in_progress_count +
              " letter(s) could not be cancelled because delivery was already in progress.";
            if (options?.onPartial) options.onPartial(note, res.json);
          }
          await applySlotsFromCancelResponse(res.json);
          if (options?.onSuccess) options.onSuccess(res.json);
          else if (window.LvVaultRenderCollection) window.LvVaultRenderCollection();
        },
      });
    },
  };

  $("cancel-modal-backdrop")?.addEventListener("click", hideCancelModal);
  $("cancel-modal-keep")?.addEventListener("click", hideCancelModal);
  $("cancel-modal-confirm")?.addEventListener("click", async () => {
    if (pendingAction?.onConfirm) await pendingAction.onConfirm();
  });
})();
