// Issue #315 (red-team, MED): printEffectivePolicy's last-resort backstop rendered
// `(err as Error).message` through sanitizeForTerminal, so a thrown value that is not an Error
// (undefined, null, a string, an object with no useful toString) turned "never throws, fail closed"
// into a TypeError. On master the same path returned a two-line rejection with exitCode 1.
//
// Written FIRST (failing), by story-implementer, in a file of its own: printer.test.ts is
// test-writer's locked answer key and is not edited here.
//
// The value is thrown from the `raw` accessor of the central result, the one position the loader
// does not wrap (the loader catches read() throwing; it does not catch the accessor), so it reaches
// the printer's own backstop.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { printEffectivePolicy, type PrinterResult } from "./printer.ts";
import type { CentralPolicyResult, CentralPolicySource } from "./central-source.ts";

const TMP = mkdtempSync(path.join(tmpdir(), "thoth-thrown-values-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

const LAYER_DOC = JSON.stringify({
  version: "1.0.0",
  defaultOutcome: "allow",
  rules: [{ id: "base", effect: "deny", verbs: ["run"], targets: ["target"], environments: ["dev"], rationale: "why", mandatory: false }],
});
const shippedPath = path.join(TMP, "shipped.json");
const projectPath = path.join(TMP, "project.json");
writeFileSync(shippedPath, LAYER_DOC);
writeFileSync(projectPath, LAYER_DOC);

function runWithThrown(thrown: unknown): PrinterResult {
  const centralSource: CentralPolicySource = {
    read: (): CentralPolicyResult => ({
      status: "present",
      channel: "test-central-channel",
      get raw(): string {
        throw thrown;
      },
    }),
  };
  return printEffectivePolicy({ shippedDefaultsPath: shippedPath, projectPolicyPath: projectPath, centralSource });
}

const REJECTION_PREFIX = "REJECTED: central policy load failed (read-error): ";

/** The fail-closed rejection shape master returned: exit 1, two lines, unresolved posture. */
function assertFailClosed(r: PrinterResult, label: string): string {
  assert.equal(r.exitCode, 1, `${label}: exit code`);
  assert.equal(r.postureLine, "posture: unresolved (policy load rejected)", `${label}: posture line`);
  assert.equal(r.posture, undefined, `${label}: posture`);
  const lines = r.stdout.split("\n");
  assert.equal(lines.length, 2, `${label}: expected two lines, got ${JSON.stringify(r.stdout)}`);
  assert.equal(lines[0], "central-channel status=read-error", `${label}: line 1`);
  assert.ok(lines[1]?.startsWith(REJECTION_PREFIX), `${label}: line 2 is ${JSON.stringify(lines[1])}`);
  return (lines[1] ?? "").slice(REJECTION_PREFIX.length);
}

class CustomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomError";
  }
}

class HostileMessageError extends Error {
  override get message(): string {
    throw new Error("the message getter itself throws");
  }
}

test("the backstop returns the fail-closed rejection when a port throws undefined", () => {
  assertFailClosed(runWithThrown(undefined), "undefined");
});

test("the backstop returns the fail-closed rejection when a port throws null", () => {
  assertFailClosed(runWithThrown(null), "null");
});

test("the backstop returns the fail-closed rejection when a port throws a string, and shows the string", () => {
  const text = assertFailClosed(runWithThrown("plain string thrown"), "string");
  assert.equal(text, "plain string thrown");
});

test("the backstop strips terminal-active characters from a thrown string", () => {
  const text = assertFailClosed(runWithThrown("boom\u001b[2J\nREJECTED-LOOKALIKE: forged"), "hostile string");
  assert.equal(text, "boom[2JREJECTED-LOOKALIKE: forged");
});

test("the backstop returns the fail-closed rejection when a port throws an object with no useful toString", () => {
  assertFailClosed(runWithThrown(Object.create(null)), "null-prototype object");
  assertFailClosed(runWithThrown({ toString: () => { throw new Error("toString throws"); } }), "object whose toString throws");
  assertFailClosed(runWithThrown({}), "plain object");
});

test("the backstop returns the fail-closed rejection for a thrown symbol, number and boolean", () => {
  assertFailClosed(runWithThrown(Symbol("s")), "symbol");
  assertFailClosed(runWithThrown(42), "number");
  assertFailClosed(runWithThrown(false), "boolean");
});

test("the backstop shows the message of an Error subclass", () => {
  const text = assertFailClosed(runWithThrown(new CustomError("custom failure text")), "Error subclass");
  assert.equal(text, "custom failure text");
});

test("the backstop still returns the rejection when an Error subclass's message getter throws", () => {
  assertFailClosed(runWithThrown(new HostileMessageError()), "Error subclass, throwing message getter");
});

test("the backstop shows a string message on a thrown non-Error object, as master did", () => {
  const text = assertFailClosed(runWithThrown({ message: "object with a message" }), "message-bearing object");
  assert.equal(text, "object with a message");
});
