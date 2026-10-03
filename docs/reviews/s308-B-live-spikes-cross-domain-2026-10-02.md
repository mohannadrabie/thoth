# #308 story B (live spikes) - cross-domain review (Ra), 2026-10-02

[cross-domain-reviewer] Cross-Domain Reviewer (Ra) - scanning the seams between reviewer lanes
📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog (fp d37bef7) [CACHE=HIT]

Scope s308-B, tier STANDARD, commits de4c08e + 27ffe48 (evidence B1-B6, ledger, 11 harness .mjs, plan). Read-only.

## Lanes
- code-reviewer (Anubis): evidence-vs-raw-output, scrub, dispositions; report docs/reviews/s308-B-live-spikes-code-review-2026-10-02.md. Not re-listed here (budget line and N13 re-read only in chat are theirs).
- Mine: whole 38-ADR catalog vs the diff, downstream seams D/E/F/J/K, doc staleness.

## Cross-domain ADR verdict (diff = docs + .mjs under docs/qa; no src/hooks/settings edit)
| ADR | Verdict |
|---|---|
| SE ADR-0005 (unit tests with new behavior) | No collision: harness is evidence tooling, no product behavior. |
| SE ADR-0010 (gates, no suppression) | No collision: eslint ignores docs/**; tsconfig include is src only; node --test does not discover run/scrub/show names. |
| SE ADR-0016/0019/0020 (port/self-protection) | N/A: no ported files, no .claude-plugin edit. |
| SE ADR-0021 (kernel purity, audit log outside session reach) | No collision: nothing under kernel/gate; B only executes the hook. |
| THOTH-ADR-0001/0002/0003 | No collision: fixture and allowlist untouched. node src/secret-scan/pre-commit-scan.ts PASS, 0 blocking, 275 allowlisted. |
| devops ADR-0001..0010 | N/A: no IaC. |

No ADR names an information-exposure rule for hook command lines in tool_result text (B2 observation): no collision.

## Seam findings
1. [MED][code-traced] B4 x central-source.ts:108 x D/F. B4 (docs/qa/s308-live-spikes/B4.txt, SPIKE_ENV_PROBE = from-settings-env seen by the hook; profile source = project only) proves a settings env block reaches the hook process. The gate runs loadEffectivePolicy with defaultCentralPolicySource on every call (hooks/pretooluse-kernel-gate.mjs:176-180); that builds the path from env.SystemRoot or env.windir plus System32/reg.exe (src/policy/config/central-source.ts:108) and executes it. AC-3j-4 (hook-import-pins.test.ts:79-80) pins the read as a known allow-set entry, i.e. a trusted input; B4 makes it session-writable. Domains in tension: D (launcher maps exit codes to 2) vs the central-policy layer. A SystemRoot pointing at a directory holding a program named reg.exe is not an exit-code fault, so D cannot close it; a SystemRoot to a nonexistent dir (exit 134) is closed by D. Distinct from the NODE_OPTIONS fail-open being handed to the human. Minimal fix: state in D6/D3 that the launcher does not defend env-chosen binaries; then either central-source stops reading env, or F treats env-block carriers as gate-critical; one named test either way. Exposure: ~100% of gate invocations on Windows read env.SystemRoot, basis: counted in code; share of sessions where an env block sets it: not measured, so non-blocking (activation not yet wired). Issue #397.
2. [MED][derived] F deny-rule set scope. B4 ran with --setting-sources project only. Env blocks are also carried by .claude/settings.local.json (gitignored; hooks/sessionstart-tool-enum.mjs:487 already names it as an invisible env carrier) and the user settings file. F1 says "settings files" without naming them. s7 plan U-9 settled local for CLAUDE_PROJECT_DIR only; user and managed are unrun. UNPROVEN-pending-verification: rerun profile b4 with --setting-sources local, then user (harness/run.mjs; Manager or human; about USD 0.03 each). Until then F lists project, local and user settings paths in its derived list and tests them. Test name: activation-preconditions: every env-carrying settings path is denied. Tracked under #397.
3. [LOW][code-traced] B3 double-underscore ambiguity vs normalizer. The live runtime keeps "__" in names: server a__b arrives as mcp__a__b__plain_tool, and the accented cafe server as mcp__caf___plain_tool (B3.txt hook-received tool_name). parseMcpToolName (tool-class-format.ts:105-118) splits at the first "__" and rejects a tool segment containing "__" or starting "_" (tests N3 line 82, N5 line 173), so both are opaque; the real hook denied them via POL-05 (B3.txt lines 157, 174, 193). Fail-closed, premise holds. Cost: such servers are unreachable by rules and the deny reason (source is opaque) has no unlock clause (PRINCIPLES rule 2). The 8 knownConnectors sanitize to no "__" or edge "_" (ran sanitizeMcpName over the fixture), so no current entry is hit. Only a BMP character was tried; an astral character (JS regex without u flag emits two "_", runtime count unknown) is unmeasured. Route to E/H wording (X-11) as a note.
4. [LOW][derived] B2 side observation: on exit 2 the tool_result shown to the model is "PreToolUse:Bash hook error: [full command line]: stderr" (B2.txt, b2-close). In production that is the settings command with the absolute gate or launcher path. No ADR forbids it; the gate location is not secret from an agent that can read the repo. Note for D: the launcher command string becomes model-visible; keep it free of secrets.

## Seams checked, sound
- D x B4: env reach is yes, so the launcher cannot assume a clean env; D5 disclosed limit stands. U-9 (CLAUDE_PROJECT_DIR not overridden; gate resolves fixture module-relative) is consistent with B4.
- E/J x B1/B6: B6 shows mcp__.* matches an MCP call and the real gate denied an unclassified server (AP-3 behavior). B1 timed the deny path only (no Bash allow path exists until E rules ship), so J must re-time the allow path; no later allow-path latency claim has a B basis.
- K: nothing in B touches it.
- B5: runs of 441/512/668 chars delivered untruncated; 2000/10000 rungs unreachable and not run, so the 512 cap stays a fragment cap, not a proven reader cap.

## Coverage gaps
- Harness .mjs files (11) in docs/qa: no lane owns code under docs/qa; intentionally low-risk (not run in CI, not imported, secret scan clean, lint/type ignore docs). Fine as evidence.
- Statements B supersedes (editorial; append a decisions row, do not edit): docs/STATE.md:307 "still unrun ... whether a settings env block reaches hooks"; Phase 0 X-8 row; s7a plan line 171 "still unmeasured".
- QA-14 resolver in diff mode: FAIL 2 of 182, both in untracked docs/reviews/s308-A-adr-red-team-2026-10-02.md (not part of the B diff); no B file in the failure list.

## Verdict
APPROVE-WITH-CONDITIONS (non-blocking): (a) D and F plans cite findings 1 and 2 before build; (b) Manager records B4 as a new decisions row.

Single next action: carry Issue #397 into the D and F plans (D6 wording, F1 path list, one named test each) before either builds.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][code-traced] central-source.ts:108 + gate.mjs:176 - settings env block (B4-proven) can set SystemRoot/windir, steering the reg.exe the gate execs every call; D exit-code launcher does not cover it; fix: state limit in D6, stop reading env or protect carriers, one named test (#397)
2. [SUSPICION][MED][derived] F1 "settings files" unnamed; B4 covered project scope only, local/user env reach UNPROVEN-pending-verification (rerun b4 with --setting-sources local, user); F must list all three paths
3. [ISSUE][LOW][code-traced] tool-class-format.ts:105-118 - a__b / accented-name servers unreachable (opaque, no unlock clause), fail-closed, no current fixture entry affected; note for E/H
4. [SUSPICION][LOW][derived] B2.txt b2-close - runtime shows model the hook full command line on exit 2; no ADR; keep launcher command secret-free
5. [CLEAN][demonstrated] ADR catalog (38) vs diff: no collision; pre-commit secret scan PASS, 0 blocking
6. [CLEAN][code-traced] harness .mjs in docs/qa: not linted/typed/test-discovered, no ADR-0005/0010 hit
7. [CLEAN][code-traced] B3 normalizer premise (N3/N5/N13) holds; real hook denied dunder cases fail-closed
8. [CLEAN][code-traced] B6/B1/B5 consistent with E/J/H plans (B1 deny-path only: J must re-time allow path)
counts: issues=2 suspicions=2 clean=4
evidence: demonstrated=1 code-traced=5 derived=2
checks=pre-commit-scan PASS 0 blocking/275 allowlisted; completeness-claims PASS 2 files; gate-matcher-drift PASS 42 names; recurring-findings PASS 3; reference-resolver diff FAIL 2/182 (both in untracked story-A report, none in B files); fixture-isolation VACUOUS-PASS; skipped=0
adr=HIT(38, whole catalog)
report=docs/reviews/s308-B-live-spikes-cross-domain-2026-10-02.md
