// `npm run policy:print` (POL-10) — the real, runnable entry point. Constructs the REAL production
// dependencies (`createWindowsRegistryCentralPolicySource`, this repo's own `shipped-defaults.json` and
// `.thoth/policy.json` paths) and calls `printEffectivePolicy()` — the exact same function
// printer.test.ts tests directly, in-process (see that file's own header, INTERPRETATION CHOICE 3,
// for why this thin wrapper is deliberately NOT itself spawned/tested as a subprocess). This file
// carries near-zero logic on purpose — everything worth testing lives in printer.ts/loader.ts,
// which already have their own real (non-CLI) test coverage.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { printEffectivePolicy, renderInertMandatoryNote, renderPinLine } from "./printer.ts";
import { defaultCentralPolicySource } from "./central-source.ts";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(THIS_DIR, "..", "..", "..");

function main(): void {
  const result = printEffectivePolicy({
    shippedDefaultsPath: join(THIS_DIR, "shipped-defaults.json"),
    projectPolicyPath: join(REPO_ROOT, ".thoth", "policy.json"),
    centralSource: defaultCentralPolicySource,
  });
  process.stdout.write(result.stdout + "\n");
  // Issue #111 [MED]: POL-09's pin was computed but never surfaced anywhere. Printed here (not
  // folded into printer.ts's own `stdout` string) because that string is test-writer's locked
  // exact-match answer key — see printer.ts's own PrinterResult.pin doc comment for the full reason.
  if (result.pin) {
    process.stdout.write(renderPinLine(result.pin) + "\n");
  }
  // R4 / Issue #288 precondition 1 (S7): the resolved baseline posture and its source, exactly one
  // line, taken from the tested PrinterResult.postureLine (never a second rendering). Same "never
  // touch printer.ts's tested stdout" reasoning as the pin line above.
  process.stdout.write(result.postureLine + "\n");
  // Issue #109 [MED]: disclosure that this reflects S6's own resolved policy and that the kernel-gate
  // hook, although it reads the same loader since S7, is not wired, so nothing is enforced live.
  // Same reasoning as the pin line above.
  process.stdout.write(result.disclosure + "\n");
  // Issue #114 [HIGH] fix, loud-disclosure condition (Stage-3 round 3, 2026-09-08 council ruling,
  // Path B): a mandatory:true declaration with no real locking force is never silently dropped --
  // printed here, one line per declaration, same "never touch printer.ts's tested stdout" reasoning
  // as the pin/disclosure lines above. Issues #294 and #313: the NOTE and pin lines are built (and sanitized)
  // by printer.ts's renderInertMandatoryNote and renderPinLine so they are testable. print-lines.test.ts
  // is a labelled heuristic guard that every write here looks like a call to a renderer imported from
  // printer.ts (or a PrinterResult field); it is a source scan, not a proof.
  for (const d of result.inertMandatoryDeclarations) {
    process.stdout.write(renderInertMandatoryNote(d) + "\n");
  }
  process.exit(result.exitCode);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
