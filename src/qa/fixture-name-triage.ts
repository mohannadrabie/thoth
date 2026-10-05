// #308 story E6 (THOTH-ADR-0003 rule 4 conformance triage; docs/reviews/s308-A-adr-architecture-round2-2026-10-02.md,
// LOW 2): the hardcoded-fixture-name triage as an instrument, not a hand-stated "6 files".
//
// Reads every entry name from docs/qa/s5-central-classification.json AT RUN TIME (centralLayer.tools[].name and
// knownConnectors[]), scans every quoted literal under hooks/ and src/ (tests included), and lists each file
// that holds a literal that IS a name (whole literal, trimmed, case-insensitive) or that spells a name in an
// MCP form (`mcp__<name>__` or `mcp/<name>/`). A bare substring match was measured first: 104 hits in 22 files,
// almost all prose ("GitHub Issue"), so it is not used. Disclosed limit: a name embedded in a longer literal
// in any other form is not found. Each file must carry a verdict in
// TRIAGE below (keyed by file path, never by a fixture name, so this file hardcodes no entry). A hit file with
// no verdict fails the run (exit 1), and so does a verdict whose file no longer hits (a stale verdict).
//
// Scope: string literals only ('...', "...", `...`), found line by line; a literal spanning lines is not seen.
// Comments are not scanned for names unless a quote inside them forms a literal (disclosed: a comment that
// quotes a name is reported as a hit, which errs toward triage, not toward silence).
// A verdict is a human judgement recorded here ("violation" fails the run too); this script finds the
// candidates, a reviewer owns the judgement. Not violations per ADR-0003: an unrelated use of the same string,
// a synthetic name in a test's own temporary fixture, the SUR-04 settings fixture.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { moduleRelativeFixtureLocation } from "../policy/tools/classification-catalog.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
// The fixture location comes from the single-source funnel, not a path typed here (R1-6b, Issue #332: the
// funnel is the only production reader of the fixture path).
const FIXTURE_PATH = moduleRelativeFixtureLocation().fixturePath;
const SCAN_ROOTS = ["hooks", "src"] as const;
const SCAN_EXT = /\.(ts|mjs|js|cjs|mts)$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

export type Verdict = "not-violation" | "violation";
export interface Triage {
  verdict: Verdict;
  reason: string;
  /** Fingerprints (fingerprintOf) of the hits this verdict covers. Any other hit in the file is untriaged. */
  fingerprints: string[];
}

/** Verdicts keyed by repo-relative path (forward slashes). Seeded from the ADR-0003 conformance table. */
export const TRIAGE: Readonly<Record<string, Triage>> = {
  "src/policy/fixtures/allowlist-settings.ts": { verdict: "not-violation", reason: "the SUR-04 settings fixture (named carve-out in THOTH-ADR-0003 rule 4)", fingerprints: ["56ee26ef6c16"] },
  "src/policy/tools/mcp-enumeration.test.ts": { verdict: "not-violation", reason: "synthetic .mcp.json fed to name extraction; asserts extraction, not classification", fingerprints: ["2e666783e6cd", "03c087365967"] },
  "src/policy/verification/allowlist.test.ts": { verdict: "not-violation", reason: "the SUR-04 managed-MCP allowlist, a different allowlist", fingerprints: ["b1265f59c561"] },
  "src/qa/vendor-tool-inventory.test.ts": { verdict: "not-violation", reason: "synthetic init event fed to the scrubber; never asserted against the fixture", fingerprints: ["6cdf50b18954"] },
  "src/secret-scan/history-scan.test.ts": { verdict: "not-violation", reason: "unrelated string: the github_pat_ token prefix", fingerprints: ["4b0cb7f95fe9"] },
  "src/secret-scan/patterns.test.ts": { verdict: "not-violation", reason: "unrelated string: the github_pat_ token prefix", fingerprints: ["d54e21ff5a59"] },
};

export function fixtureNames(fixtureText: string): string[] {
  const f = JSON.parse(fixtureText) as { centralLayer?: { tools?: { name?: unknown }[] }; knownConnectors?: unknown[] };
  const names = [
    ...(f.centralLayer?.tools ?? []).map((t) => t.name),
    ...(f.knownConnectors ?? []),
  ].filter((n): n is string => typeof n === "string" && n.length > 0);
  return [...new Set(names)];
}

const LITERAL = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

export interface Hit {
  file: string;
  line: number;
  literal: string;
  name: string;
  fingerprint: string;
}

/** Stable id of one hit: hash of the file and the full literal (or `key:<text>` for an unquoted key). The line number
 * is not part of it, so moving code does not invalidate a verdict; a different literal in the same file does. */
export function fingerprintOf(file: string, literal: string): string {
  return createHash("sha256").update(`${file}\0${literal}`).digest("hex").slice(0, 12);
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function scanText(file: string, text: string, names: readonly string[]): Hit[] {
  const hits: Hit[] = [];
  const lower = names.map((n) => n.toLowerCase());
  // Unquoted object keys (Issue #412, red-team LOW 4): only a name that is a valid identifier can be one. A key that
  // sits inside a string literal on the same line is also reported (over-report, errs toward triage).
  const keyRes = names.map((n) => (IDENTIFIER.test(n) ? new RegExp(`(?<![\\w$.\\-"'/])${escapeRe(n)}\\s*:(?!:)`, "i") : undefined));
  text.split(/\r?\n/).forEach((lineText, i) => {
    for (const m of lineText.matchAll(LITERAL)) {
      const lit = m[2] ?? "";
      const l = lit.toLowerCase();
      const t = l.trim();
      lower.forEach((n, k) => {
        if (t === n || l.includes(`mcp__${n}__`) || l.includes(`mcp/${n}/`)) {
          hits.push({ file, line: i + 1, literal: lit.length > 60 ? `${lit.slice(0, 57)}...` : lit, name: names[k]!, fingerprint: fingerprintOf(file, lit) });
        }
      });
    }
    keyRes.forEach((re, k) => {
      const m = re?.exec(lineText);
      if (m) hits.push({ file, line: i + 1, literal: `key ${m[0]}`, name: names[k]!, fingerprint: fingerprintOf(file, `key:${m[0].toLowerCase()}`) });
    });
  });
  return hits;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (SCAN_EXT.test(entry)) out.push(p);
  }
}

export function scanRepo(root: string, names: readonly string[]): Hit[] {
  const files: string[] = [];
  for (const r of SCAN_ROOTS) walk(join(root, r), files);
  const hits: Hit[] = [];
  for (const f of files.sort()) {
    const rel = relative(root, f).split(sep).join("/");
    hits.push(...scanText(rel, readFileSync(f, "utf8"), names));
  }
  return hits;
}

export interface Report {
  names: string[];
  hits: Hit[];
  files: string[];
  untriaged: string[];
  stale: string[];
  violations: string[];
}

export function buildReport(hits: readonly Hit[], names: string[], triage: Readonly<Record<string, Triage>>): Report {
  const files = [...new Set(hits.map((h) => h.file))].sort();
  return {
    names,
    hits: [...hits],
    files,
    // Per hit (Issue #412): a hit is triaged only if the file's verdict lists its fingerprint.
    untriaged: hits.filter((h) => !(triage[h.file]?.fingerprints ?? []).includes(h.fingerprint)).map((h) => `${h.file}:${String(h.line)}`),
    // Stale: a verdict file with no hits, or one whose listed fingerprint no longer matches any hit.
    stale: Object.keys(triage)
      .filter((f) => triage[f]!.fingerprints.some((fp) => !hits.some((h) => h.file === f && h.fingerprint === fp)))
      .sort(),
    violations: files.filter((f) => triage[f]?.verdict === "violation"),
  };
}

export function formatReport(r: Report, triage: Readonly<Record<string, Triage>>): string {
  const lines = [
    `fixture-name-triage: ${String(r.names.length)} fixture names read at run time; ${String(r.hits.length)} literal hit(s) in ${String(r.files.length)} file(s)`,
  ];
  for (const f of r.files) {
    const t = triage[f];
    lines.push(`${f}  [${t ? t.verdict : "no verdict"}]${t ? `  ${t.reason}` : ""}`);
    for (const h of r.hits.filter((x) => x.file === f)) {
      const open = r.untriaged.includes(`${h.file}:${String(h.line)}`) ? "  UNTRIAGED" : "";
      lines.push(`    line ${String(h.line)}: ${JSON.stringify(h.literal)}  (is or spells an entry name)${open}`);
    }
  }
  if (r.untriaged.length) lines.push(`UNTRIAGED: ${r.untriaged.join(", ")}`);
  if (r.stale.length) lines.push(`STALE verdict (file no longer hits): ${r.stale.join(", ")}`);
  if (r.violations.length) lines.push(`VIOLATION: ${r.violations.join(", ")}`);
  return lines.join("\n");
}

export function main(): number {
  const names = fixtureNames(readFileSync(FIXTURE_PATH, "utf8"));
  const report = buildReport(scanRepo(REPO_ROOT, names), names, TRIAGE);
  console.log(formatReport(report, TRIAGE));
  return report.untriaged.length + report.stale.length + report.violations.length === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
