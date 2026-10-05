// #308 story F4 (Q2 ruling 2026-10-04): redirect targets are canonicalized so a deny rule keyed on one
// project-relative lowercase path cannot be bypassed by the path forms Windows and POSIX allow.
// Lexical only: backslash to slash, empty and "." segments dropped, ".." collapsed (a leading ".." is kept),
// lowercase. NOT handled (disclosed): absolute paths and drive or /c/ forms (the normalizer has no project
// root), $VAR and ~user expansion, symlinks, 8.3 short names. written FAILING FIRST against a missing module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalizePathTarget, pathFormIssue } from "./path-canonical.ts";
import { normalize } from "./registry.ts";
import "./shell.ts";

const CASES: [string, string][] = [
  [".thoth/policy.json", ".thoth/policy.json"],
  ["./.thoth/policy.json", ".thoth/policy.json"],
  [".THOTH/Policy.JSON", ".thoth/policy.json"],
  [".thoth\\policy.json", ".thoth/policy.json"],
  [".\\.THOTH\\policy.json", ".thoth/policy.json"],
  ["a/../.thoth/policy.json", ".thoth/policy.json"],
  ["./a/./b/../../.thoth//policy.json", ".thoth/policy.json"],
  [".thoth/halt-state/", ".thoth/halt-state"],
  [".thoth/policy.json.", ".thoth/policy.json"],
  [".thoth/policy.json. . ", ".thoth/policy.json"],
  [".thoth./policy.json", ".thoth/policy.json"],
  ["...", "..."],
  [".thoth/./halt-state//x", ".thoth/halt-state/x"],
  ["../x/y", "../x/y"],
  ["a/../../x", "../x"],
  ["~/.claude/Settings.json", "~/.claude/settings.json"],
  ["/abs/Path/../x", "/abs/x"],
];

test("F4-canonical: each path form maps to its canonical project-relative lowercase form", () => {
  for (const [input, expected] of CASES) assert.equal(canonicalizePathTarget(input), expected, input);
  assert.equal(canonicalizePathTarget(canonicalizePathTarget(".\\A/../B")), canonicalizePathTarget(".\\A/../B"), "idempotent");
});

test("F4-normalizer: the shell record's redirect target is the canonical form, for every case form", () => {
  for (const [input, expected] of CASES) {
    if (input.includes("\\") || input.includes(" ")) continue; // an unquoted backslash is a shell escape; quoted below
    const r = normalize("shell", { command: `echo x > ${input}`, environment: "e", identity: "i", deferred: false });
    assert.deepEqual(r.targets, [expected], input);
  }
  // Backslash forms inside shell words are NOT recoverable here: the scanner dequotes a backslash as an escape
  // even inside double quotes (bash keeps it), so the target arrives already mangled. DOCUMENTING, see below.
  const q = normalize("shell", { command: 'echo x > ".\\.THOTH\\policy.json"', environment: "e", identity: "i", deferred: false });
  assert.notDeepEqual(q.targets, [".thoth/policy.json"], "DOCUMENTING: a backslash path inside a quoted shell word is not canonicalized (disclosed gap; F8 denies the command anyway)");
  assert.ok(q.unresolved.length > 0, "and the record is unresolved, so POL-05 denies it regardless of any path rule");
});

test("F4/#416: a segment with a colon (alternate data stream, drive-relative or drive) is flagged by pathFormIssue and the shell record is unresolved; colon-free paths are not flagged", () => {
  for (const t of [".thoth/policy.json::$data", ".thoth/policy.json:stream", "c:policy.json", "c:/x/y", "a/b:c/d"]) assert.ok(pathFormIssue(t) !== undefined, t);
  for (const t of [".thoth/policy.json", "~/.claude/settings.json", "/dev/null", "a/b.c/d"]) assert.equal(pathFormIssue(t), undefined, t);
  for (const t of [".thoth/policy.json::$data", "c:policy.json"]) {
    const r = normalize("shell", { command: `echo x > '${t}'`, environment: "e", identity: "i", deferred: false });
    assert.ok(r.unresolved.some((u) => u.includes("#416")), `${t}: ${JSON.stringify(r.unresolved)}`);
    assert.deepEqual(r.verbs, ["write"], "the record still says write and keeps the target");
  }
});
