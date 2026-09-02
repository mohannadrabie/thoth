// POL-04: one of the two required normalizers — the shell-command side of "a structured
// cluster-mutation fixture call and its shell-equivalent fixture call ... yield the same verdict."
//
// Deliberately narrow. This is NOT SUR-06/07/08's semantic shell-command detector (flag
// reordering, abbreviations, path-qualified/quoted binary names, heredoc-safe target extraction) —
// that hardening is S4's job (Milestone #22, CRITICAL tier, "historically highest-incident
// component"). This normalizer recognizes exactly one fixed, documented command shape:
//
//   "<tool> <verb> <resourceType>/<resourceName> [--flag=value ...]"
//
// Anything it cannot confidently parse against that shape is reported via `unresolved`, never
// guessed at or silently dropped (ADR-0021 §3.2, SUR-02's terminal fall-through is deny).
import type { ActionRecord } from "../kernel/action-record.ts";
import { resolveVerb } from "./action-catalog.ts";
import { buildClusterTarget } from "./target-format.ts";
import { registerNormalizer } from "./registry.ts";

export interface ShellCall {
  command: string;
  environment: string;
  identity: string;
  deferred?: boolean;
}

function parseFlags(tokens: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const token of tokens) {
    const match = /^--([a-zA-Z][\w-]*)=(.+)$/.exec(token);
    if (match) {
      const [, key, value] = match;
      if (key && value) flags[key] = value;
    }
  }
  return flags;
}

export function normalizeShellCall(raw: ShellCall): ActionRecord {
  const unresolved: string[] = [];
  const tokens = raw.command.trim().split(/\s+/);

  const rawVerb = tokens[1];
  const resolvedVerb = rawVerb ? resolveVerb(rawVerb) : undefined;
  if (!resolvedVerb) unresolved.push(`command verb "${rawVerb ?? ""}"`);

  // app-security-reviewer, S3 review, Finding #1 (Issue #65): `const [rt, rn] = token.split("/")`
  // silently discards any segment beyond the first two — a token with MORE than the documented
  // 2-segment shape (e.g. "secrets/db-password/extra-smuggled-segment") used to resolve cleanly
  // to resourceName: "db-password", dropping the extra segment without ever reporting it. Fixed:
  // the split must produce EXACTLY 2 non-empty segments; anything else (0, 1, or 3+) is reported
  // via `unresolved`, identically to today's "no resource token at all" case — never accepted
  // partially.
  const resourceToken = tokens[2];
  let resourceType: string | undefined;
  let resourceName: string | undefined;
  if (resourceToken?.includes("/")) {
    const segments = resourceToken.split("/");
    if (segments.length === 2 && segments[0] && segments[1]) {
      resourceType = segments[0];
      resourceName = segments[1];
    }
  }
  if (!resourceType || !resourceName) unresolved.push(`command resource "${resourceToken ?? ""}"`);

  const flags = parseFlags(tokens.slice(3));
  const cluster = flags["context"];
  if (!cluster) unresolved.push("command flag --context");

  // app-security-reviewer, S3 review, Finding #2 (Issue #66): buildClusterTarget now validates
  // its own inputs for the "/" delimiter and returns undefined when a field is contaminated —
  // that undefined MUST be reported via `unresolved`, not silently downgraded to an empty
  // targets array (which would look identical to "cluster/context flag was simply missing").
  let targets: string[] = [];
  if (resourceType && resourceName && cluster) {
    const target = buildClusterTarget({ environment: raw.environment, cluster, resourceType, resourceName });
    if (target) {
      targets = [target];
    } else {
      unresolved.push('target field(s) contain the delimiter character "/"');
    }
  }

  return {
    source: "parsed",
    verbs: resolvedVerb ? [resolvedVerb] : [],
    targets,
    environment: raw.environment,
    identity: raw.identity,
    deferred: raw.deferred ?? false,
    unresolved,
  };
}

registerNormalizer({
  toolType: "shell",
  normalize: (raw) => normalizeShellCall(raw as ShellCall),
});
