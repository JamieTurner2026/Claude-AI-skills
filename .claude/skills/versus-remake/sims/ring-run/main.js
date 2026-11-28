// Split-screen "two builds of the same game" film, 1876x1030 at 24 fps.
// window.SIM.render(t) draws one frame (pure in t); window.FILM exposes the parts for the camera fitter.
import * as THREE from 'three';
import {createPanel, drawPanel} from './world.js';
import {createHud} from './hud.js';
import {counterText, DURATION, FPS} from './data.js';
import {camAt, fittedCam} from './camera.js';

const LABEL = {A: 'Build A', B: 'Build B'};
const PANEL = 900;
const app = document.getElementById('app');
app.innerHTML = `
<div id="film">
  ${['A', 'B'].map((s) => `
  <div class="head h${s}"><div class="name">${LABEL[s]}</div><div class="mins" id="m${s}"></div></div>
  <div class="panel p${s}"><canvas id="c${s}" width="${PANEL}" height="${PANEL}"></canvas><div class="hud" id="h${s}"></div></div>`).join('')}
</div>`;

const panels = {};
for (const s of ['A', 'B']) {
  panels[s] = createPanel(s, document.getElementById(`c${s}`), PANEL);
  panels[s].hud = createHud(document.getElementById(`h${s}`), s);
}

const v = new THREE.Vector3();
const CARGO_TAG = [82, 77]; // tag offset from the hauler's lit end, px
function targetOf(P, d) {
  v.set(0, 0, 0).project(P.cam);
  if (v.z > 1) return null;
  const f = PANEL / 2 / Math.tan(THREE.MathUtils.degToRad(P.cam.fov / 2));
  return {x: (v.x * 0.5 + 0.5) * PANEL, y: (-v.y * 0.5 + 0.5) * PANEL, size: (f * 240) / Math.max(30, d)};
}
// the ship falls into shade inside the core tunnel
const shadeAt = (t) => {
  const a = Math.min(1, Math.max(0, (t - 8.35) / 0.25));
  const b = Math.min(1, Math.max(0, (t - 8.95) / 0.3));
  return 1 - 0.75 * a * (1 - b);
};

function draw3d(side, t, c) {
  drawPanel(panels[side], t, c, shadeAt(t));
}

function render(t) {
  for (const s of ['A', 'B']) {
    const c = fittedCam(s, t);
    draw3d(s, t, c);
    let cargo = null;
    if (s === 'A') {
      v.setFromMatrixPosition(panels[s].station.cargo.matrixWorld).project(panels[s].cam);
      if (v.z < 1) cargo = {x: (v.x * 0.5 + 0.5) * PANEL + CARGO_TAG[0], y: (-v.y * 0.5 + 0.5) * PANEL + CARGO_TAG[1]};
    }
    panels[s].hud.update(t, targetOf(panels[s], c.d), cargo);
    document.getElementById(`m${s}`).textContent = counterText(s, t);
  }
}

window.FILM = {panels, camAt, fittedCam, draw3d, PANEL};
window.SIM = {ready: false, duration: DURATION, fps: FPS, render};
document.fonts.ready.then(() => {
  render(0);
  window.SIM.ready = true;
});
