// Numeric pose fitting for a split-screen remake (instead of tuning by eye).
//   camera: node scripts/fit.mjs camera SIM_DIR REF.mp4 SIDE --times 0,0.5,1 [--out SIM_DIR/cam_fix.json] [--evals 220]
//           [--keys d,az,el,yaw,pitch,roll] [--lambda 25]: --lambda penalises moving away from the previous
//           sample, so a model that differs from the reference cannot make the camera jump between look-alike poses.
//           per sample time, Nelder-Mead over the camera deltas (d az el yaw pitch roll ox oy) that minimise the
//           difference between the panel's 3D render and the reference panel (grey, blurred, HUD boxes masked).
//           Rows go into cam_fix.json under SIDE; rows outside the fitted range are kept.
//   ship:   node scripts/fit.mjs ship SIM_DIR REF.mp4 SIDE --times 2,9.5
//           one pose for the camera-attached ship (x y z pitch yaw roll), fitted over all the given times at once.
//           Prints the pose to paste into STYLES[SIDE].ship in world.js. --sym keeps yaw and roll at 0 (a ship
//           seen straight from behind): without it the fit may turn the ship to hide a model mismatch.
// The sim must expose window.FILM = {panels, fittedCam, draw3d, PANEL} (see sims/ring-run/main.js).
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL, fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEARDOWN = process.env.TEARDOWN || path.join(HERE, '../../teardown');
const {playwright, CHROMIUM, CHROMIUM_ARGS, DIST} = await import(pathToFileURL(path.join(TEARDOWN, 'paths.mjs')).href);

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const [MODE, SIMDIR, REF, SIDE] = args;
if (!SIDE) {
  console.error('usage: fit.mjs camera|ship SIM_DIR REF.mp4 A|B --times t1,t2,...');
  process.exit(2);
}
const SIM = path.basename(path.resolve(SIMDIR));
const W = Number(opt('width', 300));
const EVALS = Number(opt('evals', MODE === 'ship' ? 300 : 220));
const PANEL_XY = {A: [30, 100], B: [946, 100]};
const PN = 900;
const times = opt('times', '0').split(',').map(Number);
const OUTF = opt('out', path.join(SIMDIR, 'cam_fix.json'));

execFileSync('node', [path.join(TEARDOWN, 'sims/build.mjs'), path.resolve(SIMDIR)], {stdio: 'ignore'});
const html = path.join(DIST, `${SIM}.html`);
const refGray = (t) => {
  const [x, y] = PANEL_XY[SIDE];
  return execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', REF, '-frames:v', '1', '-vf', `crop=${PN}:${PN}:${x}:${y},scale=${W}:${W},format=gray`, '-f', 'rawvideo', '-'], {maxBuffer: 1 << 26}).toString('base64');
};

const browser = await playwright().chromium.launch({executablePath: CHROMIUM, args: CHROMIUM_ARGS});
const page = await browser.newPage({viewport: {width: 1876, height: 1030}, deviceScaleFactor: 1});
page.on('pageerror', (e) => console.error('[page error]', e.message));
await page.goto(pathToFileURL(html).href + '?capture');
await page.waitForFunction(() => window.SIM && window.SIM.ready && window.FILM, null, {timeout: 600000});

await page.evaluate(([W, SIDE, PN]) => {
  const F = window.FILM;
  const P = F.panels[SIDE];
  P.renderer.setSize(W, W, false);
  F.P = P;
  const c = document.createElement('canvas');
  c.width = c.height = W;
  F.cx = c.getContext('2d', {willReadFrequently: true});
  // mask: HUD boxes, keys, radar, banners (opaque UI in both films)
  const mask = new Uint8Array(W * W).fill(1);
  const root = document.querySelector(`.p${SIDE}`).getBoundingClientRect();
  const s = W / PN;
  for (const el of document.querySelectorAll(`#h${SIDE} .box, #h${SIDE} .keys, #h${SIDE} .radar, #h${SIDE} .rlab, #h${SIDE} .banner`)) {
    const r = el.getBoundingClientRect();
    for (let y = Math.max(0, Math.floor((r.top - root.top) * s) - 2); y < Math.min(W, Math.ceil((r.bottom - root.top) * s) + 2); y++)
      for (let x = Math.max(0, Math.floor((r.left - root.left) * s) - 2); x < Math.min(W, Math.ceil((r.right - root.left) * s) + 2); x++) mask[y * W + x] = 0;
  }
  F.mask = mask;
  F.gray = (src, isGray) => {
    const cx = F.cx;
    cx.filter = 'blur(1.5px)';
    cx.clearRect(0, 0, W, W);
    cx.drawImage(src, 0, 0, W, W);
    cx.filter = 'none';
    const d = cx.getImageData(0, 0, W, W).data;
    const g = new Float32Array(W * W);
    for (let i = 0; i < W * W; i++) g[i] = isGray ? d[i * 4] : 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    return g;
  };
  F.refs = {};
  F.setRef = (t, b64) => {
    const raw = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const c2 = document.createElement('canvas');
    c2.width = c2.height = W;
    const x2 = c2.getContext('2d');
    const im = x2.createImageData(W, W);
    for (let i = 0; i < W * W; i++) im.data.set([raw[i], raw[i], raw[i], 255], i * 4);
    x2.putImageData(im, 0, 0);
    F.refs[t] = F.gray(c2, true);
  };
  F.loss = (t, cam) => {
    F.draw3d(SIDE, t, cam);
    const g = F.gray(F.P.renderer.domElement, false);
    const ref = F.refs[t];
    let sum = 0;
    let n = 0;
    for (let i = 0; i < g.length; i++)
      if (F.mask[i]) {
        const e = g[i] - ref[i];
        sum += e * e;
        n++;
      }
    return sum / n;
  };
  F.ship0 = {p: P.ship.position.clone(), r: P.ship.rotation.clone()};
  F.setShip = (x) => {
    if (F.sym) { x = x.slice(); x[4] = 0; x[5] = 0; }
    P.ship.position.set(F.ship0.p.x + x[0] * 0.3, F.ship0.p.y + x[1] * 0.3, F.ship0.p.z + x[2] * 0.6);
    P.ship.rotation.set(F.ship0.r.x + x[3] * 0.02, F.ship0.r.y + x[4] * 0.02, F.ship0.r.z + x[5] * 0.02);
  };
}, [W, SIDE, PN]);

for (const t of times) await page.evaluate(([t, b]) => window.FILM.setRef(t, b), [t, refGray(t)]);

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
    } else if (fr < vals[n - 1]) [simplex[n], vals[n]] = [xr, fr];
    else {
      const xc = fr < vals[n] ? at(-0.5) : at(0.5);
      const fc = await f(xc);
      evals++;
      if (fc < Math.min(fr, vals[n])) [simplex[n], vals[n]] = [xc, fc];
      else
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          vals[i] = await f(simplex[i]);
          evals++;
        }
    }
  }
  const b = vals.indexOf(Math.min(...vals));
  return {x: simplex[b], v: vals[b], evals};
}

if (MODE === 'ship') {
  if (args.includes('--sym')) await page.evaluate(() => { window.FILM.sym = true; });
  const f = (x) => page.evaluate(([x, times, SIDE]) => {
    const F = window.FILM;
    F.setShip(x);
    let s = 0;
    for (const t of times) s += F.loss(t, F.fittedCam(SIDE, t));
    return s / times.length;
  }, [x, times, SIDE]);
  const x0 = Array(6).fill(0);
  const before = await f(x0);
  const r = await nelderMead(f, x0, EVALS);
  const pose = await page.evaluate((x) => {
    const F = window.FILM;
    F.setShip(x);
    const p = F.P.ship.position;
    const q = F.P.ship.rotation;
    const d = (v) => Math.round((v * 180) / Math.PI * 100) / 100;
    return `pos: [${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}], rot: [deg(${d(q.x)}), deg(${d(q.y)}), deg(${d(q.z)})]`;
  }, r.x);
  console.log(`ship ${SIDE}: mse ${before.toFixed(1)} → ${r.v.toFixed(1)} (${r.evals} evals)\n  ${pose}`);
} else {
  const KEYS = (opt('keys', 'd,az,el,yaw,pitch,roll')).split(',');
  const SCALE = {d: 30, az: 1.5, el: 1.5, yaw: 0.6, pitch: 0.6, roll: 1.5, ox: 15, oy: 15};
  // smoothness: each unit (in SCALE steps) away from the previous sample costs LAMBDA (mse units)
  const LAMBDA = Number(opt('lambda', 25));
  const all = fs.existsSync(OUTF) ? JSON.parse(fs.readFileSync(OUTF, 'utf8')) : {A: [], B: []};
  const lo = Math.min(...times);
  const hi = Math.max(...times);
  let table = (all[SIDE] || []).filter(([t]) => t < lo - 1e-9 || t > hi + 1e-9);
  // the scripted camera (fitted table excluded inside the range) is the base
  await page.evaluate(() => { window.FILM.baseCam = window.FILM.camAt; });
  let warm = Array(KEYS.length).fill(0);
  for (const t of times) {
    const base = await page.evaluate(([SIDE, t]) => window.FILM.camAt(SIDE, t), [SIDE, t]);
    const cam = (x) => {
      const c = {...base};
      KEYS.forEach((k, i) => (c[k] = (base[k] ?? 0) + x[i] * SCALE[k]));
      return c;
    };
    const prior = warm.slice();
    const pen = (x) => LAMBDA * x.reduce((a, v, i) => a + (v - prior[i]) ** 2, 0);
    const raw = (x) => page.evaluate(([t, c]) => window.FILM.loss(t, c), [t, cam(x)]);
    const f = async (x) => (await raw(x)) + pen(x);
    const T0 = Date.now();
    const before = await f(Array(KEYS.length).fill(0));
    const fromWarm = await f(warm);
    const start = fromWarm < before ? warm : Array(KEYS.length).fill(0);
    const r = await nelderMead(f, start, EVALS);
    const best = r.v < Math.min(before, fromWarm) ? r.x : start;
    warm = best;
    const delta = {};
    KEYS.forEach((k, i) => (delta[k] = Math.round(best[i] * SCALE[k] * 1e4) / 1e4));
    table.push([t, delta]);
    table.sort((a, b) => a[0] - b[0]);
    all[SIDE] = table;
    fs.writeFileSync(OUTF, JSON.stringify(all).replace(/\],\[/g, '],\n['));
    console.log(`${SIDE} t=${t} ${((Date.now() - T0) / 1000).toFixed(0)}s mse ${before.toFixed(1)} → ${Math.min(r.v, before).toFixed(1)}`, JSON.stringify(delta));
  }
}
await browser.close();
