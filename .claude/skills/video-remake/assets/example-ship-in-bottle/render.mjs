// Render the two-panel ship-in-a-bottle video.
//   node render.mjs --stills 0,5.5,13.5 --out out/stills   quick check frames (composited)
//   node render.mjs --fps 60 --out out/video               full 17 s video -> out/video/ship-in-bottle.mp4
// Options: --labelA "Version A" --subA "Lantern Strait" --labelB "Version B" --subB "The Bottled Sea"
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
const OUT = path.resolve(args.out || 'out/video');
const FPS = Number(args.fps || 60);
const DUR = Number(args.duration || 17.0);
const stills = args.stills ? args.stills.split(',').map(Number) : null;
const labels = {
  A: [args.labelA || 'Version A', args.subA || 'Lantern Strait'],
  B: [args.labelB || 'Version B', args.subB || 'The Bottled Sea'],
};
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

// one browser per panel so the two software-rendered panels run in parallel
const browsers = [];
async function openPanel(style) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  browsers.push(browser);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.error(`[${style}]`, e.message));
  page.on('console', (m) => m.type() === 'error' && console.error(`[${style}]`, m.text()));
  await page.goto(`http://localhost:${port}/index.html?style=${style}${args.query ? '&' + args.query : ''}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  return page;
}
const pages = { A: await openPanel('A'), B: await openPanel('B') };

const times = stills ?? Array.from({ length: Math.round(DUR * FPS) }, (_, i) => i / FPS);
const dirs = { A: path.join(OUT, 'A'), B: path.join(OUT, 'B') };
Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));
const t0 = Date.now();
await Promise.all(['A', 'B'].map(async (s) => {
  for (let i = 0; i < times.length; i++) {
    const file = path.join(dirs[s], `${String(i).padStart(5, '0')}.png`);
    if (!stills && fs.existsSync(file)) continue; // resume
    await pages[s].evaluate((t) => window.renderAt(t), times[i]);
    await pages[s].screenshot({ path: file });
    if (i % 30 === 0) console.log(`[${s}] frame ${i}/${times.length}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}));
await Promise.all(browsers.map((b) => b.close()));
server.close();

// ---- compose: 96px label bar + 720 panel, twice -> 1280x1632 ----
const font = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\u2019");
const bar = (l, sub) => `color=c=0x0d1b1e:s=1280x96,drawtext=fontfile=${font}:text='${esc(l)}':fontcolor=white:fontsize=36:x=(w-tw)/2:y=4,drawtext=fontfile=${font}:text='${esc(sub)}':fontcolor=0x4ee07a:fontsize=30:x=(w-tw)/2:y=52`;
const fg = `${bar(...labels.A)}[ba];${bar(...labels.B)}[bb];[ba][0:v][bb][1:v]vstack=inputs=4:shortest=1,format=yuv420p[v]`;
if (stills) {
  times.forEach((t, i) => {
    const n = String(i).padStart(5, '0');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dirs.A, `${n}.png`), '-i', path.join(dirs.B, `${n}.png`),
      '-filter_complex', fg.replace(',format=yuv420p', ''), '-map', '[v]', '-frames:v', '1', path.join(OUT, `still_${t}.png`)]);
  });
  console.log('stills ->', OUT);
} else {
  const audio = path.join(OUT, 'ambience.wav');
  // soft sea ambience: filtered noise with slow swell + low pad
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `anoisesrc=d=${DUR}:c=pink:r=44100:a=0.35:seed=7`,
    '-f', 'lavfi', '-i', `sine=f=110:d=${DUR}:r=44100`, '-f', 'lavfi', '-i', `sine=f=164.8:d=${DUR}:r=44100`,
    '-filter_complex', `[0]lowpass=f=900,volume='0.55+0.45*sin(2*PI*t/5.5)':eval=frame[n];[1]volume=0.05[s1];[2]volume=0.035[s2];[n][s1][s2]amix=inputs=3:normalize=0,afade=t=in:d=1,afade=t=out:st=${DUR - 1.2}:d=1.2,volume=0.5,pan=stereo|c0=c0|c1=c0[a]`,
    '-map', '[a]', audio]);
  const mp4 = path.join(OUT, 'ship-in-bottle.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', path.join(dirs.A, '%05d.png'), '-framerate', String(FPS), '-i', path.join(dirs.B, '%05d.png'), '-i', audio,
    '-filter_complex', fg, '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-r', String(args.outfps || 60), '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', mp4]);
  console.log('video ->', mp4);
}
