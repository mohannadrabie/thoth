// #308 story K stage 0 (refs #442): `--print-worktree-targets --form=relative|absolute`. Both forms are tested over a
// synthetic linked worktree. Which form Claude Code honors is the stage-1 live probe P-K4's question, so both exist.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { absoluteEditBody, editDenyEntries, parentDirs, protectedPaths, runWorktreeTargets, worktreeEditLines } from "./protected-path-list.ts";

const posix = (p: string): string => p.split("\\").join("/");

function synthetic(): { tmp: string; main: string; wt: string; cleanup: () => void } {
  const tmp = mkdtempSync(join(tmpdir(), "k0-wt-"));
  const main = join(tmp, "main");
  const wt = join(tmp, "wt");
  const common = join(main, ".git");
  mkdirSync(join(common, "worktrees", "wt"), { recursive: true });
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, ".git"), `gitdir: ${posix(join(common, "worktrees", "wt"))}\n`);
  writeFileSync(join(common, "worktrees", "wt", "commondir"), "../..\n");
  writeFileSync(join(common, "worktrees", "wt", "config.worktree"), "[core]\n");
  return { tmp, main, wt, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

function run(argv: string[], root: string): { code: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const code = runWorktreeTargets(argv, root, (l) => out.push(l), (l) => err.push(l));
  return { code, out, err };
}

test("worktree-targets: relative form", () => {
  const fx = synthetic();
  try {
    const lines = worktreeEditLines(fx.wt, "relative");
    assert.deepEqual(lines, ["Edit(/.git)", "Edit(/../main/.git)", "Edit(/../main/.git/**)"].sort());
  } finally {
    fx.cleanup();
  }
});

// The expected values below are LITERALS from the vendor permissions doc ("On Windows, paths are normalized to POSIX form before
// matching. C:\Users\alice becomes /c/Users/alice, so use //c/**/.env"), not produced by the transform under test (refs #460).
test("worktree-targets: absolute form uses the documented Windows POSIX drive form (//c/...)", () => {
  assert.equal(`Edit(//${absoluteEditBody("C:\\Users\\alice\\repo\\.git", "win32")})`, "Edit(//c/Users/alice/repo/.git)");
  assert.equal(`Edit(//${absoluteEditBody("D:/work/Thoth/.git", "win32")}/**)`, "Edit(//d/work/Thoth/.git/**)");
  assert.equal(`Edit(//${absoluteEditBody("/home/alice/repo/.git", "linux")})`, "Edit(//home/alice/repo/.git)");
  assert.equal(`Edit(//${absoluteEditBody("/Users/alice/repo/.git", "darwin")})`, "Edit(//Users/alice/repo/.git)");
  if (process.platform === "win32") {
    const fx = synthetic();
    try {
      for (const l of worktreeEditLines(fx.wt, "absolute")) {
        const body = l.slice("Edit(//".length, -1);
        assert.ok(l.startsWith("Edit(//") && l.endsWith(")"), l);
        assert.ok(!body.includes(":"), `no drive colon: ${l}`);
        assert.equal(body[0], body[0]!.toLowerCase(), `lower-case drive letter: ${l}`);
        assert.equal(body[1], "/", l);
      }
    } finally {
      fx.cleanup();
    }
  }
});

test("worktree-targets: absolute form", () => {
  const fx = synthetic();
  try {
    const lines = worktreeEditLines(fx.wt, "absolute");
    assert.equal(lines.length, 3, "the common dir (children and itself) and the worktree pointer file");
    assert.equal(lines.filter((l) => l.endsWith("/main/.git/**)")).length, 1);
    assert.equal(lines.filter((l) => l.endsWith("/main/.git)")).length, 1);
    assert.equal(lines.filter((l) => l.endsWith("/wt/.git)")).length, 1);
    assert.ok(lines.every((l) => l.startsWith("Edit(//")));
  } finally {
    fx.cleanup();
  }
});

test("worktree-targets: both forms over synthetic linked worktree (CLI path, directory-entry forms included)", () => {
  const fx = synthetic();
  try {
    for (const form of ["relative", "absolute"] as const) {
      const r = run(["--print-worktree-targets", `--form=${form}`], fx.wt);
      assert.equal(r.code, 0);
      assert.deepEqual(r.out, worktreeEditLines(fx.wt, form));
      assert.ok(r.out.some((l) => l.endsWith("/**)")), "the common dir is a directory entry (children)");
      assert.ok(r.out.some((l) => l.endsWith("main/.git)")), "the directory path itself is also denied");
      assert.ok(r.out.every((l) => /^Edit\(.*\)$/.test(l)), "one ready-to-paste Edit(...) line each");
    }
  } finally {
    fx.cleanup();
  }
});

test("worktree-targets: missing or bad --form exits nonzero with nothing on stdout", () => {
  const fx = synthetic();
  try {
    for (const argv of [["--print-worktree-targets"], ["--print-worktree-targets", "--form="], ["--print-worktree-targets", "--form=weird"], ["--print-worktree-targets", "--form=Relative"]]) {
      const r = run(argv, fx.wt);
      assert.notEqual(r.code, 0, argv.join(" "));
      assert.deepEqual(r.out, [], argv.join(" "));
      assert.ok(r.err.length > 0);
    }
  } finally {
    fx.cleanup();
  }
});

test("worktree-targets: main checkout empty (exit 0, says so on stderr)", () => {
  const fx = synthetic();
  try {
    for (const form of ["relative", "absolute"]) {
      const r = run(["--print-worktree-targets", `--form=${form}`], fx.main);
      assert.equal(r.code, 0);
      assert.deepEqual(r.out, []);
      assert.match(r.err.join("\n"), /main checkout/);
    }
  } finally {
    fx.cleanup();
  }
});

// App-security round 1 finding 1 (refs #456): the files that generate and certify the gate text, and the proposal they compare
// against, are protected paths, so a wired session cannot edit what future verification certifies.
test("protected-path-list: K certifiers are protected paths", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const all = protectedPaths(root).all;
  for (const want of ["src/qa/k-settings-merge.ts", "src/qa/k3-edit-deny-covers-fixture.ts", "src/qa/k5-pretooluse-entry-uses-launcher.ts", "src/qa/k-readiness.ts", "src/qa/cc-extraction-covers-judged.ts", "docs/plans/s308-K-proposed-entry-2026-10-05.json".toLowerCase()]) {
    assert.ok(all.includes(want), `${want} is on the protected list`);
  }
});

// App-security round 2 finding 1 (refs #456): discovery EXECUTES binaries from these install directories (`--version`), so a session
// able to write there could plant one the certifier would run. The two Claude Desktop roots are protected too (#466, PPL-desktop-roots-named below).
test("protected-path-list: Claude Code install dirs are protected", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const all = protectedPaths(root).all;
  for (const want of ["~/.local/bin/", "~/.local/share/claude/", "~/.vscode/extensions/", "~/.vscode-insiders/extensions/", "~/.cursor/extensions/"]) {
    assert.ok(all.includes(want), `${want} is on the protected list`);
  }
});

// #466 (S7): the two Claude Desktop bundle roots and ~/.claude/dev-mods/. The MSIX publisher ID is machine-independent, so the root is
// a plain ~/ directory entry with no per-machine segment. Written FAILING FIRST.
const DESKTOP_ROOTS = ["~/appdata/roaming/claude/claude-code/", "~/appdata/local/packages/claude_pzs8sxrjxfjjc/localcache/roaming/claude/claude-code/"];
const NEW_ENTRIES = [...DESKTOP_ROOTS, "~/.claude/dev-mods/"];
const REPO = fileURLToPath(new URL("../../", import.meta.url));

test("PPL-desktop-roots-named: both Claude Desktop bundle roots are named protected paths in canonical form", () => {
  const { named } = protectedPaths(REPO);
  for (const want of DESKTOP_ROOTS) assert.ok(named.includes(want), `${want} is a named protected path`);
});

test("PPL-desktop-roots-rules-and-edit-entries: each root has a shipped deny rule, K Edit entries and parent-dir rules", () => {
  const rules = (JSON.parse(readFileSync(`${REPO}src/policy/config/shipped-defaults.json`, "utf8")) as { rules: Array<{ targets: string[]; verbs: string[] }> }).rules;
  const proposal = readFileSync(`${REPO}docs/plans/s308-K-proposed-settings-2026-10-04.json`, "utf8");
  for (const root of DESKTOP_ROOTS) {
    const hit = rules.find((r) => r.targets.includes(root.slice(0, -1)) && r.targets.includes(root));
    assert.ok(hit, `${root}: a deny rule covers the directory and its children`);
    assert.deepEqual([...hit.verbs].sort(), ["create", "delete", "modify", "move", "rename", "write"]);
    for (const e of editDenyEntries(root)) assert.ok(proposal.includes(JSON.stringify(e).slice(1, -1)), `K Edit entry present: ${e}`);
    for (const d of parentDirs([root])) assert.ok(rules.some((r) => r.targets.includes(d) && r.verbs.includes("move")), `parent rule present: ${d}`);
  }
});

test("PPL-dev-mods-named-and-denied: ~/.claude/dev-mods/ is a named protected path with a deny rule, K Edit entries and no extra over-reach", () => {
  const dev = "~/.claude/dev-mods/";
  assert.ok(protectedPaths(REPO).named.includes(dev));
  const rules = (JSON.parse(readFileSync(`${REPO}src/policy/config/shipped-defaults.json`, "utf8")) as { rules: Array<{ targets: string[] }> }).rules;
  assert.ok(rules.some((r) => r.targets.includes("~/.claude/dev-mods") && r.targets.includes(dev)));
  const proposal = readFileSync(`${REPO}docs/plans/s308-K-proposed-settings-2026-10-04.json`, "utf8");
  for (const e of editDenyEntries(dev)) assert.ok(proposal.includes(JSON.stringify(e).slice(1, -1)), e);
});

test("PPL-new-entries-listed-once: the three new entries are on the list exactly once", () => {
  const all = protectedPaths(REPO).all;
  for (const p of NEW_ENTRIES) assert.equal(all.filter((x) => x === p).length, 1, p);
  assert.ok(all.includes("src/qa/unprotected-location.ts"), "the exec-gate classifier is itself protected");
});
