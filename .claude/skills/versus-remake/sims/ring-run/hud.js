// The flight HUD (DOM over the WebGL canvas), 900x900 panel px. Pure function of t and the panel state.
import {energyAt, shieldAt, speedAt, missionText, distanceAt, headingAt, reticleAt, EVENTS} from './data.js';

const seg = (n, cls) => Array.from({length: n}, () => `<i class="${cls}"></i>`).join('');

export function createHud(root, side) {
  root.innerHTML = `
  <div class="edge"></div>
  <div class="box obj"><div class="lab">OBJECTIVE</div><div class="txt">Fly through the ring<br>station core</div><div class="chk"><span>✓</span></div></div>
  <div class="box comp"><div class="tape"></div><div class="tri"></div></div>
  <div class="box mt"><div class="lab">MISSION TIME</div><div class="time"></div></div>
  <div class="banner alert">⚠ PROXIMITY ALERT ⚠</div>
  <div class="banner done">OBJECTIVE COMPLETE</div>
  <div class="box spd"><div class="lab">SPEED</div><div class="val"></div><div class="unit">km/h</div><div class="bar">${seg(10, 's')}</div></div>
  <div class="box se">
    <div class="lab">SHIELD</div><div class="pct p1"></div><div class="bar b1">${seg(20, 's')}</div>
    <div class="lab l2">ENERGY</div><div class="pct p2"></div><div class="bar b2">${seg(20, 's e')}</div>
  </div>
  <div class="keys"><b>W</b><b>S</b><span>THRUST</span><b>A</b><b>D</b><span>ROLL</span><b>SHIFT</b><span>BOOST</span><b>SPACE</b><span>FIRE</span></div>
  <svg class="radar" viewBox="-70 -70 140 140" width="140" height="140">
    <circle r="64" class="rr"/><circle r="43" class="rr"/><circle r="21" class="rr"/>
    <line x1="-64" y1="0" x2="64" y2="0" class="rr"/><line x1="0" y1="-64" x2="0" y2="64" class="rr"/>
    <g class="sweep"></g>
    <circle class="blip tgt" r="4.5" cx="0" cy="-48"/>
    <circle class="blip fr" r="3.5" cx="-2" cy="-10"/>
    <path d="M0,-7 L5.5,6 L-5.5,6 Z" class="me"/>
  </svg>
  <div class="rlab">RADAR 2.5 km</div>
  <div class="fbr"><i class="c1"></i><i class="c2"></i><i class="c3"></i><i class="c4"></i></div>
  <div class="ret"><svg viewBox="-40 -40 80 80" width="80" height="80"><circle r="24" class="rc"/><circle r="2" class="rd"/>
    <line x1="-40" y1="0" x2="-28" y2="0" class="rc"/><line x1="28" y1="0" x2="40" y2="0" class="rc"/>
    <line x1="0" y1="-40" x2="0" y2="-28" class="rc"/><line x1="0" y1="28" x2="0" y2="40" class="rc"/></svg></div>
  <div class="cg"><i></i><span>CARGO-7</span><em>FRIENDLY</em></div>
  <div class="tb"><i class="c1"></i><i class="c2"></i><i class="c3"></i><i class="c4"></i><div class="tl"><span>RING STATION</span><em></em></div></div>
  `;
  const q = (s) => root.querySelector(s);
  const el = {
    time: q('.time'), val: q('.spd .val'), spdSeg: [...root.querySelectorAll('.spd .bar i')],
    p1: q('.p1'), p2: q('.p2'), b1: [...root.querySelectorAll('.b1 i')], b2: [...root.querySelectorAll('.b2 i')],
    tape: q('.tape'), alert: q('.alert'), done: q('.done'), chk: q('.chk'), edge: q('.edge'),
    ret: q('.ret'), fbr: q('.fbr'), tb: q('.tb'), dist: q('.tb em'), sweep: q('.sweep'), tgt: q('.tgt'), cg: q('.cg'),
  };
  return {
    update(t, target, cargo) {
      if (cargo && t < 2.2) {
        el.cg.style.display = 'block';
        el.cg.style.transform = `translate(${cargo.x}px, ${cargo.y}px)`;
      } else el.cg.style.display = 'none';
      el.time.textContent = missionText(side, t);
      const v = speedAt(side, t);
      el.val.textContent = v;
      const on = Math.round(Math.min(10, (v / 1000) * 10));
      el.spdSeg.forEach((s, i) => s.classList.toggle('on', i < (side === 'A' ? 8 : 10)));
      const sh = shieldAt(side, t);
      const en = energyAt(side, t);
      el.p1.textContent = `${sh}%`;
      el.p2.textContent = `${en}%`;
      el.b1.forEach((s, i) => s.classList.toggle('on', i < Math.round(sh / 5)));
      el.b2.forEach((s, i) => s.classList.toggle('on', i < Math.round(en / 5)));
      // compass tape: 9 px per degree, ticks every 5°, labels every 15°
      const h = headingAt(side, t);
      let html = '';
      for (let a = Math.floor((h - 20) / 5) * 5; a <= h + 20; a += 5) {
        const x = 150 + (a - h) * 9;
        if (x < 4 || x > 296) continue;
        const major = a % 15 === 0;
        html += `<i style="left:${x.toFixed(1)}px" class="${major ? 'mj' : ''}"></i>`;
        if (major) html += `<b style="left:${x.toFixed(1)}px">${String(((a % 360) + 360) % 360).padStart(3, '0')}</b>`;
      }
      el.tape.innerHTML = html;
      const prox = EVENTS.proximityOn.some(([a, b]) => t >= a && t < b);
      el.alert.style.opacity = prox ? 1 : 0;
      el.edge.style.opacity = prox ? 1 : 0;
      const done = t >= EVENTS.complete;
      el.done.style.opacity = done ? 1 : 0;
      el.chk.classList.toggle('ok', done);
      const [rx, ry] = reticleAt(t);
      el.ret.style.transform = `translate(${rx - 40}px, ${ry - 40}px)`;
      el.fbr.style.transform = `translate(${rx}px, ${ry}px)`;
      // target brackets round the station core
      const amber = t >= EVENTS.amber[0] && t < EVENTS.amber[1];
      if (target && t < EVENTS.bracketsOff) {
        const s = Math.min(amber ? 620 : 420, Math.max(70, target.size));
        const w = amber ? s * 1.08 : s;
        const hh = amber ? s * 0.9 : s;
        el.tb.style.display = 'block';
        el.tb.className = amber ? 'tb amber' : 'tb';
        el.tb.style.left = `${target.x - w / 2}px`;
        el.tb.style.top = `${target.y - hh / 2}px`;
        el.tb.style.width = `${w}px`;
        el.tb.style.height = `${hh}px`;
        el.dist.textContent = `${distanceAt(side, t)} m`;
      } else el.tb.style.display = 'none';
      // radar sweep (one turn per 2.4 s) and target blip
      const ang = ((t / 2.4) * 360 + (side === 'A' ? 60 : 200)) % 360;
      let sw = '';
      for (let k = 0; k < 14; k++) {
        const a = ((ang - k * 2.2) * Math.PI) / 180;
        sw += `<line x1="0" y1="0" x2="${(Math.sin(a) * 62).toFixed(1)}" y2="${(-Math.cos(a) * 62).toFixed(1)}" style="opacity:${(0.9 - k * 0.06).toFixed(2)}"/>`;
      }
      el.sweep.innerHTML = sw;
      const r = Math.max(0, Math.min(1, distanceAt(side, t) / 2500)) * 62;
      el.tgt.setAttribute('cy', (-r).toFixed(1));
      el.tgt.style.opacity = t < 8.6 ? 1 : 0;
    },
  };
}
