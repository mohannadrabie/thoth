import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  checkBrokenInstruments,
  parseBrokenInstrumentsRegistry,
  parseDecisionRows,
} from "./broken-instrument-gate.ts";

const DECISIONS_HEADER = "| Date | Decision (+ evidence) | By | Dissent recorded | Human ratified | Review-back date |\n|---|---|---|---|---|---|\n";

test("QA-16: 0 registered broken instruments -> vacuous pass", () => {
  const result = checkBrokenInstruments([], []);
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, true);
});

test("QA-16: registered instrument with a valid, dated, human-ratified disable decision -> pass", () => {
  const registry = [{ id: "citation-resolver-v1", instrument: "old resolver", brokenSince: "2026-08-01", reason: "couldn't parse house style" }];
  const decisions = parseDecisionRows(
    DECISIONS_HEADER +
      "| 2026-08-15 | Disable the old resolver. `BROKEN-INSTRUMENT-DISABLE: citation-resolver-v1` | Manager | none | Y | 2026-09-01 |\n",
  );
  const result = checkBrokenInstruments(registry, decisions);
  assert.equal(result.ok, true, result.details.join("\n"));
});

test("QA-16: registered instrument with NO disable decision -> FAIL, treated as incident", () => {
  const registry = [{ id: "checksum-formula", instrument: "coverage checksum", brokenSince: "2026-08-01", reason: "excludes a state from denominator" }];
  const result = checkBrokenInstruments(registry, []);
  assert.equal(result.ok, false);
  assert.match(result.details[0] ?? "", /no docs\/decisions\.md row/);
});

test("QA-16: disable row exists but Date is malformed -> still FAILS", () => {
  const registry = [{ id: "id-a", instrument: "x", brokenSince: "2026-08-01", reason: "r" }];
  const decisions = parseDecisionRows(
    DECISIONS_HEADER + "| not-a-date | `BROKEN-INSTRUMENT-DISABLE: id-a` | Manager | none | Y | 2026-09-01 |\n",
  );
  const result = checkBrokenInstruments(registry, decisions);
  assert.equal(result.ok, false);
  assert.match(result.details[0] ?? "", /malformed Date/);
});

test("QA-16: disable row exists but is NOT human-ratified -> still FAILS", () => {
  const registry = [{ id: "id-a", instrument: "x", brokenSince: "2026-08-01", reason: "r" }];
  const decisions = parseDecisionRows(
    DECISIONS_HEADER + "| 2026-08-15 | `BROKEN-INSTRUMENT-DISABLE: id-a` | Manager | none | pending | 2026-09-01 |\n",
  );
  const result = checkBrokenInstruments(registry, decisions);
  assert.equal(result.ok, false);
  assert.match(result.details[0] ?? "", /not human-ratified/);
});

test("QA-16: two registered instruments, only one disabled -> FAIL names only the un-disabled one", () => {
  const registry = [
    { id: "id-a", instrument: "x", brokenSince: "2026-08-01", reason: "r" },
    { id: "id-b", instrument: "y", brokenSince: "2026-08-02", reason: "r2" },
  ];
  const decisions = parseDecisionRows(
    DECISIONS_HEADER + "| 2026-08-15 | `BROKEN-INSTRUMENT-DISABLE: id-a` | Manager | none | Y | 2026-09-01 |\n",
  );
  const result = checkBrokenInstruments(registry, decisions);
  assert.equal(result.ok, false);
  assert.equal(result.details.length, 1);
  assert.match(result.details[0] ?? "", /id-b/);
});

test("QA-16: the real repo registry (docs/qa/broken-instruments.json) parses as empty today, vacuous pass", async () => {
  const json = await readFile("docs/qa/broken-instruments.json", "utf8");
  const registry = parseBrokenInstrumentsRegistry(json);
  assert.deepEqual(registry, []);
  const result = checkBrokenInstruments(registry, []);
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, true);
});
