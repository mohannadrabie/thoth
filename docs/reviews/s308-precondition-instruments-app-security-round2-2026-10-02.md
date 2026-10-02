# s308-precondition-instruments — App-security RE-CONFIRM (round 2, STANDARD) — 2026-10-02

[app-security-reviewer] Horus. ADR cache: `📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog [CACHE=HIT]`. Fix commits reviewed: ae15499, a57432b, 401f719 (on 773fbc2 base). Own detached worktree at 401f719 (removed after use; main node_modules intact).

## Verdict: APPROVE (all round-1 conditions closed; 0 open issues)

## Evidence
- Test-only: `git show --stat` — ae15499 touches only src/qa/catalog-single-source.test.ts; a57432b only src/policy/config/hook-import-pins.test.ts; 401f719 only CHANGELOG + two plan docs. No production file changed.
- No assertion weakened (diff 773fbc2..401f719 on both test files): every removed line is a re-key to the stronger form (writer list now `file|value`, env sites now `|xN` counted, the `endsWith("|process.env")` check became `includes("|process.env|")` — equivalent under the new key). ENV_BUILTINS only grew. Pinned allow-set only gained |x1 suffixes + 4 node:fs importers (derived from graph by a test, none network).
- Three instrument files baseline at 401f719: `node --test` on catalog-single-source + hook-import-pins: pass 72 / fail 0 / skipped 0.
- Mutants planted in the worktree against the REAL files, new tests (fail counts; all others stayed green):
  - #376: tool-routing.ts `catalog: ctx.catalog` -> literal: 3 failed (AST enumeration, writer-value pin, seeded-mutant test). RED.
  - #377a: second `process.env.PATH` read inside resolveSystemRegExePath: 1 failed (AC-3j-4 exact set). RED.
  - #377b: `void process.env.HOME` inside projectDir: 1 failed. RED.
  - LOW 3: `eval("1")`, `(()=>{}).constructor("return process")()`, `new Function("return process")()` in the graph: each 1 failed. RED.
  - LOW 5: `import "node:net"` / `"node:fs"` added to central-source.ts: each 2 failed (exact-set + fs/net derived pin). RED. Decision sound: fs scanned and its 4 existing importers pinned as allow-set; network built-ins deny-by-default; none imported today; path/url left unscanned (inert) — disclosed.
  - LOW 4: rogue `src/policy/x/rogue.mts` and `.cjs` carrying a catalog writer: 1 failed (now scanned). A production file importing a file under `test-support/`: 1 failed (import check). RED.
- Red-first: the OLD (773fbc2) test files against the #376 literal mutant, the #377 second-env-read mutant and the eval mutant: pass 46 / fail 0 each — i.e. the round-1 gaps were real and the new tests are what turn them red. The builder's commit messages claim this; independently confirmed.
- Full suite (worktree, 401f719): tests 1799, pass 1797, fail 2, skipped 0. Failures: (1) R4 fresh-clone secret-scan — the known Windows EBUSY flake, tracked in #231, not counted against this story; (2) QA-14 dogfood "ADR-0021 unresolved" — a worktree artifact: the `adr/` submodule is empty in a detached worktree so ADR ids cannot resolve; unrelated to the diff (reference-resolver.test.ts untouched). Not reproduced in the main tree because another build is running there; Manager may confirm there.

## Findings (all closed or disclosed)
1. [CLEAN][demonstrated] #376 closed: catalog writers pinned by value text and occurrence; literal/wrapped/second-writer mutants red.
2. [CLEAN][demonstrated] #377 closed: env sites keyed by property text + occurrence count; second reads in both pinned scopes red.
3. [CLEAN][demonstrated] LOW 3 closed: eval / Function / .constructor( routes flagged.
4. [CLEAN][demonstrated] LOW 4 closed: .mts/.cts/.cjs scanned; test-support/.test. imports and non-literal dynamic import in production flagged; scope disclosed in the test header.
5. [CLEAN][demonstrated] LOW 5 closed: node:fs importers pinned, network built-ins deny-by-default.
6. [SUSPICION][LOW][code-traced] Residual, honestly disclosed in the test headers: assembled-name `Function` access, setTimeout-with-string, and files outside src/ and hooks/ are not covered; textual writer pin does not prove what `ctx.catalog` holds. No Issue (LOW suspicion).

## Blockers vs hardening
Blockers: none. Hardening: none new beyond the disclosed residuals in 6.

## Next action
Manager: comment verdict on #376/#377 (done by me), then close both as completed in the merge flow (human/Manager owns closing).

Editorial: none.

RECEIPT: verdict=APPROVE
findings:
1. [CLEAN][demonstrated] #376 writer value pin: literal mutant on tool-routing.ts goes red (3 failures)
2. [CLEAN][demonstrated] #377 occurrence-count keying: second process.env read in resolveSystemRegExePath and projectDir goes red
3. [CLEAN][demonstrated] LOW 3 eval/Function/.constructor routes flagged, red on real graph
4. [CLEAN][demonstrated] LOW 4 .mts/.cjs scanned, test-support import flagged
5. [CLEAN][demonstrated] LOW 5 node:fs allow-set pinned, network built-ins deny-by-default
6. [SUSPICION][LOW][code-traced] disclosed residuals: assembled-name Function, string setTimeout, files outside src/ and hooks/ unscanned
counts: issues=0 suspicions=1 clean=5
evidence: demonstrated=5 code-traced=1 derived=0
checks="1797/2/0"
adr=HIT(37)
report=docs/reviews/s308-precondition-instruments-app-security-round2-2026-10-02.md
