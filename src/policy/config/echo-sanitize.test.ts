// R5 instrument for Issue #294: no policy-derived text reaches `policy:print`'s stdout with a
// terminal-active character in it, and nothing in it can forge an extra output line.
//
// Written FIRST (failing), by story-implementer, per the approved Phase 1 plan
// (docs/plans/s6-294-echoed-key-sanitize-phase1-2026-09-26.md, criteria 5 to 10).
//
// HOW THE COMPLETENESS CLAIM IS CARRIED (CLAUDE.md hard rule: completeness comes from a running
// instrument, never from prose). Two instruments, neither hand-listing sites:
//   1. An enumerating WALK over a valid base document. Every node of the base document (root,
//      every object, every array, every leaf) gets a hostile string put in its VALUE position, and
//      every object gets every one of its keys renamed to hostile text plus one extra hostile
//      unknown key. The walk is repeated in each of the three layers (shipped-defaults, central,
//      project) and every variant goes through the REAL `loadEffectivePolicy` + `printEffectivePolicy`.
//      A schema field added later either fails the "base covers the schema" test below or is
//      picked up by the walk automatically.
//   2. A source SCAN of every `${...}` interpolation in the two print modules: each must be wrapped
//      in `sanitizeForTerminal(...)` or sit on a named code-controlled allowlist. This is a
//      HEURISTIC (a source scan, not a proof: it cannot see string concatenation or a value
//      formatted elsewhere); it exists so a NEW unsanitized echo fails a test instead of relying on
//      someone remembering. The walk in (1) is the behavioral backstop.
// Nothing here hard-codes a count of positions; the counts are whatever the walk yields.
//
// Oracle independence: "terminal-active" is decided by an explicit code-point range list below,
// not by re-using the implementation's regex.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { printEffectivePolicy, renderInertMandatoryNote, type PrinterResult } from "./printer.ts";
import { sanitizeForTerminal } from "./sanitize.ts";
import { validateRule, validateRuleSet } from "../rule/schema.ts";
import type { CentralPolicyResult, CentralPolicySource } from "./central-source.ts";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const TMP = mkdtempSync(path.join(tmpdir(), "thoth-echo-sanitize-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

// ---------------------------------------------------------------------------------------------
// Hostile payload: ESC sequence, newline, a forged status line, U+2028, U+0085 (C1 NEL), CR, NUL,
// DEL, and C1 CSI. HOSTILE_VISIBLE is what remains once exactly those characters are removed
// (hand-typed: strip, not drop, so the visible text must still be there).
// ---------------------------------------------------------------------------------------------
const FORGED = "REJECTED-LOOKALIKE";
const HOSTILE = `\u001b[31m\n${FORGED}: forged line\u2028second\u0085third\rfourth\u0000\u007f\u009b[2J`;
const HOSTILE_VISIBLE = `[31m${FORGED}: forged linesecondthirdfourth[2J`;
/** The hostile text as it must appear INSIDE a JSON string literal (escapes for the control characters). */
const HOSTILE_JSON_BODY = JSON.stringify(HOSTILE).slice(1, -1);

function isTerminalActive(codeUnit: number): boolean {
  return (codeUnit <= 0x1f) || (codeUnit >= 0x7f && codeUnit <= 0x9f) || codeUnit === 0x2028 || codeUnit === 0x2029;
}

/** Everything wrong with `stdout` (empty array = clean). The printer's own "\n" is the only allowed control character. */
function violations(stdout: string, shape: { lines: number; prefixes: readonly string[] }): string[] {
  const out: string[] = [];
  for (let i = 0; i < stdout.length; i++) {
    const cu = stdout.charCodeAt(i);
    if (cu === 0x0a) continue;
    if (isTerminalActive(cu)) out.push(`terminal-active code unit U+${cu.toString(16).padStart(4, "0")} at offset ${i}`);
  }
  const lines = stdout.split("\n");
  if (lines.length !== shape.lines) out.push(`expected ${shape.lines} lines, got ${lines.length}`);
  for (const line of lines) {
    if (line.startsWith(FORGED)) out.push("a line starts with the forged marker");
    if (!shape.prefixes.some((p) => line.startsWith(p))) out.push(`line does not start with an allowed prefix: ${JSON.stringify(line.slice(0, 40))}`);
  }
  if (!lines[0]?.startsWith("central-channel status=")) out.push("line 1 is not the central-channel status line");
  return out;
}

function assertSafe(stdout: string, shape: { lines: number; prefixes: readonly string[] }, context: string): void {
  const v = violations(stdout, shape);
  assert.deepEqual(v, [], `${context}: unsafe stdout ${JSON.stringify(stdout)}`);
}

const REJECTION_PREFIXES = ["central-channel status=", "REJECTED: "] as const;
const SUCCESS_PREFIXES = ["central-channel status=", "VOIDED: ", "--- resolved rules (", "rule id="] as const;
const REJECTED_SHAPE = { lines: 2, prefixes: REJECTION_PREFIXES };
const successShape = (lines: number): { lines: number; prefixes: readonly string[] } => ({ lines, prefixes: SUCCESS_PREFIXES });
const REJECTED_POSTURE = "posture: unresolved (policy load rejected)";

// ---------------------------------------------------------------------------------------------
// Harness: real files for shipped-defaults/project, a stub CentralPolicySource for central.
// ---------------------------------------------------------------------------------------------
type LayerKey = "shipped-defaults" | "central" | "project";
const LAYERS: readonly LayerKey[] = ["shipped-defaults", "central", "project"];
const CENTRAL_CHANNEL = "test-central-channel";

let fileCounter = 0;
function writeLayerFile(label: string, text: string): string {
  const p = path.join(TMP, `${label}-${fileCounter++}.json`);
  writeFileSync(p, text, "utf8");
  return p;
}

interface RunInput {
  shipped: string;
  project: string;
  central: CentralPolicyResult | Error | (() => CentralPolicyResult);
  shippedPath?: string;
  projectPath?: string;
}
function run(input: RunInput): PrinterResult {
  const centralSource: CentralPolicySource = {
    read: () => {
      if (input.central instanceof Error) throw input.central;
      return typeof input.central === "function" ? input.central() : input.central;
    },
  };
  return printEffectivePolicy({
    shippedDefaultsPath: input.shippedPath ?? writeLayerFile("shipped", input.shipped),
    projectPolicyPath: input.projectPath ?? writeLayerFile("project", input.project),
    centralSource,
  });
}

function baseDoc(layer: LayerKey): Record<string, unknown> {
  return {
    version: "1.0.0",
    defaultOutcome: "allow",
    rules: [{ id: `base-${layer}`, effect: "deny", verbs: ["run"], targets: ["target"], environments: ["dev"], rationale: "why", mandatory: false }],
  };
}
const asText = (doc: unknown): string => JSON.stringify(doc, null, 2);

function runWithLayerText(layer: LayerKey, text: string): PrinterResult {
  return run({
    shipped: layer === "shipped-defaults" ? text : asText(baseDoc("shipped-defaults")),
    project: layer === "project" ? text : asText(baseDoc("project")),
    central: { status: "present", channel: CENTRAL_CHANNEL, raw: layer === "central" ? text : asText(baseDoc("central")) },
  });
}

// ---------------------------------------------------------------------------------------------
// The instrument's own health checks
// ---------------------------------------------------------------------------------------------
test("oracle bites: it flags an escape sequence, a forged line, U+2028 and a wrong line count", () => {
  const good = "central-channel status=absent\nREJECTED: project policy load failed (schema-invalid): x";
  assert.deepEqual(violations(good, REJECTED_SHAPE), []);
  assert.notDeepEqual(violations(`${good}\u001b[2J`, REJECTED_SHAPE), []);
  assert.notDeepEqual(violations(`${good}\u2028more`, REJECTED_SHAPE), []);
  assert.notDeepEqual(violations(`${good}\n${FORGED}: forged`, REJECTED_SHAPE), []);
  assert.notDeepEqual(violations(`${good}\nREJECTED: a second real-looking line`, REJECTED_SHAPE), []);
  assert.notDeepEqual(violations("no status line\nREJECTED: x", REJECTED_SHAPE), []);
});

test("the base document is valid in every layer and covers every key the schema knows", () => {
  // Key sets come from the schema's own `expected: one of: ...` text, so a new schema key forces this base to grow.
  const rootExpected = validateRuleSet({ __probe: 1, version: "1", rules: [] })[0]?.expected ?? "";
  const ruleExpected = validateRule({ __probe: 1, id: "x", effect: "allow" })[0]?.expected ?? "";
  const rootKeys = rootExpected.replace(/^one of: /, "").split(", ").sort();
  const ruleKeys = ruleExpected.replace(/^one of: /, "").split(", ").sort();
  assert.ok(rootKeys.length > 0 && ruleKeys.length > 0, "could not derive the schema key sets");
  const base = baseDoc("project");
  assert.deepEqual(Object.keys(base).sort(), rootKeys);
  assert.deepEqual(Object.keys((base.rules as Record<string, unknown>[])[0] as object).sort(), ruleKeys);
  for (const layer of LAYERS) {
    const result = runWithLayerText(layer, asText(baseDoc(layer)));
    assert.equal(result.exitCode, 0, result.stdout);
    assertSafe(result.stdout, successShape(5), `base document, ${layer}`);
  }
});

// ---------------------------------------------------------------------------------------------
// Instrument 1: the enumerating walk
// ---------------------------------------------------------------------------------------------
type Path = (string | number)[];
const pathLabel = (p: Path): string => (p.length === 0 ? "<root>" : p.map((seg, i) => (typeof seg === "number" ? `[${seg}]` : i === 0 ? seg : `.${seg}`)).join(""));
/** Enum-valued fields: a hostile string there is a schema error, not a valid document. */
const ENUM_PATHS = new Set(["defaultOutcome", "rules[0].effect"]);

interface Mutation {
  label: string;
  doc: unknown;
  expectValid: boolean;
  /** Substring the stripped-but-visible hostile text must appear in, when the site is a printed one. */
  expectContains?: (layer: LayerKey) => string;
  /** Substring that must NOT appear at all (a site that is never printed today). */
  expectAbsent?: string;
}

function setAt(root: unknown, p: Path, value: unknown): unknown {
  if (p.length === 0) return value;
  const clone = structuredClone(root) as Record<string | number, unknown>;
  let cur: Record<string | number, unknown> = clone;
  for (let i = 0; i < p.length - 1; i++) cur = cur[p[i] as string | number] as Record<string | number, unknown>;
  cur[p[p.length - 1] as string | number] = value;
  return clone;
}

function renameKey(obj: Record<string, unknown>, from: string, to: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k === from ? to : k, v]));
}

function* walk(node: unknown, p: Path): Generator<{ node: unknown; path: Path }> {
  yield { node, path: p };
  if (Array.isArray(node)) for (let i = 0; i < node.length; i++) yield* walk(node[i], [...p, i]);
  else if (typeof node === "object" && node !== null) for (const [k, v] of Object.entries(node)) yield* walk(v, [...p, k]);
}

function mutationsFor(base: Record<string, unknown>): Mutation[] {
  const out: Mutation[] = [];
  for (const { node, path: p } of walk(base, [])) {
    const label = pathLabel(p);
    // (a) a hostile string in this node's VALUE position
    const freeStringLeaf = typeof node === "string" && !ENUM_PATHS.has(label);
    const m: Mutation = { label: `value at ${label}`, doc: setAt(base, p, HOSTILE), expectValid: freeStringLeaf };
    if (label === "rules[0].id") m.expectContains = (layer) => `rule id=${HOSTILE_VISIBLE} effect=deny layer=${layer}`;
    if (label === "rules[0].rationale") m.expectAbsent = FORGED; // never printed today; a future echo must trip this on purpose
    out.push(m);
    // (b) for every object: every key renamed to hostile text, and one extra hostile unknown key
    if (typeof node === "object" && node !== null && !Array.isArray(node)) {
      const obj = node as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        out.push({
          label: `key ${JSON.stringify(key)} renamed at ${label}`,
          doc: setAt(base, p, renameKey(obj, key, HOSTILE)),
          expectValid: false,
          expectContains: () => `unknown key "${HOSTILE_VISIBLE}"`,
        });
      }
      out.push({
        label: `unknown key added at ${label}`,
        doc: setAt(base, p, { ...obj, [HOSTILE]: 1 }),
        expectValid: false,
        expectContains: () => `unknown key "${HOSTILE_VISIBLE}"`,
      });
    }
  }
  return out;
}

test("the walk covers the printed and unprinted position classes it is meant to (anchors, not a count)", () => {
  const labels = mutationsFor(baseDoc("project")).map((m) => m.label);
  for (const anchor of [
    "value at <root>",
    "value at version",
    "value at rules[0].id",
    "value at rules[0].effect",
    "value at rules[0].verbs[0]",
    "value at rules[0].targets[0]",
    "value at rules[0].environments[0]",
    "value at rules[0].rationale",
    "value at defaultOutcome",
    "unknown key added at <root>",
    "unknown key added at rules[0]",
  ]) {
    assert.ok(labels.includes(anchor), `walk lost the position: ${anchor}`);
  }
  assert.equal(new Set(labels).size, labels.length, "walk produced duplicate labels");
});

for (const layer of LAYERS) {
  for (const m of mutationsFor(baseDoc(layer))) {
    test(`hostile text at every policy-derived JSON position never reaches stdout [${layer}] ${m.label}`, () => {
      const result = runWithLayerText(layer, asText(m.doc));
      if (m.expectValid) {
        assert.equal(result.exitCode, 0, `expected a valid load, got: ${JSON.stringify(result.stdout)}`);
        assert.doesNotMatch(result.postureLine, /unresolved/);
        assertSafe(result.stdout, successShape(5), m.label);
      } else {
        // Criterion 9: sanitizing never turns a rejection into a load.
        assert.equal(result.exitCode, 1, `expected a fail-closed rejection, got: ${JSON.stringify(result.stdout)}`);
        assert.equal(result.postureLine, REJECTED_POSTURE);
        assert.equal(result.inertMandatoryDeclarations.length, 0);
        assertSafe(result.stdout, REJECTED_SHAPE, m.label);
      }
      const contains = m.expectContains?.(layer);
      if (contains !== undefined) assert.ok(result.stdout.includes(contains), `stripped hostile text missing (strip, not drop): ${JSON.stringify(result.stdout)}`);
      if (m.expectAbsent !== undefined) assert.ok(!result.stdout.includes(m.expectAbsent), "an unprinted field is now echoed: review it, then move it out of expectAbsent");
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Structural echoes the walk cannot produce by mutating one value
// ---------------------------------------------------------------------------------------------
const okRule = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id, effect: "deny", verbs: ["run"], ...extra });

test("hostile text in duplicate key, duplicate id, mandatory collision, malformed JSON, read error never reaches stdout", async (t) => {
  const shippedOk = asText(baseDoc("shipped-defaults"));
  const projectOk = asText(baseDoc("project"));
  const centralOk = asText(baseDoc("central"));
  const centralPresent = (raw: string): CentralPolicyResult => ({ status: "present", channel: CENTRAL_CHANNEL, raw });

  await t.test("duplicate top-level key (raw text, escaped in the file)", () => {
    const text = `{"version":"1.0.0","rules":[],"${HOSTILE_JSON_BODY}":1,"${HOSTILE_JSON_BODY}":2}`;
    for (const layer of LAYERS) {
      const r = runWithLayerText(layer, text);
      assert.equal(r.exitCode, 1);
      assert.equal(r.postureLine, REJECTED_POSTURE);
      assertSafe(r.stdout, REJECTED_SHAPE, `duplicate key, ${layer}`);
      assert.ok(r.stdout.includes(`duplicate top-level key "${HOSTILE_VISIBLE}"`), r.stdout);
    }
  });

  await t.test("duplicate rule id", () => {
    const text = asText({ version: "1.0.0", rules: [okRule(HOSTILE), okRule(HOSTILE)] });
    for (const layer of LAYERS) {
      const r = runWithLayerText(layer, text);
      assert.equal(r.exitCode, 1);
      assert.equal(r.postureLine, REJECTED_POSTURE);
      assertSafe(r.stdout, REJECTED_SHAPE, `duplicate id, ${layer}`);
      assert.ok(r.stdout.includes(`duplicate rule id "${HOSTILE_VISIBLE}"`), r.stdout);
    }
  });

  await t.test("mandatory collision: VOIDED line and the surviving rule lines", () => {
    const central = asText({ version: "1.0.0", rules: [okRule(HOSTILE, { mandatory: true })] });
    const project = asText({ version: "1.0.0", rules: [okRule(HOSTILE)] });
    const r = run({ shipped: shippedOk, project, central: centralPresent(central) });
    assert.equal(r.exitCode, 0, r.stdout);
    // status, VOIDED, header, then shipped's rule and central's rule (the project layer is voided)
    assertSafe(r.stdout, successShape(5), "mandatory collision");
    assert.ok(r.stdout.includes(`VOIDED: layer "project" rejected in its entirety: rule id "${HOSTILE_VISIBLE}" redefines a mandatory rule from an earlier layer`), r.stdout);
    assert.ok(r.stdout.includes(`rule id=${HOSTILE_VISIBLE} effect=deny layer=central`), r.stdout);
  });

  await t.test("inert mandatory declaration: raw id kept in the result, rendered note is one clean line", () => {
    const project = asText({ version: "1.0.0", rules: [okRule(HOSTILE, { mandatory: true })] });
    const r = run({ shipped: shippedOk, project, central: centralPresent(centralOk) });
    assert.equal(r.exitCode, 0, r.stdout);
    assertSafe(r.stdout, successShape(5), "inert mandatory stdout");
    assert.equal(r.inertMandatoryDeclarations.length, 1);
    const d = r.inertMandatoryDeclarations[0] as { layer: string; ruleId: string };
    assert.equal(d.ruleId, HOSTILE, "raw text must be kept below the render boundary");
    const note = renderInertMandatoryNote(d);
    assert.equal(note.split("\n").length, 1);
    assert.deepEqual(violations(`central-channel status=x\n${note}`, { lines: 2, prefixes: ["central-channel status=", "NOTE: "] }), []);
    assert.ok(note.includes(`rule id="${HOSTILE_VISIBLE}"`), note);
  });

  await t.test("malformed JSON: the JSON.parse message echoes document text", () => {
    const docs = [HOSTILE, `{${HOSTILE}`, `\u001b[2J\n${FORGED}`, `{"a":${HOSTILE}}`, `{"version":"1.0.0","rules":[${HOSTILE}]}`];
    for (const layer of LAYERS) {
      for (const text of docs) {
        const r = runWithLayerText(layer, text);
        assert.equal(r.exitCode, 1);
        assert.equal(r.postureLine, REJECTED_POSTURE);
        assertSafe(r.stdout, REJECTED_SHAPE, `malformed JSON, ${layer}, ${JSON.stringify(text.slice(0, 12))}`);
      }
    }
  });

  await t.test("read error: hostile path in shipped/project, hostile message from the central reader", () => {
    const hostilePath = path.join(TMP, `missing-${HOSTILE}.json`);
    for (const which of ["shipped", "project"] as const) {
      const r = run({
        shipped: shippedOk,
        project: projectOk,
        central: { status: "absent" },
        ...(which === "shipped" ? { shippedPath: hostilePath } : { projectPath: hostilePath }),
      });
      assert.equal(r.exitCode, 1);
      assert.equal(r.postureLine, REJECTED_POSTURE);
      assertSafe(r.stdout, REJECTED_SHAPE, `read error, ${which} path`);
      assert.match(r.stdout, /\(read-error\)/);
    }
    const r = run({ shipped: shippedOk, project: projectOk, central: new Error(`boom ${HOSTILE}`) });
    assert.equal(r.exitCode, 1);
    assert.equal(r.postureLine, REJECTED_POSTURE);
    assertSafe(r.stdout, REJECTED_SHAPE, "read error, central reader throws");
    assert.ok(r.stdout.includes(`boom ${HOSTILE_VISIBLE}`), r.stdout);
  });

  await t.test("last-resort catch in the printer: an exception outside every named failure shape", () => {
    const central = (): CentralPolicyResult => ({
      status: "present",
      channel: CENTRAL_CHANNEL,
      get raw(): string {
        throw new Error(`backstop ${HOSTILE}`);
      },
    });
    const r = run({ shipped: shippedOk, project: projectOk, central });
    assert.equal(r.exitCode, 1);
    assert.equal(r.postureLine, REJECTED_POSTURE);
    assertSafe(r.stdout, REJECTED_SHAPE, "printer backstop");
    assert.ok(r.stdout.includes(`backstop ${HOSTILE_VISIBLE}`), r.stdout);
  });

  await t.test("hostile central channel descriptor, valid and invalid central content", () => {
    const hostileChannel = `chan ${HOSTILE}`;
    const ok = run({ shipped: shippedOk, project: projectOk, central: { status: "present", channel: hostileChannel, raw: centralOk } });
    assert.equal(ok.exitCode, 0, ok.stdout);
    assertSafe(ok.stdout, successShape(5), "hostile channel, valid central");
    assert.ok(ok.stdout.includes(`channel=chan ${HOSTILE_VISIBLE}`), ok.stdout);
    assert.ok(ok.stdout.includes(`origin=chan ${HOSTILE_VISIBLE} `), ok.stdout);
    const bad = run({ shipped: shippedOk, project: projectOk, central: { status: "present", channel: hostileChannel, raw: "not json" } });
    assert.equal(bad.exitCode, 1);
    assertSafe(bad.stdout, REJECTED_SHAPE, "hostile channel, invalid central");
    assert.ok(bad.stdout.includes(`channel=chan ${HOSTILE_VISIBLE}`), bad.stdout);
  });
});

// The scanned/parsed key-list disagreement guard in validateRuleSet. Reachability through real
// files was probed while building this story: the scanner and JSON.parse agree on every document
// tried in a fresh process, so no deterministic file-level fixture exists (recorded in the report).
// What can be proved: the schema-level message carries raw hostile keys, and the boundary helper
// removes every terminal-active character from the whole message. That the PRINTER applies it to
// every message is proved by the read-error, malformed-JSON and backstop tests above.
test("key-scan disagreement message carries raw hostile keys at schema level and sanitizeForTerminal neutralizes the whole message", () => {
  const text = `{"version":"1.0.0","rules":[],"${HOSTILE_JSON_BODY}":1}`;
  const errors = validateRuleSet({ version: "1.0.0", rules: [] }, text); // a deliberately mismatched parsed view
  const disagreement = errors.find((e) => e.message.startsWith("the raw-text top-level key scan disagrees"));
  assert.ok(disagreement, "disagreement branch not reached");
  assert.ok(disagreement.message.includes(HOSTILE), "expected the raw hostile key in the schema-level message");
  const cleaned = sanitizeForTerminal(disagreement.message);
  assert.deepEqual(violations(`central-channel status=x\n${cleaned}`, { lines: 2, prefixes: ["central-channel status=", "the raw-text"] }), []);
});

// ---------------------------------------------------------------------------------------------
// Criterion 7 and 8
// ---------------------------------------------------------------------------------------------
const PRE_CHANGE_NOTE = (ruleId: string, layer: string): string =>
  `NOTE: rule id="${ruleId}" (layer=${layer}) declares mandatory:true but has no real locking force -- only the central layer's mandatory declarations are authoritative; this declaration is NOT silently dropped, it still resolves normally, but it does not protect anything.`;

test("renderInertMandatoryNote output for clean input equals the pre-change literal", () => {
  assert.equal(renderInertMandatoryNote({ layer: "project", ruleId: "allow-build" }), PRE_CHANGE_NOTE("allow-build", "project"));
  assert.equal(renderInertMandatoryNote({ layer: "shipped-defaults", ruleId: "r_2.x" }), PRE_CHANGE_NOTE("r_2.x", "shipped-defaults"));
});

test("renderInertMandatoryNote strips hostile id and layer, one line", () => {
  const note = renderInertMandatoryNote({ layer: HOSTILE, ruleId: HOSTILE });
  assert.equal(note, PRE_CHANGE_NOTE(HOSTILE_VISIBLE, HOSTILE_VISIBLE));
  assert.equal(note.split("\n").length, 1);
});

test("validateRuleSet keeps the raw hostile key in its error", () => {
  const parsed = JSON.parse(`{"version":"1.0.0","rules":[],"${HOSTILE_JSON_BODY}":1}`) as unknown;
  const errors = validateRuleSet(parsed);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.message, `unknown key "${HOSTILE}"`);
  assert.equal(errors[0]?.field, HOSTILE);
});

test("printed unknown-key error names the stripped offending key (POL-06)", () => {
  const projectPath = writeLayerFile("project", asText({ ...baseDoc("project"), bogus: 1 }));
  const clean = run({ shipped: asText(baseDoc("shipped-defaults")), project: "", projectPath, central: { status: "absent" } });
  assert.equal(clean.exitCode, 1);
  assert.equal(clean.stdout.split("\n")[1], `REJECTED: project policy load failed (schema-invalid): ${projectPath}: bogus: unknown key "bogus"`);
  const hostile = runWithLayerText("project", asText({ ...baseDoc("project"), [HOSTILE]: 1 }));
  assert.ok(hostile.stdout.includes(`${HOSTILE_VISIBLE}: unknown key "${HOSTILE_VISIBLE}"`), hostile.stdout);
});

// ---------------------------------------------------------------------------------------------
// Instrument 2: interpolation scan (HEURISTIC, see the header)
// ---------------------------------------------------------------------------------------------
/** Values the code itself controls: enums, counts, a hex digest, an ISO timestamp, a line number. Exact-match, named. */
const CODE_CONTROLLED: Readonly<Record<string, string>> = {
  "posture.outcome": "VerdictOutcome enum",
  "posture.source": "LayerName enum or the literal bootstrap",
  "centralStatus": "absent | unsupported enum",
  "failedLayer": "FailedLayerName enum",
  "reasonKind": "LoadFailureReasonKind enum",
  "result.merged.rules.length": "a count",
  "rule.effect": "allow | deny, validated by the schema before any print",
  "rule.sourceLayer": "LayerName enum",
  "line": "a number from the tokenizer",
  "rule.mandatory ?? false": "boolean, validated by the schema",
  "result.pin.digest": "sha256 hex digest",
  "result.pin.computedAt": "ISO timestamp from Date",
};

/** Every `${...}` expression in `source`, brace-depth aware, comments (whole-line // only) skipped. */
function interpolations(source: string): string[] {
  const code = source
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*"))
    .join("\n");
  const found: string[] = [];
  for (let i = code.indexOf("${"); i !== -1; i = code.indexOf("${", i + 2)) {
    let depth = 1;
    let j = i + 2;
    while (j < code.length && depth > 0) {
      if (code[j] === "{") depth++;
      else if (code[j] === "}") depth--;
      j++;
    }
    found.push(code.slice(i + 2, j - 1).trim());
  }
  return found;
}

function unsanitized(exprs: readonly string[]): string[] {
  return exprs.filter((e) => !/^sanitizeForTerminal\(.*\)$/s.test(e) && !(e in CODE_CONTROLLED));
}

test("the interpolation scan bites: it flags an unwrapped echo and accepts a wrapped one", () => {
  assert.deepEqual(unsanitized(interpolations("const a = `x ${message}`; const b = `y ${sanitizeForTerminal(message)}`;")), ["message"]);
  assert.deepEqual(unsanitized(interpolations("const a = `x ${failedLayer} ${rule.effect}`;")), []);
  assert.deepEqual(unsanitized(interpolations("const a = `${cond ? { a: 1 }.a : bad}`;")), ["cond ? { a: 1 }.a : bad"]);
});

test("every interpolation in the print modules is sanitized or allowlisted", () => {
  const used = new Set<string>();
  for (const file of ["printer.ts", "print-cli.ts"]) {
    const exprs = interpolations(readFileSync(path.join(THIS_DIR, file), "utf8"));
    assert.ok(exprs.length > 0, `${file}: the scan found no interpolations at all (scanner broken?)`);
    assert.deepEqual(unsanitized(exprs), [], `${file}: unsanitized, non-allowlisted interpolation`);
    for (const e of exprs) if (e in CODE_CONTROLLED) used.add(e);
  }
  const stale = Object.keys(CODE_CONTROLLED).filter((k) => !used.has(k));
  assert.deepEqual(stale, [], "allowlist entries no longer used by the print modules: remove them");
});
