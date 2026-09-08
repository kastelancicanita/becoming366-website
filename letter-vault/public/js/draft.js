/**
 * Local draft recovery — browser-only, never sent before sealing.
 * See README in letter-vault/public for privacy limitations.
 */
(function () {
  const PREFIX = "lv_draft_v1_";

  function draftKey(entitlementId, slotId) {
    return PREFIX + entitlementId + "_" + slotId;
  }

  window.LvDraft = {
    MAX_CHARS: 15000,
    charCount: function (text) {
      return [...text].length;
    },
    saveDraft: function (entitlementId, slotId, text) {
      try {
        localStorage.setItem(draftKey(entitlementId, slotId), text);
        return true;
      } catch (e) {
        return false;
      }
    },
    loadDraft: function (entitlementId, slotId) {
      try {
        return localStorage.getItem(draftKey(entitlementId, slotId)) || "";
      } catch (e) {
        return "";
      }
    },
    clearDraft: function (entitlementId, slotId) {
      try {
        localStorage.removeItem(draftKey(entitlementId, slotId));
      } catch (e) {}
    },
  };
})();
