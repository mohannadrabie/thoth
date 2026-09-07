// SUR-13 (REQUIREMENTS.md:469, P1): "There shall be exactly one gate manifest."
//
// Two files defining a top-level `hooks` key would be two possible sources of truth for what
// gates a live session — the same "one decision engine" principle POL-03 already enforces at the
// kernel layer (src/policy/kernel/kernel.ts), applied here at the configuration-surface layer.
// This scans every `.json` file in the repo (excluding node_modules/.git, per
// src/lib/fs-walk.ts's own standing exclusions), parses each, and counts how many define a
// top-level `hooks` key. Exactly one is the only passing state; zero (no manifest exists at all)
// and two-or-more (competing manifests) both fail.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { listFilesRecursive } from "../lib/fs-walk.ts";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";

/** Finds every `.json` file under `repoRoot` whose top-level parsed value has a `hooks` key.
 * A file that fails to parse as JSON at all is silently skipped (not this check's job to flag —
 * that is a different concern, e.g. a general JSON-lint gate) rather than treated as a candidate. */
export async function findHooksManifests(repoRoot: string): Promise<string[]> {
  const files = await listFilesRecursive(repoRoot, (p) => p.endsWith(".json"));
  const manifests: string[] = [];

  for (const file of files) {
    let text: string;
    try {
      text = await readFile(`${repoRoot}/${file}`, "utf8");
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    if (typeof parsed === "object" && parsed !== null && "hooks" in (parsed as Record<string, unknown>)) {
      manifests.push(file);
    }
  }

  return manifests.sort((a, b) => a.localeCompare(b));
}

export function checkManifestCount(manifests: readonly string[]): InstrumentResult {
  if (manifests.length === 0) {
    return {
      ok: false,
      vacuous: false,
      summary: 'SUR-13 requires exactly one gate manifest; 0 files define a top-level "hooks" key.',
      details: [],
    };
  }
  if (manifests.length > 1) {
    return {
      ok: false,
      vacuous: false,
      summary: `SUR-13 requires exactly one gate manifest; ${manifests.length} files define a top-level "hooks" key.`,
      details: [...manifests],
    };
  }
  return {
    ok: true,
    vacuous: false,
    summary: `Exactly 1 gate manifest found: ${manifests[0]}.`,
    details: [...manifests],
  };
}

async function main(): Promise<void> {
  const repoRoot = process.argv[2] ?? process.cwd();
  const manifests = await findHooksManifests(repoRoot);
  const result = checkManifestCount(manifests);
  printInstrumentResult("SUR-13 gate-manifest-check", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
