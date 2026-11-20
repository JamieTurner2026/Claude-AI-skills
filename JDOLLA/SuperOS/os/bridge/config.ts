// Loads and validates os/config/os.config.json and os/.env. Every external input goes through zod.
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const LayoutItemSchema = z.object({
  widget: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  span: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
export const LayoutSchema = z.array(LayoutItemSchema).max(40);

export const ConfigSchema = z.object({
  owner: z.string().min(1).max(80),
  brand: z.string().min(1).max(80),
  timezones: z.array(z.string().min(1).max(64)).min(1).max(6),
  engine: z.object({
    t2: z.object({ model: z.string(), effort: z.string(), maxBudgetUsd: z.number().positive().max(5).default(0.05) }),
    t3: z.object({ model: z.string(), effort: z.string(), permissionMode: z.string(), maxBudgetUsd: z.number().positive().max(100) }),
    /** Scheduled routines: total spend per day (owner's time zone) and the most one routine run may cost. */
    routines: z.object({ dailyCapUsd: z.number().positive().max(100), maxBudgetUsd: z.number().positive().max(100) }).default({ dailyCapUsd: 1, maxBudgetUsd: 1 }),
    /** Optional path to the Claude Code CLI. Default: "claude" ("claude.exe" on Windows), found on PATH. */
    claudeBin: z.string().min(1).max(260).optional(),
  }),
  artifactRoots: z.array(z.string().regex(/^[a-z][a-z0-9_-]*$/)).max(10),
  pinnedSkills: z.array(z.string()).max(50),
  layout: LayoutSchema,
});
export type OsConfig = z.infer<typeof ConfigSchema>;

export type Paths = { vault: string; os: string; config: string; cache: string };

export function pathsFor(osDir: string): Paths {
  const os = path.resolve(osDir);
  return { vault: path.dirname(os), os, config: path.join(os, "config", "os.config.json"), cache: path.join(os, ".cache") };
}

export function loadConfig(p: Paths): OsConfig {
  return ConfigSchema.parse(JSON.parse(readFileSync(p.config, "utf8")));
}

/** Write via a temp file and rename, so a crash never leaves half a config. */
export function saveConfig(p: Paths, config: OsConfig): void {
  const tmp = p.config + ".tmp";
  writeFileSync(tmp, JSON.stringify(ConfigSchema.parse(config), null, 2) + "\n");
  renameSync(tmp, p.config);
}

const EnvSchema = z.object({
  SUPEROS_PORT: z.coerce.number().int().min(1024).max(65535).default(4317),
  SUPEROS_SCHEDULER: z.enum(["on", "off"]).default("on"),
  SUPEROS_VOICE: z.enum(["on", "off"]).default("off"),
});
export type OsEnv = z.infer<typeof EnvSchema>;

/** Reads os/.env if present (the server's own settings file), then the process environment. */
export function loadEnv(p: Paths, base: NodeJS.ProcessEnv = process.env): OsEnv {
  const fromFile: Record<string, string> = {};
  const file = path.join(p.os, ".env");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^([A-Z][A-Z0-9_]{0,63})=(.*)$/.exec(line.trim());
      if (m?.[1] !== undefined && m[2] !== undefined) fromFile[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  const pick = (k: string) => base[k] ?? fromFile[k] ?? undefined;
  return EnvSchema.parse({
    SUPEROS_PORT: pick("SUPEROS_PORT") || undefined,
    SUPEROS_SCHEDULER: pick("SUPEROS_SCHEDULER") || undefined,
    SUPEROS_VOICE: pick("SUPEROS_VOICE") || undefined,
  });
}

/** Windows: %LOCALAPPDATA%\JDOLLA\logs. Elsewhere: <vault>/logs (git-ignored). */
export function logDir(p: Paths, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string {
  if (platform === "win32" && env["LOCALAPPDATA"]) return path.join(env["LOCALAPPDATA"], "JDOLLA", "logs");
  return path.join(p.vault, "logs");
}
