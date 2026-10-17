import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Fail fast if internal compliance docs would ship with Pages production deploy. */
export function assertComplianceExcludedFromPagesDeploy(root) {
  const pagesignorePath = join(root, ".pagesignore");
  if (!existsSync(pagesignorePath)) {
    throw new Error(
      "Missing repo-root .pagesignore — compliance/ must be excluded before Pages production deploy.",
    );
  }

  const lines = readFileSync(pagesignorePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  const excludesCompliance = lines.some((line) => {
    const normalized = line.replace(/^\//, "").replace(/\/+$/, "");
    return normalized === "compliance" || normalized.startsWith("compliance/");
  });

  if (!excludesCompliance) {
    throw new Error(
      ".pagesignore must exclude compliance/ before Pages production deploy.",
    );
  }
}
