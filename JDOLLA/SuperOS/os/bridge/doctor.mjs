// Plain JavaScript on purpose: it must run on a Node too old to load the TypeScript doctor, and before
// `npm install`, so it can say what is wrong instead of crashing. Then it hands over to doctor-cli.ts.
import { createRequire } from "node:module";

const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 22 || (maj === 22 && min < 18)) {
  console.log(`  FAIL  Node.js  ${process.version} is older than 22.18\n        → PC-SETUP §1: install the current LTS from nodejs.org, then open a new window`);
  process.exit(1);
}
try {
  createRequire(import.meta.url).resolve("zod");
} catch {
  console.log("  FAIL  Packages  not installed in os/\n        → PC-SETUP §3: run `npm install` in os/, then `npm run doctor` again");
  process.exit(1);
}
const { main, defaultDeps } = await import("./doctor-cli.ts");
const osDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
process.exitCode = await main(process.argv.slice(2), defaultDeps(decodeURIComponent(osDir)));
