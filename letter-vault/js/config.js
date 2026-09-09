/**
 * Letter Vault UI API routing (8B-2).
 * Preview/staging Pages → staging Worker. becoming366.com → production Worker.
 */
(function () {
  "use strict";

  var STAGING_API =
    "https://letter-vault-api-staging.kastelancic-anita.workers.dev";
  var PRODUCTION_API =
    "https://letter-vault-api-production.kastelancic-anita.workers.dev";

  var host = window.location.hostname.toLowerCase();
  var isProductionSite =
    host === "becoming366.com" || host === "www.becoming366.com";

  window.LETTER_VAULT_UI_ENV = isProductionSite ? "production" : "staging";
  window.LETTER_VAULT_API = isProductionSite ? PRODUCTION_API : STAGING_API;
})();
