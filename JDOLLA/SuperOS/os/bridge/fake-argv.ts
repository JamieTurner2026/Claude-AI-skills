// Reads back the command line the fake Claude CLI (bridge/fake-claude.ts) was started with.
// The fake writes its arguments to a file and names that file in its output ("ARGVFILE:<path>"). Tests used to parse the
// arguments out of RunInfo.output itself, but that keeps only the last 4000 characters, so a longer command line (a longer
// hint, a bigger prompt) silently pushed it out of the window. A file does not depend on how long anything is.
import { readFileSync } from "node:fs";

export function argvFromOutput(output: string): string[] {
  const file = /ARGVFILE:(.+)/.exec(output)?.[1]?.trim();
  if (!file) throw new Error("The run output has no ARGVFILE line (is it a fake-claude run, and did it start?)");
  return JSON.parse(readFileSync(file, "utf8")) as string[];
}
