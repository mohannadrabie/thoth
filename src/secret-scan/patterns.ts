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
  { id: "github-pat", description: "GitHub personal access token", regex: /gh[pousr]_[A-Za-z0-9]{36,255}/g },
  { id: "slack-token", description: "Slack token", regex: /xox[baprs]-[A-Za-z0-9-]{10,72}/g },
  { id: "private-key-block", description: "PEM private key block", regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { id: "generic-password-assignment", description: "password/secret/token literal assignment", regex: /\b(?:password|passwd|secret|token|api_key|apikey)\s*[:=]\s*['"][^'"\s]{8,}['"]/gi },
  { id: "internal-hostname", description: "an internal-looking hostname (*.internal, *.corp, *.local)", regex: /\b[a-z0-9-]+\.(?:internal|corp|local)\b/gi },
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
