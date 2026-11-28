// Everything the reference shows as a number, measured from it (0.25 s strips) and replayed per frame.
// A = left panel, B = right panel. Times are video seconds (241 frames at 24 fps).

export const FPS = 24;
export const FRAMES = 241;
export const DURATION = FRAMES / FPS;

// Build-time counters under each title: minutes.seconds, linear from 0 to the final value, 0.088 s .. 9.543 s.
export const COUNTER = {A: {final: 1080}, B: {final: 1740}, t0: 0.088, t1: 9.543};
export const counterText = (side, t) => {
  const f = Math.min(1, Math.max(0, (t - COUNTER.t0) / (COUNTER.t1 - COUNTER.t0)));
  const s = Math.round(COUNTER[side].final * f);
  return `${Math.floor(s / 60)}.${String(s % 60).padStart(2, '0')} minutes`;
};

// In-game mission clock (runs in real time).
export const MISSION0 = {A: 83.0, B: 71.4};
export const missionText = (side, t) => {
  const s = MISSION0[side] + t;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}`;
};

// Readouts every 0.25 s from t = 0.
const SPEED = {
  A: [828, 831, 833, 834, 832, 830, 826, 823, 822, 823, 825, 828, 831, 834, 834, 832, 829, 826, 823, 822, 823, 825, 829, 832, 834, 834, 832, 829, 826, 823, 822, 830, 845, 861, 872, 874, 874, 872, 869, 865, 863],
  B: [905, 911, 914, 912, 905, 899, 896, 898, 904, 911, 914, 912, 906, 900, 896, 898, 904, 910, 914, 912, 907, 900, 896, 897, 903, 910, 914, 913, 908, 901, 896, 904, 922, 941, 953, 953, 948, 941, 937, 937, 941],
};
const ENERGY = {
  A: [92, 91, 90, 90, 89, 88, 88, 87, 86, 85, 85, 84, 83, 82, 82, 81, 80, 79, 78, 78, 77, 76, 76, 75, 74, 73, 73, 72, 71, 70, 70, 69, 68, 67, 66, 66, 65, 64, 64, 63, 62],
  B: [78, 77, 77, 76, 76, 75, 74, 74, 73, 72, 72, 71, 70, 70, 69, 69, 68, 67, 67, 66, 66, 65, 64, 64, 63, 62, 62, 61, 60, 60, 59, 59, 58, 57, 57, 56, 56, 55, 54, 54, 53],
};
// shield: [value before, after first hit, after second hit] with the hit times
const SHIELD = {A: [[0, 86], [8.5, 84], [8.75, 81]], B: [[0, 64], [8.5, 62], [8.75, 59]]};

const table = (arr, t) => {
  const i = Math.min(arr.length - 1, Math.max(0, Math.floor(t * 4 + 1e-6)));
  return arr[i];
};
const lerpTable = (arr, t) => {
  const x = Math.min(arr.length - 1, Math.max(0, t * 4));
  const i = Math.floor(x);
  const f = x - i;
  return arr[i] + (arr[Math.min(arr.length - 1, i + 1)] - arr[i]) * f;
};
export const speedAt = (side, t) => Math.round(lerpTable(SPEED[side], t));
export const energyAt = (side, t) => table(ENERGY[side], t);
export const shieldAt = (side, t) => {
  let v = SHIELD[side][0][1];
  for (const [tt, s] of SHIELD[side]) if (t >= tt) v = s;
  return v;
};
// distance to the station core: starts at D0 and falls with the integrated speed (km/h → m/s)
const D0 = {A: 2083, B: 2247};
export const distanceAt = (side, t) => {
  let d = D0[side];
  const dt = 1 / 48;
  for (let x = 0; x < t; x += dt) d -= (lerpTable(SPEED[side], x) / 3.6) * Math.min(dt, t - x);
  return Math.max(0, Math.round(d));
};

// HUD events (both panels)
export const EVENTS = {
  amber: [6.9, 7.9], // target brackets turn amber and open wide
  bracketsOff: 7.9,
  proximity: [7.75, 8.85], // red PROXIMITY ALERT banner and red panel edge
  complete: 9.2, // OBJECTIVE COMPLETE banner + ticked box
};

// Compass strip: heading in degrees at t (centre of the strip). Labels every 15°.
export const HEADING = {A: [[0, 18.2], [5, 14.4], [9.5, 11.9], [10.1, 11.6]], B: [[0, 53.2], [5, 49.4], [9.5, 46.8], [10.1, 46.5]]};
// Aim reticle centre in panel px (same path in both games)
export const RETICLE = [[0, 428, 406], [5, 442, 435], [9.5, 450, 450], [10.1, 450, 450]];
export const reticleAt = (t) => {
  const k = RETICLE;
  for (let i = 0; i < k.length - 1; i++)
    if (t <= k[i + 1][0]) {
      const f = (t - k[i][0]) / (k[i + 1][0] - k[i][0]);
      return [k[i][1] + (k[i + 1][1] - k[i][1]) * f, k[i][2] + (k[i + 1][2] - k[i][2]) * f];
    }
  return [450, 450];
};
export const headingAt = (side, t) => {
  const k = HEADING[side];
  for (let i = 0; i < k.length - 1; i++)
    if (t <= k[i + 1][0]) return k[i][1] + ((k[i + 1][1] - k[i][1]) * (t - k[i][0])) / (k[i + 1][0] - k[i][0]);
  return k[k.length - 1][1];
};
