import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeShellCall } from "./shell.ts";
import {
  shellAbbreviatedFlagCall,
  shellAmpersandChainedCall,
  shellAmpersandStillSeparatesCall,
  shellAtHeredocMultiCommandCall,
  shellBacktickSubstitutionCall,
  shellBareUnterminatedQuoteCall,
  shellBashDashCWrapperCall,
  shellChainedReadThenMutateCall,
  shellCommandSubstitutionCall,
  shellDepthCapExactCall,
  shellDepthCapExceededCall,
  shellDirectoryFlagAliasCollisionCall,
  shellDirectoryFlagLongCall,
  shellDirectoryFlagLongSpaceCall,
  shellDirectoryFlagShortCall,
  shellDirectoryFlagShortEqualsDCall,
  shellEquivalentDeleteCall,
  shellEscapedRedirectFalseFdDupCall,
  shellEscapedRedirectWithResourceCall,
  shellFdDupAmpersandCall,
  shellFdDupAmpersandRedirectCall,
  shellFdDupCloseFdCall,
  shellFdDupDigitLeadingWordRedirectCall,
  shellFdDupWordRedirectCall,
  shellFdDupWordRedirectGluedCall,
  shellFdDupWordRedirectPlainWriteCall,
  shellHeredocRedirectCall,
  shellHerestringNotHeredocCall,
  shellKubectlWithRedirectCall,
  shellLiveRedirectStillExcludedCall,
  shellMalformedCall,
  shellMalformedResourceWithRedirectCall,
  shellMultiRedirectCall,
  shellMultiResourceCall,
  shellMultiTargetResourcePlusRedirectCall,
  shellMultiTargetTwoRedirectsCall,
  shellMultiTargetTwoResourcesCall,
  shellMultiTargetViaWrapperCall,
  shellNewlineChainedCall,
  shellNohupWrapperCall,
  shellNoSpaceRedirectCall,
  shellOverLongResourceTokenCall,
  shellPathQualifiedToolCall,
  shellQuotedChainOperatorCall,
  shellQuotedLiteralAppendRedirectArgCall,
  shellQuotedLiteralRedirectArgCall,
  shellQuotedTokensCall,
  shellReorderedFlagCall,
  shellUnrecognizedVerbCall,
  shellUnrecognizedWrapperShapeCall,
  shellUnterminatedDoubleQuoteCall,
  shellUnterminatedSingleQuoteCall,
  shellWrapperInnerUnresolvedCall,
} from "../fixtures/normalizer-calls.ts";

test("normalizeShellCall: a well-formed command produces a clean, resolved ActionRecord", () => {
  const record = normalizeShellCall(shellEquivalentDeleteCall);
  assert.equal(record.source, "parsed");
  assert.deepEqual(record.verbs, ["delete"]);
  assert.deepEqual(record.targets, ["prod/cluster/prod-cluster/pod/payment-worker"]);
  assert.equal(record.environment, "prod");
  assert.equal(record.identity, "agent:story-implementer");
  assert.equal(record.deferred, false);
  assert.deepEqual(record.unresolved, []);
});

test("normalizeShellCall: a verb outside the action catalog produces unresolved, verbs stays empty (never a silently-passed verb string)", () => {
  const record = normalizeShellCall(shellUnrecognizedVerbCall);
  assert.deepEqual(record.verbs, []);
  assert.ok(record.unresolved.length > 0);
  assert.match(record.unresolved[0] ?? "", /patch/);
  // the resource/cluster facets were still parseable — only the verb is reported unresolved
  assert.deepEqual(record.targets, ["prod/cluster/prod-cluster/pod/payment-worker"]);
});

test("normalizeShellCall: a malformed command reports EVERY unresolvable facet, targets stay empty", () => {
  const record = normalizeShellCall(shellMalformedCall);
  assert.deepEqual(record.targets, []);
  assert.ok(record.unresolved.some((u) => u.includes("resource")));
  assert.ok(record.unresolved.some((u) => u.includes("--context")));
});

test("normalizeShellCall: deferred passes through unchanged (SUR-09 — the kernel, not the normalizer, treats it as execution)", () => {
  const record = normalizeShellCall({ ...shellEquivalentDeleteCall, deferred: true });
  assert.equal(record.deferred, true);
});

// --- app-security-reviewer, S3 review, Finding #1 (Issue #65) regression --------------------
//
// Fixed: `const [rt, rn] = token.split("/")` silently discarded any segment beyond the first two.
// A resource token with a THIRD, smuggled segment ("secrets/db-password/extra-smuggled-segment")
// used to resolve cleanly to resourceName: "db-password", unresolved: [] — the exact PoC the
// reviewer ran directly against the shipped module. The fix requires the split to produce EXACTLY
// 2 non-empty parts; anything else is now reported via `unresolved`, identically to the
// no-resource-token case, never partially accepted.

test("normalizeShellCall (Issue #65 regression): a resource token with a THIRD, smuggled segment is reported unresolved, never silently truncated to the first two", () => {
  const record = normalizeShellCall(shellOverLongResourceTokenCall);
  assert.equal(record.targets.length, 0, "an over-long resource token must produce NO target, not a truncated one");
  assert.ok(record.unresolved.some((u) => u.includes("resource")), "the resource facet itself must be reported unresolved");
  // pinned: the pre-fix behavior silently resolved to "db-password" — must never appear anywhere
  assert.ok(
    !record.targets.some((t) => t.includes("db-password")),
    "the smuggled-segment token must never resolve to a target at all, silently or otherwise",
  );
});

test("normalizeShellCall (Issue #65 regression, boundary): a resource token with only ONE segment (no '/') is still reported unresolved, unchanged behavior", () => {
  const record = normalizeShellCall({ ...shellEquivalentDeleteCall, command: "kubectl delete pod --context=prod-cluster" });
  assert.deepEqual(record.targets, []);
  assert.ok(record.unresolved.some((u) => u.includes("resource")));
});

// ============================================================================================
// S4 (Milestone #22, CRITICAL tier): SUR-06/07/08/09
// ============================================================================================

// --- SUR-06a: chaining -------------------------------------------------------------------------

test("SUR-06a: a chained read-then-mutate command reports unresolved — one leading read-only call cannot disable evaluation of a later mutating one", () => {
  const record = normalizeShellCall(shellChainedReadThenMutateCall);
  assert.ok(record.unresolved.some((u) => u.includes("chain operator")));
  assert.deepEqual(record.targets, []);
});

// --- SUR-06b: quote preservation -----------------------------------------------------------

test("SUR-06b: a chain-operator-shaped string fully inside a quoted flag value is inert, not treated as live chaining", () => {
  const record = normalizeShellCall(shellQuotedChainOperatorCall);
  assert.ok(!record.unresolved.some((u) => u.includes("chain operator")));
});

test("SUR-06b: the quoted flag's content is still available to target extraction, not lost to preprocessing", () => {
  const record = normalizeShellCall(shellQuotedChainOperatorCall);
  assert.deepEqual(record.verbs, ["delete"]);
  assert.equal(record.targets.length, 1);
  assert.match(record.targets[0] ?? "", /payment-worker/);
});

// --- SUR-07: semantic, not literal, detection — differential pairs vs. the canonical form -----

const CANONICAL = normalizeShellCall(shellEquivalentDeleteCall);

test("SUR-07: flag reordering resolves to the SAME verbs/targets as the canonical form", () => {
  const record = normalizeShellCall(shellReorderedFlagCall);
  assert.deepEqual(record.verbs, CANONICAL.verbs);
  assert.deepEqual(record.targets, CANONICAL.targets);
  assert.deepEqual(record.unresolved, []);
});

test("SUR-07: an abbreviated flag ('-c=' for '--context=') resolves to the SAME verbs/targets as the canonical form", () => {
  const record = normalizeShellCall(shellAbbreviatedFlagCall);
  assert.deepEqual(record.verbs, CANONICAL.verbs);
  assert.deepEqual(record.targets, CANONICAL.targets);
  assert.deepEqual(record.unresolved, []);
});

test("SUR-07: a path-qualified tool-binary token resolves to the SAME verbs/targets as the canonical form", () => {
  const record = normalizeShellCall(shellPathQualifiedToolCall);
  assert.deepEqual(record.verbs, CANONICAL.verbs);
  assert.deepEqual(record.targets, CANONICAL.targets);
  assert.deepEqual(record.unresolved, []);
});

test("SUR-07: quoted tool/verb/resource tokens all resolve to the SAME verbs/targets as the canonical form", () => {
  const record = normalizeShellCall(shellQuotedTokensCall);
  assert.deepEqual(record.verbs, CANONICAL.verbs);
  assert.deepEqual(record.targets, CANONICAL.targets);
  assert.deepEqual(record.unresolved, []);
});

// --- design-challenger S4 round-1 Finding #2: directory flags must not be silently invisible --

test("Finding #2: a long-form directory flag ('--directory=') is reported via unresolved, never silently dropped", () => {
  const record = normalizeShellCall(shellDirectoryFlagLongCall);
  assert.ok(record.unresolved.some((u) => u.includes("directory flag")));
});

test("Finding #2: a short-form directory flag ('-C <path>') is reported via unresolved, never silently dropped", () => {
  const record = normalizeShellCall(shellDirectoryFlagShortCall);
  assert.ok(record.unresolved.some((u) => u.includes("directory flag")));
});

test("Finding #2 (contrast): a directory flag's presence is NOT byte-identical to its absence — pinning the exact bug design-challenger demonstrated", () => {
  const withFlag = normalizeShellCall(shellDirectoryFlagLongCall);
  const withoutFlag = normalizeShellCall(shellEquivalentDeleteCall);
  assert.notDeepEqual(withFlag.unresolved, withoutFlag.unresolved);
});

// --- design-challenger S4 round-1 Finding #1: command/process substitution must deny -----------

test("Finding #1 (named proof-test, review's own repro): '$(id)' substitution in a resource token is reported via unresolved, source stays parsed but never cleanly resolved", () => {
  const record = normalizeShellCall(shellCommandSubstitutionCall);
  assert.ok(record.unresolved.length > 0, "must NOT be unresolved: [] — that was the demonstrated bypass");
  assert.deepEqual(record.targets, []);
});

test("Finding #1: backtick substitution is also reported via unresolved", () => {
  const record = normalizeShellCall(shellBacktickSubstitutionCall);
  assert.ok(record.unresolved.length > 0);
  assert.deepEqual(record.targets, []);
});

// --- SUR-08: heredoc-safe target extraction -----------------------------------------------

test("SUR-08 (named test): a heredoc marker's line carrying a trailing redirect still extracts the target — heredoc-body consumption does not swallow it", () => {
  const record = normalizeShellCall(shellHeredocRedirectCall);
  assert.deepEqual(record.verbs, ["write"]);
  assert.deepEqual(record.targets, ["/etc/app/config"]);
  assert.deepEqual(record.unresolved, []);
});

test("Issue #82 (council round 3, superseding the prior 'additive' expectation): a resolved kubectl call that ALSO redirects assembles 2 targets — denies wholesale, never a multi-target resolve", () => {
  // This is impact-analyst's own compound PoC shape (docs/reviews/…impact-analyst-2026-09-03.md):
  // ONE resource token + ONE redirect target still assembles 2 total targets. Before this
  // council round, this test asserted a clean multi-target resolve — that was the exact defect
  // (kernel.ts's matchesTarget could let an ALLOW rule scoped to the resource also authorize the
  // redirect target riding along). Superseded here, not silently dropped — see git history/
  // CHANGELOG for the prior assertion.
  const record = normalizeShellCall(shellKubectlWithRedirectCall);
  assert.deepEqual(record.verbs, []);
  assert.deepEqual(record.targets, []);
  assert.ok(record.unresolved.length > 0);
});

// --- SUR-09: the 9 named deferred/indirect-execution wrappers ------------------------------

test("SUR-09: 'bash -c <canonical inner command>' recursively resolves to the SAME verbs/targets, deferred forced true", () => {
  const record = normalizeShellCall(shellBashDashCWrapperCall);
  assert.deepEqual(record.verbs, CANONICAL.verbs);
  assert.deepEqual(record.targets, CANONICAL.targets);
  assert.deepEqual(record.unresolved, []);
  assert.equal(record.deferred, true);
});

test("SUR-09: 'nohup <canonical inner command> &' recursively resolves to the SAME verbs/targets, deferred forced true", () => {
  const record = normalizeShellCall(shellNohupWrapperCall);
  assert.deepEqual(record.verbs, CANONICAL.verbs);
  assert.deepEqual(record.targets, CANONICAL.targets);
  assert.deepEqual(record.unresolved, []);
  assert.equal(record.deferred, true);
});

// --- criterion 10: indirect-execution-shaped but not matching a recognized wrapper -------------

test("criterion 10: 'bash -x ...' (recognized binary, unrecognized sub-shape) denies via unresolved, never silently passed through as a benign unrecognized verb", () => {
  const record = normalizeShellCall(shellUnrecognizedWrapperShapeCall);
  assert.ok(record.unresolved.length > 0);
  assert.deepEqual(record.verbs, []);
  assert.equal(record.deferred, true);
});

// --- SUR-09: depth cap ---------------------------------------------------------------------

test("depth cap: nesting exactly AT the cap (5) still resolves cleanly", () => {
  const record = normalizeShellCall(shellDepthCapExactCall);
  assert.deepEqual(record.verbs, CANONICAL.verbs);
  assert.deepEqual(record.targets, CANONICAL.targets);
  assert.deepEqual(record.unresolved, []);
});

test("depth cap: nesting exceeding the cap (6 levels) denies via unresolved at the point the cap is hit, not silently truncated", () => {
  const record = normalizeShellCall(shellDepthCapExceededCall);
  assert.ok(record.unresolved.some((u) => u.includes("depth cap")));
  assert.deepEqual(record.verbs, []);
});

// --- SUR-09 + ADR-0021 "exactly one Action record": inner unresolved propagates to outer -------

test("an inner wrapper command that is itself unresolved propagates its unresolved reason to the outer record, deferred stays true", () => {
  const record = normalizeShellCall(shellWrapperInnerUnresolvedCall);
  assert.ok(record.unresolved.length > 0);
  assert.equal(record.deferred, true);
});

// ============================================================================================
// S4 Stage-3 review fix-now round (red-team no-go, app-security REWORK, cross-domain REWORK,
// architecture APPROVE-WITH-CONDITIONS) — docs/reviews/s4-shell-semantic-detector-{red-team,
// app-security,cross-domain,architecture}-2026-09-02.md
// ============================================================================================

// --- red-team Finding 1 (Issue #70): newline / non-doubled '&' are live command separators -----

test("SUR-06a (Issue #70): a newline-separated read-then-mutate command reports unresolved", () => {
  const record = normalizeShellCall(shellNewlineChainedCall);
  assert.ok(record.unresolved.length > 0);
  assert.deepEqual(record.targets, []);
});

test("SUR-06a (Issue #70): an '&'-separated read-then-mutate command reports unresolved", () => {
  const record = normalizeShellCall(shellAmpersandChainedCall);
  assert.ok(record.unresolved.length > 0);
  assert.deepEqual(record.targets, []);
});

test("SUR-09/at (Issue #70): a heredoc body carrying two commands reports unresolved, never resolves only its first line", () => {
  const record = normalizeShellCall(shellAtHeredocMultiCommandCall);
  assert.ok(record.unresolved.length > 0);
  assert.deepEqual(record.targets, []);
  assert.equal(record.deferred, true);
});

test("nohup's own trailing '&' (background marker, not chaining) still resolves cleanly, unaffected by Issue #70's fix", () => {
  const record = normalizeShellCall(shellNohupWrapperCall);
  assert.deepEqual(record.unresolved, []);
});

// --- red-team Finding 2 (Issue #71): '<<<' herestring is not a heredoc marker ------------------

test("SUR-08 (Issue #71): a '<<<' herestring does not swallow the following line as inert body — it stays live and denies as a second command", () => {
  const record = normalizeShellCall(shellHerestringNotHeredocCall);
  assert.ok(record.unresolved.length > 0);
  assert.deepEqual(record.targets, []);
});

// --- red-team Finding 3 (Issue #72) / app-security Finding 2 (Issue #69): widened directory flag

test("Issue #72/#69: '--directory <path>' (long, space-separated) denies via unresolved", () => {
  const record = normalizeShellCall(shellDirectoryFlagLongSpaceCall);
  assert.ok(record.unresolved.some((u) => u.includes("directory flag")));
});

test("Issue #72/#69: '-d=<path>' (short, equals-form) denies via unresolved", () => {
  const record = normalizeShellCall(shellDirectoryFlagShortEqualsDCall);
  assert.ok(record.unresolved.some((u) => u.includes("directory flag")));
});

test("Issue #72/#69 (the sharpest half): '-C=<v>' denies via unresolved — never resolves as if it silently supplied --context", () => {
  const record = normalizeShellCall(shellDirectoryFlagAliasCollisionCall);
  assert.ok(record.unresolved.some((u) => u.includes("directory flag")));
  assert.deepEqual(record.targets, []);
});

// --- red-team Finding 4 (Issue #73): every resource-shaped token is COLLECTED (never silently
// dropped) — but per council round 3 (Issue #82), 2+ collected resources denies wholesale rather
// than resolving a multi-target record. Issue #73's own bar ("reports every resource... OR
// reports unresolved") explicitly sanctioned this branch; round 3 is the one that takes it.

test("SUR-06 (Issue #73/#82): a multi-resource kubectl invocation denies wholesale — never a multi-target resolve", () => {
  const record = normalizeShellCall(shellMultiResourceCall);
  assert.deepEqual(record.verbs, []);
  assert.deepEqual(record.targets, []);
  assert.ok(record.unresolved.length > 0);
});

// --- red-team Finding 5 (Issue #74): every live redirect target is COLLECTED (never silently
// dropped) — but per council round 3 (Issue #82), 2+ collected targets denies wholesale, the
// same cap applied uniformly regardless of which collection path produced them.

test("SUR-08/#82: a command carrying two live redirects denies wholesale — never a multi-target resolve", () => {
  const record = normalizeShellCall(shellMultiRedirectCall);
  assert.deepEqual(record.verbs, []);
  assert.deepEqual(record.targets, []);
  assert.ok(record.unresolved.length > 0);
});

// ============================================================================================
// Round 3 (council-approved path, docs/reviews/s4-shell-semantic-detector-council-path-forward-
// 2026-09-03.md): Issues #80, #81, #82. Day-1 proof-tests for #80 and #82 (design-challenger's
// boundary-crossing mandate — both cap at MED severity given no hook wiring exists yet, but still
// get a mandatory proof-test regardless of that cap).
// ============================================================================================

// --- Issue #80 (red-team round-2, N1): quoted literal '>'/'>>' must not swallow the next token -

test("Issue #80 (day-1 proof-test, review's own repro): a quoted literal '>' argument never removes the following resource-shaped token from the record", () => {
  const record = normalizeShellCall(shellQuotedLiteralRedirectArgCall);
  // Must NOT clean-resolve to only pods/api with secrets/db-creds invisible — either both
  // resources are visible (denied wholesale per #82's cap, since that's 2 targets) or the call
  // denies for some other reason. What it must NEVER do is silently drop secrets/db-creds.
  assert.ok(
    !(record.unresolved.length === 0 && record.targets.length === 1),
    "must not clean-resolve with exactly one target — that was the demonstrated bypass (secrets/db-creds silently invisible)",
  );
});

test("Issue #80, '>>' spelling: same guarantee", () => {
  const record = normalizeShellCall(shellQuotedLiteralAppendRedirectArgCall);
  assert.ok(!(record.unresolved.length === 0 && record.targets.length === 1));
});

test("Issue #80 regression pin: a genuinely LIVE (unquoted) redirect operator is still excluded from positional correctly after the position-based rework", () => {
  const record = normalizeShellCall(shellLiveRedirectStillExcludedCall);
  // 1 resource + 1 live redirect = 2 assembled targets -> denies per #82's cap (not the #80 bug).
  assert.ok(record.unresolved.length > 0);
});

test("Issue #80/N3 side effect: a no-space redirect ('cmd>/path') does not eat an unrelated following token", () => {
  const record = normalizeShellCall(shellNoSpaceRedirectCall);
  assert.deepEqual(record.verbs, ["write"]);
  assert.deepEqual(record.targets, ["/etc/cron.d/pwn"]);
  assert.deepEqual(record.unresolved, []);
});

// --- Issue #81 (red-team round-2, N2): fd-dup ampersand idiom must not be read as a separator ---

test("Issue #81 (review's own repro): 'cmd > /tmp/ok 2>&1' resolves as a write, not as a command separator", () => {
  const record = normalizeShellCall(shellFdDupAmpersandCall);
  assert.deepEqual(record.verbs, ["write"]);
  assert.deepEqual(record.targets, ["/tmp/ok"]);
  assert.deepEqual(record.unresolved, []);
});

test("Issue #81, '&>' spelling: same guarantee", () => {
  const record = normalizeShellCall(shellFdDupAmpersandRedirectCall);
  assert.deepEqual(record.verbs, ["write"]);
  assert.deepEqual(record.targets, ["/tmp/ok"]);
  assert.deepEqual(record.unresolved, []);
});

test("Issue #81 regression pin: a genuinely separating, non-fd-dup '&' still denies after the exclusion clause", () => {
  const record = normalizeShellCall(shellAmpersandStillSeparatesCall);
  assert.ok(record.unresolved.length > 0);
});

// --- Issue #82 (cross-domain round-2 + impact-analyst's compound PoC), council-ruled fix --------

test("Issue #82 (day-1 proof-test, original repro): two resource tokens assemble 2 targets, denies wholesale", () => {
  const record = normalizeShellCall(shellMultiTargetTwoResourcesCall);
  assert.deepEqual(record.verbs, []);
  assert.deepEqual(record.targets, []);
  assert.ok(record.unresolved.length > 0);
});

test("Issue #82 (day-1 proof-test, impact-analyst's sharper compound PoC): ONE resource token PLUS ONE redirect target still assembles 2 targets, denies wholesale — a guard scoped only to resource-token count would miss this", () => {
  const record = normalizeShellCall(shellMultiTargetResourcePlusRedirectCall);
  assert.deepEqual(record.verbs, []);
  assert.deepEqual(record.targets, []);
  assert.ok(record.unresolved.length > 0);
});

test("Issue #82: two redirect targets, no resource at all, still assembles 2 targets, denies wholesale (the cap applies regardless of which collection path produced each target)", () => {
  const record = normalizeShellCall(shellMultiTargetTwoRedirectsCall);
  assert.deepEqual(record.verbs, []);
  assert.deepEqual(record.targets, []);
  assert.ok(record.unresolved.length > 0);
});

test("Issue #82 through a wrapper: the multi-target guard fires at the INNER resolveKubectlShape call, and its unresolved reason propagates to the outer record with deferred true", () => {
  const record = normalizeShellCall(shellMultiTargetViaWrapperCall);
  assert.deepEqual(record.targets, []);
  assert.ok(record.unresolved.length > 0);
  assert.equal(record.deferred, true);
});

// ============================================================================================
// Round 3 re-confirm (red-team, docs/reviews/s4-shell-semantic-detector-red-team-round3-2026-09-03.md):
// Issue #83 — round 3's own #81 fd-dup fix reads a raw neighbouring character to decide fd-dup
// adjacency, never asking whether the neighbouring '>' is LIVE (not a backslash-escaped literal).
// The >=2-target guard (Issue #82) cannot backstop this: the hidden second command's own target is
// the ONLY target the assembled count ever sees, since the first command contributes none of its
// own — this is exactly the shape a target-count heuristic cannot detect (it counts targets, not
// commands). Named failing test required before merge per red-team's report.
// ============================================================================================

test("Issue #81 follow-on / Issue #83 (day-1 proof-test, report's own repro): an escaped literal '\\>' immediately before '&' is not fd-dup — the '&' is still a command separator, denying the hidden second command rather than clean-resolving the wrong verb onto the wrong resource", () => {
  const record = normalizeShellCall(shellEscapedRedirectFalseFdDupCall);
  // The demonstrated bypass: verbs=["get"], targets=[".../secrets/db-creds"], unresolved=[] — the
  // FIRST command's verb attached to the SECOND (hidden) command's resource, while real bash
  // executes the delete. Must never clean-resolve at all.
  assert.ok(record.unresolved.length > 0, "must deny — a live command separator must never be excluded as fd-dup just because a raw '>' character sits next to it");
  assert.deepEqual(record.targets, []);
});

test("Issue #83, sharper instance: the same escaped-redirect defect with a resource token on the FIRST command too — must deny via the real separator, not merely happen to deny via the unrelated >=2-target guard", () => {
  const record = normalizeShellCall(shellEscapedRedirectWithResourceCall);
  assert.ok(record.unresolved.length > 0);
  assert.deepEqual(record.targets, []);
});

test("Issue #83 regression pin: a genuine fd-dup ('2>&1') still resolves cleanly end to end, unaffected by the escape-awareness fix", () => {
  const record = normalizeShellCall(shellFdDupAmpersandCall);
  assert.deepEqual(record.verbs, ["write"]);
  assert.deepEqual(record.targets, ["/tmp/ok"]);
  assert.deepEqual(record.unresolved, []);
});

// ============================================================================================
// Issue #84 (red-team round-4, second stall, human-ruled Option B — day-1 S5-blocking task):
// round 3's own #81 fd-dup fix skipped ANY '>' followed by '&' unconditionally. Bash only treats
// '>&DIGIT'/'>&-' as fd-dup — '>&WORD' (spaced or glued) is a real file redirect, the historical
// synonym for '&>WORD'. The unconditional skip made the redirect target vanish, starving the
// Issue #82 assembled-target-count guard and clean-resolving a call the un-ampersanded control
// correctly denies. Fix: the skip is now conditional on a digit or '-' immediately following the
// '&', mirroring the existing '&>' tokenStart handling's own adjacency check.
// ============================================================================================

test("Issue #84 (report's own repro): 'kubectl get pods/api --context=prod >& out' must deny — the redirect target ('out') plus the resource token ('pods/api') assemble 2 targets, same as the un-ampersanded control", () => {
  const record = normalizeShellCall(shellFdDupWordRedirectCall);
  assert.ok(
    record.unresolved.length > 0,
    "must deny — '>& out' is a real file redirect in bash, not a fd-dup; clean-resolving here was the demonstrated bypass (one appended '&' flipped deny to allow)",
  );
  assert.deepEqual(record.targets, []);
});

test("Issue #84, glued spelling ('>&out', no live whitespace): same guarantee", () => {
  const record = normalizeShellCall(shellFdDupWordRedirectGluedCall);
  assert.ok(record.unresolved.length > 0);
  assert.deepEqual(record.targets, []);
});

test("Issue #84, isolated at the plain-write shape (no kubectl resource, so Issue #82's guard is not what's doing the denying here): 'cat payload >& out' resolves as an ordinary clean write to 'out'", () => {
  const record = normalizeShellCall(shellFdDupWordRedirectPlainWriteCall);
  assert.deepEqual(record.verbs, ["write"]);
  assert.deepEqual(record.targets, ["out"]);
  assert.deepEqual(record.unresolved, []);
});

test("Issue #84 regression pin: 'cat payload > /tmp/ok >&-' resolves as a clean write to the ONE real target — the trailing '>&-' (close-the-descriptor form) contributes no target of its own, unaffected by the fix", () => {
  const record = normalizeShellCall(shellFdDupCloseFdCall);
  assert.deepEqual(record.verbs, ["write"]);
  assert.deepEqual(record.targets, ["/tmp/ok"]);
  assert.deepEqual(record.unresolved, []);
});

test("Issue #84 regression pin: '&>' (both-streams, ampersand LEADING) still resolves cleanly, unaffected by the trailing-ampersand fix", () => {
  const record = normalizeShellCall(shellFdDupAmpersandRedirectCall);
  assert.deepEqual(record.verbs, ["write"]);
  assert.deepEqual(record.targets, ["/tmp/ok"]);
  assert.deepEqual(record.unresolved, []);
});

test("Issue #84 regression pin: bare digit fd-dup ('2>&1') still resolves cleanly, unaffected by the fix", () => {
  const record = normalizeShellCall(shellFdDupAmpersandCall);
  assert.deepEqual(record.verbs, ["write"]);
  assert.deepEqual(record.targets, ["/tmp/ok"]);
  assert.deepEqual(record.unresolved, []);
});

// ============================================================================================
// Issue #84 residual (round 5, red-team re-confirm): round 4's fix read only the character
// IMMEDIATELY after '&', not the whole word — bash classifies '>&WORD' on the whole word:
// fd-dup iff WORD is entirely digits or starts with '-'. A digit-LEADING but not all-digit word
// (e.g. a date-stamped log file) still misclassified as fd-dup one round ago. Fixed by reusing
// the module's own quote-aware `tokenize` to read the whole word, not a second character.
// docs/reviews/s4-shell-semantic-detector-red-team-round5-2026-09-06.md, Finding 1.
// ============================================================================================

test('Issue #84 residual (round 5): "kubectl get pods/api --context=prod >&2026-09-06.log" must DENY - >&WORD is fd-dup only when WORD is ALL digits or starts with a dash', () => {
  const record = normalizeShellCall(shellFdDupDigitLeadingWordRedirectCall);
  assert.ok(
    record.unresolved.length > 0,
    "must deny — '2026-09-06.log' is not all-digits and does not start with '-', so bash treats " +
      "'>&2026-09-06.log' as a real file redirect, not fd-dup; clean-resolving here was the " +
      "demonstrated bypass (a digit-leading filename silently vanished as a write target)",
  );
  assert.deepEqual(record.targets, []);
});

// --- app-security Finding 1 (Issue #68): unterminated quote denies -----------------------------

test("Finding 1 (Issue #68, review's own repro): an unterminated single quote denies — must NOT be unresolved: []", () => {
  const record = normalizeShellCall(shellUnterminatedSingleQuoteCall);
  assert.ok(record.unresolved.length > 0, "unresolved: [] was the demonstrated bypass — a clean resolve here is not acceptable");
  assert.deepEqual(record.targets, []);
});

test("Issue #68 regression pin: an unterminated double quote was already safe, stays denied", () => {
  const record = normalizeShellCall(shellUnterminatedDoubleQuoteCall);
  assert.ok(record.unresolved.length > 0);
});

test("Issue #68: a bare unterminated quote with no live payload is flagged for the quote itself, not just its content", () => {
  const record = normalizeShellCall(shellBareUnterminatedQuoteCall);
  assert.ok(record.unresolved.some((u) => u.includes("unterminated quote")));
});

// --- regression guard: kubectlAttempted must count raw resourceTokens, not only parsed resources

test("regression guard: a malformed resource-shaped token that coexists with a live redirect is reported via unresolved, never silently dropped into a false-clean write record", () => {
  const record = normalizeShellCall(shellMalformedResourceWithRedirectCall);
  // The malformed token itself is reported (never silently dropped) — this is what distinguishes
  // "kubectl attempted but incomplete" from the pure-redirect clean-write branch. Consistent with
  // the S3-reviewed precedent (shellUnrecognizedVerbCall): a part that DID parse (here, the
  // redirect target) still surfaces in targets alongside the unresolved facet — the kernel denies
  // on the non-empty `unresolved` regardless of what targets contains.
  assert.ok(record.unresolved.some((u) => u.includes("resource")));
  assert.ok(record.unresolved.length > 0, "must deny — the malformed resource token must not be silently ignored");
  // Pinned exactly (round 3): resourceMalformed keeps resourceTargets empty, so the assembled-
  // target-count guard (Issue #82) never fires here (0 resource targets + 1 redirect target = 1) —
  // this is the additive redirect-extraction branch's only remaining reachable case now that a
  // VALID resource plus a redirect always sums to 2+ and is caught by that guard instead. Pinning
  // verbs/targets here (not just `unresolved.length > 0`) is what makes this test able to detect
  // that additive branch being silently disabled — a bare unresolved-length check cannot.
  assert.deepEqual(record.verbs, ["write"]);
  assert.deepEqual(record.targets, ["/tmp/out"]);
});
