import { test } from "node:test";
import assert from "node:assert/strict";
import { SECRET_PATTERNS } from "./patterns.ts";

function findPattern(id: string) {
  const p = SECRET_PATTERNS.find((x) => x.id === id);
  if (!p) throw new Error(`no pattern ${id}`);
  p.regex.lastIndex = 0;
  return p;
}

test("email-address: matches a real email", () => {
  const p = findPattern("email-address");
  assert.ok(p.regex.test("contact security@example.com for reports"));
});

test("email-address: does NOT match an npm package version specifier (regression — false " +
  "positive found scanning this repo's own REQUIREMENTS.md: `@microsoft/agent-governance-sdk@5.0.0`)", () => {
  const p = findPattern("email-address");
  assert.equal(p.regex.test("@microsoft/agent-governance-sdk@5.0.0"), false);
  p.regex.lastIndex = 0;
  assert.equal(p.regex.test("agent-governance-claude-code@5.0.0"), false);
});

test("aws-access-key-id: matches an AKIA-shaped key", () => {
  const p = findPattern("aws-access-key-id");
  assert.ok(p.regex.test("AKIAABCDEFGHIJKLMNOP"));
});

test("internal-hostname: matches a bare internal-suffixed host", () => {
  const p = findPattern("internal-hostname");
  assert.ok(p.regex.test("connect to db01.internal for the staging replica"));
});

test("internal-hostname: does NOT match a config-filename fragment (regression — false " +
  "positive found scanning this repo's own history, GitHub Issue #113: every doc/hook mention " +
  "of `.claude/settings.local.json` matched 'settings.local' as an internal hostname)", () => {
  const p = findPattern("internal-hostname");
  assert.equal(p.regex.test("edit .claude/settings.local.json to override CLAUDE_PROJECT_DIR"), false);
  p.regex.lastIndex = 0;
  assert.equal(p.regex.test("settings.local.json"), false);
  p.regex.lastIndex = 0;
  // Same false positive, hyphenated-modifier shape (this repo's own history: "settings.local-
  // shaped strings", docs/reviews/s6-policy-centralization-red-team-round5-2026-09-08.md).
  assert.equal(p.regex.test("the internal-hostname pattern false-positiving on settings.local-shaped strings"), false);
  p.regex.lastIndex = 0;
  // Sentence-final punctuation must not be mistaken for a filename extension.
  assert.ok(p.regex.test("the replica lives at db01.internal."));
});

test("internal-hostname: DOES match a real multi-label corporate FQDN (regression — GitHub " +
  "Issue #130: the #113 fix's blanket no-continuation lookahead silently dropped this true-" +
  "positive class; `.corp`/`.internal` are routinely a MIDDLE label of a real FQDN, not always " +
  "the terminating one)", () => {
  const p = findPattern("internal-hostname");
  assert.ok(p.regex.test("host01.corp.contoso.com"));
  p.regex.lastIndex = 0;
  assert.ok(p.regex.test("api.internal.acme.com"));
  p.regex.lastIndex = 0;
  assert.ok(p.regex.test("db1.internal.example.com"));
});

test("github-fine-grained-pat: matches GitHub's fine-grained PAT format (regression — GitHub " +
  "Issue #129: the classic github-pat pattern's `gh[pousr]_` prefix never matches " +
  "`github_pat_...`, the exact format this project's own ADR_REPO_PAT credential uses)", () => {
  const p = findPattern("github-fine-grained-pat");
  assert.ok(p.regex.test(
    "github_pat_11ABCDEFGHIJKLMNOPQR_abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUV",
  ));
  p.regex.lastIndex = 0;
  // Zero overlap with the classic github-pat pattern's own shape.
  assert.equal(p.regex.test("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789AB"), false);
});

// Synthetic fixtures for the two github-fine-grained-pat tests below, built at runtime so this
// file's own text never contains the literal prefix followed by 20+ alphanumerics (Issue #136
// hygiene: new positive fixtures should not lean on the whole-file allowlist entry).
const PAT_PREFIX = "github" + "_pat_";
const PAT_IDENTIFIER_SEGMENT = "ABCDEFGHIJKLMNOPQRSTUV"; // 22 alphanumerics, visibly synthetic
const PAT_SECRET_SEGMENT = "abcdefghijklmnopqrstuvwxyz1234567890"; // visibly synthetic

test("github-fine-grained-pat: does NOT match ordinary PAT-discussion prose (regression -- " +
  "Issue #135: the snake_case false-positive class the fix removed; a synthetic real-format " +
  "token still matches in the same test) [github-fine-grained-pat-word-boundary-test]", () => {
  const exemplars = [
    "load_github_pat_for_submodule_checkout",
    "read_github_pat_from_environment_variable",
    "const github_pat_env_var_name_constant = 1",
    "my.github_pat_helper_function_name_here()",
  ];
  for (const text of exemplars) {
    const p = findPattern("github-fine-grained-pat");
    assert.equal(p.regex.test(text), false, `must not match prose: ${text}`);
  }
  const contrast = PAT_PREFIX + PAT_IDENTIFIER_SEGMENT + "_" + PAT_SECRET_SEGMENT;
  const p = findPattern("github-fine-grained-pat");
  assert.ok(p.regex.test(contrast), "the synthetic real-format token must still match");
});

test("github-fine-grained-pat: matches a truncated prefix-only disclosure (22-char identifier " +
  "segment, empty secret segment; Issue #89 exemplar shape)", () => {
  const truncated = PAT_PREFIX + PAT_IDENTIFIER_SEGMENT + "_";
  const p = findPattern("github-fine-grained-pat");
  assert.deepEqual(truncated.match(p.regex), [truncated], "the whole truncated fixture is the match");
});

test("ipv4-private: matches a private-range address, not a public one", () => {
  const priv = findPattern("ipv4-private");
  assert.ok(priv.regex.test("server at 10.0.1.5 is internal"));
  priv.regex.lastIndex = 0;
  assert.equal(priv.regex.test("public DNS 8.8.8.8"), false);
});
