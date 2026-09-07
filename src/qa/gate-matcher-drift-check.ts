// SUR-05 (REQUIREMENTS.md:461, P0): "Gate matchers shall be verified against the runtime's actual
// tool names; a mismatch shall fail loudly. A dead matcher is detectable."
//
// This check diffs every tool name REFERENCED by (a) the real, shipped tool-classification catalog
// (src/policy/tools/builtin-tool-inventory.ts) and (b) every `matcher` string in
// `.claude/settings.json`'s own `hooks` object, against `docs/qa/tool-inventory.json`'s vendored
// built-in-tool snapshot (the same file builtin-tool-inventory.ts itself loads).
//
// **THIS CHECK IS DELIBERATELY ONE-DIRECTIONAL — printed plainly every run, pass or fail, not just
// on failure:** it catches a tool name referenced somewhere in this repo that is ABSENT from the
// vendored snapshot (a typo, a renamed/removed upstream tool — a "dead matcher"). It does NOT, and
// structurally cannot, catch the inverse: a new Claude Code built-in tool added in a future version
// bump that nobody in this repo has referenced anywhere yet is invisible to this check by
// construction — there is nothing for it to be "dead" against. Re-vendoring
// docs/qa/tool-inventory.json from the live docs page is a human/reviewed action on a cadence
// (same convention as QA-17's runtime-settings-inventory.json), never done live in CI.
import { fileURLToPath } from "node:url";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";
import { loadBuiltinToolClassificationLayer, loadBuiltinToolInventory } from "../policy/tools/builtin-tool-inventory.ts";

export const ONE_DIRECTIONAL_DISCLOSURE =
  "NOTE (one-directional): this check catches a referenced tool name absent from the vendored " +
  "snapshot (a dead matcher). It does NOT catch the inverse -- a new upstream built-in tool nobody " +
  "has referenced anywhere yet is invisible to it by construction. Re-vendor " +
  "docs/qa/tool-inventory.json from the live docs page (a human/reviewed action) to pick up a new " +
  "tool name.";

interface HookGroupShape {
  matcher?: unknown;
}

/** Extracts every individual tool name referenced by a `.claude/settings.json` hook matcher string
 * (e.g. `"Edit|Write|MultiEdit|NotebookEdit"` -> 4 names, `"Bash"` -> 1 name). Tolerant of a
 * missing/malformed `hooks` key: returns an empty array, never throws. */
export function extractMatcherToolNames(settings: unknown): string[] {
  const names: string[] = [];
  if (typeof settings !== "object" || settings === null) return names;
  const hooks = (settings as Record<string, unknown>).hooks;
  if (typeof hooks !== "object" || hooks === null) return names;

  for (const groups of Object.values(hooks as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    for (const rawGroup of groups) {
      const matcher = (rawGroup as HookGroupShape)?.matcher;
      if (typeof matcher !== "string" || matcher.length === 0) continue;
      for (const part of matcher.split("|")) {
        const trimmed = part.trim();
        if (trimmed.length > 0) names.push(trimmed);
      }
    }
  }
  return names;
}

/** Pure diff: every name in `referencedNames` not present in `vendoredNames` is drift. Duplicate
 * referenced names are reported once. */
export function computeMatcherDrift(referencedNames: readonly string[], vendoredNames: ReadonlySet<string>): string[] {
  const drift: string[] = [];
  for (const name of new Set(referencedNames)) {
    if (!vendoredNames.has(name)) {
      drift.push(
        `"${name}" is referenced (classification catalog or a .claude/settings.json hook matcher) but is ABSENT from the vendored built-in-tool snapshot (docs/qa/tool-inventory.json) -- possible dead matcher, typo, or renamed/removed tool`,
      );
    }
  }
  return drift.sort();
}

export function checkMatcherDrift(
  classificationToolNames: readonly string[],
  matcherToolNames: readonly string[],
  vendoredNames: ReadonlySet<string>,
): InstrumentResult {
  const referenced = [...classificationToolNames, ...matcherToolNames];
  const drift = computeMatcherDrift(referenced, vendoredNames);

  const details = drift.length > 0 ? [...drift, ONE_DIRECTIONAL_DISCLOSURE] : [ONE_DIRECTIONAL_DISCLOSURE];

  if (drift.length > 0) {
    return {
      ok: false,
      vacuous: false,
      summary: `${drift.length} referenced tool name(s) are absent from the vendored built-in-tool snapshot.`,
      details,
    };
  }

  return {
    ok: true,
    vacuous: false,
    summary: `${new Set(referenced).size} referenced tool name(s) (classification catalog + hook matchers), all present in the vendored snapshot.`,
    details,
  };
}

async function main(): Promise<void> {
  const settingsPath = process.argv[2] ?? ".claude/settings.json";
  const { readFile } = await import("node:fs/promises");

  const settingsRaw = await readFile(settingsPath, "utf8");
  const settings: unknown = JSON.parse(settingsRaw);

  const inventory = loadBuiltinToolInventory();
  const classificationLayer = loadBuiltinToolClassificationLayer();

  const classificationToolNames = classificationLayer.tools.map((t) => t.name);
  const matcherToolNames = extractMatcherToolNames(settings);
  const vendoredNames = new Set(inventory.tools);

  const result = checkMatcherDrift(classificationToolNames, matcherToolNames, vendoredNames);
  printInstrumentResult("SUR-05 gate-matcher-drift-check", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
