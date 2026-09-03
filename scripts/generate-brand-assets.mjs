#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const background = (await readFile(join(ROOT, 'assets', 'readme', 'hero-background.png'))).toString('base64');

async function render({ width, height, output, social = false }) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;font-family:Inter,Segoe UI,Arial,sans-serif;background:#050914;color:#fff}
    .canvas{position:relative;width:100%;height:100%;isolation:isolate;background-image:linear-gradient(90deg,rgba(4,8,20,.22),rgba(4,8,20,.05) 50%,rgba(4,8,20,.18)),url(data:image/png;base64,${background});background-size:cover;background-position:center}
    .canvas:after{content:'';position:absolute;inset:0;z-index:-1;background:radial-gradient(circle at 50% 72%,transparent 0 22%,rgba(2,6,18,.36) 62%,rgba(2,6,18,.76) 100%)}
    .content{position:absolute;left:${social ? 70 : 88}px;top:${social ? 62 : 65}px;width:${social ? 940 : 1140}px}
    .eyebrow{font-size:${social ? 18 : 20}px;letter-spacing:.18em;font-weight:750;color:#9fb4d8;text-transform:uppercase}
    h1{margin:${social ? 25 : 30}px 0 0;font-size:${social ? 68 : 82}px;line-height:.96;letter-spacing:-.055em;max-width:${social ? 1000 : 1250}px;font-weight:850;text-shadow:0 4px 32px #02040a}
    h1 span{background:linear-gradient(90deg,#ffbe63 0%,#f5f7ff 47%,#76d7ff 70%,#b892ff 100%);-webkit-background-clip:text;color:transparent}
    .tag{margin-top:${social ? 25 : 28}px;font-size:${social ? 24 : 27}px;color:#d8e1f2;line-height:1.35;max-width:${social ? 850 : 1050}px;text-shadow:0 2px 16px #02040a}
    .stats{display:flex;gap:12px;margin-top:${social ? 30 : 34}px}.pill{padding:${social ? '10px 16px' : '11px 18px'};border:1px solid rgba(190,211,255,.28);border-radius:999px;background:rgba(4,9,24,.68);backdrop-filter:blur(8px);font-weight:700;font-size:${social ? 17 : 18}px;color:#f4f7ff}.pill b{color:#75dcff}
    .mark{position:absolute;right:${social ? 58 : 72}px;top:${social ? 48 : 52}px;width:${social ? 64 : 72}px;height:${social ? 64 : 72}px;border:2px solid rgba(255,255,255,.48);border-radius:18px;display:grid;place-items:center;background:rgba(2,7,18,.5);box-shadow:0 0 40px rgba(108,120,255,.2)}
    .mark:before,.mark:after{content:'';position:absolute;width:22px;height:34px;border:4px solid}.mark:before{left:12px;border-color:#ffad45 transparent #ffad45 #ffad45;border-radius:7px 0 0 7px}.mark:after{right:12px;border-color:#73d7ff #73d7ff #73d7ff transparent;border-radius:0 7px 7px 0}
    .foot{position:absolute;right:${social ? 58 : 72}px;bottom:${social ? 42 : 38}px;color:#99aac8;font-weight:650;font-size:${social ? 16 : 17}px;letter-spacing:.04em}
  </style><body><div class="canvas"><div class="content"><div class="eyebrow">OPEN-SOURCE VISUAL CODE BENCHMARK</div><h1>Claude × Codex<br><span>× Any Model</span></h1><div class="tag">One real prompt. Two isolated agents. Visual proof you can replay.</div><div class="stats"><div class="pill"><b>11</b> profiles</div><div class="pill"><b>20</b> prompts</div><div class="pill"><b>2</b> runners</div><div class="pill">Three.js + Twigl</div></div></div><div class="mark"></div><div class="foot">github.com/PenStairs</div></div></body></html>`);
  await page.screenshot({ path: join(ROOT, 'assets', 'readme', output), type: 'jpeg', quality: 91 });
  await browser.close();
}

await render({ width: 1600, height: 640, output: 'hero.jpg' });
await render({ width: 1280, height: 640, output: 'social-preview.jpg', social: true });
console.log(JSON.stringify({ ok: true, outputs: ['assets/readme/hero.jpg', 'assets/readme/social-preview.jpg'] }, null, 2));
