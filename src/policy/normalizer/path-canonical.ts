// #308 story F4 (Q2 ruling 2026-10-04): lexical canonical form of a shell redirect target, so a deny rule keyed
// on one project-relative lowercase path is not bypassed by case, backslash, "./", "//" or ".." forms.
// Pure and total: no I/O, no environment, no cwd. Applied by shell.ts to every extracted redirect target.
//
// Does: backslash to slash; lowercase (the Windows file system is case-insensitive; folding on POSIX over-blocks
// and never under-blocks); drop empty and "." segments; collapse ".." against a preceding real segment (a
// leading ".." is kept; above an absolute root it is dropped); keep a trailing "/" (a directory-prefix rule).
// Does NOT do (disclosed): resolve against a cwd or project root (so an absolute path or a /c/ or C:/ drive form
// never equals a project-relative rule target), expand $VAR or ~user, follow symlinks, expand 8.3 short names.
// A leading "~" segment is kept literally and ".." never pops it.
export function canonicalizePathTarget(raw: string): string {
  const s = raw.replaceAll("\\", "/").toLowerCase();
  const absolute = s.startsWith("/");
  const trailing = s.endsWith("/") && s.length > 1;
  const out: string[] = [];
  for (const seg of s.split("/")) {
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
  if (absolute) return body === "" ? "/" : `/${body}${trailing ? "/" : ""}`;
  if (body === "") return ".";
  return `${body}${trailing ? "/" : ""}`;
}
