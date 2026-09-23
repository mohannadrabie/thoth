// Git plumbing helpers, injectable via a Runner (src/lib/exec.ts) so every consumer can be unit
// tested against a fake runner without a real repository.
import type { Runner } from "./exec.ts";

export interface GitOps {
  /** Every commit sha reachable from `ref` (default HEAD), oldest last as `git rev-list` gives them. */
  revList(ref?: string, opts?: { allRefs?: boolean }): Promise<string[]>;
  /** path -> blob sha for every tracked blob at `ref`. */
  lsTree(ref: string): Promise<Map<string, string>>;
  /** Raw blob content for a blob sha. */
  catFileBlob(sha: string): Promise<Buffer>;
  /** Files changed between two refs (`git diff --name-only base...head`). */
  diffNameOnly(base: string, head: string): Promise<string[]>;
  /** Full unified diff text between two refs, for content-level diff checks. */
  diffText(base: string, head: string): Promise<string>;
  /** The `owner/repo` slug this working tree's `origin` remote points at, or null if unavailable. */
  originSlug(): Promise<string | null>;
  /**
   * Every file path in the CURRENT WORKING TREE that isn't gitignored: tracked files (`git
   * ls-files --cached`, minus submodule gitlinks) plus untracked-but-not-ignored files (`--others
   * --exclude-standard`) — the real, live tree state, never a ref-pinned snapshot (`lsTree` above
   * reads a specific commit's blobs instead; the two are not interchangeable — GitHub Issue #172:
   * a caller that reads file CONTENT from the working tree but the file LIST from
   * `lsTree("HEAD")` silently excludes any new, uncommitted, scannable file). A submodule gitlink
   * (mode `160000`, e.g. this repo's own `adr/`) is a directory on disk, not a real blob — excluded
   * the same way `lsTree()` already excludes it for a ref-pinned read. An UNTRACKED nested git
   * repository (its own `.git`, not a real submodule) is reported by `--others` as a directory
   * entry with a trailing slash instead of being recursed into — also excluded (GitHub Issue #178:
   * unfiltered, it passed through as a "file" and crashed a caller's `readFile` with `EISDIR`).
   * Uses `-z` (NUL-separated) so a path containing a newline can never truncate or split a
   * filename.
   */
  lsFilesWorkingTree(): Promise<string[]>;
}

// GitHub Actions' documented sentinel for `github.event.before`/`.after` on a branch's first
// push, or a history-discontinuous push (force-push spanning unrelated history) — a
// syntactically-valid-looking ref that resolves to no real commit. `git diff` against it fails;
// see `resolveChangedFiles` below for why that failure must not be swallowed into a silent pass
// (GH issue 18, recurred — see docs/reviews/s1-protect-the-baseline-cross-domain-2026-08-30.md).
// (Deliberately not written as a real "Issue #N"/"#N" shape here: this file is itself scanned by
// QA-14, which fails closed on any Issue citation since no issue-tracker credential is wired in.)
export function isZeroSha(ref: string): boolean {
  return /^0+$/.test(ref);
}

export interface ResolvedDiff {
  changedFiles: string[];
  /** True when `base`/`head` was the zero-SHA sentinel and this fell back to a full-tree scan
   * (every tracked blob at the resolved ref) instead of a real diff. */
  fullTreeFallback: boolean;
}

/**
 * Resolves the changed-file list a diff-aware QA instrument (QA-02, QA-14) should scan.
 *
 * Detects the zero-SHA sentinel explicitly, BEFORE attempting `git diff`, and falls back to a
 * full-tree scan (every tracked file at the resolvable ref, via `lsTree`) rather than letting
 * `git diff` throw and having the caller swallow that into a silent vacuous pass — that swallow
 * was exactly the recurring gap (GH issue 18: first predicted 2026-08-25, demonstrated 2026-08-30).
 * A full-tree scan is the safer default for both instruments' own stated purpose ("enforced in
 * the pipeline, not by review discipline" / "every reference ... shall resolve") — it keeps
 * checking real content instead of skipping the gate outright on an unresolvable ref.
 *
 * Returns `null` only when `git diff` itself fails for a reason OTHER than the zero-SHA sentinel
 * (e.g. a genuinely bad non-zero ref) — callers keep their prior behavior for that case.
 */
export async function resolveChangedFiles(git: GitOps, base: string, head: string): Promise<ResolvedDiff | null> {
  if (isZeroSha(base) || isZeroSha(head)) {
    const scanRef = isZeroSha(head) ? "HEAD" : head;
    const tree = await git.lsTree(scanRef);
    return { changedFiles: [...tree.keys()], fullTreeFallback: true };
  }
  try {
    const changedFiles = await git.diffNameOnly(base, head);
    return { changedFiles, fullTreeFallback: false };
  } catch {
    return null;
  }
}

// One code point -> one C-escape sequence, per git's own quote.c. Anything not listed here (including
// a literal `\` or `"`, handled separately below) falls back to a three-digit octal byte escape.
const C_ESCAPES: Readonly<Record<string, number>> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, '"': 34 };
const OCTAL_ESCAPE = /^[0-7]{3}$/;

/**
 * Undoes git's own "C-quoting" of a tree path (`quote.c`'s `quote_c_style`), which `ls-tree` (and
 * every other porcelain-adjacent plumbing command this module runs) applies by default to any path
 * holding a byte >= 0x80, a literal backslash or double quote, or a C0 control character — e.g. a
 * file named `café.txt` prints as the literal 15-character string `"caf\303\251.txt"` (Issue 238).
 * `lsTree()` above does not undo this: its Map is keyed by that exact raw spelling, unchanged since
 * before Issue 238, so nothing that already reads its keys (history-scan's match paths, the
 * value-scoped allowlist's own `path` field, THOTH-ADR-0002) shifts under it. This function exists
 * only for a caller that needs to compare a tree entry against a path spelled the ordinary, human
 * way (e.g. a maintainer typing the filename they actually see) — never to change what a path KEY
 * is inside this codebase.
 *
 * Returns `raw` unchanged whenever it is not wrapped in a matching pair of double quotes (the
 * common case: git never quoted it) or the escape sequence inside it cannot be parsed — a
 * conservative "give up, don't guess" fallback, not a best-effort decode.
 */
export function decodeGitQuotedPath(raw: string): string {
  if (raw.length < 2 || raw[0] !== '"' || raw[raw.length - 1] !== '"') return raw;
  const inner = raw.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === undefined) break; // unreachable given the loop bound, satisfies noUncheckedIndexedAccess
    if (ch !== "\\") {
      for (const b of Buffer.from(ch, "utf8")) bytes.push(b);
      continue;
    }
    const next = inner[i + 1];
    if (next !== undefined && next in C_ESCAPES) {
      bytes.push(C_ESCAPES[next]!);
      i += 1;
      continue;
    }
    const octal = inner.slice(i + 1, i + 4);
    if (OCTAL_ESCAPE.test(octal)) {
      bytes.push(parseInt(octal, 8));
      i += 3;
      continue;
    }
    return raw; // an escape this decoder doesn't recognize: never guess, hand back the raw spelling
  }
  return Buffer.from(bytes).toString("utf8");
}

export function makeGitOps(runner: Runner, cwd: string): GitOps {
  async function run(args: string[]): Promise<string> {
    const res = await runner("git", args, { cwd, encoding: "utf8" });
    if (res.code !== 0) {
      throw new Error(`git ${args.join(" ")} failed (exit ${res.code}): ${res.stderr}`);
    }
    return res.stdout;
  }

  return {
    async revList(ref = "HEAD", opts = {}) {
      const args = ["rev-list", ...(opts.allRefs ? ["--all"] : [ref])];
      const out = await run(args);
      return out.split("\n").map((l) => l.trim()).filter(Boolean);
    },

    async lsTree(ref) {
      const out = await run(["ls-tree", "-r", ref]);
      const map = new Map<string, string>();
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        // "<mode> <type> <sha>\t<path>" — type is "blob" for a real file, "commit" for a
        // submodule gitlink (its sha is a commit in a DIFFERENT object database and is not
        // fetchable via this repo's own `git cat-file`; skip it, don't try to scan it here).
        const tabIdx = line.indexOf("\t");
        if (tabIdx === -1) continue;
        const meta = line.slice(0, tabIdx).split(/\s+/);
        const type = meta[1];
        const sha = meta[2];
        const path = line.slice(tabIdx + 1);
        if (type === "blob" && sha) map.set(path, sha);
      }
      return map;
    },

    async catFileBlob(sha) {
      const res = await runner("git", ["cat-file", "-p", sha], { cwd, encoding: "latin1" });
      if (res.code !== 0) {
        throw new Error(`git cat-file -p ${sha} failed: ${res.stderr}`);
      }
      return Buffer.from(res.stdout, "latin1");
    },

    async diffNameOnly(base, head) {
      const out = await run(["diff", "--name-only", `${base}...${head}`]);
      return out.split("\n").map((l) => l.trim()).filter(Boolean);
    },

    async diffText(base, head) {
      return run(["diff", `${base}...${head}`]);
    },

    async originSlug() {
      const res = await runner("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" });
      if (res.code !== 0) return null;
      const url = res.stdout.trim();
      // Matches both the SSH remote syntax (user@host:owner/repo.git) and an https URL
      // (https://host/owner/repo, optionally with a trailing .git)
      const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(url);
      if (!m) return null;
      return `${m[1]}/${m[2]}`;
    },

    async lsFilesWorkingTree() {
      // Two separate calls, not one combined `--cached --others` call: only the CACHED half can
      // ever be a submodule gitlink (mode `160000` — a directory on disk, e.g. this repo's own
      // `adr/` submodule; reading it as a file throws `EISDIR`, discovered live by this method's
      // own test), so only the cached half needs `-s` (stat/mode) to filter that out — the same
      // guard `lsTree()` above already applies for a ref-pinned read (`type === "blob"`). An
      // untracked (`--others`) path can never be a submodule (a submodule is always index-tracked),
      // so it needs no mode check.
      const cachedOut = await run(["ls-files", "-z", "-s", "--cached"]);
      const cached: string[] = [];
      for (const entry of cachedOut.split("\0")) {
        if (!entry) continue;
        const tabIdx = entry.indexOf("\t");
        if (tabIdx === -1) continue;
        const mode = entry.slice(0, tabIdx).trim().split(/\s+/)[0];
        if (mode === "160000") continue; // submodule gitlink — not a scannable blob
        cached.push(entry.slice(tabIdx + 1));
      }
      const othersOut = await run(["ls-files", "-z", "--others", "--exclude-standard"]);
      const others = othersOut
        .split("\0")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.endsWith("/"));
      // GitHub Issue #178 fix-now: an UNTRACKED nested git repository (its own `.git`, not a real
      // submodule gitlink — a submodule is always index-tracked, so it's excluded above via the
      // `--cached` mode-160000 check instead) cannot be recursed into by `git ls-files --others`;
      // git reports it as a DIRECTORY entry with a trailing slash (e.g. `zz-nested/`) rather than
      // its files. Before this fix that directory entry passed `shouldScanFile` unfiltered and a
      // later `readFile` on it threw an unhandled `EISDIR` (demonstrated: red-team round-2 report,
      // attack 3) — a real anomaly, but the wrong layer to filter it at, since a directory was
      // never a candidate file in the first place. Excluding it here, at the source, means every
      // consumer of this list (both QA-14 probes) never sees a non-file path at all.
      return [...cached, ...others];
    },
  };
}
