# Red Team (Sutekh): s338-340-allow-redirect-reject (V4 allow-redirect load-time reject)

- Date: 2026-09-30
- Tier: CRITICAL (policy delivery / config surface; allow-widening control)
- Diff under attack: `52dc49e^..4d39cef` on `s7/closeout` (52dc49e red tests, 5ddd9f3 fix, 4d39cef CHANGELOG)
- Files: `src/policy/config/rule-reachability.ts`, `src/policy/config/rule-reachability.test.ts`, `src/policy/normalizer/tool-class-format.ts`, `CHANGELOG.md`
- Tree: every run used a separate detached worktree `C:/playground/thoth-rt338` at `4d39cef`, with `node_modules` and `adr/` junction-linked read-only. All mutants went into that worktree and were reverted after each run. The main tree was touched only to self-persist this report and the REVIEW_LOG row.
- ADR: `📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog — ≈18300 tokens saved this pass (fp 13c1476) [CACHE=HIT]`. Rules read: SE ADR-0021 (kernel purity, single kernel artifact, fail-closed), SE ADR-0005 (no weakening of failing tests; replaced locked tests), SE ADR-0006 (blast radius).

## Verdict: GO

V4's predicate matches the kernel's real matcher for every target and verb spelling I tried. It is enforced on every layer through the single load path the gate uses, and the instrument kills 8 of 9 targeted mutants, plus a normalizer-vocabulary mutant, through R2-19. One LOW issue: R2-24's candidate targets reuse V4's own `startsWith("mcp/")` assumption, so the test cannot see a change to the kernel matcher's semantics. The fix is one line and was checked here. One LOW suspicion: central-layer migration exposure can't be measured in the repo and belongs in the #308 activation runbook.

## Attack surface: what the kernel actually matches

- `src/policy/kernel/kernel.ts:133-138` `matchesTarget`: an absent or empty `targets` matches anything. Otherwise `pattern.endsWith("/") ? t.startsWith(pattern) : t === pattern`. The comparison is byte-exact and case-sensitive, with no globs and no normalization.
- `kernel.ts:127-131` `matchesVerb`: an absent or empty `verbs` matches anything. Otherwise it needs an exact shared verb.
- A class record always has the form `mcp/<server>/<tool>` with one marker verb (`tool-class.ts:65-72`). Shell and cluster records carry only `resolveVerb` output (KNOWN_VERBS) or the constant `write` (`shell.ts:356`, `shell.ts:393-396`, `structured-cluster.ts:45`). R2-19 enforces that emitted verbs are a subset of KNOWN_VERBS.
- Loader: `parseLayerText` (`loader.ts:134-165`) runs `checkRuleReachability` on each layer, and the whole load fails on the first failing layer. The gate hook reaches rules only through `loadEffectivePolicy` (`hooks/pretooluse-kernel-gate.mjs:181`). `bootstrap-ruleset.ts:54` holds `rules: []`. No other path feeds rules to the kernel.

Consequence: a rule pattern can match a record target under `mcp/` only when the pattern itself starts with `mcp/`, or when it has no targets (row 83(a), kept loading on purpose). An allow rule whose verbs are non-empty and contain no KNOWN verb can't share a verb with any non-class record. V4's predicate is therefore the exact complement.

## Attacks, ranked by exposure x irreversibility x silence

### 1. [ISSUE][LOW][demonstrated] R2-24's soundness oracle shares V4's prefix assumption, so it misses a change to kernel matcher semantics

- **Scenario:** a future story makes `matchesTarget` case-insensitive or path-normalizing. The plausible trigger is Windows, where `> SRC/x` writes the same file as `src/x`. After that change, `allow [write] on "MCP/srv/"` loads, because V4 is byte-exact `startsWith("mcp/")`, and the kernel then matches the shell redirect record `mcp/srv/x`. That brings back the exact widening #338/#340 closed, and V4 says nothing.
- **Current defence:** R2-24 claims the kernel is authoritative. But `candidateAllowRules` builds its target set only from `MCP_TARGET_PREFIX`, `V4_TARGETS`, emitted `mcp/` targets and their directory prefixes. All of them start with `mcp/`, so the oracle never offers a spelling the kernel might newly match.
- **Evidence (M10, run in the worktree):** `kernel.ts:137` was mutated to compare `toLowerCase()` on both sides.

```text
--- M10 kernel case-insensitive: reachability pair
tests 31  pass 31  fail 0  skipped 0
--- M10 full suite
tests 1699  pass 1698  fail 1  skipped 0
x R4: a fresh LOCAL clone of the real project repo ... (37318ms)   <- fails identically on the UNMUTATED baseline in this worktree (see checks), unrelated
```

Adding 5 non-prefix spellings to the candidate set (`"MCP/", "Mcp/standin-x/", "./mcp/", "/mcp/", " mcp/"`) catches the mutant, and the test stays green on the real kernel:

```text
--- extended R2-24 + M10 kernel mutant
tests 1  pass 0  fail 1  skipped 0
--- extended R2-24, real kernel
R2-24: 805 real redirect records (35 distinct mcp targets); 2016 candidate allow rules: 1488 rejected, 528 load; 172 rejected candidates the kernel allows a real redirect record under; 0 unsound; 72 marker-only candidates on mcp targets load and match no redirect record
tests 1  pass 1  fail 0  skipped 0
```

- **Exposure:** ~0% of policy loads today. Basis: measured. The kernel is byte-exact, and the attack-3 probe found 0 of 132 spelling rules that load and match an `mcp/` record. The exposure appears only if the kernel changes. Silence would be high if it did, and there is no current irreversibility.
- **Minimal fix and failing test:** `R2-24 candidate targets include non-prefix spellings (kills a case-insensitive kernel matcher mutant)`. Add the 5-spelling loop to `candidateAllowRules`. It is red today only under M10, so the actual deliverable is a mutant-kill assertion: a comparator self-test with an injected case-insensitive matcher.

### 2. [SUSPICION][LOW][derived] Central-layer migration: an existing out-of-repo allow on an MCP target now fails the whole load

- **Scenario:** the HKLM central value (`central-source.ts:124`, `REGISTRY_KEY_PATH`) already holds an allow with target `mcp/github/` and no verbs. That is the natural way to write "allow this server". After merge, the central layer is `schema-invalid` and the whole load fails. Once #308 wires the gate, every governed call is refused with `policy load failed: layer central, kind schema-invalid; fail-closed` (`decide-tool-call.ts:86`). The gate line carries no Unlock text; that is tracked as #308 X-11.
- **Current defence:** this is a human ruling ("reject at load, fail closed"), and the Manager ruled to keep whole-load rejection (`rule-reachability.ts:71-78`). It is disclosed in the CHANGELOG migration bullet and in `tool-class-format.ts` fact 3. The committed layers hold 0 rules (R2-10). The gate is not active yet. It fails closed, not open, so it is loud and not a widening.
- **Status:** UNPROVEN-pending-verification. The exposure is unmeasurable from the repo.
- **Exposure:** unknown % of machines with a central value. Basis: assumption. Capped at LOW. Recommendation: measure it.
- **Drill that settles it (human, on a machine carrying the central value, before #308 activation):** call `loadEffectivePolicy` from `src/policy/config/loader.ts` with `centralSource: defaultCentralPolicySource` from `src/policy/config/central-source.ts` and the real shipped-defaults and project paths. Print `ok`, or `failedLayer`, `reasonKind` and `message`. Named drill: `AP-9 runbook pre-flight: loadEffectivePolicy against the live central source returns ok before the gate is activated`. Fold it into the #308 AP-9 runbook next to X-12.

### 3. [CLEAN][demonstrated] Target spellings the kernel might treat as MCP but V4 might miss

Probe (scratchpad `probe.mjs`, real `checkRuleReachability`, real `decide`, real shell and tool-class normalizers). The spellings were `MCP/`, `Mcp/srv/`, `./mcp/`, `./mcp/srv/`, `/mcp/`, leading-space `mcp/`, trailing-space `mcp/`, fullwidth-m `mcp/` (U+FF4D), Cyrillic-er `mcp/` (U+0440), `mcp\`, `mcp\srv\`, `m*p/`, `**/`, `*`, `**`, `mcp*`, `mcp/*`, `{mcp,x}/`, `mcp`, `mcp//`, `mcp/srv/tool` and `mcp/./`. Each was crossed with the verb sets `[write]`, `[WRITE]`, `[write ]`, `[write,write]`, `[marker,Write]` and absent:

```text
class record: ["tool-class:read-only"] ["mcp/srv/tool"]; redirect: ["write"] ["mcp/srv/tool"]
probe: 132 (spelling x verbset) allow rules; 19 rejected by V4; 0 load AND the real kernel allows a record whose target is under mcp/
```

- Every non-`mcp/` spelling that loads matches only a redirect to its own byte-exact spelling (e.g. `MCP/` matches `["MCP/x"]`, and `**/` matches `["**/x"]`). That is the filesystem-path allow that row 83(a) keeps loading.
- The kernel has no glob or brace expansion, so `m*p/`, `**`, `*` and `{mcp,x}/` are literal strings.
- A first probe pass flagged `mcp/srv/tool [marker,Write]` matching the class record. That was a probe error: a marker allow matching a class record is the prescribed shape. The corrected pass counts shell records only.
- Case-variant paths on case-insensitive filesystems are a path-canonicalization question for deny rules. That problem existed before this diff and is outside V4's scope.

### 4. [CLEAN][demonstrated] Verb spellings and normalizer-vocabulary drift

- Case, whitespace, duplicates, a marker plus a case-variant, and unknown verbs all load under V4 only when no KNOWN verb is present. They can't match a non-class record, because those records carry only KNOWN verbs (probe above: 0 leaks).
- The load-bearing half is "emitted verbs are a subset of KNOWN_VERBS". Mutant M9 (the plain-redirect record at `shell.ts:356` emits `["append"]`) is killed:

```text
M9 normalizer emits non-catalog verb 'append' for plain redirects: tests=31 pass=26 fail=5 skipped=0 -> KILLED ["R2-13","R2-6","R2-17","R2-19","R2-24"]
    FULL SUITE tests=1699 pass=1684 fail=15 skipped=0
```

### 5. [CLEAN][demonstrated] Mutating V4 itself

```text
M1 some->every on catalog verbs: tests=31 pass=28 fail=3 skipped=0 -> KILLED ["R2-12","R2-22","R2-24"]
M2 drop empty-verbs branch: tests=31 pass=28 fail=3 skipped=0 -> KILLED ["R2-17","R2-22","R2-24"]
M3 exempt bare mcp/ prefix: tests=31 pass=27 fail=4 skipped=0 -> KILLED ["R2-17","R2-22","R2-22b","R2-24"]
M4 V4 applies to deny too: tests=31 pass=23 fail=8 skipped=0 -> KILLED ["R2-5","R2-13","R2-4","R2-12","R2-6","R2-7","R2-17","R2-23"]
M5 V4 only on targets[0]: tests=31 pass=30 fail=1 skipped=0 -> KILLED ["R2-22b"]
M6 V4 uses {write} only: tests=31 pass=26 fail=5 skipped=0 -> KILLED ["R2-12","R2-8","R2-17","R2-22","R2-24"]
M7 V4 needs mcp/ + lowercase letter: tests=31 pass=25 fail=6 skipped=0 -> KILLED ["R2-12","R2-6","R2-17","R2-22","R2-22b","R2-24"]
M8 corpus shrunk to one segment: tests=31 pass=31 fail=0 skipped=0 -> SURVIVED (see attack 8)
```

M6 is worth noting. Only `write` actually widens (R2-17 part 1), so R2-24's soundness half alone would pass a write-only V4. Its precision half and R2-22 catch it.

### 6. [CLEAN][demonstrated] Multi-target rules that mix a path and an MCP target

V4 checks each target element (`rule-reachability.ts:204-211`). One MCP target rejects the whole rule, and the path elements report nothing. R2-22b pins the field indices `["rules[0].targets[1]","rules[0].targets[3]"]`, and M5 (only `targets[0]` checked) is killed.

### 7. [CLEAN][demonstrated] Does R2-24 use the real kernel and the real normalizer?

It imports `decide` from `../kernel/kernel.ts` and `normalize` from `../normalizer/registry.ts` with the shell normalizer registered. The extended-candidate run under M10 went red, which shows the comparator calls the live `kernel.ts`. Its vacuity guards hold: 172 rejected candidates the kernel allows under, and the mutant-predicate self-test catches 86/86/172.

### 8. [CLEAN][demonstrated] Is the R2-24 redirect corpus complete?

- It is hand-built, not generated. `mcp-redirect-commands.ts` gives 7 segments x 5 remainders x 2 operators = 70 commands, plus R2-24's verb-first shapes. Everything goes through the real normalizer, giving 805 records.
- Mutant M8 shrinks the segments to `["srv"]`. It survived (31/31 pass).
- That survival is expected and is not a gap. Soundness doesn't rest on corpus breadth. It rests on (a) verb disjointness, pinned by R2-19 and killed by M9, and (b) the byte-exact kernel matcher (attack 1). The corpus only supplies non-vacuity, and a single segment still does that.
- The test claims soundness over its candidates, not corpus completeness, so the no-hand-derived-completeness rule is not breached.

### 9. [CLEAN][code-traced] Replaced locked tests carry REPLACEMENT headers, and nothing else was weakened

- The headers are at `rule-reachability.test.ts:214` (R2-12), `:333` (R2-6 loop) and `:518` (R2-17 part 3), each citing SE ADR-0005 and the 2026-09-30 decisions rows.
- Every changed cell is stricter:
  - R2-12 `allow` column: false -> true, meaning it now rejects.
  - R2-17p3: `expectLoads` -> `expectRejects`, with an added one-error and field check.
  - R2-6: the allow loop must now observe a rejection on the 70 redirect-into-`mcp/` records. It stays strict, and still asserts `allowRejectedByV4 > 0`, on the other 101.
- The `deny` columns and the non-catalog rows are unchanged. `git diff --stat` shows no other test file touched.

### 10. [CLEAN][demonstrated] A central-layer rejection fails the whole load, with a layer-aware Unlock

`loader.ts:190-205` returns `ok:false, failedLayer:"central", reasonKind:"schema-invalid"` before shipped or project are read. R2-22 ran 648 real loads (9 targets x 24 verb shapes x 3 layers) and checked `failedLayer`, the rule id, the field path, and the Unlock wording: the central owner, "cannot repair", and no "edit". For file layers it checks for `edit <path>`. All green. The gate refuses fail-closed (`decide-tool-call.ts:86`). The gate-side Unlock wording is #308 X-11 and was already ruled out of scope.

### 11. [CLEAN][code-traced] Every path that feeds rules to the kernel passes V4

A grep for `validateRuleSet|mergeLayers|loadEffectivePolicy|checkRuleReachability` outside tests finds only the loader chain, the printer, and `hooks/pretooluse-kernel-gate.mjs:181` (which goes through `loadEffectivePolicy`). `precedence.ts` passes rules through unchanged, and `bootstrap-ruleset.ts:54` has no rules. A mixed-layer bypass isn't possible, because V4 runs on each layer before the merge.

## Open findings and failing tests

- Open findings: 2. Failing tests: 1 executable, plus 1 drill.
- Attack 1: `R2-24 candidate targets include non-prefix spellings (kills a case-insensitive kernel matcher mutant)`. It can only be red under a kernel mutant, so its executable form is a comparator self-test with an injected case-insensitive matcher.
- Attack 2: no in-repo executable form, because the central source is an out-of-repo HKLM value. Its form is the AP-9 pre-flight drill above, which a human runs on a machine carrying the central value.

## Scariest unproven assumption

V4 is correct only as long as `kernel.ts:137` stays byte-exact. Nothing in the 1699-test suite pins that, and a case-insensitive matcher passes every test today.

## Go / no-go: GO

No HIGH or MED findings. **Next action:** add the 5-spelling loop to `candidateAllowRules`, plus a self-test that R2-24 catches a case-insensitive matcher, as a commit on this same branch. Then fold the central pre-flight into #308's AP-9 runbook.

## Editorial (verdict-neutral, plain edits)

- `rule-reachability.test.ts:13` header still says "Three checks". Lines 27-28 still say "NOT rejected (documented): legacy mutating verbs plus an MCP target ... disclosed residual" without the DENY-only qualifier. R2-25 scans only the two production files, so it doesn't catch this.
- The R2-12 test title ("loads unless ... (ii) an allow effect with no verbs") no longer describes the allow column: catalog-verb allows are rejected now as well.

## Checks run (raw)

- Baseline pair `node --test src/policy/config/rule-reachability.test.ts src/policy/config/loader-reachability.test.ts`: `tests 31 pass 31 fail 0 cancelled 0 skipped 0 todo 0`.
- Baseline full suite in the worktree, `node --test`: `tests 1699 pass 1698 fail 1 skipped 0 cancelled 0 todo 0`.
  - The one failure is `R4: a fresh LOCAL clone of the real project repo ... (37744ms)`.
  - It fails identically on the unmutated tree under full-suite load, and passes in isolation (`node --test src/secret-scan/pre-commit-scan.test.ts`: `tests 26 pass 26 fail 0 skipped 0`).
  - It is a worktree-environment failure that this diff doesn't touch. It is worth confirming on the main tree during `/maat:verify`.
- Mutants: M1-M7 and M9 killed, M8 survived (explained in attack 8), M10 survived the full suite (finding 1). Extended R2-24: red under M10 (0/1), green on the real kernel (1/1).
- Spelling probe: 132 rules, 19 rejected, 0 leaks.
- `npx tsc --noEmit -p tsconfig.json`: exit 0. `npx eslint` on the 3 changed source and test files: exit 0.

RECEIPT: verdict=go
attacks:
1. [ISSUE][LOW][demonstrated] R2-24's candidate targets all start with mcp/, so a case-insensitive kernel matcher mutant passes the full suite (1698/1699, R4 pre-existing) and would re-open the widening silently; a 5-spelling extension kills it and stays green; Exposure: ~0% of loads today, basis: measured
2. [SUSPICION][LOW][derived] out-of-repo HKLM central value with a no-verb or catalog-verb allow on mcp/ now fails the whole load, so every call is refused once #308 activates; ruled, disclosed, fails closed; UNPROVEN-pending AP-9 pre-flight drill; Exposure: unknown, basis: assumption
3. [CLEAN][demonstrated] target spellings (case, ./, /, whitespace, fullwidth, Cyrillic, backslash, globs, braces, **, *, mcp*): 132 rules, 0 load and match an mcp/ record; the kernel is byte-exact, no globs
4. [CLEAN][demonstrated] verb spellings (case, whitespace, dupes, marker+variant, unknown) cannot match a non-class record; emitted-verb drift mutant M9 killed by R2-19/R2-6/R2-24
5. [CLEAN][demonstrated] V4 mutants M1-M7 (every/some, empty branch, bare prefix, deny, targets[0], write-only, lowercase-prefix) all killed
6. [CLEAN][demonstrated] multi-target path+mcp rules are rejected per element at the right index (R2-22b; M5 killed)
7. [CLEAN][demonstrated] R2-24 exercises the real kernel.ts and the real shell normalizer (red under the kernel mutant with extended candidates)
8. [CLEAN][demonstrated] R2-24 corpus is hand-built (70 cmds -> 805 records); M8 shrink survives because soundness rests on verb disjointness plus the byte-exact kernel, not corpus breadth; no completeness claim made
9. [CLEAN][code-traced] R2-12, R2-6 loop and R2-17p3 carry REPLACEMENT headers (test.ts:214/:333/:518); every changed cell is stricter; no other test touched
10. [CLEAN][demonstrated] central-layer reject fails the whole load (failedLayer central, schema-invalid, central-owner Unlock, no "edit"); R2-22 648 loads green; gate refuses fail-closed
11. [CLEAN][code-traced] single rule path: the gate hook uses loadEffectivePolicy (pretooluse-kernel-gate.mjs:181), V4 runs on each layer before merge, bootstrap rules []
counts: issues=1 suspicions=1 clean=9
evidence: demonstrated=8 code-traced=2 derived=1
checks=pair 31/0/0 (pass/fail/skip); full 1698/1/0 (R4 pre-existing, also fails on unmutated baseline; 26/0/0 isolated); mutants 8 killed / 2 survived (M8 explained, M10 = finding 1); probe 132 rules 0 leaks; tsc exit 0; eslint exit 0
adr=HIT(37)
report=docs/reviews/s338-340-allow-redirect-reject-red-team-2026-09-30.md
