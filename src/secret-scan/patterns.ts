// Secret-shaped pattern catalog for OSS-01. A curated, documented set — not a claim of
// exhaustiveness (see this file's own note on QA-15's honesty rule, applied here too). Each
// pattern names what it targets so a match's `pattern` field is self-explanatory in a report.
export interface SecretPattern {
  id: string;
  description: string;
  regex: RegExp;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  { id: "aws-access-key-id", description: "AWS access key id", regex: /AKIA[0-9A-Z]{16}/g },
  { id: "aws-secret-access-key", description: "AWS secret access key (heuristic: 40-char base64-ish assigned to a *secret*/*key* var)", regex: /(?:aws_secret_access_key|secret_access_key)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/gi },
  { id: "github-pat", description: "GitHub personal access token (classic)", regex: /gh[pousr]_[A-Za-z0-9]{36,255}/g },
  // GitHub's newer fine-grained PAT format uses a distinct `github_pat_` prefix, never matched by
  // the classic gh[pousr]_ shape above — measured false negative, GitHub Issue #129: this exact
  // format is what this project's own `ADR_REPO_PAT` credential uses (docs/decisions.md's
  // 2026-09-09 "cifix Phase 1 plan approved" row). Zero character-class overlap with `github-pat`
  // above (verified: no shared prefix), so this is a separate, additive pattern, not a widening of
  // the existing one.
  //
  // Issue #135 (measured false positive, red-team + infra-security-reviewer, cifix round 3): the
  // first cut's `\w{20,255}` char class includes the underscore, so ANY snake_case identifier or
  // sentence merely containing the literal substring `github_pat_` followed by 20+ word characters
  // matched unconditionally — `load_github_pat_for_submodule_checkout`,
  // `read_github_pat_from_environment_variable`, and similar PAT-discussion prose all false-
  // positived, with zero secret material present. GitHub's real format is two segments separated
  // by exactly one underscore (a plain-alphanumeric identifier segment, then a plain-alphanumeric
  // secret segment) — no further underscores inside either segment. Requiring the first segment to
  // be a 20+ char alphanumeric-only run (no embedded underscore) immediately before the
  // identifier/secret-separating underscore rejects every snake_case false positive above (no
  // English identifier segment reaches 20 contiguous alphanumeric characters before its next
  // underscore) while still matching both the full real format (22-char identifier segment) and a
  // truncated prefix-only disclosure of one (GitHub Issue #89's exemplar: 22-char identifier
  // segment + trailing separator, secret segment absent/redacted) — the second segment is left
  // unconstrained-length (`[A-Za-z0-9]*`, may be empty) specifically so a truncated real exemplar
  // still matches as the true positive it is. Verified against both false-positive and true-
  // positive fixtures (`patterns.test.ts`).
  { id: "github-fine-grained-pat", description: "GitHub fine-grained personal access token", regex: /github_pat_[A-Za-z0-9]{20,}_[A-Za-z0-9]*/g },
  { id: "slack-token", description: "Slack token", regex: /xox[baprs]-[A-Za-z0-9-]{10,72}/g },
  { id: "private-key-block", description: "PEM private key block", regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { id: "generic-password-assignment", description: "password/secret/token literal assignment", regex: /\b(?:password|passwd|secret|token|api_key|apikey)\s*[:=]\s*['"][^'"\s]{8,}['"]/gi },
  // The suffix must be the END of the dotted name, not a middle segment — measured false
  // positive, GitHub Issue #113: every doc/hook mention of `.claude/settings.local.json` (a real
  // Claude Code config-filename convention, not a hostname), and English prose like
  // "settings.local-shaped strings", matched "settings.local" as an internal host, because the
  // old regex never looked past its own `\b`.
  //
  // Issue #130 (measured regression from the #113 fix's first cut): a BLANKET "no continuation at
  // all" lookahead (`(?![.-][a-z0-9])`) is over-broad. It is NOT true that "a real internal host
  // never continues with another dotted segment" — `.corp`/`.internal` are routinely MIDDLE labels
  // of a real corporate FQDN (`host01.corp.contoso.com`, `api.internal.acme.com`), and the blanket
  // exclusion silently dropped every one of those. Narrowed to exclude only the two continuation
  // SHAPES that actually caused the false positive: a following file-extension-shaped segment
  // (`.json`/`.ts`/...) or a following hyphenated-English-modifier segment (`-shaped`, `-only`,
  // ...) — never a bare continuation. `.local` alone still terminates cleanly per RFC 6762's own
  // ersatz-TLD framing; `.corp`/`.internal` are no longer assumed to share that property.
  // Regression-tested (`patterns.test.ts`): both #113 false-positive shapes still excluded, AND a
  // multi-label FQDN (`host01.corp.contoso.com`) now matches as the true positive it always was.
  {
    id: "internal-hostname",
    description: "an internal-looking hostname (*.internal, *.corp, *.local)",
    regex: /\b[a-z0-9-]+\.(?:internal|corp|local)\b(?!\.(?:json|ts|js|jsx|tsx|md|yml|yaml|txt|log|lock)\b)(?!-[a-z]{2,})/gi,
  },
  { id: "ipv4-private", description: "a private-range IPv4 address (10.x, 172.16-31.x, 192.168.x)", regex: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g },
  // The final segment must be alphabetic (a real TLD) — measured false positive without this:
  // `@microsoft/agent-governance-sdk@5.0.0` npm version specifiers in REQUIREMENTS.md matched a
  // looser `[\w.-]+` tail (`sdk@5.0.0` reads as user="sdk", domain="5.0.0"). A real TLD is never
  // purely numeric, so requiring `[A-Za-z]{2,}` at the end excludes that class without excluding
  // real emails.
  { id: "email-address", description: "an email address (possible personal data)", regex: /\b[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g },
];

/** Replaces the matched secret text with a short, non-reconstructable redaction before it is ever logged. */
export function redact(match: string): string {
  const visible = match.slice(0, Math.min(4, match.length));
  return `${visible}…[REDACTED ${match.length} chars]`;
}
