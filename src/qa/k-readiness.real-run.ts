// #308 story K stage 0: the manual/integration assertion that the REAL readiness run is red at stage 0. Not named *.test.ts on
// purpose: it shells out to gh and the real repo, so default `npm test` must not run it. Run: npm run qa:k-readiness-real-test
// Retire this file in the commit that wires K (the assertion is false once K is wired and every row passes).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SCRIPT = fileURLToPath(new URL("./k-readiness.ts", import.meta.url));

void test("k-readiness: stage0 real run is red by design", () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", timeout: 600000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /NOT READY/);
  assert.match(r.stdout, /^(FAIL|MISSING)\s/m, "at least one named FAIL or MISSING row");
});
