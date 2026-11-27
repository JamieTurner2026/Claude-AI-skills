// Voxel ship-in-a-bottle scene, two looks: style "A" (Lantern Strait) and "B" (The Bottled Sea).
// Time is driven externally through renderAt(t) so frames render deterministically.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ---------- deterministic helpers ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const s = (t) => t * t * (3 - 2 * t);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, s(xf)), THREE.MathUtils.lerp(c, d, s(xf)), s(yf));
}
const C = (hex) => new THREE.Color(hex);

// ---------- voxel builder ----------
class Vox {
  constructor(size) { this.s = size; this.map = new Map(); }
  key(i, j, k) { return `${i},${j},${k}`; }
  set(i, j, k, color) { this.map.set(this.key(i, j, k), [i, j, k, color]); }
  has(i, j, k) { return this.map.has(this.key(i, j, k)); }
  build(material, { jitter = 0.06, cull = true, castShadow = true } = {}) {
    const list = [];
    for (const v of this.map.values()) {
      const [i, j, k] = v;
      if (cull && this.has(i + 1, j, k) && this.has(i - 1, j, k) && this.has(i, j + 1, k) &&
          this.has(i, j - 1, k) && this.has(i, j, k + 1) && this.has(i, j, k - 1)) continue;
      list.push(v);
    }
    const geo = new THREE.BoxGeometry(this.s, this.s, this.s);
    const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, list.length));
    const m = new THREE.Matrix4(), col = new THREE.Color();
    list.forEach(([i, j, k, c], n) => {
      m.makeTranslation(i * this.s, j * this.s, k * this.s);
      mesh.setMatrixAt(n, m);
      const f = 1 + (hash2(i * 7 + k, j * 13 - k, 3) - 0.5) * 2 * jitter;
      col.copy(c).multiplyScalar(f);
      mesh.setColorAt(n, col);
    });
    mesh.count = list.length;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    return mesh;
  }
}

// ---------- palettes ----------
const PAL = {
  A: {
    hull: C('#211b18'), stripe: C('#d6a04a'), port: C('#0d0b0a'), rail: C('#6b4128'), deck: C('#a87447'),
    sailA: C('#b9442f'), sailB: C('#ead9b4'), emblem: C('#f2e6c8'), mast: C('#4a2e1d'),
    water: C('#06663f'), waterTop: C('#149457'), foam: C('#eafff2'),
    glass: C('#bfeef0'), cork: C('#c9925a'), corkDark: C('#9c6a3c'), stand: C('#7a3b22'),
  },
  B: {
    hull: C('#b4652d'), stripe: C('#6e3a1b'), port: C('#3a1f10'), rail: C('#d89a5c'), deck: C('#c98a52'),
    sailA: C('#ecdfbf'), sailB: C('#e2d2ab'), emblem: C('#a83a2a'), mast: C('#5a361f'),
    water: C('#065a3e'), waterTop: C('#138a54'), foam: C('#e2fff0'),
    glass: C('#a9e3e6'), cork: C('#c79458'), corkDark: C('#8f6136'), stand: C('#6a3a24'),
  },
};

// ---------- bottle geometry ----------
const R = 1.9;            // body radius
const BODY0 = -4.6, BODY1 = 2.9; // body x range
const NECK_R = 0.62, NECK0 = 4.05, NECK1 = 5.0;
const WATER_Y = 0.12;

function bottleProfile(scale = 1, inset = 0) {
  // returns Vector2(r, x) points; lathe around Y then rotate so Y->X
  const pts = [];
  const r = R * scale - inset;
  const corner = 0.55;
  pts.push(new THREE.Vector2(0.001, BODY0));
  for (let a = 0; a <= 8; a++) {
    const t = (a / 8) * Math.PI / 2;
    pts.push(new THREE.Vector2((r - corner) + Math.sin(t) * corner, BODY0 + corner - Math.cos(t) * corner));
  }
  pts.push(new THREE.Vector2(r, BODY1));
  for (let a = 1; a <= 14; a++) {
    const t = a / 14;
    const e = 0.5 - 0.5 * Math.cos(Math.PI * t);
    pts.push(new THREE.Vector2(THREE.MathUtils.lerp(r, NECK_R - inset, e), THREE.MathUtils.lerp(BODY1, NECK0, t)));
  }
  pts.push(new THREE.Vector2(NECK_R - inset, NECK1));
  return pts;
}
function latheX(pts, segs = 96) {
  const g = new THREE.LatheGeometry(pts, segs);
  g.rotateZ(-Math.PI / 2); // lathe axis Y -> X
  return g;
}

// inner radius at x for clipping content to the bottle
function innerRadius(x) {
  const r = R - 0.08;
  if (x < BODY0 + 0.55) {
    const dx = (BODY0 + 0.55) - x;
    if (dx > 0.55) return 0;
    return (r - 0.55) + Math.sqrt(Math.max(0, 0.55 * 0.55 - dx * dx));
  }
  if (x <= BODY1) return r;
  if (x <= NECK0) {
    const t = (x - BODY1) / (NECK0 - BODY1);
    return THREE.MathUtils.lerp(r, NECK_R - 0.08, 0.5 - 0.5 * Math.cos(Math.PI * t));
  }
  return NECK_R - 0.08;
}

// ---------- models ----------
function buildShip(style) {
  const P = PAL[style];
  const v = new Vox(0.064);
  const L = 27; // half length in voxels
  const DECK = 12;
  const halfW = (x) => {
    let w = 7;
    if (x > 9) w = 7 * Math.pow(Math.max(0, (L + 2 - x) / (L + 2 - 9)), 0.7);
    if (x < -21) w = 7 - (-21 - x) * 0.4;
    return w;
  };
  for (let x = -L; x <= L; x++) {
    const bottom = Math.max(0, Math.round((Math.abs(x) - 18) * 0.6));
    const top = x < -16 ? DECK + 5 : x > 17 ? DECK + 2 : DECK;
    for (let y = bottom; y <= top; y++) {
      const wy = halfW(x) * (0.5 + 0.5 * Math.min(1, (y - bottom + 1) / 6));
      const W = Math.max(1, Math.round(wy));
      for (let z = -W; z <= W; z++) {
        const edge = Math.abs(z) >= W - 1;
        const shell = edge || y === bottom || y === top || (y === DECK && x >= -16 && x <= 17);
        if (!shell) continue;
        let c = P.hull;
        if (style === 'A') {
          if (y === 3 || y === 7) c = P.stripe;
          if ((y === 5 || y === 9) && edge) c = x % 3 === 0 ? P.port : P.stripe;
          if (y >= DECK) c = P.rail;
        } else {
          if (y === 3 || y === 6 || y === 9) c = P.stripe;
          if ((y === 5 || y === 8) && x % 3 === 0 && edge) c = P.port;
          if (y >= DECK - 1) c = P.rail;
        }
        if (y === top && !edge) c = P.deck;
        if (y === DECK && !edge) c = P.deck;
        v.set(x, y, z, c);
      }
    }
  }
  // stern windows
  for (let y = DECK + 1; y <= DECK + 4; y += 2) for (let z = -4; z <= 4; z += 2) v.set(-L - 1, y, z, style === 'A' ? P.stripe : C('#f0d27a'));
  // bowsprit
  for (let i = 0; i < 13; i++) v.set(L + i, DECK + 2 + Math.round(i * 0.45), 0, P.mast);

  const masts = [{ x: -14, h: 29 }, { x: 0, h: 32 }, { x: 14, h: 29 }];
  const S0 = DECK + 2;
  masts.forEach((m, mi) => {
    for (let y = DECK; y <= m.h; y++) { v.set(m.x, y, 0, P.mast); v.set(m.x, y, 1, P.mast); }
    const sp = m.h - 1 - S0;
    const cut = [0, Math.round(sp * 0.45), Math.round(sp * 0.78), sp];
    const hws = [7, 6, 4.5];
    for (let ti = 0; ti < 3; ti++) {
      const ya = S0 + cut[ti] + (ti ? 2 : 0), yb = S0 + cut[ti + 1], hw = hws[ti];
      if (yb - ya < 2) continue;
      for (let dx = -Math.round(hw) - 1; dx <= Math.round(hw) + 1; dx++) v.set(m.x + dx, yb + 1, 1, P.mast);
      const cy = Math.round((ya + yb) / 2);
      for (let y = ya; y <= yb; y++) {
        for (let dx = -Math.round(hw); dx <= Math.round(hw); dx++) {
          const u = dx / hw, w = (y - ya) / (yb - ya);
          const bil = Math.round(2.6 * (1 - u * u) * Math.sin(Math.PI * (0.2 + 0.8 * (1 - w))));
          let c;
          if (style === 'A') {
            c = (ti + mi) % 2 === 0 ? P.sailA : P.sailB;
            if (ti === 0 && ((Math.abs(dx) <= 1 && Math.abs(y - cy) <= 2) || (y === cy && Math.abs(dx) <= 3))) c = c === P.sailA ? P.emblem : P.sailA;
          } else {
            c = (dx * 3 + y) % 5 === 0 ? P.sailB : P.sailA;
            if (mi === 1 && ti === 0 && ((Math.abs(dx) <= 0 && Math.abs(y - cy) <= 2) || (y === cy && Math.abs(dx) <= 2))) c = P.emblem;
          }
          // cloth shading: bright belly, darker edges and bolt-rope, faint horizontal seams
          let shade = 0.84 + 0.2 * (1 - u * u) * Math.sin(Math.PI * (0.15 + 0.85 * (1 - w)));
          if (Math.abs(dx) === Math.round(hw) || y === ya || y === yb) shade *= 0.86;
          if ((y - ya) % 3 === 2) shade *= 0.95;
          const sc = c.clone().multiplyScalar(shade);
          v.set(m.x + dx, y, 2 + bil, sc);
          if (bil > 0) v.set(m.x + dx, y, 1 + bil, sc.clone().multiplyScalar(0.9));
        }
      }
    }
    const pc = style === 'A' ? C('#c23a2a') : C('#b63b2b');
    for (let i = 1; i <= 5; i++) for (let j = 0; j < Math.max(1, 3 - Math.floor(i / 2)); j++) v.set(m.x + i, m.h + 1 + j, 0, pc);
  });
  // jibs and spanker on a half-size grid: smoother diagonal edges than the hull grid
  const fv = new Vox(v.s / 2);
  const jibC = style === 'A' ? P.sailB : P.sailA;
  const jibs = [[19, 2 * S0, 56, L + 11], [17, 2 * S0 + 4, 48, L + 6]];
  jibs.forEach(([x0, y0, y1, xTip], ji) => {
    for (let y = y0; y <= y1; y++) {
      const t = (y - y0) / (y1 - y0);
      const xe = 2 * x0 + (2 * xTip - 2 * x0) * (1 - t);
      for (let x = 2 * x0 + 2; x <= xe; x++) {
        const edge = x >= xe - 1 || y === y0;
        const belly = Math.sin(Math.PI * Math.min(1, (x - 2 * x0) / Math.max(1, xe - 2 * x0)));
        fv.set(x, y, 5 + ji * 3 + Math.round(belly * 2), jibC.clone().multiplyScalar(edge ? 0.82 : 0.9 + 0.12 * belly));
      }
    }
  });
  for (let y = 2 * S0; y <= 48; y++) {
    const t = (y - 2 * S0) / (48 - 2 * S0);
    for (let x = -52; x <= -36; x++) if ((-36 - x) < 16 * (1 - t * 0.6)) {
      const edge = (-36 - x) >= 16 * (1 - t * 0.6) - 1;
      fv.set(x, y, 4, jibC.clone().multiplyScalar(edge ? 0.82 : 0.96));
    }
  }
  const mesh = v.build(new THREE.MeshStandardMaterial({ roughness: 0.75 }), { jitter: 0.07 });
  const fineSails = fv.build(new THREE.MeshStandardMaterial({ roughness: 0.8 }), { jitter: 0.03 });
  const lines = [];
  masts.forEach((m) => {
    lines.push([m.x, m.h, 0, L + 12, DECK + 8, 0], [m.x, m.h, 0, m.x - 11, DECK, 6], [m.x, m.h, 0, m.x - 11, DECK, -6], [m.x, m.h * 0.75, 0, m.x + 8, DECK, 7]);
  });
  lines.push([masts[0].x, masts[0].h, 0, masts[1].x, masts[1].h, 0], [masts[1].x, masts[1].h, 0, masts[2].x, masts[2].h, 0], [masts[0].x, masts[0].h, 0, -L, DECK + 5, 0]);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lines.flat().map((n) => n * v.s)), 3));
  const rig = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a1b12, transparent: true, opacity: 0.75 }));
  const g = new THREE.Group();
  g.add(mesh, fineSails, rig);
  return g;
}

function buildIsland({ style, seed, cx, cz, radius, height, base, kind }) {
  const P = PAL[style];
  const vs = 0.07;
  const v = new Vox(vs);
  const lamp = new Vox(vs);
  const ri = Math.ceil(radius / vs);
  const topY = Math.round(height / vs);
  const botY = Math.round(base / vs);
  const rock = style === 'A' ? [C('#7a6a55'), C('#8a7b62'), C('#5f5a4b')] : [C('#6d6f66'), C('#7d7a6c'), C('#585c57')];
  const grass = style === 'A' ? [C('#5e8f3a'), C('#4e7d33'), C('#7aa649')] : [C('#4f8a4b'), C('#3f7440'), C('#6a9e55')];
  let peak = { i: 0, j: 0, k: 0 };
  const extra = [];
  let lampPos = null; const chimneys = [];
  for (let i = -ri; i <= ri; i++) for (let k = -ri; k <= ri; k++) {
    const d = Math.hypot(i, k) / ri;
    const n = vnoise(i * 0.18 + seed, k * 0.18, seed);
    if (d > 0.75 + n * 0.35) continue;
    const h = Math.round(botY + (topY - botY) * Math.pow(Math.max(0, 1 - d * (0.85 + 0.3 * (1 - n))), 0.7) * (0.75 + 0.5 * n));
    const wx = cx + i * vs, wz = cz + k * vs;
    if (Math.hypot(wz, 0) > innerRadius(wx) - 0.15) continue;
    for (let j = botY; j <= h; j++) {
      let c = rock[Math.floor(hash2(i + j, k - j, seed) * 3)];
      if (j === h && j * vs > WATER_Y + 0.05) c = grass[Math.floor(hash2(i, k, seed + 1) * 3)];
      if (j * vs < WATER_Y - 0.4 && hash2(i, j * 3 + k, seed) > 0.6) c = C(style === 'A' ? '#3e7b62' : '#3c6f66');
      v.set(i, j, k, c);
    }
    if (h > peak.j) peak = { i, j: h, k };
    // trees
    if (h * vs > WATER_Y + 0.15 && hash2(i * 3, k * 5, seed + 9) > 0.93 && kind !== 'lighthouse-center') {
      const th = 3 + Math.floor(hash2(i, k, 4) * 3);
      for (let t = 1; t <= th; t++) {
        const rr = Math.max(0, Math.round((th - t) * 0.5));
        for (let a = -rr; a <= rr; a++) for (let b = -rr; b <= rr; b++) v.set(i + a, h + t, k + b, grass[(t + 1) % 3].clone().multiplyScalar(0.8));
      }
    }
  }
  if (kind === 'lighthouse') {
    const { i: pi, j: pj, k: pk } = peak;
    const lv = new Vox(0.05), ll = new Vox(0.05);
    const H = 17;
    for (let y = 0; y <= H; y++) {
      const rr = 3.8 - (y / H) * 1.0;
      const stripe = Math.floor(y / 4) % 2 === 0 ? C('#f1ece2') : C('#c23a2e');
      for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) if (Math.hypot(a, b) <= rr) lv.set(a, y, b, stripe);
    }
    for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) if (Math.hypot(a, b) <= 3.6) lv.set(a, H + 1, b, C('#2e2a28'));
    for (let y = 2; y <= 4; y++) for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) if (Math.hypot(a, b) <= 2.3) ll.set(a, H + y, b, C('#ffd76a'));
    for (let y = 5; y <= 7; y++) { const rr = 3 - (y - 5) * 1.1; for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) if (Math.hypot(a, b) <= rr + 0.3) lv.set(a, H + y, b, C('#b53328')); }
    const tw = lv.build(new THREE.MeshStandardMaterial({ roughness: 0.7 }), { jitter: 0.04 });
    const lp = ll.build(new THREE.MeshBasicMaterial({ color: 0xffffff }), { jitter: 0, castShadow: false });
    for (const m of [tw, lp]) { m.position.set(pi * vs, (pj + 1) * vs, pk * vs); extra.push(m); }
    lampPos = new THREE.Vector3(pi * vs, (pj + 1) * vs + (H + 3) * 0.05, pk * vs);
    // keeper's cottage
    for (let a = 0; a < 5; a++) for (let b = 0; b < 4; b++) for (let y = 0; y < 3; y++) v.set(pi + 5 + a, pj - 2 + y, pk + 2 + b, C('#efe6d6'));
    for (let a = -1; a < 6; a++) for (let y = 0; y < 2; y++) for (let b = y; b < 4 - y; b++) v.set(pi + 5 + a, pj + 1 + y, pk + 2 + b, C('#b4472f'));
  }
  if (kind === 'village') {
    const { i: pi, j: pj, k: pk } = peak;
    const houses = [[-3, 0, 0], [4, -2, 2], [0, -1, 5], [-6, -3, 4]];
    houses.forEach(([a0, y0, b0], hi) => {
      const w = 5, d = 4, hh = 4;
      for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) for (let y = 0; y < hh; y++) {
        const win = (y === 2 && (a === 1 || a === 3) && b === d - 1);
        v.set(pi + a0 + a, pj + y0 + y, pk + b0 + b, win ? C('#3a4a5a') : C('#f2ebdc'));
      }
      for (let y = 0; y < 3; y++) for (let a = -1; a <= w; a++) for (let b = y - 1; b <= d - y; b++) v.set(pi + a0 + a, pj + y0 + hh + y, pk + b0 + b, C(hi % 2 ? '#c4553a' : '#b2402c'));
      for (let y = 0; y < 4; y++) v.set(pi + a0 + w - 1, pj + y0 + hh + y, pk + b0 + 1, C('#8a8178'));
      if (hi < 2) chimneys.push(new THREE.Vector3((pi + a0 + w - 1) * vs, (pj + y0 + hh + 4) * vs, (pk + b0 + 1) * vs));
    });
    // jetty
    for (let a = 0; a < 12; a++) for (let b = 0; b < 3; b++) v.set(pi - 14 - a, Math.round(WATER_Y / vs) + 1, pk + 8 + b, C('#7b5536'));
  }
  if (kind === 'arch') {
    // rock arch beside the island
    for (let t = 0; t <= 40; t++) {
      const a = (t / 40) * Math.PI;
      const ax = Math.round(Math.cos(a) * 9), ay = Math.round(Math.sin(a) * 9) + Math.round(WATER_Y / vs) - 2;
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -3; dz <= 3; dz++)
        v.set(peak.i - 10 + ax + dx, ay + dy, peak.k + 4 + dz, rock[(dx + dy + 6) % 3]);
    }
    for (let x = -12; x <= -8; x++) for (let y = botY; y < Math.round(WATER_Y / vs); y++) for (let z = -3; z <= 3; z++) {
      v.set(peak.i - 10 - 9 + (x + 10), y, peak.k + 4 + z, rock[1]);
      v.set(peak.i - 10 + 9 + (x + 10), y, peak.k + 4 + z, rock[2]);
    }
  }
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const g = new THREE.Group();
  g.add(v.build(mat, { jitter: 0.08 }));
  extra.forEach((m) => g.add(m));
  g.userData.lampPos = lampPos; g.userData.chimneys = chimneys;
  g.position.set(cx, 0, cz);
  return g;
}

function buildSeabed(style) {
  const vs = 0.1;
  const v = new Vox(vs);
  // calm base: sand with mossy patches and rock outcrops; coral grows in coherent patches, not random noise
  const sand = style === 'A' ? [C('#e2cf9f'), C('#d6c08e'), C('#ead9ad')] : [C('#58858a'), C('#4d7a80'), C('#62939a')];
  const moss = style === 'A' ? [C('#5d8f78'), C('#4c7f6a')] : [C('#2f5a5c'), C('#2a5053')];
  const rock = style === 'A' ? [C('#6f7a72'), C('#5f6a64')] : [C('#4d5b5c'), C('#414e50')];
  const palettes = style === 'A'
    ? [[C('#e07a9a'), C('#f09ab4')], [C('#9a6ac0'), C('#b48ad6')], [C('#e79a46'), C('#f2b866')], [C('#d85a5a'), C('#ec7a6a')]]
    : [[C('#d86b93'), C('#ea8fae')], [C('#7f63b8'), C('#9c84d0')], [C('#e0a24a'), C('#efbe6e')], [C('#5bbbc4'), C('#86d4da')]];
  const kelp = [C('#3f8f55'), C('#4fa463'), C('#357a48')];
  for (let i = Math.floor(BODY0 / vs); i <= Math.ceil(BODY1 / vs); i++) {
    const x = i * vs;
    const r = innerRadius(x) - 0.05;
    if (r <= 0.3) continue;
    for (let k = -Math.floor(r / vs); k <= Math.floor(r / vs); k++) {
      const z = k * vs;
      if (Math.abs(z) > r) continue;
      const yb = -Math.sqrt(r * r - z * z);
      const rk = vnoise(i * 0.09, k * 0.09, 21);
      const ys = -1.38 + vnoise(i * 0.12, k * 0.12, 5) * 0.3 + Math.max(0, rk - 0.68) * 0.6;
      if (ys < yb) continue;
      const jb = Math.ceil(yb / vs), js = Math.floor(ys / vs);
      const mz = vnoise(i * 0.2, k * 0.2, 9);
      for (let j = jb; j <= js; j++) {
        let c = rk > 0.68 ? rock[(i + j + k) & 1] : mz > 0.74 ? moss[(i + k) & 1] : sand[Math.floor(hash2(i, k + j, 2) * 3)];
        v.set(i, j, k, c);
      }
      if (Math.abs(z) > r - 0.15) continue;
      const patch = vnoise(i * 0.11, k * 0.11, 7);
      if (patch > 0.6 && hash2(i, k, 11) > 0.55) {
        const pal = palettes[Math.floor(hash2(Math.floor(i / 9), Math.floor(k / 9), 12) * palettes.length)];
        const h = 1 + Math.floor(hash2(i, k, 13) * 3 * (patch - 0.5) * 2.5);
        for (let t = 1; t <= h; t++) {
          if ((js + t) * vs > WATER_Y - 0.65) break;
          v.set(i, js + t, k, pal[t === h ? 1 : 0]);
        }
      } else if (patch < 0.3 && z < 0 && hash2(i, k, 14) > 0.8) {
        const h = 3 + Math.floor(hash2(i, k, 15) * 4);
        for (let t = 1; t <= h; t++) { if ((js + t) * vs > WATER_Y - 0.55) break; v.set(i + (t > 3 && (t & 1) ? 1 : 0), js + t, k, kelp[t % 3]); }
      }
    }
  }
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  return v.build(mat, { jitter: 0.06, castShadow: false });
}

function buildClouds(style) {
  const g = new THREE.Group();
  if (style !== 'A') return g;
  const mat = new THREE.MeshStandardMaterial({ roughness: 1 });
  const spots = [[-0.9, 1.3, -0.4, 1.0], [1.2, 1.22, -0.5, 0.8], [2.1, 1.05, 0.2, 0.7], [-2.2, 1.2, 0.3, 0.9], [0.3, 1.45, -0.9, 0.75]];
  spots.forEach(([x, y, z, sz], n) => {
    const v = new Vox(0.045);
    // three overlapping puffs with a flat base; lit top, cool underside
    const puffs = [[-4 * sz, 0, 0, 3.2 * sz], [0, 1.2, 0, 4.2 * sz], [4 * sz, 0.3, 0, 3 * sz]];
    for (let i = -9; i <= 9; i++) for (let j = 0; j <= 7; j++) for (let k = -4; k <= 4; k++) {
      const inside = puffs.some(([px, py, pz, pr]) => Math.hypot(i - px, (j - py) * 1.15, (k - pz) * 1.3) <= pr);
      if (!inside) continue;
      v.set(i, j, k, j === 0 ? C('#d3d8d6') : j === 1 ? C('#e6e4dc') : C('#fbf5e9'));
    }
    const m = v.build(mat, { jitter: 0.02, castShadow: false });
    m.position.set(x, y, z);
    m.userData.phase = n;
    g.add(m);
  });
  return g;
}

function buildGulls() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let n = 0; n < 4; n++) {
    const v = new Vox(0.035);
    for (let a = -4; a <= 4; a++) v.set(a, Math.abs(a) > 1 ? Math.abs(a) - 1 : 0, 0, C('#ffffff'));
    const m = v.build(mat, { jitter: 0, castShadow: false });
    m.userData.phase = n * 1.7;
    g.add(m);
  }
  return g;
}

function buildCork(style) {
  const P = PAL[style];
  const g = new THREE.Group();
  const corkGeo = new THREE.CylinderGeometry(NECK_R - 0.04, NECK_R - 0.08, 1.05, 48, 1);
  corkGeo.rotateZ(-Math.PI / 2);
  // speckled cork texture
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#' + P.cork.getHexString(); cx.fillRect(0, 0, 128, 128);
  const r = rng(7);
  for (let i = 0; i < 900; i++) { cx.fillStyle = r() > 0.5 ? '#' + P.corkDark.getHexString() : '#e0b27a'; cx.fillRect(r() * 128, r() * 128, 2 + r() * 3, 2 + r() * 3); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  if (style === 'B') { tex.magFilter = THREE.NearestFilter; }
  const cork = new THREE.Mesh(corkGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  cork.position.x = NECK1 + 0.15;
  cork.castShadow = true;
  g.add(cork);
  if (style === 'A') {
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xd9ad6a, roughness: 0.8 });
    for (let i = 0; i < 4; i++) {
      const tor = new THREE.Mesh(new THREE.TorusGeometry(NECK_R + 0.06, 0.05, 10, 48), ropeMat);
      tor.rotation.y = Math.PI / 2;
      tor.position.x = NECK0 + 0.15 + i * 0.13;
      tor.rotation.x = 0.15 * (i % 2 ? 1 : -1);
      g.add(tor);
    }
    // wax seal
    const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.04, 24), new THREE.MeshStandardMaterial({ color: 0x9e2a20, roughness: 0.5 }));
    seal.position.set(NECK0 + 0.1, -0.3, NECK_R + 0.12); seal.rotation.x = Math.PI / 2 - 0.4;
    g.add(seal);
  }
  return g;
}

function buildStand(style) {
  const P = PAL[style];
  const mat = new THREE.MeshStandardMaterial({ color: P.stand, roughness: 0.6 });
  const g = new THREE.Group();
  const cradle = (x) => {
    const shape = new THREE.Shape();
    const w = 1.25, top = -R + 0.55, bot = -R - 0.55;
    shape.moveTo(-w, bot); shape.lineTo(w, bot); shape.lineTo(w, top);
    for (let a = 0; a <= 20; a++) { const t = Math.PI * 0.32 - (a / 20) * Math.PI * 0.64; shape.lineTo(Math.sin(t) * (R + 0.02), -Math.cos(t) * (R + 0.02)); }
    shape.lineTo(-w, top); shape.lineTo(-w, bot);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.28, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
    geo.translate(0, 0, -0.14);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = Math.PI / 2; m.position.x = x; m.castShadow = true; m.receiveShadow = true;
    return m;
  };
  if (style === 'A') { g.add(cradle(-2.9), cradle(1.6)); }
  else {
    g.add(cradle(-3.3), cradle(2.0));
    const base = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.22, 1.5), mat);
    base.position.set(-0.65, -R - 0.66, 0); base.castShadow = true; base.receiveShadow = true;
    g.add(base);
    for (const z of [-0.6, 0.6]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.12, 0.12), mat);
      rail.position.set(-0.65, -R - 0.45, z); g.add(rail);
    }
  }
  return g;
}

// ---------- water ----------
// One wave function per style, shared by the surface and anything floating on it (foam), so they never drift apart.
export function waveHeight(style, x, z, t, amp) {
  if (style === 'A') return amp * (0.07 * Math.sin(x * 2.1 - t * 1.6 + z * 0.8) + 0.04 * Math.sin(x * 3.7 + t * 1.1 - z * 2.1) + 0.02 * Math.sin(z * 5 + t * 2.3));
  return amp * (0.09 * Math.sin(x * 1.9 - t * 1.5 + z * 0.6) + 0.05 * Math.sin(x * 3.3 + t * 1.2 - z * 1.7));
}
function buildWater(style) {
  const P = PAL[style];
  const g = new THREE.Group();
  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), WATER_Y);
  const bodyGeo = latheX(bottleProfile(1, 0.1), 64);
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({
    color: P.water, transparent: true, opacity: style === 'A' ? 0.52 : 0.55, roughness: 0.9, metalness: 0, envMapIntensity: 0.15,
    clippingPlanes: [clip], side: THREE.DoubleSide, depthWrite: false,
  }));
  body.renderOrder = 2;
  g.add(body);

  let surf;
  const x0 = BODY0 + 0.12, x1 = BODY1 + 0.25;
  const zMax = (x) => { const r = innerRadius(x) - 0.06; return Math.sqrt(Math.max(0, r * r - WATER_Y * WATER_Y)); };
  if (style === 'A') {
    const nx = 140, nz = 40;
    const geo = new THREE.PlaneGeometry(1, 1, nx, nz);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.86, roughness: 0.12, clearcoat: 0.6, envMapIntensity: 0.3, side: THREE.DoubleSide, depthWrite: false });
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    const trough = P.water.clone().multiplyScalar(0.9), crestC = P.waterTop.clone().lerp(new THREE.Color('#ffffff'), 0.25), tmpC = new THREE.Color();
    surf = new THREE.Mesh(geo, mat);
    surf.renderOrder = 3;
    const base = geo.attributes.position.array.slice();
    surf.userData.update = (t, amp) => {
      const p = geo.attributes.position.array;
      for (let n = 0; n < p.length; n += 3) {
        const u = base[n] + 0.5, w = base[n + 2] * 2; // u 0..1, w -1..1
        const x = x0 + u * (x1 - x0);
        const z = w * zMax(x);
        const y = WATER_Y + waveHeight('A', x, z, t, amp);
        p[n] = x; p[n + 1] = y; p[n + 2] = z;
        const hN = THREE.MathUtils.clamp((y - WATER_Y) / (0.13 * amp) * 0.5 + 0.5, 0, 1);
        tmpC.copy(trough).lerp(P.waterTop, Math.min(1, hN * 1.4));
        if (hN > 0.8) tmpC.lerp(crestC, (hN - 0.8) * 4);
        if (hN > 0.93) tmpC.lerp(P.foam, (hN - 0.93) * 10);
        geo.attributes.color.array[n] = tmpC.r; geo.attributes.color.array[n + 1] = tmpC.g; geo.attributes.color.array[n + 2] = tmpC.b;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      geo.computeVertexNormals();
    };
  } else {
    const vs = 0.11;
    const cells = [];
    for (let x = x0; x <= x1; x += vs) { const zm = zMax(x); for (let z = -zm + vs / 2; z <= zm - vs / 2; z += vs) cells.push([x, z]); }
    const geo = new THREE.BoxGeometry(vs, vs, vs);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.9 });
    surf = new THREE.InstancedMesh(geo, mat, cells.length);
    surf.renderOrder = 3;
    const m = new THREE.Matrix4(), col = new THREE.Color();
    surf.userData.update = (t, amp) => {
      cells.forEach(([x, z], n) => {
        const h = waveHeight('B', x, z, t, amp);
        const q = Math.round(h / vs) * vs;
        m.makeTranslation(x, WATER_Y + q - vs / 2, z);
        surf.setMatrixAt(n, m);
        const crest = h > 0.128 * amp && hash2(Math.round(x / vs), Math.round(z / vs), Math.floor(t * 2)) > 0.72 ? 0.45 : 0;
        col.copy(P.waterTop).lerp(P.foam, crest).multiplyScalar(0.85 + 0.3 * hash2(Math.round(x / vs), Math.round(z / vs), 1) + q * 1.2);
        surf.setColorAt(n, col);
      });
      surf.instanceMatrix.needsUpdate = true;
      surf.instanceColor.needsUpdate = true;
    };
  }
  g.add(surf);
  g.userData.surf = surf;
  return g;
}

// ---------- glass ----------
function buildGlass(style, envMap) {
  const P = PAL[style];
  const g = new THREE.Group();
  const outer = latheX(bottleProfile(1, 0), 128);
  const glass = new THREE.Mesh(outer, new THREE.MeshPhysicalMaterial({
    color: P.glass, transparent: true, opacity: style === 'A' ? 0.14 : 0.12, roughness: 0.04, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.03, envMap, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false,
  }));
  glass.renderOrder = 10;
  g.add(glass);
  // fresnel rim shell
  const rimMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: { uColor: { value: new THREE.Color(style === 'A' ? '#c9fbff' : '#b6f3f6') }, uPow: { value: 2.6 }, uStr: { value: style === 'A' ? 0.75 : 0.65 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 wp = modelMatrix*vec4(position,1.); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition-wp.xyz); gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uPow; uniform float uStr; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.-abs(dot(normalize(vN),normalize(vV))), uPow); gl_FragColor = vec4(pow(uColor*f*uStr, vec3(2.2)), 1.); }`,
  });
  const rim = new THREE.Mesh(outer, rimMat);
  rim.renderOrder = 11;
  g.add(rim);
  // lip ring
  const lip = new THREE.Mesh(new THREE.TorusGeometry(NECK_R + 0.02, 0.07, 12, 64), new THREE.MeshPhysicalMaterial({ color: P.glass, transparent: true, opacity: 0.35, roughness: 0.05, envMap, depthWrite: false }));
  lip.rotation.y = Math.PI / 2; lip.position.x = NECK1;
  lip.renderOrder = 12;
  g.add(lip);
  // painted specular streaks
  const streakMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
  const streak = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.012, R + 0.012, BODY1 - BODY0 - 1.4, 64, 1, true, Math.PI * 0.62, 0.12), streakMat);
  streak.rotation.z = -Math.PI / 2; streak.position.x = (BODY0 + BODY1) / 2 + 0.2;
  streak.renderOrder = 12;
  g.add(streak);
  return g;
}

// ---------- crew ----------
// One voxel sailor. Returns a group with arm pivots for animation.
function buildPerson({ shirt, pants, skin, hat, coat = null, stripes = null }) {
  const vs = 0.027;
  const g = new THREE.Group();
  const body = new Vox(vs);
  // legs: two columns with a gap
  for (let y = 0; y < 4; y++) for (const z of [0, 1]) { body.set(-1, y, z, pants); body.set(1, y, z, pants); }
  for (let y = 4; y < 9; y++) for (let x = -1; x <= 1; x++) for (let z = 0; z <= 1; z++) {
    let c = coat && (y < 8) && x !== 0 ? coat : shirt;
    if (stripes && !coat && y % 2 === 0) c = stripes;
    if (y === 4) c = C('#3a2a1c'); // belt
    body.set(x, y, z, c);
  }
  for (let y = 9; y < 12; y++) for (let x = -1; x <= 1; x++) for (let z = 0; z <= 1; z++) body.set(x, y, z, skin);
  body.set(-1, 10, 1, C('#1f1712')); body.set(1, 10, 1, C('#1f1712')); // eyes (recoloured face voxels, nothing sticks out)
  if (hat === 'tricorn') { for (let x = -2; x <= 2; x++) for (let z = -1; z <= 2; z++) body.set(x, 12, z, C('#1d1a18')); for (let x = -1; x <= 1; x++) body.set(x, 13, 0, C('#1d1a18')); }
  else if (hat) { for (let x = -1; x <= 1; x++) for (let z = 0; z <= 1; z++) body.set(x, 12, z, hat); }
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const bm = body.build(mat, { jitter: 0.04, cull: false });
  g.add(bm);
  const arms = [];
  for (const side of [-1, 1]) {
    const av = new Vox(vs);
    for (let y = -4; y <= 0; y++) av.set(0, y, 0, y > -4 ? (coat || shirt) : skin);
    const am = av.build(mat, { jitter: 0.03, cull: false });
    const pivot = new THREE.Group();
    pivot.position.set(side * 2 * vs, 8 * vs, 0.5 * vs);
    pivot.add(am);
    g.add(pivot);
    arms.push(pivot);
  }
  g.userData.arms = arms;
  return g;
}

function buildCrew(style, shipVox) {
  const s = shipVox; // ship voxel size
  const skins = [C('#e9b98f'), C('#c68a62'), C('#8d5a3b'), C('#f1c9a5'), C('#a86d48')];
  const crew = new THREE.Group();
  // walkers get their own lane (z) so they pass the standing crew instead of clipping through them
  const people = [
    // x, deckY (voxel rows), z, outfit, action
    { x: -22, y: 17, z: 0, o: { shirt: C('#f1ece0'), coat: C('#1f3a6b'), pants: C('#e8e0cc'), hat: 'tricorn' }, act: 'helm' },
    { x: -9, y: 12, z: 5, o: { shirt: C('#f2f2f0'), stripes: C('#2c4f8a'), pants: C('#3b3a40'), hat: C('#b8322a') }, act: 'haul' },
    { x: -3, y: 12, z: 5, o: { shirt: C('#e8dcc0'), pants: C('#5a4632'), hat: null }, act: 'wave' },
    { x: 4, y: 12, z: 5, o: { shirt: C('#b8432f'), pants: C('#2c2c34'), hat: C('#2c4f8a') }, act: 'haul' },
    { x: 9, y: 12, z: 3.7, o: { shirt: C('#f2f2f0'), stripes: C('#b8322a'), pants: C('#3b3a40'), hat: null }, act: 'walk' },
    { x: 21, y: 14, z: 0, o: { shirt: C('#dfe6ea'), pants: C('#4a3a2a'), hat: C('#f0e6cf') }, act: 'lookout' },
    { x: -15, y: 17, z: 4, o: { shirt: C('#7a8c5a'), pants: C('#3b3a40'), hat: C('#3a2a1c') }, act: 'wave' },
    { x: 13, y: 12, z: 5, o: { shirt: C('#e9c46a'), pants: C('#2c2c34'), hat: C('#b8322a') }, act: 'haul' },
    { x: 0, y: 12, z: -4, o: { shirt: C('#f2f2f0'), stripes: C('#2c4f8a'), pants: C('#3b3a40'), hat: null }, act: 'wave' },
    { x: -1, y: 12, z: 6.2, o: { shirt: C('#4f6d8a'), pants: C('#e8e0cc'), hat: C('#f0e6cf') }, act: 'walk' },
  ];
  people.forEach((p, i) => {
    const person = buildPerson({ ...p.o, skin: skins[i % skins.length] });
    person.position.set(p.x * s, (p.y + 0.5) * s + 0.0, p.z * s);
    person.rotation.y = p.act === 'helm' ? Math.PI / 2 : (p.z > 0 ? 0.25 * Math.sin(i * 2.1) : Math.PI - 0.3);
    person.userData.act = p.act; person.userData.phase = i * 1.37; person.userData.home = person.position.clone();
    crew.add(person);
  });
  crew.userData.animate = (t) => {
    crew.children.forEach((p) => {
      const { act, phase, home } = p.userData; const [l, r] = p.userData.arms;
      p.position.y = home.y + 0.004 * Math.abs(Math.sin(t * 3 + phase));
      if (act === 'wave') { r.rotation.z = Math.PI * 0.85 + 0.35 * Math.sin(t * 7 + phase); l.rotation.z = -0.1; }
      else if (act === 'haul') { const k = Math.sin(t * 3.2 + phase); l.rotation.x = -1.6 - 0.5 * k; r.rotation.x = -1.6 + 0.5 * k; }
      else if (act === 'helm') { l.rotation.x = -1.2 + 0.15 * Math.sin(t * 1.5); r.rotation.x = -1.2 - 0.15 * Math.sin(t * 1.5); }
      else if (act === 'lookout') { r.rotation.x = -2.6; r.rotation.z = 0.3; l.rotation.x = 0.1 * Math.sin(t * 2); }
      else if (act === 'walk') {
        const u = Math.sin(t * 0.45 + phase); p.position.x = home.x + u * 9 * s;
        p.rotation.y = Math.cos(t * 0.45 + phase) > 0 ? Math.PI / 2 : -Math.PI / 2;
        l.rotation.x = 0.6 * Math.sin(t * 6); r.rotation.x = -0.6 * Math.sin(t * 6);
      }
    });
  };
  return crew;
}

// ---------- ship details: cannons, lanterns, helm ----------
function buildShipDetails(style, s) {
  const g = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: 0x23262a, metalness: 0.6, roughness: 0.4 });
  if (style === 'A' || style === 'B') {
    const geo = new THREE.CylinderGeometry(s * 0.35, s * 0.45, s * 2.2, 10); geo.rotateX(Math.PI / 2);
    const hw = (x) => (x > 9 ? 7 * Math.pow(Math.max(0, (29 - x) / 20), 0.7) : x < -21 ? 7 - (-21 - x) * 0.4 : 7);
    for (let x = -18; x <= 15; x += 3) for (const side of [-1, 1]) for (const row of style === 'A' ? [5, 9] : [5, 8]) {
      const c = new THREE.Mesh(geo, iron); c.position.set(x * s, row * s, side * (Math.round(hw(x)) + 0.7) * s); g.add(c);
    }
  }
  // stern lanterns (glow)
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
  for (const z of [-4, 4]) { const l = new THREE.Mesh(new THREE.BoxGeometry(s * 1.4, s * 2, s * 1.4), lampMat); l.position.set(-28 * s, 18 * s, z * s); l.userData.glow = true; g.add(l); }
  const top = new THREE.Mesh(new THREE.BoxGeometry(s * 1.4, s * 2.4, s * 1.4), lampMat); top.position.set(-27 * s, 21 * s, 0); g.add(top);
  // ship's wheel
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(s * 1.6, s * 0.25, 6, 16), new THREE.MeshStandardMaterial({ color: 0x5a3620, roughness: 0.7 }));
  wheel.position.set(-20 * s, 17.8 * s, 0); wheel.rotation.y = Math.PI / 2; g.add(wheel); g.userData.wheel = wheel;
  return g;
}

// ---------- life & atmosphere ----------
function buildFish() {
  const g = new THREE.Group();
  const cols = ['#f4a23c', '#f6d84a', '#e0567a', '#6fd0e8', '#ffffff', '#9a78e0'];
  for (let n = 0; n < 14; n++) {
    const v = new Vox(0.03); const c = C(cols[n % cols.length]);
    for (let i = -2; i <= 1; i++) v.set(i, 0, 0, c);
    v.set(-1, 1, 0, c); v.set(0, 1, 0, c); v.set(-1, -1, 0, c); v.set(2, 1, 0, c); v.set(2, -1, 0, c); v.set(1, 0, 0, C('#1a1a1a'));
    const m = v.build(new THREE.MeshStandardMaterial({ roughness: 0.5 }), { jitter: 0, cull: false, castShadow: false });
    m.userData = { phase: n * 0.83, r: 0.6 + (n % 5) * 0.45, y: -1.15 + (n % 4) * 0.2, cx: -1.5 + (n % 3) * 1.4, sp: 0.35 + (n % 3) * 0.12, dir: n % 2 ? 1 : -1 };
    g.add(m);
  }
  g.userData.animate = (t) => g.children.forEach((f) => {
    const u = f.userData, a = t * u.sp * u.dir + u.phase;
    f.position.set(u.cx + Math.cos(a) * u.r * 1.4, u.y + 0.05 * Math.sin(t * 2 + u.phase), Math.sin(a) * u.r * 0.55);
    f.rotation.y = -a + (u.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
  });
  return g;
}

function buildBubbles() {
  const n = 40;
  const geo = new THREE.SphereGeometry(0.018, 8, 6);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xe8fff4, transparent: true, opacity: 0.55, roughness: 0.1 }), n);
  const m = new THREE.Matrix4();
  mesh.userData.animate = (t) => {
    for (let i = 0; i < n; i++) {
      const sx = -4 + (hash2(i, 1, 3) * 6.6), sz = (hash2(i, 2, 3) - 0.5) * 2.2;
      const span = WATER_Y - (-1.2); const sp = 0.18 + hash2(i, 3, 3) * 0.2;
      const y = -1.2 + ((t * sp + hash2(i, 4, 3)) % 1) * span;
      const k = 0.6 + hash2(i, 5, 3);
      m.makeScale(k, k, k); m.setPosition(sx + 0.03 * Math.sin(t * 3 + i), y, sz);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  return mesh;
}

function buildSmoke(origins) {
  const n = 10 * origins.length;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 0xe9e6df, transparent: true, opacity: 0.6, roughness: 1 }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  mesh.userData.animate = (t) => {
    let i = 0;
    origins.forEach(([ox, oy, oz], k) => {
      for (let j = 0; j < 10; j++, i++) {
        const u = (t * 0.25 + j / 10 + k * 0.37) % 1;
        const sc = 0.6 + u * 1.8;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), u * 3 + j);
        m.compose(new THREE.Vector3(ox + u * 0.25 + 0.03 * Math.sin(u * 9 + j), oy + u * 0.55, oz + 0.04 * Math.sin(u * 7 + j)), q, new THREE.Vector3(sc, sc, sc));
        mesh.setMatrixAt(i, m);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  return mesh;
}

function buildFoam(style, shipLen, cx, cz) {
  // soft foam patches hugging the hull plus a short wake; world space, riding the shared wave height
  const mat = new THREE.MeshStandardMaterial({ color: 0xf2fff6, transparent: true, opacity: 0.7, roughness: 0.7, depthWrite: false });
  const pts = [];
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * Math.PI * 2;
    const rx = shipLen * 0.5 * (1 + 0.05 * Math.sin(a * 5)), rz = 0.3 + 0.03 * Math.sin(a * 3);
    pts.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz, 1]);
  }
  for (let i = 0; i < 24; i++) pts.push([cx - shipLen * 0.52 - i * 0.06, cz + (hash2(i, 9, 1) - 0.5) * (0.12 + i * 0.025), 1 - i / 30]);
  const inst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 8), mat, pts.length);
  inst.renderOrder = 4;
  const m = new THREE.Matrix4();
  inst.userData.animate = (t, amp) => {
    pts.forEach(([x, z, f], i) => {
      const k = (0.6 + 0.6 * Math.abs(Math.sin(t * 2 + i * 1.7))) * f;
      let y = waveHeight(style, x, z, t, amp);
      if (style === 'B') y = Math.round(y / 0.11) * 0.11; // voxel water is stepped
      m.makeScale(k, 1, k); m.setPosition(x, WATER_Y + y + 0.012, z);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
  };
  return inst;
}

function buildBeam() {
  const geo = new THREE.ConeGeometry(0.22, 2.2, 24, 1, true);
  geo.translate(0, -1.1, 0); geo.rotateZ(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying float vX; void main(){ vX = position.x; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'varying float vX; void main(){ float f = clamp(1. - vX/2.2, 0., 1.); gl_FragColor = vec4(pow(vec3(1.,.88,.55)*f*f*0.45, vec3(2.2)), 1.); }',
  });
  const g = new THREE.Group(); g.add(new THREE.Mesh(geo, mat));
  return g;
}

// ---------- camera path ----------
// keys: [t, azimuthDeg, elevationDeg, distanceScale]
export const PATHS = {
  A: [
    [0.0, 22, 18, 1.08], [0.25, 24, 18, 1.05], [0.5, 27, 19, 1.03], [0.75, 40, 22, 1.0], [1.0, 60, 28, 1.0],
    [1.25, 85, 30, 1.0], [1.5, 110, 22, 1.0], [1.75, 125, 18, 1.0], [2.0, 140, 16, 1.0], [2.25, 155, 12, 1.0],
    [2.5, 168, 8, 1.0], [2.75, 178, 6, 1.02], [3.0, 182, 6, 1.02], [3.25, 186, 8, 1.02], [3.5, 200, 12, 1.0],
    [3.75, 245, 24, 1.0], [4.0, 285, 22, 1.0], [4.25, 322, 24, 1.0], [4.5, 345, 16, 1.0], [4.75, 360, 4, 1.04],
    [5.0, 376, 12, 1.0], [5.25, 376, 10, 0.5], [5.5, 375, 9, 0.4], [5.75, 375, 9, 0.4], [6.0, 375, 10, 0.42],
    [6.5, 382, 17, 1.0], [7.5, 384, 18, 1.0], [8.5, 383, 18, 1.0], [9.5, 382, 18, 1.0], [10.5, 380, 17, 1.0],
    [10.75, 362, 8, 1.0], [11.0, 360, 6, 1.0], [11.25, 365, 8, 1.0], [11.5, 372, 14, 1.0], [11.75, 382, 18, 1.0],
    [12.5, 384, 18, 1.0], [12.75, 405, 34, 0.66], [13.0, 372, 12, 0.42], [13.5, 370, 10, 0.38], [14.0, 370, 10, 0.42],
    [14.25, 371, 10, 0.45], [14.5, 374, 12, 0.6], [15.25, 374, 12, 0.62], [15.5, 382, 17, 1.02], [16.0, 385, 19, 1.0],
    [17.1, 386, 19, 1.0],
  ],
  B: [
    [0.0, 22, 14, 1.05], [0.25, 25, 18, 1.0], [0.5, 30, 22, 0.95], [0.75, 30, 30, 0.72], [1.0, 55, 32, 0.75],
    [1.25, 90, 30, 0.85], [1.5, 165, 12, 0.78], [1.75, 180, 8, 0.85], [2.0, 185, 12, 0.85], [2.25, 195, 14, 0.95],
    [2.5, 205, 16, 1.0], [2.75, 268, 14, 1.15], [3.0, 335, 18, 1.0], [3.25, 350, 14, 1.0], [3.5, 360, 6, 1.0],
    [3.75, 365, 4, 1.0], [4.0, 368, 8, 1.0], [4.25, 385, 25, 1.0], [4.5, 395, 32, 1.0], [4.75, 395, 30, 0.95],
    [5.0, 390, 28, 0.6], [5.25, 392, 28, 0.55], [5.5, 398, 35, 0.36], [5.75, 398, 35, 0.36], [6.0, 390, 24, 0.86],
    [6.5, 380, 15, 0.9], [7.0, 380, 15, 0.9], [7.5, 381, 14, 0.6], [8.0, 382, 14, 0.58], [8.25, 382, 14, 0.52],
    [8.5, 384, 18, 0.6], [8.75, 395, 24, 0.82], [9.0, 420, 26, 0.9], [9.25, 445, 28, 0.85], [9.5, 495, 22, 0.9],
    [9.75, 520, 14, 0.85], [10.0, 540, 16, 0.9], [10.25, 555, 28, 0.9], [10.5, 565, 30, 0.85], [10.75, 625, 30, 1.1],
    [11.0, 700, 24, 0.95], [11.25, 735, 14, 0.85], [11.5, 738, 12, 0.85], [12.0, 740, 13, 0.78], [12.25, 740, 13, 0.62],
    [12.5, 740, 12, 0.55], [13.0, 740, 12, 0.55], [13.25, 738, 8, 0.35], [13.5, 738, 8, 0.33], [14.5, 738, 8, 0.33],
    [15.0, 742, 16, 0.9], [15.5, 752, 25, 1.05], [16.0, 754, 26, 1.05], [17.1, 754, 26, 1.05],
  ],
};
function samplePath(keys, t) {
  if (t <= keys[0][0]) return keys[0].slice(1);
  if (t >= keys[keys.length - 1][0]) return keys[keys.length - 1].slice(1);
  let i = 0;
  while (keys[i + 1][0] < t) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(keys.length - 1, i + 2)];
  const u = (t - k1[0]) / (k2[0] - k1[0]);
  const out = [];
  for (let c = 1; c < 4; c++) {
    // Catmull-Rom (non-uniform tangents scaled by segment length)
    const m1 = ((k2[c] - k0[c]) / Math.max(1e-6, k2[0] - k0[0])) * (k2[0] - k1[0]);
    const m2 = ((k3[c] - k1[c]) / Math.max(1e-6, k3[0] - k1[0])) * (k2[0] - k1[0]);
    const u2 = u * u, u3 = u2 * u;
    out.push((2 * u3 - 3 * u2 + 1) * k1[c] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * k2[c] + (u3 - u2) * m2);
  }
  return out;
}

// ---------- main ----------
export function createScene(canvas, style, width, height) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Number(new URLSearchParams(location.search).get('ss') || 1)); // supersample, browser downsamples to CSS size
  renderer.setSize(width, height, true);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = style === 'A' ? 0.92 : 0.88;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = style === 'A' ? 0.55 : 0.45;

  // background gradient drawn in WebGL (keeps transparent glass compositing correct)
  {
    const bc2 = document.createElement('canvas'); bc2.width = width; bc2.height = height;
    const g2 = bc2.getContext('2d');
    const cxp = width * (style === 'A' ? 0.52 : 0.5), cyp = height * (style === 'A' ? 0.46 : 0.55);
    g2.save(); g2.translate(cxp, cyp); g2.scale(1, style === 'A' ? 0.62 : 0.6);
    const rg = g2.createRadialGradient(0, 0, 0, 0, 0, width * (style === 'A' ? 0.72 : 0.62));
    if (style === 'A') { rg.addColorStop(0, '#36625f'); rg.addColorStop(0.45, '#264c4c'); rg.addColorStop(1, '#14302f'); }
    else { rg.addColorStop(0, '#1f3b3c'); rg.addColorStop(0.55, '#14292b'); rg.addColorStop(1, '#0b181a'); }
    g2.fillStyle = rg; g2.fillRect(-width * 2, -height * 4, width * 4, height * 8); g2.restore();
    const bt = new THREE.CanvasTexture(bc2); bt.colorSpace = THREE.SRGBColorSpace;
    scene.background = bt;
  }
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 200);

  scene.add(new THREE.HemisphereLight(style === 'A' ? 0xcfeff0 : 0xbfe6e8, style === 'A' ? 0x2a4a48 : 0x14282b, style === 'A' ? 1.1 : 0.9));
  const sun = new THREE.DirectionalLight(style === 'A' ? 0xfff0d8 : 0xffe9cc, style === 'A' ? 2.6 : 2.4);
  sun.position.set(-1.5, 15, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  sun.shadow.radius = 5;
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fd8e0, 0.6); fill.position.set(7, 3, -6); scene.add(fill);

  const world = new THREE.Group();
  scene.add(world);

  // floor shadow catcher + soft contact blob
  const floorY = -R - (style === 'A' ? 0.55 : 0.77);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: style === 'A' ? 0.28 : 0.35 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = floorY; floor.receiveShadow = true;
  world.add(floor);
  const bc = document.createElement('canvas'); bc.width = bc.height = 256;
  const bx = bc.getContext('2d'); const grd = bx.createRadialGradient(128, 128, 10, 128, 128, 128);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); bx.fillStyle = grd; bx.fillRect(0, 0, 256, 256);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(12, 4.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(bc), transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.set(0, floorY + 0.01, 0); world.add(blob);

  world.add(buildStand(style));
  world.add(buildSeabed(style));
  const water = buildWater(style); world.add(water);

  const ship = buildShip(style);
  const shipHolder = new THREE.Group();
  ship.position.set(-1.15, -0.36, -0.15);
  shipHolder.add(ship);
  shipHolder.position.set(0.15, WATER_Y, 0.05);
  world.add(shipHolder);

  const SHIP_VS = 0.064;
  const crew = buildCrew(style, SHIP_VS); ship.add(crew);
  const details = buildShipDetails(style, SHIP_VS); ship.add(details);
  // hull centre in world space = shipHolder.x + ship.x (voxel origin is mid-ship)
  const foam = buildFoam(style, 54 * SHIP_VS, shipHolder.position.x + ship.position.x, shipHolder.position.z + ship.position.z); world.add(foam);
  const lhIsland = buildIsland({ style, seed: 3, cx: -3.25, cz: -0.45, radius: 1.05, height: 0.5, base: -1.3, kind: 'lighthouse' });
  const rIsland = buildIsland({ style, seed: 8, cx: 2.45, cz: -0.35, radius: 0.85, height: style === 'A' ? 0.5 : 0.75, base: -1.3, kind: style === 'A' ? 'village' : 'arch' });
  world.add(lhIsland, rIsland);
  const beam = buildBeam();
  if (lhIsland.userData.lampPos) { beam.position.copy(lhIsland.userData.lampPos).add(lhIsland.position); world.add(beam); }
  const smoke = buildSmoke(rIsland.userData.chimneys.map((c) => [c.x + rIsland.position.x, c.y, c.z + rIsland.position.z]));
  if (rIsland.userData.chimneys.length) world.add(smoke);
  const fish = buildFish(); world.add(fish);
  const bubbles = buildBubbles(); world.add(bubbles);
  world.add(buildIsland({ style, seed: 21, cx: -1.9, cz: 1.0, radius: 0.35, height: 0.2, base: -1.3, kind: 'rock' }));

  const clouds = buildClouds(style); world.add(clouds);
  const gulls = buildGulls(); world.add(gulls);
  // buoys
  [[0.9, 0.95], [-2.4, 0.9]].forEach(([x, z]) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.16, 8), new THREE.MeshStandardMaterial({ color: 0xd2452c }));
    b.position.set(x, WATER_Y + 0.05, z); world.add(b);
  });
  world.add(buildCork(style));
  world.add(buildGlass(style, env));

  // center of interest
  const target = new THREE.Vector3(style === 'A' ? 0.25 : 0.2, style === 'A' ? -0.15 : -0.35, 0);
  const baseDist = style === 'A' ? 17.2 : 17.8;
  const focus = new THREE.Vector3(0.1, style === 'A' ? 0.95 : 0.7, 0);

  function renderAt(t) {
    const [az, el, ds] = samplePath(PATHS[style], t);
    const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
    const d = baseDist * ds;
    const zt = THREE.MathUtils.clamp((1 - ds) / 0.62, 0, 1);
    const tg = target.clone().lerp(focus, zt);
    camera.position.set(tg.x + d * Math.sin(a) * Math.cos(e), tg.y + d * Math.sin(e), tg.z + d * Math.cos(a) * Math.cos(e));
    camera.lookAt(tg);

    water.userData.surf.userData.update(t, style === 'A' ? 1.7 : 1.2);
    shipHolder.position.y = WATER_Y + 0.025 * Math.sin(t * 1.4);
    shipHolder.rotation.x = 0.035 * Math.sin(t * 1.1);
    shipHolder.rotation.z = 0.02 * Math.sin(t * 0.9 + 1);
    clouds.children.forEach((c) => { c.userData.y0 ??= c.position.y; c.position.y = c.userData.y0 + 0.035 * Math.sin(t * 0.6 + c.userData.phase); c.position.x += 0; });
    gulls.children.forEach((gl, n) => {
      const p = gl.userData.phase;
      gl.position.set(0.8 + 1.4 * Math.cos(t * 0.5 + p), 0.95 + 0.25 * Math.sin(t * 0.8 + p) + n * 0.06, -0.4 + 0.5 * Math.sin(t * 0.5 + p));
      gl.scale.y = 0.6 + 0.4 * Math.abs(Math.sin(t * 6 + p));
      gl.rotation.y = -t * 0.5 - p;
    });
    crew.userData.animate(t);
    fish.userData.animate(t);
    bubbles.userData.animate(t);
    smoke.userData.animate(t);
    foam.userData.animate(t, style === 'A' ? 1.7 : 1.2);
    details.userData.wheel.rotation.x = 0.4 * Math.sin(t * 0.8);
    beam.rotation.y = t * 1.6;
    renderer.render(scene, camera);
  }
  return { renderAt, renderer, scene, camera };
}
