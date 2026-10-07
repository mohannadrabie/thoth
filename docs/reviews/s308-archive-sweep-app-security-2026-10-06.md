# s308-archive-sweep — app-security review, round 1 (CRITICAL) — 2026-10-06

[app-security-reviewer] Horus. HEAD 7641053 (s308/kb-d-build), diff `2708cd8..7641053` (4 files). ADR cache: HIT, 38 ADRs; applicable: THOTH-ADR-0002 (proposed, rules served).

## Verdict: APPROVE

## Evidence (ran)
- `npm run oss:secret-scan` exit 0: "PASS: Full history scanned, 0 blocking ... (3949 allowlisted)". Two ALLOWLISTED lines name path `docs/decisions-archive.md` [email-address] — the scanner matched the new entry on the exact path (case and separators).
- `npm run oss:pre-commit-scan` exit 0: "PASS ... 0 blocking (275 allowlisted)".
- `printf 'the reserved example address' | sha256sum` = 973dfe46...813b = the entry's single hash (and the existing `docs/decisions.md` entry's hash). Reserved domain (RFC 2606 example.com), not a credential.
- `grep -c the reserved example address: decisions.md 0, decisions-archive.md 2. Only email-shaped strings in the added archive lines: 2, both the reserved example address. The 6 moved rows are fully covered; the scan reports no other match under the archive path.

## ADR-0002 check
- Value-scoped: one valueSha256 (64 lowercase hex). PASS.
- Path-scoped: exactly `docs/decisions-archive.md`; no glob. PASS.
- Non-empty reason, names the issue and the one-value/one-path scope. PASS.
- No credential-shaped grant (pattern email-address). PASS.
- No widening: one pattern, one hash, one path; no other exemption shape; decisions.md entries unchanged. PASS.
- Moved content: 6 rows removed from decisions.md, 6 added to archive; no secret-shaped content beyond the covered email.

## Findings
1. [CLEAN][code-traced+demonstrated] New allowlist entry conforms to ADR-0002; hash independently recomputed; scanner matches the archive path.
2. [CLEAN][demonstrated] Full-history and pre-commit scans PASS, 0 blocking.
3. [SUSPICION][LOW][code-traced] Hardening: the `docs/decisions.md` email-address entry (allowlist ~line 357) now matches nothing (0 occurrences of the literal). A dead grant is the invisible-entry class already tracked in Issue #235; harmless (value-scoped), no action in this diff. Not an Issue.

No blockers. Editorial: none.

Failing tests mapped to open findings: 0 (no open blocking findings).

RECEIPT: verdict=APPROVE
findings:
1. [SUSPICION][LOW][code-traced] docs/qa/secret-scan-allowlist.json:357 — decisions.md email entry now matches nothing (dead grant, #235 class); optional removal later, no action here
2. [CLEAN][demonstrated] new archive entry matches ADR-0002 (value/path-scoped, reason, non-credential, hash = sha256 of the reserved example address recomputed)
3. [CLEAN][demonstrated] oss:secret-scan PASS 0 blocking (3949 allowlisted); oss:pre-commit-scan PASS 0 blocking (275 allowlisted)
counts: issues=0 suspicions=1 clean=2
evidence: demonstrated=2 code-traced=1 derived=0
checks="2/0/0"
adr=HIT(38)
report=docs/reviews/s308-archive-sweep-app-security-2026-10-06.md
