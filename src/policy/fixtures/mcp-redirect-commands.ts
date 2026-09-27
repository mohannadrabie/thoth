// Shared test corpus (S7-B fix-now H1, Issue #328): shell commands whose redirect target lands UNDER the
// MCP target prefix. The shell normalizer emits a redirect target verbatim, so a directory that happens
// to be named after the prefix produces a record whose target looks like a class record's target
// (`mcp/<something>/...`), including shapes no class record can have (a dot or underscore in the second
// segment, no slash at all, a trailing slash, deeper nesting). The reachability check must never call a
// deny rule keyed on such a record unmatchable; rule-reachability.test.ts (drift corpus) and
// loader-reachability.test.ts (R2-13) both draw their commands from here.
//
// The command list is built at run time from the two part tables below, so the count is computed, never
// typed. Nothing here names a committed fixture entry (G19): stand-in segments only.
import type { ShellCall } from "../normalizer/shell.ts";
import { MCP_TARGET_PREFIX } from "../normalizer/tool-class-format.ts";

/** The second path segment (the part a class record would call the server): with a dot, an underscore,
 * both, a digit-led version string, a letters-digits-hyphen name a class record COULD carry, and a name
 * with upper case. */
export const MCP_REDIRECT_SEGMENTS: readonly string[] = ["servers.json", "my_dir", "v1.2", "x.y_z", "srv", "Abc-9", "tool-y"];

/** What follows the second segment: nothing (no slash), a trailing slash, one tool-like segment, deeper
 * nesting, a file name with a dot. */
export const MCP_REDIRECT_REMAINDERS: readonly string[] = ["", "/", "/tool", "/a/b", "/file.py"];

export const MCP_REDIRECT_OPERATORS: readonly string[] = [">", ">>"];

/** One ShellCall per (operator, segment, remainder). */
export function mcpRedirectCalls(): ShellCall[] {
  const calls: ShellCall[] = [];
  for (const op of MCP_REDIRECT_OPERATORS) {
    for (const segment of MCP_REDIRECT_SEGMENTS) {
      for (const remainder of MCP_REDIRECT_REMAINDERS) {
        calls.push({ command: `echo x ${op} ${MCP_TARGET_PREFIX}${segment}${remainder}`, environment: "unknown", identity: "s7b-issue-328" });
      }
    }
  }
  return calls;
}
