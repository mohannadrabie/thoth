// #451 / #429 round 2 (S7): READ-ONLY extractor for the write-deny list the installed Claude Code binary builds for its own
// sandbox (the `~/.claude` and project `.claude` entries it treats as write-protected). It reads the binary's bundled JS
// text and never executes it. The binary is minified, so the extraction is anchored on string shapes, not identifier names:
//   - the array literal that contains "shell-snapshots","session-env","plugins" (the user-level loop),
//   - every other string-only array literal in the same function,
//   - `(<id>(),"<name>")` user-level entries and `(<id>,".claude","<name>")` project-level entries,
//   - the literal ".mcp.json".
// Reliability: this is an extraction from minified code, valid for the version recorded in the judgment file; a layout change
// makes it return fewer entries or throw "anchor not found", and the test fails loudly rather than passing vacuously.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ANCHOR = '"shell-snapshots","session-env","plugins"';
const END_MARK = "bareGitRepoScrubPaths.length=0";

export interface Extracted {
  /** Names under the user config dir (~/.claude/<name>), sorted. */
  user: string[];
  /** Names under a project's .claude directory (.claude/<name>), sorted. */
  project: string[];
  /** True when the literal .mcp.json appears in the same function (a project-root file). */
  mcpJson: boolean;
}

/** Where the installed binary is, or undefined. THOTH_CLAUDE_BIN overrides (used by tests). */
export function locateClaudeBinary(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates = [env["THOTH_CLAUDE_BIN"], join(homedir(), ".local", "bin", "claude.exe"), join(homedir(), ".local", "bin", "claude")];
  return candidates.find((c): c is string => c !== undefined && c !== "" && existsSync(c));
}

/** Pure: extract from the binary's bytes. Throws when the anchor is absent (layout changed). */
export function extractWriteDeny(bin: Buffer): Extracted {
  const at = bin.indexOf(ANCHOR);
  if (at < 0) throw new Error("write-deny anchor not found: the binary layout changed, re-spike the extraction");
  const end = bin.indexOf(END_MARK, at);
  if (end < 0) throw new Error("write-deny end mark not found: the binary layout changed, re-spike the extraction");
  const text = bin.subarray(Math.max(0, at - 6000), end).toString("latin1");
  const user = new Set<string>();
  const project = new Set<string>();
  // the main user-level loop: its array also holds identifiers (spread), so it is taken by position, not by shape
  const open = bin.lastIndexOf("[", at);
  const close = bin.indexOf("]", at);
  for (const s of bin.subarray(open, close).toString("latin1").matchAll(/"([A-Za-z][A-Za-z0-9_.-]*)"/g)) user.add(s[1]!);
  for (const m of text.matchAll(/\[("[^"\\[\]]+"(?:,"[^"\\[\]]+")*)\]/g)) {
    if (!m[1]!.includes(',"') && !/\.|-|_/.test(m[1]!)) continue; // a one-word array is not one of the lists
    for (const s of m[1]!.matchAll(/"([^"]+)"/g)) if (/^[A-Za-z][A-Za-z0-9_.-]*$/.test(s[1]!) && s[1] !== "HEAD" && s[1] !== "objects" && s[1] !== "refs") user.add(s[1]!);
  }
  for (const m of text.matchAll(/\(\w+\(\),"([^"/\\]+)"\)/g)) user.add(m[1]!);
  for (const m of text.matchAll(/\(\w+,"\.claude","([^"/\\]+)"\)/g)) project.add(m[1]!);
  return { user: [...user].sort(), project: [...project].sort(), mcpJson: text.includes('".mcp.json"') };
}

export function extractFromInstalled(env: NodeJS.ProcessEnv = process.env): (Extracted & { binary: string }) | undefined {
  const binary = locateClaudeBinary(env);
  if (binary === undefined) return undefined;
  return { binary, ...extractWriteDeny(readFileSync(binary)) };
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}` || process.argv[1]?.endsWith("claude-code-write-deny-extract.ts") === true) {
  const r = extractFromInstalled();
  if (r === undefined) console.log("claude-code-write-deny-extract: no installed Claude Code binary found");
  else console.log(JSON.stringify({ user: r.user, project: r.project, mcpJson: r.mcpJson }, null, 2));
}
