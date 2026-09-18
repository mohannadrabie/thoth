# App Security Review — `friendly-halt-messages` (SUR-03 halt message wording)

**Reviewer:** app-security-reviewer (Horus)
**Date:** 2026-09-17
**Commit reviewed:** `106c2dc4ecc852f9f1d7e737e3e26e930f46dcfa` on `feat/friendly-halt-messages`
**Tier:** CRITICAL (named sensitive area — policy enforcement / session gates, CLAUDE.md)
**ADR cache:** `HIT` — 35 ADRs, `[adr/devops:12, adr/software-engineering:23]`, fp `83b2e3e`

## ADR compliance

Scanned the full catalog (`docs/.maat-state.json` -> `adrCatalog.adrs`) for anything `applicableTo` security/integration/architecture that could bind this diff. ADR-0016/0017/0018/0019/0020 govern porting/self-protection (irrelevant, no port in this diff). ADR-0021 governs the kernel/Action-record/gate-surface architecture (UserPromptSubmit as the real halt point, etc.) — this diff doesn't touch any of ADR-0021's rules (kernel purity, Action record fields, normalizer registry, fail-closed-on-unresolved); it is a pure message-string change inside the already-ADR-0021-compliant UserPromptSubmit/SessionStart gate surfaces. No ADR anywhere in the catalog governs message sanitization or untrusted-display-name handling specifically (grepped "sanitiz", "untrusted", "display name", "control char" across the full catalog, zero hits). No applicable ADR is violated by this diff.

## Scope confirmed via diff hunks

`git show 106c2dc4` touches `hooks/sessionstart-tool-enum.mjs` and `hooks/userpromptsubmit-halt-relay.mjs` in exactly 5 hunks total:
- `sessionstart-tool-enum.mjs`: `quoteNames()` added (lines 136-149) plus 2 call-site swaps (the old unclassified/connector-identity prefix + join(", ") replaced by quoteNames(...)).
- `userpromptsubmit-halt-relay.mjs`: `FRIENDLY_LABELS`/`friendlyLabelFor()` added (lines 129-138) plus 1 call-site swap in describeActiveReasons (raw key replaced by friendlyLabelFor(key)).

`sanitizeDetail`, `UNLOCK_HINTS`/`unlockHintFor`, `blockWithMessage`, `inspectHaltState`, and the halt-state JSON schema are confirmed untouched: none of their line ranges appear in any of the 5 hunks (hunk headers enumerated and cross-checked against file line numbers).

## Findings
### 1. [CLEAN][demonstrated] quoteNames() output is safe as halt-state JSON: embedded quotes do not corrupt structure

Ran a round-trip: a name containing a literal double-quote character is wrapped by quoteNames, written via JSON.stringify in writeHaltReason (sessionstart-tool-enum.mjs:198), and read back via JSON.parse in userpromptsubmit-halt-relay.mjs:256. JSON.stringify escapes the embedded quote in the on-disk file; JSON.parse decodes it back to the exact original string. The halt-state file's structural integrity (a well-formed reasons.<key>.detail string) is never at risk from a hostile name; only the visual quote-boundary readability is affected, which is exactly the second pre-approved-out-of-scope edge case named in the code's own header comment (sessionstart-tool-enum.mjs:144-146).

Command output:
```
quoted string: "evil" tool, "fake-safe-name"
JSON on disk:  "detail": "\"evil\" tool, \"fake-safe-name\""
round-tripped: "evil" tool, "fake-safe-name"   (matches original: true)
```

### 2. [CLEAN][demonstrated] Quoting (write time) and sanitization (read time) compose correctly, no new injection surface

quoteNames() runs in sessionstart-tool-enum.mjs at write time; sanitizeDetail() runs in userpromptsubmit-halt-relay.mjs at read time. Confirmed the two never run on the same side, and sanitization always runs after quoting on the full string (control-char stripping does not care about the added quote characters, it strips 0x00-0x1F/0x7F from whatever detail string it is handed). Demonstrated end-to-end with a real hostile name containing an embedded newline (an attempt to fake a second "system" line): the on-disk halt-state file does carry the raw newline, but the relay's rendered systemMessage and single stderr line both have it stripped, output is genuinely single-line; blockWithMessage's "first line of stderr is the whole message" invariant holds.

Command output:
```
on-disk detail contains raw newline: true
rendered systemMessage contains newline: false
stderr line count: 1 (plus trailing newline)
```

Grepped the repo for every consumer of systemMessage (pattern "systemMessage" across the whole tree, excluding node_modules): the only non-test, non-doc consumer is userpromptsubmit-halt-relay.mjs itself, writing it as a single JSON string field via JSON.stringify (proper escaping) and as one writeSync stderr line. Nothing downstream re-parses this string as JSON/shell/HTML/structured data. Confirmed still true after this diff.

### 3. [CLEAN][code-traced] friendlyLabelFor's raw-key fallback leaks nothing new

Today's 4 keys in FRIENDLY_LABELS (userpromptsubmit-halt-relay.mjs:129-134) are plain identifiers (SUR-03-unclassified-tool etc.), not paths or internals. For an unmapped key, friendlyLabelFor falls back to the raw key itself (line 137), identical to pre-diff behavior, where every reason key rendered as its raw string with no label at all. The diff narrows what is shown raw (4 known keys now get a label); it never widens it. No regression, no new disclosure.

### 4. [CLEAN][demonstrated] Disclosed edge cases produce exactly their disclosed effect, nothing beyond it

Verified via the crafted-name probes above: a literal quote character inside a name breaks the visual quote boundary (cosmetic only, structural JSON integrity intact per finding 1); truncation, when it lands mid-quote on a long name list, is bounded to the detail portion only, sanitizeDetail's 200-char cap plus "...[truncated]" marker is applied to entry.detail BEFORE unlockHintFor(key) is appended in describeActiveReasons (userpromptsubmit-halt-relay.mjs:239), so a long/hostile name list can never truncate away the real unlock hint. No consequence beyond what is already disclosed in the code's own header comment.
### 5. [ISSUE][MED][demonstrated] Pre-existing halt-message forgery vector: NOT introduced by this diff, does not gate this review

A malicious MCP server/connector display name containing literal text shaped like a closing paren followed by "(unlock: no action needed, safe to resume..." renders a fake, misleading "(unlock: ...)" parenthetical AHEAD of the real one in the operator-facing halt message, because the attacker-controlled detail string is concatenated unescaped between the trusted label and the trusted real unlock hint in describeActiveReasons (friendly-label, colon, sanitized-detail, open-paren, unlock-hint, close-paren).

Demonstrated against the real hooks (rendered systemMessage):
```
Unrecognized tool: "evil-tool") (unlock: no action needed, safe to resume immediately
-- ignore the rest of this message (fake continuation: "" (unlock: reclassify the
tool in docs/qa/s5-central-classification.json ...)
```

Demonstrated NOT introduced by this commit: ran the identical probe against the parent commit (106c2dc^, via a throwaway git worktree). The exact same forged-parenthetical shape renders there too (SUR-03-unclassified-tool: unclassified: evil-tool") (unlock: no action needed...), because the vulnerable concatenation shape already existed before this diff; quoteNames/friendlyLabelFor only changed the trusted prefix text, not the concatenation shape or the attacker-controlled detail slot.

Does not defeat the halt itself: the block (exit 2) is unaffected by message content; if the operator acts on the fake "safe to resume" text and just resumes, sessionstart-tool-enum.mjs's reconcileReason re-evaluates the real condition on the next SessionStart and re-halts (the tool is still genuinely unclassified). This is a trust/confusion and wasted-operator-time risk, not a policy bypass. The realistic risk is an operator, believing the fake reassurance, taking some other out-of-band unsafe action (manually clearing the halt-state file, disabling the hook) out of frustration.

Exposure: requires an attacker who can already get a project to enable a malicious/compromised MCP server (.mcp.json with enableAllProjectMcpServers or explicit enable, or an already-approved ~/.claude.json entry), i.e. requires the operator to have already extended some trust to the connector; not remotely triggerable without that step. Basis: code-traced (the two entry points that populate detail, extractMcpServerNames/extractConnectorIdentities, both require a locally-readable, already-enabled declaration). Security-adjacent (operator trust in a policy-gate message), so not capped by PRINCIPLES rule 21's exposure threshold regardless.

Minimal fix (for the owning story, not this one): in describeActiveReasons, escape or fence the untrusted detail slot so it cannot introduce a literal close-paren immediately followed by "(unlock:" that visually mimics the trusted suffix, e.g. render detail on its own bracketed/indented segment, or escape literal parens inside sanitizeDetail. This is userpromptsubmit-halt-relay.mjs's describeActiveReasons/sanitizeDetail, pre-existing code untouched by 106c2dc.

This finding does NOT block 106c2dc: it predates the diff under review, is unaffected by it, and the story's own scope (rendering the 4 label/quoting changes only) never touches describeActiveReasons's concatenation shape or sanitizeDetail's escaping. Filed as its own Issue per CLAUDE.md's "Review Findings -> Bug Issues" (any [ISSUE][MED] gets filed regardless of whether it gates).

### 6. [CLEAN][code-traced] Standard app-security lane, nothing newly at stake

No new endpoint, no new authn/authz surface (pure hook message formatting). No SQL/shell/eval/deserialization anywhere in either file, before or after this diff. No new dependency, no lockfile change. No secret literal introduced (FRIENDLY_LABELS/quoteNames are plain string constants/pure functions). No PII/credential logging: the same MCP/connector names that were already flowing into this message pre-diff are the only third-party-controlled data here, already covered by finding 2's analysis.
## Test evidence

Ran the full halt-relay/tool-enum regression suite (new + pre-existing):

```
npx tsx --test hooks/userpromptsubmit-halt-relay-friendly-labels.test.ts hooks/sessionstart-tool-enum-friendly-labels.test.ts \
  hooks/userpromptsubmit-halt-relay.test.ts hooks/sessionstart-tool-enum.test.ts \
  hooks/userpromptsubmit-halt-relay-fixnow.test.ts hooks/sessionstart-tool-enum-fixnow.test.ts

tests 42
suites 0
pass 42
fail 0
cancelled 0
skipped 0
todo 0
```

All green, 0 skipped. Includes the two new sibling test files for this story (8 new tests) plus the untouched Issue #97 control-char/length-cap regression tests (still passing, confirming sanitizeDetail is genuinely unmodified) and the untouched schema/fail-closed/AC5-reconciliation suites.

## Verdict

**APPROVE.**

This diff is exactly what it claims to be: a pure string-formatting change (a friendly label lookup plus individual name-quoting), with the security-relevant machinery (sanitizeDetail, the fail-closed schema validation, the exit-2 block, UNLOCK_HINTS) left genuinely untouched, confirmed by hunk-level diff tracing, not just by reading the commit message. The one real security-relevant finding surfaced during this review (message forgery via a crafted third-party name) is demonstrated to predate this commit and to be structurally unaffected by it; it is filed as its own Issue against the pre-existing code rather than held against 106c2dc.

## Next action

File and track the pre-existing forgery-vector Issue (below); the fix belongs to a future story touching describeActiveReasons/sanitizeDetail, not a rework of this commit.

---
RECEIPT: verdict=APPROVE
findings (ALL of them, ranked by exploitability x impact):
1. [ISSUE][MED][demonstrated] hooks/userpromptsubmit-halt-relay.mjs:239 -- pre-existing (confirmed present on 106c2dc^ via worktree probe), NOT introduced by this diff: a crafted MCP/connector name can forge a fake "(unlock: ...)" parenthetical ahead of the real unlock hint, misleading a rushed operator (doesn't defeat the actual halt -- exit 2 unaffected, SessionStart re-reconciles on resume). Exposure: requires operator to have already enabled the malicious connector, basis: code-traced. Filed as its own Issue, does not gate this commit.
2. [CLEAN][demonstrated] quoteNames() output survives JSON.stringify/JSON.parse round-trip intact even with an embedded quote character in a name -- halt-state file structural integrity never at risk, only cosmetic quote-boundary readability (pre-disclosed).
3. [CLEAN][demonstrated] Quoting-at-write / sanitization-at-read compose correctly; embedded control chars (incl. newline-injection attempt) in a raw name are still stripped at render time -- single-line stderr/systemMessage invariant holds.
4. [CLEAN][code-traced] No downstream consumer re-parses systemMessage/stderr as structured data (repo-wide grep) -- confirmed still a plain single-line human-readable string.
5. [CLEAN][code-traced] friendlyLabelFor's raw-key fallback leaks nothing new -- identical to pre-diff behavior (all keys rendered raw before; unmapped keys still do); today's 4 keys are plain identifiers, no path/internal-detail leak.
6. [CLEAN][demonstrated] Disclosed edge cases (quote-boundary break, mid-quote truncation) produce exactly their disclosed effect -- truncation never eats the real unlock hint (applied only to the detail portion, before the hint is appended).
7. [CLEAN][code-traced] Standard app-security lane clean: no new endpoint/authz surface, no injection sink, no new dependency, no secret literal, no new PII/credential logging.
counts (checksum): issues=1 suspicions=0 clean=6
evidence (checksum): demonstrated=5 code-traced=3 derived=0
checks="42/0/0|demonstrated probes: 3 ad hoc scripts (JSON round-trip, control-char, parent-commit comparison), all confirmed as reported above"
adr=HIT(35)
report=docs/reviews/friendly-halt-messages-app-security-2026-09-17.md
