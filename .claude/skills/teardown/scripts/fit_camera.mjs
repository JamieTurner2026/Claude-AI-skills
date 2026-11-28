// Fit the film camera to a reference video, numerically, instead of by eye.
// For each sample time it renders only the 3D stage (small, fast), compares it with the reference frame
// (grey, blurred, UI panels masked out) and runs Nelder-Mead over tx ty tz az el d sx sy.
// Writes the corrections as [t, {delta}] rows that the film adds to its scripted camera (camFix in film_post.js).
//
//   node scripts/fit_camera.mjs SIM REF.mp4 OUT.json --from 0 --to 26 --every 0.5 [--width 480] [--evals 160] [--full-quality]
//   (needs the sim to expose window.FILM = {camAt, fittedCam, draw3d, stage, canvas}; see sims/v8-shared/film_post.js)
// Rows already in OUT.json outside the fitted range are kept. Rebuild the sim afterwards.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {playwright, CHROMIUM, CHROMIUM_ARGS, FFMPEG, DIST} from '../paths.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const [SIM, REF, OUTF] = args;
if (!OUTF) {
  console.error('usage: fit_camera.mjs SIM REF.mp4 OUT.json --from A --to B --every S');
  process.exit(2);
}
const W = Number(opt('width', 480));
const H = Math.round((W * 9) / 16);
const EVALS = Number(opt('evals', 160));
const step = Number(opt('every', 0.5));
const from = Number(opt('from', 0));
const to = Number(opt('to', 26));
const times = opt('times') ? opt('times').split(',').map(Number) : [];
if (!times.length) for (let t = from; t <= to + 1e-9; t += step) times.push(Math.round(t * 1000) / 1000);
const KEYS = ['tx', 'ty', 'tz', 'az', 'el', 'd', 'sx', 'sy'];
const SCALE = {tx: 0.02, ty: 0.02, tz: 0.02, az: 1.5, el: 1.5, d: 0.05, sx: 10, sy: 10};

const SKILL = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
execFileSync('node', [path.join(SKILL, 'sims/build.mjs'), SIM], {stdio: 'ignore'});
const html = path.join(DIST, `${SIM}.html`);

const refGray = (t) =>
  execFileSync(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', REF, '-frames:v', '1', '-vf', `scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], {
    maxBuffer: 1 << 26,
  }).toString('base64');

const browser = await playwright().chromium.launch({executablePath: CHROMIUM, args: CHROMIUM_ARGS});
const page = await browser.newPage({viewport: {width: 1600, height: 900}, deviceScaleFactor: 1});
page.on('pageerror', (e) => console.error('[page error]', e.message));
await page.goto(pathToFileURL(html).href + '?capture');
await page.waitForFunction(() => window.SIM && window.SIM.ready && window.FILM, null, {timeout: Number(process.env.READY_TIMEOUT || 600000)});

// small stage, a 2D canvas for readback, and a mask of the opaque UI panels
await page.evaluate(([W, H, FULL]) => {
  const F = window.FILM;
  F.stage.resize(1600, 900, W / 1600);
  // pose is what is being fitted, not shading: drop AO and MSAA and shrink the shadow map (about 10x faster)
  if (!FULL) F.stage.setQuality?.({samples: 0, ao: false, shadow: 1024});
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  F.cx = c.getContext('2d', {willReadFrequently: true});
  const mask = new Uint8Array(W * H).fill(1);
  for (const el of document.querySelectorAll('#app *')) {
    if (el === F.canvas) continue;
    const cs = getComputedStyle(el);
    const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
    const a = m ? (m[1].split(',')[3] ?? 1) : 0;
    const r = el.getBoundingClientRect();
    if (Number(a) < 0.5 || r.width < 40 || r.height < 20) continue;
    const s = W / 1600;
    for (let y = Math.max(0, Math.floor(r.top * s)); y < Math.min(H, Math.ceil(r.bottom * s)); y++)
      for (let x = Math.max(0, Math.floor(r.left * s)); x < Math.min(W, Math.ceil(r.right * s)); x++) mask[y * W + x] = 0;
  }
  F.mask = mask;
  F.gray = (src, isGray) => {
    // blur 1.5 px, return grey
    const cx = F.cx;
    cx.filter = 'blur(1.5px)';
    cx.clearRect(0, 0, W, H);
    cx.drawImage(src, 0, 0, W, H);
    cx.filter = 'none';
    const d = cx.getImageData(0, 0, W, H).data;
    const g = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = isGray ? d[i * 4] : 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    return g;
  };
  F.setRef = (b64) => {
    const raw = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const c2 = document.createElement('canvas');
    c2.width = W;
    c2.height = H;
    const x2 = c2.getContext('2d');
    const im = x2.createImageData(W, H);
    for (let i = 0; i < W * H; i++) im.data.set([raw[i], raw[i], raw[i], 255], i * 4);
    x2.putImageData(im, 0, 0);
    F.ref = F.gray(c2, true);
  };
  F.loss = (t, c) => {
    F.draw3d(t, c);
    const g = F.gray(F.canvas, false);
    let s = 0;
    let n = 0;
    for (let i = 0; i < g.length; i++)
      if (F.mask[i]) {
        const e = g[i] - F.ref[i];
        s += e * e;
        n++;
      }
    return s / n;
  };
}, [W, H, args.includes('--full-quality')]);

const loss = (t, c) => page.evaluate(([t, c]) => window.FILM.loss(t, c), [t, c]);

async function nelderMead(f, x0, maxEvals) {
  const n = x0.length;
  let simplex = [x0];
  for (let i = 0; i < n; i++) {
    const x = x0.slice();
    x[i] += 1;
    simplex.push(x);
  }
  let vals = [];
  for (const x of simplex) vals.push(await f(x));
  let evals = n + 1;
  while (evals < maxEvals) {
    const ord = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    simplex = ord.map((i) => simplex[i]);
    vals = ord.map((i) => vals[i]);
    if (vals[n] - vals[0] < 1e-3 * Math.max(1, vals[0])) break;
    const cen = Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cen[j] += simplex[i][j] / n;
    const at = (k) => cen.map((c, j) => c + k * (simplex[n][j] - c));
    const xr = at(-1);
    const fr = await f(xr);
    evals++;
    if (fr < vals[0]) {
      const xe = at(-2);
      const fe = await f(xe);
      evals++;
      [simplex[n], vals[n]] = fe < fr ? [xe, fe] : [xr, fr];
    } else if (fr < vals[n - 1]) {
      [simplex[n], vals[n]] = [xr, fr];
    } else {
      const xc = fr < vals[n] ? at(-0.5) : at(0.5);
      const fc = await f(xc);
      evals++;
      if (fc < Math.min(fr, vals[n])) [simplex[n], vals[n]] = [xc, fc];
      else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          vals[i] = await f(simplex[i]);
          evals++;
        }
      }
    }
  }
  const b = vals.indexOf(Math.min(...vals));
  return {x: simplex[b], v: vals[b], evals};
}

let table = fs.existsSync(OUTF) ? JSON.parse(fs.readFileSync(OUTF, 'utf8')) : [];
const lo = Math.min(...times);
const hi = Math.max(...times);
table = table.filter(([t]) => t < lo - 1e-9 || t > hi + 1e-9);
let warm = Array(KEYS.length).fill(0); // carry the last delta (in scale units) into the next sample
for (const t of times) {
  await page.evaluate((b) => window.FILM.setRef(b), refGray(t));
  const base = await page.evaluate((t) => window.FILM.camAt(t), t);
  const cam = (x) => {
    const c = {...base};
    KEYS.forEach((k, i) => (c[k] = (base[k] ?? 0) + x[i] * SCALE[k]));
    return c;
  };
  const f = (x) => loss(t, cam(x));
  const T0 = Date.now();
  const before = await f(Array(KEYS.length).fill(0));
  const fromWarm = await f(warm);
  const start = fromWarm < before ? warm : Array(KEYS.length).fill(0);
  const r = await nelderMead(f, start, EVALS);
  const best = r.v < before ? r.x : Array(KEYS.length).fill(0);
  warm = best;
  const delta = {};
  KEYS.forEach((k, i) => (delta[k] = Math.round(best[i] * SCALE[k] * 1e4) / 1e4));
  table.push([t, delta]);
  table.sort((a, b) => a[0] - b[0]);
  fs.writeFileSync(OUTF, JSON.stringify(table, null, 0).replace(/\],\[/g, '],\n['));
  console.log(`t=${t} ${((Date.now() - T0) / 1000).toFixed(0)}s mse ${before.toFixed(1)} → ${Math.min(r.v, before).toFixed(1)} (${r.evals} evals)`, JSON.stringify(delta));
}
await browser.close();
