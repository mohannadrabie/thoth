# Thoth — Requirements

**Purpose:** this document is the single input to the intake refiner for the `thoth` repository. It supersedes all prior working notes. For where it sits among the other documents, and what each of those is authoritative for, see [`docs/README.md`](README.md). For the hard rules and write gates enforced while building against it, see [`CLAUDE.md`](../CLAUDE.md).

**What changed from the predecessor requirements.** Three things, and only three:

1. **The agentic team is out of scope.** Roles, roster, council, the loop, the command surface and output templating move to a separate Claude Code plugin (`maat`), built separately and governed by thoth like any other consumer.
2. **Policy is centralized.** Policy is authored once, in a source the governed session holds no write credential for, and delivered to the enforcement point. It is not a per-repository or per-engineer configuration exercise.
3. **Legacy cleanup is gone.** There is no predecessor tree in this repository, so the removals section does not apply.

The engine, the environment model, the assurance dial, the evidence trail and the honesty rule are carried forward unchanged.

**Amendment 2026-08-29 (pending architecture review).** Three P0 requirements added: **EVD-17** (the unlock decision is read from a machine-readable declaration in the report, never recovered from its prose), **INT-07** (no control thoth claims depends on a third party's enforcement being correct; thoth records its own independent verdict), and **REL-12** (a target repository receives thoth's own observation surface at install, and REL-07's verify command distinguishes a documented control from a registered and running one). All three are subject to §0.2 and §0.6: at the in-session surface these are recorded verdicts, never prevention claims. All three were extracted from a real failure recorded in `docs/STATE.md` and `CLAUDE.md`, not proposed in the abstract. `hooks/report-subject-gate.mjs` is the first implementation of EVD-17 and INT-07 in this repository. This file is an architecture-reviewed 14-day-gated path: the amendment is written but **not yet reviewed**, and needs an `architecture` review declaring `docs/REQUIREMENTS.md` as its subject before it is treated as settled.

**Amendment 2026-09-01 (pending architecture review).** The runtime overtook this document a second time. Claude Code's managed-settings surface now ships, as admin-enforced configuration, several controls this document still lists as *build* or as unnamed configuration: exclusive MCP-server allowlisting, permission-rule lockdown with bypass-mode disablement, hook and customisation lockdown, a required version range that refuses to start, OS-level sandboxing with a network domain allowlist, and admin-console policy delivery refreshed hourly over a channel the governed session holds no write credential for. Sections 0.7, 1.4 and 1.5 are amended, POL-09 is split, **QA-17** is added, and the acceptance criteria of ENV-13, SUR-04, SUR-11 and INT-01 now name the mechanism. Three open decisions are added: **T14** (audit substrate), **T15** (policy-engine substrate), **T16** (containment by workspace versus by probe).

**Nothing in this amendment reduces a P0, and three things explicitly do not change.** They are recorded here so a later story does not cut them by inference. First, the semantic command detector (SUR-06 to SUR-09) survives intact: permission rules match command patterns, and SUR-07 requires detection that survives flag reordering, abbreviation and quoted binary names. Second, gap G5 stands: `requiredMinimumVersion` is a version check inside the runtime, not a hook verdict, so a `SessionStart` hook still cannot halt a session. Third, the whole of section 6 survives: no runtime primitive, and no scanned third party, has any concept of a review artifact unlocking a protected path.

Source read for this amendment: `code.claude.com/docs/en/admin-setup`, 2026-09-01. Like the 2026-08-29 amendment, this one is written but **not yet reviewed**, and needs an `architecture` review declaring `docs/REQUIREMENTS.md` as its subject before it is treated as settled.

**How to consume this document.** Take one milestone at a time (section 13). Requirements are discrete and testable. Section 12 lists decisions that are not yet made: do not invent answers to them, and do not derive requirements that depend on them.

**Amendment, 2026-08-24 — reuse ledger rebuilt from executed evidence.** Section 1 was replaced after the shipped AGT packages (`@microsoft/agent-governance-sdk@5.0.0`, `@microsoft/agent-governance-claude-code@5.0.0`) and the predecessor tree at `maat-legacy` HEAD `d64066c` were read directly rather than summarised. Five things changed, and they change the plan:

1. **A tie-break rule is now normative (§1.0): where AGT and the predecessor both cover a capability, AGT wins.** Section 1.3 adjudicates all seven overlaps. AGT takes six.
2. **Three groups previously marked *Build* are ports.** Semantic command detection (SUR-06 to SUR-09), the unlock economy (EVD-01 to EVD-11) and schema validation plus mandatory-rule locking (POL-06, POL-07) already exist and are tested in the predecessor tree.
3. **A `SessionStart` hook cannot halt a session on this runtime** (gap G5). CTN-01 and CTN-04 move their enforcement point to `UserPromptSubmit`. Open decision T1 is retired as answered; T1' replaces it.
4. **A timed-out `PreToolUse` hook does not block** (gap G6). This is a fail-open that must be enumerated under SUR-10 and bounded by OPS-03.
5. **The wrap goes behind thoth's own interfaces, not around AGT** (§1.7). AGT is a library dependency, never a compliance dependency.

Sections 11, 12 and 13 were amended to match. Eight requirement acceptance criteria were tightened: POL-03, CTN-01, CTN-04, SUR-10, SUR-12, INT-05, EVD-04 and OPS-03.

**Second amendment, 2026-08-24 — the project's own instruments move into M1.** QA-13 is promoted from P2 to P0 and joined by three new P0 requirements, QA-14 (every reference resolves), QA-15 (numeric completeness claims are instrument-backed and re-checked in the pipeline) and QA-16 (a known-broken instrument is an incident, not a known issue). All four land in M1. Evidence: in the predecessor project three of three MED findings in one story were recurrences of classes already written down as rules, and two instruments were known broken across multiple sessions while reviewer time absorbed the difference by hand. A rule a reader must remember is not a control. The full evidence trail is `docs/spikes/2026-08-24-thoth-reuse-ledger.md`.

---

## 0. Product

### 0.1 What thoth is

A governance engine for AI coding sessions. It decides what a session may do, verifies what a session is incapable of doing, and produces evidence of both. It is strong enough for a regulated environment and adoptable on a laptop by changing one line.

Thoth is not an agent, not a team, and not a workflow. It governs those things.

### 0.2 The promise, and the only claim that may be made

> Thoth does not promise that an agent will not attempt a change it should not. It promises that, for every environment declared off limits at `proven` assurance, the session is **verified incapable** of reaching it; that thoth **halts** when that verification cannot be produced; that the incapability is **re-tested on a schedule** with retained evidence; and that where a weaker assurance was chosen, thoth says so plainly rather than claiming more than it proved.

Corollary, published in `SECURITY.md` before any feature description: in-session gates are a fast-feedback control, not a security boundary. They run in the agent's own process at the agent's own privilege. This matches the runtime vendor's own position on client-side policy controls and must not be softened in any published copy.

### 0.3 The three planes

| Plane | What it is | Certain? | Thoth's role |
|---|---|---|---|
| **A. Capability** | The session holds no credential and no route reaching a forbidden environment | **Yes**, where assurance is `proven` | Verify and halt |
| **B. Runtime policy** | The in-session gate | **Never** | Own it. Value is fast feedback and an audit trail |
| **C. Out-of-band authority** | Separate deploy identity, cloud guardrails, platform-level denial | **Yes** | Verify and report |

Forge-side merge controls (branch protection, required reviews, required status checks) are a delivery-pipeline concern and are out of scope. Thoth governs what a session may do, not what a pipeline may merge.

Thoth must never describe a plane it verifies as a plane it enforces.

### 0.4 What "centralized" means

Three properties, all testable. Nothing more is implied.

| Property | Meaning |
|---|---|
| **Single authored source** | Policy is authored once. A governed repository does not carry its own copy of the rules. |
| **Session cannot write it** | The policy source is not reachable with any credential the governed session holds. A change under review cannot alter the rules that judge it. |
| **One engine, every surface** | The startup gate, the in-session gate and the pipeline gate return identical verdicts on identical input. |

### 0.5 Runtime scope

Claude Code, authenticated through Amazon Bedrock. Single provider by design. Support for other providers is out of scope and requires a recorded decision to reopen.

Consequences that shape requirements downstream:

- Model access, session identity and API-level audit are properties of AWS IAM and CloudTrail, not of thoth. Thoth verifies and reports them; it does not own them.
- Vendor-side session audit endpoints available on other plans are unavailable here. Thoth owns its own evidence path.

### 0.6 Non-goals

- Not a security boundary at the in-session gate.
- Not an agent framework, a roster, or a workflow engine.
- Not multi-runtime, not multi-provider.
- Not a replacement for IAM, cloud guardrails or a delivery pipeline.
- Not a tracker synchroniser.

### 0.7 Reuse before build

Thoth exists to make governance real, not to own an implementation. Six rules, and they are normative:

1. **A requirement satisfied by an upstream component or a runtime primitive shall be satisfied that way.** Reimplementing a row marked *reuse* or *configure* in section 1 requires a recorded decision naming what the reimplementation buys.
2. **Reuse does not mean trust.** Every reused capability is verified against the same fixtures as built code. An upstream claim is a hypothesis until a differential test confirms it.
3. **Where upstream falls short, the gap is named, not absorbed.** Section 1 lists each gap explicitly so it cannot be lost in the wrap.
4. **Where AGT and the predecessor both cover a capability, AGT wins.** We keep our own implementation only where AGT has no equivalent, or where AGT's equivalent demonstrably fails a requirement in this document, evidenced by a fixture rather than an opinion. Every exception is adjudicated in section 1.3; an overlap resolved in the predecessor's favour anywhere else is a defect in this document. Maintenance is the scarce resource: code we keep, we maintain forever.
5. **The tie-break rule decides who writes the code. It never decides what we claim.** AGT is a library dependency, never a compliance dependency. No posture-block sentence and no published claim may rest on an AGT behaviour thoth has not verified against its own fixtures (OSS-03, and §0.2's honesty rule).
6. **A runtime primitive that ships after this document was written retires the requirement it covers.** The inventory in §1.4 is re-checked on a declared cadence and at every version-floor bump. A requirement this document marks *build* while a shipped, admin-enforceable runtime setting already covers it is a defect in this document, not a design choice. QA-17 is the instrument. A hand-read of the settings reference is not one, per `CLAUDE.md`'s hard rule on hand-derived completeness claims. This rule exists because the failure has occurred twice: upstream AGT (`docs/spikes/2026-08-25-agt-docs-recheck.md`) and the runtime itself (amendment 2026-09-01).

Section 1 is the ledger. Read it before writing any story.

### 0.8 Priority

| Pri | Meaning |
|---|---|
| **P0** | v1 does not ship without it |
| **P1** | v1 is materially weaker without it |
| **P2** | Post-v1 unless cheap |

### 0.9 Groups

`ENV` environments · `CTN` containment · `POL` policy engine and configuration · `SUR` tool surface coverage · `INT` integrity and self-protection · `EVD` evidence and unlock trust · `CI` pipeline and control testing · `QA` thoth's own quality · `OPS` runtime behaviour · `REL` installation and onboarding · `OSS` open-source readiness

---

## 1. Reuse ledger — what is already built

**Read this before any story.** Roughly half of this document is already satisfied by something that exists. This section says which half, where it lives, and what remains genuinely net new. It is file-level and export-level on purpose: a story that says "port the detector" and does not name the file will get rebuilt.

Verdicts: **Reuse** (depend on a pinned upstream package) · **Copy** (take upstream MIT source as a reference implementation and own it thereafter) · **Port** (lift working, tested code from the predecessor tree) · **Configure** (a runtime primitive, set it, do not build it) · **Build** (net new, nothing covers it).

### 1.0 Three suppliers, and the rule that breaks a tie

Each supplier has a different failure mode, so each gets a different pin strategy. Never collapse them into one column.

| Supplier | What it is | Where | Pin strategy |
|---|---|---|---|
| **AGT** | Microsoft's Agent Governance Toolkit | npm `@microsoft/agent-governance-sdk@5.0.0` and `@microsoft/agent-governance-claude-code@5.0.0`, both MIT, both Public Preview | Vendor and pin **both** to exact versions. Never a range. See gap G9 |
| **Predecessor** | Working, incident-hardened governance code from the project this repository succeeds | `github.com/mohannadrabie/maat-legacy`, HEAD `d64066c` (local checkout `C:\playground\maat`) | Copy with provenance recorded, re-verify under mutation. It is our code; there is no upstream to track |
| **Runtime** | Claude Code's own hooks, permission rules, tool-server allowlist, sandbox and settings precedence | The runtime itself | Version floor plus a live conformance check (SUR-05) |

**The tie-break rule, normative: where AGT and the predecessor both cover a capability, AGT wins.** We keep our own implementation only where AGT has no equivalent, or where AGT's equivalent demonstrably fails a requirement in this document. "Demonstrably" means a fixture, not an opinion. Every exception is listed in 1.3 with the evidence; an overlap resolved in the predecessor's favour anywhere else in this document is a defect in this document.

The rule exists because maintenance is the scarce resource. Code we keep, we maintain forever. Code AGT keeps, Microsoft maintains and the whole ecosystem tests.

**AGT is a library dependency, never a compliance dependency.** No sentence in the posture block, and no published claim, may rest on an AGT behaviour that thoth has not itself verified against its own fixtures. This is not distrust of Microsoft; it is section 0.2's honesty rule applied to a third party. The tie-break rule decides *who writes the code*. It never decides *what we claim*.

### 1.1 What to take from AGT

All of the below are exported from `@microsoft/agent-governance-sdk@5.0.0` unless noted, are MIT licensed, and require no Python.

| AGT artifact | Verdict | Satisfies | Note |
|---|---|---|---|
| `PolicyEngine`, `PolicyConflictResolver`, `ExternalPolicyBackend`, `OPABackend`, `CedarBackend` | **Reuse** | POL-03 substantially | The decision engine. Conflict strategies include `deny_overrides`. `ExternalPolicyBackend` is one of only two clean extension seams AGT ships and is where thoth's other rules attach — **POL-05 excepted: it runs above AGT as a kernel short-circuit, not through this seam (corrected 2026-08-26, see §1.3 row 2)** |
| `directResourcePolicies.pathRules`, `blockedToolCalls.commandPatterns` (adapter policy schema) | **Reuse** | INT-01, CI-05, protected-path matching | Declarative path and command rules. This supersedes the predecessor's hand-rolled protected-path loop. Port the patterns as data, not the matching code |
| Policy layering: root-first folder merge, most-specific-last, `inherit: false` cutoff, parent-`deny`-wins | **Reuse** | POL-08 | AGT's precedence mechanism. See 1.3 for the one thing it does not do |
| `SurfaceParityChecker` | **Reuse** | POL-03 acceptance, §0.4 property 3 | Groups rules by normalised semantics, reports which surfaces lack a counterpart, scores parity 0 to 100. §0.4's third property currently has no named test; this is it |
| `FacetRegistry`, `extractProtocolFacets`, `extractSqlFacets`, `extractK8sFacets` | **Reuse** | POL-04, POL-12 | Per-protocol extractors registered by declaration rather than by editing a dispatch chain, which is POL-12's exact acceptance criterion. This is the normalizer mechanism; thoth supplies extractors, not a competing registry |
| `CredentialVault`, `CredentialProfile`, `CredentialHandle`, `DenyReceipt`, `PLACEHOLDER_RE` | **Reuse** | CTN-10, OPS-02 | Agents hold opaque `{{cred:NAME}}` handles, never values. Every denial emits an identical opaque receipt whether the handle is missing, bound to another agent, or policy-denied. That deterministic-deny property is a design worth inheriting rather than getting wrong once first |
| `GovernanceVerifier`, `IntegrityManifest`, `GovernanceAttestation`, **`integrity` mode only** | **Reuse** | INT-02, REL-07 output shape | SHA-256 of enforcement-layer files against expected hashes, plus a coverage-scored attestation object. Its `runtime-evidence` mode is forbidden: see gap G8 |
| `McpSecurityScanner` | **Reuse** | SUR-04 companion | Tool poisoning, typosquatting, hidden instructions, rug-pull by fingerprint mismatch. Gap G4 makes SUR-04 load-bearing; this adds a cheap second check on what is inside the allowlist |
| `CircuitBreaker`, `SLOTracker`, `ErrorBudgetTracker`, `TraceCapture` | **Reuse** | CI-09, CI-10, OPS-03 instrumentation | Scheduled control tests surfacing staleness, and a failed control routed as an incident |
| `ContextPoisoningDetector`, `PromptDefenseEvaluator` | **Reuse as a signal only** | EVD-15 partially | **Not EVD-04.** AGT's own published benchmark reports 6.36% attack recall and 9.41% benign false-positive rate at default configuration. Feed the audit trail; never gate on it |
| `@microsoft/agent-governance-claude-code`'s `lib/audit.mjs` | **Copy** | INT-05 partially, EVD-16 partially | 115 lines. SHA-256 chain from a genesis hash, timing-safe verification, atomic write via temp file plus rename, throws on chain-verification failure. Two defects to fix on the way in: it truncates silently at 10,000 entries, and it rewrites the whole JSON array on every append. Also relocate the file outside the session's write reach (REL-02) |
| The adapter's hook wiring and `permissionDecision` mapping | **Copy the pattern** | SUR-01, SUR-13 | `deny` maps to `permissionDecision: "deny"`, `review` maps to `"ask"`. Correct, and worth matching |
| AGT ADR-0029 (policy distribution: OCI and git resolvers, `trust.yaml`, Ed25519 detached signatures, a lockfile with immutable coordinates) | **Copy the design, build the code** | POL-09 | Status `proposed`, implementation listed as follow-up work. There is nothing to depend on |

**What not to take from AGT, and why it must be written down.** The tie-break rule gives AGT the benefit of the doubt; these five rows are where the doubt was resolved against it, on evidence.

- **`AuditLogger` (SDK).** In-memory only: an entries array, a verify pass, an `exportJSON()`. No file, no durability. The durable implementation is the adapter's `lib/audit.mjs` above. Do not confuse the two.
- **`GovernanceVerifier` `runtime-evidence` mode.** It reads a document the deployment wrote about itself and checks whether fields such as `policy.failClosed` are `true`. That is the EVD-02 failure mode exactly. Forbidden here.
- **`RingEnforcer`.** `canExecute()` is a numeric comparison between two self-declared config values. Nothing is measured. It is not an assurance model and must never be reported as one.
- **The injection detector as a control.** See the row above.
- **The `agt` CLI.** Python-only. `GovernanceVerifier` covers most of `agt verify` as a library call; `agt doctor` and `agt lint-policy` have no confirmed TypeScript equivalent. Confirm before assuming parity (gap G3).

### 1.2 What to take from the predecessor (`maat-legacy`)

Everything below is here because AGT has no equivalent. Three requirement groups that read as net new in an earlier draft of this document are already built and tested.

| Source file | Size | Verdict | Satisfies | Port instruction |
|---|---|---|---|---|
| `fullstack/scripts/guard.mjs`, **detection and target-extraction functions only** | 1,423 lines, of which the detector is the part that ports | **Port** | SUR-06, SUR-07, SUR-08, SUR-09 | Heredoc-only stripping, fd-dup ampersand handling, interpreter inline-exec detection with bounded lookahead, quoted-string candidate extraction, directory-aware write targets with a depth cap, `bash -c` / `-C` / `--directory` / `patch -d` resolution, realpath canonicalisation, brace expansion restricted to file form. AGT has no shell-command normalizer at all: its MCP gateway spec covers structured JSON parameters only. **The protected-path matching and blocked-command loop in the same file does not port** (see 1.3, row 1) |
| `fullstack/scripts/test-guard.sh` | 185 assertions | **Port** | QA-01, QA-03, CI-01 | The detector's regression suite. Several assertions are incident-keyed: Issue #72 (`rm -rf /x 2>/dev/null` classified as a benign write), Issue #73 (unexpanded `$VAR` captured as a trusted target), Issue #66 (`new RegExp(undefined)` compiling to `/(?:)/`). Each is a real fail-open that was found and closed. This suite is also the **reference implementation** every later parity claim is measured against, including parity against AGT (see 1.7) |
| `fullstack/scripts/mutation-check.mjs` | 259 lines | **Port** | QA-06 | Applies named mutant classes to a shadow copy of the detector and asserts the suite actually fails on each. Wired in CI as a standing job, after the claim "all N regression cases pass" turned out to be inaccurate on measurement more than once. AGT publishes no mutation harness |
| `fullstack/scripts/report-gate.mjs` | 1,575 lines | **Port** | EVD-01, EVD-03, EVD-05, EVD-06, EVD-07, EVD-08, EVD-10, EVD-14 | The review-report gate. Freshness window, scope matching, structural report validation, `observe` / `block` provenance modes, and a gate-miss log that records a real miss rather than silently allowing it. **AGT has no concept of a review artifact unlocking a protected path.** Nothing adjacent exists anywhere in its surface |
| `fullstack/scripts/report-identity.mjs`, **revocation and attestation semantics** | 459 lines | **Port** | EVD-01, EVD-02, INT-03 | Hash-based report revocation that survives a hardlink or `cp` of an invalidated report's bytes under a fresh name, plus `SubagentStop`-bound attestation. Directory-membership-only revocation was demonstrably defeatable; this is the fix. **The raw file-hashing primitive underneath does not port** (see 1.3, row 4) |
| `fullstack/scripts/test-report-gate.mjs`, `test-report-gate-conditions-8-9.mjs`, `test-report-identity.mjs` | 3,733 lines | **Port** | QA-01, QA-03 | The unlock economy's regression suite. Largest test asset in the predecessor tree |
| `fullstack/scripts/governance-waiver.mjs` | 118 lines | **Port** | INT-06 | Waiver file handling, human-only by construction. The gated party may never create or edit it through any route. No AGT equivalent |
| `fullstack/scripts/which-guard.mjs` | 269 lines | **Port as an input** | REL-07 | Detects which enforcement layer is actually running. Feed its result into `GovernanceAttestation` rather than printing a second, competing report (see 1.3, row 6) |
| `scripts/policy/action.ts` | 86 lines | **Port** | §3.1, POL-04 | The canonical Action record: `source`, `verbs`, `targets`, `environment`, `identity`, `deferred`, `unresolved`. AGT has three different record shapes across its own surfaces and no single canonical one, so §3.1's cross-tool equivalence bar is not reachable through AGT alone. Zero imports by design |
| `scripts/policy/kernel.ts`, **the POL-05 rule only** | 249 lines, of which `isMutating()` and `pol05Rule()` are the part that ports | **Port as a kernel short-circuit above AGT — corrected 2026-08-26, was "as an AGT policy backend"** | POL-05, SUR-02 remainder | Fail-closed on ambiguity: a mutating action whose source is opaque, or which carries any unresolved field, is denied. AGT's unclassified-tool default is `review` in its bundled policy and `allow` in its code fallback (gap G1), so this rule has no AGT equivalent. **Evaluated before AGT's `PolicyEngine` is consulted, not registered through `ExternalPolicyBackend`** — `BackendDecision` normalization is lossy with no shape-stability guarantee (AGT ADR-0015), which collides with this record's own `deferred`/`unresolved` fields and POL-06's structured error. See §1.3, row 2. **The ordered-rule-list dispatch around it does not port** (see 1.3, row 2) |
| `scripts/policy/precedence.ts`, **mandatory-key locking only** | 125 lines | **Port as a delta on AGT's layering** | POL-07 | A downstream tier may omit a mandatory field, may add entries to a mandatory array (union, deduped), may never shrink one, may never redefine a mandatory scalar. AGT's parent-`deny`-wins rule protects only deny actions, not arbitrary fields, so "emptying the protected list from a project file is rejected" is not reachable through AGT (see 1.3, row 3) |
| `scripts/policy/schema.ts`, `schemas.ts`, `types.ts` | 357 lines | **Port** | POL-06 | Schema validation returning a structured `ValidationError { message, field, expected }` carried as data, so a test asserts on the field and expected shape without parsing prose. AGT's loader **silently ignores unknown fields** for forward compatibility, which is the exact opposite of POL-06's "unknown key is an error, not a silent no-op" |
| `scripts/policy/load.ts` | 120 lines | **Port** | POL-02 | The single I/O edge. Everything else in the policy tree is pure |
| `scripts/policy/normalize-shell.ts` | 122 lines | **Port as a `FacetRegistry` extractor** | POL-04 | Register the ported detector as a `shell` extractor on AGT's `defaultRegistry`, in the same shape as its `extractSqlFacets` and `extractK8sFacets`. Reports anything outside its recognised shape as `opaque`, which is what the POL-05 rule then denies |
| `scripts/policy/normalize-fs.ts` | 68 lines | **Port** | POL-04 | Structured filesystem-tool normalizer. Same registration route as above |
| `scripts/policy/report-scope.ts` | 65 lines | **Port** | EVD-06 | Pure Scope-line parsing, no I/O. Its header documents exactly which four mechanisms are un-ported and why the omission fails closed |
| `scripts/policy/guard-shadow-differential.test.ts`, `guard-protected-path-differential.test.ts`, `guard-fixture-filter.mjs`, `guard-protected-path-fixture-filter.mjs` | 954 lines | **Port the harness** | CI-12, POL-03 acceptance, M2 acceptance | Runs a fixture set through a candidate engine and the incumbent as a real subprocess, then diffs the verdicts. **Retarget it at AGT.** This harness is how the tie-break rule gets enforced continuously rather than decided once (see 1.7) |
| `scripts/secret-scan/history-scan.ts` and its test | 551 lines | **Port** | OSS-01, QA-12 partially | Full-history scan with redaction before logging. A working-tree scan is not sufficient. AGT's equivalent is CI secret scanning guidance, not code |
| `scripts/repo-split/requirement-accounting.mjs` | 273 lines | **Port** | Doc hygiene, not a requirement | Requirement-to-destination accounting |
| `.governance.json` `protected[]` entries | data | **Port the data only** | INT-01, CI-05 | The protected-path patterns and their `requires` / `gateDays` pairings, migrated into AGT's `pathRules` shape. Data migration, not code migration |
| `policy/profiles/*.yaml`, `policy/catalog/*.yaml`, `maat.yaml` | data | **Port as the authoring format** | POL-01, POL-02 | The tiered YAML with comments and adjacent rationale, generated into the adapter's `default-policy.json` shape — the resolved delivery format (§12 T10, **ANSWERED 2026-08-26**) |
| `eslint.config.mjs` kernel import restriction | config | **Port** | POL-11, §3.2 | The lint rule that makes the layer boundary load-bearing rather than aspirational |

**What not to take from the predecessor.** `fullstack/scripts/team-gate.mjs` (roster and role wiring) belongs to `maat`, not here. The agentic loop, the command surface, the ADR cache, the dashboard and the decision-archive tooling are all `maat` concerns. Thoth governs them; it does not contain them.

### 1.3 Overlap adjudication — where both cover it, and how the tie was broken

Seven capabilities exist on both sides. AGT takes six and a half. Each exception below is a requirement AGT's version demonstrably does not meet, with the evidence named. No other exception may be claimed without adding a row here.

| # | Capability | AGT has | Predecessor has | Ruling |
|---|---|---|---|---|
| 1 | Protected-path and blocked-command matching | `directResourcePolicies.pathRules`, `blockedToolCalls.commandPatterns`, declarative, plus shipped rules for recursive delete, credential reads and metadata endpoints | `guard.mjs`'s `PROTECTED` loop and `blockedCommands` list, hand-rolled regex | **AGT wins outright.** Discard the matching code, migrate the patterns as data. This is the closest one-to-one match in the whole ledger |
| 2 | Decision engine and rule dispatch | `PolicyEngine` with conflict strategies, rate limits, pluggable backends | `kernel.ts`'s ordered rule list, first non-null verdict wins | **AGT wins the engine for everything POL-05 does not already deny** — POL-01/02/03/06-09, layering, conflict resolution. **POL-05 itself runs ABOVE AGT: a kernel short-circuit evaluated before AGT's `PolicyEngine` is consulted, not registered through `ExternalPolicyBackend`.** Not a competing engine — one narrow, well-defined pre-check, the shape of a firewall default-deny rule ahead of a downstream ACL — and this does not reopen the tie-break rule (`docs/decisions.md` 2026-08-24, "AGT wins any capability overlap"). **AMENDED 2026-08-26**, reversing the original `ExternalPolicyBackend`-registration placement. Evidence for the reversal: AGT's own ADR-0015 states `BackendDecision { allowed, action, reason, backend, evaluation_ms, error }` normalization is lossy (backend-specific metadata dropped) with no shape-stability guarantee (`docs/spikes/2026-08-25-agt-docs-recheck.md` §4) — this collides with §3.1's Action-record fields (`deferred`/`unresolved`, which POL-05 denies on exactly) and POL-06's structured `ValidationError { message, field, expected }` requirement; routing POL-05 through a `BackendDecision.reason` string flattening pushes back toward prose-parsing, the opposite of POL-06's own purpose. §1.7 states thoth's fail-closed-on-ambiguity verdict is "never delegated" — POL-05 IS that verdict, so it belongs above the seam, not inside an AGT-consulted backend whose response shape thoth doesn't control (also consistent with already-Accepted ADR-0017's rule that fail-closed-on-ambiguity is implemented natively and never delegated to AGT). Evidence for the underlying exception still stands: AGT's unclassified default is `review` in its bundled policy and `allow` in its code fallback; POL-05 requires `deny` |
| 3 | Policy layering and precedence | Root-first folder merge, most-specific-last, `inherit: false`, parent-`deny`-may-not-be-overridden | `precedence.ts`'s three tiers with per-key origin tags and mandatory-key locking | **AGT wins the layering.** Mandatory-key locking survives as a thin delta on top. Evidence for the exception: AGT's immutability is implicit in the *action value* (`deny` beats a child rule) and has no `mandatory:` key, so POL-07's "emptying the protected list from a project file is rejected" is not expressible |
| 4 | File hashing and integrity | `GovernanceVerifier.hashFile()`, `IntegrityManifest`, SHA-256 against expected hashes | `report-identity.mjs`'s own SHA-256 comparison | **AGT wins the primitive.** The revocation and attestation *semantics* on top survive, because AGT hashes its own module files for tamper detection and has no notion of revoking a review artifact |
| 5 | Normalizer registration | `FacetRegistry` with declaration-registered extractors, plus SQL and Kubernetes extractors | `normalize-fs.ts` / `normalize-shell.ts` with a hand-wired catalog | **AGT wins the mechanism.** Our normalizers become extractors registered on AGT's registry. Evidence for keeping the shell extractor's *content*: AGT ships no shell extractor and its MCP gateway spec states shell execution is out of scope |
| 6 | Reporting what is in force | `GovernanceAttestation` with controls, coverage percentage, grade and summary | `which-guard.mjs`'s layer detection | **AGT wins the output shape.** `which-guard.mjs`'s detection becomes an input control fed into the attestation, not a second report |
| 7 | Audit log | Adapter `lib/audit.mjs`: chained, timing-safe, atomic | Nothing. The predecessor has no audit log | **AGT wins by default.** Copy and fix the two defects in gap G7 |

Every remaining predecessor row in 1.2 is there because AGT has nothing adjacent: the unlock economy, the shell detector's content, mutation checking, the differential harness, the canonical Action record, structured schema errors, waivers, and the full-history secret scan.

### 1.4 What to configure on the runtime

These are Claude Code primitives, not AGT. Set them; do not build them. **Rebuilt 2026-09-01.** Every row now names the actual setting key, because a row naming only a category is how §0.7 rule 6's defect gets in: the previous version of this table said "permission rules, bypass-mode lockout, sideload lockout, version floor" and named nothing, so four shipped keys sat uncounted while the requirements they cover stayed marked *build*.

| Primitive | Setting keys | Covers |
|---|---|---|
| Exclusive tool-server allowlist | `allowManagedMcpServersOnly`, `allowedMcpServers`, `deniedMcpServers`, or a deployed `managed-mcp.json` | **SUR-04 in full.** Exclusive, not additive, which is SUR-04's exact bar |
| Permission-rule lockdown and bypass lockout | `allowManagedPermissionRulesOnly`, `permissions.disableBypassPermissionsMode`, `permissions.defaultMode`, `permissions.disableAutoMode` | INT-01, REL-02 partially. Note the merge semantics: `permissions.allow` and `permissions.deny` merge across sources, so a developer can extend a managed list but not shrink one. `allowManagedPermissionRulesOnly` is what makes the managed set exclusive rather than a floor |
| Customisation and hook lockdown | `allowManagedHooksOnly`, `allowedHttpHookUrls`, `strictPluginOnlyCustomization`, `strictKnownMarketplaces`, `blockedMarketplaces`, `disableSideloadFlags` | INT-01. Closes the route where a session installs its own hook, skill, agent, plugin or MCP server and thereby changes what governs it |
| Required version range | `requiredMinimumVersion`, `requiredMaximumVersion`, `minimumVersion` | Version floor. `requiredMinimumVersion` refuses to start outside the approved range; `minimumVersion` only blocks downgrades. Use the former, and record the range as policy data |
| Filesystem and network isolation | `sandbox.enabled`, `sandbox.network.allowedDomains` | ENV-13 partially, SUR-11 partially (subprocesses only, see G4). The domain allowlist is enforced at the OS level, so it catches a `curl` that a `WebFetch` denial does not |
| Managed policy delivery | Server-managed settings from the admin console, refreshed hourly; macOS plist `com.anthropic.claudecode`; Windows `HKLM\SOFTWARE\Policies\ClaudeCode`; or the per-platform `managed-settings.json` file | **§0.4 properties 1 and 2**, POL-08 partially, POL-09 delivery half. The plist and HKLM channels require administrator privileges to write, so a change under review cannot alter the policy that judges it. **The Windows `HKCU` channel is writable without elevation and is not an enforcement channel; never count it as one** |
| Credential denial at the capability layer | Permission rules plus per-environment credential configuration | CTN-10 |
| `PreToolUse`, `UserPromptSubmit`, `SessionStart`, `SubagentStop` hooks | | SUR-01, SUR-13, and the halt point (see G5) |
| Tool-execution telemetry | OpenTelemetry export | An evidence path that is not a session-writable file on the governed machine. Bears on INT-05 and gap G7; see open decision T14 |

**Delivery caveat, specific to this document's runtime scope (§0.5).** Sessions authenticated through Amazon Bedrock do not receive admin-console server-managed settings unless a self-hosted Claude apps gateway is run. On Bedrock, managed policy arrives by the plist, registry or file channel instead. This is a deployment choice rather than a gap, but REL documentation must state it, because a reader who assumes the admin console will deploy nothing and discover it at install time.

**What this table does not cover, stated so it is not assumed away.** Permission rules match command patterns; they are not a semantic classifier. SUR-06 to SUR-09 are therefore unaffected, and flag reordering, abbreviations, path-qualified or quoted binary names, heredoc handling and deferred execution all remain thoth's to detect, with the ported detector still the reference implementation every parity claim is measured against (§1.2, §1.7). Nothing in this table halts a session on a policy verdict, so gap G5 stands unchanged.

### 1.5 What is genuinely net new

Nothing in AGT, nothing in the predecessor tree, nothing in the runtime covers any of this.

| Group | Why nothing covers it |
|---|---|
| **Environments, stances, assurance, executed probes.** ENV-01 to ENV-16, CTN-02 to CTN-09, CTN-11 to CTN-13 | AGT governs *actions*; thoth governs *capability*. AGT has no named-environment vocabulary, no stance, no assurance level, and substitutes self-reported evidence (`runtime-evidence`) and config-declared numeric comparison (`RingEnforcer`) where an executed probe would go. This gap will not close by waiting for AGT to mature, because it is not a maturity gap. **This is the project** |
| **Posture block and per-control honesty reporting.** ENV-05, ENV-12, CTN-12 | No upstream has a concept of reporting a control as unproven |
| **Pinning and recording the resolved policy reference.** POL-09, second half only | **Narrowed 2026-09-01.** Delivery and write-protection are a runtime primitive now (§1.4, managed policy delivery), so that half is no longer net new. What remains net new is the immutable reference itself: managed settings expose no version identifier, so there is nothing to pin and nothing to stamp on an artifact unless thoth supplies it. AGT's design exists (ADR-0029); the implementation does not |
| **Halting before work begins.** CTN-01, CTN-04 | Moved from *Configure* to *Build*. See gap G5 |
| **Evidence bundle, capture mechanism, decision export.** EVD-12, EVD-13, EVD-16 | No verified TypeScript export path. See gap G10 |
| **Installation and onboarding.** REL-01 to REL-11 | Net new, but small |

### 1.6 Named gaps

Each is a place an upstream does not do what a naive reading assumes. Each must be closed or formally accepted before the wrap is called complete.

| # | Gap | Consequence |
|---|---|---|
| G1 | AGT's `compilePolicy()` falls back to an **allow** default effect when a policy omits `toolPolicies.defaultEffect` and does not list `"*"`. The bundled default policy sets `"review"` explicitly, so the shipped configuration looks safer than the code's actual fallback | POL-05 and SUR-02 are not satisfied by the wrap. They must be an explicit rule registered on top, with their own fixtures. The predecessor's POL-05 rule is that rule; port it. This closed two real fail-open defects and must not be lost |
| G2 | AGT's Claude Code adapter calls `recordAudit()` unconditionally on every prompt submission and every tool call, and creates `~/.claude/agt/audit-log.json` with no thoth configuration present at all | Directly conflicts with OPS-01. Either suppress it in the wrap, or amend OPS-01 by recorded decision. Do not discover this at integration time |
| G3 | No TypeScript equivalent for `agt doctor` or `agt lint-policy` was found in the shipped package surface | Confirm before assuming parity. If absent, build the thin equivalent or drop the requirement |
| G4 | Runtime isolation covers shell subprocesses only. Structured tool servers and hooks run unconstrained | SUR-04 exclusive allowlisting is the only control for that class, which makes it load-bearing rather than defence in depth. `McpSecurityScanner` adds a second, cheaper layer |
| G5 | **A `SessionStart` hook cannot halt a session.** The runtime's documented behaviour for that event at exit code 2 is to show stderr to the user only; the session proceeds. AGT's own `session-start.mjs` prints the words "failed closed" and then exits 2 | **CTN-04 is not satisfiable at that surface.** The halt must move to `UserPromptSubmit`, which does block on exit 2 and erases the prompt. This retires open decision T1 and creates T1'. The promise in §0.2 depends on this being fixed, not noted |
| G6 | **A timed-out `PreToolUse` hook does not block.** The call proceeds through the normal permission flow. AGT ships a 30-second timeout on all three of its hooks | An enumerated fail-open under SUR-10, requiring a recorded decision, and a hard upper bound on OPS-03's per-action budget. See T11 |
| G7 | The SDK's `AuditLogger` is in-memory. The durable implementation lives in the adapter, truncates silently at 10,000 entries, rewrites the whole file on every append, and sits at a session-writable path | INT-05 is not satisfied by reuse alone. Copy and fix, per 1.1 |
| G8 | `GovernanceVerifier`'s `runtime-evidence` mode trusts a document the deployment wrote about itself | The EVD-02 anti-pattern wearing an upstream badge. Forbid it explicitly in the wrap so a later story does not reach for it |
| G9 | `@microsoft/agent-governance-claude-code@5.0.0` declares a dependency on `@microsoft/agent-governance-sdk@4.0.0` | Version skew inside a single upstream release. Pin both exactly and test the pair, never each package alone |
| G10 | The CloudEvents and OpenTelemetry export paths are specified on AGT's Python side. Nothing in the npm SDK's surface exposes a sink, backend registry or exporter | EVD-16 and OPS-08 are unverified, not configured. Resolve before M4 planning. See T12 |

**AGT's maintenance signal, stated plainly because §0.2 forbids claiming more than was proved.** MIT licensed, real Microsoft organisation, active npm publishing. Also: its support file states support is limited to GitHub issues and discussions with no service level, it is effectively one-lead-maintained with a stated aspiration to move to a foundation, its changelog is two major versions behind its published packages, and its "covers 10 of 10 OWASP Agentic Top 10" headline is a prose mapping in which three of ten risks have named policy rules while its conformance suite contains no OWASP references. This is a sound library to build on and an unsound thing to cite as evidence. That is exactly why the tie-break rule in 1.0 is scoped to implementation and never to claims. OSS-03 already forbids claiming enforcement for a layer thoth only verifies; the same discipline applies to a layer a vendor only claims.

### 1.7 What this means for sequencing

Two changes to the milestone order, both consequences of the ledger above.

**First: port the reference before wrapping the engine.** M2 asks for a differential test proving the wrapped engine returns the reference verdict on every fixture. That test needs a reference implementation to diff against, and the predecessor's detector plus its 185 assertions is it. Porting it first turns M2 from an assertion into a measurement. A new milestone M1.5 exists for exactly this.

**Second: the wrap goes behind thoth's own interfaces, not around AGT.** AGT ships three mutually incompatible policy formats, a fourth in the surface that actually enforces, an engine mid-rewrite toward a beta Rust kernel, and internal version skew inside one release. Wrapping AGT directly inherits that churn. The structure that does not:

- **Thoth owns the verdict.** The decision interface, the Action record, the environment and assurance model, and fail-closed on ambiguity are never delegated. This layer carries the §0.2 promise.
- **AGT plugs in behind named interfaces.** Policy evaluation, audit sink, credential vault, facet extraction, integrity manifest. Five interfaces, each swappable, each with a conformance test thoth owns.
- **The differential harness runs against AGT on every upstream release.** This is how the tie-break rule in 1.0 stays enforced rather than being decided once and drifting. When AGT begins agreeing with a rule thoth still owns, delegate it and delete ours. When it diverges, we find out on their release day rather than in production.

The same structure pays off in both futures. If AGT matures, adoption is a test result rather than a rewrite. If AGT stalls, it is swapped out and nothing above the seam changes.

**Revised effort shape.** M2, M3 and M4 all shrink, because their hardest requirements are either AGT reuse or ports. M5 (environments and containment) is unchanged and is now unambiguously the centre of gravity of this project. Scope effort accordingly.

---

## 2. ENV / CTN — Environments and containment

**Build posture:** mostly net new. Nothing upstream models environments, stances or assurance. Two controls are runtime primitives to configure rather than build: the startup gate (CTN-01, CTN-04) and credential denial (CTN-10). See section 1.

### 2.1 The model

Containment is not a hardcoded notion of "production". It is a **declared set of environments**, each with a stance and an assurance level. This is what makes one product work in a regulated bank and on a laptop at home.

**An environment** is a named set of selectors across every capability domain the session can reach: cloud accounts, cluster contexts and namespaces, git remotes and refs, registries, hostnames and URL patterns, and local filesystem paths.

**Stance** is what the session may do there.

| Stance | Meaning |
|---|---|
| `allowed` | The session may act |
| `read-only` | The session may read, never mutate |
| `forbidden` | The session must be unable to act |

**Assurance** is how strongly `forbidden` is established. This is the relaxation dial.

| Level | What it means | Posture reports |
|---|---|---|
| `proven` | An executed probe demonstrates incapability: no credential, no permission, no route. Failure to prove halts | **verified** |
| `guarded` | The engine denies actions targeting it. Real in-session denial, no out-of-band proof | **guarded, not proven** |
| `asserted` | The operator states it. Thoth records the assertion and proceeds | **asserted, unverified** |
| `none` | Not checked | **unchecked** |

**The honesty rule is what makes the dial safe.** An `asserted` environment is reported as unverified, in the posture block and on every artifact produced. Thoth never claims more than it proved. Relaxing changes what thoth *requires*, never what it *claims*.

**Unknown targets.** An action targeting something matching no declared environment is `unknown`. The profile decides whether that denies or warns.

### 2.2 Profiles

Two ship. Both are the same product; they differ only in configuration.

| Profile | Assurance floor for `forbidden` | Unknown target | Intended use |
|---|---|---|---|
| `standard` | `guarded` | warn | Default. Real in-session denial, no probe requirement |
| `regulated` | `proven` | deny | Probe-verified incapability, halt on failure to prove |

`regulated` is the default when unspecified.

### 2.3 Requirements

| ID | Pri | Requirement | Acceptance |
|---|---|---|---|
| ENV-01 | P0 | Environments shall be user-defined and named. There shall be no hardcoded environment enum. | A project can define one environment, twenty, or none |
| ENV-02 | P0 | An environment shall be definable by selectors across every capability domain the session can reach. | Cloud accounts, cluster contexts and namespaces, git remotes and refs, registries, hostnames and URL patterns, local filesystem paths |
| ENV-03 | P0 | Each environment shall declare a stance: `allowed`, `read-only` or `forbidden`. | |
| ENV-04 | P0 | Each `forbidden` environment shall declare an assurance level: `proven`, `guarded`, `asserted` or `none`. | |
| ENV-05 | P0 | The posture block shall report stance and assurance per environment, and shall never report an `asserted` or `guarded` environment as verified. | Wording is fixed and distinct per level. A green-looking posture that was never proven is a defect |
| ENV-06 | P0 | A profile shall set the minimum assurance level for `forbidden` environments and shall be able to mark it mandatory. | A central policy requiring `proven` cannot be relaxed by a project file |
| ENV-07 | P0 | Actions targeting an undeclared environment shall be classified `unknown`, and the profile shall decide whether that denies or warns. | `regulated` denies. `standard` warns |
| ENV-08 | P0 | Per-environment requirements shall be declarable, not global. | A separate deploy identity, a credential denial or a probe requirement is a property of one environment. A repository can declare none and still be valid |
| ENV-09 | P0 | Both profiles shall ship, selectable in one line. | Moving between them is a profile selection, not a configuration exercise |
| ENV-10 | P0 | The profile and the assurance levels in force shall be stamped on every artifact thoth produces. | A change governed under `standard` is never indistinguishable from one governed under `regulated` |
| ENV-11 | P0 | Lowering assurance shall be an explicit, recorded act. | Never a silent default, never inferred from a failed probe |
| ENV-12 | P0 | Where a declared control is not enforceable on the current runtime or provider, the posture block shall name it as unenforceable rather than reporting it as in force. | Provider-specific gaps are disclosed per control, not averaged into a single verdict |
| ENV-13 | P1 | Environment selectors shall cover local blast radius, not only remote systems. | Writes outside the repository, to specified paths, or to any git remote, are expressible as a forbidden environment. `sandbox.enabled` and `sandbox.network.allowedDomains` cover part of this at the OS level (§1.4); thoth expresses the remainder as environments and discloses what the sandbox does not reach (SUR-11, gap G4) |
| ENV-14 | P1 | A command shall explain, for a given target, which environment it matches and what would happen. | Answers "why was this blocked" and "would this be blocked" without reading configuration |
| ENV-15 | P1 | Environment definitions shall be validated for overlap and shall report the resolution order. | Two environments matching one target is a configuration error, not a coin flip |
| ENV-16 | P2 | A profile shall be selectable per session as well as per project, subject to the mandatory floor. | Lets someone tighten temporarily. Loosening remains bounded by the floor |

| ID | Pri | Requirement | Acceptance |
|---|---|---|---|
| CTN-01 | P0 | For every environment with stance `forbidden` and assurance `proven`, the session shall be verified incapable by executed probe **before work begins**. | Probe per capability domain the environment names. The posture computation runs at session start; the **halt** runs at the first blocking surface the runtime offers, which is `UserPromptSubmit`, before the first prompt is processed and therefore before any tool call. It is never deferred to the first gated action. See gap G5 and open decision T1' |
| CTN-02 | P0 | A `proven` probe shall test permission, not identity alone. | A principal inside an allowlisted account that nonetheless holds write permission on a forbidden environment fails |
| CTN-03 | P0 | Where a `proven` assurance cannot be established, thoth shall halt or drop to restricted mode, per profile. Absence of evidence is failure, never a downgrade to `asserted`. | A failed probe never silently becomes an assertion |
| CTN-04 | P0 | The startup gate shall fail closed. An error, timeout or crash in the gate shall prevent work from proceeding, never permit it unguarded. | **Amended 2026-08-24.** A `SessionStart` hook cannot deliver this: the runtime's documented behaviour at exit code 2 for that event is to show stderr to the user and proceed (gap G5). The halt is therefore owned by `UserPromptSubmit`, which does block and erases the prompt. Verified by fault injection against the surface that actually blocks, not by reading documentation. A gate that prints "failed closed" and returns from a non-blocking surface is the defect this requirement exists to prevent |
| CTN-05 | P0 | Loss of a containment precondition mid-session shall halt work before the next gated action. | Credential refresh or context change that moves the session into a forbidden environment is detected |
| CTN-06 | P0 | Where an environment declares a separate deploy identity, thoth shall verify that identity is distinct from the session identity and not assumable from it. | Not required where the environment does not declare it |
| CTN-07 | P0 | A reachability threat register shall be maintained; every entry names a control and a test. | An entry with no control blocks release of thoth itself. Minimum coverage in 2.5 |
| CTN-08 | P0 | Probes shall be declared in configuration, not hardcoded. | A probe declares what to run, what to compare, and what a pass looks like |
| CTN-09 | P0 | The `guarded` level shall mean real in-session denial, not a warning. | An action targeting a `guarded` forbidden environment is denied by the engine and named as such |
| CTN-10 | P0 | Credential denial shall be expressible per environment and enforced at the capability layer where the runtime supports it. | Named credential files and environment variables are unreadable by the session, proven by a negative test, not by policy assertion |
| CTN-11 | P1 | Restricted mode shall have a hard definition. | Every remote-mutating tool denied, enumerated, not implied |
| CTN-12 | P1 | Posture results shall be recorded as timestamped evidence and form part of the change record. | |
| CTN-13 | P1 | Probe results shall be cacheable with a declared lifetime, and the cache shall not be writable by the governed session. | Startup latency is bounded without making the cache a bypass |

### 2.4 Illustrative configuration

**Standard:**

```yaml
profile: standard

environments:
  prod-account:
    match: { aws_accounts: ["999999999999"] }
    stance: forbidden
    assurance: guarded          # the engine denies; nothing is proven

  outside-this-repo:
    match: { paths: ["!${repo}/**"] }
    stance: forbidden
    assurance: guarded

unknown_environment: warn
```

**Regulated, same product:**

```yaml
profile: regulated

environments:
  prod:
    match:
      aws_accounts: ["999999999999"]
      clusters: [prod-use1]
      refs: [main, "release/*"]
    stance: forbidden
    assurance: proven
    require:
      separate_deploy_identity: true
    deny_credentials:
      files: ["~/.aws/credentials", "~/.ssh"]
      env: ["AWS_SECRET_ACCESS_KEY"]

  staging:
    match: { aws_accounts: ["888888888888"] }
    stance: read-only
    assurance: guarded

unknown_environment: deny
```

The difference between the two is a profile line and an assurance column. The engine, the evidence trail and the gates are identical.

### 2.5 Threat register, minimum coverage

Direct command-line use with credentials for a forbidden environment · ambient credentials, including instance profile, cached single sign-on, default profile and cluster context · instance metadata service access · a structured tool reaching a control plane without a shell · push to an auto-deploying ref · editing a pipeline definition · editing auto-applied infrastructure code · deferred execution, including scheduled jobs, background processes, repository hooks, package lifecycle scripts and generated scripts · subagent grant escalation · disabling or reconfiguring thoth · substituting a modified runtime binary · routing the action through the human socially · credential reuse from repository content, state files or logs · dependency supply chain reaching a deploy hook · egress to an unapproved host by hostname substitution.

---

## 3. POL — Policy engine and configuration

**Build posture:** extend, do not rebuild. Adopt the upstream engine, format and loader. Add precedence, mandatory-rule locking, pinned central resolution and the fail-closed rule upstream lacks (gap G1). See section 1.

| ID | Pri | Requirement | Acceptance |
|---|---|---|---|
| POL-01 | P0 | Policy shall be expressed as data. No rule an operator is expected to tune shall live in a code literal. | Changing a forbidden action, protected path, tool class or risk tier is a configuration change plus a fixture |
| POL-02 | P0 | The configuration format shall support comments and multi-line rationale adjacent to the rule. | Every rule can carry its own reason. Adopt the upstream format rather than converting it. See section 1 |
| POL-03 | P0 | There shall be exactly one decision engine, consumed by every enforcement surface. | Startup gate, in-session gate and pipeline gate return identical verdicts on identical input, proven by one fixture set through all three. The named instrument is AGT's `SurfaceParityChecker` plus the ported differential harness (§1.1, §1.2). A parity claim with no instrument behind it is a defect |
| POL-04 | P0 | Every tool family shall reach the engine through a normalizer producing one canonical Action record. | A structured cluster-mutation call and its shell equivalent yield the same verdict |
| POL-05 | P0 | The engine shall deny a mutating action whose record is opaque or carries unresolved fields. | Fail-closed on ambiguity, one rule, one place. Not provided upstream, which defaults unclassified actions to review. See gap G1 |
| POL-06 | P0 | Configuration shall be schema-validated and versioned, rejected with a message naming the offending key and expected shape. | Unknown key is an error, not a silent no-op |
| POL-07 | P0 | The central policy source shall be able to mark a rule mandatory; downstream configuration cannot relax it. | Emptying the protected list from a project file is rejected |
| POL-08 | P0 | Precedence shall be: shipped defaults, then central policy, then project. | Deterministic, documented, inspectable |
| POL-09 | P0 | The central policy source shall be resolvable by immutable reference, and the resolved reference shall be recorded in every artifact. | A change under review cannot alter the policy that judges it. The reference is pinned, not floating. **Split 2026-09-01.** The *write-protection* half is satisfied by a runtime primitive: managed settings delivered by admin console, plist or HKLM are unwritable by the governed session (§1.4). The *pinning* half is not, and stays a build: managed settings carry no version identifier, so thoth supplies the immutable reference and the per-artifact stamp itself. **Do not close this requirement on the delivery half alone** |
| POL-10 | P1 | The resolved effective policy shall be printable with the origin file and line of every rule. | One command answers "why is this blocked" without reading a script |
| POL-11 | P1 | The kernel shall be pure: no filesystem, network or process access, unit-testable without a harness. | World facts are passed in |
| POL-12 | P1 | Adapters shall be registered by declaration, not by editing a dispatch chain. | |
| POL-13 | P1 | Lifecycle stages and risk tiers shall be declared in configuration, and prose documents shall render from that declaration. | Documentation cannot drift from the enforced configuration |
| POL-14 | P1 | Any generated machine-optimised policy form shall carry a freshness check failing the build when stale. | |
| POL-15 | P1 | Domain capability shall be packaged in modules enabled per project; a disabled module contributes nothing to context or policy. | |

### 3.1 The canonical Action record

Minimum fields: `source` as `parsed`, `structured` or `opaque` · `verbs` from the action catalog · `targets` as normalized resource references · `environment` as the matched environment name or `unknown` · `identity` · `deferred` · `unresolved`.

### 3.2 Layer boundaries

The kernel never learns about a tool. Normalizers never make a decision. Violating either is a design defect.

---

## 4. SUR — Surface coverage

**Build posture:** mixed. Exclusive tool-server allowlisting and tool classification are runtime primitives to configure. Semantic detection and the canonical Action record are net new, because upstream detection is regex over shell strings. See section 1.

| ID | Pri | Requirement | Acceptance |
|---|---|---|---|
| SUR-01 | P0 | Policy shall be evaluated for every tool capable of mutating state, local or remote. | Cloud and cluster tools delivered over a structured protocol are evaluated. Fixture proves it |
| SUR-02 | P0 | Unrecognised tools shall be denied on mutating or protected operations. | The terminal fall-through is deny, not allow and not warn |
| SUR-03 | P0 | Every tool available to the session shall be inventoried and classified as read-only, workspace-mutating or remote-mutating, and the classification shall drive enforcement. | Session start enumerates tools and halts on any unclassified one |
| SUR-04 | P0 | Structured tool servers reachable by the session shall be governed by an exclusive allowlist, not an additive one. | A tool server outside the allowlist does not load. This is the only control covering tools that never touch a shell. **Amended 2026-09-01: this is configuration, not build.** Satisfied by `allowManagedMcpServersOnly` with `allowedMcpServers`, or a deployed `managed-mcp.json` (§1.4). Thoth's work is to verify the setting is in force and to report it when it is not (INT-07, REL-12), never to reimplement it. Per §0.7 rule 2, that verification is a fixture, not an assumption |
| SUR-05 | P0 | Gate matchers shall be verified against the runtime's actual tool names; a mismatch shall fail loudly. | A dead matcher is detectable |
| SUR-06 | P0 | Command policy shall be evaluated per invocation, on the same normalized representation used for target extraction. | One leading read-only call cannot disable evaluation of a later mutating one. Quoted content is not deleted before rule evaluation |
| SUR-07 | P0 | Detection shall be semantic, not literal. | Flag reordering, directory flags, abbreviations and path-qualified or quoted binary names do not defeat a classifier |
| SUR-08 | P0 | Target extraction shall not lose the target to its own preprocessing. | Heredoc handling must not consume a redirect following on the same line |
| SUR-09 | P0 | Deferred and indirect execution shall be evaluated as execution. | |
| SUR-10 | P0 | Every fail-open path shall be enumerated and each shall be a recorded decision. | Missing configuration, unknown tool, internal exception, malformed input, unrecognised syntax, depth cap, lock timeout, **hook timeout**, and **non-blocking hook surface**. The last two are runtime properties, not thoth defects, and are non-optional entries: a timed-out `PreToolUse` hook does not block, and a `SessionStart` hook never blocks (gaps G5, G6) |
| SUR-11 | P0 | Where the runtime's isolation does not cover a class of process, that gap shall be named in the posture block and covered by a compensating control. | Processes running outside the runtime sandbox are disclosed, not assumed governed. `sandbox.enabled` and `sandbox.network.allowedDomains` are the compensating control where they reach; where they do not, which is structured tool servers and hooks (gap G4), the gap is named in the posture block rather than averaged away |
| SUR-12 | P1 | Gate entries shall declare an explicit timeout, and timeout behaviour shall be a recorded decision. | A slow path must not become a bypass. On this runtime a timed-out gate **is** a bypass: the call proceeds through the normal permission flow. The declared timeout is therefore an upper bound the OPS-03 budget must sit far below, and a timeout occurrence is an incident under CI-10, not a routine event. See open decision T11 |
| SUR-13 | P1 | There shall be exactly one gate manifest. | |
| SUR-14 | P1 | Tool grants shall be non-escalating: a delegated session shall never hold a capability its parent lacks. | Fixture proves it |

---

## 5. INT — Integrity and self-protection

**Build posture:** port and configure. The self-protection rule ports from the predecessor, the audit log comes from upstream, the settings lockdown is a runtime primitive. See section 1.

| ID | Pri | Requirement | Acceptance |
|---|---|---|---|
| INT-01 | P0 | Thoth's own configuration and registration shall be protected. | Minimum: policy files, gate manifest, distribution manifest, and the runtime settings that install them. **Amended 2026-09-01: the runtime-settings half is configuration, not build.** `allowManagedPermissionRulesOnly`, `permissions.disableBypassPermissionsMode`, `allowManagedHooksOnly`, `strictPluginOnlyCustomization`, `strictKnownMarketplaces` and `disableSideloadFlags`, delivered over an admin-only channel (§1.4). What remains thoth's is verifying these are in force and reporting one that is not (INT-07, REL-12), not reimplementing them |
| INT-02 | P0 | The integrity of the enforcement layer shall be verified before it is trusted. | Modification is detectable and detection halts |
| INT-03 | P0 | Editing a protected path shall require a fresh, scoped, independently produced review, and that requirement shall not be satisfiable by the session that wants the edit. | Carried forward from the predecessor's self-protection ADR, hardened against the self-issued-report path. See EVD-01 |
| INT-04 | P0 | The self-unlock loop shall be closed, or explicitly declared as friction and audit only with no security value. | See open decision T3 |
| INT-05 | P1 | The audit log shall be append-only against the session, and its unavailability shall be a signal. | A truncated log is worse than no log. Not satisfied by reuse alone: AGT's SDK logger is in-memory, and the durable adapter implementation truncates silently at 10,000 entries, rewrites the whole file on every append, and sits at a session-writable path (gap G7). Copy the chain-and-verify construction, append rather than rewrite, remove the truncation, and relocate the file per REL-02 |
| INT-06 | P1 | Waivers shall be attributable, time-boxed, logged, and uncreatable by the session through any route. | Including structured filesystem tools, string-constructed filenames and archive extraction |
| INT-07 | **P0** | **No control thoth claims shall depend on a third party's enforcement being correct.** Where a third-party gate covers the same action, thoth shall verify that gate's behaviour rather than assume it, and shall record its own independent verdict. | **Added 2026-08-29.** Every control named in thoth's posture output shall be one thoth itself evaluates. Where both thoth and a third party observe the same action, a disagreement shall be recorded, not resolved in the third party's favour by default. Subject to §0.2: at the in-session surface this means an independent **recorded verdict**, never a claim of prevention. Evidence for making this P0: a defect in an external plugin's gate was recorded as unfixable from inside this project, which was false, and that single unverified conclusion redirected roughly two days of effort into a sibling repository against a branch that was never installed |

---

## 6. EVD — Evidence and unlock trust

**Build posture:** the log is reused, the trust model on top of it is net new. Upstream provides tamper-evident logging and injection detection; it has no concept of a scoped, expiring, non-self-issuable unlock. See section 1.

| ID | Pri | Requirement | Acceptance |
|---|---|---|---|
| EVD-01 | P0 | An unlock shall be attributable to a completed review run, not to a file appearing on disk. | A report the gated session wrote itself is not an unlock. This closes a bypass observed in practice |
| EVD-02 | P0 | No field the session can write shall be trusted as a control decision. | Includes retry and block-state fields in any ledger |
| EVD-03 | P0 | A degraded scope check shall never resolve to pass. | |
| EVD-04 | P0 | A hint phrase in session-controlled text shall not downgrade a block. | Satisfied structurally, never by a detector: no gate reads a decision out of session-controlled text in the first place, which EVD-02 already mandates. AGT's injection detector may feed the audit trail as a signal and shall not be cited as this requirement's control (§1.1) |
| EVD-05 | P0 | Report freshness shall not be defeatable by touching a file. | |
| EVD-06 | P0 | An unlock shall apply only to the scope the report actually reviewed, on every gate. | |
| EVD-07 | P0 | A gate shall not accept the gated party's self-reported scope. | An absent or empty file list is not an allow |
| EVD-08 | P0 | The report-type match shall be exact, not a filename substring. | |
| EVD-09 | P0 | An unlock shall expire on both time and change. | Granularity per open decision T2 |
| EVD-10 | P1 | Report content shall be structurally validated, not only size-checked. | Required sections present, verdict from a closed vocabulary, counts consistent with listed findings |
| EVD-11 | P1 | Every persisted report shall carry structured metadata. | Scope, verdict, blocker count, finding count, evidence references, date, identifier of the code state reviewed |
| EVD-12 | P1 | The evidence bundle for a change shall be assembled deterministically and be sufficient for an external reviewer to reconstruct what was verified. | |
| EVD-13 | P1 | Verification commands shall run through a capture mechanism recording command, exit code and raw output durably, returning only a digest to the session. | A report cannot claim a check passed without a captured artifact |
| EVD-14 | P1 | Skipped, passed, failed and not-run shall be four distinct recorded states. | Any check not run cannot yield a shippable verdict |
| EVD-15 | P1 | Content passed into the session from any external source shall be delimited as data and marked non-instructional. | |
| EVD-16 | P1 | Session decision events shall be exportable to an external collector in a standard format, and export failure shall be visible. | Thoth owns its evidence path; no vendor-side session audit endpoint is available on this provider |
| EVD-17 | **P0** | **The unlock decision shall be read from a machine-readable declaration inside the report, never recovered from its prose.** The gate shall contain no natural-language recognizer for scope. | **Added 2026-08-29.** A report unlocks nothing unless it carries exactly one structured declaration naming the review type from a closed vocabulary, the review date, and the exact repo-relative paths reviewed as the subject. Zero blocks, two or more blocks, an unrecognised key, or an unparseable value all resolve to no unlock (EVD-03). A path present in the report's prose but absent from the declaration is not unlocked, and a path listed in the declaration is treated as reviewed regardless of what the prose says. Evidence for making this P0: the predecessor gate tried to recover subject-from-citation out of English, ran nine review rounds against one function without shipping, and in its measured state falsely unlocked 2 of 8 protected-path groups while a Scope line stating a file was *not* reviewed still unlocked it. Narrow the accepted input; do not parse arbitrary structure |

---

## 7. CI — Pipeline and control testing

**Build posture:** port the predecessor's pipeline patterns, including incident-keyed regression tests and mutation checking. Control tests (CI-07, CI-08) are net new and gated on T6. See section 1.

**Scope.** Thoth ships a gate that a pipeline can call, and tests its own controls. It does not own the pipeline, and it does not verify what a pipeline is configured to block. Whether a verdict is advisory or blocking is a delivery-pipeline decision.

**Where CI functionality lives:**

| Component | Repository | Reason |
|---|---|---|
| Gate engine, callable from a pipeline | thoth | One engine. POL-03 fails if duplicated |
| Control tests (negative tests proving containment) | thoth | They test thoth's claims |
| Thoth's own pipeline (tests, lints, secret scan, mutation checks) | thoth | It governs thoth |
| Per-repository wiring | consuming repository | A thin caller thoth ships as a template |

**The consuming plugin gets no gate logic of its own.** It is governed like any other consumer. A component that ships part of the engine that judges it rebuilds the problem centralization exists to solve.

| ID | Pri | Requirement | Acceptance |
|---|---|---|---|
| CI-01 | P0 | Thoth's own tests and lints shall run on every change. | |
| CI-02 | P0 | The gate evaluation shall be runnable in a pipeline, from the repository at a proposed state, returning the same verdict as the local gate. | Same kernel, same policy. Whether a pipeline treats that verdict as blocking is the pipeline's concern, not thoth's |
| CI-03 | P0 | The pipeline gate shall resolve policy from the pinned central reference, never from the working tree under evaluation. | A change cannot supply the rules that judge it |
| CI-04 | P0 | The gate job shall not execute repository-supplied code before evaluating policy. | |
| CI-05 | P0 | Pipeline definitions shall be protected paths in every profile by default. | |
| CI-06 | P0 | Third-party pipeline dependencies shall be pinned to immutable references. | |
| CI-07 | P0 | Each containment control shall have a negative test attempting the forbidden action and recording the denial. | Including paths that never touch a shell |
| CI-08 | P0 | A control test shall record which layer produced the denial. | A denial produced only by thoth is a weaker result than one from the credential or platform layer |
| CI-09 | P1 | Control tests shall run on a schedule; a stale or failing control shall surface in the posture block. | |
| CI-10 | P1 | A failed control test shall be treated as an incident, not a test failure. | |
| CI-11 | P1 | A pipeline failure shall name its unlock, in the same form as a local denial. | |
| CI-12 | P1 | Local and pipeline surfaces shall be proven to agree by a differential test. | |
| CI-13 | P2 | Control results shall carry references to the frameworks the organisation is assessed against. | Confirm the applicable set with a compliance function; do not assert obligations |

---

## 8. QA — Thoth's own quality

**Build posture:** port. The predecessor's fixture discipline and mutation harness transfer directly. See section 1.

| ID | Pri | Requirement | Acceptance |
|---|---|---|---|
| QA-01 | P0 | Every policy rule shall have at least one positive and one negative fixture. | Coverage check fails the build when a rule has none |
| QA-02 | P0 | No policy rule may be added or changed without an accompanying fixture. | Enforced in the pipeline, not by review discipline |
| QA-03 | P0 | Every known bypass shall have a named regression case failing before its fix and passing after. | Named for the finding it closes |
| QA-04 | P0 | Every human-only rule shall have a positive block test. | |
| QA-05 | P0 | Test fixtures shall not write into live governance artifacts. | Test isolation verified |
| QA-06 | P0 | The regression suite shall itself be tested by mutation: each named regression class shall be proven to fail the suite when reintroduced. | A passing suite that cannot detect its own regression class is not evidence |
| QA-07 | P1 | Configuration shall be validated against a schema with errors naming the field and expected shape. | |
| QA-08 | P1 | An install smoke test shall run on the packaged artifact. | |
| QA-09 | P1 | Contract lints shall run on every change. | Referenced templates exist, every denial path names an unlock |
| QA-10 | P1 | A source change without a test change shall fail, with documented exempt categories. | |
| QA-11 | P1 | Tests shall not assert against the text of source files, with an in-diff escape hatch requiring a written reason. | |
| QA-12 | P1 | Diff scanning shall run in the pipeline: secrets, injection patterns, encoded payloads. | |
| QA-13 | **P0** | A finding class that has recurred shall be promoted into a lint before it can recur again. | **Promoted from P2 on 2026-08-24.** A class that has been found twice is a lint before the third story ships; promotion is a required task at that ship-close, not a backlog item. Evidence for the promotion: in the predecessor project three of three MED findings in one story were recurrences of classes already found and already written down as rules (fabricated authority citation, cross-repo issue number, hand-typed completeness figure contradicting its own instrument). A rule a reader must remember is not a control |
| QA-14 | P0 | Every reference in a changed file shall resolve to something that exists in this repository. | Document paths, `Issue #N`, `ADR-NNNN`, `docs/reviews/` report filenames and `path:line` citations. Two specific shapes are non-optional, because both have already shipped: a citation to an authority that does not exist anywhere in the tree, and an issue number belonging to a different repository. The checker parses this project's own house citation style, including a `path:line` reference embedded mid-sentence; a checker that silently skips what it cannot parse is a failing checker, not a passing one (QA-16) |
| QA-15 | P0 | A numeric completeness claim shall carry a machine-readable reference to the instrument that produced it, and the pipeline shall re-run that instrument and fail on a mismatch. | Closes the gap between `CLAUDE.md`'s existing "no hand-derived completeness claims" rule and its enforcement. "46 of 39" in a header while the file's own instrument reports 44 of 37 is the exact defect. Applies to prose, code comments, review reports and posture output alike |
| QA-16 | P0 | An instrument known to produce wrong results shall be treated as an incident, not a known issue, and shall fail the build until fixed or explicitly disabled with a recorded decision. | A broken instrument is worse than no instrument: it silently converts a mechanical check back into a human one while still reporting green. Two instruments in the predecessor project were known broken across multiple sessions (a citation resolver that could not parse the project's own citation style, and a checksum formula that excluded a state from its denominator), and reviewer time paid for both every session. Disabling one is a recorded decision naming what is no longer checked, never a silent skip |
| QA-17 | **P0** | **The runtime-primitive inventory in §1.4 shall be re-checked by a running instrument, and a requirement this document marks *build* while a shipped runtime setting already covers it shall fail the check.** | **Added 2026-09-01, and it exists because the failure has now happened twice.** The instrument reads the runtime's published settings surface, diffs it against the keys §1.4 names, and fails on any key covering a requirement §1.4 does not name. It runs on a declared cadence and at every version-floor bump. A hand-read of the settings reference is not an instrument (QA-15, and `CLAUDE.md`'s hard rule against hand-derived completeness claims). First occurrence: upstream AGT moved under §1.1 between drafts (`docs/spikes/2026-08-25-agt-docs-recheck.md`). Second: the runtime itself shipped six admin-enforceable keys covering SUR-04, INT-01 and half of POL-09 while all three stayed marked *build*. This is the enforcement mechanism for §0.7 rule 6 |

---

## 9. OPS — Runtime behaviour

**Build posture:** mostly verification of reused behaviour, plus one known conflict. OPS-01 is contradicted by upstream's unconditional writes (gap G2) and must be resolved before the wrap is called complete. See section 1.

| ID | Pri | Requirement | Acceptance |
|---|---|---|---|
| OPS-01 | P0 | In a repository with no thoth configuration, thoth shall do nothing and write nothing. | No files, no state, no log entries. Verified by a fixture. Upstream writes unconditionally, so this must be suppressed in the wrap or the requirement formally amended. See gap G2 |
| OPS-02 | P0 | Thoth shall never read, log or emit credential material. | Posture output names identities and outcomes, never secrets. Fixture asserts no secret-shaped content in any artifact |
| OPS-03 | P0 | Each gate shall have a stated latency budget and meet it on the largest realistic input. | Startup gate and per-action gate budgeted separately. Measured, regression-tested. The per-action budget is bounded above by the hook timeout, because exceeding it is a bypass rather than a delay (SUR-12, gap G6). This is also why a `proven` probe belongs in the startup path and never in the per-action path (OPS-04) |
| OPS-04 | P0 | The per-action gate shall make no network call. | Network use is confined to the startup gate, where probes require it |
| OPS-05 | P1 | Concurrent sessions in one repository shall not corrupt shared state. | Either safe concurrency or explicit refusal |
| OPS-06 | P1 | Configuration scope in a monorepo shall be defined. | Per open decision T4 |
| OPS-07 | P1 | Behaviour with no network shall be defined. | Which checks degrade, which halt, how the posture block reports it |
| OPS-08 | P1 | Thoth shall emit no telemetry by default; any telemetry shall be opt-in with a documented payload and destination. | |
| OPS-09 | P2 | State shall be reconciled against observable reality at one point before any gate decision, distinguishing repairable drift from terminal blockers. | |

---

## 10. REL — Installation and onboarding

**Build posture:** net new, but small. See section 1.

The user installs thoth themselves, once, on their own machine. It then governs every repository they open. It is not installed per repository, and a repository does not carry its own copy of the engine or the rules.

Fleet distribution is out of scope. Nothing in this document assumes a device-management channel, and no requirement may be written that depends on one.

| ID | Pri | Requirement | Acceptance |
|---|---|---|---|
| REL-01 | P0 | One installation shall govern every repository on the machine. | No per-repository install step. Opening a new repository requires configuration at most, never installation |
| REL-02 | P0 | Thoth's installed files and its resolved policy shall live outside every governed repository, and writes to them shall be denied by policy in every profile. | A governed session cannot edit the engine or the rules through any route, including structured filesystem tools and string-constructed paths |
| REL-03 | P0 | Installation shall be idempotent and non-destructive. | Running twice changes nothing. Running on a partial install completes only what is missing |
| REL-04 | P0 | Initialisation shall never invent project facts. | Accounts, environments, protected paths and forge details are asked for or left explicitly unset |
| REL-05 | P0 | Initialisation shall produce a working minimal configuration and print the resulting posture. | A new user sees what is and is not enforced before their first change |
| REL-06 | P0 | The policy schema shall be versioned; an upgrade requiring migration shall fail loudly rather than reinterpret silently. | |
| REL-07 | P0 | A verification command shall report which policy is actually in force, and the pinned reference it resolved from. | Verification on this runtime is inferential; this command is the primary evidence. See section 11 |
| REL-08 | P1 | Adopting thoth mid-project shall be supported and documented. | Detect a partial prior run, seed at real state, never a generic template |
| REL-09 | P1 | Versioning shall be semantic, with a changelog entry per user-visible change, and policy changes called out as tightening or loosening a gate. | |
| REL-10 | P1 | Generated surfaces shall live in a directory marked generated, carry a do-not-edit header, and be verified fresh in the pipeline. | |
| REL-11 | P2 | A pre-release channel shall exist so policy changes can be trialled before reaching the default install. | |
| REL-12 | **P0** | **A target repository shall receive thoth's own observation surface at install time, and the verification command shall report which controls are actually registered and live.** | **Added 2026-08-29.** REL-07's output shall distinguish a control that is documented from one that is registered and running, and shall name whose it is (thoth's own, or a third party's). A control that is documented but not registered shall report as **not in force**. Installing alongside a third-party governance plugin shall compose with it rather than defer to it (INT-07). Nothing in this requirement authorises a prevention claim at the in-session surface (§0.2, §0.6) |

---

## 11. Known limits of the runtime

These are properties of the environment thoth runs in, not defects in thoth. Each must be disclosed in `SECURITY.md` and reflected in the posture block. None may be papered over in published copy.

| Limit | Consequence for thoth |
|---|---|
| Every in-session control is a client-side control, not a security boundary. Someone running a modified runtime binary bypasses all of them | Plane B remains "never certain". Plane A and Plane C carry the guarantees |
| Runtime isolation does not cover every process class; some run unconstrained on the host | SUR-04 exclusive allowlisting is load-bearing, not optional. SUR-11 requires the gap be named |
| Network allowlisting does not inspect TLS, so hostname-based egress control is defeatable | Real egress control belongs on an inspecting proxy at the network boundary. Thoth reports, never claims, egress containment |
| Runtime isolation is unavailable on some platforms | Affected platforms report the gap per ENV-12, or are excluded by policy |
| No attestation mechanism exists to prove a session is running the policy it claims | Verification is inferential: REL-07 output, pinned-reference reporting, decision export. `SECURITY.md` must say so plainly |
| Vendor-side session audit is unavailable on this provider | EVD-16 makes thoth's own export path the evidence of record |
| A `SessionStart` hook cannot stop a session. Exit code 2 on that event shows stderr to the user and the session proceeds | The halt belongs to `UserPromptSubmit`, the earliest surface that blocks. CTN-01 and CTN-04 are written against that surface. Gap G5 |
| A timed-out `PreToolUse` hook does not block; the tool call proceeds through the normal permission flow | Gate latency is a security property here, not a comfort property. SUR-12 and OPS-03 are written against it. Gap G6 |

---

## 12. Open decisions — do not invent answers to these

| # | Decision | Blocks | Notes |
|---|---|---|---|
| ~~T1~~ | ~~Startup-gate failure semantics: confirm by experiment that a failing gate prevents session start.~~ **ANSWERED 2026-08-24: it does not.** The runtime shows stderr and proceeds. Superseded by T1'. | CTN-04, CTN-01 | No spike needed. Both sides are documented, and AGT's own startup hook makes the wrong assumption (gap G5) |
| T1' | Which surface owns the halt: `UserPromptSubmit` (blocks and erases the prompt, earliest blocking point) or `PreToolUse` (blocks the call, but later than "before work begins")? And what does CTN-01's "before work begins" then mean in the acceptance text? | CTN-01, CTN-04 | `UserPromptSubmit` is the recommendation on the evidence. The choice is a scope call, not a technical unknown |
| T2 | Change-expiry granularity for an unlock: reviewed files, reviewed module, or the whole protected pattern? | EVD-09 | Too fine and reviewers re-run constantly |
| T3 | The self-unlock loop: close it, or declare the gate friction and audit only? | INT-04, OSS-02 | Both defensible. The ambiguous state is not |
| T4 | Configuration scope in a monorepo: one root, or composing per-package? | OPS-06 | |
| T5 | Who owns the tool classification catalog: shipped, central, or both with central overriding? | SUR-03 | Deny-by-default needs one to exist |
| T6 | Where do negative control tests run? | CI-07, CI-08 | Needs a rehearsal account and cluster that exist. Nothing in this lane is buildable until they do |
| T7 | Egress inspection: is TLS-inspecting egress control assumed present, or is egress reported as unverified? | ENV-12, threat register | The runtime's own hostname allowlist is defeatable. Thoth cannot supply this itself; it either depends on it or discloses its absence |
| T8 | Platforms without runtime isolation: excluded by policy, required to use an isolated environment, or accepted as a disclosed gap? | ENV-12, SUR-11 | |
| T9 | Licence. | OSS release | Apache-2.0 recommended for the patent grant and enterprise familiarity. AGT is MIT, so copying its source into an Apache-2.0 project is compatible with attribution retained. Confirm before the first Copy-verdict story lands |
| ~~T10~~ | ~~Which of AGT's policy formats is the delivery format, and is the tiered YAML the authoring format generated into it? AGT ships four mutually incompatible shapes: legacy flat YAML, a string-expression dialect, the ACS Rego manifest, and the adapter's `default-policy.json`.~~ ~~**ANSWERED 2026-08-26: the adapter's `default-policy.json` shape is the delivery format...**~~ **VOID as of 2026-08-30** (AGT out of scope, see `docs/decisions.md`'s 2026-08-30 row) — **RE-ANSWERED 2026-09-08, by S6 (Milestone #24):** the delivery format is real JSON, schema-validated by `src/policy/rule/schema.ts` (POL-06), read from three tiers per POL-08 — shipped-defaults (`src/policy/config/shipped-defaults.json`), project (`.thoth/policy.json`), both git-tracked files, and central, the one genuinely out-of-repo tier, delivered via the Windows registry channel `HKLM\SOFTWARE\Policies\Thoth\CentralPolicyJson` (`REG_SZ`, read via `reg query`, never a live network fetch — REQUIREMENTS.md §1.4's own "Managed policy delivery" row names the HKLM channel class this reuses, one level more specific: a thoth-owned key sibling to `...\ClaudeCode`'s reserved namespace, not a write into it). No separate "authoring format" exists or is needed — an admin/tool authors the central tier's JSON directly (or via whatever provisioning tooling a future story builds, see `docs/backlog.md`'s admin-provisioning-runbook line); there is no YAML-to-JSON generation step, so POL-14's freshness-check requirement does not apply to this delivery shape. `src/policy/config/central-source.ts`'s `CentralPolicySource` interface keeps the channel choice swappable (a future macOS/plist reader is an additive second implementation, not a rewrite) without reopening this decision. | POL-01, POL-02, POL-06, POL-07, POL-08, POL-09, POL-10 | Evidence: `docs/decisions.md`'s 2026-09-08 rows ("S6 intake NEEDS-INFO", "S6 Phase 1 plan ratified", "S6 pre-build review"); `docs/plans/S6-phase1-v2-2026-09-08.md` §3/§3a/§8; `src/policy/config/{central-source,loader,printer}.ts` |
| T11 | Gate timeout budget and semantics. AGT ships a 30-second hook timeout; a timed-out gate does not block. What is the OPS-03 per-action budget, and is a timeout an incident under CI-10? | SUR-12, OPS-03, CI-10 | Cannot be deferred past M3: it constrains what the per-action gate is allowed to do |
| T12 | Does a decision-export path exist in AGT's TypeScript surface at all? The CloudEvents and OpenTelemetry paths are specified on the Python side; nothing in the npm SDK exposes a sink or exporter. | EVD-16, OPS-08 | If absent, decision export is a build, or both requirements are deferred with a disclosed gap. Resolve before M4 planning |
| T13 | ACS re-evaluation trigger. AGT's v5 direction is a Rust decision kernel (stateless, deterministic, fail-closed) exposed through a napi binding, currently `0.3.1-beta` and marked as subject to change before general availability. | Nothing today | Not adoptable now, and TypeScript-only does not exclude it later. Set a re-evaluation at ACS general availability rather than assuming the door is closed |
| T14 | **Audit substrate.** INT-05 requires an append-only log the session cannot truncate. The current plan copies and fixes the adapter's file-based hash chain (gap G7). Two candidates remove the file from the governed machine altogether: the runtime's OpenTelemetry tool-execution export, and on this runtime scope (§0.5) a cloud-side trail written to an immutable sink. | INT-05, EVD-16, gap G7 | Not a technical unknown, a substrate choice. **Decide before the G7 copy-and-fix work is scheduled**, because that fix is wasted effort if the log moves off the machine. §0.2 applies unchanged: a cloud trail records API calls, not which policy version was in force, so the artifact stamp stays thoth's either way |
| T15 | ~~**Policy-engine substrate.** AGT's `PolicyEngine` is the current choice (§1.3 row 2). Cedar is a candidate: it is the language AGT's own `CedarBackend` wraps, it is what the provider's agent control plane evaluates, and adopting it directly would remove gap G9's version skew inside a single AGT release.~~ | POL-03, gap G9, §1.7's five named interfaces | ~~Resolve by measurement, never by opinion: run M1.5's differential harness against Cedar exactly the way §1.7 says to run it against AGT. **Do not reopen before M1.5 exists**, because without the reference implementation the comparison is a claim. §1.7's structure already makes this a swap behind one named interface rather than a rewrite~~ **SUPERSEDED 2026-09-01 by ADR-0021.** ADR-0021 (Accepted) already evaluated this exact shape — `PolicyEngine` reuse for the policy kernel — against verified facts and landed BUILD, native, no AGT wrap, for all six architecture shapes. This row's premise ("AGT's `PolicyEngine` is the current choice") no longer holds, and its resolution path (an `M1.5` differential harness, a `§1.7` five-interface swap) belongs to the pre-pivot wrap plan the fresh 17-story breakdown replaced (`docs/decisions.md`, 2026-08-30). Whether thoth should adopt Cedar as its own native rule-expression language, independent of any AGT wrap, is a genuinely different question nothing here has asked yet — open it under a fresh T-number if and when it matters, rather than reviving this one |
| T16 | **Containment by workspace versus containment by probe.** Where a governed session runs in a controlled remote workspace that never held a credential for a forbidden environment, incapability is a property of the deployment rather than something an executed probe must re-establish per session. | ENV-04, CTN-01, CTN-02, CTN-03, CTN-08, CTN-13, M5 scope | **Deliberately unanswered, and deliberately not a requirement.** This document specifies the engine, not a deployment topology. An answer would reshape M5, which §13 names as the centre of gravity, more than any other open decision here. Gated on evidence from a real evaluation rather than on argument. §0.2 still binds whichever way it lands: a deployment property reported as `proven` needs an executed check that it holds, not an assertion that it was configured |

---

## 13. Milestones

Sequenced. Each is a candidate story batch.

| # | Milestone | Contains | Blocked by |
|---|---|---|---|
| **M1** | **Protect the baseline** | CI-01, QA-01 to QA-06, **QA-13 to QA-17** (QA-17 added 2026-09-01), OSS-01, INT-01. Plus: an ADR proposing the §1.7 wrap architecture (thoth owns the verdict, AGT plugs in behind five named interfaces), proposed and reviewed, never self-accepted | Nothing. Start here |
| **M1.5** | **Port the reference** | Port the predecessor's detector, its 185-assertion suite, the mutation harness and the differential rig (§1.2). Nothing is wired live; this establishes the reference implementation every later parity claim is measured against | M1 |
| **M2** | **Wrap and verify the engine** | POL-01 to POL-09, POL-14, QA-07. Adopt AGT's `PolicyEngine`, layering and declarative path rules; register the POL-05 rule and the mandatory-key delta on top (§1.3 rows 1, 2, 3). Acceptance is a *measured* differential against M1.5's reference plus a `SurfaceParityChecker` report, not an assertion | **M1.5.** |
| **M3** | **Surface coverage and self-protection** | SUR-01 to SUR-14, POL-04, POL-05, INT-02 to INT-07 (INT-07 added 2026-08-29). POL-04 is registration of the ported normalizers as `FacetRegistry` extractors, not a new registry | M2. T5, T11 |
| **M4** | **Evidence and unlock trust** | EVD-01 to EVD-17 (EVD-17 added 2026-08-29). EVD-01 to EVD-11 are a port of the unlock economy; EVD-12, EVD-13 and EVD-16 are the build | M2. T2, T3, T12 |
| **M5** | **Environments and containment** | ENV-01 to ENV-16, CTN-01 to CTN-13, CI-02 to CI-13 | M3. T1', T6, T7, T8 |
| **M6** | **Runtime hardening** | OPS-01 to OPS-09, QA-08 to QA-12 (QA-13 to QA-16 moved to M1) | M3 |
| **M7** | **Installation and onboarding** | REL-01 to REL-12 (REL-12 added 2026-08-29) | M5 |
| **M8** | **Open-source readiness** | OSS-02 to OSS-14 | M7. T9 |

M1 first is not negotiable.

**QA-13 to QA-16 belong in M1, not later, and the reason is a measured one.** These four are the project's own measuring instruments: the thing that checks a citation resolves, the thing that checks a number came from a script, and the rule that a broken instrument is an incident. Every milestone after M1 leans on them, and a defect class they do not catch gets caught instead by a review round, which costs a dispatch, a read, a report, a fix-now pass and a re-verification. In the predecessor project three of three MED findings in one story were classes these lints catch, two of them recurrences of classes already found in earlier stories, and two instruments were known broken across multiple sessions while reviewers absorbed the difference by hand. Building the instruments before the code they measure is the whole point of a milestone named "protect the baseline".

**M1.5 before M2 is also not negotiable, and the reason is narrow.** M2's acceptance criterion is a differential test proving the wrapped engine returns the reference verdict on every fixture. A differential test needs a reference. The predecessor's detector and its 185 assertions are that reference, and the differential harness was built to run exactly this comparison. Without M1.5, M2's acceptance degrades from a measurement into a claim.

**M2, M3 and M7 shrank again on 2026-09-01, and M5 did not.** Managed settings absorbed SUR-04 outright, the runtime-settings half of INT-01, and the delivery half of POL-09, moving all three from *build* to *configure and verify*. Nothing in that amendment touched ENV, CTN, or section 6. The pattern is now twice-confirmed rather than asserted: the parts of this document that upstreams keep absorbing are the parts about *actions*, and the parts nothing absorbs are the parts about *capability* and about *evidence that unlocks*. Plan on that continuing.

**The centre of gravity is M5.** M2, M3 and M4 all shrank when the ledger was rebuilt, because their hardest requirements resolved to AGT reuse or to ports. Environments, stances, assurance levels and executed probes did not, and will not: that gap is a difference in what AGT is for, not a maturity gap that closes by waiting (§1.5). Plan the schedule around M5, not around the wrap.

---

## 14. OSS — Open-source readiness

| ID | Pri | Requirement | Acceptance |
|---|---|---|---|
| OSS-01 | P0 | Full history shall be scanned for secrets, credentials, real account identifiers, internal hostnames and personal data before the repository is public. | A working-tree scan is not sufficient |
| OSS-02 | P0 | `SECURITY.md` shall state the trust model, the ownership split across planes, the known runtime limits from section 11, and the location of the residual register, before any feature description. | |
| OSS-03 | P0 | No published copy shall claim enforcement for a layer thoth only verifies. | A lint over description fields |
| OSS-04 | P0 | A vulnerability disclosure process shall exist with a contact and a stated response window. | |
| OSS-05 | P0 | One name shall serve repository, package and command namespace. | |
| OSS-06 | P0 | Policy verdicts, denial messages, audit entries, evidence bundles and control results shall use plain professional vocabulary with no themed terms. | A compliance reader never meets the theme |
| OSS-07 | P0 | Report-type tokens shall be treated as a contract. | Rename only with an alias map and a test proving every historical report resolves to the same decision |
| OSS-08 | P1 | Every themed term shall map one to one onto a plain term, defined once in a glossary. | |
| OSS-09 | P1 | Product and self-governance output shall be visually separable at the top level, with a README line explaining the dogfooding. | |
| OSS-10 | P1 | Personal and organisation-specific references shall be removed from shipped files. | |
| OSS-11 | P1 | The residual register shall be published, kept current, and linked from the README. | |
| OSS-12 | P1 | Documentation shall cover overview, install, quickstart, trust model, configuration reference, profiles, extending, and adopting mid-project. | Configuration reference generated from the schema so it cannot drift |
| OSS-13 | P1 | Issue and change-proposal templates, code ownership and a contribution policy shall exist. | Policy directory and kernel require owner review |
| OSS-14 | P2 | A public roadmap shall distinguish what is enforced today from what is planned. | |

---

## 15. Definition of done for v1

1. Every P0 requirement has a passing test, or a recorded and dated acceptance of the gap.
2. The threat register has no entry without a control and a test.
3. The same repository runs correctly under `standard` and under `regulated`, differing only by profile, with posture block and artifact stamps differing accordingly.
4. Every containment control has a passing negative test recording which layer denied.
5. Local, startup and pipeline surfaces provably agree on one fixture set.
6. The startup gate is proven to fail closed by fault injection.
7. `SECURITY.md` states the trust model and the section 11 limits, and no published claim exceeds them.
8. Git history is scanned and clean.
9. A new project can be initialised and take one change to a reviewed, evidenced state with a complete evidence bundle.
10. A single installation governs every repository on the machine, and REL-07 correctly reports the policy in force and the reference it came from.
