// #308 story F4 (Q2 ruling 2026-10-04, narrowed 2026-10-05): lexical canonical form of a shell redirect target, so a
// deny rule keyed on one project-relative lowercase path is not bypassed by case, backslash, "./", "//", ".." or
// Windows trailing-dot and trailing-space forms. Pure and total: no I/O, no environment, no cwd. Applied by shell.ts
// to every redirect target a record carries.
//
// Does: backslash to slash; lowercase (the Windows file system is case-insensitive; folding on POSIX over-blocks and
// never under-blocks); drop empty and "." segments; collapse ".." against a preceding real segment (a leading ".."
// is kept; above an absolute root it is dropped); fold trailing dots and spaces off a segment (Windows ignores them;
// a segment made only of dots is left alone); drop a trailing "/" (a directory rule lists the directory and its
// children separately).
// Does NOT do (disclosed): resolve against a cwd or project root (an absolute path, a drive form, a /c/ form never
// equals a project-relative rule, which is fail-closed only while POL-05 denies first), expand $VAR or ~user, follow
// symlinks or junctions, expand 8.3 short names. A leading "~" segment is kept literally and ".." never pops it.
export function canonicalizePathTarget(raw: string): string {
  const s = raw.replaceAll("\\", "/").toLowerCase();
  const absolute = s.startsWith("/");
  const out: string[] = [];
  for (const rawSeg of s.split("/")) {
    const seg = /^\.+$/.test(rawSeg) ? rawSeg : rawSeg.replace(/[. ]+$/, "");
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      const top = out[out.length - 1];
      if (top !== undefined && top !== ".." && top !== "~") out.pop();
      else if (!absolute) out.push("..");
      continue;
    }
    out.push(seg);
  }
  const body = out.join("/");
  if (absolute) return body === "" ? "/" : `/${body}`;
  return body === "" ? "." : body;
}

/** Issue #416: a ":" inside any segment means an NTFS alternate data stream (`policy.json::$data`), a drive-relative
 * path (`c:policy.json`) or a drive path. None can equal a project-relative rule target, so the caller marks the
 * record unresolved (POL-05 denies). Returns the cause, or undefined for a colon-free path. */
export function pathFormIssue(raw: string): string | undefined {
  return raw.replaceAll("\\", "/").split("/").some((seg) => seg.includes(":"))
    ? "redirect target has a ':' segment (alternate data stream or drive form), which no project-relative rule can match (#416)"
    : undefined;
}
