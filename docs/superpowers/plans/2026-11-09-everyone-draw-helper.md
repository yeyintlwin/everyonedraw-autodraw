# Everyone Draw Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web page that converts an image to the everyonedraw palette and guides the user to draw it by hand, one color layer at a time, at a chosen canvas location.

**Architecture:** Pure logic lives in `core.js` (UMD: `window.EDCore` in the browser, `module.exports` in Node) and is unit-tested with `node --test`. `index.html` holds markup + CSS; `app.js` holds the DOM/UI logic and calls `EDCore`. No build step, no dependencies, works from `file://`.

**Tech Stack:** Vanilla JS (ES2020), HTML/CSS, Canvas 2D, Node 22 built-in test runner.

**Spec:** `docs/superpowers/specs/2026-11-09-everyone-draw-helper-design.md`

**Notes for the engineer:**
- The project folder is **not** a git repo and the user has not asked for commits — skip commit steps.
- UI text is Burmese. Keep it exactly as written.
- everyonedraw canvas coordinates: **x grows right, y grows UP**. The URL `https://everyonedraw.com/{zoom}/{x}/{y}` centers pixel (x, y) on screen.
- Never add code that clicks/draws on everyonedraw. The site bans bots; this tool only opens a URL for the human to click.

## File Structure

| File | Responsibility |
|---|---|
| `core.js` | Palettes, OKLab, nearest color, resize, quantize/dither, layers, next-pixel search, coordinates, URL parse/build, idx encode/decode |
| `core.test.js` | Unit tests for `core.js` (`node --test`) |
| `index.html` | Markup + CSS; loads `core.js` then `app.js` |
| `app.js` | State, image loading, grid rendering, layer list, hover/click, Next (N key), persistence, download, reset |

---

### Task 1: core.js skeleton — palettes, OKLab, nearest color

**Files:**
- Create: `core.js`
- Test: `core.test.js`

- [ ] **Step 1: Write the failing tests**

Create `core.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./core.js');

test('palettes: 16 web + 16 app colors', () => {
  assert.equal(C.PALETTE_WEB.length, 16);
  assert.equal(C.PALETTE_APP.length, 16);
  assert.equal(C.getPalette(false).length, 16);
  assert.equal(C.getPalette(true).length, 32);
  assert.deepEqual(C.getPalette(false)[7].rgb, [255, 0, 77]);
});

test('srgbToOklab: white L=1, black L=0', () => {
  const w = C.srgbToOklab(255, 255, 255);
  assert.ok(Math.abs(w[0] - 1) < 1e-3);
  assert.ok(Math.abs(w[1]) < 1e-3 && Math.abs(w[2]) < 1e-3);
  const k = C.srgbToOklab(0, 0, 0);
  assert.ok(Math.abs(k[0]) < 1e-9);
});

test('nearestColor: every palette color maps to itself', () => {
  for (const useApp of [false, true]) {
    const pal = C.getPalette(useApp);
    pal.forEach((p, i) => assert.equal(C.nearestColor(p.rgb[0], p.rgb[1], p.rgb[2], pal), i));
  }
});

test('nearestColor: pure white -> White, pure red -> Red', () => {
  const pal = C.getPalette(false);
  assert.equal(pal[C.nearestColor(255, 255, 255, pal)].name, 'White');
  assert.equal(pal[C.nearestColor(255, 0, 0, pal)].name, 'Red');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test core.test.js`
Expected: FAIL — `Cannot find module './core.js'`

- [ ] **Step 3: Write minimal implementation**

Create `core.js`:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EDCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PALETTE_WEB = [
    { name: 'Black', hex: '#000000' },
    { name: 'Dark Blue', hex: '#1D2B53' },
    { name: 'Dark Purple', hex: '#7E2553' },
    { name: 'Dark Gray', hex: '#5F574F' },
    { name: 'Brown', hex: '#AB5236' },
    { name: 'Dark Green', hex: '#008751' },
    { name: 'Lavender', hex: '#83769C' },
    { name: 'Red', hex: '#FF004D' },
    { name: 'Pink', hex: '#FF77A8' },
    { name: 'Blue', hex: '#29ADFF' },
    { name: 'Orange', hex: '#FFA300' },
    { name: 'Light Gray', hex: '#C2C3C7' },
    { name: 'Green', hex: '#00E436' },
    { name: 'Light Peach', hex: '#FFCCAA' },
    { name: 'Yellow', hex: '#FFEC27' },
    { name: 'White', hex: '#FFF1E8' },
  ];

  const PALETTE_APP = [
    { name: 'Brownish Black', hex: '#291814' },
    { name: 'Darker Blue', hex: '#111D35' },
    { name: 'Darker Purple', hex: '#422136' },
    { name: 'Darker Gray', hex: '#49333B' },
    { name: 'Dark Brown', hex: '#742F29' },
    { name: 'Blue Green', hex: '#125359' },
    { name: 'Mauve', hex: '#754665' },
    { name: 'True Blue', hex: '#065AB5' },
    { name: 'Dark Red', hex: '#BE1250' },
    { name: 'Medium Gray', hex: '#A28879' },
    { name: 'Dark Orange', hex: '#FF6C24' },
    { name: 'Dark Peach', hex: '#FF6E59' },
    { name: 'Medium Green', hex: '#00B543' },
    { name: 'Peach', hex: '#FF9D81' },
    { name: 'Lime Green', hex: '#A8E72E' },
    { name: 'Light Yellow', hex: '#F3EF7D' },
  ];

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function toLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function srgbToOklab(r, g, b) {
    const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  function getPalette(useApp) {
    const entries = useApp ? PALETTE_WEB.concat(PALETTE_APP) : PALETTE_WEB;
    return entries.map((e) => {
      const rgb = hexToRgb(e.hex);
      return { name: e.name, hex: e.hex, rgb, lab: srgbToOklab(rgb[0], rgb[1], rgb[2]) };
    });
  }

  function nearestColor(r, g, b, palette) {
    const [L, A, B] = srgbToOklab(r, g, b);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i].lab;
      const d = (L - p[0]) ** 2 + (A - p[1]) ** 2 + (B - p[2]) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  return { PALETTE_WEB, PALETTE_APP, getPalette, srgbToOklab, nearestColor };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test core.test.js`
Expected: PASS — 4 tests, 0 failures

---

### Task 2: resizeImage (area average, premultiplied alpha)

**Files:**
- Modify: `core.js` (add function before `return`, add to returned object)
- Test: `core.test.js` (append)

- [ ] **Step 1: Write the failing tests**

Append to `core.test.js`:

```js
test('resizeImage: 2x2 -> 1x1 averages colors', () => {
  const src = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 0, 255, 255,
    255, 0, 0, 255, 0, 0, 255, 255,
  ]);
  const out = C.resizeImage(src, 2, 2, 1);
  assert.equal(out.w, 1);
  assert.equal(out.h, 1);
  assert.deepEqual(Array.from(out.data), [128, 0, 128, 255]);
});

test('resizeImage: keeps aspect ratio', () => {
  const src = new Uint8ClampedArray(4 * 3 * 4).fill(255);
  const out = C.resizeImage(src, 4, 3, 2);
  assert.equal(out.w, 2);
  assert.equal(out.h, 2);
});

test('resizeImage: transparent pixels do not darken color, alpha is averaged', () => {
  const src = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]);
  const out = C.resizeImage(src, 2, 1, 1);
  assert.deepEqual(Array.from(out.data), [255, 0, 0, 128]);
});

test('resizeImage: fully transparent stays transparent', () => {
  const src = new Uint8ClampedArray(2 * 2 * 4);
  const out = C.resizeImage(src, 2, 2, 1);
  assert.equal(out.data[3], 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test core.test.js`
Expected: FAIL — `C.resizeImage is not a function`

- [ ] **Step 3: Write minimal implementation**

In `core.js`, add above `return { ... }`:

```js
  function resizeImage(rgba, w, h, newW) {
    newW = Math.max(1, Math.round(newW));
    const newH = Math.max(1, Math.round((h * newW) / w));
    const out = new Uint8ClampedArray(newW * newH * 4);
    const sx = w / newW, sy = h / newH;
    for (let dy = 0; dy < newH; dy++) {
      const y0 = dy * sy, y1 = y0 + sy;
      const yEnd = Math.min(h, Math.ceil(y1 - 1e-9));
      for (let dx = 0; dx < newW; dx++) {
        const x0 = dx * sx, x1 = x0 + sx;
        const xEnd = Math.min(w, Math.ceil(x1 - 1e-9));
        let r = 0, g = 0, b = 0, a = 0, wt = 0;
        for (let y = Math.floor(y0); y < yEnd; y++) {
          const wy = Math.min(y + 1, y1) - Math.max(y, y0);
          for (let x = Math.floor(x0); x < xEnd; x++) {
            const k = (Math.min(x + 1, x1) - Math.max(x, x0)) * wy;
            const i = (y * w + x) * 4;
            const al = rgba[i + 3] * k;
            r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al;
            a += al; wt += k;
          }
        }
        const o = (dy * newW + dx) * 4;
        if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
        out[o + 3] = wt > 0 ? a / wt : 0;
      }
    }
    return { data: out, w: newW, h: newH };
  }
```

Change the return line to:

```js
  return { PALETTE_WEB, PALETTE_APP, getPalette, srgbToOklab, nearestColor, resizeImage };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test core.test.js`
Expected: PASS — 8 tests, 0 failures

---

### Task 3: quantize (none / Floyd–Steinberg)

**Files:**
- Modify: `core.js`
- Test: `core.test.js` (append)

- [ ] **Step 1: Write the failing tests**

Append to `core.test.js`:

```js
test('quantize: maps colors, alpha < 128 becomes -1', () => {
  const pal = C.getPalette(false);
  const src = new Uint8ClampedArray([
    0, 0, 0, 255,
    255, 241, 232, 255,
    0, 0, 0, 0,
    0, 0, 0, 127,
  ]);
  const q = C.quantize(src, 4, 1, pal, 'none');
  assert.equal(q.w, 4);
  assert.equal(q.h, 1);
  assert.deepEqual(Array.from(q.idx), [0, 15, -1, -1]);
});

function grayImage(w, h, v) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) a.set([v, v, v, 255], i * 4);
  return a;
}

test('quantize none: flat gray -> one color', () => {
  const q = C.quantize(grayImage(8, 8, 140), 8, 8, C.getPalette(false), 'none');
  assert.equal(new Set(q.idx).size, 1);
});

test('quantize fs: flat gray -> mix of colors', () => {
  const q = C.quantize(grayImage(8, 8, 140), 8, 8, C.getPalette(false), 'fs');
  assert.ok(new Set(q.idx).size >= 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test core.test.js`
Expected: FAIL — `C.quantize is not a function`

- [ ] **Step 3: Write minimal implementation**

In `core.js`, add above `return { ... }`:

```js
  function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  }

  function quantize(rgba, w, h, palette, dither) {
    const n = w * h;
    const idx = new Int16Array(n);
    const buf = new Float32Array(n * 3);
    for (let p = 0; p < n; p++) {
      buf[p * 3] = rgba[p * 4];
      buf[p * 3 + 1] = rgba[p * 4 + 1];
      buf[p * 3 + 2] = rgba[p * 4 + 2];
    }
    const cache = new Map();
    const spread = (x, y, er, eg, eb, f) => {
      if (x < 0 || x >= w || y >= h) return;
      const q = (y * w + x) * 3;
      buf[q] += er * f; buf[q + 1] += eg * f; buf[q + 2] += eb * f;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (rgba[p * 4 + 3] < 128) { idx[p] = -1; continue; }
        const r = clamp255(buf[p * 3]), g = clamp255(buf[p * 3 + 1]), b = clamp255(buf[p * 3 + 2]);
        const key = (r << 16) | (g << 8) | b;
        let c = cache.get(key);
        if (c === undefined) { c = nearestColor(r, g, b, palette); cache.set(key, c); }
        idx[p] = c;
        if (dither === 'fs') {
          const pc = palette[c].rgb;
          const er = r - pc[0], eg = g - pc[1], eb = b - pc[2];
          spread(x + 1, y, er, eg, eb, 7 / 16);
          spread(x - 1, y + 1, er, eg, eb, 3 / 16);
          spread(x, y + 1, er, eg, eb, 5 / 16);
          spread(x + 1, y + 1, er, eg, eb, 1 / 16);
        }
      }
    }
    return { w, h, idx };
  }
```

Change the return line to:

```js
  return { PALETTE_WEB, PALETTE_APP, getPalette, srgbToOklab, nearestColor, resizeImage, quantize };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test core.test.js`
Expected: PASS — 11 tests, 0 failures

---

### Task 4: buildLayers + findNext

**Files:**
- Modify: `core.js`
- Test: `core.test.js` (append)

- [ ] **Step 1: Write the failing tests**

Append to `core.test.js`:

```js
const Q = { w: 3, h: 2, idx: Int16Array.from([2, 0, 2, -1, 2, 0]) };

test('buildLayers: groups by color, row-major, most pixels first', () => {
  assert.deepEqual(C.buildLayers(Q), [
    { colorIndex: 2, pixels: [0, 2, 4] },
    { colorIndex: 0, pixels: [1, 5] },
  ]);
});

test('findNext: walks layers from start, skips done, wraps, null when all done', () => {
  const layers = C.buildLayers(Q);
  assert.deepEqual(C.findNext(layers, new Set(), 0), { layer: 0, pixel: 0 });
  assert.deepEqual(C.findNext(layers, new Set([0, 2, 4]), 0), { layer: 1, pixel: 1 });
  assert.deepEqual(C.findNext(layers, new Set([1]), 1), { layer: 1, pixel: 5 });
  assert.deepEqual(C.findNext(layers, new Set([1, 5]), 1), { layer: 0, pixel: 0 });
  assert.equal(C.findNext(layers, new Set([0, 1, 2, 4, 5]), 0), null);
  assert.equal(C.findNext([], new Set(), 0), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test core.test.js`
Expected: FAIL — `C.buildLayers is not a function`

- [ ] **Step 3: Write minimal implementation**

In `core.js`, add above `return { ... }`:

```js
  function buildLayers(q) {
    const map = new Map();
    for (let p = 0; p < q.idx.length; p++) {
      const c = q.idx[p];
      if (c < 0) continue;
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(p);
    }
    return Array.from(map, ([colorIndex, pixels]) => ({ colorIndex, pixels }))
      .sort((a, b) => b.pixels.length - a.pixels.length || a.colorIndex - b.colorIndex);
  }

  function findNext(layers, done, startLayer) {
    for (let k = 0; k < layers.length; k++) {
      const layer = (startLayer + k) % layers.length;
      for (const pixel of layers[layer].pixels) {
        if (!done.has(pixel)) return { layer, pixel };
      }
    }
    return null;
  }
```

Change the return line to:

```js
  return {
    PALETTE_WEB, PALETTE_APP, getPalette, srgbToOklab, nearestColor, resizeImage, quantize,
    buildLayers, findNext,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test core.test.js`
Expected: PASS — 13 tests, 0 failures

---

### Task 5: toCanvas, parseLocation, siteUrl, encodeIdx/decodeIdx

**Files:**
- Modify: `core.js`
- Test: `core.test.js` (append)

- [ ] **Step 1: Write the failing tests**

Append to `core.test.js`:

```js
test('toCanvas: x grows right, y grows up', () => {
  assert.deepEqual(C.toCanvas(0, 0, 100, 200), { x: 100, y: 200 });
  assert.deepEqual(C.toCanvas(3, 2, 100, 200), { x: 103, y: 198 });
});

test('parseLocation: URLs and number pairs', () => {
  assert.deepEqual(C.parseLocation('https://everyonedraw.com/40/5000/-4994'), { x: 5000, y: -4994 });
  assert.deepEqual(C.parseLocation('everyonedraw.com/1/-101/-104'), { x: -101, y: -104 });
  assert.deepEqual(C.parseLocation('https://everyonedraw.com/2.5/7/8?x=1'), { x: 7, y: 8 });
  assert.deepEqual(C.parseLocation('12, -34'), { x: 12, y: -34 });
  assert.deepEqual(C.parseLocation('(12, -34)'), { x: 12, y: -34 });
  assert.deepEqual(C.parseLocation('  7 8 '), { x: 7, y: 8 });
  assert.equal(C.parseLocation('hello'), null);
  assert.equal(C.parseLocation(''), null);
  assert.equal(C.parseLocation(null), null);
});

test('siteUrl', () => {
  assert.equal(C.siteUrl(5000, -4994, 40), 'https://everyonedraw.com/40/5000/-4994');
});

test('encodeIdx/decodeIdx: one char per pixel, round-trips', () => {
  const idx = Int16Array.from([-1, 0, 15, 31, 7]);
  const s = C.encodeIdx(idx);
  assert.equal(s, '01gw8');
  assert.deepEqual(Array.from(C.decodeIdx(s)), Array.from(idx));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test core.test.js`
Expected: FAIL — `C.toCanvas is not a function`

- [ ] **Step 3: Write minimal implementation**

In `core.js`, add above `return { ... }`:

```js
  function toCanvas(c, r, X0, Y0) {
    return { x: X0 + c, y: Y0 - r };
  }

  function parseLocation(text) {
    const s = String(text == null ? '' : text).trim();
    const url = s.match(/everyonedraw\.com\/[\d.]+\/(-?\d+)\/(-?\d+)/i);
    if (url) return { x: Number(url[1]), y: Number(url[2]) };
    const pair = s.match(/^\(?\s*(-?\d+)\s*(?:,\s*|\s+)(-?\d+)\s*\)?$/);
    if (pair) return { x: Number(pair[1]), y: Number(pair[2]) };
    return null;
  }

  function siteUrl(x, y, zoom) {
    return `https://everyonedraw.com/${zoom}/${x}/${y}`;
  }

  function encodeIdx(idx) {
    return Array.from(idx, (c) => (c + 1).toString(36)).join('');
  }

  function decodeIdx(str) {
    return Int16Array.from(str, (ch) => parseInt(ch, 36) - 1);
  }
```

Change the return line to:

```js
  return {
    PALETTE_WEB, PALETTE_APP, getPalette, srgbToOklab, nearestColor, resizeImage, quantize,
    buildLayers, findNext, toCanvas, parseLocation, siteUrl, encodeIdx, decodeIdx,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test core.test.js`
Expected: PASS — 17 tests, 0 failures

---

### Task 6: index.html (markup + CSS)

**Files:**
- Create: `index.html`

- [ ] **Step 1: Create the file**

```html
<!doctype html>
<html lang="my">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Everyone Draw ပုံဆွဲအကူ</title>
<style>
  :root {
    --bg: #f6f5f2; --panel: #ffffff; --text: #1d1d1f; --muted: #6b6b70;
    --line: #e2e0da; --accent: #7e2553; --accent-soft: #f4e8ee; --danger: #d0103a; --ok: #00b543;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.6 system-ui, "Myanmar Text", "Noto Sans Myanmar", sans-serif; }
  header { padding: 12px 20px; border-bottom: 1px solid var(--line); background: var(--panel); }
  header h1 { margin: 0; font-size: 18px; }
  header p { margin: 2px 0 0; color: var(--muted); font-size: 13px; }
  .layout { display: grid; grid-template-columns: 280px 250px minmax(0, 1fr); gap: 16px; padding: 16px; align-items: start; }
  @media (max-width: 1000px) { .layout { grid-template-columns: 1fr; } }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px; }
  .card + .card { margin-top: 12px; }
  .card h2 { margin: 0 0 10px; font-size: 14px; }
  label { display: block; margin: 8px 0 4px; font-size: 13px; color: var(--muted); }
  input[type=number], input[type=text], select { width: 100%; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; font: inherit; background: #fff; }
  input.invalid { border-color: var(--danger); background: #fff0f3; }
  label.check { display: flex; gap: 6px; align-items: center; color: var(--text); }
  .drop { border: 2px dashed var(--line); border-radius: 8px; padding: 16px; text-align: center; cursor: pointer; color: var(--muted); font-size: 13px; }
  .drop.over, .drop:focus { border-color: var(--accent); color: var(--accent); outline: none; }
  button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  button.primary { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 600; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  .hint { font-size: 12px; color: var(--muted); margin: 6px 0 0; }
  .msg { font-size: 13px; color: var(--danger); margin: 6px 0 0; }
  .msg:empty { display: none; }
  .bar { height: 8px; background: var(--line); border-radius: 4px; overflow: hidden; }
  .bar > div { height: 100%; width: 0; background: var(--ok); transition: width .2s; }
  #layers { list-style: none; margin: 0; padding: 0; max-height: calc(100vh - 160px); overflow: auto; }
  #layers li { display: flex; align-items: center; gap: 8px; padding: 6px; border-radius: 6px; cursor: pointer; }
  #layers li:hover { background: var(--bg); }
  #layers li.active { background: var(--accent-soft); outline: 1px solid var(--accent); }
  #layers li.complete .name { text-decoration: line-through; color: var(--muted); }
  .sw { width: 18px; height: 18px; border-radius: 4px; border: 1px solid rgba(0,0,0,.25); flex: none; }
  #layers .name { flex: 1; font-size: 13px; }
  #layers .count { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  #layers button { padding: 0 6px; font-size: 11px; line-height: 20px; }
  .target { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .target .sw { width: 32px; height: 32px; }
  #targetText { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .gridwrap { margin-top: 12px; overflow: auto; max-height: calc(100vh - 280px); min-height: 200px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
  #grid { display: block; cursor: crosshair; }
  #empty { padding: 60px 20px; text-align: center; color: var(--muted); }
  #hover { font-size: 13px; color: var(--muted); min-height: 1.6em; margin: 6px 0 0; font-variant-numeric: tabular-nums; }
  kbd { border: 1px solid rgba(255,255,255,.6); border-radius: 4px; padding: 0 4px; font-size: 12px; margin-left: 4px; }
  code { font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>Everyone Draw ပုံဆွဲအကူ</h1>
  <p>ပုံကို everyonedraw အရောင်တွေနဲ့ ပြောင်းပြီး ကိုယ်တိုင် တစ်ရောင်ချင်း ဆွဲဖို့ လမ်းပြပေးတယ်။ site ပေါ်မှာ အလိုအလျောက် မဆွဲပါဘူး။</p>
</header>
<main class="layout">
  <aside>
    <div class="card">
      <h2>၁။ ပုံ</h2>
      <div id="drop" class="drop" tabindex="0" role="button">ပုံကို ဒီမှာ ဆွဲချပါ၊ click နှိပ်ပြီး ရွေးပါ၊ သို့ Ctrl+V နဲ့ paste လုပ်ပါ</div>
      <input id="file" type="file" accept="image/*" hidden>
      <label for="width">အကျယ် (pixel)</label>
      <input id="width" type="number" min="1" max="512" value="64">
      <label for="dither">Dithering</label>
      <select id="dither">
        <option value="none">None — အရောင်ပြည့် (ဆွဲရလွယ်)</option>
        <option value="fs">Floyd–Steinberg — ဓာတ်ပုံအတွက်</option>
      </select>
      <label class="check"><input id="useApp" type="checkbox"> App အရောင် ၃၂ ရောင် သုံးမယ်</label>
      <p id="imgMsg" class="msg"></p>
    </div>
    <div class="card">
      <h2>၂။ နေရာ</h2>
      <label for="loc">ပုံရဲ့ ဘယ်အပေါ်ထောင့် — <code>x, y</code> သို့ everyonedraw URL</label>
      <input id="loc" type="text" placeholder="ဥပမာ 5000, 5000" autocomplete="off">
      <p id="locInfo" class="hint"></p>
      <label for="zoom">ခုန်တဲ့အခါ zoom</label>
      <input id="zoom" type="number" min="1" max="100" value="40">
    </div>
    <div class="card">
      <h2>၃။ Progress</h2>
      <div class="bar"><div id="barFill"></div></div>
      <p id="progressText" class="hint">—</p>
      <div class="row">
        <button id="download" disabled>PNG download</button>
        <button id="reset" disabled>Progress ပြန်စ</button>
      </div>
    </div>
  </aside>
  <section class="card">
    <h2>အလွှာ (အရောင်)</h2>
    <ul id="layers"></ul>
  </section>
  <section class="card">
    <div class="target">
      <button id="next" class="primary" disabled>နောက် pixel<kbd>N</kbd></button>
      <span id="targetSw" class="sw" hidden></span>
      <span id="targetText">ပုံထည့်ပါ</span>
    </div>
    <p class="hint">everyonedraw ကို window သီးသန့်ဖွင့်ပြီး ဘေးချင်းကပ်ထားရင် ပိုမြန်တယ်။ ခုန်ပြီးရင် screen အလယ်က pixel ကို click နှိပ်ပါ။ grid ပေါ်က pixel ကို click ရင် ဆွဲပြီး/မဆွဲရသေး ပြောင်းတယ်။</p>
    <div class="row">
      <button id="zoomOut" title="သေးမယ်">−</button>
      <button id="zoomIn" title="ကြီးမယ်">+</button>
    </div>
    <div class="gridwrap">
      <div id="empty">ပုံထည့်ပါ</div>
      <canvas id="grid" hidden></canvas>
    </div>
    <p id="hover"></p>
  </section>
</main>
<script src="core.js"></script>
<script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify it parses**

Open `index.html` in Chrome. Expected: page shows the three columns; console has one error `app.js` not found (404) until Task 7. No other errors.

---

### Task 7: app.js (UI logic)

**Files:**
- Create: `app.js`

- [ ] **Step 1: Create the file**

```js
(function () {
  'use strict';
  const C = window.EDCore;
  const KEY = 'edhelper.session.v1';
  const MAX_SRC = 2048;
  const $ = (id) => document.getElementById(id);
  const el = {
    drop: $('drop'), file: $('file'), width: $('width'), dither: $('dither'), useApp: $('useApp'),
    imgMsg: $('imgMsg'), loc: $('loc'), locInfo: $('locInfo'), zoom: $('zoom'),
    barFill: $('barFill'), progressText: $('progressText'), download: $('download'), reset: $('reset'),
    layers: $('layers'), next: $('next'), targetSw: $('targetSw'), targetText: $('targetText'),
    zoomIn: $('zoomIn'), zoomOut: $('zoomOut'), empty: $('empty'), grid: $('grid'), hover: $('hover'),
  };
  const ctx = el.grid.getContext('2d');

  const state = {
    src: null,                 // {data, w, h} — source pixels, not saved
    q: null,                   // {w, h, idx} — quantized image
    palette: C.getPalette(false),
    width: 64, dither: 'none', useApp: false,
    origin: null,              // {x, y} — canvas coord of the image's top-left pixel
    locOk: false,              // location input currently valid
    zoom: 40,
    layers: [],                // drawing order
    active: -1,                // index into layers, -1 = all
    done: new Set(),           // pixel indexes already drawn
    target: null,              // pixel index the site was last opened at
    cell: 8,                   // grid cell size in px
  };
  let storageWarned = false;

  // ---------- helpers ----------
  const totalPixels = () => state.layers.reduce((s, l) => s + l.pixels.length, 0);
  const canNext = () => !!state.q && state.locOk && !!state.origin;
  const canvasXY = (p) => C.toCanvas(p % state.q.w, Math.floor(p / state.q.w), state.origin.x, state.origin.y);
  const confirmReset = () =>
    state.done.size === 0 || confirm('ဒါပြောင်းရင် progress အစက ပြန်စမယ်။ ဆက်လုပ်မလား?');

  function clampCell(c) {
    const maxCell = Math.max(2, Math.floor(8192 / Math.max(state.q.w, state.q.h)));
    return Math.max(2, Math.min(40, maxCell, c));
  }

  function autoCell() {
    const avail = Math.max(200, el.grid.parentElement.clientWidth - 4);
    return clampCell(Math.floor(avail / state.q.w));
  }

  // ---------- image loading ----------
  async function loadFile(file) {
    el.imgMsg.textContent = '';
    if (!file || !file.type || !file.type.startsWith('image/')) {
      el.imgMsg.textContent = 'ပုံဖိုင် မဟုတ်ပါဘူး။';
      return;
    }
    if (state.done.size > 0 && !confirm('ပုံအသစ် ထည့်ရင် လက်ရှိ progress ပျက်မယ်။ ဆက်လုပ်မလား?')) return;
    let bmp;
    try { bmp = await createImageBitmap(file); }
    catch (e) { el.imgMsg.textContent = 'ပုံကို ဖွင့်လို့ မရပါဘူး။'; return; }
    const scale = Math.min(1, MAX_SRC / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(bmp, 0, 0, w, h);
    state.src = { data: cx.getImageData(0, 0, w, h).data, w, h };
    processImage();
  }

  function processImage() {
    if (!state.src) return;
    state.palette = C.getPalette(state.useApp);
    const r = C.resizeImage(state.src.data, state.src.w, state.src.h, state.width);
    state.q = C.quantize(r.data, r.w, r.h, state.palette, state.dither);
    state.layers = C.buildLayers(state.q);
    state.active = state.layers.length ? 0 : -1;
    state.done = new Set();
    state.target = null;
    state.cell = autoCell();
    save();
    renderAll();
  }

  // ---------- settings ----------
  function onSettingChange(apply, revert) {
    if (!state.src) {
      if (state.q) { el.imgMsg.textContent = 'Setting ပြောင်းဖို့ ပုံကို ပြန်ထည့်ပါ။'; revert(); return; }
      apply();
      return;
    }
    if (!confirmReset()) { revert(); return; }
    apply();
    processImage();
  }

  el.width.addEventListener('change', () => onSettingChange(
    () => {
      state.width = Math.max(1, Math.min(512, Math.round(Number(el.width.value)) || 64));
      el.width.value = state.width;
    },
    () => { el.width.value = state.width; }));
  el.dither.addEventListener('change', () => onSettingChange(
    () => { state.dither = el.dither.value; },
    () => { el.dither.value = state.dither; }));
  el.useApp.addEventListener('change', () => onSettingChange(
    () => { state.useApp = el.useApp.checked; },
    () => { el.useApp.checked = state.useApp; }));

  el.loc.addEventListener('change', () => {
    const parsed = C.parseLocation(el.loc.value);
    if (!parsed) { state.locOk = false; renderAll(); return; }
    const same = state.origin && parsed.x === state.origin.x && parsed.y === state.origin.y;
    if (!same) {
      if (!confirmReset()) {
        el.loc.value = state.origin ? `${state.origin.x}, ${state.origin.y}` : '';
        state.locOk = !!state.origin;
        renderAll();
        return;
      }
      state.done = new Set();
      state.target = null;
      state.origin = parsed;
    }
    state.locOk = true;
    el.loc.value = `${parsed.x}, ${parsed.y}`;
    save();
    renderAll();
  });

  el.zoom.addEventListener('change', () => {
    state.zoom = Math.max(1, Math.min(100, Math.round(Number(el.zoom.value)) || 40));
    el.zoom.value = state.zoom;
    save();
  });

  // ---------- image input ----------
  el.drop.addEventListener('click', () => el.file.click());
  el.drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.file.click(); }
  });
  el.file.addEventListener('change', () => {
    const f = el.file.files[0];
    el.file.value = '';
    loadFile(f);
  });
  window.addEventListener('dragover', (e) => { e.preventDefault(); el.drop.classList.add('over'); });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) el.drop.classList.remove('over'); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    el.drop.classList.remove('over');
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  window.addEventListener('paste', (e) => {
    const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
    const item = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (item) { e.preventDefault(); loadFile(item.getAsFile()); }
  });

  // ---------- rendering ----------
  function renderAll() {
    renderGrid();
    renderLayers();
    renderProgress();
    renderTarget();
    renderLoc();
  }

  function renderGrid() {
    const q = state.q;
    el.empty.hidden = !!q;
    el.grid.hidden = !q;
    if (!q) return;
    const cell = state.cell, W = q.w * cell, H = q.h * cell;
    if (el.grid.width !== W) el.grid.width = W;
    if (el.grid.height !== H) el.grid.height = H;
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    const activeColor = state.active >= 0 ? state.layers[state.active].colorIndex : null;
    const dot = Math.max(2, Math.floor(cell / 3));
    for (let p = 0; p < q.idx.length; p++) {
      const col = p % q.w, row = Math.floor(p / q.w), x = col * cell, y = row * cell, c = q.idx[p];
      if (c < 0) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = (col + row) % 2 ? '#e6e6e6' : '#ffffff';
        ctx.fillRect(x, y, cell, cell);
        continue;
      }
      const isActive = activeColor === null || c === activeColor;
      const isDone = state.done.has(p);
      ctx.globalAlpha = !isActive ? 0.15 : isDone ? 0.35 : 1;
      ctx.fillStyle = state.palette[c].hex;
      ctx.fillRect(x, y, cell, cell);
      if (isActive && isDone && cell >= 6) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#1d1d1f';
        ctx.fillRect(x + (cell - dot) / 2, y + (cell - dot) / 2, dot, dot);
      }
    }
    ctx.globalAlpha = 1;
    if (cell >= 6) {
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= q.w; i++) { ctx.moveTo(i * cell + 0.5, 0); ctx.lineTo(i * cell + 0.5, H); }
      for (let j = 0; j <= q.h; j++) { ctx.moveTo(0, j * cell + 0.5); ctx.lineTo(W, j * cell + 0.5); }
      ctx.stroke();
    }
    if (state.target !== null) {
      const tx = (state.target % q.w) * cell, ty = Math.floor(state.target / q.w) * cell;
      ctx.strokeStyle = '#ff004d';
      ctx.lineWidth = 3;
      ctx.strokeRect(tx - 1.5, ty - 1.5, cell + 3, cell + 3);
    }
  }

  function layerDone(layer) {
    let n = 0;
    for (const p of layer.pixels) if (state.done.has(p)) n++;
    return n;
  }

  function mkBtn(text, title, fn) {
    const b = document.createElement('button');
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  }

  function layerRow(i, hex, name, done, total) {
    const li = document.createElement('li');
    if (i === state.active) li.classList.add('active');
    if (i >= 0 && done === total) li.classList.add('complete');
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = hex || 'conic-gradient(#ff004d 0 25%, #29adff 0 50%, #ffec27 0 75%, #00e436 0)';
    const nm = document.createElement('span');
    nm.className = 'name';
    nm.textContent = (i >= 0 ? `${i + 1}. ` : '') + name;
    const ct = document.createElement('span');
    ct.className = 'count';
    ct.textContent = `${done}/${total}`;
    li.append(sw, nm, ct);
    if (i >= 0) {
      const up = mkBtn('▲', 'အပေါ်ရွှေ့', () => moveLayer(i, -1));
      up.disabled = i === 0;
      const dn = mkBtn('▼', 'အောက်ရွှေ့', () => moveLayer(i, 1));
      dn.disabled = i === state.layers.length - 1;
      li.append(up, dn);
    }
    li.addEventListener('click', () => { state.active = i; save(); renderAll(); });
    return li;
  }

  function renderLayers() {
    el.layers.textContent = '';
    if (!state.q) return;
    el.layers.append(layerRow(-1, null, 'အားလုံး', state.done.size, totalPixels()));
    state.layers.forEach((l, i) => {
      const color = state.palette[l.colorIndex];
      el.layers.append(layerRow(i, color.hex, color.name, layerDone(l), l.pixels.length));
    });
  }

  function moveLayer(i, d) {
    const j = i + d;
    if (j < 0 || j >= state.layers.length) return;
    [state.layers[i], state.layers[j]] = [state.layers[j], state.layers[i]];
    if (state.active === i) state.active = j;
    else if (state.active === j) state.active = i;
    save();
    renderAll();
  }

  function renderProgress() {
    const has = !!state.q;
    el.download.disabled = !has;
    el.reset.disabled = !has || state.done.size === 0;
    if (!has) { el.barFill.style.width = '0'; el.progressText.textContent = '—'; return; }
    const total = totalPixels();
    const pct = total ? (state.done.size / total) * 100 : 0;
    el.barFill.style.width = pct + '%';
    el.progressText.textContent =
      `${state.done.size} / ${total} pixel (${pct.toFixed(1)}%) · ပုံအရွယ် ${state.q.w}×${state.q.h}`;
  }

  function renderTarget() {
    el.next.disabled = !canNext();
    el.targetSw.hidden = true;
    if (!state.q) { el.targetText.textContent = 'ပုံထည့်ပါ'; return; }
    if (!canNext()) { el.targetText.textContent = 'နေရာ (x, y) သတ်မှတ်ပါ'; return; }
    if (state.target === null) {
      el.targetText.textContent = state.done.size === totalPixels()
        ? 'အားလုံး ပြီးပြီ 🎉'
        : '"နောက် pixel" ကို နှိပ်ပြီး စဆွဲပါ';
      return;
    }
    const color = state.palette[state.q.idx[state.target]];
    const { x, y } = canvasXY(state.target);
    el.targetSw.hidden = false;
    el.targetSw.style.background = color.hex;
    el.targetText.textContent = `${color.name} → (${x}, ${y})`;
  }

  function renderLoc() {
    el.loc.classList.toggle('invalid', !state.locOk && el.loc.value.trim() !== '');
    if (!state.locOk || !state.origin) {
      el.locInfo.textContent = el.loc.value.trim() ? 'နေရာ မမှန်ပါ — ဥပမာ 5000, 5000' : '';
      return;
    }
    const { x, y } = state.origin;
    el.locInfo.textContent = state.q
      ? `x: ${x} → ${x + state.q.w - 1}, y: ${y} → ${y - state.q.h + 1}`
      : `X0 = ${x}, Y0 = ${y}`;
  }

  function scrollTargetIntoView() {
    if (state.target === null || !state.q) return;
    const wrap = el.grid.parentElement, cell = state.cell;
    const x = (state.target % state.q.w) * cell, y = Math.floor(state.target / state.q.w) * cell;
    if (x < wrap.scrollLeft || x + cell > wrap.scrollLeft + wrap.clientWidth) wrap.scrollLeft = x - wrap.clientWidth / 2;
    if (y < wrap.scrollTop || y + cell > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = y - wrap.clientHeight / 2;
  }

  // ---------- next pixel ----------
  function next() {
    if (!canNext()) return;
    if (state.target !== null) state.done.add(state.target);
    const found = C.findNext(state.layers, state.done, Math.max(0, state.active));
    if (!found) {
      state.target = null;
      save();
      renderAll();
      return;
    }
    state.active = found.layer;
    state.target = found.pixel;
    const { x, y } = canvasXY(found.pixel);
    window.open(C.siteUrl(x, y, state.zoom), 'everyonedraw');
    save();
    renderAll();
    scrollTargetIntoView();
  }

  el.next.addEventListener('click', next);
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyN' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    next();
  });

  // ---------- grid hover / click / zoom ----------
  function pixelAt(e) {
    const q = state.q;
    if (!q) return null;
    const rect = el.grid.getBoundingClientRect();
    const col = Math.floor((e.clientX - rect.left) / state.cell);
    const row = Math.floor((e.clientY - rect.top) / state.cell);
    if (col < 0 || row < 0 || col >= q.w || row >= q.h) return null;
    return row * q.w + col;
  }

  el.grid.addEventListener('mousemove', (e) => {
    const p = pixelAt(e);
    if (p === null) { el.hover.textContent = ''; return; }
    const c = state.q.idx[p];
    let pos;
    if (state.origin && state.locOk) {
      const { x, y } = canvasXY(p);
      pos = `(${x}, ${y})`;
    } else {
      pos = `col ${p % state.q.w}, row ${Math.floor(p / state.q.w)}`;
    }
    el.hover.textContent = c < 0
      ? `${pos} · ဖောက်ထွင်း (မဆွဲရ)`
      : `${pos} · ${state.palette[c].name} · ${state.done.has(p) ? 'ဆွဲပြီး ✓' : 'မဆွဲရသေး'}`;
  });
  el.grid.addEventListener('mouseleave', () => { el.hover.textContent = ''; });
  el.grid.addEventListener('click', (e) => {
    const p = pixelAt(e);
    if (p === null || state.q.idx[p] < 0) return;
    if (state.done.has(p)) state.done.delete(p);
    else state.done.add(p);
    save();
    renderAll();
  });

  function setCell(c) {
    if (!state.q) return;
    state.cell = clampCell(c);
    save();
    renderGrid();
    scrollTargetIntoView();
  }
  el.zoomIn.addEventListener('click', () => setCell(state.cell + Math.max(1, Math.round(state.cell * 0.25))));
  el.zoomOut.addEventListener('click', () => setCell(state.cell - Math.max(1, Math.round(state.cell * 0.25))));

  // ---------- download / reset ----------
  el.download.addEventListener('click', () => {
    const q = state.q;
    if (!q) return;
    const cv = document.createElement('canvas');
    cv.width = q.w; cv.height = q.h;
    const cx = cv.getContext('2d');
    const img = cx.createImageData(q.w, q.h);
    for (let p = 0; p < q.idx.length; p++) {
      const c = q.idx[p];
      if (c < 0) continue;
      const [r, g, b] = state.palette[c].rgb;
      img.data.set([r, g, b, 255], p * 4);
    }
    cx.putImageData(img, 0, 0);
    cv.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `everyonedraw-${q.w}x${q.h}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  });

  el.reset.addEventListener('click', () => {
    if (!confirm('Progress အားလုံးကို ဖျက်ပြီး အစက ပြန်စမလား?')) return;
    state.done = new Set();
    state.target = null;
    save();
    renderAll();
  });

  // ---------- persistence ----------
  function save() {
    if (!state.q) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({
        w: state.q.w, h: state.q.h, idx: C.encodeIdx(state.q.idx),
        width: state.width, dither: state.dither, useApp: state.useApp,
        origin: state.origin, zoom: state.zoom, cell: state.cell,
        order: state.layers.map((l) => l.colorIndex), active: state.active,
        done: Array.from(state.done), target: state.target,
      }));
    } catch (e) {
      if (!storageWarned) {
        storageWarned = true;
        el.imgMsg.textContent = 'Browser မှာ progress သိမ်းလို့ မရပါဘူး။ page ပိတ်ရင် progress ပျောက်မယ်။';
      }
    }
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!s || typeof s.idx !== 'string' || s.idx.length !== s.w * s.h) return;
      const palette = C.getPalette(!!s.useApp);
      const idx = C.decodeIdx(s.idx);
      if (!idx || idx.some((c) => c >= palette.length)) return;
      const q = { w: s.w, h: s.h, idx };
      const byColor = new Map(C.buildLayers(q).map((l) => [l.colorIndex, l]));
      const layers = (s.order || []).filter((c) => byColor.has(c)).map((c) => byColor.get(c));
      for (const l of byColor.values()) if (!layers.includes(l)) layers.push(l);
      Object.assign(state, {
        q, palette, layers,
        width: s.width || 64,
        dither: s.dither === 'fs' ? 'fs' : 'none',
        useApp: !!s.useApp,
        origin: s.origin || null,
        locOk: !!s.origin,
        zoom: s.zoom || 40,
        cell: s.cell || 8,
        active: Math.min(Number.isInteger(s.active) ? s.active : 0, layers.length - 1),
        done: new Set(s.done || []),
        target: Number.isInteger(s.target) ? s.target : null,
      });
    } catch (e) {
      return;
    }
    el.width.value = state.width;
    el.dither.value = state.dither;
    el.useApp.checked = state.useApp;
    el.zoom.value = state.zoom;
    el.loc.value = state.origin ? `${state.origin.x}, ${state.origin.y}` : '';
  }

  load();
  renderAll();
})();
```

- [ ] **Step 2: Smoke check**

Open `index.html` in Chrome. Expected: no console errors; "ပုံထည့်ပါ" shown in grid area; Next button disabled.

---

### Task 8: Browser verification

**Files:** none (manual check with Chrome DevTools MCP)

- [ ] **Step 1: Run unit tests**

Run: `node --test core.test.js`
Expected: PASS — 17 tests, 0 failures

- [ ] **Step 2: Load a test image**

Open `file:///C:/Users/hwckv/OneDrive/Desktop/dev/everyone-draw/index.html`. Paste or drop any PNG/JPG (or generate one in-page: draw a gradient on a canvas, `toBlob`, feed it to the file input via DataTransfer). Expected: grid appears, layer list shows colors with counts summing to the progress total, PNG download enabled.

- [ ] **Step 3: Location + Next**

Type `5000, 5000` into location, press Tab. Expected: info line `x: 5000 → 5063, y: 5000 → …` (for width 64); Next enabled. Press `N` with focus outside inputs. Expected: a tab named `everyonedraw` opens at `https://everyonedraw.com/40/<x>/<y>` matching the target text; the target cell has a red outline. Press `N` again: previous target becomes done (faded with dot), counts increase by 1, the same tab is reused.

- [ ] **Step 4: Layers, click, hover, zoom**

Click a layer row: other colors fade. ▲/▼ reorders. Click a grid pixel: toggles done, counts update. Hover shows `(x, y) · Color · status` with y decreasing downward. `+`/`−` resize cells.

- [ ] **Step 5: Persistence and settings**

Reload the page. Expected: image, layer order, active layer, done marks, location and target restored. Change width: the red message `Setting ပြောင်းဖို့ ပုံကို ပြန်ထည့်ပါ။` appears (no source after reload) and the width reverts. Re-add the image, change dither with progress > 0: confirm dialog appears; Cancel keeps everything.

- [ ] **Step 6: Errors**

Drop a `.txt` file: message `ပုံဖိုင် မဟုတ်ပါဘူး။`. Type `abc` in location: red input, Next disabled.
