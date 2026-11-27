// Test stand-in for Blender (bridge/blender-check.ts). Run as: node fake-blender.ts <mode> <Blender's own arguments...>.
// Like the real one, `--version` prints "Blender X.Y.Z"; `--python <file>` runs a script: assert_false.py exits 1 (as
// Blender does with --python-exit-code 1), check.py prints one BLENDERCHECK line and writes a real render.png and
// cube.glb into the folder after "--". Modes: ok, noexit (a failing script exits 0), cube3 (a 3 × 3 × 3 cube), flat (a
// one-colour render), hang (the check never ends), old (3.6.5), mismatch (--version 4.0.2, bpy 4.1.0).
import { writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const [mode = "ok", ...args] = process.argv.slice(2);
const said = mode === "old" ? "3.6.5" : "4.0.2";
const bpyVersion = mode === "old" ? [3, 6, 5] : mode === "mismatch" ? [4, 1, 0] : [4, 0, 2];

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A 64 × 64 RGBA PNG: a gradient, or one flat colour. Rows use filter 1 (Sub) and 2 (Up) to exercise the decoder. */
function png(flat: boolean): Buffer {
  const w = 64, h = 64, rows: Buffer[] = [];
  let prev = Buffer.alloc(w * 4);
  for (let y = 0; y < h; y++) {
    const px = Buffer.alloc(w * 4);
    for (let x = 0; x < w; x++) px.set(flat ? [40, 40, 40, 255] : [x * 4, y * 4, 128, 255], x * 4);
    const f = y % 2;
    const enc = Buffer.alloc(w * 4);
    for (let i = 0; i < px.length; i++) enc[i] = (px[i]! - (f === 1 ? (i >= 4 ? px[i - 4]! : 0) : prev[i]!)) & 0xff;
    rows.push(Buffer.from([f === 1 ? 1 : 2]), enc);
    prev = px;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
function glb(half: number): Buffer {
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ count: 24, type: "VEC3", componentType: 5126, min: [-half, -half, -half], max: [half, half, half] }] }));
  const pad = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(20);
  head.write("glTF", 0, "ascii"); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + pad.length, 8); head.writeUInt32LE(pad.length, 12); head.write("JSON", 16, "ascii");
  return Buffer.concat([head, pad]);
}

if (args.includes("--version")) {
  process.stdout.write(`Blender ${said}\n\tbuild date: 2023-12-05\n`);
  process.exit(0);
}
const script = args[args.indexOf("--python") + 1] ?? "";
if (path.basename(script) === "assert_false.py") {
  process.stderr.write("AssertionError: exit-code control\n");
  process.exit(mode === "noexit" ? 0 : 1);
}
if (path.basename(script) === "check.py") {
  if (mode === "hang") setInterval(() => undefined, 1000);
  else {
    const out = args[args.indexOf("--") + 1]!;
    const side = mode === "cube3" ? 3 : 2;
    writeFileSync(path.join(out, "render.png"), png(mode === "flat"));
    writeFileSync(path.join(out, "cube.glb"), glb(side / 2));
    process.stdout.write(`Blender ${said}\nBLENDERCHECK:${JSON.stringify({ version: bpyVersion, dims: [side, side, side], meshVertices: 8, eevee: "BLENDER_EEVEE" })}\n`);
    process.exit(0);
  }
} else {
  process.stderr.write(`fake-blender: unexpected arguments ${JSON.stringify(args)}\n`);
  process.exit(3);
}
