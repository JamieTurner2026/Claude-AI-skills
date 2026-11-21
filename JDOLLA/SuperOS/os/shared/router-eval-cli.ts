// npm run eval:router [-- --json] [-- --file <path>]
// Runs every labelled request in evals/router/requests.json through the real route(), with the
// departments the bridge reads from the vault. Reads only; writes nothing but stdout. No network, no cost.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, pathsFor } from "../bridge/config.ts";
import { buildState } from "../bridge/indexer.ts";
import { route } from "./router.ts";
import { EvalSetError, formatReport, loadEvalSet, scoreSet } from "./router-eval.ts";

const MAX_SET_BYTES = 1024 * 1024;

export function main(argv: string[], osDir: string, out: (s: string) => void = (s) => process.stdout.write(s + "\n"), err: (s: string) => void = (s) => process.stderr.write(s + "\n")): number {
  let json = false;
  let file: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--file" && argv[i + 1]) file = argv[++i];
    else { err(`Unknown argument: ${String(a).slice(0, 60)}\nUsage: npm run eval:router [-- --json] [-- --file <path>]`); return 2; }
  }
  const paths = pathsFor(osDir);
  const setFile = path.resolve(file ?? path.join(paths.vault, "evals", "router", "requests.json"));
  let set;
  try {
    const text = readFileSync(setFile, "utf8");
    if (text.length > MAX_SET_BYTES) throw new EvalSetError(["file is over 1 MB"]);
    set = loadEvalSet(JSON.parse(text));
  } catch (e) {
    err(e instanceof EvalSetError ? e.message : `Could not read the eval set ${setFile}: ${(e as Error).message}`);
    return 1;
  }
  const depts = buildState(paths, loadConfig(paths)).departments.map((d) => ({ slug: d.slug, name: d.name }));
  const score = scoreSet(set, { depts }, route);
  out(json ? JSON.stringify({ departments: depts.map((d) => d.slug), ...score }, null, 2) : formatReport(score));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
}
