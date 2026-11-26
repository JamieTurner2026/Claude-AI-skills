// npm run doctor [-- --json]: is this PC ready to run the bridge? See bridge/doctor.ts.
// Exit 0 when nothing fails (warnings are fine), 1 when a check fails, 2 on a bad argument.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeBinSetting, loadConfig, pathsFor } from "./config.ts";
import { formatDoctor, realDeps, runDoctor, type DoctorDeps } from "./doctor.ts";
import { runtimeState } from "../brain/embeddings.ts";

/** Same rule as brain/indexer.ts defaultIndexPath(), without loading SQLite just to print a path. */
export function brainIndexPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env["SUPEROS_BRAIN_DB"]) return env["SUPEROS_BRAIN_DB"];
  const dir = env["SUPEROS_BRAIN_DIR"] ?? path.join(env["USERPROFILE"] ?? env["HOME"] ?? ".", ".superos", "brain");
  return path.join(dir, "index.sqlite");
}

export function defaultDeps(osDir: string): DoctorDeps {
  const paths = pathsFor(osDir);
  return realDeps(paths.vault, paths.os, {
    claudeBinFromConfig: () => { try { return claudeBinSetting(paths, loadConfig(paths)); } catch { return undefined; } },
    brainIndexPath: () => brainIndexPath(),
    embeddingsRuntime: () => { try { const s = runtimeState(); return s === "ok" ? true : s === "outdated" ? "outdated" : false; } catch { return false; } },
    backupRemote: () => { try { return loadConfig(paths).engine.backup.remote; } catch { return null; } },
  });
}

export async function main(argv: string[], deps: DoctorDeps, out: (s: string) => void = (s) => process.stdout.write(s + "\n")): Promise<number> {
  const json = argv.includes("--json");
  const bad = argv.find((a) => a !== "--json");
  if (bad !== undefined) { out(`Unknown argument: ${bad.slice(0, 40)}\nUsage: npm run doctor [-- --json]`); return 2; }
  const checks = await runDoctor(deps);
  out(json ? JSON.stringify({ checks, fails: checks.filter((c) => c.status === "fail").length }, null, 2) : formatDoctor(checks));
  return checks.some((c) => c.status === "fail") ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const osDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  process.exitCode = await main(process.argv.slice(2), defaultDeps(osDir));
}
