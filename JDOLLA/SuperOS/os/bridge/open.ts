// `npm run open`: mints a 24-hour session and opens the dashboard in the default browser.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOrCreateSecret, mintToken } from "./auth.ts";
import { loadEnv, pathsFor } from "./config.ts";

const paths = pathsFor(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const env = loadEnv(paths);
const base = `http://127.0.0.1:${env.SUPEROS_PORT}`;

try {
  const r = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2000) });
  if (!r.ok) throw new Error(String(r.status));
} catch {
  console.error(`The bridge is not running on ${base}. Start it first in another window: npm start`);
  process.exit(1);
}

// The URL holds only digits, dots and base64url characters. No shell is used to open it.
const url = `${base}/?t=${mintToken(loadOrCreateSecret(paths))}`;
const [cmd, args] = process.platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
  : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
const child = spawn(cmd as string, args as string[], { detached: true, stdio: "ignore", shell: false });
child.on("error", () => console.log(`Could not open a browser. Paste this into your browser (valid 24 hours):\n${url}`));
child.unref();
console.log("Opening the dashboard in your browser.");
