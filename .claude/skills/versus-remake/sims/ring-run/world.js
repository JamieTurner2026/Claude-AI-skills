// One panel of the ring-run film: a deterministic three.js world drawn at time t.
// Two looks share the code: style 'A' (blocky, voxel station, white two-engine fighter)
// and style 'B' (detailed station, grey four-engine box-wing fighter). All models are procedural and original.
import * as THREE from 'three';

const rand = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const deg = THREE.MathUtils.degToRad;

// ---------- sky + planet (drawn first, with the camera's rotation only) ----------
const SKY_VS = `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`;
const SKY_FS = `
varying vec3 vDir;
uniform vec3 uGlowDir; uniform vec3 uGlow; uniform vec3 uBase; uniform float uStars;
float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
void main(){
  vec3 d = normalize(vDir);
  float g = max(dot(d, normalize(uGlowDir)), 0.0);
  vec3 c = uBase + uGlow * (pow(g, 3.0) * 0.55 + pow(g, 12.0) * 0.6);
  vec3 q = floor(d * 420.0);
  float s = h(q);
  c += vec3(step(1.0 - uStars, s) * (0.25 + 0.5 * h(q + 1.7)));
  gl_FragColor = vec4(c, 1.0);
}`;

const PLANET_VS = `varying vec3 vN; varying vec3 vP; varying vec3 vW;
void main(){ vP = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const PLANET_FS = `
varying vec3 vN; varying vec3 vP; varying vec3 vW;
uniform vec3 uSun; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uCloud; uniform vec3 uRim;
uniform float uBlock; uniform float uCloudAmt; uniform float uCloudScale; uniform vec3 uCam; uniform vec3 uLand; uniform float uLandAmt; uniform float uHazePow;
float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
float noise(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x), mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x), mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y), f.z); }
float fbm(vec3 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*noise(p); p *= 2.03; a *= 0.5; } return s; }
void main(){
  vec3 n = normalize(vN);
  vec3 v = normalize(uCam - vW);
  float vd = max(dot(n, v), 0.0);
  float haze = pow(1.0 - vd, uHazePow);
  float lam = clamp(dot(n, normalize(uSun)) * 0.5 + 0.5, 0.0, 1.0);
  vec3 p = normalize(vP) * uCloudScale;
  if (uBlock > 0.0) p = floor(p * uBlock) / uBlock;
  float land = smoothstep(0.55, 0.62, fbm(normalize(vP) * 3.0 + 7.0)) * uLandAmt;
  vec3 ocean = mix(uDeep, uShallow, haze) * mix(0.8, 1.1, lam);
  ocean = mix(ocean, uLand * mix(0.5, 1.0, haze), land);
  float c = fbm(p);
  float cl = smoothstep(0.62 - uCloudAmt, 0.70 - uCloudAmt, c);
  vec3 col = mix(ocean, uCloud * mix(0.35, 1.0, haze), cl * 0.8);
  col += uRim * pow(1.0 - vd, 7.0);
  gl_FragColor = vec4(col, 1.0);
}`;
const HALO_FS = `varying vec3 vN; varying vec3 vW; uniform vec3 uCam; uniform vec3 uRim;
void main(){ vec3 n = normalize(vN); vec3 v = normalize(uCam - vW); float d = max(dot(n, v), 0.0);
  float a = pow(1.0 - d, 1.0) * smoothstep(0.0, 0.25, d) ; gl_FragColor = vec4(uRim * a * 0.9, 1.0); }`;

function buildBackdrop(S) {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {uGlowDir: {value: new THREE.Vector3(...S.glowDir)}, uGlow: {value: new THREE.Color(...S.glow)}, uBase: {value: new THREE.Color(...S.skyBase)}, uStars: {value: S.stars}},
    }),
  );
  scene.add(sky);
  const dir = new THREE.Vector3(...S.planetDir).normalize();
  const R = Math.sin(deg(S.planetAng));
  const uni = {
    uSun: {value: new THREE.Vector3(...S.sun)},
    uDeep: {value: new THREE.Color(...S.deep)},
    uShallow: {value: new THREE.Color(...S.shallow)},
    uCloud: {value: new THREE.Color(...S.cloud)},
    uRim: {value: new THREE.Color(...S.rim)},
    uLand: {value: new THREE.Color(...S.land)},
    uLandAmt: {value: S.landAmt},
    uHazePow: {value: S.hazePow},
    uBlock: {value: S.cloudBlock},
    uCloudAmt: {value: S.cloudAmt},
    uCloudScale: {value: S.cloudScale},
    uCam: {value: new THREE.Vector3()},
  };
  const planet = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 120), new THREE.ShaderMaterial({vertexShader: PLANET_VS, fragmentShader: PLANET_FS, uniforms: uni}));
  planet.position.copy(dir);
  planet.rotation.set(...S.planetSpin);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.018, 128, 96),
    new THREE.ShaderMaterial({vertexShader: PLANET_VS, fragmentShader: HALO_FS, uniforms: {uCam: uni.uCam, uRim: uni.uRim}, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false}),
  );
  halo.position.copy(dir);
  scene.add(halo, planet);
  return scene;
}

// ---------- materials ----------
const std = (color, o = {}) => new THREE.MeshStandardMaterial({color, roughness: 0.75, metalness: 0.15, ...o});

// ---------- station A: blocky voxel ring ----------
function stationA() {
  const g = new THREE.Group();
  const r = rand(7);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const mats = [std(0x3c424a), std(0x4a5058), std(0x30353c)];
  const parts = [];
  const add = (x, y, z, sx, sy, sz, rz, m) => parts.push({x, y, z, sx, sy, sz, rz, m});
  // outer ring: chunky segments with jitter
  const N = 84;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const R = 550 + (r() - 0.5) * 16;
    add(Math.cos(a) * R, Math.sin(a) * R, (r() - 0.5) * 12, 40 + r() * 12, 56 + r() * 14, 50 + r() * 12, a, (i % 3));
    if (r() < 0.6) add(Math.cos(a) * (R + 36), Math.sin(a) * (R + 36), (r() - 0.5) * 24, 22, 16 + r() * 12, 24 + r() * 16, a, 2);
  }
  // middle ring: plates in arcs
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    if ((i % 24) > 18) continue;
    add(Math.cos(a) * 405, Math.sin(a) * 405, 0, 28, 14, 34, a, 1);
  }
  // spokes
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    for (let s = 215; s < 545; s += 26) add(Math.cos(a) * s, Math.sin(a) * s, 0, 24, 6, 6, a, 2);
  }
  // inner disc: concentric rings of panels with a hole
  for (let ring = 0; ring < 6; ring++) {
    const R = 52 + ring * 29;
    const n = Math.round((2 * Math.PI * R) / 21);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      add(Math.cos(a) * R, Math.sin(a) * R, -ring * 2 + (r() - 0.5) * 3, 28, 20.5, 10 + r() * 6, a, ring % 2 ? 0 : 2);
    }
  }
  // tunnel: short cylinder of plates round the hole
  for (let zz = 0; zz < 1; zz++)
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      add(Math.cos(a) * 41, Math.sin(a) * 41, -10 - zz * 22, 6, 11.5, 21, a, zz % 2);
    }
  // debris
  for (let i = 0; i < 140; i++) {
    const a = r() * Math.PI * 2;
    const R = 300 + r() * 330;
    const s = 6 + r() * 16;
    add(Math.cos(a) * R, Math.sin(a) * R, (r() - 0.5) * 140 + 30, s, s * (0.5 + r()), s, r() * 3, i % 3);
  }
  for (let m = 0; m < 3; m++) {
    const list = parts.filter((p) => p.m === m);
    const im = new THREE.InstancedMesh(box, mats[m], list.length);
    const o = new THREE.Object3D();
    list.forEach((p, i) => {
      o.position.set(p.x, p.y, p.z);
      o.rotation.set(0, 0, p.rz);
      o.scale.set(p.sx, p.sy, p.sz);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
    });
    g.add(im);
  }
  // cargo hauler (top left at the start)
  const cargo = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(34, 34, 300, 20), std(0x2c3036));
  hull.rotation.x = Math.PI / 2;
  hull.position.z = -150;
  cargo.add(hull);
  const lamp = new THREE.MeshBasicMaterial({color: 0xffb060});
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.SphereGeometry(5.5, 10, 8), lamp);
    l.position.set(Math.cos(a) * 20, Math.sin(a) * 20, 1);
    cargo.add(l);
  }
  const cap = new THREE.Mesh(new THREE.CircleGeometry(34, 24), std(0x1c1f24));
  cap.position.z = 0.5;
  cargo.add(cap);
  g.add(cargo);
  return {group: g, cargo, holeR: 41};
}

// ---------- station B: concentric banded rings ----------
// Radii measured from the reference at t = 5 s (distance 1,050 m): bands of segmented arcs round a dark core.
function stationB() {
  const g = new THREE.Group();
  const r = rand(11);
  const band = std(0x34373d, {metalness: 0.45, roughness: 0.55});
  const band2 = std(0x26292e, {metalness: 0.4, roughness: 0.6});
  const edge = std(0x8a8e95, {metalness: 0.5, roughness: 0.45});
  const dark = std(0x15181c, {metalness: 0.3, roughness: 0.8});
  const lamp = new THREE.MeshBasicMaterial({color: 0xdfe8ee, toneMapped: false});
  const box = new THREE.BoxGeometry(1, 1, 1);
  const parts = [];
  const add = (x, y, z, sx, sy, sz, rz, m) => parts.push({x, y, z, sx, sy, sz, rz, m});
  // core disc with the hole
  const core = new THREE.Mesh(new THREE.RingGeometry(40, 152, 96, 2), new THREE.MeshStandardMaterial({color: 0x0f1317, roughness: 0.9, side: THREE.DoubleSide}));
  g.add(core);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(41, 2.5, 8, 64), edge);
  g.add(lip);
  for (let i = 0; i < 90; i++) {
    const a = r() * Math.PI * 2;
    const R = 50 + r() * 98;
    add(Math.cos(a) * R, Math.sin(a) * R, 3, 5 + r() * 14, 3 + r() * 6, 3, a, 1);
  }
  // segmented bands [inner, outer, z, segments]
  const BANDS = [[160, 190, -6, 10], [210, 250, -12, 12], [270, 300, -4, 14], [330, 410, -16, 16], [425, 470, -8, 18], [490, 565, 0, 1]];
  BANDS.forEach(([ri, ro, z, n], k) => {
    const gap = n > 1 ? 0.06 : 0;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 + gap + r() * 0.2;
      const len = (Math.PI * 2) / n - gap * 2;
      const depth = k === 5 ? 70 : 14 + r() * 10;
      const shape = new THREE.Shape();
      shape.absarc(0, 0, ro, a0, a0 + len, false);
      shape.absarc(0, 0, ri, a0 + len, a0, true);
      const geo = new THREE.ExtrudeGeometry(shape, {depth, bevelEnabled: false, curveSegments: Math.max(6, Math.round(len * 20))});
      const m = new THREE.Mesh(geo, k % 2 ? band2 : band);
      m.position.z = z - depth;
      g.add(m);
      // a lit edge strip and a few lamps on each arc
      const steps = Math.max(3, Math.round(len * 10));
      for (let j = 0; j < steps; j++) {
        const a = a0 + (j + 0.5) * (len / steps);
        add(Math.cos(a) * (ro - 2), Math.sin(a) * (ro - 2), z + 1, 3, (len / steps) * ro * 0.8, 2, a, 0);
        if (r() < 0.5) {
          const L = new THREE.Mesh(new THREE.SphereGeometry(1.8, 6, 4), lamp);
          const rr = ri + r() * (ro - ri);
          L.position.set(Math.cos(a) * rr, Math.sin(a) * rr, z + 2);
          g.add(L);
        }
      }
    }
  });
  // spokes tie the bands together
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    add(Math.cos(a) * 360, Math.sin(a) * 360, -10, 420, 9, 9, a, 2);
  }
  const mats = [edge, band2, dark];
  for (let m = 0; m < 3; m++) {
    const list = parts.filter((p) => p.m === m);
    const im = new THREE.InstancedMesh(box, mats[m], list.length);
    const o = new THREE.Object3D();
    list.forEach((p, i) => {
      o.position.set(p.x, p.y, p.z);
      o.rotation.set(0, 0, p.rz);
      o.scale.set(p.sx, p.sy, p.sz);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
    });
    g.add(im);
  }
  // shuttle passing the camera early on
  const cargo = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 90, 16), std(0x8a8f96, {metalness: 0.4, roughness: 0.5}));
  body.rotation.z = Math.PI / 2;
  cargo.add(body);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(11, 13, 14, 16), dark);
  nose.rotation.z = Math.PI / 2;
  nose.position.x = 50;
  cargo.add(nose);
  g.add(cargo);
  return {group: g, cargo, holeR: 40};
}

// ---------- ships (camera-attached) ----------
function glowSprite(color, size) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(200,255,250,0.9)');
  gr.addColorStop(0.12, 'rgba(120,245,235,0.8)');
  gr.addColorStop(0.3, color);
  gr.addColorStop(0.5, color.replace(/[\d.]+\)$/, '0.35)'));
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 128, 128);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false}));
  s.scale.set(size, size, 1);
  return s;
}

function shipA() {
  const g = new THREE.Group();
  const white = std(0xb4b1aa, {roughness: 0.6});
  const grey = std(0x74777b, {roughness: 0.6});
  const dark = std(0x26292e);
  // fuselage
  const fus = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.8, 13), white);
  g.add(fus);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 9), grey);
  spine.position.set(0, 1.35, -1);
  g.add(spine);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.4, 5, 4), white);
  nose.rotation.x = -Math.PI / 2;
  nose.rotation.y = Math.PI / 4;
  nose.position.z = -9;
  g.add(nose);
  for (const sx of [-0.55, 0.55]) {
    const port = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.2), dark);
    port.position.set(sx, -0.25, 6.55);
    g.add(port);
  }
  // swept wings
  const wing = new THREE.Shape();
  wing.moveTo(0, -4.5);
  wing.lineTo(16.5, 3.4);
  wing.lineTo(16.5, 4.6);
  wing.lineTo(0, 5.2);
  const wg = new THREE.ExtrudeGeometry(wing, {depth: 0.25, bevelEnabled: false});
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(wg, white);
    w.rotation.x = Math.PI / 2;
    w.rotation.y = s * deg(5);
    w.scale.x = s;
    w.position.set(0, -0.2, 0.5);
    g.add(w);
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 7, 8), dark);
    gun.rotation.x = Math.PI / 2;
    gun.position.set(s * 16.6, -0.2, 3.6);
    g.add(gun);
    // nacelle
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 7.5, 20), grey);
    nac.rotation.x = Math.PI / 2;
    nac.position.set(s * 3.6, -0.1, 3.2);
    g.add(nac);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.18, 8, 24), dark);
    ring.position.set(s * 3.6, -0.1, 6.95);
    g.add(ring);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.0, 24), new THREE.MeshBasicMaterial({color: 0x9ff0e8, toneMapped: false}));
    glow.position.set(s * 3.6, -0.1, 6.97);
    g.add(glow);
    const sp = glowSprite('rgba(60,230,220,0.9)', 3.0);
    sp.position.set(s * 3.6, -0.1, 7.3);
    g.add(sp);
    // tall fin on each nacelle, canted outward
    const fin = new THREE.Shape();
    fin.moveTo(-3.2, 0);
    fin.lineTo(2.2, 0);
    fin.lineTo(2.9, 5.2);
    fin.lineTo(1.6, 5.2);
    const fm = new THREE.Mesh(new THREE.ExtrudeGeometry(fin, {depth: 0.32, bevelEnabled: false}), s < 0 ? white : grey);
    fm.rotation.y = -Math.PI / 2;
    const fg = new THREE.Group();
    fg.add(fm);
    fg.position.set(s * 3.6, 1.0, 3.6);
    fg.rotation.z = s * deg(-16);
    g.add(fg);
  }
  return g;
}

function shipB() {
  // original box-wing: central hull, an upper and a lower straight wing, end plates, an engine at each wing root
  const g = new THREE.Group();
  const hullM = std(0x4c4f55, {metalness: 0.5, roughness: 0.45});
  const panelM = std(0x7c7e82, {metalness: 0.4, roughness: 0.5});
  const dark = std(0x24272c, {metalness: 0.4});
  const amber = new THREE.MeshBasicMaterial({color: 0xffa24a});
  const hull = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.0, 14), hullM);
  g.add(hull);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 6), panelM);
  nose.position.z = -9.5;
  g.add(nose);
  for (const sy of [1, -1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(26, 0.3, 3.2), panelM);
    w.position.set(0, sy * 2.6, 2.2);
    w.rotation.z = 0;
    g.add(w);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(26, 0.35, 0.5), dark);
    edge.position.set(0, sy * 2.6, 4.1);
    g.add(edge);
    for (const sx of [-1, 1]) {
      const nac = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 8, 22), hullM);
      nac.rotation.x = Math.PI / 2;
      nac.position.set(sx * 3.9, sy * 2.6, 2.2);
      g.add(nac);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.2, 8, 24), dark);
      ring.position.set(sx * 3.9, sy * 2.6, 5.95);
      g.add(ring);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.8, 24), new THREE.MeshBasicMaterial({color: 0x9ff0e8, toneMapped: false}));
      glow.position.set(sx * 3.9, sy * 2.6, 5.97);
      g.add(glow);
      const sp = glowSprite('rgba(60,230,220,0.9)', 2.4);
      sp.position.set(sx * 3.9, sy * 2.6, 6.3);
      g.add(sp);
      const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 8, 8), dark);
      gun.rotation.x = Math.PI / 2;
      gun.position.set(sx * 13.2, sy * 2.6, 0.5);
      g.add(gun);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), amber);
      lamp.position.set(sx * 13.2, sy * 2.6, 4.1);
      g.add(lamp);
    }
  }
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 3), new THREE.MeshStandardMaterial({color: 0x101418, metalness: 0.8, roughness: 0.2}));
  canopy.position.set(0, 1.8, -4);
  g.add(canopy);
  return g;
}

// ---------- panel ----------
export const STYLES = {
  A: {
    sky: {glowDir: [-0.75, 0.45, -0.5], glow: [0.22, 0.16, 0.11], skyBase: [0.085, 0.078, 0.07], stars: 0.002},
    planet: {planetDir: [-0.141, -0.530, -0.836], planetAng: 54.1, sun: [-0.6, 0.6, 0.5], deep: [0.035, 0.14, 0.19], shallow: [0.4, 0.6, 0.72], hazePow: 2.2, cloud: [0.82, 0.86, 0.9], rim: [0.5, 0.7, 0.85], cloudBlock: 90, cloudAmt: 0.02, cloudScale: 34, planetSpin: [0.3, 0.2, 0], land: [0.2, 0.3, 0.3], landAmt: 0},
    light: {sun: [-0.5, 0.8, 0.6], sunI: 2.6, amb: 0.55, hemiSky: 0x9ec6de, hemiGround: 0x1a2a38},
    ship: {pos: [0.05, -7.28, -35.16], rot: [deg(7.46), 0, 0], glow: 3.0},
    fov: 60,
  },
  B: {
    sky: {glowDir: [0.8, 0.45, -0.4], glow: [0.95, 0.72, 0.58], skyBase: [0.07, 0.065, 0.06], stars: 0.002},
    planet: {planetDir: [-0.156, -0.545, -0.824], planetAng: 54.55, sun: [0.6, 0.6, 0.5], deep: [0.03, 0.1, 0.14], shallow: [0.42, 0.58, 0.64], hazePow: 2.2, cloud: [0.8, 0.84, 0.86], rim: [0.5, 0.68, 0.8], cloudBlock: 0, cloudAmt: 0.04, cloudScale: 40, planetSpin: [0.1, 0.4, 0], land: [0.25, 0.32, 0.3], landAmt: 0.25},
    light: {sun: [0.6, 0.7, 0.5], sunI: 3.0, amb: 0.35, hemiSky: 0xb0c8d8, hemiGround: 0x20262e},
    ship: {pos: [0.13, -4.85, -34.05], rot: [deg(13.7), 0, 0], glow: 3.2},
    fov: 60,
  },
};

export function createPanel(side, canvas, size) {
  const S = STYLES[side];
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true});
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const back = buildBackdrop({...S.sky, ...S.planet});
  const backCam = new THREE.PerspectiveCamera(S.fov, 1, 0.01, 100);

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(S.fov, 1, 0.5, 20000);
  scene.add(cam);
  const sun = new THREE.DirectionalLight(0xffffff, S.light.sunI);
  sun.position.set(...S.light.sun);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(S.light.hemiSky, S.light.hemiGround, S.light.amb * 2));
  const st = side === 'A' ? stationA() : stationB();
  scene.add(st.group);
  const ship = side === 'A' ? shipA() : shipB();
  ship.position.set(...S.ship.pos);
  ship.rotation.set(...S.ship.rot);
  cam.add(ship);
  // ship-local light so it reads like the reference (key from above-front)
  const shipKey = new THREE.DirectionalLight(0xffffff, 0.5);
  shipKey.position.set(0, 1, 0.3);
  cam.add(shipKey);
  shipKey.target = ship;

  return {renderer, back, backCam, scene, cam, ship, station: st, S, side};
}

// Camera pose: d = distance along the station axis (negative = past the core), az/el = approach angles (deg),
// yaw/pitch = where the camera looks relative to straight down the axis (deg), roll (deg).
export function poseCamera(P, c) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(c.el), deg(c.az), 0, 'YXZ'));
  const pos = new THREE.Vector3(c.ox || 0, c.oy || 0, c.d).applyQuaternion(q);
  P.cam.position.copy(pos);
  const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(c.el + c.pitch), deg(c.az + c.yaw), deg(c.roll), 'YXZ'));
  P.cam.quaternion.copy(look);
  P.cam.updateMatrixWorld(true);
}

export function drawPanel(P, t, c, shade = 1) {
  poseCamera(P, c);
  P.backCam.quaternion.copy(P.cam.quaternion);
  P.backCam.updateMatrixWorld(true);
  P.back.traverse((o) => o.material?.uniforms?.uCam && o.material.uniforms.uCam.value.set(0, 0, 0));
  // moving traffic
  const cg = P.station.cargo;
  if (P.side === 'A') {
    cg.position.set(-430 - t * 25, 330 + t * 4, 220);
    cg.rotation.set(deg(-8), deg(-35), 0);
  } else {
    cg.position.set(-60 - t * 55, 20 + t * 6, 1500);
    cg.rotation.set(0, deg(-20), 0);
  }
  // inside the core the ship falls into shade
  P.ship.traverse((o) => {
    if (o.isMesh && o.material.isMeshStandardMaterial) {
      o.material.userData.base ??= o.material.color.clone();
      o.material.color.copy(o.material.userData.base).multiplyScalar(shade);
    }
  });
  const r = P.renderer;
  r.clear();
  r.render(P.back, P.backCam);
  r.clearDepth();
  r.render(P.scene, P.cam);
}
