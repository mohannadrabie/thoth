// P2b (substitute for P2, which could not authenticate with a redirected home): the real HOME is kept, and the
// deny rule is home-relative (~/...) aimed at a fresh dummy file under the home but inside the scratch folder.
// This measures ~ expansion for a home-relative Edit() rule on Windows, NOT the real ~/.claude/settings.json path.
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(ROOT, "..", "p2b-home", ".claude", "settings.json");
const rel = relative(homedir(), target).replaceAll("\\", "/");
if (rel.startsWith("..")) throw new Error("target is not under the home directory");
mkdirSync(dirname(target), { recursive: true });
const dummy = JSON.stringify({ $comment: "s7 P2b dummy settings (scratch, under the home)", env: { S7_DUMMY: "original" } }, null, 2) + "\n";
writeFileSync(`${target}.orig`, dummy);
writeFileSync(target, dummy);
const profiles = {
  p2bcontrol: { permissions: { allow: [] } },
  p2bdeny: { permissions: { deny: [`Edit(~/${rel})`] } },
  // Windows backslash absolute form of the same path.
  p2bwin: { permissions: { deny: [`Edit(${target})`] } },
};
for (const [k, v] of Object.entries(profiles)) writeFileSync(join(ROOT, "profiles", `${k}.json`), JSON.stringify(v, null, 2));
console.log(JSON.stringify({ rel, profiles }, null, 1));
