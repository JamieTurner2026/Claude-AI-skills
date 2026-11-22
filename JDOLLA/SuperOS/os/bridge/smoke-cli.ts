// npm run smoke: run after every update. Works on a temp copy of the vault with the fake CLI, so it costs nothing
// and never touches the real vault, logs or brain index. Exit 0 when every step passes, 1 otherwise.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSmoke } from "./smoke.ts";

const vault = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
if (process.argv.length > 2) { console.log("Usage: npm run smoke   (no arguments)"); process.exit(2); }
console.log("JDOLLA$ smoke check (temp copy, fake CLI, no cost)\n");
const r = await runSmoke({ vault, log: (s) => console.log(s) });
const failed = r.steps.filter((s) => !s.ok).length;
console.log(`\n${r.steps.length - failed} pass, ${failed} fail. Temp copy ${r.cleanedUp ? "deleted" : `NOT deleted: ${r.tempRoot}`}.`);
if (!r.ok) console.log("Something broke after the update: send Claude the FAIL lines above, and don't start the bridge yet.");
process.exitCode = r.ok && r.cleanedUp ? 0 : 1;
