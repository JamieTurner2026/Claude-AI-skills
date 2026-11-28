// Scripted camera per panel plus fitted corrections (cam_fix.json, written by scripts/fit_camera.mjs).
import {distanceAt} from './data.js';
import FIX from './cam_fix.json';

export const KEYS = ['d', 'az', 'el', 'yaw', 'pitch', 'roll', 'ox', 'oy'];

// [t, {az, el, yaw, pitch, roll}] — d comes from the distance readout (camera sits CAM_BACK behind the ship).
const SCRIPT = {
  A: [
    [0, {az: 7, el: 9, yaw: -3.4, pitch: -7.8, roll: -4}],
    [5, {az: 3, el: 5, yaw: -1.9, pitch: -4.6, roll: -2}],
    [8.6, {az: 0, el: 0, yaw: 0, pitch: 0, roll: 0}],
    [10.1, {az: 0, el: 0, yaw: 0, pitch: 0, roll: 0}],
  ],
  B: [
    [0, {az: 4, el: 7, yaw: -3.4, pitch: -7.8, roll: 2}],
    [5, {az: 2, el: 4, yaw: -1.9, pitch: -4.6, roll: 1}],
    [8.6, {az: 0, el: 0, yaw: 0, pitch: 0, roll: 0}],
    [10.1, {az: 0, el: 0, yaw: 0, pitch: 0, roll: 0}],
  ],
};
export const CAM_BACK = 24;

const smooth = (x) => x * x * (3 - 2 * x);
export function camAt(side, t) {
  const k = SCRIPT[side];
  let i = 0;
  while (i < k.length - 2 && t > k[i + 1][0]) i++;
  const [t0, a] = k[i];
  const [t1, b] = k[i + 1];
  const f = smooth(Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));
  const c = {};
  for (const key of Object.keys(a)) c[key] = a[key] + (b[key] - a[key]) * f;
  // distance: readout until the core, then keep flying at the last speed
  c.d = distanceAt(side, t) + CAM_BACK;
  if (t > 8.6) c.d = distanceAt(side, 8.6) + CAM_BACK - (t - 8.6) * 243;
  c.ox = 0;
  c.oy = 0;
  return c;
}

export function camFix(side, t) {
  const rows = FIX[side] || [];
  if (!rows.length) return {};
  if (t <= rows[0][0]) return rows[0][1];
  if (t >= rows[rows.length - 1][0]) return rows[rows.length - 1][1];
  let i = 0;
  while (t > rows[i + 1][0]) i++;
  const [t0, a] = rows[i];
  const [t1, b] = rows[i + 1];
  const f = (t - t0) / (t1 - t0);
  const o = {};
  for (const key of KEYS) o[key] = (a[key] ?? 0) + ((b[key] ?? 0) - (a[key] ?? 0)) * f;
  return o;
}

export function fittedCam(side, t) {
  const c = camAt(side, t);
  const f = camFix(side, t);
  for (const key in f) c[key] = (c[key] ?? 0) + f[key];
  return c;
}
