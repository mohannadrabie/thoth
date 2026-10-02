// The ONE shared module that decides WHERE the central classification fixture is read from and
// assembles the merged tool-classification catalog from it, used by BOTH hooks that consume it
// (hooks/sessionstart-tool-enum.mjs and hooks/pretooluse-kernel-gate.mjs). S7 plan section 4
// (PC-9, N2, G14, G14b); THOTH-ADR-0001 rule 5 names one function as the anchor for the fixture
// path rule.
//
// TWO SEPARATE EXPORTS, on purpose:
//   - the LOCATION functions are pure and NEVER throw. SessionStart resolves the location BEFORE it
//     reads stdin, so its catch path can still record the resolved fixture path and source in
//     halt-state when loading the fixture then throws (THOTH-ADR-0001 rule 5, "never silent"). A
//     single function that also loaded the fixture would throw before it returned the location.
//   - assembleCatalog loads the fixture, checks that no central entry LOWERS a built-in tool's class,
//     and merges the layers, and MAY throw (a malformed fixture, or a lowering entry, must surface
//     loudly: central-classification.ts, and S7-B Issue #305 below).
//
// A CENTRAL ENTRY MAY KEEP OR RAISE A BUILT-IN'S CLASS AND MAY NEVER LOWER IT (S7-B, Issue #305, ruling
// R1). mergeToolClassificationLayers (precedence.ts, locked answer key T5) lets a central entry win
// by name, so a fixture entry named like a built-in tool could otherwise silently reclassify it
// downward. Class order: read-only < workspace-mutating < remote-mutating. The guard below runs BEFORE
// the merge, on the merge's own key (exact name; R1-10 pins that a near-miss spelling loads), so the two
// cannot disagree about which entries override a built-in. The guard FAILS CLOSED: an entry passes only
// when both classes are in the rank table and the entry ranks at or above the built-in. This module is
// the ONLY production caller of the merge and the only reader of the fixture (checked by instruments R1-6,
// R1-6b and R1-6d, which are labelled heuristics, not a proof: the disclosed residual is in the test
// header, Issue #332), so the guard applies to both hooks. Accepted cost: an MCP server literally named
// like a built-in tool cannot be classified lower than that built-in.
//
// MESSAGE ORDER (Issue #330): the halt relay cuts every diagnostic line at a fixed length after the
// SessionStart prefix, so the error text puts the first offender, its two classes and the Unlock clause
// FIRST and the resolved fixture path LAST (R1-11 and R1-11c measure it against the relay's own cut).
//
// WHICH LOCATION EACH HOOK USES
//   - SessionStart: resolveFixtureLocation(projectDir()): <projectDir>/docs/qa/s5-central-
//     classification.json when it exists, else DEFAULT_FIXTURE_PATH (the ADR-permitted rule; the
//     project root is CLAUDE_PROJECT_DIR, or the hook's cwd when unset).
//   - The gate: moduleRelativeFixtureLocation(): DEFAULT_FIXTURE_PATH only. No environment variable
//     and no working directory decides which policy source a fail-closed gate trusts (Issue #99
//     principle); in the real repo it is the same file SessionStart reads.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { mergeToolClassificationLayers } from "../rule/precedence.ts";
import { loadBuiltinToolClassificationLayer } from "./builtin-tool-inventory.ts";
import type { CentralClassificationFixture } from "./central-classification.ts";
import { DEFAULT_FIXTURE_PATH, loadCentralClassificationFixture } from "./central-classification.ts";
import type { MergedToolClassificationSet, ToolClass, ToolClassificationSet } from "./classification.ts";

export type FixtureSource = "project-relative" | "fallback-default" | "module-relative";

export interface FixtureLocation {
  fixtureSource: FixtureSource;
  fixturePath: string;
}

/** The project root every hook already uses: CLAUDE_PROJECT_DIR, else the working directory. */
export function projectDir(env: NodeJS.ProcessEnv = process.env, cwd: () => string = () => process.cwd()): string {
  return env.CLAUDE_PROJECT_DIR ?? cwd();
}

/** Pure and non-throwing. `exists` is injectable so the rule is testable without a filesystem. */
export function resolveFixtureLocation(dir: string, exists: (path: string) => boolean = existsSync): FixtureLocation {
  const projectRelative = join(dir, "docs", "qa", "s5-central-classification.json");
  return exists(projectRelative)
    ? { fixtureSource: "project-relative", fixturePath: projectRelative }
    : { fixtureSource: "fallback-default", fixturePath: DEFAULT_FIXTURE_PATH };
}

/** The gate's location: the module-adjacent committed copy, never environment-controlled. */
export function moduleRelativeFixtureLocation(): FixtureLocation {
  return { fixtureSource: "module-relative", fixturePath: DEFAULT_FIXTURE_PATH };
}

/** The error name every catalog or fixture failure carries (story H, #308 X-11): the hook's stderr prints only
 * this name, and the gate's closed unlock table (src/policy/gate/unlock-text.ts, CATALOG_FAILURE_ERROR_NAME;
 * a test asserts the two are equal) maps it to the classification-file unlock. The message is unchanged for
 * the callers that print it (print-cli, sessionstart); it never reaches the gate hook's stderr. */
export const CATALOG_ERROR_NAME = "ClassificationCatalogError";

export class ClassificationCatalogError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = CATALOG_ERROR_NAME;
  }
}

export interface AssembledCatalog {
  builtinLayer: ToolClassificationSet;
  fixture: CentralClassificationFixture;
  merged: MergedToolClassificationSet;
}

/** The class order the guard enforces. `Record<ToolClass, number>`: a fourth class is a compile error. */
const CLASS_RANK: Readonly<Record<ToolClass, number>> = {
  "read-only": 0,
  "workspace-mutating": 1,
  "remote-mutating": 2,
};

const MAX_REPORTED_LOWERINGS = 5;

/** The rank of a class, or NaN for anything outside the table (own-property lookup, so "constructor" or
 * "__proto__" is not a class). NaN makes every comparison false, so `!(entryRank >= builtinRank)` is true
 * for an unknown class on either side: the guard fails closed (R1-12). */
function rankOf(toolClass: unknown): number {
  return typeof toolClass === "string" && Object.hasOwn(CLASS_RANK, toolClass) ? CLASS_RANK[toolClass as ToolClass] : Number.NaN;
}

/** Throws when any entry of `central` shares a name with a built-in tool and does not rank AT OR ABOVE it
 * (an unknown class on either side counts as lowering: fail closed). Every entry is checked (not only the
 * one that would win the merge), so a fixture listing a raising and a lowering entry for the same name
 * throws in either order. The entry name is by construction a built-in inventory name, so it is short and
 * vendored, never fixture-authored free text. The message order is pinned by R1-11 (see the header). */
export function assertNoBuiltinClassLowering(builtin: ToolClassificationSet, central: ToolClassificationSet, fixturePath: string): void {
  const builtinClass = new Map(builtin.tools.map((t) => [t.name, t.class]));
  const lowering = central.tools.filter((entry) => {
    const own = builtinClass.get(entry.name);
    return own !== undefined && !(rankOf(entry.class) >= rankOf(own));
  });
  const [first, ...others] = lowering.slice(0, MAX_REPORTED_LOWERINGS);
  if (first === undefined) return;
  const also = others.map((e) => `${JSON.stringify(e.name)} (built-in ${String(builtinClass.get(e.name))}, entry ${String(e.class)})`);
  const uncounted = lowering.length - 1 - others.length;
  const alsoText = also.length > 0 ? ` Also lowering: ${also.join("; ")}${uncounted > 0 ? `; and ${String(uncounted)} more` : ""}.` : "";
  throw new ClassificationCatalogError(
    `fixture entry ${JSON.stringify(first.name)} lowers built-in ${String(builtinClass.get(first.name))} to ${String(first.class)}. ` +
      `Unlock: raise its class or remove the entry from the fixture. A central entry may keep or raise a built-in's class, never lower it.${alsoText} Fixture: ${fixturePath}`,
  );
}

/** Loads the built-in layer and the fixture at `location`, rejects any central entry that lowers a
 * built-in's class, and merges them (central wins by name). Throws on a malformed fixture or a
 * lowering entry (never "no fixture found, so exempt everything"). */
export function assembleCatalog(location: FixtureLocation): AssembledCatalog {
  let builtinLayer: ToolClassificationSet;
  let fixture: CentralClassificationFixture;
  try {
    builtinLayer = loadBuiltinToolClassificationLayer();
    fixture = loadCentralClassificationFixture(location.fixturePath);
  } catch (err) {
    // A missing, unreadable or malformed built-in layer or fixture: the same typed error, same message.
    throw new ClassificationCatalogError(err instanceof Error ? err.message : String(err), { cause: err });
  }
  assertNoBuiltinClassLowering(builtinLayer, fixture.centralLayer, location.fixturePath);
  const merged = mergeToolClassificationLayers(builtinLayer, fixture.centralLayer);
  return { builtinLayer, fixture, merged };
}
