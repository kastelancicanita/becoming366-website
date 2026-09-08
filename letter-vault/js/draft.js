(function () {
  const PREFIX = "lv_draft_v1_";
  function key(e, s) { return PREFIX + e + "_" + s; }
  window.LvDraft = {
    MAX_CHARS: 15000,
    charCount: function (t) { return [...t].length; },
    saveDraft: function (e, s, t) {
      try { localStorage.setItem(key(e, s), t); return true; } catch (x) { return false; }
    },
    loadDraft: function (e, s) {
      try { return localStorage.getItem(key(e, s)) || ""; } catch (x) { return ""; }
    },
    clearDraft: function (e, s) {
      try { localStorage.removeItem(key(e, s)); } catch (x) {}
    },
  };
})();
