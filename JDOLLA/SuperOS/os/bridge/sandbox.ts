// Is Claude Code's Bash sandbox available on this machine? Per Claude Code's docs: macOS uses Seatbelt;
// Linux and WSL2 need bubblewrap and socat; native Windows runs commands UNSANDBOXED. By default the CLI
// falls back to unsandboxed commands when the sandbox can't start, so we never rely on that: Bash is
// only offered when this check passes, and the run's settings also force failIfUnavailable.
import { accessSync, constants } from "node:fs";
import path from "node:path";

export type SandboxStatus = { available: boolean; reason: string };

export function onPath(cmd: string, envPath: string = process.env["PATH"] ?? ""): boolean {
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    try { accessSync(path.join(dir, cmd), constants.X_OK); return true; } catch { /* keep looking */ }
  }
  return false;
}

export function detectSandbox(platform: string = process.platform, has: (cmd: string) => boolean = (c) => onPath(c)): SandboxStatus {
  if (platform === "darwin") return { available: true, reason: "macOS Seatbelt sandbox" };
  if (platform === "linux") {
    const missing = ["bwrap", "socat"].filter((c) => !has(c));
    return missing.length ? { available: false, reason: `Linux sandbox needs bubblewrap and socat; missing: ${missing.join(", ")}.` } : { available: true, reason: "Linux bubblewrap sandbox" };
  }
  if (platform === "win32") return { available: false, reason: "Native Windows runs commands unsandboxed. Run Claude Code inside WSL2 to get a sandbox." };
  return { available: false, reason: `No Claude Code sandbox on ${platform}.` };
}

/** Settings that make the CLI refuse to run commands unsandboxed. Paths use normal absolute form here. */
export function sandboxSettings(vault: string): Record<string, unknown> {
  const deny = ["os", ".claude", "logs", ".git", ".env"].map((p) => path.join(vault, p));
  return {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    excludedCommands: [],
    filesystem: { denyRead: deny, denyWrite: deny },
  };
}
