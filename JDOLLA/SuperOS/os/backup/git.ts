// Runs git with an argument list (never a shell), inside one folder. Output is capped and every call has a timeout.
import { spawn } from "node:child_process";

export type GitResult = { code: number | null; stdout: string; stderr: string };
export type GitRunner = (args: readonly string[], timeoutMs?: number) => Promise<GitResult>;

const MAX_OUT = 4 * 1024 * 1024;

/** git for `cwd`. The environment is the PC's own (so its saved GitHub login is used) with prompts switched off: a missing login fails instead of hanging. */
export function makeGit(cwd: string, env: NodeJS.ProcessEnv = process.env): GitRunner {
  return (args, timeoutMs = 60_000) => new Promise((resolve) => {
    let child;
    try {
      child = spawn("git", [...args], { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", LC_ALL: "C", LANG: "C" } });
    } catch { resolve({ code: null, stdout: "", stderr: "git could not be started" }); return; }
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill(); }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => { if (stdout.length < MAX_OUT) stdout += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { if (stderr.length < MAX_OUT) stderr += d.toString("utf8"); });
    child.on("error", () => { clearTimeout(timer); resolve({ code: null, stdout, stderr: stderr || "git could not be started" }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
