# Red team (Sutekh) — s7c-reachability-residuals, 2026-09-27

Scope: branch `feat/s7c-reachability-residuals`, HEAD `6637833`, diff `git diff 1aba7df HEAD` (Issues 334 and 335). Tier CRITICAL (policy delivery and config surface). Worktree: `C:\playground\thoth\.claude\worktrees\agent-a9d0403b5902cbc17`.

ADR state: `node docs/adr-cache.mjs --ensure` printed `ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 2095e13) [CACHE=HIT]` after `git submodule update --init`. Attack-surface slice read: SE ADR-0005 (testing), SE ADR-0021 (kernel, Action record, open normalizer registry / POL-12), SE ADR-0010, SE ADR-0006, THOTH-ADR-0001.

Verdict: **go**, with two MED and two LOW findings, none of which blocks. The dominant risk this story carries — a false rejection on the central layer denying every governed call — was attacked directly and SURVIVED.

## What I ran

```
node --test src/policy/config/rule-reachability.test.ts
  tests 16  pass 16  fail 0  skipped 0
node --test src/policy/config/rule-reachability.test.ts src/policy/config/loader-reachability.test.ts
  tests 24  pass 24  fail 0  skipped 0   (mutation baseline)
npm test
  tests 1496  pass 1496  fail 0  skipped 0  todo 0
npm run typecheck   -> clean
npm run qa:reference-resolver  -> PASS: 8 citation(s), all resolved (after submodule init)
npm run qa:completeness-claims -> PASS: 2 file(s) checked
```

Plus one throwaway probe (`sutekh-probe.ts`, deleted; not committed) driving the REAL loader, the REAL shell / cluster / tool-class normalizers and the REAL kernel over a corpus I built independently of the corpus the shipped tests use.

```
[corpus] records=532 distinctTargets=41 failV2V3=29
[corpus] emittedVerbs=["create","delete","describe","execute","get","list","modify","move","read","rename","write"]
[corpus] emitted verbs outside catalog+markers=[]
[A] rejectedRules=3596 classOnlyBranchRejectionsThatARealRecordMatches=0 allowWideningBranchRejectionsThatARealRecordMatches=58
[B] allow rules that LOAD and still return allow for a real shell record under a deny baseline: 29
[B] examples: allow verbs [write] targets "mcp/servers.json" | allow verbs [write] targets "mcp/servers.json/" | allow verbs [write] targets "mcp/servers.json/tool"
[C] fourth-normalizer record verbs=["fetch"] targets=["mcp/one_server"]
[C] rule [marker, fetch] + that target: rejectedByCheck=true realKernelMatchesThatRecord=true
```

## Exposure basis (measured, used by every finding below)

- `src/policy/config/shipped-defaults.json` rules = 0; `.thoth/policy.json` rules = 0 (counted by a script at HEAD).
- `.claude/settings.json` carries no `hooks.PreToolUse` entry for the kernel gate (line 39 records its removal; `src/policy/config/printer.ts:34` states the same). Nothing enforces from this policy today.
- So every finding here is `Exposure: ~0% of governed calls today, basis: measured`, and becomes material at activation (Issue 308).

## Findings, ranked by blast radius

### 1. [ISSUE][MED][demonstrated] The allow-widening guard is bypassed by naming one catalog verb

Attack: I am a rule author (or a compromised central policy source) who wants an allow that reaches a real shell-emitted record under the MCP target namespace. Issue 335 now rejects `allow` with no verbs on such a target. I add `verbs: ["write"]` instead.

Scenario: a central rule `allow, verbs ["write"], targets ["mcp/servers.json"]`. It loads clean on every layer, and under a deny baseline the real kernel returns allow for a real shell redirect record whose target is that path. Over my corpus this held for 29 of 29 emitted targets that fail V2 or V3, on the write verb (probe B above).

Current defense, assessed honestly: the behavior is RULED, not accidental — `docs/decisions.md` 2026-09-27 item (a) says an allow rule with a verb a normalizer emits, including the write verb, stays loadable, and `R2-17 part 3` pins it as a ruled edge. `R2-17 part 1` even measures that write is the one widening verb. So the code matches the records. What does not hold is the guard PURPOSE: the module header calls the rejection a safety rule against silent allow widening, while the same widening remains one keystroke away, and the header lists the surviving shape under NOT rejected, on purpose as one that merely "matches only shell-emitted records and never a class record" (`src/policy/config/rule-reachability.ts:45-50`) — for an ALLOW effect, matching a shell-emitted record IS the widening the paragraph above it (lines 29-35) describes. Unlike the two sibling residuals (Issues 338 and 329), this one is routed to no Issue and to no Issue 308 precondition.

Verdict: **BREAKS** (the stated purpose of the Issue 335 guard, not the ruling behind it).

Exposure: ~0% of governed calls today, basis: measured (zero committed rules, gate unwired). At activation the surface is every allow rule an author may write on a target under the MCP prefix.

Named proof test required before activation (not before merge): `R2-22 allow-with-a-catalog-verb-on-an-unpresentable-target-widens` — through the real loader and the real kernel, assert the current behavior explicitly as a pinned, disclosed residual (or reject it). Note the cost: rejecting it means changing `R2-17 part 3`, which currently asserts the opposite.

### 2. [ISSUE][MED][demonstrated] The drift instrument that makes the whole check sound is blind to a fourth normalizer (already filed as Issue 339)

Attack: the soundness of the class-only branch rests on one claim — every verb any normalizer emits is in `KNOWN_VERBS`. I add a normalizer, which SE ADR-0021 says MUST be possible by declaration alone (POL-12), and watch the guard not notice.

Scenario (run): I registered a fourth normalizer emitting the verb `fetch` on target `mcp/one_server`. The check REJECTS `deny, verbs [marker, "fetch"], targets ["mcp/one_server"]` while the real kernel MATCHES that rule against that record — an unsound rejection, which on the central layer fails the whole load and denies every governed call. Raw output is probe C above.

Current defense, assessed honestly: `R2-19` imports exactly three normalizers by name (`src/policy/config/rule-reachability.test.ts:39-41`) and builds its corpus from them; `src/policy/normalizer/registry.ts` exports `registerNormalizer`, `resolveNormalizer` and `normalize` and no enumeration, so no instrument in the tree can see a fourth registrant. The module header (`src/policy/config/rule-reachability.ts:38-41`) nevertheless claims a normalizer that someday emits a new verb fails a test instead of silently making this check unsound. That claim is not backed.

Verdict: **BREAKS** (the drift guard, on the extension path the architecture blesses).

Exposure: ~0% of governed calls today, basis: measured. Trigger requires a future normalizer; this is a latent, silent failure, which is why it ranks second rather than lower.

Duplicate check: `gh issue list --search reachability` returned Issue 339, filed by `cross-domain-reviewer` finding 1 with the same diagnosis and the named test `R2-21 emitted-verbs-drift-covers-every-registrant`. I filed nothing new and commented my demonstrated proof on 339 instead.

### 3. [ISSUE][LOW][demonstrated] The allow-widening rejection names an unlock that changes the rule meaning, and never names the one that works

Attack: PRINCIPLES rule 2 — every block names its unlock. I take the blocked author literally.

Scenario (run): for `allow, no verbs, targets ["mcp/servers.json"]` the loader message ends:

```
Unlock: edit the project policy file: add a class marker verb (one of tool-class:read-only, tool-class:workspace-mutating, tool-class:remote-mutating) and write "mcp/servers.json/" for every tool of the server, or "mcp/servers.json/<tool>" for one tool
```

`"mcp/servers.json"` is a plausible real repository path, not only a mistyped server name. An author whose intent is allow writes to that FILE is told to add a class marker verb (which makes the rule match classified MCP tool calls, not files) and to rewrite the target as a server prefix (which changes which paths it covers). The fix that actually preserves the intent — naming the verbs, for example `verbs: ["write"]` — is the one thing the message does not mention, and it is finding 1.

Current defense: `R2-17 part 2` asserts the unlock names the marker fix and the trailing slash; nothing asserts the unlock is achievable for a path-shaped target. Verdict: **BREAKS** (rule 2), narrowly.

Exposure: ~0% of governed calls today, basis: measured. Named proof test: `R2-24 allow-widening-unlock-names-a-reachable-fix`.

### 4. [ISSUE][LOW][demonstrated] One mutant survives: the per-element diagnostic set is unpinned

Mutation: guard the V3 branch with the V2 outcome, `src/policy/config/rule-reachability.ts:148` becomes `if (slash >= 0 && !ADMISSIBLE_SERVER_NAME.test(server)) {`. A target that fails both (a server name with no slash AND a name the runtime never presents, for example `mcp/standin_x`) then reports one error instead of two.

```
node --test src/policy/config/rule-reachability.test.ts src/policy/config/loader-reachability.test.ts
  tests 24  pass 24  fail 0     <- SURVIVED
```

Blast radius is small: the rule is still rejected, so no verdict changes; only the operator loses half the diagnosis on the exact shape that is hardest to diagnose. Verdict: **BREAKS** (test strength), LOW.

Named proof test: `R2-23 per-element-error-set` — assert the error COUNT and both field paths for a target that fails V2 and V3 together.

### 5. [SUSPICION][LOW][derived] The five recorded mutants are not re-runnable from the repository

The CHANGELOG and `docs/decisions.md` item (f) claim five spot mutants, each killed by named tests; the script "lives outside the repo (scratch), by the same convention S7-B used". A future auditor cannot re-run it. I independently reproduced two of the five and both were killed:

```
subset direction flipped   (line 117 negated)                tests 24  pass 12  fail 12
allow branch on every effect (line 116 effect check dropped)  tests 24  pass 19  fail  5
```

The other three are unverified by me. This is an evidence-durability point, not a correctness one; nothing contradicts the claim. Verdict: **UNPROVEN** for three of five. Settling command, runnable by anyone: apply each recorded mutant with `sed -i` at the cited line and run the two reachability test files (the exact commands I used are in this report).

## What I attacked and could not break

### 6. [CLEAN][demonstrated] False rejection on the class-only branch — the dominant risk — SURVIVES

This is the failure class the S7-B round-2 report found a real instance of, and the one that on the central layer denies every governed call. I rebuilt the corpus independently (532 records: the golden fixture calls, the redirect fixture, and my own grid of six MCP-prefixed redirect targets crossed with every catalog verb and seven command forms including append, stderr redirect, cp and mv), generated 3,596 rejected rules over that corpus (each bad target crossed with markers-only, marker-plus-stray and stray-plus-marker in nine stray spellings, including the empty string, case variants, near misses, trailing and leading whitespace, and a marker with a trailing space) and matched each rejected rule against every record with the real `matchRules`:

```
[A] rejectedRules=3596 classOnlyBranchRejectionsThatARealRecordMatches=0
```

Zero. The reason is structural, not corpus luck: the kernel requires the record verbs to intersect the rule verbs (`src/policy/kernel/kernel.ts:115-118`), only the tool-class normalizer emits a marker (`src/policy/normalizer/tool-class.ts:67`), and a class record target exists only for a server the index admitted, which by construction passes V2 and V3 (`src/policy/normalizer/tool-class.ts:60-64`, `src/policy/normalizer/tool-class-format.ts:148-176`).

### 7. [CLEAN][demonstrated] No drift today between KNOWN_VERBS and what the normalizers really emit

Over my own 532-record corpus the distinct emitted verb set is exactly the eleven catalog verbs, and the set outside catalog plus markers is empty (probe output above). Code trace agrees: `src/policy/normalizer/shell.ts:393,396` take `resolveVerb` output plus the literal write, `src/policy/normalizer/structured-cluster.ts:45` takes `resolveVerb` output, `src/policy/normalizer/tool-class.ts:67` emits one marker. `resolveVerb` lowercases and gates on the catalog (`src/policy/normalizer/action-catalog.ts:42-45`), so the exact-case comparison in `targetScope` cannot wrongly classify an emitted verb as a stray. The only gap is the FUTURE one, finding 2.

### 8. [CLEAN][demonstrated] The new tests are kill-capable

Seven mutants of my own, none of them the five recorded ones, six killed:

```
A  first-verb-only catalog membership   (line 117)  pass 22  fail 2   KILLED
B  case-insensitive catalog membership  (line 117)  pass 21  fail 3   KILLED
C  collapse marker-and-stray into markers-only (119) pass 23 fail 1  KILLED
D  drop the bare-prefix guard            (line 137)  pass 22  fail 2   KILLED
E  drop the marker fix clause            (line 131)  pass 23  fail 1   KILLED
F  drop the marker-required condition    (line 118)  pass 23  fail 1   KILLED
G  suppress V3 when V2 fired             (line 148)  pass 24  fail 0   SURVIVED (finding 4)
```

Every mutation was applied with `sed -i` and reverted with `git checkout --` before the next; `git status --short` is clean at the end of this report.

### 9. [CLEAN][code-traced] The schema closes the non-string and third-effect vectors

`src/policy/rule/schema.ts:185-193`: `effect` must be exactly allow or deny, and verbs, targets and environments must be string arrays. `targetScope` therefore cannot be handed a non-string verb, a numeric effect or a third effect value; the `rule.effect === "allow"` test has no silent third branch.

### 10. [CLEAN][code-traced] The central-layer availability cost is disclosed accurately

`src/policy/config/loader.ts:194-204` returns on the first failing layer, so a rejected central rule fails the WHOLE load and the project layer goes with it. The module header (lines 52-59), `docs/decisions.md` item (h) and the CHANGELOG all state this in those terms, including that a session cannot repair a central source. I found no gap between the claim and the code. `R2-16 part 1` and `R2-17 part 2` prove the layer attribution and the layer-aware unlock on all three layers through the real loader.

### 11. [CLEAN][demonstrated] Record-integrity gates pass

QA-14 reference resolver PASS (8 of 8 citations) once the ADR submodule is initialized; QA-15 completeness-claim checker PASS. Before `git submodule update --init` the resolver fails on the ADR-0021 citation in `src/policy/normalizer/tool-class-format.ts` — that is a missing submodule, not a defect in this diff, but it is worth knowing that this gate is submodule-dependent.

## Editorial (verdict-neutral, plain edits, no re-review)

- `src/policy/config/rule-reachability.test.ts:4-6` lists what S7-C adds and extends but omits the `R2-6` extension (whole-record allow rules, lines 320-331), which the CHANGELOG does list.
- `src/policy/config/rule-reachability.ts:45-50` describes shape c as one that "matches only shell-emitted records"; for an allow effect that phrasing understates it (finding 1). One clause would fix it.

## One praised decision

Making `R2-17 part 1` a measuring instrument rather than an assertion — it reports which verbs actually widen instead of asserting a number someone typed — is what let me find finding 1 in minutes instead of arguing about it. It also made the story honest against itself.

## Open findings and failing tests

Open findings: 4 (findings 1, 2, 3, 4). Named failing tests: 4 (`R2-22`, `R2-21` on Issue 339, `R2-24`, `R2-23`). The suspicion (finding 5) carries a settling command rather than a test, because re-running someone elses deleted scratch script is a verification act, not a behavior to pin.

## Scariest unproven assumption, go/no-go, next action

Scariest unproven assumption: that `KNOWN_VERBS` is and stays the emitted-verb universe. Everything the class-only branch rejects is sound only because of it, the architecture explicitly invites a fourth normalizer to arrive without touching any shared file, and the instrument that claims to guard it cannot see one (finding 2 / Issue 339).

Go / no-go: **go**. No HIGH. Both MED findings are latent at zero measured exposure, one is already filed and owned, and the dominant false-rejection risk survived 3,596 adversarial rules against 532 real records.
Single next action: add Issues 340 (filed this turn) and 339 to Issue 308 activation preconditions — neither should reach a wired gate unresolved.
Single next action: file the finding-1 Issue against Milestone S7 and add it, with Issue 339, to Issue 308 activation preconditions — neither should reach a wired gate unresolved.
Issues filed this turn: 340 (finding 1, bug + severity:med + pol, Milestone S7). Finding 2 is already Issue 339 (cross-domain-reviewer finding 1) and received my demonstrated proof as a comment rather than a duplicate. Findings 3 and 4 are LOW and spawn no Issue.

---

RECEIPT: verdict=go
attacks (all, ranked by blast radius):
1. [ISSUE][MED][demonstrated] Allow-widening guard bypassed by naming a catalog verb: allow + verbs [write] on the same unpresentable MCP target Issue 335 rejects loads clean and the real kernel returns allow for a real shell redirect (29 of 29 emitted bad targets); ruled and pinned by R2-17 part 3, but routed to no Issue and framed as benign in the header. Exposure: ~0% of governed calls today, basis: measured.
2. [ISSUE][MED][demonstrated] R2-19 drives three hard-coded normalizers while SE ADR-0021 POL-12 keeps the registry open; a fourth normalizer emitting a non-catalog verb makes the check falsely reject a rule the real kernel matches, suite green (already Issue 339, commented not duplicated). Exposure: ~0% today, basis: measured.
3. [ISSUE][LOW][demonstrated] The allow-widening unlock tells a path-shaped author to add a class marker verb and rewrite the target, changing the rule meaning, and never names the working fix (PRINCIPLES rule 2).
4. [ISSUE][LOW][demonstrated] Surviving mutant: suppressing V3 when V2 already fired leaves all 24 reachability tests green; the per-element diagnostic set is unpinned.
5. [SUSPICION][LOW][derived] The five recorded mutants live in a deleted scratch script; I reproduced two (killed), three unverified.
6. [CLEAN][demonstrated] False rejection on the class-only branch (the dominant risk): 3,596 rejected rules vs 532 independently built records, zero matchable rejections.
7. [CLEAN][demonstrated] No KNOWN_VERBS drift today: emitted verb set is exactly the eleven catalog verbs, zero outside catalog plus markers.
8. [CLEAN][demonstrated] New tests kill-capable: six of seven of my own mutants killed.
9. [CLEAN][code-traced] Schema closes non-string verbs and any third effect value before targetScope sees them.
10. [CLEAN][code-traced] Central whole-load rejection and its deny-everything cost are disclosed accurately in header, decisions row and CHANGELOG.
11. [CLEAN][demonstrated] QA-14 (8 of 8 citations) and QA-15 pass.
counts: issues=4 suspicions=1 clean=6
evidence: demonstrated=8 code-traced=2 derived=1
checks=npm test 1496 pass / 0 fail / 0 skipped; typecheck clean; reachability pair 24 pass / 0 fail (baseline) and 7 mutants run; qa:reference-resolver 8 of 8; qa:completeness-claims PASS
adr=HIT(37)
report=docs/reviews/s7c-reachability-residuals-red-team-2026-09-27.md

## Addendum (Manager, same session, before this branch was ever pushed — original evidence unaltered in substance; human approved this specific edit in real time)

Line 82's standalone backtick citation `` `mcp/servers.json` `` was quoted as `` `"mcp/servers.json"` `` (inner quote marks added, nothing else) so QA-14's `reference-resolver` no longer parses it as a bare repo-relative path citation (it flagged `unresolved-authority: mcp/servers.json — path does not exist in this repository`, since this string is a hypothetical example target used in an attack scenario, not a real path). This is a precedent already used once in this project (the S7 kernel-gate-classification close-out, two path-shaped mentions in the app-security and cross-domain reports). No number, verdict, finding, or scenario value changed; the three other occurrences of the same string elsewhere in this report (lines 31, 48, 76, each inside a larger backtick span that does not match the resolver's bare-path pattern) were left as written. Tracked generally as a QA-14 precision gap (adversarial-report example paths that read as real repo paths): Issue #341.
