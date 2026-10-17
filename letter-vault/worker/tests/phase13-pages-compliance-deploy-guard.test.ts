import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertComplianceExcludedFromPagesDeploy } from "../../scripts/assert-compliance-pagesignore.mjs";
import {
  assertDistExcludesCompliance,
  assertDistExcludesSensitive,
  buildPagesPublicOutput,
  DIST_DIR,
  REPO_ROOT,
  shouldExcludePagesPath,
} from "../../../scripts/pages-public-build.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PAGESIGNORE_PATH = join(REPO_ROOT, ".pagesignore");
const DEPLOY_SCRIPT_PATH = join(
  REPO_ROOT,
  "letter-vault",
  "scripts",
  "deploy-production-release.mjs",
);
const PACKAGE_JSON_PATH = join(REPO_ROOT, "package.json");

describe("Pages production deploy — compliance exclusion guard", () => {
  it("repo-root .pagesignore exists and excludes compliance/", () => {
    expect(existsSync(PAGESIGNORE_PATH)).toBe(true);
    const content = readFileSync(PAGESIGNORE_PATH, "utf8");
    expect(content).toMatch(/^\s*compliance\/\s*$/m);
  });

  it("assertComplianceExcludedFromPagesDeploy passes for repo root", () => {
    expect(() => assertComplianceExcludedFromPagesDeploy(REPO_ROOT)).not.toThrow();
  });

  it("pages-public-build excludes compliance/ and keeps public site files", () => {
    buildPagesPublicOutput();
    assertDistExcludesCompliance(DIST_DIR);

    expect(existsSync(join(DIST_DIR, "index.html"))).toBe(true);
    expect(existsSync(join(DIST_DIR, "letter-vault", "index.html"))).toBe(true);
    expect(existsSync(join(DIST_DIR, "compliance"))).toBe(false);
    expect(existsSync(join(DIST_DIR, "letter-vault", "backups"))).toBe(false);
    expect(existsSync(join(DIST_DIR, "letter-vault", "worker"))).toBe(false);
    expect(existsSync(join(DIST_DIR, "letter-vault", "migrations"))).toBe(false);
    expect(existsSync(join(DIST_DIR, "letter-vault", "scripts"))).toBe(false);
    assertDistExcludesSensitive(DIST_DIR);

    const redirects = readFileSync(join(DIST_DIR, "_redirects"), "utf8");
    expect(redirects).toContain("/compliance/* /404.html 404");
    expect(redirects).toContain("/letter-vault/backups/* /404.html 404");
    const previewRedirects = readFileSync(join(DIST_DIR, "letter-vault", "_redirects"), "utf8");
    expect(previewRedirects).toContain("/backups/* /404.html 404");
  });

  it("build omits private files and the guard rejects a planted export", () => {
    const root = mkdtempSync(join(tmpdir(), "lv-pages-src-"));
    const out = mkdtempSync(join(tmpdir(), "lv-pages-out-"));
    try {
      mkdirSync(join(root, "letter-vault", "backups"), { recursive: true });
      mkdirSync(join(root, "letter-vault", "worker"), { recursive: true });
      mkdirSync(join(root, "letter-vault", "migrations"), { recursive: true });
      writeFileSync(join(root, "index.html"), "<!doctype html><title>ok</title>");
      writeFileSync(join(root, "letter-vault", "index.html"), "<!doctype html><title>vault</title>");
      writeFileSync(join(root, "letter-vault", "backups", "export.sql"), "not-a-real-secret");
      writeFileSync(join(root, "letter-vault", "worker", ".dev.vars"), "not-a-real-secret");
      writeFileSync(join(root, "letter-vault", "migrations", "001.sql"), "-- not a dump");
      writeFileSync(join(root, ".env"), "not-a-real-secret");
      writeFileSync(join(root, "letter-vault", ".env.staging.local"), "not-a-real-secret");

      buildPagesPublicOutput(root, out);
      expect(existsSync(join(out, "index.html"))).toBe(true);
      expect(existsSync(join(out, "letter-vault", "index.html"))).toBe(true);
      expect(existsSync(join(out, "letter-vault", "backups"))).toBe(false);
      expect(existsSync(join(out, "letter-vault", "worker"))).toBe(false);
      expect(existsSync(join(out, ".env"))).toBe(false);

      mkdirSync(join(out, "letter-vault", "backups"), { recursive: true });
      writeFileSync(join(out, "letter-vault", "backups", "export.sql"), "not-a-real-secret");
      expect(() => assertDistExcludesSensitive(out)).toThrow(/sensitive files present/);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("shouldExcludePagesPath blocks compliance paths", () => {
    expect(shouldExcludePagesPath("compliance")).toBe(true);
    expect(shouldExcludePagesPath("compliance/letter-vault/08-PROVIDER-REGISTER.md")).toBe(
      true,
    );
    expect(shouldExcludePagesPath("letter-vault/index.html")).toBe(false);
    expect(shouldExcludePagesPath("letter-vault/backups")).toBe(true);
    expect(shouldExcludePagesPath("letter-vault/backups/export.sql")).toBe(true);
    expect(shouldExcludePagesPath("letter-vault/worker/.dev.vars")).toBe(true);
    expect(shouldExcludePagesPath("letter-vault/worker/.env.staging.local")).toBe(true);
    expect(shouldExcludePagesPath("letter-vault/migrations/001.sql")).toBe(true);
    expect(shouldExcludePagesPath(".env")).toBe(true);
    expect(shouldExcludePagesPath("letter-vault/.env.example")).toBe(true);
    expect(shouldExcludePagesPath("notes.enc")).toBe(true);
  });

  it("root package.json exposes pages:build", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["pages:build"]).toBe("node scripts/pages-public-build.mjs");
  });

  it("production deploy script builds dist/ and deploys dist (not repo root)", () => {
    const script = readFileSync(DEPLOY_SCRIPT_PATH, "utf8");
    expect(script).toContain("./assert-compliance-pagesignore.mjs");
    expect(script).toContain("pages-public-build.mjs");
    expect(script).toContain("npm run pages:build");
    expect(script).toContain("assertDistExcludesCompliance");
    expect(script).toContain("assertDistExcludesSensitive");
    expect(script).not.toMatch(/wrangler pages deploy "\."/);
    expect(script).toContain('wrangler pages deploy "${DIST_DIR}"');
  });

  it("preview Pages deploy uses sanitized dist/letter-vault only", () => {
    const script = readFileSync(
      join(REPO_ROOT, "letter-vault", "scripts", "deploy-preview-pages.mjs"),
      "utf8",
    );
    expect(script).toContain("npm run pages:build");
    expect(script).toContain("assertDistExcludesCompliance");
    expect(script).toContain("assertDistExcludesSensitive");
    expect(script).toContain("PREVIEW_DEPLOY_DIR");
    expect(script).toContain('wrangler pages deploy "${PREVIEW_DEPLOY_DIR}"');
    expect(script).not.toMatch(/wrangler pages deploy "\.\."/);
    expect(script).toContain("/compliance/* /404.html 404");
  });
});
