# Cross-Domain Review — s1-238-unlock-command-cquote

**Reviewer:** cross-domain-reviewer (Ra)
**Date:** 2026-09-21
**Scope:** branch fix/s1-238-unlock-command-cquote, commit 90e9585, diff vs origin/master (2f61890)
**Tier:** STANDARD (run-log.jsonl tier-ratified, 2026-09-22T01:37:55.414Z: proposed STANDARD, ratified STANDARD unchanged -- "print-formatting/CLI-input fix, sensitive-area file but no detection-logic change")
**ADR cache:** [CACHE=HIT] -- 37 ADRs reused (adr/devops:12, adr/software-engineering:23, docs/adr:2), fp b588a48. Whole catalog read, unfiltered, per rule 9/10.

## Who else is reviewing

Per the task brief and docs/.maat-state.json's run-log entry, a parallel app-security-reviewer pass covers: shell-safety interaction with #239's unlock-command channel, ambiguity handling in resolveByDecodedPath's throw-on-collision path, and ADR-0002 (THOTH) path-matching semantics. This report starts where that lane stops: full ADR catalog for collisions outside security's slice, functional correctness of the diff on its own terms, test quality, and seams (Windows, core.quotepath test-helper leakage, multi-byte UTF-8 octal decoding).

## Diff under review

- src/lib/git.ts: new decodeGitQuotedPath() -- undoes git's C-quoting of a tree path (octal-byte escapes + named C-escapes), "give up, don't guess" fallback.
- src/secret-scan/allowlist-tool.ts: runHash tries a direct tree.get(path), then falls back to resolveByDecodedPath() (linear scan, decode-and-compare, throws on ambiguity).
- src/lib/git.test.ts (+5 tests), src/secret-scan/allowlist-tool.test.ts (+1 e2e regression, real git-plumbed cafe.txt fixture; core.quotepath=true pinned in withToolRepo).
- CHANGELOG.md entry.

## Cross-domain ADR verdict (whole catalog vs. this diff)

No accepted or proposed ADR outside the security lane's own slice collides with this diff.

- Devops ADR-0001..0010 (IaC/CDK/pipeline/tagging/cost/IAM): not applicable -- no infrastructure, CDK, or ci.yml file touched.
- SE ADR-0002 (multi-layer architecture): not applicable -- a CLI plumbing helper and its consumer, not a layered domain/app boundary.
- SE ADR-0003 (SOLID): satisfied -- resolveByDecodedPath is single-purpose, takes its tree as a parameter (no hidden I/O), small.
- SE ADR-0004 (idempotency): not applicable -- no mutating endpoint/job.
- SE ADR-0005 (testing strategy): satisfied -- new unit tests cover happy path, "never guess" fallback, and a real-git round-trip (not a hand-derived escape string); each test owns its own mkdtemp'd repo (no shared-data dependency); no waitForTimeout/sleeps; nothing deleted or weakened. Demonstrated: 15/15 (git.test.ts) and 16/16 (allowlist-tool.test.ts) pass on this Windows checkout (raw output below).
- SE ADR-0010 (quality gates): satisfied -- npm run typecheck, npm run lint both clean; full suite 1049/1049 (raw output below); nothing suppressed.
- THOTH-ADR-0002 (value-scoped allowlist, security's own lane): the new code's own comment ("never changes... the allowlist's path field semantics") is correct -- traced against history-scan.ts and confirmed true (see Finding 1 for the one place this correctness still leaves a footgun). Not re-litigated further here; it's app-security-reviewer's assigned slice.

## Seam findings

### Finding 1 -- hash's new fallback can hand a maintainer a valid hash for the wrong path spelling to put in the allowlist entry

**Domains in tension:** CLI ergonomics (allowlist-tool.ts hash) vs. the allowlist-matching contract (history-scan.ts / THOTH-ADR-0002).

**Evidence (code-traced):**
- allowlist-tool.ts:356-359 -- runHash now resolves path either as the raw tree key or, on miss, via resolveByDecodedPath (the decoded, plain spelling). Its only output is a hash line plus the redacted form (allowlist-tool.ts:301, :364) -- the resolved raw tree key is never echoed back.
- history-scan.ts:95,99 -- every HistoryMatch.path is the raw (potentially C-quoted) lsTree() key, unchanged by this diff.
- history-scan.ts:142-153 (partitionAllowlisted) -- an allowlist entry's path field is compared for exact string equality against that raw m.path.
- So: a maintainer who runs the hash command with the plain filename (exercising the new fallback) gets a real hash, but if they then write that same plain spelling into the allowlist entry's path field -- the natural thing to do, since that's the string they just typed successfully -- the entry never matches the real m.path (the C-quoted raw form), and the gate stays blocking.

**Why this is real but narrow:** it fails loud, not open -- CI/pre-commit stays red, so the mismatch is self-discovered, not a silent security bypass. THOTH-ADR-0002's own residual table already discloses the general class ("An entry that matches nothing is invisible | Tracked in Issue #235; out of scope here") -- this diff opens one more, easier route into that same disclosed class by making hash succeed where it used to fail loud immediately (removing an early signal that used to force the maintainer toward the raw spelling).

**Exposure:** 0% today, basis: measured (a full-history ls-tree scan for C-quoted tracked paths returns 0 -- no tracked paths are currently C-quoted in this repo). Forward-looking only.

**Minimal fix:** have runHash print the resolved raw tree-key spelling once alongside the hash line when the fallback path was used, so the one string a maintainer needs for the allowlist entry's path field is the one the tool hands them -- no new prompt/flag needed.

**Severity: LOW** (fails safe, 0 measured exposure, already-disclosed general residual). Not filed as an Issue per policy (LOW); recorded here and appropriate to fold into Issue #235's existing scope if picked up.

### Finding 2 -- docs/.maat-state.json's persisted top-level scope/tier never transitioned to this story

**Domains in tension:** this diff's own review process vs. the next stage of the same pipeline (/maat:verify).

**Evidence (code-traced):** docs/.maat-state.json's top-level scope/tier still read "s1-229-qa14-red" / "CRITICAL" (last touched by commit 2482a4c, per git log against that file). The STANDARD tier-ratification for s1-238-unlock-command-cquote exists only as a run-log.jsonl event (line 81, 2026-09-22T01:37:55.414Z), never persisted into .maat-state.json's structured fields the way CLAUDE.md's Risk Tier Definitions describe ("persisted once to docs/.maat-state.json, and /maat:review and /maat:verify reuse it rather than re-deriving").

**Why this matters:** this session had the correct tier/scope only because the task brief stated it explicitly. A mechanical reader of .maat-state.json (the next /maat:verify stage on this same story) would see the previous story's CRITICAL tier and wrong scope instead.

**Recurrence:** this exact class has recurred twice before on this project (Issues #185, #212 -- both closed, both distinct story-instances of "the state file's top-level scope never transitioned"), so this is instance 3 in that series, not a one-off.

**Minimal fix:** update .maat-state.json's top-level scope/tier/round-counters to s1-238-unlock-command-cquote/STANDARD, moving the current top-level block into priorScope -- the same shape every prior transition in this same file already uses.

**Severity: MED** -- filed as GitHub Issue #260 (duplicate-checked first: #185/#212 are closed instances of the same class for different stories, not reopenable for this one).

### Checked, sound (no finding)

- **core.quotepath=true leak risk:** confirmed CLEAN -- pinned via a local git config command run with cwd set to each test's own freshly-mkdtemp'd repo (allowlist-tool.test.ts:227, git.test.ts's own round-trip test), not a --global config value. No other test shares that directory. Full suite (1049/1049) stayed green, confirming no cross-test interference.
- **Multi-byte UTF-8 octal decoding:** confirmed CLEAN beyond the shipped cafe.txt (2-byte) test. Demonstrated against a real git-plumbed fixture combining a 3-byte CJK sequence and a 4-byte emoji via a faithful line-for-line reimplementation of the shipped decodeGitQuotedPath algorithm (src/lib/git.ts:103-129) -- git's raw C-quoted output decodes back to the exact original name. The algorithm is byte-oriented (pushes raw bytes, UTF-8-decodes once at the end), so it is correct by construction for any byte width, not just 2-byte sequences -- this demonstration confirms that reasoning rather than resting on it alone.
- **Windows path-separator concern:** none found. decodeGitQuotedPath operates on git's own path strings (always forward-slash-separated internally, even on Windows); it never touches OS path-join logic. All new/changed tests run green on this Windows (win32) checkout, including the real-git round-trip tests.
- **No other lsTree() caller shares the #238 bug:** history-scan.ts:94 iterates the whole tree (never looks up by a human-typed path) and allowlist-tool.ts:123's ALLOWLIST_PATH lookup is a fixed, plain-ASCII constant -- neither needed this fix, and neither was touched.
- **CHANGELOG's shell-safety claim** ("no C-quoted path has ever produced a runnable HASH-COMMAND line") -- verified true: the SHELL_SAFE regex (history-scan.ts:180) rejects every C-quoted path (always carries a double-quote or backslash), so such a path always falls into the pre-existing NO-COMMAND-PRINTED branch, unaffected by this diff.

## Coverage gaps named

- CHANGELOG.md, src/lib/git.test.ts, src/secret-scan/allowlist-tool.test.ts -- no dedicated code-reviewer lane is dispatched on this STANDARD-tier story besides app-security-reviewer; test-quality and prose-accuracy checks on these fell to this pass, per the task brief, and are covered above.
- No UI/API surface changed -- test-writer correctly not dispatched (internal CLI hint string only).
- No infra/IaC files touched -- devops ADR lane genuinely not applicable, not merely unreviewed.

## Editorial (non-blocking, verdict-neutral)

CHANGELOG.md's Checks line claims npm run oss:secret-scan produced "0 blocking, 2031 allowlisted." Re-running the identical command against this exact commit (working tree stashed clean first) measured 2038 allowlisted, 0 blocking either time. Blast radius nil (0 blocking in both runs; the diff's own correctness is unaffected). Most likely explanation: history-scan.ts's "full history" scan walks --all refs, so the count is sensitive to which local branches/tags exist in the scanning environment, not just the commit under review -- plausible drift between the machine that authored the CHANGELOG line and this one, not a defect in the shipped fix. Worth a one-word count correction in the CHANGELOG entry, nothing more.

## Raw checks (demonstrated)

    $ node --test src/lib/git.test.ts
    tests 15 / pass 15 / fail 0 / skipped 0

    $ node --test src/secret-scan/allowlist-tool.test.ts
    tests 16 / pass 16 / fail 0 / skipped 0

    $ npm run typecheck        (clean, no output)
    $ npm run lint             (clean, no output)

    $ npm test
    tests 1049 / pass 1049 / fail 0 / skipped 0
    duration_ms 104078.5361

    $ npm run oss:secret-scan  (working tree stashed clean)
    [OSS-01 history-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (2038 allowlisted).

    $ git ls-tree -r HEAD --name-only, filtered for C-quoted (leading double-quote) entries
    0

## Verdict

APPROVE-WITH-CONDITIONS. Nothing here rises to a code-defect blocker in the shipped diff: the fix is narrowly scoped, correctly reasoned, well-tested (including a real multi-byte cross-check beyond its own shipped test), and every automated gate is green on this platform. The one MED (Finding 2) is a process/state-tracking gap, not a defect in the diff -- condition: docs/.maat-state.json's top-level scope/tier is corrected to this story before /maat:verify runs, so that stage doesn't calibrate to the stale CRITICAL/s1-229 state. Finding 1 (LOW) is a disclosed-class usability footgun with 0 current exposure -- recommended, not required, before merge.

## Next action

Manager (or story-implementer) updates docs/.maat-state.json's top-level scope/tier to s1-238-unlock-command-cquote/STANDARD (folding the current top-level block into priorScope, same shape as every prior transition in that file) before /maat:verify runs against this story.

---
RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][MED][code-traced] docs/.maat-state.json:1-10 (top-level scope/tier still "s1-229-qa14-red"/CRITICAL; run-log.jsonl:81 has the real s1-238/STANDARD tier-ratified event) -- persist the transition before /maat:verify reads the stale tier. Issue #260.
2. [ISSUE][LOW][code-traced] src/secret-scan/allowlist-tool.ts:350-365 + src/secret-scan/history-scan.ts:95,99,142-153 -- hash's decode-fallback resolves but never echoes the raw C-quoted path an allowlist entry actually needs (THOTH-ADR-0002 matches on the raw spelling), risking a dead entry; fails safe (CI stays red), 0 tracked paths affected today. Print the resolved raw path alongside the hash.
3. [CLEAN][code-traced] core.quotepath=true pinned per-mkdtemp-repo (local git config), no leak across tests sharing withToolRepo/git.test.ts helpers.
4. [CLEAN][demonstrated] Multi-byte UTF-8 octal-escape decoding (3-byte CJK + 4-byte emoji) correct against a real git-plumbed fixture, not just the shipped 2-byte cafe.txt case.
5. [CLEAN][code-traced] No Windows path-separator concern -- decodeGitQuotedPath operates on git's internal forward-slash-separated path strings only; all new tests green on this win32 checkout.
6. [CLEAN][code-traced] No other lsTree() caller (history-scan.ts, allowlist-tool.ts's ALLOWLIST_PATH lookup) shares the #238 bug; fix is narrowly and correctly scoped.
7. [CLEAN][code-traced] CHANGELOG's shell-safety claim (no C-quoted path ever produces a runnable HASH-COMMAND line) verified true against SHELL_SAFE's regex.
8. [CLEAN][code-traced] Whole ADR catalog (37, both domains + docs/adr) checked against this diff's changed files -- no collision outside app-security-reviewer's THOTH-ADR-0002 slice; devops ADRs not applicable (no IaC/CI touched); SE ADR-0005/0010 satisfied (tests/typecheck/lint green).
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=2 suspicions=0 clean=6
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=1 code-traced=7 derived=0
checks=typecheck:PASS lint:PASS git.test.ts:15/15 allowlist-tool.test.ts:16/16 full-suite:1049/1049/0skip oss:secret-scan:0-blocking(2038-allowlisted)
adr=HIT(37, whole catalog)
report=docs/reviews/s1-238-unlock-command-cquote-cross-domain-2026-09-21.md
