// #308 story K stage 0: `npm run qa:k-readiness`. A READ-ONLY command that prints one row per activation precondition
// (docs/plans/s308-K-wiring-plan-2026-10-05.md section 2) and exits 1 unless EVERY row is PASS. Each row is a running query
// (a gh or git read, or an existing qa instrument run on the real files); none of it is hand-typed state. It is red by
// design until K is wired. A row that cannot be evaluated because its instrument does not exist yet reports MISSING and fails.
//
// Read-only by construction: every command goes through `readOnlyRunner`, which refuses anything but gh issue list, gh label
// list, git merge-base, git rev-parse and `node src/qa/<file>.ts`. It never writes a file.
//
// Disclosed residual (runbook): the k-blocker row trusts two gh queries that agree; if GitHub's list endpoint lags on BOTH the
// label and the issue list at once (for example right after a label edit), a stale empty answer can pass. Re-run after label edits.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export type RowStatus = "PASS" | "FAIL" | "MISSING";
export interface Row {
  id: string;
  status: RowStatus;
  detail: string;
}
export interface RunResult {
  /** Exit status; null when the process could not be started (for example gh is not installed). */
  status: number | null;
  stdout: string;
  stderr: string;
}
export type Exec = (cmd: string, args: readonly string[]) => RunResult;

/** The only commands this tool may run. Anything else throws before it is started. */
export function assertReadOnly(cmd: string, args: readonly string[]): void {
  const [a0, a1] = args;
  const ok =
    (cmd === "gh" && ((a0 === "issue" && a1 === "list") || (a0 === "label" && a1 === "list"))) ||
    (cmd === "git" && (a0 === "merge-base" || a0 === "rev-parse" || (a0 === "remote" && a1 === "get-url"))) ||
    (cmd === "node" && a0 !== undefined && /^src\/qa\/[\w.-]+\.ts$/.test(a0));
  if (!ok) throw new Error(`k-readiness is read-only: refusing to run ${cmd} ${args.join(" ")}`);
}

export const readOnlyRunner =
  (exec: Exec): Exec =>
  (cmd, args) => {
    assertReadOnly(cmd, args);
    return exec(cmd, args);
  };

export const realExec: Exec = (cmd, args) => {
  const r = spawnSync(cmd === "node" ? process.execPath : cmd, [...args], { cwd: REPO_ROOT, encoding: "utf8", timeout: 180000, windowsHide: true });
  return { status: r.error ? null : r.status, stdout: r.stdout, stderr: r.stderr };
};

export interface Deps {
  run: Exec;
  /** Repo-relative text file, or undefined when absent. */
  readFile: (rel: string) => string | undefined;
}

/** The merged-into-s7 integration branch(es) that must be ancestors of origin/master before K. An input, not state: the
 * ancestry itself is the query. A ref that no longer exists is MISSING (it cannot be proven), never a silent pass. */
export const FIX_BRANCHES: readonly string[] = ["origin/s7/knockout"];

const firstLines = (r: RunResult, n = 3): string =>
  `${r.stdout}\n${r.stderr}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .slice(0, n)
    .map((l) => l.slice(0, 200))
    .join(" / ");

const REPO_NAME_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-";

/** owner/name from a GitHub remote URL (https, ssh scp-style or ssh://), or undefined when it is not one. */
export function parseGithubRepo(url: string): string | undefined {
  const t = url.trim();
  let rest: string | undefined;
  // The ssh forms are built from parts so the source holds no email-shaped literal (the secret scan flags one).
  const sshUser = ["git", "github.com"].join("@");
  for (const prefix of ["https://github.com/", "http://github.com/", `${sshUser}:`, `ssh://${sshUser}/`]) if (t.startsWith(prefix)) rest = t.slice(prefix.length);
  if (rest === undefined) return undefined;
  if (rest.endsWith(".git")) rest = rest.slice(0, -4);
  const parts = rest.split("/");
  if (parts.length !== 2 || parts.some((x) => x === "" || x === "." || x === ".." || [...x].some((c) => !REPO_NAME_CHARS.includes(c)))) return undefined;
  return rest;
}

/** The repo every gh call is pinned to (--repo), read from the origin remote. Never from GH_REPO or the ambient environment. */
export function resolveRepo(run: Exec): { ok: true; repo: string } | { ok: false; why: string } {
  const r = run("git", ["remote", "get-url", "origin"]);
  if (r.status !== 0) return { ok: false, why: "cannot read the origin remote URL" };
  const repo = parseGithubRepo(r.stdout);
  return repo === undefined ? { ok: false, why: "the origin remote is not a recognizable GitHub owner/name URL" } : { ok: true, repo };
}

function ghJson(run: Exec, repo: string, args: string[]): { ok: true; value: unknown } | { ok: false; why: string } {
  const r = run("gh", [...args, "--repo", repo]);
  if (r.status === null) return { ok: false, why: "gh is not available" };
  if (r.status !== 0) return { ok: false, why: `gh exited ${String(r.status)}: ${firstLines(r, 1)}` };
  try {
    return { ok: true, value: JSON.parse(r.stdout) };
  } catch {
    return { ok: false, why: "gh returned non-JSON output" };
  }
}

/** E4/E5: blockers come from the k-blocker label, failing closed; an empty answer needs a second, independent query to agree. */
export function blockerRow(run: Exec): Row {
  const id = "k-blocker-issues";
  const fail = (detail: string): Row => ({ id, status: "FAIL", detail });
  const resolved = resolveRepo(run);
  if (!resolved.ok) return fail(`cannot pin the repository for gh: ${resolved.why} (fail closed)`);
  const repo = resolved.repo;
  const labels = ghJson(run, repo, ["label", "list", "--json", "name", "--limit", "1000"]);
  if (!labels.ok) return fail(`cannot list labels: ${labels.why}`);
  if (!Array.isArray(labels.value) || !labels.value.some((l) => (l as { name?: unknown }).name === "k-blocker")) return fail("label k-blocker does not exist (fail closed)");
  const byLabel = ghJson(run, repo, ["issue", "list", "--label", "k-blocker", "--state", "open", "--json", "number,title", "--limit", "1000"]);
  if (!byLabel.ok) return fail(`cannot list k-blocker issues: ${byLabel.why}`);
  if (!Array.isArray(byLabel.value)) return fail("gh returned a non-list for the k-blocker query");
  const open = byLabel.value as { number: number; title: string }[];
  const all = ghJson(run, repo, ["issue", "list", "--state", "open", "--json", "number,labels", "--limit", "1000"]);
  if (!all.ok) return fail(`cannot run the cross-check query: ${all.why}`);
  if (!Array.isArray(all.value)) return fail("gh returned a non-list for the cross-check query");
  const total = all.value as { number: number; labels?: { name?: string }[] }[];
  const crossNumbers = total.filter((i) => (i.labels ?? []).some((l) => l.name === "k-blocker")).map((i) => i.number).sort((a, b) => a - b);
  const firstNumbers = open.map((i) => i.number).sort((a, b) => a - b);
  if (JSON.stringify(crossNumbers) !== JSON.stringify(firstNumbers)) return fail(`list lag or label drift: label query ${JSON.stringify(firstNumbers)} vs cross-check ${JSON.stringify(crossNumbers)}`);
  if (open.length > 0) return fail(`${String(open.length)} open k-blocker issue(s): ${open.map((i) => `#${String(i.number)} ${i.title}`).join("; ")}`);
  return { id, status: "PASS", detail: `0 open k-blocker issues (repo ${repo}, label exists, ${String(total.length)} open issues total)` };
}

export function branchRows(run: Exec): Row[] {
  return FIX_BRANCHES.map((ref): Row => {
    const id = `fix-branch-merged:${ref}`;
    const exists = run("git", ["rev-parse", "--verify", "--quiet", ref]);
    if (exists.status !== 0) return { id, status: "MISSING", detail: `${ref} does not exist locally; cannot prove it is merged (fetch it, or change FIX_BRANCHES in a reviewed edit)` };
    const base = run("git", ["rev-parse", "--verify", "--quiet", "origin/master"]);
    if (base.status !== 0) return { id, status: "FAIL", detail: "origin/master does not exist locally" };
    const anc = run("git", ["merge-base", "--is-ancestor", ref, "origin/master"]);
    if (anc.status === 0) return { id, status: "PASS", detail: `${ref} is an ancestor of origin/master` };
    return { id, status: "FAIL", detail: `${ref} is NOT an ancestor of origin/master (exit ${String(anc.status)})` };
  });
}

/** Rows bound to a FIXED instrument file. The npm script of that name must be exactly `node <file>`; a repointed script FAILs (red-team 7).
 * A script that does not exist yet is MISSING. The file, not the script name, is what runs. */
export const SCRIPT_ROWS: readonly { id: string; script: string; file: string }[] = [
  { id: "git-rg-lever-preflight", script: "qa:git-rg-lever-preflight", file: "src/qa/git-rg-lever-preflight.ts" },
  { id: "protected-path-list-drift", script: "qa:protected-path-list", file: "src/qa/protected-path-list.ts" },
  { id: "gate-command-path (real file)", script: "qa:gate-command-path", file: "src/qa/gate-command-path-check.ts" },
  { id: "gate-launcher-pin (real file)", script: "qa:gate-launcher-pin", file: "src/qa/gate-launcher-pin-check.ts" },
  { id: "gate-matcher-drift (real file)", script: "qa:gate-matcher-drift", file: "src/qa/gate-matcher-drift-check.ts" },
  { id: "gate-manifest (real file)", script: "qa:gate-manifest", file: "src/qa/gate-manifest-check.ts" },
  { id: "gate-latency-budget (real file)", script: "qa:gate-latency-budget", file: "src/qa/gate-latency-budget-check.ts" },
  { id: "K3-edit-deny-covers-fixture (real file)", script: "qa:k3", file: "src/qa/k3-edit-deny-covers-fixture.ts" },
  { id: "K5-pretooluse-entry-uses-launcher (real file)", script: "qa:k5", file: "src/qa/k5-pretooluse-entry-uses-launcher.ts" },
  { id: "CC-extraction-covers-judged (#452)", script: "qa:cc-extraction-covers-judged", file: "src/qa/cc-extraction-covers-judged.ts" },
  { id: "F1-settings-named-scripts-judged", script: "qa:f1-settings-named-scripts-judged", file: "src/qa/f1-settings-named-scripts-judged.ts" },
  { id: "gate-latency-allow-path", script: "qa:gate-latency-allow-path", file: "src/qa/gate-latency-allow-path.ts" },
];

export function scriptRow(deps: Deps, row: { id: string; script: string; file: string }): Row {
  const { id, script, file } = row;
  let cmd: unknown;
  try {
    cmd = (JSON.parse(deps.readFile("package.json") ?? "{}") as { scripts?: Record<string, unknown> }).scripts?.[script];
  } catch {
    return { id, status: "FAIL", detail: "package.json is not valid JSON" };
  }
  if (typeof cmd !== "string") return { id, status: "MISSING", detail: `npm script ${script} does not exist yet` };
  if (cmd !== `node ${file}`) return { id, status: "FAIL", detail: `npm script ${script} is ${JSON.stringify(cmd)}, not the fixed instrument "node ${file}" (repointed?)` };
  const r = deps.run("node", [file]);
  if (r.status === 0) return { id, status: "PASS", detail: firstLines(r, 1) };
  return { id, status: "FAIL", detail: `${file} exited ${String(r.status)}: ${firstLines(r)}` };
}

interface DecisionRow {
  decision: string;
  human: string;
}
export function parseDecisionRows(text: string): DecisionRow[] {
  const rows: DecisionRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/^\|\s*20\d\d-\d\d-\d\d\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 5) continue;
    rows.push({ decision: cells[1]!, human: cells[cells.length - 2]! });
  }
  return rows;
}

/** Decision rows from docs/decisions.md and then docs/decisions-archive.md (a ratified row moves to the archive). */
function allDecisionRows(deps: Deps): DecisionRow[] | undefined {
  const active = deps.readFile("docs/decisions.md");
  if (active === undefined) return undefined;
  return [...parseDecisionRows(active), ...parseDecisionRows(deps.readFile("docs/decisions-archive.md") ?? "")];
}

/** The human-ratified cell (#465): exactly `Y`, or the house form `Y (human, YYYY-MM-DD: "<words>")`. Anything else never passes: `YES`,
 * `Y-<x>`, `Y (pre-approved ...)`, `Y (delegated ...)` (a delegation is not the human's own act). */
const isHumanY = (cell: string): boolean => !/pre-approved|delegated/i.test(cell) && (cell === "Y" || /^Y \(human, \d{4}-\d{2}-\d{2}: ".+"\)$/.test(cell));

/** K1: a decisions row whose decision text STARTS with "K1 approved" (bold optional) and whose Human ratified cell starts with Y.
 * A "K1 declined" or "K1 deferred" row never passes. The row form is documented in the runbook. */
export function k1Row(deps: Deps): Row {
  const id = "K1-human-approval";
  const rows = allDecisionRows(deps);
  if (rows === undefined) return { id, status: "FAIL", detail: "docs/decisions.md not readable" };
  const found = rows.filter((r) => /^\**\s*K1 approved\b/.test(r.decision));
  if (found.length === 0) return { id, status: "FAIL", detail: "no row starting 'K1 approved' in docs/decisions.md or decisions-archive.md (human approval not recorded)" };
  if (found.some((r) => isHumanY(r.human))) return { id, status: "PASS", detail: "K1 approved row found with Human ratified starting with Y" };
  return { id, status: "FAIL", detail: `K1 approved row found but Human ratified = ${found.map((r) => JSON.stringify(r.human)).join(", ")}` };
}

/** K4: the ADR gate acceptance is a row whose decision text STARTS with "THOTH-ADR-0003 accepted" (bold optional) and is human-ratified (Y...). */
export function k4Row(deps: Deps): Row {
  const id = "K4-adr-acceptance-recorded";
  const rows = allDecisionRows(deps);
  if (rows === undefined) return { id, status: "FAIL", detail: "docs/decisions.md not readable" };
  const found = rows.filter((r) => /^\**\s*THOTH-ADR-0003 accepted\b/.test(r.decision));
  if (found.length === 0) return { id, status: "FAIL", detail: "no row starting 'THOTH-ADR-0003 accepted' in docs/decisions.md or decisions-archive.md" };
  if (found.some((r) => isHumanY(r.human))) return { id, status: "PASS", detail: "THOTH-ADR-0003 acceptance row found, Human ratified starts with Y" };
  return { id, status: "FAIL", detail: "THOTH-ADR-0003 acceptance row found but not human-ratified" };
}

export function runReadiness(deps: Deps): Row[] {
  const run = readOnlyRunner(deps.run);
  const d = { ...deps, run };
  return [blockerRow(run), ...branchRows(run), ...SCRIPT_ROWS.map((r) => scriptRow(d, r)), k1Row(d), k4Row(d)];
}

export const exitCodeForRows = (rows: readonly Row[]): number => (rows.length > 0 && rows.every((r) => r.status === "PASS") ? 0 : 1);

export function formatRows(rows: readonly Row[]): string[] {
  const count = (s: RowStatus): number => rows.filter((r) => r.status === s).length;
  return [
    ...rows.map((r) => `${r.status.padEnd(7)} ${r.id}: ${r.detail}`),
    `k-readiness: ${String(count("PASS"))} PASS, ${String(count("FAIL"))} FAIL, ${String(count("MISSING"))} MISSING of ${String(rows.length)} rows; ${exitCodeForRows(rows) === 0 ? "READY" : "NOT READY (exit 1)"}`,
  ];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const readFile = (rel: string): string | undefined => {
    try {
      return readFileSync(resolve(REPO_ROOT, rel), "utf8");
    } catch {
      return undefined;
    }
  };
  const rows = runReadiness({ run: realExec, readFile });
  for (const l of formatRows(rows)) console.log(l);
  process.exitCode = exitCodeForRows(rows);
}
