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
//   - assembleCatalog loads the fixture and merges the layers, and MAY throw (a malformed fixture
//     must surface loudly, central-classification.ts).
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
import type { MergedToolClassificationSet, ToolClassificationSet } from "./classification.ts";

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

export interface AssembledCatalog {
  builtinLayer: ToolClassificationSet;
  fixture: CentralClassificationFixture;
  merged: MergedToolClassificationSet;
}

/** Loads the built-in layer and the fixture at `location` and merges them (central wins by name).
 * Throws on a malformed fixture (never "no fixture found, so exempt everything"). */
export function assembleCatalog(location: FixtureLocation): AssembledCatalog {
  const builtinLayer = loadBuiltinToolClassificationLayer();
  const fixture = loadCentralClassificationFixture(location.fixturePath);
  const merged = mergeToolClassificationLayers(builtinLayer, fixture.centralLayer);
  return { builtinLayer, fixture, merged };
}
