#!/usr/bin/env node
/**
 * Staging/preview Pages only — deploys sanitized dist/ (compliance/ excluded).
 * Does NOT deploy Worker or production.
 */
import { execSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDistExcludesCompliance,
  assertDistExcludesSensitive,
  DIST_DIR,
} from "../../scripts/pages-public-build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
/** Preview branch serves Letter Vault at site root (historical preview layout). */
const PREVIEW_DEPLOY_DIR = join(DIST_DIR, "letter-vault");

console.log("Building public Pages output (private paths excluded)...");
execSync("npm run pages:build", { stdio: "inherit", cwd: repoRoot });
assertDistExcludesCompliance(DIST_DIR);
assertDistExcludesSensitive(DIST_DIR);

if (!existsSync(join(PREVIEW_DEPLOY_DIR, "index.html"))) {
  throw new Error(
    "dist/letter-vault/index.html missing after pages:build — cannot deploy preview.",
  );
}
if (existsSync(join(PREVIEW_DEPLOY_DIR, "compliance"))) {
  throw new Error("compliance/ leaked into dist/letter-vault — aborting preview deploy.");
}

const previewRedirectsPath = join(PREVIEW_DEPLOY_DIR, "_redirects");
const complianceBlockRule = "/compliance/* /404.html 404";
const redirectsText = readFileSync(previewRedirectsPath, "utf8");
if (!redirectsText.includes("/compliance/*")) {
  appendFileSync(previewRedirectsPath, `\n${complianceBlockRule}\n`);
}
const root404 = join(DIST_DIR, "404.html");
if (existsSync(root404)) {
  cpSync(root404, join(PREVIEW_DEPLOY_DIR, "404.html"));
}

console.log("Deploying letter-vault preview branch (Pages only, dist/letter-vault/)...");
execSync(
  `npx wrangler pages deploy "${PREVIEW_DEPLOY_DIR}" --project-name=becoming366-website --branch=letter-vault-phase7-preview --commit-dirty=true`,
  { stdio: "inherit", cwd: repoRoot },
);

console.log("Preview URL: https://letter-vault-phase7-preview.becoming366-website.pages.dev/");
