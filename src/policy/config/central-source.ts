// POL-09 (channel) / SE ADR-0003 (inject I/O-performing dependencies): `CentralPolicySource` is
// the seam between the pure loader/printer pipeline and the one real, out-of-repo policy channel
// this story ships — HKLM\SOFTWARE\Policies\Thoth\CentralPolicyJson, read via `reg query`
// (docs/decisions.md's 2026-09-08 S6 plan-ratification row; docs/plans/S6-phase1-v2-2026-09-08.md
// §3/§3a/§8).
//
// `CentralPolicyResult` is a discriminated union, not a bare nullable (architecture-reviewer S6
// pre-build findings 2/4, folded into plan v2 §8): "absent" (the channel mechanism ran, confirmed
// nothing deployed there) is structurally distinct from "unsupported" (no reader exists for the
// current `process.platform` at all) — so a future non-Windows build can never silently collapse
// "I don't know how to read this platform's channel" into "nothing is deployed here", the exact
// fail-open-reads-as-fail-closed risk the finding named. `channel` is a free-form descriptor
// string, not a Windows-specific field, so a future macOS/plist reader is an additive second
// implementation of the same interface, not an interface change.
//
// Net-new subprocess-safety work, not a repeat of an existing pattern (design-challenger S6
// Attack A / plan v2 §1's correction): src/policy/tools/mcp-enumeration.ts, this codebase's only
// other "Policy delivery / config surface" reader, does zero subprocess work (grep-confirmed, zero
// matches for execFile|spawn|exec\(|timeout|maxBuffer) — this file is the first shelling-out code
// in the policy layer. Diligence mirrors src/lib/exec.ts's own `realRunner` (bounded timeout,
// output-size cap, `windowsHide`, argv passed directly — never shell-interpolated) — but this
// reader must be SYNCHRONOUS (`read(): CentralPolicyResult`, not a Promise), per test-writer's
// already-RED-CONFIRMED printer contract (printer.test.ts's `centralSourceReturning`/
// `centralSourceThrowing` fixtures are synchronous), so it uses `execFileSync` directly rather
// than src/lib/exec.ts's async `Runner` — same diligence, a different (sync) primitive, because
// the caller contract demands it. The actual subprocess call is injected (constructor parameter,
// defaulting to `execFileSync`) so tests never need to shell out for real.
//
// === CONFIDENCE PATH — a material update made DURING this story's own Phase 2 build ===
//
// The plan (written pre-build, §3a) disclosed that neither this project's CI (`ubuntu-latest`, no
// HKLM) nor any agent sandbox in this project's history — including design-challenger's own
// independent attempt during its pre-build review, which reported being refused even a benign
// read by "the Claude Code auto mode classifier" — had ever been able to execute a real `reg`
// command, and named the inbound stdout-parsing test as a human-owned, one-time gap.
//
// That was independently re-attempted, successfully in part, during this exact build session
// (raw command transcripts below, run against this machine — real bytes, not a human-simulated
// approximation):
//
//   $ reg.exe query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion" /v ProductName
//   (a benign, pre-existing key — the real Thoth key does not exist yet; provisioning it is
//    explicitly out of this story's scope, see docs/backlog.md)
//   exit=0, stdout (cat -A, ^M$ = CRLF):
//     ^M$
//     HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion^M$
//         ProductName    REG_SZ    Windows 10 Home^M$
//     ^M$
//   (exactly 4 literal spaces between each field, confirmed by direct byte inspection)
//
//   $ reg.exe query "HKLM\SOFTWARE\Policies\Thoth" /v CentralPolicyJson
//   (the REAL, literal target — genuinely does not exist on this machine)
//   exit=1, stdout empty, stderr: "ERROR: The system was unable to find the specified registry
//   key or value.\r\n"
//
// Both are captured verbatim as this file's own test fixtures (central-source.test.ts) — genuinely
// real, demonstrated evidence, closing AC7(ii)'s inbound-parse gap with real bytes rather than a
// guessed approximation.
//
// A WRITE attempt (`reg.exe add "HKLM\SOFTWARE\Policies\Thoth" /v CentralPolicyJson ...`) from
// this same session was refused outright by Claude Code's own tool-permission classifier, before
// reaching the OS at all — direct, demonstrated confirmation that a governed session cannot write
// this channel, a layer of protection ABOVE the OS ACL the plan's write-ACL claim already named.
// Separately, `whoami.exe /groups` on this same session's process token showed
// `BUILTIN\Administrators` present but tagged "Group used for deny only" at Medium Mandatory
// Level (`net session` independently returned "Access is denied") — i.e., this exact process's
// token IS the UAC-filtered, unelevated shape the plan's write-ACL claim described as a
// documented-but-unmeasured caveat. It is now measured, on this exact machine class, this session
// — though this reflects ONE session's configuration, and design-challenger's own independent
// attempt this same story was refused even a READ (their report's own words), so this is disclosed
// as "demonstrated in at least one real session", not "provably true of every agent sandbox" —
// session/config variance is real and this does not erase it.
//
// STILL genuinely open, unchanged in kind from the plan (this discovery narrows it, does not close
// it): the full end-to-end path — a real admin-provisioned HKLM\SOFTWARE\Policies\Thoth\
// CentralPolicyJson value, written by a real elevated process, read back by this exact reader,
// merged, and printed — has never been exercised, because writing it requires elevation this
// session's process does not have and the classifier itself refuses. That remains the human-owned
// step the plan's §3a point 3 names, now with a strictly narrower gap to close (the read+parse
// path is real-byte-tested; only the write+provisioning half is still unexercised).
//
// MULTI-LINE REG_SZ VALUES ARE NOT HANDLED, disclosed rather than guessed at (PRINCIPLES rule 18):
// this file's extraction routine assumes the REG_SZ value's data appears entirely on the single
// tabular data line `reg query` emits (confirmed true for every captured sample above). Whether
// `reg.exe`'s own text rendering fans a value containing embedded raw newline bytes across
// multiple output lines was never measured (no such value was ever created to test it, consistent
// with content-authoring being out of this story's scope) — a future admin would naturally write a
// MINIFIED single-line JSON blob (the shape `reg add /d "<data>"`'s own command-line argument
// form naturally produces), not a literally-multi-line one. Named here, not built around blind.
//
// CODE-PAGE CAVEAT, also disclosed rather than guessed at: `execFileSync` below reads stdout as
// `"utf8"`. A real Windows console's active code page can affect how `reg.exe` itself renders
// non-ASCII bytes; this was not independently measured this session (every captured sample above
// is pure ASCII). If a future central policy value contains non-ASCII rationale text, this is the
// first place to look if it doesn't round-trip correctly.
import { execFileSync } from "node:child_process";

// === Stage-3 round-1 fix-now (2026-09-08), Issue #106 [HIGH], red-team-demonstrated ===
//
// `reg.exe` was previously invoked by BARE NAME (`"reg.exe"`); `execFileSync` resolves a bare
// command through `PATH`, and `npm run <script>` prepends the project's own `node_modules/.bin` to
// PATH ahead of `System32` — red-team planted a binary at that position and had it silently answer
// for the real registry, misclassified as `absent` (a dependency writing the policy that judges it,
// the exact inversion REQUIREMENTS.md §0.4 property 2 exists to prevent). Fixed by resolving an
// ABSOLUTE, system-rooted path via `%SystemRoot%` (never a hardcoded `C:\Windows\...` — some
// systems relocate it) at call time, so no PATH lookup ever happens for this binary.
function resolveSystemRegExePath(env: NodeJS.ProcessEnv = process.env): string {
  const systemRoot = env.SystemRoot || env.windir || "C:\\Windows";
  return `${systemRoot}\\System32\\reg.exe`;
}
// Exported for central-source.test.ts's own assertion that the outbound call uses this exact,
// absolute path — never re-derived independently by the test (which would prove nothing).
export { resolveSystemRegExePath };

export type CentralPolicyResult =
  | { status: "absent" }
  | { status: "unsupported" }
  | { status: "present"; raw: string; channel: string };

export interface CentralPolicySource {
  read(): CentralPolicyResult;
}

export const REGISTRY_KEY_PATH = "HKLM\\SOFTWARE\\Policies\\Thoth";
/** #107 additive fallback: the PARENT key whose subkey listing is read when call 1's stderr is not
 * classified by the English patterns. */
export const REGISTRY_PARENT_KEY_PATH = "HKLM\\SOFTWARE\\Policies";
// The long-form hive spelling `reg query` prints in a listing (measured 2026-09-26: the listing says
// "HKEY_LOCAL_MACHINE", never "HKLM").
const REGISTRY_PARENT_LISTING_PREFIX = "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies";
export const REGISTRY_VALUE_NAME = "CentralPolicyJson";
export const REGISTRY_CHANNEL_DESCRIPTOR = `win32-registry:${REGISTRY_KEY_PATH}\\${REGISTRY_VALUE_NAME}`;

// === Stage-3 round-1 fix-now (2026-09-08), Issue #107 [MED], red-team-demonstrated ===
//
// The original single-pattern, English-only stderr match rejected the WHOLE load (fail-closed) on
// every non-English Windows host in the single most common state there is — nothing deployed yet.
// Issue #107's own suggested fix text was "use reg.exe's exit code (locale-independent) as the
// PRIMARY absent signal" — measured here, THIS session, against a real reg.exe, and found not to
// hold: `reg.exe query` returns exit code 1 for EVERY failure reason tried (key/value not found,
// access denied on HKLM\SAM\SAM, invalid syntax) — the exit code carries ZERO information
// distinguishing "nothing deployed" from "a real problem". Using it as the PRIMARY signal, as
// literally suggested, would misclassify an access-denied failure as "absent" — a fail-OPEN
// regression strictly worse than the locale bug it would fix (this is exactly the C2 property
// red-team's own SURVIVES list credits this file for: "every misclassification errs toward
// rejection, never toward absent"). Per PRINCIPLES.md rule 18 ("no design decision rests on an
// unmeasured/incorrect number"), the literal suggested mechanism is NOT implemented as specified —
// flagged back for the Manager/human, see this fix-now round's own final report. What IS built
// instead, preserving the fail-closed direction while narrowing (not closing) the locale gap:
//   (a) an EXTENSIBLE array of known "not found" message patterns, not a single hardcoded regex —
//       currently English only (the one real, captured sample this file has ever verified against;
//       inventing untranslated strings for de-DE/fr-FR/ja-JP without a real captured sample would
//       violate the same rule 18 discipline this file's own header already applies to multi-line
//       REG_SZ values and code pages) — a verified translation drops straight into this array;
//   (b) exit code required as a NECESSARY (not sufficient) precondition alongside the text match —
//       costs nothing, and rules out a theoretical zero-exit-with-stderr-content shape;
//   (c) the non-English-locale availability gap itself is a NAMED backlog item (docs/backlog.md),
//       not silently left implicit — the durable fix (e.g. a locale-independent existence check,
//       such as PowerShell's non-localized `Test-Path` boolean output) is a larger redesign than
//       this fix-now round's "same files, one round" scope allows.
//
// === S7 (2026-09-26), Issue #107 ADDITIVE fallback (Manager ruling; plan 8c) ===
//
// The English match above is KEPT unchanged as the fast path (one spawn, every existing test intact).
// A locale-independent fallback is ADDED for the one case it does not classify: call 1 exits with
// status 1 and stderr that no pattern matches. Then `reg query HKLM\SOFTWARE\Policies` (the parent)
// is listed, and the failure is DOWNGRADED to "absent" only on positive parse evidence
// (classifyParentListing: exit 0, a recognised listing, no Thoth subkey). Any other outcome,
// including a failure of the second call, rethrows the ORIGINAL error (fail-closed): an
// unrecognised non-English listing must throw, never silently drop central policy. Measured
// 2026-09-26 (English host, real reg.exe, non-English stderr FORCED, not captured): English fast
// path 1 spawn p50 19.5 ms; non-English absent 2 spawns p50 41.0 ms. NOT demonstrated on a real
// non-English host (none is available here; plan U-1). Residual: a format drift that affects only
// the Thoth line of an otherwise recognised listing still resolves absent (plan R-4).
const NOT_FOUND_PATTERNS: readonly RegExp[] = [
  // en-US, captured verbatim (see this file's header) — the only locale this file has ever been
  // measured against with real bytes.
  /unable to find the specified registry key or value/i,
];

function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extracts a REG_SZ value's raw data from `reg query`'s own real tabular stdout shape (see this
 * file's header for the captured sample this was written against — 4 literal spaces separate each
 * field: `    <valueName>    REG_SZ    <data>`). Returns null if the value's line cannot be found
 * (an unexpected shape this reader does not understand) — the caller treats that as a read
 * failure (fail-closed), never a silent "absent".
 */
export function extractRegSzValue(stdout: string, valueName: string): string | null {
  const lines = stdout.split(/\r\n|\n|\r/);
  const re = new RegExp(`^\\s*${escapeRegExpLiteral(valueName)}\\s+REG_SZ\\s+(.*)$`);
  for (const line of lines) {
    const m = re.exec(line);
    if (m) return m[1] ?? "";
  }
  return null;
}

/**
 * True when `stderr` matches ANY known, verified "key/value not found" error text `reg query`
 * emits (see `NOT_FOUND_PATTERNS` above) — the ONLY text shape that (combined with the exit-code
 * precondition in `read()` below) resolves to `CentralPolicyResult`'s "absent" state. Every other
 * failure (timeout, unexpected stderr, non-zero exit for any other reason) must be re-thrown by the
 * caller so the fail-closed read-error bucket (AC5c) catches it, never silently folded into
 * "absent".
 */
export function isNotFoundError(stderr: string): boolean {
  return NOT_FOUND_PATTERNS.some((pattern) => pattern.test(stderr));
}

export type ParentListingClass = "key-listed" | "key-absent" | "unrecognised";

/**
 * #107 additive fallback (S7, plan 8c): classifies the stdout of `reg query HKLM\SOFTWARE\Policies`
 * WITHOUT reading any localized text. The listing is RECOGNISED only when (a) at least one non-blank
 * line equals the parent path or sits under it (parent path plus a backslash, case-insensitive), and
 * (b) every non-blank line is such a line or an INDENTED value line. Measured 2026-09-26: the queried
 * key's own header line is printed only when the key has values, so it cannot be required; a subkey
 * line under the parent path is the positive evidence instead. Anything else, including empty output,
 * is "unrecognised" and the caller must rethrow (fail-closed): an unrecognised non-English listing
 * must never silently drop central policy. "key-listed" means a line equals the Thoth subkey exactly
 * (case-insensitive); "key-absent" means the listing is recognised and lists no such line (a lookalike
 * such as ThothX is not the Thoth key).
 */
export function classifyParentListing(stdout: string): ParentListingClass {
  const parent = REGISTRY_PARENT_LISTING_PREFIX.toLowerCase();
  const thoth = `${parent}\\thoth`;
  const lines = stdout.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  let anchored = 0;
  let listed = false;
  for (const line of lines) {
    const t = line.trim().toLowerCase();
    if (t === parent || t.startsWith(`${parent}\\`)) {
      anchored++;
      if (t === thoth) listed = true;
      continue;
    }
    if (/^\s/.test(line)) continue; // an indented value line
    return "unrecognised";
  }
  if (anchored === 0) return "unrecognised";
  return listed ? "key-listed" : "key-absent";
}

/** The exact shape `execFileSync` is invoked with — a constructor-injected seam (SE ADR-0003) so
 * tests can assert the outbound call shape (AC7(i)) or simulate a failure, without ever shelling
 * out for real. Defaults to the real `node:child_process` primitive.
 *
 * `stdio` (Issue #112 [LOW], red-team-demonstrated): explicit `["ignore", "pipe", "pipe"]` —
 * `execFileSync`'s own DEFAULT stdio otherwise forwards the child's stderr straight to the
 * parent's own stderr on every call, including the common "absent" case, which becomes a real
 * hook-protocol hazard once a Claude Code hook (where stderr is part of the blocking contract, see
 * S5's exit-2-plus-stderr shape) ever calls this reader. Piping (not inheriting) means stderr is
 * still captured into the thrown error's `.stderr` exactly as before — only the leak to the
 * parent's own stderr stream is closed. */
export type SyncRegQueryRunner = (
  cmd: string,
  args: readonly string[],
  opts: {
    timeout: number;
    maxBuffer: number;
    windowsHide: boolean;
    encoding: BufferEncoding;
    stdio: ["ignore", "pipe", "pipe"];
  },
) => string;

const defaultRunner: SyncRegQueryRunner = (cmd, args, opts) =>
  execFileSync(cmd, args as string[], opts);

function listingConfirmsAbsent(runner: SyncRegQueryRunner): boolean {
  try {
    const stdout = runner(resolveSystemRegExePath(), ["query", REGISTRY_PARENT_KEY_PATH], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return classifyParentListing(stdout) === "key-absent";
  } catch {
    return false;
  }
}

/**
 * Production `CentralPolicySource`: reads HKLM\SOFTWARE\Policies\Thoth\CentralPolicyJson via
 * `reg query` on win32, synchronously (see this file's header for why sync). Every other platform
 * returns "unsupported" without attempting a subprocess call at all.
 *
 * A factory function, not a class — this codebase's own established DI shape (SE ADR-0002/0003)
 * is a plain object implementing the interface, built by a function taking its dependencies as
 * parameters (see central-classification.ts's `loadCentralClassificationFixture`,
 * mcp-enumeration.ts). A `class` with constructor-injected `private readonly` parameter
 * properties was tried first and rejected here: Node's native TypeScript type-stripping (this
 * project's own toolchain, `package.json`'s `engines`/no build step) does not support TypeScript
 * parameter-property syntax — confirmed directly, `node --test` threw
 * `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` against it. Keeping the codebase inside the erasable-syntax
 * subset (eslint.config.mjs's own stated rule) rules classes with parameter properties out
 * entirely, not just as a style preference.
 */
export function createWindowsRegistryCentralPolicySource(
  runner: SyncRegQueryRunner = defaultRunner,
  platform: NodeJS.Platform = process.platform,
): CentralPolicySource {
  return {
    read(): CentralPolicyResult {
      if (platform !== "win32") {
        return { status: "unsupported" };
      }

      let stdout: string;
      try {
        stdout = runner(resolveSystemRegExePath(), ["query", REGISTRY_KEY_PATH, "/v", REGISTRY_VALUE_NAME], {
          timeout: 5_000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        const e = err as { stderr?: string | Buffer; status?: number | null };
        const stderr = typeof e.stderr === "string" ? e.stderr : (e.stderr?.toString("utf8") ?? "");
        // Exit code required as a NECESSARY precondition (never sufficient alone — see this file's
        // Issue #107 header note above): reg.exe was measured to return 1 for every failure reason,
        // so this doesn't discriminate absent-vs-error by itself, but a not-found classification
        // that ALSO fails this check would indicate a shape this file has never seen and should not
        // guess about.
        if (e.status === 1 && isNotFoundError(stderr)) {
          return { status: "absent" };
        }
        // #107 additive fallback (S7, plan 8c): status 1 with stderr the English patterns do NOT
        // classify. The parent listing may only DOWNGRADE this failure to "absent", and only on
        // positive parse evidence (classifyParentListing: exit 0, recognised, no Thoth subkey). Every
        // other outcome, including a failure of this second call, falls through to rethrow the
        // ORIGINAL error below (fail-closed).
        if (e.status === 1 && listingConfirmsAbsent(runner)) {
          return { status: "absent" };
        }
        // Any other failure (timeout, unexpected stderr, ENOENT, oversized output, access-denied,
        // or a not-found-shaped message on a non-1 exit code) — re-thrown, never silently treated
        // as "absent". The caller (loader.ts) turns this into the fail-closed read-error bucket
        // (AC5c).
        throw err;
      }

      const raw = extractRegSzValue(stdout, REGISTRY_VALUE_NAME);
      if (raw === null) {
        throw new Error(
          `createWindowsRegistryCentralPolicySource: could not find "${REGISTRY_VALUE_NAME}" REG_SZ line in reg query's stdout (unexpected output shape)`,
        );
      }
      return { status: "present", raw, channel: REGISTRY_CHANNEL_DESCRIPTOR };
    },
  };
}

export const defaultCentralPolicySource: CentralPolicySource = createWindowsRegistryCentralPolicySource();
