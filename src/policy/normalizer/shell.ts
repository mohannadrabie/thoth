// S4 (Milestone #22, CRITICAL tier, "historically highest-incident component"): the semantic
// shell-command detector — flag reordering, abbreviations, path-qualified/quoted binary names,
// heredoc-safe target extraction (SUR-07/SUR-08), per-invocation chaining evaluation with quote
// preservation (SUR-06), and deferred/indirect execution recognition (SUR-09) — this file's own
// S3-shipped header comment named this exact hardening as S4's job.
//
// Composes over three small, independently-testable modules (ADR-0003 SOLID: split by
// reason-to-change) rather than growing into one large function:
//   - shell-scanner.ts: quote/heredoc-aware raw-text primitives (chain-operator liveness,
//     command/process-substitution liveness, heredoc body stripping, redirect-target extraction,
//     tokenization).
//   - flag-catalog.ts: flag-abbreviation alias resolution + directory-flag recognition.
//   - wrapper-catalog.ts: the 9 named SUR-09 deferred/indirect-execution wrappers.
// action-catalog.ts (verb resolution) and target-format.ts (cluster target formatting) are reused
// unchanged — zero diff to either, or to kernel.ts/registry.ts (docs/decisions.md's 2026-09-02
// ruling; ADR-0006's no-opportunistic-scope-widening clause).
//
// Two mandatory additions from design-challenger's S4 round-1 report
// (docs/reviews/s4-shell-semantic-detector-design-challenger-2026-09-02.md), ruled in
// docs/decisions.md's 2026-09-02 "design-challenger's pre-build attack" row:
//   1. Command/process substitution (`$(...)`, backtick, `<(`, `>(`) is detected — never
//      recursively resolved (a materially larger, unbounded mechanism) — and denies via
//      `unresolved` (Finding #1).
//   2. A directory-flag token (`-C <path>`, `--directory=<path>`, `-d <path>`) denies via
//      `unresolved` rather than being silently invisible to the record (Finding #2).
//
// S4 Stage-3 review fix-now round (docs/reviews/s4-shell-semantic-detector-{red-team,app-security,
// cross-domain,architecture}-2026-09-02.md — red-team no-go, app-security REWORK, cross-domain
// REWORK, architecture APPROVE-WITH-CONDITIONS) closed five further fail-opens, all under the same
// "a shell command is one command" assumption red-team's report names as the scariest one:
//   3. An unterminated quote no longer defeats chain/substitution detection (app-security Finding
//      1 / Issue #68) — checked FIRST, ahead of every other syntax check (`collectSyntaxUnresolved`
//      below), because once a quote is unterminated the rest of the quote model is meaningless.
//   4. A bare newline or non-trailing `&` is now a live chain operator alongside the original four
//      (red-team Finding 1 / Issue #70) — SUR-06's "one leading read-only call cannot disable
//      evaluation of a later mutating one" bar covers multi-line and `&`-joined invocations too.
//   5. A `<<<` herestring is no longer mis-detected as a heredoc marker (red-team Finding 2 /
//      Issue #71) — the marker regex now requires exactly two `<` characters, not three or more.
//   6. Every resource-shaped positional token is collected, not just the first, and `xargs`'s
//      inner command is never claimed resolvable at all (red-team Finding 4 / Issue #73 — xargs's
//      stdin-appended arguments are invisible to any static parse).
//   7. Every live redirect target is collected, not just the first (red-team Finding 5 / Issue
//      #74).
// `normalizeShellCall`'s recursion-depth parameter is also now module-internal, not a public,
// externally-callable parameter (architecture-reviewer Finding 2 / Issue #77) — see
// `normalizeAtDepth` below.
//
// Round 3, council-approved path (rule 16(c) tripped after 2 consecutive REWORK/no-go rounds;
// `docs/reviews/s4-shell-semantic-detector-council-path-forward-2026-09-03.md`, GO) closed three
// more findings item 6's own fix opened or left adjacent:
//   8. `scanFlags`'s redirect-operator exclusion now keys on the operator's POSITION in `liveText`
//      (`findLiveRedirectOperatorPositions`), not the token's dequoted VALUE — a quoted literal
//      `">"` argument is indistinguishable from a live operator by value alone once quoting has
//      already been stripped, and was silently swallowing the FOLLOWING resource-shaped token
//      (red-team round-2 Finding N1 / Issue #80).
//   9. `findLiveTrailingSensitiveSeparator` (shell-scanner.ts) now excludes the fd-dup ampersand
//      idiom (`2>&1`, `&>`) from separator detection — REQUIREMENTS.md:173 names "fd-dup ampersand
//      handling" as in-scope, and item 4's newline/`&` fix was denying the single most common
//      redirect idiom in real shell usage (red-team round-2 Finding N2 / Issue #81).
//   10. A shell call whose assembled `ActionRecord` would carry 2 OR MORE targets — from ANY
//       combination of resource-collection and redirect-collection — now denies via `unresolved`
//       wholesale, rather than resolving a multi-target record. `kernel.ts`'s `matchesTarget`
//       (S2-shipped, unchanged, zero-diff) was never re-derived against a multi-target
//       `ActionRecord` — a shape that did not exist before item 6's Issue #73 fix — and its
//       OR-across-targets ALLOW semantics let a narrowly-scoped allow rule authorize an unrelated,
//       bundled resource riding along in the same call (cross-domain round-2 Issue #82;
//       impact-analyst independently demonstrated a sharper instance — one resource token plus one
//       UNQUOTED redirect target — that a guard scoped only to "resource-token count" would miss).
//       Council-ruled, deliberately normalizer-only: `kernel.ts` stays zero-diff for this story: the
//       general "what does ALLOW mean against a multi-target record" question is real but belongs
//       to whichever future normalizer next needs to reason about it, not solved here (recorded by
//       the Manager, not this file).
//
// Anything this file cannot confidently resolve is reported via `unresolved`, never guessed at or
// silently dropped (ADR-0021 §3.2, SUR-02's terminal fall-through is deny) — the uniform,
// fail-closed pattern every branch below follows without exception.
import type { ActionRecord } from "../kernel/action-record.ts";
import { resolveVerb } from "./action-catalog.ts";
import { buildClusterTarget } from "./target-format.ts";
import { registerNormalizer } from "./registry.ts";
import {
  extractRedirectTargets,
  findLiveChainOperator,
  findLiveRedirectOperatorPositions,
  findLiveSubstitution,
  findLiveTrailingSensitiveSeparator,
  hasUnterminatedQuote,
  normalizeToolToken,
  stripHeredocBodies,
  tokenizeWithOffsets,
} from "./shell-scanner.ts";
import { matchDirectoryFlagToken, resolveFlagAlias } from "./flag-catalog.ts";
import { detectWrapper } from "./wrapper-catalog.ts";
import type { WrapperMatch } from "./wrapper-catalog.ts";

export interface ShellCall {
  command: string;
  environment: string;
  identity: string;
  deferred?: boolean;
}

/** SUR-09 depth cap. A designed safety bound, not a measured operational figure (PRINCIPLES rule
 * 18's spike-first requirement targets measured numbers — latency, capacity, row counts; this is
 * closer in kind to action-catalog.ts's KNOWN_VERBS / kernel.ts's MUTATING_VERBS: "deliberately
 * small and named, not derived"). Realistic composed wrapping rarely exceeds 3 levels
 * (`nohup bash -c "eval $(...)" &` is 3 deep); 5 gives headroom above any plausible legitimate case
 * without being large enough to make unbounded-recursion resource exhaustion a real risk.
 * At-cap behavior resolves via `unresolved` (fail-closed), consistent with every other ambiguous
 * case in this component (design-challenger round-1, Finding #6: SURVIVES on safety, LOW/UNPROVEN
 * on precision — residual, not a blocker; a future spike can measure real nesting depth). */
const DEPTH_CAP = 5;

function unresolvedRecord(raw: ShellCall, unresolved: string[], deferred: boolean): ActionRecord {
  return {
    source: "parsed",
    verbs: [],
    targets: [],
    environment: raw.environment,
    identity: raw.identity,
    deferred,
    unresolved,
  };
}

// Round 3, council-approved path, Issue #82: the standard message for the multi-target cap —
// see resolveKubectlShape's own comment for why this fires regardless of which collection path
// (resource vs. redirect) produced each target.
function multiTargetMessage(count: number): string {
  return `command assembles ${count} targets — denied wholesale rather than partially authorized (Issue #82)`;
}

/** app-security-reviewer, S4 Stage-3 review, Finding 1 (Issue #68); red-team, S4 Stage-3 review,
 * Finding 1 (Issue #70): unterminated-quote detection, chain-operator liveness (the original four
 * plus the two trailing-sensitive separators), and live command/process substitution — all
 * computed on the heredoc-body-stripped live text. Unterminated-quote is checked FIRST and returns
 * immediately: once a quote is unterminated, `quoteStates`' model of everything after it is
 * meaningless, so there is nothing trustworthy left for the other checks to run against. */
function collectSyntaxUnresolved(liveText: string): string[] {
  if (hasUnterminatedQuote(liveText)) {
    return ["unterminated quote — cannot confidently classify the rest of the command"];
  }

  const unresolved: string[] = [];
  const chainOp = findLiveChainOperator(liveText);
  if (chainOp) unresolved.push(`chain operator "${chainOp}" detected outside quotes`);
  const separator = findLiveTrailingSensitiveSeparator(liveText);
  if (separator) unresolved.push(`command separator "${separator}" detected outside quotes`);
  const subst = findLiveSubstitution(liveText);
  if (subst) unresolved.push(`command/process substitution "${subst}" detected`);
  return unresolved;
}

interface FlagScanResult {
  values: Record<string, string>;
  positional: string[];
  directoryFlagFound: boolean;
}

/** Order-independent over the token set (SUR-07's flag-reordering criterion): a flag may appear
 * anywhere among the non-tool tokens without changing which tokens are classified as flags vs.
 * positional (verb/resource) candidates. Also excludes a live redirect operator (`>`/`>>`) and
 * its following target token from `positional` entirely (S4 Stage-3 review, red-team Finding 4 /
 * Issue #73's own follow-on): a redirect target such as "/etc/app/config" trivially "contains a
 * slash" and, left in `positional`, would be wrongly collected as a malformed resource-shaped
 * candidate — poisoning an otherwise-valid resource elsewhere in the SAME command via the shared
 * `resourceMalformed` flag (`collectResources`). `extractRedirectTargets` (shell-scanner.ts)
 * remains the single source of truth for the target VALUES.
 *
 * `isRedirectOperatorToken[i]` tells this function which tokens ARE a live redirect operator, by
 * POSITION (round 3, red-team Finding N1 / Issue #80) — not by re-checking the token's dequoted
 * VALUE, which is exactly what let a quoted literal `">"` argument through as if it were a live
 * operator once quoting had already been stripped, silently swallowing the FOLLOWING resource
 * token along with it. A matched operator token whose OWN value is more than just `">"`/`">>"`
 * (the no-space form, e.g. `">/etc/cron.d/pwn"`, where `tokenize` already merges the operator and
 * its target into one token because no live whitespace separates them) consumes only itself —
 * there is no separate following token to also skip in that case. */
function scanFlags(tokens: readonly string[], isRedirectOperatorToken: readonly boolean[]): FlagScanResult {
  const values: Record<string, string> = {};
  const positional: string[] = [];
  let directoryFlagFound = false;
  let i = 0;
  while (i < tokens.length) {
    if (isRedirectOperatorToken[i]) {
      const token = tokens[i] ?? "";
      // A token consisting of ONLY the operator (plain ">"/">>" or the fd-dup-both-streams
      // "&>"/"&>>" form) has its target as a SEPARATE following token to also skip. A token that
      // is the operator MERGED with its target (the no-space form, e.g. ">/etc/cron.d/pwn",
      // where tokenize glues them together because no live whitespace separates them) consumes
      // only itself — there is no separate following token in that case.
      const isBareOperator = token === ">" || token === ">>" || token === "&>" || token === "&>>";
      i += isBareOperator ? 2 : 1;
      continue;
    }
    const dirMatch = matchDirectoryFlagToken(tokens, i);
    if (dirMatch) {
      directoryFlagFound = true;
      i += dirMatch.tokenSpan;
      continue;
    }
    const token = tokens[i] ?? "";
    const longForm = /^--([a-zA-Z][\w-]*)=(.+)$/.exec(token);
    if (longForm) {
      const [, key, value] = longForm;
      if (key && value) values[key.toLowerCase()] = value;
      i += 1;
      continue;
    }
    const shortForm = /^-([a-zA-Z])=(.+)$/.exec(token);
    if (shortForm) {
      const [, shortKey, value] = shortForm;
      const canonical = shortKey ? resolveFlagAlias(shortKey) : undefined;
      if (canonical && value) values[canonical] = value;
      i += 1;
      continue;
    }
    positional.push(token);
    i += 1;
  }
  return { values, positional, directoryFlagFound };
}

/** Handles a `detectWrapper` result. Returns `undefined` when no wrapper matched at all (caller
 * falls through to kubectl-shaped extraction) — otherwise returns the final record for this call,
 * SUR-09's fail-closed cases included (shape-mismatch, nothing statically extractable, depth-cap
 * exceeded). */
function resolveWrapperMatch(
  raw: ShellCall,
  wrapper: WrapperMatch | "unresolved-shaped" | undefined,
  depth: number,
): ActionRecord | undefined {
  if (wrapper === undefined) return undefined;

  if (wrapper === "unresolved-shaped") {
    return unresolvedRecord(
      raw,
      ["indirect-execution-shaped command does not match a recognized wrapper's expected form"],
      true,
    );
  }

  if (wrapper.inner === undefined) {
    return unresolvedRecord(raw, [`${wrapper.id}: inner command not statically extractable from this invocation`], true);
  }

  if (depth + 1 > DEPTH_CAP) {
    return unresolvedRecord(raw, [`nested command exceeds depth cap (${DEPTH_CAP})`], true);
  }

  const inner = normalizeAtDepth({ ...raw, command: wrapper.inner }, depth + 1);
  return { ...inner, deferred: true };
}

// app-security-reviewer, S3 review, Finding #1 (Issue #65): the resource token split must produce
// EXACTLY 2 non-empty segments; anything else is reported via `unresolved`, never partially
// accepted. Unchanged by S4.
function parseResourceToken(resourceToken: string): { type: string; name: string } | undefined {
  const segments = resourceToken.split("/");
  if (segments.length === 2 && segments[0] && segments[1]) {
    return { type: segments[0], name: segments[1] };
  }
  return undefined;
}

/** red-team, S4 Stage-3 review, Finding 4 (Issue #73): EVERY positional token shaped like a
 * resource (contains "/") is collected, not just the first — "kubectl delete pods/api
 * secrets/db-creds --context=prod" deletes BOTH resources in a real shell, so reporting only the
 * first silently under-reports what a policy rule needs to see. If ANY resource-shaped token
 * fails Issue #65's exact-2-segment check, the whole call is treated as malformed — never
 * partially accept some resources while silently dropping a malformed one. */
function collectResources(positional: readonly string[]): {
  resourceTokens: string[];
  resources: { type: string; name: string }[];
  malformed: boolean;
} {
  const resourceTokens = positional.filter((t) => t.includes("/"));
  const resources: { type: string; name: string }[] = [];
  let malformed = false;
  for (const token of resourceTokens) {
    const parsed = parseResourceToken(token);
    if (parsed) resources.push(parsed);
    else malformed = true;
  }
  return { resourceTokens, resources, malformed };
}

// app-security-reviewer, S3 review, Finding #2 (Issue #66): buildClusterTarget validates its own
// inputs for the "/" delimiter and returns undefined when a field is contaminated — that
// undefined MUST be reported via `unresolved`, not silently downgraded to an empty targets array.
// Unchanged by S4. Extended to every collected resource (not just a single one, S4 Stage-3 review
// red-team Finding 4): if ANY resource's target fails to build, the whole record's targets stay
// empty — never a partial set. Returns the built targets, or `undefined` plus its own push onto
// `unresolved` when contamination is found.
function buildResourceTargets(
  resources: readonly { type: string; name: string }[],
  environment: string,
  cluster: string,
  unresolved: string[],
): string[] {
  const targets: string[] = [];
  for (const resource of resources) {
    const target = buildClusterTarget({ environment, cluster, resourceType: resource.type, resourceName: resource.name });
    if (!target) {
      unresolved.push('target field(s) contain the delimiter character "/"');
      return [];
    }
    targets.push(target);
  }
  return targets;
}

/** The existing S3-reviewed kubectl-shaped grammar (`<tool> <verb> <resourceType>/<resourceName>
 * [--flag=value ...]`), generalized to be order-independent over `positional`, plus additive
 * redirect-target extraction (SUR-08), and generalized to multiple resources/redirects (S4
 * Stage-3 review, red-team Findings 4/5). A command that matches NEITHER shape at all falls
 * through to the kubectl-shape's own `unresolved` messages, preserving S3's exact malformed-call
 * behavior. */
function resolveKubectlShape(
  raw: ShellCall,
  positional: readonly string[],
  flags: Record<string, string>,
  liveText: string,
): ActionRecord {
  const unresolved: string[] = [];

  // Position, not a broader search: after scanFlags removes every flag from `positional`
  // (SUR-07's reordering criterion is about FLAGS moving, not verb/resource swapping), the verb is
  // still the first remaining positional token, the same way tokens[1] was in S3's fixed grammar.
  const verbCandidate = positional[0];
  const resolvedVerb = verbCandidate ? resolveVerb(verbCandidate) : undefined;

  const { resourceTokens, resources, malformed: resourceMalformed } = collectResources(positional);

  const cluster = flags["context"];
  const redirectTargets = extractRedirectTargets(liveText);
  // Checks the RAW `resourceTokens` count (was there any resource-SHAPED candidate at all), not
  // just `resources.length` (how many parsed successfully) — a malformed resource-shaped token
  // still counts as "kubectl was attempted", same as an unresolved verb does, so a command like
  // "cat secrets/db-password/extra-smuggled-segment > /tmp/out" reports the malformed token via
  // the "command resource" message below rather than silently dropping it and clean-resolving as
  // an ordinary write to /tmp/out. This is safe from the original redirect-target-as-fake-resource
  // bug ONLY because scanFlags (above) already excludes a live redirect operator and its target
  // from `positional` entirely — resourceTokens can no longer contain a redirect target at all, so
  // there is nothing left for a raw-count check to be fooled by. Regression-guarded by this
  // file's own build history: reverting to `resources.length` (parsed-only) silently drops the
  // malformed-token-plus-redirect case above into a false-clean write record instead — see
  // `kubectl-attempted-uses-raw-resource-token-regression`'s mutant.
  const kubectlAttempted = resolvedVerb !== undefined || resourceTokens.length > 0 || cluster !== undefined;

  if (!kubectlAttempted && redirectTargets.length > 0) {
    // Not a kubectl-grammar attempt at all — a plain redirect/write shape (SUR-08's own named
    // test: `cmd <<EOF > /target ... EOF` extracts `/target`).
    if (redirectTargets.length >= 2) return unresolvedRecord(raw, [multiTargetMessage(redirectTargets.length)], raw.deferred ?? false);
    return {
      source: "parsed",
      verbs: ["write"],
      targets: redirectTargets,
      environment: raw.environment,
      identity: raw.identity,
      deferred: raw.deferred ?? false,
      unresolved: [],
    };
  }

  if (!resolvedVerb) unresolved.push(`command verb "${verbCandidate ?? ""}"`);
  if (resourceTokens.length === 0) {
    unresolved.push('command resource ""');
  } else if (resourceMalformed) {
    unresolved.push(`command resource "${resourceTokens.join(", ")}"`);
  }
  if (!cluster) unresolved.push("command flag --context");

  const resourceTargets: string[] =
    !resourceMalformed && resources.length > 0 && cluster
      ? buildResourceTargets(resources, raw.environment, cluster, unresolved)
      : [];

  // Round 3, council-approved path (docs/reviews/…council-path-forward-2026-09-03.md), Issue #82:
  // the ASSEMBLED target count — resource-collection targets PLUS redirect-collection targets,
  // from EITHER or BOTH paths — is what matters, not resource-token count alone. A guard scoped
  // only to "2+ resolved resources" closes the original repro but misses impact-analyst's sharper
  // compound PoC (one resource token + one unquoted redirect = 2 assembled targets, same
  // exposure). `kernel.ts`'s `matchesTarget` (S2-shipped, unaudited for this shape, zero-diff this
  // story) composes an ALLOW rule's match via `.some()` across `action.targets` — a record with 2+
  // targets from ANY source lets a narrowly-scoped ALLOW rule authorize an unrelated one riding
  // along. Denying wholesale here, before the kernel ever sees such a record, is the ratified,
  // deliberately normalizer-only fix — `kernel.ts` stays zero-diff for this story.
  const assembledTargetCount = resourceTargets.length + redirectTargets.length;
  if (assembledTargetCount >= 2) {
    return unresolvedRecord(raw, [multiTargetMessage(assembledTargetCount)], raw.deferred ?? false);
  }

  const verbs = resolvedVerb ? [resolvedVerb] : [];
  const targets = [...resourceTargets];
  if (redirectTargets.length > 0) {
    verbs.push("write");
    targets.push(...redirectTargets);
  }

  return {
    source: "parsed",
    verbs,
    targets,
    environment: raw.environment,
    identity: raw.identity,
    deferred: raw.deferred ?? false,
    unresolved,
  };
}

/** Module-internal recursion entry point — `depth` is NEVER exported (architecture-reviewer, S4
 * Stage-3 review, Finding 2 / Issue #77: a public, externally-callable depth parameter is a
 * structural way to bypass the depth cap, even with 0 live call sites doing so today). Only this
 * file's own recursive self-call, below, ever passes a non-default `depth`. */
function normalizeAtDepth(raw: ShellCall, depth: number): ActionRecord {
  const { liveText, bodies } = stripHeredocBodies(raw.command);
  const syntaxUnresolved = collectSyntaxUnresolved(liveText);

  const offsetTokens = tokenizeWithOffsets(liveText);
  const tokens = offsetTokens.map((t) => t.value);
  // Position-based, not value-based (Issue #80) — a token counts as a redirect operator only when
  // it BEGINS at the same character offset as a live `>`/`>>` match (findLiveRedirectOperatorPositions
  // and extractRedirectTargets share the exact same live-operator scan), never by comparing the
  // token's already-dequoted string value.
  const redirectOperatorPositions = new Set(findLiveRedirectOperatorPositions(liveText));
  const isRedirectOperatorToken = offsetTokens.map((t) => redirectOperatorPositions.has(t.start));
  const {
    values: flags,
    positional,
    directoryFlagFound,
  } = scanFlags(tokens.slice(1), isRedirectOperatorToken.slice(1));
  if (directoryFlagFound) syntaxUnresolved.push("directory flag (-C/-d/--directory) present");

  if (syntaxUnresolved.length > 0) {
    return unresolvedRecord(raw, syntaxUnresolved, raw.deferred ?? false);
  }

  const toolToken = normalizeToolToken(tokens[0] ?? "");
  const wrapper = detectWrapper(toolToken, tokens, liveText, bodies);
  const wrapperResult = resolveWrapperMatch(raw, wrapper, depth);
  if (wrapperResult) return wrapperResult;

  return resolveKubectlShape(raw, positional, flags, liveText);
}

/** The only public entry point — always starts recursion at depth 0. See `normalizeAtDepth`'s own
 * comment for why depth is not, and must never become, a parameter of this exported function. */
export function normalizeShellCall(raw: ShellCall): ActionRecord {
  return normalizeAtDepth(raw, 0);
}

registerNormalizer({
  toolType: "shell",
  normalize: (raw) => normalizeShellCall(raw as ShellCall),
});
