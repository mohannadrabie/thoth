# Story #409: seal the git/rg exec levers (S7, #308 K blocker)

Date: 2026-10-05. Author: story-implementer (Ptah), Phase 1 (plan only; nothing built, nothing committed). Branch context: `s7/knockout`, shared working dir (E0 builds in `src/policy/normalizer/*`; this plan touches no tracked file).

Inputs read: Issue #409 (body + the kubectl comment), E0 design challenge attack A1, refreshed E0 plan (2026-10-05), Manager ruling 2 (last decisions rows), K proposal (`docs/plans/s308-K-proposed-entry-2026-10-05.md`), J8 live evidence (`docs/qa/s308-live-spikes-J/README.md`), `src/qa/protected-path-list.ts`, `src/policy/config/activation-preconditions.test.ts` (F5).

ADR gate: `node docs/adr-cache.mjs --ensure` printed `ADR cache HIT: reused 38 ADR(s) ... [CACHE=HIT]`. Applicable: THOTH-ADR-0003 (accepted; the protected-list and fixture write-path claim, entry-only exemption of 2026-09-19 -- this story edits the list's generator, which is code, not an entry, so it needs a fresh dated report) and THOTH-ADR-0001 (central classification entries; not touched). The other 36 ADRs: not applicable to a protected-list/test/preflight change (no IaC, no API, no schema). No ADR is UNCLEAR.

## 1. Restatement

#409 is closable when it is shown, by executed tests, that (a) the session cannot set a git/rg exec-lever environment key through any settings `env` block, and (b) the session cannot write the config files those levers read, and (c) planted-before-activation config is detected by a read-only preflight and disclosed. git and rg stay unresolved (POL-05 denies) throughout: re-adding them to the resolved set is a separate later data story that must cite this story's seal as its precondition.

## 2. What the evidence already says (measured, not assumed)

- J8: `GIT_EXTERNAL_DIFF` and `RIPGREP_CONFIG_PATH` set in a PROJECT settings `env` block reach both a plain hook process and the command shell. The gate cannot stop or see them (the launcher runs the gate under `env -i`, so the gate never sees the block; the shell does). User-scope was not run and is treated as reachable. Local scope not run separately; same mechanism, treated as reachable.
- Therefore the A1 proof-test as worded ("prove a settings env block cannot set the keys") is FALSE as a runtime property and cannot be proven live. The true, provable property is upstream: the SESSION cannot author the settings env block (a settings write), and the three settings files are already in F's protected list (`.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json`; `namedPaths` in `src/qa/protected-path-list.ts`), each with a generated deny rule and (at K) an `Edit(...)` deny (F5 `F5-ap10-paths-edit-deny`, generic over `PATHS.all`).
- So (a) reduces to: settings-file write protection holds for these three, plus a statement of what is outside the session's write reach (managed settings, ambient OS env, shell profile files) as disclosed residual with a preflight check.
- F's protected list does NOT cover any of the (b) files today. Present list: the import-closure of the hook, the fixture, shipped rules, `.thoth/policy.json`, `hooks/launch-gate.sh`, `src/qa/gate-launcher-pin-check.ts`, the three settings files, `.thoth/halt-state/`. Not present: `.git/config`, `.git/hooks/`, `.gitattributes`, `.git/info/attributes`, `~/.gitconfig`, `~/.config/git/config`, `~/.config/git/attributes`, system gitconfig, any rg config file.

## 3. Lever inventory (the claim "this is the set" must come from an instrument)

CLAUDE.md forbids a hand-typed completeness claim. The inventory is therefore a default-deny rule plus a generated cross-check, not a prose list:

- Rule (data, `src/qa/exec-lever-env.ts`, new): key matches `^GIT_` (every one, no inert allowlist in this story), or `^RIPGREP_`, or is in a named set: `PAGER`, `EDITOR`, `VISUAL`, `LESS`, `LESSOPEN`, `LESSSECURE`, `SSH_ASKPASS`, `SSH_AUTH_SOCK`, `HOME`, `USERPROFILE`, `XDG_CONFIG_HOME`, `PROGRAMDATA` (each moves or feeds a config location or helper). Named required members, each asserted by its own test row: `GIT_EXTERNAL_DIFF`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>`, `GIT_CONFIG_VALUE_<n>`, `GIT_CONFIG_PARAMETERS`, `GIT_PAGER`, `PAGER`, `GIT_DIR`, `GIT_WORK_TREE`, `GIT_SSH`, `GIT_SSH_COMMAND`, `GIT_ASKPASS`, `GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`, `GIT_EXEC_PATH`, `GIT_TEMPLATE_DIR`, `GIT_PROXY_COMMAND`, `GIT_TRACE*` (a write lever: `GIT_TRACE=<path>` appends to a file), `GIT_ATTR_SOURCE`, `GIT_CEILING_DIRECTORIES`, `RIPGREP_CONFIG_PATH`. Found beyond the issue's list: `GIT_EXEC_PATH`, `GIT_TEMPLATE_DIR`, `GIT_PROXY_COMMAND`, `GIT_SSH`, `GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`, `GIT_TRACE*`, `HOME`/`USERPROFILE`/`XDG_CONFIG_HOME` (relocate `~/.gitconfig` and `~/.config/git`), `LESSOPEN` (pager preprocessor).
- Instrument: a test runs `git help -m git` (ENVIRONMENT section) when git is installed, extracts every `GIT_[A-Z0-9_]+` token, and asserts each matches the rule (any token the rule misses fails, listing it). Skipped-not-passed if git absent is NOT acceptable: the test reads a vendored snapshot `docs/qa/git-env-vars-snapshot.txt` (generated by `npm run qa:git-env-snapshot`, checked by drift test), so it runs everywhere.
- The kubectl comment on #409 (kubeconfig `exec` plugin, `--kubeconfig`, `--server`, `--token`) is the same class on a different binary. It belongs to E0/#408 flag vocabulary (E0 narrows kubectl to `--context` only, F10). Out of scope here; the env analogue (`KUBECONFIG`, `~/.kube/config`) is asked about in Q5.

## 4. Scope that makes #409 closable without re-adding git/rg

IN scope (this story):
1. Extend the protected list (generator data in `namedPaths`) with the (b) files, so deny rules and the K `Edit(...)` entries are generated, not hand-kept.
2. A lever-key module (section 3) and a settings-scan check: for each settings scope file in the repo (project, local, plus the user file when present in the test's isolated HOME fixture), a parsed `env` block containing any lever key is reported. This is the preflight's detector and the regression test's oracle.
3. A read-only preflight command `qa:git-rg-lever-preflight` (see section 7) for pre-planted state.
4. Pins that git/rg remain unresolved, so the seal is not mistaken for an allowance: `RO-git-family-unresolved`, `RO-rg-family-unresolved` (E0 builds these) must stay green; this story adds `S409-git-rg-not-in-resolved-set` (reads the normalizer's table and fails if `git` or `rg` appears) with a mutant that adds them.
5. A written precondition for the later re-add data story: `S409-precondition` checklist in the plan doc and a test that fails if the preflight reports any lever in the repo/user scopes (the re-add story must run it green).

OUT of scope (each named, filed or routed):
- Re-adding git or rg to the resolved set (later data story; the Manager decides whether rg is ever re-added: `--pre`/`--search-zip` via RIPGREP_CONFIG_PATH is the sharper exec lever and E0's A1 offers "drop rg preprocessing" as an alternative to sealing).
- Shell profile files (`~/.bashrc`, `~/.profile`, `~/.zshrc`, `~/.bash_profile`): a session write there sets env for the NEXT session's shell snapshot. Same class as #428 (session-writable user dirs). Route to #428's story; not closed here. Disclosed.
- Managed settings and OS-level/ambient env: not session-writable; checked by the preflight only (read), not sealed.
- Gate-side runtime detection of lever keys (launcher reads its own env before `env -i` and passes a taint flag): rejected for this story (section 6).

Closure statement proposed for the Issue: "levers sealed up to the session write boundary, executed tests; git/rg stay unresolved; residuals R1-R4 disclosed; re-add story carries the precondition."

## 5. Acceptance criteria, each mapped to a named failing-first test

Tests are authored first, failing against HEAD, before any code (findings arrive as failing tests). All live in `src/qa/git-rg-lever-seal.test.ts` (new) unless stated.

| # | Criterion | Failing-first test (and why it fails today) |
|---|---|---|
| 1 | The protected list contains every git config/attribute/hook path the levers read: `.git/config`, `.git/hooks/`, `.gitattributes`, `.git/info/attributes`, `~/.gitconfig`, `~/.config/git/config`, `~/.config/git/attributes` | `S409-protected-list-covers-git-config-paths`: asserts each is in `protectedPaths(REPO_ROOT).all`. Fails: none present. |
| 2 | Each new path has a generated deny rule and a proposed `Edit(...)` deny entry (no hand-kept list) | `S409-new-paths-have-deny-and-edit-deny`: for each criterion-1 path, a rule from `buildDenyRules` exists and `missingEditDenies(proposedSettings, [path])` is empty; plus a dropped-entry mutant that must fail. Also existing F5 stays green (proposal regenerated). Fails until the proposal JSON `docs/plans/s308-K-proposed-settings-2026-10-04.json` is regenerated. |
| 3 | Real hook DENIES a write to each criterion-1 path by each write form F already tests (redirect, `tee`, `cp`, `mv`, `sed -i`, `git config --local core.fsmonitor x`, `git config --global`, `git -c ... config`) | `S409-hook-denies-writes-to-git-config`: runs the real gate (same harness as the F bypass corpus) for the cross product; all DENY, no marker file written. `git config` rows are DENY already because git is unresolved (POL-05); the test pins that the denial is for the right reason (deny rule id or unresolved), so it cannot silently turn into an allow when git is re-added. Fails today for the path-rule rows (no rule exists). |
| 4 | The three settings files are protected, so the session cannot author an `env` block at any of project, local, user scope | `S409-settings-env-unwritable`: for each of the three, the same write-form cross product, DENY. Mostly green today (F); it is the A1 reframe of `J-env-block-runtime-keys-block`. Documented as "the provable form of the A1 key test". Fails (day 1) on any form F's corpus missed; if all green it is recorded as a pin, with the mutant `S409-mutant-drop-settings-local-from-list` going red. |
| 5 | The lever-key rule covers every named required key and every `GIT_*` token in the vendored git env snapshot | `S409-lever-keys-cover-git-env-snapshot` and `S409-lever-keys-named-members` (one row per key in section 3). Fails: module does not exist. |
| 6 | A settings `env` block carrying any lever key, at any scope file, is detected | `S409-settings-env-scan-detects-levers`: fixtures with `GIT_EXTERNAL_DIFF`, `RIPGREP_CONFIG_PATH`, `GIT_CONFIG_COUNT`, `HOME` in project/local/user fixtures; each detected, scope named. Negative control: an `env` block with only `FOO` is clean. Fails: scanner absent. |
| 7 | git and rg stay out of the resolved set; the seal does not re-add them | `S409-git-rg-not-in-resolved-set` + mutant `S409-mutant-add-git-to-table`. Depends on E0's table existing (lands with E0; if E0 has not merged when this is built, the test is written against the same table export E0 defines and this story rebases onto E0). |
| 8 | Preflight reports pre-planted state: git config keys that execute (`core.fsmonitor`, `core.hooksPath`, `core.pager`, `core.sshCommand`, `core.editor`, `diff.*.textconv`, `diff.external`, `filter.*.clean/smudge/process`, `credential.helper`, `include.path`/`includeIf`), non-sample files in `.git/hooks/`, `.gitattributes` `diff=`/`filter=` selectors, set lever keys in the process env, a set `RIPGREP_CONFIG_PATH` and the contents flags `--pre`/`--search-zip`/`-z` of the file it names | `S409-preflight-detects-planted-config` over a temp repo + temp HOME fixture, one planted lever per row, each reported with file and key; clean fixture reports none. Fails: preflight absent. |
| 9 | Preflight is read-only by construction | `S409-preflight-is-read-only`: runs with every fs write function stubbed to throw, and the fixture tree hash is unchanged afterward; it never spawns `git` (reads files directly, since running `git` is itself the exec lever); a mutant that calls `spawnSync("git",...)` fails (grep over the AST for child_process use, as F3 does for imports). |
| 10 | The re-add precondition is machine-checkable | `S409-precondition-preflight-clean`: fails if `qa:git-rg-lever-preflight` on the repo reports any finding in repo scope or settings scopes. Wired into `npm run qa:*` so the later re-add story inherits it. |
| 11 | Residuals are disclosed, not claimed closed | `S409-residuals-listed`: the plan/doc and the Issue-closure text contain R1-R4 verbatim keys (reference-resolver / doc test, same style as `adr0003-write-path-claim`). Cheap, and guards the "no hand-derived completeness claim" rule. |

Completeness claims in the deliverable (the "all lever keys" and "all protected git paths") are produced by criteria 1/5 tests, never typed.

## 6. Design and rejected alternatives

Chosen: seal by write-protection (extend the generated protected list), plus a default-deny lever-key rule, plus a read-only preflight, with git/rg left unresolved. Reason: it reuses F's generator, deny-rule and `Edit(...)` machinery (one list drives both), adds no gate code, no launcher change (the launcher is hash-pinned, F1b), and keeps the exec boundary where #398/#406 already put it ("closed by settings protection, not by the launcher").

Rejected:
- **Gate-side runtime env check** (launcher inspects its own env before `env -i`, passes a taint flag; gate denies git/rg-class when a lever key is set). Detects ambient and managed-scope env that write protection cannot. Rejected here: edits the pinned launcher and the guard (CRITICAL churn, new pin, new red-team round) to protect a call that is denied anyway while git/rg are unresolved. It is the right defense-in-depth to revisit in the re-add data story; recorded as Q3.
- **Scrub env in the gate for the shell** (cannot: the gate does not own the shell's env; the runtime spawns it).
- **Prove the key test live per scope** (J8 harness again, user scope): paid, and its likely result is "reaches", which is already measured. The testable property is the write boundary, not the reach.
- **Drop rg and git from scope forever and close #409 as wontfix-by-removal**: closes today's risk but leaves the later re-add with no precondition; the issue explicitly wants the seal as the re-add gate.
- **Allowlist of inert GIT_* keys**: an inert-list is a hand-derived claim that rots when git adds variables; default-deny on the `GIT_` prefix is safe by construction.
- **Protect `.gitattributes` at every depth via a glob**: depends on whether deny-rule paths support globs (Q4). Attributes alone cannot name a command (drivers are defined in config), so the repo-root file plus `.git/info/attributes` is enough for the seal when config is sealed; subdirectory attribute files only matter with pre-planted config drivers, which the preflight reports.

## 7. Pre-existing config planted before activation: disclosure and how story G checks it

This is not preventable by a write-protect list (already on disk). It is disclosed and detected:
- Disclosure item for the human at K: "Any `.git/config`, `~/.gitconfig`, system gitconfig, hook file or rg config present BEFORE activation is outside the seal."
- Detection: `npm run qa:git-rg-lever-preflight` (new, read-only, criteria 8-9) scans repo `.git/config` (+ `include.path` targets), `.git/hooks/*` non-`.sample`, root `.gitattributes`, `~/.gitconfig`, `~/.config/git/*`, the Windows system file `%PROGRAMDATA%\Git\config` and `<git-install>\etc\gitconfig` (on Windows, `ProgramData` is typically user-writable: disclosed), the process env (lever keys), the four settings scopes' `env` blocks, and the file named by `RIPGREP_CONFIG_PATH`. Output: a list of findings, exit 0 clean / 1 findings. It never runs git or rg.
- Story G (runbook plus read-only preflight, TRIVIAL): add one step "run `qa:git-rg-lever-preflight`, record output in the runbook evidence; any finding blocks K and the re-add story until the human clears it". G3 today only covers the HKLM policy load; this adds a sibling row G3b. G is a docs/preflight story, so the runbook text is G's; this story supplies the command.

## 8. Residuals (disclosed; R-keys pinned by criterion 11)

- R1: shell profile files (`~/.bashrc` etc.) are session-writable and feed the next session's shell env snapshot; routed to #428's story.
- R2: managed settings and OS/ambient env are not session-writable and not sealed; the preflight reads them.
- R3: pre-existing config (section 7).
- R4: user-scope `env` reach is unproven live (J8 did not run it; treated as reachable); the seal protects `~/.claude/settings.json` regardless, so the answer does not change the plan.
- Adjacent, not #409: `PATH` hijack is #428; kubectl `--kubeconfig/--server/--token` is E0/#408 flag vocabulary.

## 9. Files to touch (no tracked file touched by this planning pass)

- `src/qa/protected-path-list.ts` (edit `namedPaths` and any `MUST_EXIST`: none of the new paths must exist). Sensitive: this IS the protected list.
- `docs/plans/s308-K-proposed-settings-2026-10-04.json` (regenerate; F5 compares it to generator output) and its generator script if separate.
- `src/qa/exec-lever-env.ts` (new): the key rule.
- `src/qa/git-rg-lever-preflight.ts` (new) and an `npm run qa:git-rg-lever-preflight` entry in `package.json`; `qa:git-env-snapshot` entry; `docs/qa/git-env-vars-snapshot.txt` (generated).
- `src/qa/git-rg-lever-seal.test.ts` (new): all criteria tests and mutants.
- `docs/reviews/` fresh dated reports (required by the hard rule for the list change).
- `CHANGELOG.md`, `docs/STATE.md` (append-point care per branch discipline).
- Not touched: `hooks/*`, `scripts/guard/*`, `src/policy/guard/*`, the launcher, `src/policy/normalizer/*` (E0's), `.claude/settings.json`.
- A comment on #409 (and one on #408) recording the hand-off and the closure scope, per Issue Discipline (comments, not body edits).

## 10. Sensitive areas and tier

- Sensitive areas touched: policy delivery / config surface and guard-adjacent (the protected list that generates deny rules), secret-scanning CI gate adjacency (new `qa:*` script wired into CI). Reviewers needed: `app-security-reviewer` (authz/write-boundary), `architecture-reviewer` (A1 asked for the read-surface shape; whether the seal-by-protection model is the admissible topology), `cross-domain-reviewer` (always), `red-team` (CRITICAL).
- Proposed tier: **CRITICAL**: it edits the generator of the deny rules that fence the enforcement point, and its purpose is closing a code-execution-past-the-gate class; the Manager ratifies.
- Test-first dispatch check: this plan identifies NO new or changed UI flow or API surface (internal qa generator, tests, a read-only CLI preflight, docs). `test-writer` is NOT dispatched; the implementer's own failing-first tests (section 5) stand, and Phase 2 may start straight from plan approval. If the Manager rules the preflight CLI an "externally observable surface", dispatch `test-writer` for criteria 8-9 only.

## 11. Verification plan

Run, with real counts: `npm run build`, typecheck, lint, the new test file, the F suite (`activation-preconditions.test.ts`), `qa:git-rg-lever-preflight` on the repo, QA-14 in CI diff mode (`reference-resolver.ts origin/master HEAD`, per memory), full suite with the known R4 EBUSY (#231) noted separately. Rollout: protected-list addition is inert until K wires the deny rules (gate unwired today); rollback is a revert of the list edit (the preflight and tests are additive). Sequencing: independent of E0's code except criterion 7 (needs E0's table); can be built in parallel on a separate commit set but touches no E0 file, and rebases onto E0 before merge. Branch: same session branch per branch discipline (one PR per story set).

## 12. Blocking questions (human away; Manager decides; recommended answers)

1. **Is closure-by-seal-up-to-the-session-write-boundary (R1-R4 disclosed) acceptable for #409, with git/rg unresolved?** Recommend YES. The reach is measured; the unmeasurable ambient surface is disclosed and checked by preflight.
2. **Include `HOME`/`USERPROFILE`/`XDG_CONFIG_HOME`/`PAGER`/`LESSOPEN` in the lever rule?** Recommend YES (they relocate or feed config); cost is only a wider preflight report.
3. **Gate-side runtime lever-key taint (launcher change)?** Recommend NO now, YES to be scoped into the git/rg re-add data story (it needs a launcher pin change and a red-team round, and protects nothing while git/rg are denied).
4. **Do deny-rule paths support globs, so `**/.gitattributes` can be listed?** Unknown; the builder checks `buildDenyRules`/`ruleIdFor` first. Recommend: if not supported, list the repo-root file only and rely on the preflight for subdirectory files (attributes cannot name a command without config).
5. **Handle the kubectl kubeconfig analogue (`KUBECONFIG`, `~/.kube/config`) here?** Recommend NO: route to E0/#408 flag vocabulary as the red-team comment says, and add `KUBECONFIG` and `~/.kube/config` to this story's lever rule and preflight only (read-side detection, a 2-line addition) if the Manager wants it; protected-write for `~/.kube/config` would be a separate decision because it could break legitimate operator use.
6. **Dispatch `test-writer`?** Recommend NO (section 10).

Single next action after approval: write the failing tests of section 5 criteria 1, 5, 6, 8 first, commit them red, then build.

RECEIPT: verdict=PLAN-READY criteria="11 mapped/11 total" checks="0/0/0" adr=HIT(2) pr=n/a
