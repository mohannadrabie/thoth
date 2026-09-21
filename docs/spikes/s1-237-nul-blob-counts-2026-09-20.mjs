// Spike for GitHub Issue #237 (story s1-237-nul-byte-scan), PRINCIPLES rules 17-18. Runs BEFORE any test
// or source change and answers, with counts only, the two questions the story's premise rests on:
//   Q1. Over the scanner's own scope, how many blobs does the old rule skip (a NUL byte in the first 8000
//       bytes), what would they match once scanned like any other blob, and how many of those matches are
//       not on the allowlist (would block)?
//   Q3. Does widening the generic-password value class (`[^'"\s]` -> `[^'" \t\n\v\f\r]`, so a latin1 0xA0
//       no longer ends the value) move any (path, pattern, value-hash) triple over the blobs already
//       scanned today?
// Reuses the scanner's own SECRET_PATTERNS, scanBlobText, partitionAllowlisted and catFileBlob, so it
// cannot disagree with the gate. Output is COUNTS (and blob/path names) only: no matched value, no hash and
// no redaction prefix is ever printed. This file holds no raw NUL byte and no secret-shaped literal.
//
// STOP conditions (the story plan, section 4): (a) a formerly-skipped blob yields a triple that is not on
// the allowlist; (b) any triple changes under the class change. Both are printed as verdict lines.
//
// Run: node docs/spikes/s1-237-nul-blob-counts-2026-09-20.mjs [ref]
import { randomBytes } from "node:crypto";
import { makeGitOps } from "../../src/lib/git.ts";
import { realRunner } from "../../src/lib/exec.ts";
import { SECRET_PATTERNS } from "../../src/secret-scan/patterns.ts";
import { loadAllowlist, partitionAllowlisted, scanBlobText } from "../../src/secret-scan/history-scan.ts";
import { buildSimulatedCommit } from "../../src/secret-scan/simulated-commit.ts";

const ref = process.argv[2] ?? "HEAD";
const root = process.cwd();
const git = makeGitOps(realRunner, root);

const GENERIC = "generic-password-assignment";
const OLD_CLASS = "[^'\"\\s]{8,}";
const NEW_CLASS = "[^'\" \\t\\n\\v\\f\\r]{8,}";

/** The catalog with the generic-password value class forced to one spelling, whichever spelling the
 * checked-out patterns.ts holds, so the spike measures old-vs-new on any commit. */
function withClass(cls) {
  return SECRET_PATTERNS.map((p) => {
    if (p.id !== GENERIC) return p;
    const src = p.regex.source.replace(OLD_CLASS, cls).replace(NEW_CLASS, cls);
    return { ...p, regex: new RegExp(src, p.regex.flags) };
  });
}
const OLD_PATTERNS = withClass(OLD_CLASS);
const NEW_PATTERNS = withClass(NEW_CLASS);
const classSpellingsDiffer = OLD_PATTERNS[SECRET_PATTERNS.findIndex((p) => p.id === GENERIC)].regex.source !==
  NEW_PATTERNS[SECRET_PATTERNS.findIndex((p) => p.id === GENERIC)].regex.source;

const nulEarly = (buf) => buf.subarray(0, Math.min(buf.length, 8000)).includes(0);
const nulLate = (buf) => buf.length > 8000 && buf.subarray(8000).includes(0);
const tripleKey = (t) => `${t.path}\0${t.patternId}\0${t.valueSha256}`;

const allowlist = await loadAllowlist("docs/qa/secret-scan-allowlist.json");

/** One walk, the scanner's own dedupe (blob sha across the whole walk, first sighting names the path). */
async function walk(commits) {
  const seen = new Set();
  const out = {
    commits: commits.length,
    blobs: 0,
    nulEarly: 0,
    nulLateOnly: 0,
    skippedBytes: 0,
    largest: 0,
    skippedBlobs: [], // { sha, path, size, byPattern }
    oldTriples: new Map(), // old rule (skip) + old class
    oldRuleNewClass: new Map(), // old rule (skip) + new class
    newTriples: new Map(), // no skip + new class
    biggest: [], // { size, text } of the largest blobs, for the timing section
  };
  for (const commit of commits) {
    for (const [path, sha] of await git.lsTree(commit)) {
      if (seen.has(sha)) continue;
      seen.add(sha);
      const buf = await git.catFileBlob(sha);
      out.blobs++;
      out.largest = Math.max(out.largest, buf.length);
      const early = nulEarly(buf);
      if (early) {
        out.nulEarly++;
        out.skippedBytes += buf.length;
      } else if (nulLate(buf)) out.nulLateOnly++;
      const text = buf.toString("latin1");
      const add = (map, patterns) => {
        for (const m of scanBlobText(text, patterns)) {
          const t = { commit, path, patternId: m.patternId, description: m.description, redacted: m.redacted, valueSha256: m.valueSha256 };
          map.set(tripleKey(t), t);
        }
      };
      if (!early) {
        add(out.oldTriples, OLD_PATTERNS);
        add(out.oldRuleNewClass, NEW_PATTERNS);
      }
      const before = out.newTriples.size;
      add(out.newTriples, NEW_PATTERNS);
      if (early) {
        const byPattern = {};
        for (const m of scanBlobText(text, NEW_PATTERNS)) byPattern[m.patternId] = (byPattern[m.patternId] ?? 0) + 1;
        out.skippedBlobs.push({ sha: sha.slice(0, 12), path, size: buf.length, byPattern, newDistinct: out.newTriples.size - before });
      }
      out.biggest.push({ size: buf.length, text });
      out.biggest.sort((a, b) => b.size - a.size);
      if (out.biggest.length > 3) out.biggest.length = 3;
    }
  }
  return out;
}

const notAllowlisted = (triples) => partitionAllowlisted([...triples], allowlist).blocking.length;
const setDiff = (a, b) => [...a.keys()].filter((k) => !b.has(k)).length;

function report(label, w) {
  console.log(`\n== ${label} ==`);
  console.log(`commits=${w.commits} distinctBlobs=${w.blobs} largestBlobBytes=${w.largest}`);
  console.log(`blobs with NUL in first 8000 bytes (old rule skips): ${w.nulEarly}, total bytes ${w.skippedBytes}`);
  console.log(`blobs with NUL only after byte 8000 (old rule scans): ${w.nulLateOnly}`);
  for (const b of w.skippedBlobs) {
    console.log(`  formerly skipped: blob ${b.sha} path=${JSON.stringify(b.path)} bytes=${b.size} matchesByPattern=${JSON.stringify(b.byPattern)} newDistinctTriples=${b.newDistinct}`);
  }
  const formerlySkippedNew = [...w.newTriples.values()].filter((t) => !w.oldTriples.has(tripleKey(t)) && !w.oldRuleNewClass.has(tripleKey(t)));
  console.log(`Q1 new distinct (path, pattern, hash) triples from formerly skipped blobs: ${formerlySkippedNew.length}`);
  console.log(`Q1 of those, not covered by the allowlist (would block): ${notAllowlisted(formerlySkippedNew)}`);
  console.log(`Q3 triples over already-scanned blobs: old class=${w.oldTriples.size} new class=${w.oldRuleNewClass.size} only-old=${setDiff(w.oldTriples, w.oldRuleNewClass)} only-new=${setDiff(w.oldRuleNewClass, w.oldTriples)}`);
  console.log(`total triples: old rule=${w.oldTriples.size} new rule=${w.newTriples.size}; blocking under new rule=${notAllowlisted(w.newTriples.values())}`);
  return { formerlySkippedNew };
}

console.log(`ref=${ref} classSpellingsDiffer=${classSpellingsDiffer} allowlistEntries=${allowlist.length}`);

const hist = await walk(await git.revList(ref));
const histReport = report(`history from ${ref} (CI scope)`, hist);

const allRefs = await walk(await git.revList(ref, { allRefs: true }));
report("all refs (reported, not gating)", allRefs);

const simSha = await buildSimulatedCommit(realRunner, root);
const sim = await walk([simSha]);
report("simulated pre-commit tree", sim);

// Union across the two scopes the gate runs on (history + pre-commit tree), old rule vs new class, and
// the new rule: the number the allowlist's 108 triples are pinned against.
const unionOld = new Map([...hist.oldTriples, ...sim.oldTriples]);
const unionOldNewClass = new Map([...hist.oldRuleNewClass, ...sim.oldRuleNewClass]);
const unionNew = new Map([...hist.newTriples, ...sim.newTriples]);
console.log("\n== union of history and the simulated pre-commit tree ==");
console.log(`triples: old rule+old class=${unionOld.size} old rule+new class=${unionOldNewClass.size} new rule+new class=${unionNew.size}`);
console.log(`Q3 only-old=${setDiff(unionOld, unionOldNewClass)} only-new=${setDiff(unionOldNewClass, unionOld)}`);
console.log(`Q1 new triples once NUL blobs are scanned (union): ${setDiff(unionNew, unionOldNewClass)}; not covered by the allowlist: ${notAllowlisted([...unionNew.values()].filter((t) => !unionOldNewClass.has(tripleKey(t))))}`);

// Cost: per-pattern time on the largest blobs of the history walk and on 50 MB of random bytes.
function timePatterns(label, text) {
  const cells = [];
  let total = 0;
  for (const p of NEW_PATTERNS) {
    const t0 = performance.now();
    p.regex.lastIndex = 0;
    let n = 0;
    for (const _m of text.matchAll(p.regex)) n++;
    const ms = performance.now() - t0;
    total += ms;
    cells.push(`${p.id}=${ms.toFixed(0)}ms/${n}`);
  }
  console.log(`time ${label} (${text.length} chars): total ${total.toFixed(0)} ms; ${cells.join(" ")}`);
}
console.log("\n== cost ==");
hist.biggest.forEach((b, i) => timePatterns(`largest blob #${i + 1}`, b.text));
timePatterns("random 50 MB", randomBytes(50 * 1024 * 1024).toString("latin1"));

// Verdicts against the plan's STOP conditions (c, the pre-commit runtime, is measured by its own script).
const stopA = notAllowlisted([...unionNew.values()].filter((t) => !unionOldNewClass.has(tripleKey(t)))) + notAllowlisted(histReport.formerlySkippedNew);
const stopB = setDiff(unionOld, unionOldNewClass) + setDiff(unionOldNewClass, unionOld);
console.log(`\nSTOP (a) formerly-skipped triples not on the allowlist: ${stopA === 0 ? "none" : "PRESENT (" + stopA + ")"}`);
console.log(`STOP (b) triples that move under the class change: ${stopB === 0 ? "none" : "PRESENT (" + stopB + ")"}`);
