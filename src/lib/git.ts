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
  };
}
