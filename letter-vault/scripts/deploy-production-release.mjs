#!/usr/bin/env node
/**
 * Production release gate (Letter Vault).
 * - Does NOT set SURPRISE_DELIVERY_ENABLED (remains OFF until explicit post-E2E enable).
 * - Does NOT apply Supabase migrations (manual SQL Editor first).
 */
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertComplianceExcludedFromPagesDeploy } from "./assert-compliance-pagesignore.mjs";
import {
  assertDistExcludesCompliance,
  assertDistExcludesSensitive,
  buildPagesPublicOutput,
  DIST_DIR,
} from "../../scripts/pages-public-build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const workerDir = join(here, "..", "worker");
const repoRoot = join(here, "..", "..");

console.log("=== Letter Vault production release deploy ===");
console.log("Prerequisite: production migrations 013+014 applied and verified.");
console.log("SURPRISE_DELIVERY_ENABLED: unchanged (must stay OFF until post-E2E enable).");
console.log("");

console.log("Running full test suite...");
execSync("npm test", { stdio: "inherit", cwd: workerDir });

try {
  assertComplianceExcludedFromPagesDeploy(repoRoot);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`FATAL: ${message}`);
  process.exit(1);
}

console.log("Building public Pages output (private paths excluded)...");
execSync("npm run pages:build", { stdio: "inherit", cwd: repoRoot });
try {
  assertDistExcludesCompliance(DIST_DIR);
  assertDistExcludesSensitive(DIST_DIR);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`FATAL: ${message}`);
  process.exit(1);
}

console.log("Deploying production Worker...");
execSync("npx wrangler deploy --env production", {
  stdio: "inherit",
  cwd: workerDir,
});

console.log("Deploying frontend to becoming366.com (Pages main branch)...");
console.log(`Pages deploy directory: ${DIST_DIR}`);
execSync(
  `npx wrangler pages deploy "${DIST_DIR}" --project-name=becoming366-website --branch=main --commit-dirty=true`,
  { stdio: "inherit", cwd: repoRoot },
);

console.log("");
console.log("Production deploy complete.");
console.log("Next: node letter-vault/scripts/verify-migration-014-production.mjs");
console.log("Then: production smoke + Surprise E2E + enable SURPRISE_DELIVERY_ENABLED=true");
