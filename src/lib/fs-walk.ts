// Recursive file listing, shared by every instrument that scans a directory tree (QA-01, QA-02,
// QA-14, QA-16). Missing root -> empty list, never an error: "the directory doesn't exist yet" is
// a legitimate, disclosed "0 found" state for a repo that hasn't built the thing it scans yet.
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export async function listFilesRecursive(
  root: string,
  predicate: (repoRelativePath: string) => boolean,
): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const rel = relative(root, full).split("\\").join("/");
        if (predicate(rel)) out.push(rel);
      }
    }
  }

  await walk(root);
  return out;
}
