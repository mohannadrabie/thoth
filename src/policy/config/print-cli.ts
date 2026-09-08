// `npm run policy:print` (POL-10) — the real, runnable entry point. Constructs the REAL production
// dependencies (`createWindowsRegistryCentralPolicySource`, this repo's own `shipped-defaults.json` and
// `.thoth/policy.json` paths) and calls `printEffectivePolicy()` — the exact same function
// printer.test.ts tests directly, in-process (see that file's own header, INTERPRETATION CHOICE 3,
// for why this thin wrapper is deliberately NOT itself spawned/tested as a subprocess). This file
// carries near-zero logic on purpose — everything worth testing lives in printer.ts/loader.ts,
// which already have their own real (non-CLI) test coverage.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { printEffectivePolicy } from "./printer.ts";
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
    process.stdout.write(`pin: sha256:${result.pin.digest} channel=${result.pin.channel} computedAt=${result.pin.computedAt}\n`);
  }
  // Issue #109 [MED]: disclosure that this reflects S6's own resolved policy, not necessarily what
  // hooks/pretooluse-kernel-gate.mjs enforces live today. Same "never touch printer.ts's tested
  // stdout" reasoning as the pin line above.
  process.stdout.write(result.disclosure + "\n");
  process.exit(result.exitCode);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
