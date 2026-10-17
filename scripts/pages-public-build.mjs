import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, "..");
export const DIST_DIR = join(REPO_ROOT, "dist");

const BLOCKED_SEGMENTS = new Set([
  "compliance",
  "dist",
  ".git",
  ".wrangler",
  "node_modules",
  "backups",
  "_deploy8bc",
]);

const BLOCKED_TREES = [
  "letter-vault/worker",
  "letter-vault/migrations",
  "letter-vault/scripts",
];

function toPosix(path) {
  return path.split("\\").join("/");
}

function normalizeRel(relPath) {
  return toPosix(relPath).replace(/^\/+/, "").replace(/\/+$/, "");
}

function isPrivateEnvFile(base) {
  const name = base.toLowerCase();
  return name === ".env" || name.startsWith(".env.");
}

function isSensitiveBasename(base) {
  const name = base.toLowerCase();
  if (name === ".dev.vars") return true;
  if (isPrivateEnvFile(name)) return true;
  if (name.endsWith(".local")) return true;
  if (name.endsWith(".sql") || name.endsWith(".sql.gz") || name.endsWith(".dump")) return true;
  if (name.endsWith(".enc")) return true;
  if (
    name.endsWith(".pem") ||
    name.endsWith(".key") ||
    name.endsWith(".p12") ||
    name.endsWith(".pfx")
  ) {
    return true;
  }
  if (name.endsWith(".sqlite") || name.endsWith(".sqlite3") || name === "credentials.json") {
    return true;
  }
  return false;
}

/** True when this path must never be copied into the public Pages output. */
export function shouldExcludePagesPath(relPath) {
  const rel = normalizeRel(relPath);
  if (!rel || rel === ".") return false;

  const segments = rel.split("/");
  if (segments.some((segment) => BLOCKED_SEGMENTS.has(segment))) return true;
  if (BLOCKED_TREES.some((tree) => rel === tree || rel.startsWith(`${tree}/`))) return true;
  if (isSensitiveBasename(segments[segments.length - 1])) return true;
  return false;
}

function listFilesRecursive(dir, baseDir = dir, files = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = toPosix(relative(baseDir, abs));
    if (shouldExcludePagesPath(rel)) continue;

    const entry = statSync(abs);
    if (entry.isDirectory()) {
      listFilesRecursive(abs, baseDir, files);
      continue;
    }
    files.push(rel);
  }
  return files;
}

function listOutputPaths(dir, baseDir = dir, paths = []) {
  if (!existsSync(dir)) return paths;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = toPosix(relative(baseDir, abs));
    const entry = statSync(abs);
    if (entry.isDirectory()) {
      paths.push(`${rel}/`);
      listOutputPaths(abs, baseDir, paths);
      continue;
    }
    paths.push(rel);
  }
  return paths;
}

function copyPublicTree(sourceRoot, targetRoot, relativeDir = "") {
  const currentSource = relativeDir ? join(sourceRoot, relativeDir) : sourceRoot;

  for (const name of readdirSync(currentSource)) {
    const rel = relativeDir ? `${toPosix(relativeDir)}/${name}` : name;
    if (shouldExcludePagesPath(rel)) continue;

    const sourcePath = join(sourceRoot, rel);
    const targetPath = join(targetRoot, rel);
    const entry = statSync(sourcePath);

    if (entry.isDirectory()) {
      mkdirSync(targetPath, { recursive: true });
      copyPublicTree(sourceRoot, targetRoot, rel);
      continue;
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    cpSync(sourcePath, targetPath);
  }
}

function appendMissingRules(redirectsPath, rules) {
  const existing = existsSync(redirectsPath) ? readFileSync(redirectsPath, "utf8") : "";
  const missing = rules.filter((rule) => !existing.includes(rule.split(" ")[0]));
  if (missing.length === 0) {
    if (!existsSync(redirectsPath)) writeFileSync(redirectsPath, "");
    return;
  }
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  const text = `${prefix}${missing.join("\n")}\n`;
  if (existsSync(redirectsPath)) appendFileSync(redirectsPath, text);
  else writeFileSync(redirectsPath, `${existing}${text}`);
}

function ensurePublicPathBlocks(outDir) {
  appendMissingRules(join(outDir, "_redirects"), [
    "/compliance/* /404.html 404",
    "/letter-vault/backups/* /404.html 404",
    "/letter-vault/worker/* /404.html 404",
    "/letter-vault/migrations/* /404.html 404",
    "/letter-vault/scripts/* /404.html 404",
  ]);

  const previewRedirects = join(outDir, "letter-vault", "_redirects");
  if (existsSync(dirname(previewRedirects))) {
    appendMissingRules(previewRedirects, [
      "/backups/* /404.html 404",
      "/worker/* /404.html 404",
      "/migrations/* /404.html 404",
      "/scripts/* /404.html 404",
    ]);
  }
}

/** Build Cloudflare Pages public output without private or internal files. */
export function buildPagesPublicOutput(root = REPO_ROOT, outDir = DIST_DIR) {
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  mkdirSync(outDir, { recursive: true });
  copyPublicTree(root, outDir);
  ensurePublicPathBlocks(outDir);
  assertDistExcludesSensitive(outDir);
  return outDir;
}

export function assertDistExcludesCompliance(outDir = DIST_DIR) {
  if (!existsSync(outDir)) {
    throw new Error("Pages build output dist/ is missing — run pages:build first.");
  }

  const leaked = listFilesRecursive(outDir).filter(
    (rel) => rel === "compliance" || rel.startsWith("compliance/"),
  );
  if (leaked.length > 0) {
    throw new Error(
      `compliance files present in Pages output: ${leaked.slice(0, 5).join(", ")}`,
    );
  }
}

/** Abort when backups, secrets, worker files, or SQL exports are in the public output. */
export function assertDistExcludesSensitive(outDir = DIST_DIR) {
  if (!existsSync(outDir)) {
    throw new Error("Pages build output dist/ is missing — run pages:build first.");
  }

  assertDistExcludesCompliance(outDir);

  const leaked = listOutputPaths(outDir).filter((rel) => shouldExcludePagesPath(rel));
  if (leaked.length > 0) {
    throw new Error(
      `sensitive files present in Pages output: ${leaked.slice(0, 8).join(", ")}`,
    );
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  buildPagesPublicOutput();
  console.log(`Pages public build OK: ${DIST_DIR} (private paths excluded)`);
}
