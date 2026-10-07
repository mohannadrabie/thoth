// #308 story K stage 0: the kill-switch and verification runbook states only measured facts. The two settings-based escape hatches
// (disableAllHooks, --setting-sources user,local) are unmeasured until live probe P-K5 and may appear ONLY under the heading
// "Unmeasured until P-K5". File names it cites are checked by the QA-14 reference resolver (diff mode) and QA-15, not here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const PATH = fileURLToPath(new URL("../../docs/runbooks/k-kill-switch-and-verification.md", import.meta.url));
const text = readFileSync(PATH, "utf8");
const lines = text.split(/\r?\n/);

/** The heading ("## ...") each line sits under. */
function sectionOf(index: number): string {
  for (let i = index; i >= 0; i--) {
    const m = /^#{1,6}\s+(.*)$/.exec(lines[i]!);
    if (m) return m[1]!.trim();
  }
  return "";
}

test("runbook: no unmeasured claim asserted", () => {
  const UNMEASURED = "Unmeasured until P-K5";
  assert.ok(lines.some((l) => /^#{1,6}\s+/.test(l) && l.includes(UNMEASURED)), `a heading "${UNMEASURED}" exists`);
  let seen = 0;
  lines.forEach((l, i) => {
    if (/disableAllHooks|--setting-sources\s+user,local/.test(l)) {
      seen++;
      assert.ok(sectionOf(i).includes(UNMEASURED), `line ${String(i + 1)} names an unmeasured escape hatch outside the unmeasured section: ${l.trim()}`);
    }
  });
  assert.ok(seen >= 2, "both unmeasured items are named (so the section is not vacuous)");
});

test("runbook: per-worktree emission step names --form and a human-run write to that worktree's settings.local.json", () => {
  assert.match(text, /--print-worktree-targets --form=relative/);
  assert.match(text, /--form=absolute/);
  assert.match(text, /settings\.local\.json/);
  assert.match(text, /human/i);
});

test("runbook: states start a NEW session after any settings change", () => {
  assert.ok(text.includes("start a NEW session after any settings change"));
});

test("runbook: kill switch follows plan section 3 (checkout, revert never force-push, or delete the entry; new session; ls probe)", () => {
  assert.match(text, /git -C <checkout> checkout -- \.claude\/settings\.json/);
  assert.match(text, /git revert/);
  assert.match(text, /never force-push/i);
  assert.match(text, /hooks\.PreToolUse/);
  assert.match(text, /`ls`/);
});

test("runbook: discloses the joint-lag residual of the k-blocker row", () => {
  assert.match(text, /list lag/i);
  assert.match(text, /re-run/i);
});

test("runbook: states the repo-root working-directory precondition", () => {
  assert.ok(text.includes("repo root as the working directory"));
  assert.ok(text.includes("no parent-directory fallback"));
});

test("k-runbook: names the exact K1 Human-ratified cell form", () => {
  assert.ok(text.includes("K1 approved"), "the decision text a K1 row starts with");
  assert.ok(text.includes("Human ratified"), "names the cell");
  assert.ok(text.includes('Y (human, 2026-10-06: "approved")'), "the exact accepted cell example");
  assert.ok(text.includes("docs/decisions-archive.md"), "says the archive is read too");
  assert.ok(text.includes("Y (pre-approved") && text.includes("Y (delegated") && text.includes("#465"), "says pre-approved and delegated cells are rejected");
});

test("k-runbook: K wiring steps include fixture regeneration and retiring the real-run file", () => {
  assert.ok(text.includes("--out=docs/qa/k-proposed-merged-settings.fixture.txt"), "regenerate the fixture with --out");
  assert.ok(text.includes("src/qa/k-readiness.real-run.ts"), "retire the real-run file");
  assert.ok(text.includes("qa:k-readiness-real-test"));
  assert.ok(text.includes("never by hand"));
});

test("k-runbook: mods residual names the governed-session binary 2.1.289, past the 2.1.287 default, and open blocker #464", () => {
  const l = lines.find((x) => x.toLowerCase().includes("mods") && x.includes("2.1.287"));
  assert.ok(l !== undefined, "a mods line naming 2.1.287 exists");
  assert.ok(l.includes("2.1.289"), "names the version governed sessions run");
  assert.ok(/VS Code extension/i.test(l), "names the extension native binary");
  assert.ok(l.includes("#464"), "references the open K blocker #464");
  assert.ok(!/against local 2.1.267|predates that/.test(l), "the old local-2.1.267 claim is gone");
});

test("k-runbook: CLI drift line sends a failing version to re-vendor and re-judge (#463), human-reviewed, pin never bumped by hand", () => {
  const l = lines.find((x) => x.includes("qa:cc-extraction-covers-judged") && x.includes("#463"));
  assert.ok(l !== undefined, "a drift line cites the check and #463");
  assert.ok(/re-vendor/i.test(l) && /re-judge/i.test(l));
  assert.ok(/human/i.test(l) && /(never|not|do not)[^.]*bump/i.test(l));
});

test("k-runbook: readiness checks every Claude Code binary in the enumerated install locations and its final line names each one", () => {
  const l = lines.find((x) => /every Claude Code binary in the enumerated install locations/i.test(x));
  assert.ok(l !== undefined, "states every enumerated-location binary is checked");
  assert.ok(/final line/i.test(l) && /names? each/i.test(l));
});

test("k-runbook: Desktop roots are stated as protected (#466), non-protected binaries are hashed and flagged, and the opt-in is named", () => {
  const l = lines.find((x) => /Claude Desktop/i.test(x) && /UNVERIFIED-UNPROTECTED/.test(x));
  assert.ok(l !== undefined, "a residual line about the Desktop roots and the flag exists");
  assert.ok(l.includes("#466") && /now protected/i.test(l) && /sha256/.test(l) && l.includes("THOTH_EXEC_UNPROTECTED=1") && l.includes("claude-code"));
  assert.ok(!/not yet protected/i.test(text), "the old not-yet-protected residual is gone");
  assert.ok(!/machine-specific|suffix/i.test(text), "the false MSIX-suffix premise is gone");
});

test("k-runbook: readiness line lists every location the code checks, and says re-judging alone does not turn the row green (#467)", () => {
  const l = lines.find((x) => /^Readiness checks every Claude Code binary/.test(x));
  assert.ok(l !== undefined);
  for (const p of ["~/.local/bin", "~/.local/share/claude/versions", "anthropic.claude-code-*", "VS Code Insiders", "Cursor", "Roaming", "MSIX", "absolute PATH"]) assert.ok(l.includes(p), p);
  const m = lines.find((x) => /one judged version/i.test(x));
  assert.ok(m !== undefined && /prunes/i.test(m) && m.includes("#467") && /does not turn the row green/i.test(m));
});
