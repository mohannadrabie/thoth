// SUR-09: the named set of deferred/indirect-execution wrapper constructs, ruled in
// docs/decisions.md's 2026-09-02 S4-intake row: `bash`/`sh -c`, `eval`, `exec`, `nohup ... &`,
// `source`/`.`, `env`, `xargs`, `at`, `crontab`. A data table (ADR-0003 SOLID: "prefer adding a new
// strategy/handler over extending an if/else ladder when a third variant appears"), not an if/else
// chain over 9 cases — growing this list is a data addition, the same shape as
// action-catalog.ts's KNOWN_VERBS / flag-catalog.ts's alias table.
//
// Deliberately NOT covered (design-challenger, S4 round-1 Finding #4 — flagged here, plainly, so
// it is never mistaken for deliberate coverage): `sudo`/`su -c`/`doas`, and the generic
// interpreter-inline-exec pattern (`python -c`, `perl -e`, `ruby -e`, `node -e`). Today an
// unrecognized leading binary happens to still fail closed, because the fixed kubectl-shaped
// grammar can't resolve a verb from whatever token lands in that slot next — but that is an
// accident of grammar rigidity, not a designed catch-all, and a future grammar change could remove
// it silently. Tracked in docs/backlog.md, not built here.

export interface WrapperMatch {
  id: string;
  /** The inner command's raw text, ready to feed back into `normalizeShellCall`. `undefined` means
   * "recognized, but no statically-inline inner command exists in this invocation" (e.g. the file
   * `source`s, a `crontab` install, a bare `at` with no heredoc body) — the caller MUST treat that
   * as `unresolved`, never as opaque-but-ok: SUR-09 requires evaluation as execution, and a
   * construct we cannot see the content of cannot be evaluated at all. */
  inner: string | undefined;
}

interface WrapperEntry {
  id: string;
  /** Already-`normalizeToolToken`'d binary names this entry matches on `tokens[0]`. */
  binaryNames: readonly string[];
  /** Whether this invocation matches the entry's expected sub-shape ("match") or matches the
   * binary name but not the expected form ("shape-mismatch" — SUR-09's "indirect-execution-shaped
   * but not one of the 9" case). */
  classify: (tokens: readonly string[], liveText: string, bodies: readonly string[]) => "match" | "shape-mismatch";
  /** Only called when `classify` returned "match". */
  extractInner: (tokens: readonly string[], liveText: string, bodies: readonly string[]) => string | undefined;
}

function joinFrom(tokens: readonly string[], startIndex: number): string | undefined {
  const rest = tokens.slice(startIndex);
  const joined = rest.join(" ").trim();
  return joined || undefined;
}

const WRAPPER_CATALOG: readonly WrapperEntry[] = [
  {
    id: "bash-sh-c",
    binaryNames: ["bash", "sh"],
    classify: (tokens) => (tokens[1] === "-c" && tokens.length > 2 ? "match" : "shape-mismatch"),
    extractInner: (tokens) => joinFrom(tokens, 2),
  },
  {
    id: "eval",
    binaryNames: ["eval"],
    classify: (tokens) => (tokens.length > 1 ? "match" : "shape-mismatch"),
    extractInner: (tokens) => joinFrom(tokens, 1),
  },
  {
    id: "exec",
    binaryNames: ["exec"],
    classify: (tokens) => (tokens.length > 1 ? "match" : "shape-mismatch"),
    extractInner: (tokens) => joinFrom(tokens, 1),
  },
  {
    id: "nohup-background",
    binaryNames: ["nohup"],
    classify: (tokens) => {
      if (tokens.length <= 2) return "shape-mismatch";
      const last = tokens.at(-1) ?? "";
      return last === "&" || last.endsWith("&") ? "match" : "shape-mismatch";
    },
    extractInner: (tokens) => {
      const rest = tokens.slice(1);
      const lastIdx = rest.length - 1;
      const last = rest[lastIdx] ?? "";
      if (last === "&") {
        rest.pop();
      } else if (last.endsWith("&")) {
        rest[lastIdx] = last.slice(0, -1).trimEnd();
      }
      const joined = rest.join(" ").trim();
      return joined || undefined;
    },
  },
  {
    id: "source-dot",
    binaryNames: ["source", "."],
    classify: (tokens) => (tokens.length > 1 ? "match" : "shape-mismatch"),
    // The sourced file's content is not statically available from the invocation line — always
    // unresolved by design, never a false "clean" resolve. See header comment.
    extractInner: () => undefined,
  },
  {
    id: "env",
    binaryNames: ["env"],
    classify: (tokens) => {
      const next = tokens[1];
      if (!next) return "shape-mismatch";
      // env's own flags (-i, -u, ...) and leading VAR=value assignments are out of this story's
      // bounded scope — fail closed via shape-mismatch rather than guess at env's own grammar.
      if (next.startsWith("-") || next.includes("=")) return "shape-mismatch";
      return "match";
    },
    extractInner: (tokens) => joinFrom(tokens, 1),
  },
  {
    id: "xargs",
    binaryNames: ["xargs"],
    classify: (tokens) => {
      const next = tokens[1];
      if (!next) return "shape-mismatch";
      // xargs's own flags (-n, -I, -0, ...) are out of this story's bounded scope — fail closed.
      if (next.startsWith("-")) return "shape-mismatch";
      return "match";
    },
    // red-team, S4 Stage-3 review, Finding 4 (Issue #73): xargs appends ADDITIONAL arguments read
    // from stdin at runtime — invisible to any static parse of the invocation line. The visible
    // command prefix is NEVER a complete, trustworthy picture of what actually executes (unlike
    // bash -c/eval/exec/env/nohup, whose full command IS spelled out inline), so — the same
    // honest "recognized, but not resolvable" answer as source/./crontab/bare-at below — xargs's
    // inner command is never statically extractable. This makes every xargs invocation resolve to
    // `unresolved` (fail-closed), which is correct: the stdin-supplied remainder could be
    // anything.
    extractInner: () => undefined,
  },
  {
    id: "at",
    binaryNames: ["at"],
    classify: (tokens) => (tokens.length > 1 ? "match" : "shape-mismatch"),
    // `at` normally reads its command from stdin/a heredoc, not from an inline token — use the
    // last heredoc body found on this invocation as the inner command when present (SUR-08's
    // heredoc-body plumbing supplies it); otherwise nothing is statically extractable.
    extractInner: (_tokens, _liveText, bodies) => bodies.at(-1),
  },
  {
    id: "crontab",
    binaryNames: ["crontab"],
    classify: (tokens) => (tokens.length > 1 ? "match" : "shape-mismatch"),
    // Schedule content lives in a file or an interactive editor session, never inline — always
    // unresolved by design. See header comment.
    extractInner: () => undefined,
  },
];

/** Dispatches on `toolToken` (already `normalizeToolToken`'d). Returns a match (possibly with
 * `inner: undefined`, see `WrapperMatch`), `"unresolved-shaped"` when the binary name is
 * recognized but the sub-shape isn't, or `undefined` when nothing in the catalog matches at all. */
export function detectWrapper(
  toolToken: string,
  tokens: readonly string[],
  liveText: string,
  bodies: readonly string[],
): WrapperMatch | "unresolved-shaped" | undefined {
  for (const entry of WRAPPER_CATALOG) {
    if (!entry.binaryNames.includes(toolToken)) continue;
    const classification = entry.classify(tokens, liveText, bodies);
    if (classification === "shape-mismatch") return "unresolved-shaped";
    return { id: entry.id, inner: entry.extractInner(tokens, liveText, bodies) };
  }
  return undefined;
}
