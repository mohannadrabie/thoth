// G14 and G14b (S7 plan section 7, PC-9, N2): the shared fixture-location and catalog module.
// story-implementer's own tests, written failing first.
//
// G14  one shared module: the LOCATION function is pure (project-relative when the file exists,
//      else DEFAULT_FIXTURE_PATH); both hooks import it and neither carries an inline copy; for the
//      real repo the gate's module-relative path and SessionStart's resolved path are the same file.
// G14b location is SEPARATE from catalog assembly and never throws: SessionStart resolves it before
//      it reads stdin so its catch path can still record `fixturePath` in halt-state when the
//      fixture then fails to load (THOTH-ADR-0001 rule 5, "never silent").
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assembleCatalog,
  moduleRelativeFixtureLocation,
  projectDir,
  resolveFixtureLocation,
} from "./classification-catalog.ts";
import { DEFAULT_FIXTURE_PATH } from "./central-classification.ts";
import { stripComments } from "../../qa/kernel-purity-check.ts";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const REL_FIXTURE = join("docs", "qa", "s5-central-classification.json");

function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `thoth-s7-catalog-${label}-`));
}

test("G14: resolveFixtureLocation is pure: project-relative when the fixture file exists there, else DEFAULT_FIXTURE_PATH; projectDir is CLAUDE_PROJECT_DIR, else cwd", () => {
  const dir = "/some/project";
  const wanted = join(dir, REL_FIXTURE);
  assert.deepEqual(resolveFixtureLocation(dir, (p) => p === wanted), { fixtureSource: "project-relative", fixturePath: wanted });
  assert.deepEqual(resolveFixtureLocation(dir, () => false), { fixtureSource: "fallback-default", fixturePath: DEFAULT_FIXTURE_PATH });
  assert.equal(projectDir({ CLAUDE_PROJECT_DIR: "/p" }, () => "/cwd"), "/p");
  assert.equal(projectDir({}, () => "/cwd"), "/cwd");
  assert.deepEqual(moduleRelativeFixtureLocation(), { fixtureSource: "module-relative", fixturePath: DEFAULT_FIXTURE_PATH });
});

test("G14: both hook sources import the shared module and neither contains an inline fixture resolution or a direct fixture load; for the real repo the gate's path and SessionStart's resolved path are the same file", () => {
  for (const hook of ["pretooluse-kernel-gate.mjs", "sessionstart-tool-enum.mjs"]) {
    const source = readFileSync(join(REPO_ROOT, "hooks", hook), "utf8");
    assert.match(source, /classification-catalog\.ts/, `${hook} imports the shared module`);
    const code = stripComments(source);
    assert.ok(!/loadCentralClassificationFixture\s*\(/.test(code), `${hook}: no inline loadCentralClassificationFixture call`);
    assert.ok(!/s5-central-classification\.json/.test(code), `${hook}: no inline fixture path literal`);
    assert.ok(!/function\s+resolveFixtureLocation\b/.test(code), `${hook}: no inline resolveFixtureLocation body`);
  }
  assert.equal(resolve(moduleRelativeFixtureLocation().fixturePath), resolve(resolveFixtureLocation(REPO_ROOT, existsSync).fixturePath));
});

test("G14b: the location function is separate and non-throwing: it returns even when the fixture at that location is malformed, while assembleCatalog throws; and a SessionStart run against a malformed fixture records fixturePath and fixtureSource in halt-state", () => {
  const dir = tempDir("malformed");
  try {
    mkdirSync(join(dir, "docs", "qa"), { recursive: true });
    writeFileSync(join(dir, REL_FIXTURE), "{ this is not json", "utf8");
    const location = resolveFixtureLocation(dir, existsSync);
    assert.deepEqual(location, { fixtureSource: "project-relative", fixturePath: join(dir, REL_FIXTURE) });
    assert.throws(() => assembleCatalog(location), "loading the malformed fixture throws (fail-closed), but the location was already in hand");

    const sessionId = "g14b-catalog-test";
    const spawned = spawnSync(process.execPath, [join(REPO_ROOT, "hooks", "sessionstart-tool-enum.mjs")], {
      input: JSON.stringify({ session_id: sessionId, hook_event_name: "SessionStart" }),
      encoding: "utf8",
      cwd: dir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, HOME: dir, USERPROFILE: dir },
      timeout: 30_000,
      windowsHide: true,
    });
    assert.equal(spawned.status, 0, `SessionStart never exits 2 by design; stderr=${spawned.stderr}`);
    const state = JSON.parse(readFileSync(join(dir, ".thoth", "halt-state", `${sessionId}.json`), "utf8")) as {
      reasons: Record<string, { set: boolean }>;
      fixtureSource?: string;
      fixturePath?: string;
    };
    assert.equal(state.reasons["SUR-03-enumeration-failed"]?.set, true, "the malformed fixture halts via the enumeration-failed reason");
    assert.equal(state.fixtureSource, "project-relative", "the catch path still records the resolved fixture source");
    assert.equal(state.fixturePath, join(dir, REL_FIXTURE), "the catch path still records the resolved fixture path");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("assembleCatalog: merges the built-in layer with the fixture's central layer; central entries carry sourceLayer central", () => {
  const { merged, fixture, builtinLayer } = assembleCatalog(moduleRelativeFixtureLocation());
  assert.ok(builtinLayer.tools.length > 0);
  const centralNames = new Set(fixture.centralLayer.tools.map((t) => t.name));
  for (const entry of merged.tools) {
    if (centralNames.has(entry.name)) assert.equal(entry.sourceLayer, "central", entry.name);
  }
  assert.ok(fixture.centralLayer.tools.length > 0);
});
