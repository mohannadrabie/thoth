#!/usr/bin/env node
// SessionStart hook (ADR-0021 shape 4, gap G5): computes the session's real, config-derived tool
// universe and halts a session with an unclassified tool — but NOT by itself. ADR-0021's own gap G5
// ("a SessionStart hook cannot halt a session on this runtime; exit code 2 shows stderr and the
// session proceeds") means this script's job is limited to a SIDE EFFECT: writing a halt-state file
// for hooks/userpromptsubmit-halt-relay.mjs (the earliest surface that actually blocks) to act on
// at the next prompt. This script's OWN exit code is therefore never 2 by design, not by accident.
//
// SUR-03's real half (criterion 4): "every tool in the session's real, config-derived tool universe
// is classified at session start; any unclassified tool halts the session at the next
// UserPromptSubmit." No live tool-enumeration API exists on this runtime (S5 plan Named Finding 1,
// re-confirmed: anthropics/claude-code#6574 is an open upstream feature request) — this script
// therefore APPROXIMATES the session's tool universe as:
//   Claude Code's own vendored built-in tool names (src/policy/tools/builtin-tool-inventory.ts)
//   UNION every statically-declared MCP server name from every locally-readable scope (project
//   .mcp.json, user/local ~/.claude.json) — criterion 16, via the pure, names-only
//   src/policy/tools/mcp-enumeration.ts (OPS-02: never reads/logs/emits env/args/command values).
// A declared MCP server's OWN exposed tool names cannot be known without invoking it, so the
// server's own declared NAME stands in as an unclassified "tool" surrogate — sufficient BY ITSELF
// to guarantee unclassified, per Named Finding 1's own text ("a future MCP server whose tools can't
// be statically enumerated counts as unclassified/fail-closed"). This is a disclosed approximation,
// not a live introspection claim (criterion 13's same disclosed-placeholder pattern, applied here).
//
// CONNECTOR-IDENTITY SCHEMA DECISION (criterion 16(b), test-writer's flagged ambiguity resolved
// here — see src/policy/tools/mcp-enumeration.ts's own header comment on
// `extractConnectorIdentities` for the full text): a claude.ai account connector name
// (`~/.claude.json`'s `claudeAiMcpEverConnected`) is NEVER folded into the tool-schema
// `sessionTools` universe below — it carries connector IDENTITY only, no tool-schema mapping is
// possible. It is instead reported, whenever present AND not exempted by the reviewed
// KNOWN_CONNECTORS fixture below, under its own distinct halt-state reason key,
// `"SUR-03-unclassified-connector"` — kept apart from the shared `"SUR-03-unclassified-tool"` key
// ordinary MCP server declarations use.
//
// Project-scope `.mcp.json` servers are only counted as part of the session's tool universe when
// enabled per `.claude/settings.json`'s own real enable/disable semantics
// (enableAllProjectMcpServers / enabledMcpjsonServers / disabledMcpjsonServers) — mirroring this
// runtime's own real approval model (a project-scope server needs explicit trust; a user/local
// ~/.claude.json server is already-approved/global and is always counted). Absent any of these three
// keys, a project .mcp.json server is treated as NOT enabled (the runtime's own real default is
// opt-in) — a disclosed judgment call, untested either way by this story's own acceptance criteria
// (every fixture that plants a project .mcp.json server explicitly sets
// enableAllProjectMcpServers: true, precisely to avoid depending on this default).
//
// Criterion 17: the ENTIRE computation below is wrapped in one try/catch. Any internal exception
// (e.g. a malformed ~/.claude.json, OR a malformed docs/qa/s5-central-classification.json fixture —
// central-classification.ts's parser throws loudly rather than silently dropping a bad field) still
// results in a halt-state file being written, under the generic "SUR-03-enumeration-failed" reason
// key — never a silent no-halt. This is SUR-10's fail-closed discipline applied to a hook that
// itself never blocks (see gap G5 above): failing open here would mean a broken enumeration
// silently never halts anything, forever.
//
// TWO DISCLOSED INTERIM EXEMPTIONS, BOTH SOURCED FROM ONE COMMITTED, DATED, SEPARATELY-REVIEWABLE
// FIXTURE (docs/qa/s5-central-classification.json) — S5 Stage-3 CRITICAL review round 1 finding
// (`red-team` F1/F10, `app-security-reviewer` finding 1, `cross-domain-reviewer` finding 1; GitHub
// Issues #90/#92/#98), human-ruled fix per docs/decisions.md's 2026-09-07 row ("S5 Stage-3 CRITICAL
// review round 1 (`red-team` no-go, `app-security-reviewer`/`cross-domain-reviewer` REWORK)...",
// item (1)). NEITHER allowlist is hardcoded in this file — both are loaded at runtime from that one
// fixture via src/policy/tools/central-classification.ts, which is also the only place either one
// may be edited, and both are pinned by a dedicated regression test
// (src/policy/tools/central-classification.test.ts) and expire automatically at runtime past the
// fixture's own `expiresOn` date (see that module's own header comment — "EXPIRY IS ENFORCED AT
// RUNTIME"). See that module's header for the full disclosure of what each exemption is, and is
// not, a control against.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { evaluateToolInventory } from "../src/policy/tools/classification.ts";
import { mergeToolClassificationLayers } from "../src/policy/rule/precedence.ts";
import { loadBuiltinToolClassificationLayer } from "../src/policy/tools/builtin-tool-inventory.ts";
import { extractConnectorIdentities, extractMcpServerNames } from "../src/policy/tools/mcp-enumeration.ts";
import {
  loadCentralClassificationFixture,
  isFixtureExpired,
  DEFAULT_FIXTURE_PATH,
} from "../src/policy/tools/central-classification.ts";

const UNCLASSIFIED_REASON_KEY = "SUR-03-unclassified-tool";
// Connector-identity schema decision (see src/policy/tools/mcp-enumeration.ts's own header comment
// on extractConnectorIdentities for the full text): a claude.ai account connector is reported under
// this distinct reason key, never merged into UNCLASSIFIED_REASON_KEY above — it carries identity
// only, no tool-schema mapping is possible, so it is never a member of the tool-schema
// `sessionTools` universe evaluateToolInventory classifies against. It IS, unlike a bare MCP server
// name, subject to the KNOWN_CONNECTORS exemption loaded below (see central-classification.ts).
const UNCLASSIFIED_CONNECTOR_REASON_KEY = "SUR-03-unclassified-connector";
const ENUMERATION_FAILED_REASON_KEY = "SUR-03-enumeration-failed";
// Distinct, nameable halt cause for "the exemption fixture itself has expired" (S5 Stage-3 CRITICAL
// review round 2 fix-now, `red-team` N3 / GitHub Issue #101, architecture-reviewer's council-seat
// phrasing "make expiry a nameable relay cause"): past the fixture's own expiresOn, BOTH
// SUR-03-unclassified-tool and SUR-03-unclassified-connector may ALSO fire (every previously-exempt
// name reverts to unclassified/unknown — see computeSessionTools below), but neither of those two
// keys' own unlock hints are correct for THIS cause (re-adding an already-listed name is a no-op
// once the fixture is expired) — see hooks/userpromptsubmit-halt-relay.mjs's own UNLOCK_HINTS entry
// for this key, which names the real unlock (re-ratify or remove the exemption).
const FIXTURE_EXPIRED_REASON_KEY = "SUR-03-central-fixture-expired";
// These four keys (above) are the SUR-03-owned reason keys this script itself is responsible for
// reconciling every run — see writeHaltReason/reconcileReason below (AC5: a resolved condition is
// explicitly cleared, set:false, not merely "never touched again", which is the sticky-halt defect
// red-team's F5 demonstrated: a resumed session whose tool became classified stayed permanently
// blocked because nothing ever cleared its reason). main() below reconciles all four, every run.
//
// The literal fallback session id used whenever stdin's own `session_id` cannot be resolved to a
// real, host-supplied string (GitHub Issue #96 — "should never happen per the documented contract",
// deferred, spike-first, per docs/decisions.md's 2026-09-07 row). S5 Stage-3 CRITICAL review round 2
// (`app-security-reviewer` finding 6 / `red-team`'s Stop Brief escalation) demonstrated that once
// AC5's reconciliation could write set:false, two DIFFERENT failed-session_id-resolution
// invocations sharing this one literal bucket meant one invocation's own resolved state could
// silently clear a genuinely-still-active halt belonging to a different invocation — a fail-open
// escalation of what was previously only a safe-direction (stuck-blocked) gap. `reconcileReason`
// below is the fix: this bucket is additive-only (may still be set:true), never reconciled to
// set:false, relocating Issue #96 back to its pre-round-2 safe direction.
const UNKNOWN_SESSION_ID = "unknown-session";

function readStdin() {
  return new Promise((resolvePromise, rejectPromise) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolvePromise(data));
    process.stdin.on("error", (err) => rejectPromise(err));
  });
}

function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
}

function homeDir() {
  return process.env.HOME ?? process.env.USERPROFILE ?? "";
}

function haltStatePath(sessionId) {
  return join(projectDir(), ".thoth", "halt-state", `${sessionId}.json`);
}

/** `friendly-halt-messages` story: individually double-quotes each name so a multi-name list reads
 * unambiguously (`"foo", "bar"` rather than a bare comma-joined `foo, bar`, where an embedded comma
 * in a single name could otherwise misread as a boundary). Used at both reconcileReason(...) call
 * sites below for SUR-03-unclassified-tool/-connector in place of the previous
 * "unclassified:"/"connector identity present:" prefixes, which are now redundant --
 * hooks/userpromptsubmit-halt-relay.mjs's own new FRIENDLY_LABELS prefix ("Unrecognized tool" /
 * "Unrecognized connector") already carries that meaning. Two edge cases are deliberately left
 * unhandled per this pass's own ratified scope (Manager-approved 2026-09-17, ship as disclosed
 * residuals, no escaping/truncation-boundary logic): a literal `"` inside a name breaks the visual
 * quote boundary, and hooks/userpromptsubmit-halt-relay.mjs's own sanitizeDetail may truncate this
 * string mid-quote on a long multi-name list. */
function quoteNames(names) {
  return names.map((name) => `"${name}"`).join(", ");
}

/** Best-effort read of an already-existing halt-state file for merge purposes. A malformed
 * existing file is NOT this script's fail-closed concern (that property belongs to
 * hooks/userpromptsubmit-halt-relay.mjs, tested there) — treated as "nothing to merge with" so this
 * writer can still make forward progress recording its own reason. */
function readExistingHaltState(sessionId) {
  const p = haltStatePath(sessionId);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return undefined;
  }
}

/** Merges `reasonKey` -> `{set, detail, setAt}` into the existing halt-state file for `sessionId`
 * (criterion 20: additive by construction — every OTHER reason key already present is preserved
 * untouched). `set` is an explicit boolean, not assumed `true` — AC5's reconciliation (see
 * `reconcileReason` below) needs to write `set:false` just as often as `set:true`, and `setAt` is
 * always refreshed to the current write, whichever way `set` goes, so an operator can tell when a
 * reason was last touched either way. A file is written (or its own key updated) even when `set` is
 * `false` and no prior entry existed for this key — harmless (a `set:false` entry is inert to the
 * relay's own fail-closed check) and keeps every SUR-03-owned key's own history visible rather than
 * silently absent.
 *
 * `fixtureLocation` (S5 fix-now condition -- see `resolveFixtureLocation`'s own header comment for
 * the full citation) is stamped at the TOP LEVEL of the written object, alongside `reasons`, every
 * time this function actually writes -- i.e. exactly on the runs that already produce a halt-state
 * file. It is never used to justify a write that wouldn't otherwise happen: this function has no
 * call site that fires only to record the fixture location, so a vanilla, fully-classified session
 * that never calls this function still leaves NO file at all (criterion 4 / AC-4, unmodified). This
 * is an additive top-level field -- `hooks/userpromptsubmit-halt-relay.mjs`'s `inspectHaltState`
 * only ever reads `.reasons`, confirmed by direct trace, so an unknown top-level key is inert to it. */
function writeHaltReason(sessionId, reasonKey, set, detail, fixtureLocation) {
  const existing = readExistingHaltState(sessionId);
  const reasons =
    existing && typeof existing === "object" && existing.reasons && typeof existing.reasons === "object"
      ? { ...existing.reasons }
      : {};
  reasons[reasonKey] = { set, detail, setAt: new Date().toISOString() };

  const p = haltStatePath(sessionId);
  mkdirSync(join(projectDir(), ".thoth", "halt-state"), { recursive: true });
  const payload = { sessionId, reasons };
  if (fixtureLocation) {
    payload.fixtureSource = fixtureLocation.fixtureSource;
    payload.fixturePath = fixtureLocation.fixturePath;
  }
  writeFileSync(p, JSON.stringify(payload, null, 2), "utf8");
}

/** True iff `reasonKey` was already `set:true` in `initialHaltState` (a snapshot read ONCE at the
 * start of this run, before any of this run's own writes) — used by `reconcileReason` below to
 * decide whether a currently-inactive reason needs an explicit set:false write, or whether it was
 * never active in the first place and the file should simply stay untouched for that key. */
function wasReasonActive(initialHaltState, reasonKey) {
  if (typeof initialHaltState !== "object" || initialHaltState === null) return false;
  const reasons = initialHaltState.reasons;
  if (typeof reasons !== "object" || reasons === null) return false;
  const entry = reasons[reasonKey];
  return typeof entry === "object" && entry !== null && entry.set === true;
}

/** AC5: reconciles one of this script's OWN reason keys to the CURRENT truth this run — but only
 * ever WRITES when there is something to say: `active` true always writes `set:true` with
 * `detail` (whether or not a file/key existed before); `active` false writes an explicit
 * `set:false` ONLY when `initialHaltState` shows this exact key was PREVIOUSLY `set:true` —
 * otherwise (never active, nothing to clear) the file is left completely untouched for this key,
 * preserving criterion 4's own "a fully-classified, unconfigured session leaves no halt-state file
 * at all" contract (test-writer's own AC-4 test, unmodified).
 *
 * This is the fix for red-team's F5 sticky-halt finding: SessionStart genuinely re-runs on a
 * resumed session (demonstrated in F5's own report), so a session whose unclassified tool has
 * since been reclassified (or whose stdin parsed cleanly this time) is unblocked automatically on
 * the next SessionStart, not left bricked forever — without ever creating a spurious file/key for
 * a condition that was never active to begin with. */
function reconcileReason(initialHaltState, sessionId, reasonKey, active, activeDetail, fixtureLocation) {
  if (active) {
    writeHaltReason(sessionId, reasonKey, true, activeDetail, fixtureLocation);
  } else if (sessionId === UNKNOWN_SESSION_ID) {
    // GitHub Issue #96 escalation (S5 Stage-3 CRITICAL review round 2, `app-security-reviewer`
    // finding 6 / `red-team`'s Stop Brief): the shared fallback bucket is NEVER reconciled to
    // set:false, regardless of what wasReasonActive says -- a colliding invocation that also failed
    // to resolve a real session_id has no way to know whether the previously-set:true entry under
    // this bucket belongs to its own logical session or a different one, so it must never clear it.
    // This bucket may still be additively set:true (above); it just never transitions back to
    // false, preserving the pre-round-2 safe direction (stuck-blocked, not fail-open).
  } else if (wasReasonActive(initialHaltState, reasonKey)) {
    writeHaltReason(sessionId, reasonKey, false, "condition no longer holds as of this SessionStart run", fixtureLocation);
  }
  // else: never active, and not previously set -- deliberately leave the file/key untouched.
}

function readJsonFileIfExists(path) {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  return JSON.parse(text); // deliberately NOT caught here — a malformed file must propagate up to
  // this script's own top-level try/catch, which is exactly what criterion 17 requires: an
  // internal exception during enumeration still results in a halt-state write, never a silent
  // no-halt.
}

/** Resolves WHICH central-classification fixture file this run's production code path will load --
 * the project-relative primary (`<projectDir>/docs/qa/s5-central-classification.json`) vs. the
 * module-adjacent `DEFAULT_FIXTURE_PATH` fallback (see this file's own header comment on
 * `projectRelativeFixturePath`'s original inline form for why the fallback exists at all: an
 * isolated test tree with no fixture of its own must still read the real committed fixture, exactly
 * as it did before the round-2/round-3 fix-now history below).
 *
 * S5 FIX-NOW CONDITION (both council reports' SAFE-TO-PATCH/APPROVE-WITH-CONDITIONS verdicts,
 * red-team round 2's own stated prerequisite for its N2 date-pin to mean anything --
 * docs/reviews/s5-fixnow-council-impact-analyst-2026-09-07.md,
 * docs/reviews/s5-central-classification-architecture-council-2026-09-07.md,
 * docs/reviews/s5-fixnow-round2-red-team-2026-09-07.md): "record the resolved fixture path in
 * halt-state, so a non-default load is never silent." Computed ONCE, here, as the very first thing
 * `main()` does (see main()'s own comment) -- BEFORE stdin is even read, and therefore available to
 * the top-level catch handler even when a LATER step throws (a malformed fixture, a malformed
 * ~/.claude.json read before this point in `computeSessionTools`, or anything else criterion 17
 * guards) -- "never silent" must hold on the enumeration-FAILED path too, not only the happy path.
 *
 * Deliberately pure and non-throwing by construction (`existsSync`/`join` never throw for a
 * well-formed path) -- `main()` still wraps its own call to this in a defensive try/catch (see
 * below) as a matter of this file's own criterion-17 discipline, never assumed safe just because it
 * looks safe.
 *
 * Scoped by AC-4 (test-writer's own "a vanilla, fully-classified session leaves no halt-state file
 * at all" contract, unmodified): this function's RESULT is only ever written to disk by
 * `writeHaltReason` (via `reconcileReason` or the catch-block's own direct call) -- i.e. exactly on
 * the runs that already produce a halt-state file for some other, genuine reason. Resolving this
 * value never itself causes a file to be written; a session with nothing ever active still leaves no
 * file, and therefore no fixtureSource/fixturePath either -- there being nothing to attach them to is
 * not the same as being silent about a real load. */
function resolveFixtureLocation() {
  const projectRelativeFixturePath = join(projectDir(), "docs", "qa", "s5-central-classification.json");
  return existsSync(projectRelativeFixturePath)
    ? { fixtureSource: "project-relative", fixturePath: projectRelativeFixturePath }
    : { fixtureSource: "fallback-default", fixturePath: DEFAULT_FIXTURE_PATH };
}

function isProjectMcpServerEnabled(serverName, projectSettings) {
  if (!projectSettings || typeof projectSettings !== "object") return false;
  if (projectSettings.enableAllProjectMcpServers === true) return true;
  const enabledList = projectSettings.enabledMcpjsonServers;
  if (Array.isArray(enabledList) && enabledList.includes(serverName)) return true;
  const disabledList = projectSettings.disabledMcpjsonServers;
  if (Array.isArray(disabledList) && disabledList.includes(serverName)) return false;
  return false; // real runtime default is opt-in; see this file's header comment
}

/** Computes the session's approximated tool-schema universe (builtin names ∪ enabled MCP server
 * names from every statically-readable local scope — CONNECTOR IDENTITIES DELIBERATELY EXCLUDED,
 * see the connector-identity schema decision above and in mcp-enumeration.ts) and evaluates it
 * against the merged classification catalog. Also returns any declared connector identities
 * separately (already filtered against the KNOWN_CONNECTORS exemption fixture), for main() to
 * report under their own distinct reason key. Throws on any malformed input file — caught by
 * main()'s own top-level try/catch.
 *
 * `fixtureLocation` (from `resolveFixtureLocation`, resolved once by main() before this is called)
 * names exactly which fixture file to load -- this function no longer re-derives that decision
 * itself, so there is exactly one place in this file that decides project-relative vs. fallback. */
function computeSessionTools(fixtureLocation) {
  const projectSettingsPath = join(projectDir(), ".claude", "settings.json");
  const projectSettings = readJsonFileIfExists(projectSettingsPath);

  const projectMcpPath = join(projectDir(), ".mcp.json");
  const projectMcpJson = readJsonFileIfExists(projectMcpPath);
  const allProjectMcpNames = projectMcpJson ? extractMcpServerNames(projectMcpJson, "mcp.json") : [];
  const enabledProjectMcpNames = allProjectMcpNames.filter((name) => isProjectMcpServerEnabled(name, projectSettings));

  const homeClaudeJsonPath = join(homeDir(), ".claude.json");
  const homeClaudeJson = readJsonFileIfExists(homeClaudeJsonPath);
  // extractMcpServerNames("claude.json") merges server names + connector identities (by design,
  // see mcp-enumeration.ts) — connectorNames is subtracted back out below so the tool-schema
  // universe below never includes a connector identity, per the schema decision.
  const homeAllNames = homeClaudeJson ? extractMcpServerNames(homeClaudeJson, "claude.json") : [];
  const connectorNames = homeClaudeJson ? extractConnectorIdentities(homeClaudeJson) : [];
  const homeMcpServerOnlyNames = homeAllNames.filter((name) => !connectorNames.includes(name));

  const builtinLayer = loadBuiltinToolClassificationLayer();

  // Load the ONE committed, dated, separately-reviewable fixture backing both disclosed interim
  // exemptions (see this file's own header comment and central-classification.ts's own header for
  // the full disclosure). A malformed fixture throws here — propagates to main()'s top-level
  // try/catch, same fail-closed treatment as any other malformed input file (criterion 17).
  //
  // NO ENVIRONMENT VARIABLE OF ANY KIND CONTROLS WHICH FIXTURE FILE THIS PRODUCTION CODE PATH LOADS
  // (S5 Stage-3 CRITICAL review round 2 fix-now, closing GitHub Issue #99 at its architectural root
  // per `architecture-reviewer`'s council-seat ruling / `red-team`'s N1: a prior draft of this line
  // read a dedicated `THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH` env var, unconditionally, with no
  // DI boundary and no recorded trace of what loaded -- an ambient, session-reachable signal
  // (deliverable via a gitignored `.claude/settings.local.json` `env` block invisible to `git
  // status`/`qa:gate-manifest`) deciding which policy source a fail-closed gate trusts, violating
  // REQUIREMENTS.md:70 section 0.4 property 2 by construction, independent of exploitability).
  //
  // The fixture path is resolved the SAME way every other file this hook reads already is —
  // project-relative, via projectDir() (the CLAUDE_PROJECT_DIR/cwd seam already used above for
  // `.claude/settings.json`, `.mcp.json`) — with a fallback to the module-adjacent committed copy
  // (central-classification.ts's own DEFAULT_FIXTURE_PATH) when no fixture exists at that
  // project-relative location. This is NOT a new override mechanism: in every real invocation,
  // CLAUDE_PROJECT_DIR already points at this same repo, so the project-relative path and the
  // module-adjacent default resolve to the exact same file. The fallback exists ONLY so that an
  // isolated test tree with no central-classification fixture of its own (e.g. this repo's own
  // pre-existing, unmodified `hooks/sessionstart-tool-enum.test.ts` vanilla-session fixtures, which
  // predate this mechanism and never plant one) still reads the real committed fixture, exactly as
  // it did before this mechanism existed — never "no fixture found -> exempt everything" or "-> a
  // different, attacker-choosable file". A true end-to-end test that needs a SYNTHETIC/expired
  // fixture writes it to this exact project-relative path inside its own already-isolated
  // CLAUDE_PROJECT_DIR tree (hooks/test-support/fixture-tree.ts's
  // writeCentralClassificationFixture) -- true dependency injection through the already-pure
  // parseCentralClassificationFixture/loadCentralClassificationFixture split, never a bespoke,
  // fixture-specific ambient signal. A unit test that only needs the pure parse/expiry logic calls
  // parseCentralClassificationFixture/isFixtureExpired directly against an in-memory fixture object,
  // bypassing file I/O and this hook entirely (see central-classification.test.ts).
  //
  // WHICH of the two paths above was actually used (`fixtureLocation.fixtureSource`/`.fixturePath`)
  // is resolved once by main() via `resolveFixtureLocation()` -- not re-derived here -- and passed
  // in so this function and the halt-state writer agree on the exact same decision (S5 fix-now
  // condition: "record the resolved fixture path in halt-state, so a non-default load is never
  // silent" — see `resolveFixtureLocation`'s own header comment for the full citation).
  const fixture = loadCentralClassificationFixture(fixtureLocation.fixturePath);
  const fixtureExpired = isFixtureExpired(fixture);
  // Past expiresOn, BOTH exemptions stop being applied automatically — see central-classification.ts
  // ("EXPIRY IS ENFORCED AT RUNTIME"). An empty centralLayer means every one of its named MCP
  // servers reverts to unclassified; an empty knownConnectors set means every connector reverts to
  // unknown. Neither silently keeps running on its last-known-good state past its own dated ratification.
  const centralLayer = fixtureExpired ? { version: fixture.version, tools: [] } : fixture.centralLayer;
  const knownConnectors = fixtureExpired ? new Set() : new Set(fixture.knownConnectors);

  const merged = mergeToolClassificationLayers(builtinLayer, centralLayer);

  const builtinNames = builtinLayer.tools.map((t) => t.name);
  const sessionTools = [...builtinNames, ...enabledProjectMcpNames, ...homeMcpServerOnlyNames];

  // KNOWN_CONNECTORS is filtered here, in the hook's own disclosed, reviewable judgment call site —
  // not upstream in mcp-enumeration.ts, which stays a pure, policy-free extraction function (per its
  // own header).
  const unknownConnectorNames = connectorNames.filter((name) => !knownConnectors.has(name));

  return {
    inventoryResult: evaluateToolInventory(merged, sessionTools),
    unknownConnectorNames,
    fixtureExpired,
    fixtureExpiresOn: fixture.expiresOn,
  };
}

async function main() {
  // sessionId is resolved OUTSIDE the try block's own scope-of-concern (reading/parsing stdin is
  // not itself the "enumeration" criterion 17 guards — it is Claude Code's own documented, always
  // well-formed hook payload) but the try/catch still wraps it: a malformed/empty stdin is exactly
  // as much an "internal exception during enumeration" as a malformed ~/.claude.json is, and both
  // must still result in a best-effort halt-state write, never a silent no-halt.
  //
  // Known pre-existing gap (GitHub Issue #96, not fixed this pass — see docs/decisions.md's
  // 2026-09-07 row and docs/backlog.md): when stdin ITSELF is what fails to parse, session_id is
  // never resolved, and the catch below writes its reason to "unknown-session.json" rather than the
  // real session's own file — the relay for the real session never sees it. Deferred, spike-first,
  // per PRINCIPLES rule 18 (no fix built on an unmeasured fact — the two candidate fixes each rest
  // on an unconfirmed assumption about this hook process's real environment). What IS fixed this
  // pass (round 2's own escalation of this gap): `reconcileReason`'s set:false branch never applies
  // to this fallback bucket — see UNKNOWN_SESSION_ID's own header comment above.
  let sessionId = UNKNOWN_SESSION_ID;
  // Resolved OUTSIDE (before) the try block, and independently of stdin/sessionId resolution, so it
  // is available to the catch handler below even when a LATER step throws -- S5 fix-now condition
  // ("record the resolved fixture path in halt-state, so a non-default load is never silent") must
  // hold on the enumeration-FAILED path too, not only the happy path. See resolveFixtureLocation's
  // own header comment for the full citation. Defensively wrapped even though the function is pure
  // and non-throwing by construction -- this file's own criterion-17 discipline never assumes a
  // function is safe just because it looks safe; falling back to "unknown" here still lets the rest
  // of this run's own fail-closed behavior (halting on a genuine condition) proceed unaffected, it
  // only means THIS particular disclosure is degraded, never that a halt is suppressed.
  let fixtureLocation = { fixtureSource: "unknown", fixturePath: null };
  try {
    fixtureLocation = resolveFixtureLocation();
  } catch (locErr) {
    process.stderr.write(
      `sessionstart-tool-enum.mjs: failed to resolve fixture location (non-fatal, continuing): ${locErr?.stack ?? locErr}\n`,
    );
  }
  try {
    const raw = await readStdin();
    const input = raw.trim() === "" ? {} : JSON.parse(raw);
    sessionId = typeof input.session_id === "string" ? input.session_id : UNKNOWN_SESSION_ID;

    // Snapshot ONCE, before any of this run's own writes -- see wasReasonActive/reconcileReason's
    // own header comments for why this matters (deciding whether a currently-inactive reason has
    // anything to clear, without ever creating a spurious file/key for a condition that was never
    // active).
    const initialHaltState = readExistingHaltState(sessionId);

    const { inventoryResult, unknownConnectorNames, fixtureExpired, fixtureExpiresOn } = computeSessionTools(fixtureLocation);

    // AC5: reconcile every SUR-03-owned reason key to the CURRENT truth this run, every run — never
    // "only ever set, never clear" (red-team F5's sticky-halt finding). A resolved condition writes
    // set:false explicitly, unblocking a resumed session whose tool/connector situation has since
    // been fixed, without requiring any manual halt-state edit — but a condition that was NEVER
    // active leaves the file/key untouched (criterion 4's vanilla no-file contract). See
    // reconcileReason's own header comment for the one exception (the UNKNOWN_SESSION_ID fallback
    // bucket is additive-only, never reconciled to set:false).
    reconcileReason(
      initialHaltState,
      sessionId,
      UNCLASSIFIED_REASON_KEY,
      inventoryResult.haltRequired,
      quoteNames(inventoryResult.unclassified),
      fixtureLocation,
    );
    reconcileReason(
      initialHaltState,
      sessionId,
      UNCLASSIFIED_CONNECTOR_REASON_KEY,
      unknownConnectorNames.length > 0,
      quoteNames(unknownConnectorNames),
      fixtureLocation,
    );
    // Distinct, nameable cause for "the exemption fixture itself has expired" (see
    // FIXTURE_EXPIRED_REASON_KEY's own header comment) -- reconciled independently of the two
    // reasons above so the relay can tell "unclassified because never listed" apart from
    // "unclassified because the whole fixture just expired" and name the correct unlock for each.
    reconcileReason(
      initialHaltState,
      sessionId,
      FIXTURE_EXPIRED_REASON_KEY,
      fixtureExpired,
      `docs/qa/s5-central-classification.json's exemption fixture expired on ${fixtureExpiresOn} -- both interim allowlists (centralLayer.tools and knownConnectors) have reverted to unclassified/unknown, regardless of their listed contents`,
      fixtureLocation,
    );
    // This run completed enumeration successfully — reconcile ENUMERATION_FAILED_REASON_KEY closed
    // too, in case a PRIOR run on this same session id had set it (e.g. a transient malformed file
    // since fixed by hand).
    reconcileReason(
      initialHaltState,
      sessionId,
      ENUMERATION_FAILED_REASON_KEY,
      false,
      "enumeration completed without error",
      fixtureLocation,
    );
  } catch (err) {
    // Criterion 17: the whole computation's own exception path still results in a halt-state
    // write, under the generic reason key — never a silent no-halt. Best-effort: if even THIS
    // write fails, there is nothing further to do — SessionStart can never block regardless (gap
    // G5), so this script still exits 0 either way. Always writes true here -- an exception is
    // inherently "active", no need to consult prior state. `fixtureLocation` is whatever was
    // resolved above (real, or the "unknown" fallback if even that resolution itself failed) — the
    // S5 fix-now condition's "never silent" property degrades gracefully to "unknown" rather than
    // ever suppressing this halt write.
    try {
      writeHaltReason(
        sessionId,
        ENUMERATION_FAILED_REASON_KEY,
        true,
        `internal exception during tool enumeration: ${err?.message ?? String(err)}`,
        fixtureLocation,
      );
    } catch (writeErr) {
      process.stderr.write(
        `sessionstart-tool-enum.mjs: failed to write halt-state on exception: ${writeErr?.stack ?? writeErr}\n`,
      );
    }
    process.stderr.write(`sessionstart-tool-enum.mjs: internal exception during enumeration: ${err?.stack ?? err}\n`);
  }
  process.exit(0); // never 2 — SessionStart cannot block on this runtime (gap G5)
}

await main();
