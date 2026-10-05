# Design challenge — #308 story E0 (Issue #408): closed read-only shell command set

Date: 2026-10-04. Agent: design-challenger (Apep). Branch `s308/activation-3`. Round 1 of this artifact.
Target: `docs/plans/s308-E0-readonly-shell-plan-2026-10-04.md`. Code read at HEAD `217b4c4`.
`📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog (fp 702b16a) [CACHE=HIT]`

## Framing (what can and cannot gate this round)

E0's matcher (`readonly-catalog.ts`, the `shell.ts` call site) **does not exist yet** — this is a pre-build
attack on a plan. Every attack on E0's own future code is therefore `derived` and caps at MED (PRINCIPLES rule 19).
What I *can* anchor is (a) the CURRENT shell normalizer / kernel behavior E0 inherits (code-traced / demonstrated
through the real hook), and (b) the plan's own safety *claims* against the real `rule-reachability.ts` / `kernel.ts`
code (code-traced). The gate is **not wired** (K held; `.claude/settings.json` has no PreToolUse entry — confirmed
in STATE and the hook header). So no finding has a `reach=user` entry point and **no HIGH is possible**, exactly as
the story-D challenge concluded. Live exposure is 0%. Verdict is therefore **go**, with the MED findings routed to
day-1 failing proof-tests (equivalent to "conditional").

Probe harness: `node hooks/pretooluse-kernel-gate.mjs` fed real PreToolUse/Bash JSON on a detached worktree of
HEAD in the scratchpad (removed after). Read-only; no tracked file touched, no state-changing git.

## Attacks, ranked by blast radius

### A1 — "read" commands that execute arbitrary code via config/env helpers (git, rg)  [ISSUE] [MED] BREAKS

- **Attack:** E0 resolves `git status|log|diff|show` and `rg` to verb `read`. But these binaries execute
  user-controlled helper programs driven by *config and environment*, not by any command-line flag E0 can refuse:
  `git status` runs `core.fsmonitor`; `git diff` / `git log -p` / `git show -p` run `diff.<driver>.textconv` and
  `[diff] external`; `core.hooksPath` / `core.pager` (config, not the `-p` flag E0 blocks) and
  `GIT_EXTERNAL_DIFF` / `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` all redirect execution; `rg` reads
  `$RIPGREP_CONFIG_PATH`, whose file can carry `--pre=<cmd>` or `--search-zip` — the exact flags E0's rg list
  refuses on the command line.
- **Scenario:** the environment (a settings `env` block, or ambient env, or a pre-existing `~/.gitconfig` /
  `.git/config` set before activation) carries `[diff] external = <cmd>` or `RIPGREP_CONFIG_PATH=<file with --pre>`.
  The agent runs `git diff` or `rg foo`. E0 records a clean read → allow. `<cmd>` executes. The gate logs nothing
  mutating.
- **Current defense, honestly assessed:** the plan DISCLOSES fsmonitor/textconv/ext-diff as a residual and routes a
  mitigation to story F (add `.git/config`, `.git/hooks/`, `.gitattributes` to the protected-WRITE list). That
  mitigation is **necessary but not sufficient**: it does not cover (1) global/system config (`~/.gitconfig`,
  `/etc/gitconfig`, `GIT_CONFIG_GLOBAL`), (2) config/attributes already present before the gate was wired, (3)
  `rg`'s `RIPGREP_CONFIG_PATH` (undisclosed entirely), (4) env-var levers, which depend on the unresolved
  env-forwarding question story D left open. The command-line env-prefix forms (`GIT_EXTERNAL_DIFF=x git diff`,
  B-11/B-15) ARE caught — but only because token 1 is an assignment; an *ambient* env variable is invisible to E0.
- **Exposure:** `unbounded` once wired (any `git`/`rg` invocation in an environment with one planted lever), basis:
  reasoned from documented git/rg semantics; 0% live today (unwired). The git half is partly the plan's own
  disclosed residual; the rg `RIPGREP_CONFIG_PATH` half and the global/ambient-config half are new.
- **Tags:** severity MED / evidence derived / reach operator (needs a planted config or forwarded env var; no wired
  user entry point today) / likelihood plausible / undo irreversible (code already ran). Boundary-crossing
  (arbitrary code execution past the gate) → routes to a proof-test, never the residual register.
- **Verdict: BREAKS** (the design's claim "git/rg = read" is false in the presence of a documented, config-driven
  exec lever). E0 cannot turn the defence green on its own — it cannot see ambient config/env.
- **Proof-tests / routing:**
  - `RO-rg-config-env-exec`: with `RIPGREP_CONFIG_PATH` pointing at a file containing `--pre`, an allowed `rg p`
    must not reach execution — provable only by either dropping rg's content-preprocessing surface or by the
    env-forwarding seal below.
  - Extend story D/J's `J-env-block-runtime-keys-block` to the keys `GIT_EXTERNAL_DIFF`, `GIT_CONFIG_GLOBAL`,
    `GIT_CONFIG_SYSTEM`, `GIT_CONFIG_COUNT/KEY/VALUE`, `GIT_PAGER`, `RIPGREP_CONFIG_PATH` — prove a settings `env`
    block cannot set them in the shell that executes the allowed command.
  - **Route the read-surface shape to `architecture-reviewer` (PRINCIPLES rule 15):** whether `git diff|show`,
    `git log -p`, and rg's preprocessing surface are admissible at all under a config-driven-exec threat model is a
    scope/topology question, not a flag-list tweak. The Q1 alternative (status+log only) narrows but does not close
    it (`status` still runs fsmonitor; `log -p` still runs textconv). I do not prescribe the mechanism.

### A2 — Q2(b) lifts the multi-target cap on a false safety claim ("V4 rejects target-only allows")  [ISSUE] [MED] BREAKS

- **Attack:** Q2(b) permanently lifts the normalizer-level multi-target cap (shell.ts:388-391, Issue #82) for
  read records up to 8 targets. The plan justifies this with "V4 rejects target-only allows." That is **false for
  filesystem-path targets.** `rule-reachability.ts` V4 (`checkAllowRedirect`, lines 185-196) fires ONLY when the
  target `startsWith(MCP_TARGET_PREFIX)` — and its own fix text explicitly offers "**or a filesystem path target**"
  as a legitimate correction. A read-ALLOW rule scoped to a filesystem path passes V4 cleanly.
- **Scenario:** a future (or F-era) read-allow rule `{effect:"allow", verbs:["read"], targets:["docs/"]}`. With the
  cap lifted, `cat docs/ok.md /etc/shadow` → one read record with 2 targets. `kernel.ts` `matchesTarget` (line 133)
  ORs with `.some()`: the rule matches on `docs/ok.md` and authorizes the WHOLE record, including the read of
  `/etc/shadow`. This is Issue #82's exact cross-target-bundling exposure, reopened for reads, with the normalizer
  guard that closed it removed.
- **Current defense:** the #82 cap at shell.ts:388 (code-traced). Q2(b) removes it for reads. Today E ships a
  verb-only read allow (matches everything, so no bundling *advantage* exists yet) — which is why this is latent,
  not live. The trap springs silently the day any target-scoped read rule lands.
- **Exposure:** latent / 0% today (no target-scoped read-allow exists); basis: counted in code (V4's MCP-only guard,
  kernel's `.some()`).
- **Tags:** severity MED / evidence code-traced (the V4 overclaim is demonstrably false; the exploit is latent) /
  reach instrument (needs a future rule; no wired path today) / likelihood plausible / undo reversible.
  Boundary-crossing (cross-target authorization) → proof-test.
- **Verdict: BREAKS** (the plan's stated justification for (b) is false).
- **Proof-test:** `RO-multitarget-read-no-bundling` — a target-scoped read-ALLOW on a filesystem path plus a
  2-target read record must NOT authorize the unlisted target. Green under Q2(a) (keep the cap); must be made green
  before Q2(b) ships. My recommendation: **Q2(a)** unless that test proves (b) safe.

### A3 — target string identity: "paths as written" (crit 2) vs "raw span" (crit 7)  [SUSPICION] [MED] UNPROVEN

- **Attack:** criterion 2 records targets as "operand paths as written"; criterion 7 says E0 reads the **raw span**
  to screen for expansion chars (because the tokenizer loses quote info). The plan never states which string becomes
  the record target — the dequoted value or the raw span. They differ for `cat a"b"c` (dequoted `abc`, raw
  `a"b"c`) and `cat '.thoth/policy.json'` (dequoted `.thoth/policy.json`, raw `'.thoth/policy.json'`).
- **Scenario:** if targets are recorded raw, a later read-deny or an F-style path rule comparing against a canonical
  path is bypassed by quoting; if recorded dequoted, the raw-span expansion-screen and the recorded target disagree
  about what the operand *is*. E0 ships no read-deny today, so it is harmless now — but it bakes a target shape that
  F's canonicalizer must also cover for reads, and **nobody owns read-target canonicalization** (F's Q2-A helper is
  scoped to redirect-write targets).
- **Exposure:** latent; basis: derived from the two criteria.
- **Tags:** severity MED / evidence derived / reach instrument / likelihood plausible / undo reversible. Caps at MED.
- **Verdict: UNPROVEN.** Proof-test: `RO-target-canonical-form-pinned` — pin the exact recorded target string for
  `cat "a"b`, `cat './x'`, and assert it is the form a future path rule will compare against (decide
  dequoted-and-canonical, and make crit-7 screen the same string).

### A4 — grep/rg PATTERN operand vs the criterion-7 metachar screen  [SUSPICION] [MED] UNPROVEN

- **Attack:** criterion 7 refuses any operand containing `[ ] * ? $ ( )` etc. A legitimate grep/rg *pattern* is a
  regex that routinely contains exactly those (`grep '[0-9]' f`, `rg 'foo.*bar' f`). The plan does not say whether
  the pattern slot is subject to crit-7. Either resolution is a defect: (a) pattern IS screened → the headline
  "grep works" refuses almost every real regex (usability cliff, fail-safe); (b) pattern is EXEMPT → the raw-span
  safety the plan leans on is dropped for the one slot most likely to carry metacharacters, and an unquoted
  `grep * f` / `grep $x f` would need the generic syntax checks alone to stop it.
- **Current defense:** live `$(`/backtick/`<(` in a pattern are caught by `collectSyntaxUnresolved` before E0 (so
  command substitution in a pattern cannot leak through either way) — demonstrated the current gate denies those
  shapes. The residual risk is non-substitution metachars and plain globs.
- **Exposure:** usability-bounded; basis derived.
- **Tags:** severity MED / evidence derived / reach instrument (usability + a small safety ambiguity) / likelihood
  routine / undo reversible. Caps at MED.
- **Verdict: UNPROVEN.** Proof-test: `RO-grep-pattern-metachar-decision` — pin, per command, whether the pattern
  slot is crit-7-screened, with at least `grep '[0-9]' f` (accept-or-reject, stated), `grep * f` (reject), and
  `rg 'a.*b' f` (accept-or-reject, stated).

### A5 — redirect-write to an unlisted path is ALLOWED at activation (defaultOutcome=allow)  [CLEAN for E0] (demonstrated; routed to activation posture)

- **Demonstrated through the real hook:** `rm -rf src > /dev/null`, `python -c "..." > /dev/null`,
  `node -e "...execSync('whoami')" > out.txt` all return **ALLOW(silent)** today. The normalizer records them as a
  single-target WRITE to the redirect target (`/dev/null`, `out.txt`); the dangerous verb (`rm`, `python -c`) is
  invisible, and with `defaultOutcome=allow` (bootstrap default; shipped-defaults declares none) and no deny rule
  on those paths, the kernel allows.
- **Assessment:** this is **pre-existing S4 behavior, not an E0 change.** E0's criterion 4 correctly pins it
  "unchanged." But it means the activation narrative "reads free, writes protected" is **false for redirect-writes
  to any path F does not list** — F is a redirect-write seal on *protected* paths only (EFJ plan line 38). E0 is
  CLEAN here (no regression), but the Manager/architecture should not let E0's "read freely" framing obscure that
  `cmd > unlisted-path` is allowed post-activation under the allow default.
- **Verdict: SURVIVES** for E0; flagged to the activation posture / F / architecture.

### A6 — binary identity (path, case, `.exe`, `.cmd`, Windows)  [CLEAN] SURVIVES

- Criterion 5 requires a bare lowercase table word, and the plan explicitly bans `normalizeToolToken` (which strips
  path + lowercases) for the binary decision. So `./cat`, `/usr/bin/cat`, `CAT`, `cat.exe`, `cat.cmd`, `c""at`,
  `\cat` all fail the equality and fall through to `unresolved` → deny (fail-closed). Corpus B-01/B-20 covers it.
  SURVIVES. Residual (disclosed by the plan): a PATH-earlier shim / shell alias / function literally named `cat` is
  invisible to any static parse — same irreducible limit as every static classifier; reasonable to disclose.

### A7 — chain / substitution / redirect / heredoc / env-prefix / wrappers pre-empt E0  [CLEAN] SURVIVES

- `collectSyntaxUnresolved` + wrapper detection + the directory-flag check all run BEFORE E0's insertion point
  (code-traced, shell.ts:415-443). Demonstrated: `sh evil.sh 2>/dev/null` → deny (wrapper shape-mismatch);
  `ls; rm` / `ls && rm` / `ls | sh` / `ls $(rm x)` / newline / `&` are all already `unresolved` before any E0 branch
  could run. The plan inserts E0 after all of it and claims only whole simple commands with no redirect — structurally
  correct. B-02..B-12, B-19 corpus pins it. SURVIVES provided mutant `RO-mutant-claim-before-syntax-check` is real.

### A8 — tail -f / cat /dev/zero hang against the 60 s hook timeout  [CLEAN] SURVIVES

- E0 is a pure string matcher with no I/O (plan §7, §10). It classifies `tail -f`/`cat /dev/zero`; it does not
  execute them. The 60 s timeout bounds the hook's *classification*, which is linear string work — the eventual
  hang is in the user's own terminal after allow, not a gate fail-open. The plan refuses `tail -f`/`-F`/`--follow`
  anyway (B-17). The prompt's "DoS against the 60 s timeout" does not reach the gate. SURVIVES. (B-22's 100 KB /
  10k-token work-meter pin remains correctly required for the matcher's own linearity.)

## Q1–Q5 — my view

- **Q1 (git scope).** NO to shipping `diff`/`show`/`log -p` and rg's preprocessing surface as written until A1's
  env-forwarding seal is a green test. The write-protect-`.git/config` mitigation is necessary-not-sufficient
  (global/system/ambient config + `RIPGREP_CONFIG_PATH` uncovered). The alternative (status+log only) narrows but
  does not close (fsmonitor on status, textconv via config on `log -p`). Route the admissible-read-surface shape to
  `architecture-reviewer`; I do not prescribe it.
- **Q2 (multi-target reads).** Prefer **(a) keep the cap.** (b) only if `RO-multitarget-read-no-bundling` is green;
  the plan's "V4 rejects target-only allows" justification is false for filesystem-path targets (A2, code-traced).
- **Q3 (nested `bash -c '<read>'`).** Prefer **force-unresolved for any wrapper in E0** in v1 — one guard, and it
  removes the deferred-read-via-wrapper authorization question entirely. The recursion would otherwise hand the
  kernel a `deferred:true` read record that `pol05Rule` does not special-case (it ignores `deferred`), so
  `bash -c 'cat secret'` would allow. Pin whichever is chosen; the corpus `bash -c "ls; rm x"` must stay denied.
- **Q4 (cross-story).** File the backlog items. **Elevate** "read-deny for secrets" above plain backlog: once wired,
  "read freely" + resolved targets makes `cat ~/.aws/credentials` / `cat .env` an ALLOW with a concrete target — a
  real exfiltration surface, and the plan already notes resolved targets make a read-deny expressible. Still out of
  E0 scope, but it should be tracked as a security precondition of activation, not a nicety.
- **Q5 (sequencing).** E0 before E content is fine. Add: E0 must not merge until the A1 env-forwarding proof-test
  (shared with D/J) exists and is green — E0's headline (`git`/`rg` reads) rests on it.

## Frozen set (proven this round, inherited by any later round)

- A6 binary-identity fail-closed; A7 syntax/wrapper pre-emption; A8 no gate-DoS from E0 (pure matcher). These are
  frozen as SURVIVES on NEW evidence only (code or a run), not re-derivation.
- Demonstrated current-gate behavior (anchors, not E0 defects): `ls -la`/`cat README.md`/`git status` deny today
  via POL-05 (kubectl-shaped); `cmd > unlisted-path` allows today under defaultOutcome=allow (A5).

## Residual-risk register

- None accepted to (b): every surviving MED is boundary-crossing and routes to a named proof-test (A1, A2) or a
  decision-pinning test (A3, A4). A5 is routed to the activation posture / architecture, not accepted silently.

## Unrun verifications (owner)

- `RO-rg-config-env-exec`, `J-env-block-runtime-keys-block` extended to GIT_*/RIPGREP_CONFIG_PATH — owner:
  story-implementer (E0 build) + whoever owns J's env-forwarding spike. **Nobody has measured whether the shell that
  executes an allowed command carries these env keys.** Top-line.
- `RO-multitarget-read-no-bundling` (Q2) — owner: E0 build.
- `RO-target-canonical-form-pinned` (A3), `RO-grep-pattern-metachar-decision` (A4) — owner: E0 build.
- The plan's own RED commit (all §5 tests failing first) is unrun — it is the first build task.

## Editorial (uncounted; plain doc fixes, verdict-neutral)

- Plan §8 Q2 asserts "V4 rejects target-only allows" without qualification — true only for MCP-prefix targets; the
  sentence should name that limit (this is the substance of A2, but the sentence as written is also just wrong).
- Plan §3 rg row has a garbled fragment ("... --hidden -uu`-free list: ...") — the allowed-flag list is not
  parseable as written; restate it cleanly.

## Scariest unproven assumption

That the environment in which an allowed `git status|diff|show|log` or `rg` actually executes carries **no
code-execution config lever** — `GIT_EXTERNAL_DIFF`, `GIT_CONFIG_GLOBAL/SYSTEM`, `core.fsmonitor`/`hooksPath`,
`RIPGREP_CONFIG_PATH`. E0 classifies all of these as pure reads. Nobody has measured whether a settings `env` block
or ambient env can turn one of them into arbitrary code execution — the same env-forwarding question story D left
open, now load-bearing for E0's headline feature.

## Verdict: go (conditional — the proof-tests above are day-1 gating)

No calibrated HIGH exists (gate unwired → no `reach=user` entry point; all findings derived or latent). Two MED
BREAKS (A1, A2) and two MED UNPROVEN (A3, A4), all boundary-crossing or decision-pinning, each routed to a named
day-1 failing test; A1's read-surface shape additionally routes to `architecture-reviewer`.

<!-- Appended by the Manager (backstop, PRINCIPLES rule 10): the design-challenger returned this RECEIPT in its hand-back but did not persist it in the report. Text copied verbatim from the hand-back. -->

RECEIPT: verdict=go
attacks (ranked by blast radius):
1. [ISSUE][MED][derived/operator/plausible/irreversible][unbounded once wired; 0% live] git status|log|diff|show and rg classified as read but execute config/env helper code (fsmonitor, textconv, [diff] external, RIPGREP_CONFIG_PATH); plan's write-protect-.git/config mitigation misses global/ambient/pre-planted config and rg's env var — filed #409
2. [ISSUE][MED][code-traced/instrument/plausible/reversible][latent; 0% today] Q2(b) lifts #82 multi-target cap for reads on false "V4 rejects target-only allows"; V4 guards only mcp__ targets, so a future filesystem-scoped read-allow + 2-target record re-opens cross-target bundling via kernel .some() — filed #410
3. [SUSPICION][MED][derived/instrument/plausible/reversible][latent] target string identity unspecified: crit-2 "as written" vs crit-7 "raw span" differ under quoting; no owner for read-target canonicalization — RO-target-canonical-form-pinned
4. [SUSPICION][MED][derived/instrument/routine/reversible][usability-bounded] grep/rg PATTERN vs crit-7 metachar screen: screened cripples real regexes, exempt drops raw-span safety for the pattern slot — RO-grep-pattern-metachar-decision
5. [CLEAN] cmd > unlisted-path ALLOWs today (demonstrated: rm/python/node redirect-writes) under defaultOutcome=allow — pre-existing S4, not E0; flagged to activation posture/F/architecture
6. [CLEAN] binary identity (./cat, CAT, cat.exe, \cat, c""at) fails closed — plan bans normalizeToolToken for the binary decision (code-traced)
7. [CLEAN] chain/substitution/redirect/heredoc/env-prefix/wrappers all pre-empt E0 at shell.ts:415-443 (demonstrated: sh evil.sh, ls;rm, ls|sh, ls $(rm) all deny)
8. [CLEAN] tail -f / cat /dev/zero is no gate-DoS: E0 is a pure no-I/O matcher; the hang is in the user's post-allow shell, and tail -f is refused anyway
counts: issues=2 suspicions=2 clean=4
evidence: demonstrated=0 code-traced=2 derived=6
checks=real-hook probes: 10 Bash commands through node hooks/pretooluse-kernel-gate.mjs (ls/cat/git-status deny via POL-05; rm>/dev/null, python -c >/dev/null, node -e >out.txt all ALLOW-silent; sh evil.sh deny); no repo test suite run (plan-only, E0 code not built)
adr=HIT(38)
report=docs/reviews/s308-E0-readonly-shell-design-challenge-2026-10-04.md
