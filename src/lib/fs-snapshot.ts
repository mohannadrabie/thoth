// Directory snapshot/diff used by QA-05's fixture-isolation check. Pure once the snapshot is
// taken; the only I/O is the recursive read, isolated in `snapshotDir`.
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export type Snapshot = Map<string, string>; // repo-relative path -> content sha256

export async function snapshotDir(root: string): Promise<Snapshot> {
  const snap: Snapshot = new Map();

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // root doesn't exist yet — an empty snapshot, not an error
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const content = await readFile(full);
        const hash = createHash("sha256").update(content).digest("hex");
        snap.set(relative(root, full).split("\\").join("/"), hash);
      }
    }
  }

  await walk(root);
  return snap;
}

export interface SnapshotDiff {
  added: string[];
  modified: string[];
  removed: string[];
}

export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];

  for (const [path, hash] of after) {
    if (!before.has(path)) added.push(path);
    else if (before.get(path) !== hash) modified.push(path);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) removed.push(path);
  }

  return { added, modified, removed };
}

export function isEmptyDiff(diff: SnapshotDiff): boolean {
  return diff.added.length === 0 && diff.modified.length === 0 && diff.removed.length === 0;
}

/** True if `root` currently exists (a live path with nothing written into it yet still exists). */
export async function pathExists(root: string): Promise<boolean> {
  try {
    await stat(root);
    return true;
  } catch {
    return false;
  }
}
