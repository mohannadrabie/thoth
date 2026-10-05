// #308 story K stage 0 (refs #442): `--print-worktree-targets --form=relative|absolute`. Both forms are tested over a
// synthetic linked worktree. Which form Claude Code honors is the stage-1 live probe P-K4's question, so both exist.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runWorktreeTargets, worktreeEditLines } from "./protected-path-list.ts";

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

test("worktree-targets: absolute form", () => {
  const fx = synthetic();
  try {
    const lines = worktreeEditLines(fx.wt, "absolute");
    const body = (p: string): string => {
      const q = posix(p);
      return q.startsWith("/") ? q.slice(1) : q;
    };
    const want = [`Edit(//${body(join(fx.wt, ".git"))})`, `Edit(//${body(join(fx.main, ".git"))})`, `Edit(//${body(join(fx.main, ".git"))}/**)`];
    assert.deepEqual(lines, want.sort());
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
