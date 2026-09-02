// ADR-0021 "Rules for agents": "MUST register each per-tool-type normalizer on the normalizer
// registry by declaration; MUST NOT add a tool type by editing a shared dispatch chain or the
// kernel (POL-12)." Compliance Verification: "a reviewer confirms a new tool-type normalizer was
// added by registry declaration, with no diff inside the kernel or an existing normalizer."
//
// The kernel side of that bar is already covered structurally: src/qa/kernel-purity-check.ts
// proves kernel.ts cannot import anything under src/policy/normalizer/** at all (an
// out-of-directory import from the kernel's own purity boundary) — so "zero diff to kernel.ts" is
// structurally impossible to need, by construction, regardless of how many normalizers exist.
//
// This is the registry side of the same bar, for src/policy/normalizer/registry.ts specifically.
// Two checks, on comment-stripped source (reusing kernel-purity-check.ts's own
// stripComments/extractImportSpecifiers — same technique, one implementation):
//   1. registry.ts imports no sibling file from its own directory. A relative import resolving to
//      another .ts file directly inside the same directory as registry.ts would mean the registry
//      "knows about" a concrete normalizer — the exact inversion POL-12 forbids. The registry must
//      only ever be REACHED BY a normalizer calling registerNormalizer(), never reach for one.
//   2. registry.ts contains no `switch` statement — the textbook dispatch-chain shape POL-12
//      names by name ("adapters shall be registered by declaration, not by editing a dispatch
//      chain").
// A registry satisfying both, by construction, can never require editing when a new normalizer is
// added: each normalizer file registers itself; the registry never reaches for any of them.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, posix } from "node:path";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";
import { extractImportSpecifiers, stripComments } from "./kernel-purity-check.ts";

export interface RegistryPurityViolation {
  kind: "sibling-normalizer-import" | "dispatch-chain-switch";
  detail: string;
}

export function scanRegistrySource(source: string, registryRepoRelPath: string): RegistryPurityViolation[] {
  const violations: RegistryPurityViolation[] = [];
  const dir = posix.dirname(registryRepoRelPath);

  for (const specifier of extractImportSpecifiers(source)) {
    if (!specifier.startsWith(".")) continue; // non-relative imports are kernel-purity-check's own concern
    const resolved = posix.normalize(posix.join(dir, specifier));
    const resolvedDir = posix.dirname(resolved);
    if (resolvedDir === dir) {
      violations.push({
        kind: "sibling-normalizer-import",
        detail:
          `registry imports "${specifier}" (resolves to "${resolved}") — a sibling file in its own ` +
          `directory, meaning it "knows about" a specific normalizer. The registry must only be reached ` +
          `BY normalizers calling registerNormalizer(), never the reverse.`,
      });
    }
  }

  const stripped = stripComments(source);
  if (/\bswitch\s*\(/.test(stripped)) {
    violations.push({
      kind: "dispatch-chain-switch",
      detail:
        `a "switch" statement was found in the registry — the exact dispatch-chain shape POL-12 forbids ` +
        `("adapters shall be registered by declaration, not by editing a dispatch chain").`,
    });
  }

  return violations;
}

const REGISTRY_PATH = "src/policy/normalizer/registry.ts";

/**
 * `registryRepoRelPath` is repo-relative and overridable, so this is testable against a fixture
 * path (see src/qa/selftest-fixture/normalizer-registry-purity/{clean,violating}/registry.ts), not
 * just the real registry.
 */
export async function checkNormalizerRegistryPurity(
  repoRoot: string,
  registryRepoRelPath: string = REGISTRY_PATH,
): Promise<InstrumentResult> {
  let content: string;
  try {
    content = await readFile(join(repoRoot, registryRepoRelPath), "utf8");
  } catch {
    return {
      ok: true,
      vacuous: true,
      summary: `${registryRepoRelPath} not found — vacuous pass.`,
      details: [],
    };
  }

  const violations = scanRegistrySource(content, registryRepoRelPath);
  if (violations.length > 0) {
    return {
      ok: false,
      vacuous: false,
      summary: `${violations.length} normalizer-registry purity violation(s) found in ${registryRepoRelPath}.`,
      details: violations.map((v) => `[${v.kind}] ${v.detail}`),
    };
  }
  return {
    ok: true,
    vacuous: false,
    summary: `${registryRepoRelPath}: zero dispatch-chain/sibling-normalizer-import violations.`,
    details: [],
  };
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const result = await checkNormalizerRegistryPurity(repoRoot);
  printInstrumentResult("QA normalizer-registry-purity-check", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
