// Shared black-box test helper (test-writer scope, not application source): builds an isolated,
// throwaway directory tree standing in for "a real session's project + home directory" so a
// SessionStart/UserPromptSubmit hook subprocess test can control exactly what
// `hooks/sessionstart-tool-enum.mjs` reads (project `.claude/settings.json`, project `.mcp.json`,
// user/local `~/.claude.json`) and where it writes (`${CLAUDE_PROJECT_DIR}/.thoth/halt-state/`)
// without ever touching this repo's own real files — required isolation per CLAUDE.md's lane
// discipline (test-writer never touches application source) and per this repo's own convention of
// never letting a test's side effects leak into the real working tree.
//
// docs/plans/S5-phase1-2026-09-06.md's "New files" section names these exact paths as
// `hooks/sessionstart-tool-enum.mjs`'s real input surface: project `.claude/settings.json`'s
// enableAllProjectMcpServers/enabledMcpjsonServers/disabledMcpjsonServers, project `.mcp.json`,
// user/local `~/.claude.json` — and its real output surface,
// `${CLAUDE_PROJECT_DIR}/.thoth/halt-state/<session_id>.json` (criterion 20's schema, criterion 24's
// new CLAUDE.md sensitive-area entry).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface FixtureTree {
  /** The isolated project root — pass as CLAUDE_PROJECT_DIR. */
  projectDir: string;
  /** The isolated home directory — pass as HOME and USERPROFILE (covers both `os.homedir()`'s
   * POSIX and Windows resolution paths, since which one the real hook implementation reads is not
   * yet built and this test must not guess wrong). */
  homeDir: string;
  /** Removes the whole tree. Call in a `finally` / `after` block. */
  cleanup: () => void;
}

/** Creates the isolated project + home dirs (no config files yet — callers write only the files
 * their own test cares about, via the write* helpers below). */
export function makeFixtureTree(label: string): FixtureTree {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `thoth-s5-hook-test-${label}-`));
  const projectDir = path.join(root, "project");
  const homeDir = path.join(root, "home");
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  return {
    projectDir,
    homeDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** Writes `<projectDir>/.mcp.json` with the given (already-shaped) content — pass a string to
 * plant deliberately-malformed (non-JSON) content for a fail-closed/internal-exception test. */
export function writeProjectMcpJson(tree: FixtureTree, content: unknown): void {
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(path.join(tree.projectDir, ".mcp.json"), text, "utf8");
}

/** Writes `<homeDir>/.claude.json` with the given (already-shaped) content. */
export function writeHomeClaudeJson(tree: FixtureTree, content: unknown): void {
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(path.join(tree.homeDir, ".claude.json"), text, "utf8");
}

/** Writes `<projectDir>/.claude/settings.json` with the given (already-shaped) content. */
export function writeProjectSettingsJson(tree: FixtureTree, content: unknown): void {
  const dir = path.join(tree.projectDir, ".claude");
  fs.mkdirSync(dir, { recursive: true });
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(path.join(dir, "settings.json"), text, "utf8");
}

/** The halt-state file path a hook run against this fixture tree is expected to read/write for
 * `sessionId`, per criterion 20's schema. */
export function haltStatePath(tree: FixtureTree, sessionId: string): string {
  return path.join(tree.projectDir, ".thoth", "halt-state", `${sessionId}.json`);
}

/** Reads and JSON-parses the halt-state file for `sessionId`, or returns undefined if it does not
 * exist (a fully-classified/no-halt run is expected to leave no file, or at minimum no reason with
 * `set: true` — see each test's own assertion for which). */
export function readHaltState(tree: FixtureTree, sessionId: string): unknown {
  const p = haltStatePath(tree, sessionId);
  if (!fs.existsSync(p)) return undefined;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Pre-seeds a halt-state file directly (bypassing any hook), simulating a reason already written
 * by a DIFFERENT mechanism — used to prove one writer's own write never clobbers another
 * mechanism's already-set reason (criterion 20's "additive by construction"). */
export function seedHaltState(tree: FixtureTree, sessionId: string, content: unknown): void {
  const p = haltStatePath(tree, sessionId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(content, null, 2), "utf8");
}

/** Env overrides to pass as `runHook`'s third argument so the spawned hook reads/writes this
 * fixture tree instead of the real repo/home. */
export function fixtureEnv(tree: FixtureTree): NodeJS.ProcessEnv {
  return {
    CLAUDE_PROJECT_DIR: tree.projectDir,
    HOME: tree.homeDir,
    USERPROFILE: tree.homeDir,
  };
}
