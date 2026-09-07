import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkCommandPaths,
  extractCommandPathReferences,
  extractScriptPath,
  substituteProjectDir,
} from "./gate-command-path-check.ts";

test("extractScriptPath: a double-quoted node command extracts the quoted .mjs path", () => {
  assert.equal(
    extractScriptPath('node "${CLAUDE_PROJECT_DIR}/hooks/report-subject-gate.mjs"'),
    "${CLAUDE_PROJECT_DIR}/hooks/report-subject-gate.mjs",
  );
});

test("extractScriptPath: an unquoted bare .mjs token is still extracted", () => {
  assert.equal(extractScriptPath("node hooks/foo.mjs"), "hooks/foo.mjs");
});

test("extractScriptPath: a command with no .mjs-shaped token returns null", () => {
  assert.equal(extractScriptPath("echo hello"), null);
});

test("substituteProjectDir: replaces every ${CLAUDE_PROJECT_DIR} occurrence", () => {
  assert.equal(substituteProjectDir("${CLAUDE_PROJECT_DIR}/a/${CLAUDE_PROJECT_DIR}/b", "/repo"), "/repo/a//repo/b");
});

test("extractCommandPathReferences: a well-formed hooks object yields one reference per command entry", () => {
  const settings = {
    hooks: {
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: 'node "${CLAUDE_PROJECT_DIR}/hooks/a.mjs"' }] },
      ],
      SessionStart: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PROJECT_DIR}/hooks/b.mjs"' }] }],
    },
  };
  const refs = extractCommandPathReferences(settings);
  assert.equal(refs.length, 2);
  assert.equal(refs[0]?.event, "PreToolUse");
  assert.equal(refs[1]?.event, "SessionStart");
});

test("extractCommandPathReferences: a type:\"prompt\" entry is skipped, not flagged", () => {
  const settings = {
    hooks: { PreToolUse: [{ hooks: [{ type: "prompt", command: "not a real path" }] }] },
  };
  assert.deepEqual(extractCommandPathReferences(settings), []);
});

test("extractCommandPathReferences: no hooks key at all returns an empty array, not a throw", () => {
  assert.deepEqual(extractCommandPathReferences({}), []);
  assert.deepEqual(extractCommandPathReferences(null), []);
  assert.deepEqual(extractCommandPathReferences("not an object"), []);
});

test("checkCommandPaths: 0 command-type entries is a VACUOUS pass, not a hidden green", () => {
  const result = checkCommandPaths({}, "/repo", () => true);
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, true);
});

test("checkCommandPaths: every referenced script existing on disk (per the injected `exists`) passes non-vacuously", () => {
  const settings = {
    hooks: { PreToolUse: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PROJECT_DIR}/hooks/a.mjs"' }] }] },
  };
  const result = checkCommandPaths(settings, "/repo", () => true);
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, false);
});

test("checkCommandPaths: a dangling reference (this project's own real Issue #87 shape) fails loudly, non-vacuously", () => {
  const settings = {
    hooks: {
      PreToolUse: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PROJECT_DIR}/hooks/report-subject-gate.mjs"' }] }],
    },
  };
  const result = checkCommandPaths(settings, "/repo", () => false);
  assert.equal(result.ok, false);
  assert.equal(result.details.length, 1);
  assert.match(result.details[0] ?? "", /does not exist on disk/);
});

test("checkCommandPaths: a command with no extractable .mjs path is reported, not silently skipped", () => {
  const settings = {
    hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "echo not-a-script" }] }] },
  };
  const result = checkCommandPaths(settings, "/repo", () => true);
  assert.equal(result.ok, false);
  assert.match(result.details[0] ?? "", /could not extract/);
});
