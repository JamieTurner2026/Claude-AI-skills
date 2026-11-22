// Autostart tests. Nothing here touches Task Scheduler: a fake runner records every call instead.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TASK_NAME, launchdPlist, runAutostart, systemdUnit, taskXml, utf16, windowsArgs, type Env, type Runner } from "./autostart.ts";

function winEnv(over: Partial<Env> = {}): Env {
  const dir = mkdtempSync(path.join(tmpdir(), "autostart-"));
  return {
    platform: "win32",
    osDir: "C:\\Users\\Jay Turner\\My Vault & Notes\\JDOLLA\\os",
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
    user: "Jay Turner",
    domain: "JAY-PC",
    systemRoot: "C:\\Windows",
    home: dir,
    stateFile: path.join(dir, ".superos", "autostart.json"),
    tmp: dir,
    ...over,
  };
}
function recorder(status = 0, stdout = "") {
  const calls: { cmd: string; args: string[]; xmlAtCall: Buffer | null }[] = [];
  const env = { tmp: "" };
  const run: Runner = (cmd, args) => {
    const i = args.indexOf("/XML");
    const file = i >= 0 ? args[i + 1]! : null;
    calls.push({ cmd, args: [...args], xmlAtCall: file && existsSync(file) ? readFileSync(file) : null });
    return { status, stdout, stderr: status ? "ERROR: Access is denied." : "" };
  };
  return { calls, run, env };
}
const quiet = () => { const lines: string[] = []; return { lines, out: (s: string) => lines.push(s) }; };

describe("Windows task definition", () => {
  it("runs node bridge/server.ts in the os folder as the user, at that user's logon, least privilege", () => {
    const xml = taskXml(winEnv());
    assert.match(xml, /<Command>C:\\Program Files\\nodejs\\node\.exe<\/Command>/);
    assert.match(xml, /<Arguments>bridge\/server\.ts<\/Arguments>/);
    assert.match(xml, /<WorkingDirectory>C:\\Users\\Jay Turner\\My Vault &amp; Notes\\JDOLLA\\os<\/WorkingDirectory>/, "spaces kept, & escaped");
    assert.equal(xml.match(/<UserId>JAY-PC\\Jay Turner<\/UserId>/g)?.length, 2, "the logon trigger and the principal are both this user");
    assert.match(xml, /<LogonType>InteractiveToken<\/LogonType>/);
    assert.match(xml, /<RunLevel>LeastPrivilege<\/RunLevel>/);
    assert.match(xml, /<URI>\\JDOLLA SuperOS bridge<\/URI>/);
    for (const bad of ["HighestAvailable", "S-1-5-18", "SYSTEM", "<GroupId>", "BootTrigger", "Password"]) assert.ok(!xml.includes(bad), bad);
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-16"?>'));
  });
  it("refuses a user name that would need escaping into the task instead of guessing", () => {
    for (const user of ["jay<x>", "a\"b", "j\nk", ""]) assert.throws(() => taskXml(winEnv({ user })), /Unexpected characters/, JSON.stringify(user));
    assert.doesNotThrow(() => taskXml(winEnv({ user: "jay.t_1-x$" })), "control");
  });
  it("is written as UTF-16 LE with a byte-order mark", () => {
    const b = utf16("<a/>");
    assert.deepEqual([...b.subarray(0, 4)], [0xff, 0xfe, 0x3c, 0x00]);
  });
});

describe("Windows commands", () => {
  it("exact argv for each action; the task name is always the one constant", () => {
    const env = winEnv();
    assert.deepEqual(windowsArgs("install", env), ["/Create", "/TN", "JDOLLA SuperOS bridge", "/XML", path.join(env.tmp, "jdolla-superos-bridge-task.xml"), "/F"]);
    assert.deepEqual(windowsArgs("remove", env), ["/Delete", "/TN", "JDOLLA SuperOS bridge", "/F"]);
    assert.deepEqual(windowsArgs("status", env), ["/Query", "/TN", "JDOLLA SuperOS bridge", "/FO", "LIST", "/V"]);
    assert.equal(TASK_NAME, "JDOLLA SuperOS bridge");
  });
  it("first install is a dry run that runs nothing; the second installs with schtasks.exe from System32, no shell", () => {
    const env = winEnv();
    const { calls, run } = recorder();
    const o = quiet();
    assert.equal(runAutostart(["install"], env, run, o.out), 0);
    assert.equal(calls.length, 0, "the first time runs nothing");
    assert.match(o.lines.join("\n"), /FIRST TIME: dry run, nothing changed/);
    assert.match(o.lines.join("\n"), /Run the same command again to install it/);
    assert.match(o.lines.join("\n"), /<WorkingDirectory>C:\\Users\\Jay Turner/, "prints the exact XML");
    assert.equal(runAutostart(["install"], env, run, o.out), 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.cmd, "C:\\Windows\\System32\\schtasks.exe", "full path, not whatever schtasks is first on PATH");
    assert.deepEqual(calls[0]!.args, windowsArgs("install", env));
    assert.deepEqual(calls[0]!.xmlAtCall, utf16(taskXml(env)), "the definition on disk is exactly the one shown");
    assert.equal(existsSync(path.join(env.tmp, "jdolla-superos-bridge-task.xml")), false, "the temp file is removed afterwards");
  });
  it("a changed plan (the vault moved) is shown again before anything is installed", () => {
    const env = winEnv();
    const { calls, run } = recorder();
    const o = quiet();
    runAutostart(["install"], env, run, o.out);
    runAutostart(["install"], { ...env, osDir: "D:\\New Place\\os" }, run, o.out);
    assert.equal(calls.length, 0);
  });
  it("--dry-run never runs anything, for install or remove, even after the plan was shown", () => {
    const env = winEnv();
    const { calls, run } = recorder();
    const o = quiet();
    runAutostart(["install"], env, run, o.out);
    runAutostart(["install", "--dry-run"], env, run, o.out);
    runAutostart(["remove", "--dry-run"], env, run, o.out);
    assert.equal(calls.length, 0);
    assert.match(o.lines.join("\n"), /Would run:\n {2}C:\\Windows\\System32\\schtasks\.exe \/Delete \/TN "JDOLLA SuperOS bridge" \/F/);
  });
  it("remove deletes only the task with the exact name; status only queries it", () => {
    const env = winEnv();
    const { calls, run } = recorder(0, "TaskName: \\JDOLLA SuperOS bridge");
    const o = quiet();
    assert.equal(runAutostart(["remove"], env, run, o.out), 0);
    assert.equal(runAutostart(["status"], env, run, o.out), 0);
    assert.deepEqual(calls.map((c) => c.args), [["/Delete", "/TN", TASK_NAME, "/F"], ["/Query", "/TN", TASK_NAME, "/FO", "LIST", "/V"]]);
    for (const c of calls) assert.equal(c.args.filter((a) => a.includes("JDOLLA")).length, 1);
  });
  it("a refusal from Task Scheduler is reported, exits 1, and still removes the temp file", () => {
    const env = winEnv();
    const { run } = recorder(1);
    const o = quiet();
    runAutostart(["install"], env, run, o.out);
    assert.equal(runAutostart(["install"], env, run, o.out), 1);
    assert.match(o.lines.at(-1)!, /Task Scheduler refused: ERROR: Access is denied/);
    assert.equal(existsSync(path.join(env.tmp, "jdolla-superos-bridge-task.xml")), false);
  });
  it("bad arguments: usage and exit 2, nothing run", () => {
    const { calls, run } = recorder();
    for (const argv of [[], ["start"], ["install", "--yes"], ["install", "remove"], ["--dry-run"]]) assert.equal(runAutostart(argv, winEnv(), run, quiet().out), 2, JSON.stringify(argv));
    assert.equal(calls.length, 0);
  });
});

describe("macOS and Linux: printed, never installed", () => {
  for (const platform of ["darwin", "linux"] as const) {
    it(`${platform}: install prints the unit and runs nothing`, () => {
      const env = winEnv({ platform, osDir: "/Users/jay/My Vault/os", nodePath: "/usr/local/bin/node" });
      const { calls, run } = recorder();
      const o = quiet();
      assert.equal(runAutostart(["install"], env, run, o.out), 0);
      assert.equal(calls.length, 0);
      assert.equal(existsSync(env.stateFile), false);
      assert.match(o.lines.join("\n"), /Nothing was changed/);
      assert.ok(o.lines.join("\n").includes(platform === "darwin" ? launchdPlist(env) : systemdUnit(env)));
    });
  }
  it("the systemd unit quotes ExecStart and keeps WorkingDirectory raw; % is escaped", () => {
    const u = systemdUnit(winEnv({ platform: "linux", osDir: "/home/jay/My 100% Vault/os", nodePath: "/usr/bin/node" }));
    assert.match(u, /^WorkingDirectory=\/home\/jay\/My 100%% Vault\/os$/m);
    assert.match(u, /^ExecStart="\/usr\/bin\/node" "bridge\/server\.ts"$/m);
  });
  it("the launchd plist escapes paths", () => {
    const p = launchdPlist(winEnv({ platform: "darwin", osDir: "/Users/jay/A & B/os", nodePath: "/opt/node" }));
    assert.match(p, /<string>\/Users\/jay\/A &amp; B\/os<\/string>/);
    assert.match(p, /<array><string>\/opt\/node<\/string><string>bridge\/server\.ts<\/string><\/array>/);
  });
});

describe("no shell anywhere", () => {
  it("the real runner spawns with shell: false", () => {
    const src = readFileSync(path.join(import.meta.dirname, "autostart.ts"), "utf8");
    assert.match(src, /spawnSync\(cmd, args, \{ shell: false/);
    assert.equal(src.match(/spawnSync\(/g)?.length, 1, "one spawn site only");
    assert.ok(!/exec(Sync)?\(/.test(src), "no exec/execSync (they use a shell)");
  });
});
