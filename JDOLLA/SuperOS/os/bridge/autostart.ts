// npm run autostart -- install|remove|status [--dry-run]
// Starts the bridge when Jay logs in (Phase 9b prep).
//  - Windows: a per-user Task Scheduler task named exactly TASK_NAME, from an XML definition, created with
//    schtasks.exe (full System32 path, argv array, never a shell). No admin rights: the task runs as Jay,
//    only at Jay's logon, at the lowest run level. Never a system-wide task.
//  - The first `install` is a dry run that prints exactly what would happen; running the same command again
//    with the same plan installs it. --dry-run always only prints.
//  - macOS / Linux: prints the equivalent launchd agent or systemd --user unit. Never installs it.
// It runs `node bridge/server.ts` in os/ (what `npm start` runs), with node.exe called directly so no shell is needed.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";

export const TASK_NAME = "JDOLLA SuperOS bridge";
const SERVER_ARGS = ["bridge/server.ts"];

export interface Env {
  platform: NodeJS.Platform;
  osDir: string;        // the vault's os/ folder
  nodePath: string;     // this node binary
  user: string;         // login name
  domain: string;       // USERDOMAIN on Windows (computer name for a local account)
  systemRoot: string;   // %SystemRoot%, usually C:\Windows
  home: string;
  stateFile: string;    // remembers which plan was shown, outside the vault
  tmp: string;
}
export type Runner = (cmd: string, args: readonly string[]) => { status: number | null; stdout: string; stderr: string };

export function defaultEnv(): Env {
  const home = process.env["USERPROFILE"] ?? process.env["HOME"] ?? userInfo().homedir;
  return {
    platform: process.platform,
    osDir: path.resolve(import.meta.dirname, ".."),
    nodePath: process.execPath,
    user: process.env["USERNAME"] ?? userInfo().username,
    domain: process.env["USERDOMAIN"] ?? "",
    systemRoot: process.env["SystemRoot"] ?? "C:\\Windows",
    home,
    stateFile: path.join(home, ".superos", "autostart.json"),
    tmp: tmpdir(),
  };
}

export const defaultRunner: Runner = (cmd, args) => {
  const r = spawnSync(cmd, args, { shell: false, encoding: "utf8", windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? String(r.error.message) : "") };
};

const xmlEscape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
/** Windows account names: letters, digits, space and . _ - $ only. Anything else is refused rather than escaped. */
const ACCOUNT = /^[\w .$-]{1,104}$/;

export function windowsUserId(env: Env): string {
  if (!ACCOUNT.test(env.user) || (env.domain && !ACCOUNT.test(env.domain))) throw new Error("Unexpected characters in the Windows user name; refusing to build the task.");
  return env.domain ? `${env.domain}\\${env.user}` : env.user;
}

/** The Task Scheduler definition. Runs as the logged-in user, at logon of that user only, least privilege. */
export function taskXml(env: Env): string {
  const who = xmlEscape(windowsUserId(env));
  const osDir = path.win32.normalize(env.osDir);
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    "  <RegistrationInfo>",
    `    <Description>${xmlEscape("Starts the JDOLLA SuperOS bridge (npm start in the os folder) when you log in. Made by npm run autostart.")}</Description>`,
    `    <URI>\\${xmlEscape(TASK_NAME)}</URI>`,
    "  </RegistrationInfo>",
    "  <Triggers>",
    "    <LogonTrigger>",
    "      <Enabled>true</Enabled>",
    `      <UserId>${who}</UserId>`,
    "      <Delay>PT30S</Delay>",
    "    </LogonTrigger>",
    "  </Triggers>",
    "  <Principals>",
    '    <Principal id="Author">',
    `      <UserId>${who}</UserId>`,
    "      <LogonType>InteractiveToken</LogonType>",
    "      <RunLevel>LeastPrivilege</RunLevel>",
    "    </Principal>",
    "  </Principals>",
    "  <Settings>",
    "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
    "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
    "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
    "    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
    "    <AllowStartOnDemand>true</AllowStartOnDemand>",
    "    <Enabled>true</Enabled>",
    "  </Settings>",
    '  <Actions Context="Author">',
    "    <Exec>",
    `      <Command>${xmlEscape(path.win32.normalize(env.nodePath))}</Command>`,
    `      <Arguments>${xmlEscape(SERVER_ARGS.join(" "))}</Arguments>`,
    `      <WorkingDirectory>${xmlEscape(osDir)}</WorkingDirectory>`,
    "    </Exec>",
    "  </Actions>",
    "</Task>",
    "",
  ].join("\r\n");
}

export const schtasksPath = (env: Env): string => path.win32.join(env.systemRoot, "System32", "schtasks.exe");
export const xmlFile = (env: Env): string => path.join(env.tmp, "jdolla-superos-bridge-task.xml");

/** The exact argv for each action. The task name is always the constant; nothing else is ever touched. */
export function windowsArgs(action: "install" | "remove" | "status", env: Env): string[] {
  if (action === "install") return ["/Create", "/TN", TASK_NAME, "/XML", xmlFile(env), "/F"];
  if (action === "remove") return ["/Delete", "/TN", TASK_NAME, "/F"];
  return ["/Query", "/TN", TASK_NAME, "/FO", "LIST", "/V"];
}

export function launchdPlist(env: Env): string {
  const e = xmlEscape;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.jdolla.superos.bridge</string>
  <key>ProgramArguments</key>
  <array><string>${e(env.nodePath)}</string>${SERVER_ARGS.map((a) => `<string>${e(a)}</string>`).join("")}</array>
  <key>WorkingDirectory</key><string>${e(env.osDir)}</string>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
`;
}

/** systemd: "%" starts a specifier, so it is doubled; ExecStart words are quoted (paths may hold spaces); WorkingDirectory takes the raw path. */
const sdPercent = (s: string): string => s.replace(/%/g, "%%");
const sdQuote = (s: string): string => `"${sdPercent(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
export function systemdUnit(env: Env): string {
  return `[Unit]
Description=JDOLLA SuperOS bridge (npm start in the os folder)

[Service]
WorkingDirectory=${sdPercent(env.osDir)}
ExecStart=${[env.nodePath, ...SERVER_ARGS].map(sdQuote).join(" ")}
Restart=on-failure

[Install]
WantedBy=default.target
`;
}

/** One fingerprint of everything install would do, so "the same plan" can be recognised on the second run. */
export function planHash(env: Env): string {
  return createHash("sha256").update(taskXml(env)).update(windowsArgs("install", env).join("\0")).digest("hex").slice(0, 16);
}
function shownPlan(env: Env): string | null {
  try { return (JSON.parse(readFileSync(env.stateFile, "utf8")) as { shown?: string }).shown ?? null; } catch { return null; }
}
function rememberPlan(env: Env, hash: string): void {
  mkdirSync(path.dirname(env.stateFile), { recursive: true });
  writeFileSync(env.stateFile, JSON.stringify({ shown: hash, at: new Date().toISOString() }) + "\n");
}

/** UTF-16 LE with a byte-order mark: the encoding schtasks /XML reads reliably. */
export function utf16(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
}

const showCmd = (cmd: string, args: readonly string[]): string => [cmd, ...args].map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");

export function runAutostart(argv: string[], env: Env = defaultEnv(), run: Runner = defaultRunner, out: (s: string) => void = (s) => console.log(s)): number {
  const action = argv.find((a) => !a.startsWith("--"));
  const unknown = argv.filter((a) => a.startsWith("--") && a !== "--dry-run");
  const dry = argv.includes("--dry-run");
  if (!action || !["install", "remove", "status"].includes(action) || unknown.length || argv.filter((a) => !a.startsWith("--")).length > 1) {
    out("usage: npm run autostart -- install|remove|status [--dry-run]");
    return 2;
  }
  const act = action as "install" | "remove" | "status";

  if (env.platform !== "win32") {
    const mac = env.platform === "darwin";
    out(`Autostart is only installed automatically on Windows. Nothing was changed on this ${mac ? "Mac" : env.platform} computer.`);
    if (act === "install") {
      out(mac
        ? `To do it yourself, save this as ~/Library/LaunchAgents/com.jdolla.superos.bridge.plist and run: launchctl load ~/Library/LaunchAgents/com.jdolla.superos.bridge.plist\n\n${launchdPlist(env)}`
        : `To do it yourself, save this as ~/.config/systemd/user/jdolla-superos-bridge.service and run: systemctl --user enable --now jdolla-superos-bridge\n\n${systemdUnit(env)}`);
    }
    return 0;
  }

  const schtasks = schtasksPath(env);
  if (act === "status") {
    const r = run(schtasks, windowsArgs("status", env));
    out(r.status === 0 ? r.stdout.trim() : `No task named "${TASK_NAME}" is installed.`);
    return 0;
  }
  if (act === "remove") {
    const args = windowsArgs("remove", env);
    if (dry) { out(`DRY RUN, nothing changed. Would run:\n  ${showCmd(schtasks, args)}`); return 0; }
    const r = run(schtasks, args);
    out(r.status === 0 ? `Removed the task "${TASK_NAME}". The bridge no longer starts at logon.` : `No task named "${TASK_NAME}" was removed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
    return r.status === 0 ? 0 : 1;
  }

  // install
  const xml = taskXml(env);
  const args = windowsArgs("install", env);
  const hash = planHash(env);
  const firstTime = shownPlan(env) !== hash;
  if (dry || firstTime) {
    out([
      `${dry ? "DRY RUN" : "FIRST TIME: dry run"}, nothing changed. This is exactly what install would do:`,
      `1. Write the task definition to ${xmlFile(env)}:`,
      "",
      xml,
      `2. Run (no shell, no admin):`,
      `  ${showCmd(schtasks, args)}`,
      `3. Delete ${xmlFile(env)}.`,
      "",
      `The task "${TASK_NAME}" runs ${showCmd(env.nodePath, SERVER_ARGS)} in ${env.osDir} 30 seconds after you log in, as you, with no admin rights.`,
      dry ? "" : "Run the same command again to install it.",
    ].join("\n"));
    if (!dry) rememberPlan(env, hash);
    return 0;
  }
  mkdirSync(path.dirname(xmlFile(env)), { recursive: true });
  writeFileSync(xmlFile(env), utf16(xml));
  try {
    const r = run(schtasks, args);
    if (r.status !== 0) { out(`Task Scheduler refused: ${(r.stderr || r.stdout).trim().slice(0, 300)}`); return 1; }
    out(`Installed "${TASK_NAME}". The bridge starts 30 seconds after you log in. Check with: npm run autostart -- status`);
    return 0;
  } finally { rmSync(xmlFile(env), { force: true }); }
}

if (import.meta.main) process.exitCode = runAutostart(process.argv.slice(2));
