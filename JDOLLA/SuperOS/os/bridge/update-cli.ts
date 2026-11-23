// `npm run update` (PC-SETUP §2 and §9.1). Exit 0 when every step passed, 1 otherwise.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findNpmCli, realExec, runUpdate } from "./update.ts";

const osDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = runUpdate({
  vault: path.resolve(osDir, ".."),
  osDir,
  npmCli: findNpmCli(process.env, process.execPath),
  node: process.execPath,
  exec: realExec,
  out: (l) => console.log(l),
});
console.log("");
console.log(r.ok ? "Up to date and checked. You can start the bridge." : "Update stopped. Read the FAIL line above.");
process.exitCode = r.ok ? 0 : 1;
