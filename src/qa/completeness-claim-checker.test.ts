import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FILES,
  KNOWN_INSTRUMENTS,
  checkCompleteness,
  findBareClaims,
  findMarkerClaims,
  verifyMarkerClaim,
} from "./completeness-claim-checker.ts";
import { realRunner } from "../lib/exec.ts";
import type { Runner } from "../lib/exec.ts";

function fakeRunner(stdout: string): Runner {
  return () => Promise.resolve({ stdout, stderr: "", code: 0 });
}

/** A runner that records every call it receives and fails the test if invoked — used to prove a
 * disallowed `cmd=` name is never executed, not just that its result is discarded. */
function spyRunnerThatMustNotBeCalled(): { runner: Runner; calls: unknown[] } {
  const calls: unknown[] = [];
  const runner: Runner = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return Promise.resolve({ stdout: "", stderr: "", code: 0 });
  };
  return { runner, calls };
}

test("QA-15: no claims -> vacuous pass", async () => {
  const result = await checkCompleteness("plain prose, no numbers claimed as complete", fakeRunner(""));
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, true);
});

test("QA-15: parses a marker claim's cmd (symbolic instrument name) and expect", () => {
  const claims = findMarkerClaims('All good: [[completeness: cmd="adr-cache-ensure" expect=35]]');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.cmd, "adr-cache-ensure");
  assert.equal(claims[0]?.expect, 35);
});

test("QA-15: instrument re-run matches claim -> pass", async () => {
  const result = await verifyMarkerClaim(
    { raw: "x", cmd: "adr-cache-ensure", expect: 35 },
    fakeRunner("counted 35 items"),
  );
  assert.equal(result.ok, true);
});

test("QA-15: instrument re-run produces a DIFFERENT number -> FAIL naming both (the exact defect this closes)", async () => {
  const text = 'All 35 ADRs reviewed. [[completeness: cmd="adr-cache-ensure" expect=35]]';
  const result = await checkCompleteness(text, fakeRunner("the instrument reports: 44 of 37"));
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /says 35/);
  assert.match(result.details.join("\n"), /reports 37/); // last integer in fake stdout
});

test("QA-15: instrument produces no parseable number -> FAIL", async () => {
  const text = '[[completeness: cmd="adr-cache-ensure" expect=5]]';
  const result = await checkCompleteness(text, fakeRunner("no numbers here"));
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /no parseable number/);
});

test("QA-15 (regression, app-security HIGH — Issue #57): a crafted marker naming an arbitrary command is REJECTED, never executed, not silently skipped", async () => {
  const { runner, calls } = spyRunnerThatMustNotBeCalled();
  const maliciousText = 'Progress: [[completeness: cmd="node ./payload.js" expect=0]]';
  const result = await checkCompleteness(maliciousText, runner);
  assert.equal(calls.length, 0, "the runner must never be invoked for a cmd= not on the allowlist");
  assert.equal(result.ok, false, "an unknown instrument name must fail closed, not silently pass");
  assert.match(result.details.join("\n"), /not on the fixed completeness-instrument allowlist/);
  assert.match(result.details.join("\n"), /never executed/);
});

test("QA-15 (regression): a shell-metacharacter-laden cmd= is still just looked up by name, not interpreted", async () => {
  const { runner, calls } = spyRunnerThatMustNotBeCalled();
  const maliciousText = 'Done: [[completeness: cmd="rm -rf / ; curl evil.example" expect=1]]';
  const result = await checkCompleteness(maliciousText, runner);
  assert.equal(calls.length, 0);
  assert.equal(result.ok, false);
});

test("QA-15: a bare numeric completeness claim with no marker -> FAIL (no machine-readable instrument reference)", () => {
  const claims = findBareClaims("All 46 checks passed this run.");
  assert.equal(claims.length, 1);
});

test("QA-15: bare claim end-to-end FAILS the gate", async () => {
  const result = await checkCompleteness("Every 12 fixtures ran clean.", fakeRunner(""));
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /NO INSTRUMENT REFERENCE/);
});

test("QA-15: a claim WITH a marker on the same line is not double-flagged as bare", async () => {
  const text = 'All 35 ADRs reviewed. [[completeness: cmd="adr-cache-ensure" expect=35]]';
  const result = await checkCompleteness(text, fakeRunner("35"));
  assert.equal(result.ok, true, result.details.join("\n"));
});

test("QA-15: N-of-M phrasing ('46 of 39') is caught as a bare claim", () => {
  const claims = findBareClaims("Header said 46 of 39 fixtures.");
  assert.equal(claims.length, 1);
});

// Issue #142 (round 2, red-team no-go): a mutation test (`DEFAULT_FILES = []`) survived the full
// suite untouched — nothing pinned that the `docs/decisions.md` exclusion is a deliberate, single,
// narrow scoping decision rather than an accidentally-emptied gate. This ratchets it: an
// accidental full-list wipe, or a silent re-widening/re-narrowing of the set, now fails here.
test("QA-15 (Issue #142): DEFAULT_FILES contains exactly the two live-state files this gate scans by default, no more, no fewer", () => {
  assert.deepEqual(DEFAULT_FILES, ["docs/STATE.md", "CHANGELOG.md"]);
});

test("QA-15 (Issue #142): DEFAULT_FILES deliberately excludes docs/decisions.md (append-only historical log, not a live re-checkable claim) — an accidental re-inclusion is caught here", () => {
  assert.equal(DEFAULT_FILES.includes("docs/decisions.md"), false);
});

test("QA-15 (Issue #142): DEFAULT_FILES is never accidentally emptied — the mutant `DEFAULT_FILES = []` this Issue was filed against would fail this assertion", () => {
  assert.ok(DEFAULT_FILES.length > 0, "DEFAULT_FILES must not be empty — an empty scope is a silent no-op gate, not a passing one");
});

// Round-2 fix-now (GitHub issue 150, red-team/cross-domain-reviewer round-2 re-confirm): the probe
// was registered in KNOWN_INSTRUMENTS since round 1 but no marker anywhere referenced it, and the
// default invocation's last-printed integer (filesScanned) could never verify the published
// marked/unmarked/total figure even if a marker had been added — "registered" was not "wired".
// These pin the three per-field entries exist with the exact args a marker would need, AND prove
// (via a REAL subprocess, not a fake runner) that `--field=...` genuinely makes the claimed number
// the last integer in stdout — the specific gap red-team's report named ("a fix that looks
// complete and is not").
test("QA-15 (Issue #150): KNOWN_INSTRUMENTS carries one qa14-marker-corpus-probe-<field> entry per checkable number (marked/unmarked/total)", () => {
  assert.deepEqual(KNOWN_INSTRUMENTS["qa14-marker-corpus-probe-marked"], {
    cmd: "node",
    args: ["src/qa/marker-corpus-probe.ts", "--field=marked"],
  });
  assert.deepEqual(KNOWN_INSTRUMENTS["qa14-marker-corpus-probe-unmarked"], {
    cmd: "node",
    args: ["src/qa/marker-corpus-probe.ts", "--field=unmarked"],
  });
  assert.deepEqual(KNOWN_INSTRUMENTS["qa14-marker-corpus-probe-total"], {
    cmd: "node",
    args: ["src/qa/marker-corpus-probe.ts", "--field=total"],
  });
});

test("QA-15 (Issue #150, end-to-end, real subprocess): verifyMarkerClaim against qa14-marker-corpus-probe-total genuinely re-runs the real probe and compares a real number, not a fake one", async () => {
  // Deliberately wrong `expect` — proves this is a REAL re-run producing a REAL mismatch, not a
  // stubbed pass. A previous run at HEAD found this instrument reports total > 0 on this repo's
  // own tracked corpus (never 0), so `expect=0` is guaranteed to mismatch without being a guess.
  const result = await verifyMarkerClaim({ raw: "x", cmd: "qa14-marker-corpus-probe-total", expect: 0 }, realRunner);
  assert.equal(result.ok, false, "a deliberately-wrong expectation must be caught by a real re-run");
  assert.match(result.summary, /claim says 0, instrument "qa14-marker-corpus-probe-total" re-run reports \d+/);
});
