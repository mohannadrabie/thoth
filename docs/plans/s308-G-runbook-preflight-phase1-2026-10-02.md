# Phase 1 plan: #308 story G (AP-9 runbook, AP-6 row, live pre-flight)

Branch `s308/activation`. Source: `docs/plans/s308-activation-phase0-2026-10-02.md` section G; `docs/decisions.md` rows dated 2026-10-02 (newest: "#308 remainder: story breakdown approved ...").

## 0. Readiness and ADR review

- Readiness: no missing material fact. Build can proceed; blocking questions below are confirmations, not gaps.
- ADR cache: `[CACHE=HIT]`, 37 ADRs read from catalog (line at the end of this file).
- THOTH-ADR-0001 (docs/adr): APPLICABLE only to the fixture path. The runbook mentions the fixture as a reviewed-PR repair target; it does not edit the fixture. No rule violated.
- SE/devops ADRs on docs, IaC, secrets: NOT-APPLICABLE to a doc plus read-only run. The runbook must not embed a registry value or secret; it holds placeholders only.
- UNCLEAR: none.

## 1. Restated story

- Write the AP-9 out-of-session recovery runbook (with X-10, X-12, #309 folded in), record the AP-6 decisions row, and capture a read-only `loadEffectivePolicy` pre-flight against the live HKLM central source as evidence.

## 2. Scope split with the Manager's already-written rows

| Item | Owner | Status |
|---|---|---|
| Q4 / X-6 row | Manager | Written (2026-10-02 "#308 remainder" row). Do not duplicate. G4 is satisfied by it. |
| Q3 / X-11 unlock wording | Story H | Out of G. Runbook must be written so H's central/project/shipped-defaults unlock text can cite it. |
| AP-6 row (criterion 12) | Manager writes; implementer drafts text | In G. |
| AP-9 runbook | Implementer | In G. |
| Pre-flight | Implementer | In G. Rerun owed after E and F (not G's build). |

## 3. Acceptance criteria (named checks)

Derived criteria are marked (D). Phase 0 numbering kept where it exists.

| # | Criterion | Named check |
|---|---|---|
| G1 | `docs/decisions.md` has a row for S5 criterion 12 stating the AP-6 disposition. | `grep -ci "criterion 12" docs/decisions.md` returns >= 1, and the matching row is dated 2026-10-02. |
| G1a (D) | The row says what criterion 12 is and what is decided, copied from the S5 plan, not recalled. | Doc review: row quotes the criterion text from its source plan (see Q1). |
| G2a | Runbook states the out-of-session repair for a central load failure: write a corrected `CentralPolicyJson`, or remove the key. | Doc review against `src/policy/config/loader.ts` failure shapes (table in section 5). |
| G2b | Runbook includes X-12: a schema-valid central typo (rule that loads but never matches, or matches too much) has central blast radius; session cannot repair; central owner acts. | Doc review; cites #333 and `checkRuleReachability` behavior. |
| G2c | Runbook includes the non-English half-provisioned key (X-1, #309): key present, value missing, non-English host denies every gated call until value written or key removed. | Doc review; cites test C12 in `src/policy/config/central-source.test.ts` (QA-14 resolves the path). |
| G2d (D) | Runbook names every `LoadFailure` kind (`json-parse-error`, `schema-invalid`, `read-error`) crossed with `failedLayer` (`central`, `shipped-defaults`, `project`) and gives the repair owner for each. | Generated, not hand-typed: a one-shot script reads the `LoadFailureReasonKind` and `FailedLayerName` unions from `loader.ts` and diffs against the runbook's table row labels (CLAUDE.md completeness-claims rule). Result recorded in the PR. |
| G2e (D) | Every command in the runbook marked human-only (registry write, delete) is never run by this story. | Review: no `reg add` or `reg delete` appears in any recorded transcript; `git diff` of runbook shows them only inside fenced examples with a "human, elevated, out of session" label. |
| G2f | Doc passes reference resolution. | `npm run qa:reference-resolver -- origin/master HEAD` rc=0 (CI diff mode, per memory note). |
| G2g | Completeness claims in the runbook pass. | `npm run qa:completeness-claims` rc=0. |
| G3 | Pre-flight: `loadEffectivePolicy` against live HKLM returns a `LoadResult` with no write; raw output recorded. | Recorded raw output of `npm run policy:print` (rc, stdout) in the PR and in `docs/reviews/` if the Manager wants a dated report; read-only proof in section 6. |
| G3a (D) | Pre-flight output is classified against the runbook table: which row it lands in (absent, present-valid, failure). | One-line reading beside the raw output. |
| G4 | Q4 row exists. | `grep -n "Q4 / X-6" docs/decisions.md` finds the Manager's row; no new Q4 row added. |
| G5 (D) | Working tree gate: CHANGELOG entry, `docs/STATE.md` update, `qa:*` gates unaffected. | `npm run qa:reference-resolver`, `npm run qa:completeness-claims`; full `npm test` unchanged (no code touched). |

## 4. Risk tier

- Proposed: **STANDARD** (decomposition said TRIVIAL; challenged).
- Why not TRIVIAL: the runbook is the AP-9 activation precondition for a fail-closed session gate. A wrong repair instruction (wrong key path, wrong owner, advising a session user to `reg add`) misdirects the exact person locked out. It also instructs writes to an HKLM policy key, which is a security-relevant surface.
- Why not CRITICAL: doc plus read-only run; no code, no policy content, no config change; nothing here alters enforcement.
- The pre-flight alone, and the AP-6 row alone, would be TRIVIAL. If the Manager prefers TRIVIAL, the minimum I would keep is a single cross-domain read of the runbook.

## 5. Runbook design

Location (checked: `docs/` has no `runbooks/` directory and no runbook file; `grep -il runbook docs` hits only backlog, plans, decisions, reviews):

- Proposed path: `docs/runbooks/policy-load-recovery.md`.
- Reason: first runbook in the repo, so a `docs/runbooks/` directory sets the convention; avoids mixing with `docs/qa` (instrument fixtures) and `docs/plans` (dated, per-story).
- Alternative if the Manager wants no new directory: `docs/policy-load-recovery.md`.
- No `docs/` index file exists to update.
- QA-14 reference-resolver scans `docs/` markdown; the new path is covered with no config change (confirm in Phase 2 by running it).

Content outline (tables, no prose essays):

| Section | Content |
|---|---|
| Who this is for | Out-of-session operator with elevation. A gated session cannot repair its own policy. |
| Symptom | Every gated call denies (`policy-load-failure`); stderr/deny text names layer and reason kind. |
| Failure table | One row per kind x layer from the generated enum (G2d): cause, who repairs, how. |
| Central repair | Write a corrected `CentralPolicyJson` REG_SZ (single-line minified JSON) at `HKLM\SOFTWARE\Policies\Thoth`, or delete the value or key. Human, elevated, out of session. Placeholder data only. |
| Verify the repair | `npm run policy:print` (read-only); expect `central-channel status=absent` or `present` and a pin line. |
| X-12 blast radius | A schema-valid central typo loads, so no deny appears at load time: wrong-match rules apply to every session on the machine. Repair is the same write; detection is `policy:print` rules count plus review. |
| Non-English half-provisioned key (#309) | Key exists, value missing: English host resolves absent; non-English host rethrows and denies every call until value written or key removed. |
| Project / shipped-defaults failure | Edit the file through a reviewed PR; not a registry action. |
| What a session must not do | Do not attempt `reg add`; the classifier and the OS ACL refuse it (`central-source.ts` header). |

Constraints:

- Registry write commands appear only as fenced examples labelled human-only. Never executed in this story.
- No real central policy content, no secrets.

## 6. Pre-flight: exact command and read-only proof

Command (from repo root, no arguments, no env changes):

```bash
npm run policy:print
```

- Entry point: `src/policy/config/print-cli.ts` builds the real `defaultCentralPolicySource` and the real shipped-defaults and `.thoth/policy.json` paths, then calls `printEffectivePolicy` -> `loadEffectivePolicy` (the same function the gate hook calls at `hooks/pretooluse-kernel-gate.mjs:181`).
- Read-only by construction:
  - Registry: the only subprocess is `reg.exe` with argv `query HKLM\SOFTWARE\Policies\Thoth /v CentralPolicyJson` (plus, on an unclassified stderr only, a `query` of the parent key). No `add`, `delete`, `import`.
  - Filesystem: `loader.ts` uses `readFileSync` only; `grep` for `writeFileSync|appendFileSync|mkdirSync|"add"|"delete"` across `print-cli.ts`, `printer.ts`, `loader.ts`, `central-source.ts`, `pin.ts` returned no code matches (run during this planning).
  - Output: stdout only.
- Proof recorded in Phase 2: the grep above rerun; `git status --porcelain` before and after identical; `reg query HKLM\SOFTWARE\Policies\Thoth` before and after identical (read-only query).
- Planning-time dry run (read-only, this session; Phase 2 re-records it as the evidence of record):

```text
central-channel status=absent
--- resolved rules (0) ---
pin: sha256:3153014795265683fa9c4e4bd5506ceb4e7f159184497f42ab130c535be320b8 channel=(absent) computedAt=2026-10-02T20:26:40.203Z
posture: allow (source: bootstrap; no layer declared a posture)
NOTE: ... not wired into .claude/settings.json ...
rc=0
```

- Reading: central is `absent` on this machine (AC5a, contributes zero rules, load succeeds). Resolved rule count is 0, so no layer contributes rules yet. This is expected before stories E and F and is the baseline for the owed rerun.
- Limits of this evidence (disclose, do not overclaim):
  - Proves the read path and absent classification on English Windows only (Q5 ruling: English-only activation accepted).
  - Does not exercise a `present` value; none is provisioned and a session cannot write one.
  - Rerun owed after E and F, when shipped-defaults and project carry the deny rules.

## 7. Sensitive areas touched

| Area | Touched? | Note |
|---|---|---|
| Policy delivery / config surface | Documents it; changes nothing | Runbook describes the central channel. No loader, hook, or fixture edit. Fresh dated review report required only by the named-reviewer rule below. |
| Evidence / audit trail | Adds evidence (pre-flight output) | Recorded read-only; no instrument changed. |
| Policy enforcement / guard / CI gates / halt-state | No | |

## 8. Required reviewers

- `infra-security-reviewer`: HKLM write guidance, ACL and elevation wording, human-only labelling.
- `cross-domain-reviewer`: always above TRIVIAL; reads whole ADR catalog; checks runbook against loader/gate behavior and H's unlock wording.
- `red-team`: not required at STANDARD.
- `test-writer`: not dispatched. No UI flow or API surface change; docs plus read-only run. (Step 7 check: answer is no.)

## 9. Plan

Files:

| File | Change |
|---|---|
| `docs/runbooks/policy-load-recovery.md` | New. |
| `docs/decisions.md` | One AP-6 row (Manager writes; implementer supplies draft text in PR). |
| `CHANGELOG.md`, `docs/STATE.md` | Entries. |
| `docs/reviews/` | Optional dated pre-flight evidence file if the Manager wants it persisted. |

Order:

1. Read the S5 plan to quote criterion 12 verbatim (Q1).
2. Generate the enum list (G2d script, scratch only, not committed unless Manager wants it as a QA instrument).
3. Write the runbook.
4. Run pre-flight (G3), record raw output and before/after proofs.
5. Run `qa:reference-resolver origin/master HEAD`, `qa:completeness-claims`.
6. Draft the AP-6 row; Manager writes it.
7. CHANGELOG, STATE; PR skeleton.

Rollout and rollback: docs only; revert the commit. Ships behind nothing; no flag needed. Branch discipline: commit on `s308/activation`, no new branch.

Spike check (PRINCIPLES 17, 18): no unmeasured number this plan depends on. The pre-flight is itself the measurement of the live source's state.

## 10. Blocking questions (3, ranked)

1. **Criterion 12 source text.** `grep -i "criterion 12" docs/decisions.md` returns nothing today, and I have not located the S5 plan's criterion 12 wording. Which S5 document is authoritative, and is the AP-6 disposition "accepted residual", "closed", or "re-homed"? (Blocks G1/G1a only; the Manager writes the row.)
2. **Tier.** Confirm STANDARD (runbook gets `infra-security-reviewer` plus cross-domain), or hold at TRIVIAL as decomposed.
3. **Runbook path.** Confirm `docs/runbooks/policy-load-recovery.md` (new directory) versus `docs/policy-load-recovery.md`.

📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog — ≈18300 tokens saved this pass (fp 13c1476) [CACHE=HIT]

RECEIPT: verdict=BLOCKED criteria="12/12 mapped" checks="0/0/0" adr=NONE(0) pr=n/a
