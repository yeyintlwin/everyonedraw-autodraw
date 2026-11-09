# Everyone Draw Overlay Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome extension (unpacked, MV3) that shows the user's image as an aligned overlay on everyonedraw.com's canvas plus a floating panel, so the human can draw it pixel by pixel while the site stays fully usable.

**Architecture:** Content scripts run in the page's MAIN world on everyonedraw.com. `site.js` wraps `CanvasRenderingContext2D.prototype.fillRect` to observe the site's background-block draws and derive the exact world→screen transform; it also reads pixel colors from the site's canvases. `overlay.js` draws the template on its own `pointer-events:none` canvas inserted right after the site's canvases. `panel.js` is a shadow-DOM panel with state, localStorage persistence and the auto-detection loop. Pure math lives in `core.js` and is unit-tested with `node --test`.

**Tech Stack:** Vanilla JS, Chrome MV3 content scripts (`world: "MAIN"`), Canvas 2D, Node 22 test runner.

**Spec:** `docs/superpowers/specs/2026-11-09-everyone-draw-overlay-extension-design.md`

**Notes for the engineer:**
- Not a git repo; the user did not ask for commits. Skip commits.
- UI text is Burmese — copy exactly.
- The extension must NEVER place pixels, click the site, or send requests. It only observes and draws on its own canvas.
- Known tool pitfall: the Write/Edit tools may convert `\uXXXX` escapes into literal characters. None of the code below needs `\u` escapes. Prefer extracting code blocks from this plan with `sed`/`awk` over retyping.
- everyonedraw facts (measured 2026-11-09): six 2D canvases in DOM order — 0 background blocks, 1 pixel tiles, 2 live pixels, 3 grid lines, 4 hover preview, 5 input. Canvas 0 draws each visible 128×128 world-pixel block with `fillRect(dx, dy, 128*zoom, 128*zoom)`; block edges sit at world `128k + 64` on both axes. y grows UP. The Share button text is `Share (x, y)` for the screen-center pixel.

## File Structure

| File | Responsibility |
|---|---|
| `core.js` | Existing pure logic + view math (`viewFromBlock`, `worldAt`, `screenRect`, `parseShare`) + template helpers (`visibleCells`, `detectMatches`, `findNearest`). `findNext` is removed. |
| `core.test.js` | Unit tests |
| `manifest.json` | MV3 manifest, content scripts in MAIN world |
| `site.js` | Site adapter → `window.EDSite` |
| `overlay.js` | Overlay canvas → `window.EDOverlay` |
| `panel.js` | Panel UI, state, persistence, detection loop |
| `README.md` | Burmese install/usage |
| `index.html`, `app.js` | **Delete** (old local page) |

---

### Task 1: core.js — view math and template helpers

**Files:**
- Modify: `core.js` (replace `findNext`, update the returned object)
- Modify: `core.test.js` (remove the `findNext` test, append new tests)

- [ ] **Step 1: Remove the old findNext test**

In `core.test.js`, delete the whole test block that starts with `test('findNext: walks layers from start, skips done, wraps, null when all done', () => {` and ends at its closing `});` (currently lines 104–112).

- [ ] **Step 2: Append the new failing tests**

Append to `core.test.js`:

```js
// Numbers below were measured on everyonedraw.com (viewport 900x766).
test('viewFromBlock: zoom 13 matches the site', () => {
  const v = C.viewFromBlock(-987, -1392, 1664, -1234, 567, 900, 766);
  assert.deepEqual(v, { zoom: 13, ax: 16485, ay: 7747 });
  assert.deepEqual(C.worldAt(v, 450, 383), { x: -1234, y: 567 });
});

test('viewFromBlock: zoom 40 matches the site', () => {
  const v = C.viewFromBlock(-1490, -2797, 5120, 6000, 6000, 900, 766);
  assert.deepEqual(v, { zoom: 40, ax: -239570, ay: 240363 });
  assert.deepEqual(C.worldAt(v, 450, 383), { x: 6000, y: 6000 });
});

test('viewFromBlock: zoom 1 block around the origin', () => {
  assert.deepEqual(C.viewFromBlock(213, 119, 128, 300, -200, 900, 766), { zoom: 1, ax: 149, ay: 182 });
});

test('viewFromBlock: a center estimate a few pixels off gives the same view', () => {
  const a = C.viewFromBlock(-1490, -2797, 5120, 6000, 6000, 900, 766);
  const b = C.viewFromBlock(-1490, -2797, 5120, 6003, 5996, 900, 766);
  assert.deepEqual(a, b);
});

test('worldAt / screenRect: match the hover cell the site draws at zoom 20', () => {
  const v = { zoom: 20, ax: -99560, ay: 100373 };
  assert.deepEqual(C.worldAt(v, 300, 300), { x: 4993, y: 5004 });
  assert.deepEqual(C.screenRect(v, 4993, 5004), { x: 300, y: 293, size: 20 });
});

test('parseShare', () => {
  assert.deepEqual(C.parseShare('Share (5005, 4998)'), { x: 5005, y: 4998 });
  assert.deepEqual(C.parseShare('Compartir (-1, -2)'), { x: -1, y: -2 });
  assert.equal(C.parseShare('Report'), null);
  assert.equal(C.parseShare(null), null);
});

test('visibleCells: image cells inside the viewport, null when off screen', () => {
  const v = { zoom: 10, ax: 0, ay: 0 };
  assert.deepEqual(C.visibleCells(v, { x: 5, y: 2 }, 10, 10, 100, 100), { c0: 0, c1: 4, r0: 2, r1: 9 });
  assert.equal(C.visibleCells(v, { x: 100, y: 0 }, 10, 10, 100, 100), null);
});

test('detectMatches: compares on-screen cells with site colors', () => {
  const pal = C.getPalette(false);
  const q = { w: 2, h: 1, idx: Int16Array.from([7, 0]) }; // Red, Black
  const view = { zoom: 10, ax: 0, ay: 0 };
  const o = { x: 0, y: 0 };
  const red = [255, 0, 77, 255], white = [255, 241, 232, 255];
  const matched = new Uint8Array(2);
  assert.equal(C.detectMatches(q, pal, o, view, (sx) => (sx < 10 ? red : white), 100, 100, matched), 1);
  assert.deepEqual(Array.from(matched), [1, 0]);
  // unknown colors keep the previous state
  assert.equal(C.detectMatches(q, pal, o, view, () => null, 100, 100, matched), 0);
  assert.deepEqual(Array.from(matched), [1, 0]);
  // too far zoomed out: no detection
  assert.equal(C.detectMatches(q, pal, o, { zoom: 1, ax: 0, ay: 0 }, () => white, 100, 100, matched), 0);
  // someone painted over the red pixel
  assert.equal(C.detectMatches(q, pal, o, view, () => white, 100, 100, matched), 1);
  assert.deepEqual(Array.from(matched), [0, 0]);
});

test('findNearest: closest unmatched pixel of the chosen color', () => {
  const q = { w: 3, h: 1, idx: Int16Array.from([7, 0, 7]) };
  const o = { x: 10, y: 20 };
  assert.deepEqual(C.findNearest(q, o, new Uint8Array(3), 7, 12, 20), { x: 12, y: 20, p: 2 });
  assert.deepEqual(C.findNearest(q, o, Uint8Array.from([0, 0, 1]), 7, 12, 20), { x: 10, y: 20, p: 0 });
  assert.deepEqual(C.findNearest(q, o, new Uint8Array(3), -1, 11, 20), { x: 11, y: 20, p: 1 });
  assert.equal(C.findNearest(q, o, Uint8Array.from([1, 1, 1]), -1, 0, 0), null);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test core.test.js`
Expected: FAIL — `C.viewFromBlock is not a function` (and the other new functions)

- [ ] **Step 4: Implement**

In `core.js`, replace the entire `function findNext(layers, done, startLayer) { ... }` block with:

```js
  // ---------- everyonedraw view math ----------
  // The site draws 128x128 world-pixel blocks whose edges sit at 128k + 64 on both axes.
  const BLOCK = 128;
  const BLOCK_OFFSET = 64;

  // A view maps world pixels to screen CSS px: pixel X's left edge is at ax + X*zoom,
  // row Y's top edge is at ay - Y*zoom (world y grows up).
  // (dx, dy, size) is one block rect the site drew; (estX, estY) is a rough guess of the
  // screen-center pixel, accurate to well under 64 pixels.
  function viewFromBlock(dx, dy, size, estX, estY, vw, vh) {
    const zoom = size / BLOCK;
    const half = zoom / 2;
    const leftEst = estX + (dx - (vw / 2 - half)) / zoom;
    const left = Math.round((leftEst - BLOCK_OFFSET) / BLOCK) * BLOCK + BLOCK_OFFSET;
    const topEst = estY + ((vh / 2 - half) - dy) / zoom;
    const top = Math.round((topEst - (BLOCK - 1) - BLOCK_OFFSET) / BLOCK) * BLOCK + BLOCK_OFFSET + BLOCK - 1;
    return { zoom, ax: dx - left * zoom, ay: dy + top * zoom };
  }

  // World pixel under screen point (sx, sy). "+ 0" turns -0 into 0.
  function worldAt(view, sx, sy) {
    return {
      x: Math.floor((sx - view.ax) / view.zoom) + 0,
      y: Math.ceil((view.ay - sy) / view.zoom) + 0,
    };
  }

  // Screen rect (top-left corner + size, CSS px) of world pixel (X, Y).
  function screenRect(view, X, Y) {
    return { x: view.ax + X * view.zoom, y: view.ay - Y * view.zoom, size: view.zoom };
  }

  // "Share (x, y)" -> {x, y}; works for any label language.
  function parseShare(text) {
    const m = String(text == null ? '' : text).match(/\((-?\d+),\s*(-?\d+)\)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  }

  // ---------- template helpers ----------
  // Inclusive column/row range of the w x h image (top-left at origin) that is on screen, or null.
  function visibleCells(view, origin, w, h, vw, vh) {
    const a = worldAt(view, 0, 0);
    const b = worldAt(view, vw - 1e-6, vh - 1e-6);
    const c0 = Math.max(0, a.x - origin.x), c1 = Math.min(w - 1, b.x - origin.x);
    const r0 = Math.max(0, origin.y - a.y), r1 = Math.min(h - 1, origin.y - b.y);
    return c0 > c1 || r0 > r1 ? null : { c0, c1, r0, r1 };
  }

  // Compares on-screen template cells with the site's colors. read(sx, sy) -> [r, g, b, a] | null.
  // Updates `matched` (1 = the site already has the right color) in place; returns how many changed.
  function detectMatches(q, palette, origin, view, read, vw, vh, matched) {
    if (view.zoom < 2) return 0;
    const v = visibleCells(view, origin, q.w, q.h, vw, vh);
    if (!v) return 0;
    const half = view.zoom / 2;
    let changed = 0;
    for (let r = v.r0; r <= v.r1; r++) {
      for (let c = v.c0; c <= v.c1; c++) {
        const p = r * q.w + c, ci = q.idx[p];
        if (ci < 0) continue;
        const pos = toCanvas(c, r, origin.x, origin.y);
        const rect = screenRect(view, pos.x, pos.y);
        const sx = rect.x + half, sy = rect.y + half;
        if (sx < 0 || sy < 0 || sx >= vw || sy >= vh) continue;
        const px = read(sx, sy);
        if (!px) continue;
        const t = palette[ci].rgb;
        const ok = px[3] === 255 && px[0] === t[0] && px[1] === t[1] && px[2] === t[2] ? 1 : 0;
        if (matched[p] !== ok) { matched[p] = ok; changed++; }
      }
    }
    return changed;
  }

  // Nearest not-yet-matched pixel of colorIndex (-1 = any color) to world point (cx, cy).
  function findNearest(q, origin, matched, colorIndex, cx, cy) {
    let best = null, bestD = Infinity;
    for (let p = 0; p < q.idx.length; p++) {
      const ci = q.idx[p];
      if (ci < 0 || matched[p] || (colorIndex >= 0 && ci !== colorIndex)) continue;
      const pos = toCanvas(p % q.w, Math.floor(p / q.w), origin.x, origin.y);
      const d = (pos.x - cx) ** 2 + (pos.y - cy) ** 2;
      if (d < bestD) { bestD = d; best = { x: pos.x, y: pos.y, p }; }
    }
    return best;
  }
```

Then replace the returned object at the end of `core.js` with:

```js
  return {
    MAX_SIDE, PALETTE_WEB, PALETTE_APP, getPalette, srgbToOklab, nearestColor, resizeImage, quantize,
    buildLayers, toCanvas, parseLocation, siteUrl, encodeIdx, decodeIdx,
    viewFromBlock, worldAt, screenRect, parseShare, visibleCells, detectMatches, findNearest,
  };
```

(`toCanvas` is a function declaration later in the file; hoisting makes it available to the new helpers.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test core.test.js`
Expected: PASS — 35 tests, 0 failures

---

### Task 2: manifest.json + site.js, remove the old page

**Files:**
- Create: `manifest.json`, `site.js`
- Delete: `index.html`, `app.js`

- [ ] **Step 1: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Everyone Draw ပုံဆွဲအကူ",
  "version": "1.0.0",
  "description": "ပုံကို everyonedraw canvas ပေါ်မှာ overlay နဲ့ပြပြီး ကိုယ်တိုင်ဆွဲဖို့ လမ်းပြတယ်။ အလိုအလျောက် မဆွဲပါ။",
  "content_scripts": [
    {
      "matches": ["https://everyonedraw.com/*"],
      "js": ["core.js", "site.js", "overlay.js", "panel.js"],
      "run_at": "document_idle",
      "world": "MAIN"
    }
  ]
}
```

- [ ] **Step 2: Create `site.js`**

```js
// Adapter for everyonedraw.com's canvas. Watches how the site draws its background blocks to know
// exactly which world pixel is where on screen, and reads pixel colors from the site's canvases.
// It never draws on, clicks, or sends anything to the site.
(function () {
  'use strict';
  if (!/^\/(?:[\d.]+\/-?\d+\/-?\d+\/?)?$/.test(location.pathname)) return; // canvas page only
  const C = window.EDCore;
  const listeners = new Set();
  let view = null;      // {zoom, ax, ay} in CSS px, or null while unknown
  let pending = null;   // [dx, dy, size] of the last background block drawn
  let scheduled = false;
  let bg = null;

  // Site canvases in DOM order: 0 background blocks, 1 pixel tiles, 2 live pixels,
  // 3 grid lines, 4 hover preview, 5 input. Our own elements are marked data-edhelper.
  function siteCanvases() {
    return Array.from(document.querySelectorAll('canvas')).filter((c) => !c.dataset.edhelper);
  }

  function isBackground(canvas) {
    if (!bg || !bg.isConnected) bg = siteCanvases()[0] || null;
    return canvas === bg;
  }

  function cssScale(canvas) {
    return canvas.clientWidth ? canvas.width / canvas.clientWidth : 1;
  }

  function shareCenter() {
    for (const b of document.querySelectorAll('button')) {
      const p = C.parseShare(b.textContent);
      if (p) return p;
    }
    return null;
  }

  function centerOf(v) {
    return C.worldAt(v, innerWidth / 2, innerHeight / 2);
  }

  function far(a, b) {
    return Math.abs(a.x - b.x) > 32 || Math.abs(a.y - b.y) > 32;
  }

  function emit() {
    listeners.forEach((fn) => {
      try { fn(view); } catch (e) { console.error('[edhelper]', e); }
    });
  }

  function update() {
    scheduled = false;
    if (!pending) return;
    const [dx, dy, size] = pending;
    pending = null;
    const vw = innerWidth, vh = innerHeight;
    const share = shareCenter();
    const est = view ? centerOf(view) : share || C.parseLocation(location.href);
    if (!est) return;
    let v = C.viewFromBlock(dx, dy, size, est.x, est.y, vw, vh);
    if (share && far(centerOf(v), share)) {
      v = C.viewFromBlock(dx, dy, size, share.x, share.y, vw, vh);
      if (far(centerOf(v), share)) v = null;
    }
    const same = v === view || (v && view && v.zoom === view.zoom && v.ax === view.ax && v.ay === view.ay);
    if (same) return;
    view = v;
    emit();
  }

  const proto = CanvasRenderingContext2D.prototype;
  const fillRect = proto.fillRect;
  proto.fillRect = function (x, y, w, h) {
    try {
      if (w === h && w >= 8 && isBackground(this.canvas)) {
        const m = this.getTransform();
        const s = cssScale(this.canvas);
        pending = [(m.a * x + m.e) / s, (m.d * y + m.f) / s, (m.a * w) / s];
        if (!scheduled) { scheduled = true; queueMicrotask(update); }
      }
    } catch (e) { /* never break the site */ }
    return fillRect.call(this, x, y, w, h);
  };

  // Returns read(sx, sy) -> [r, g, b, 255] | null: the site's opaque color at a screen point,
  // looking at live pixels, then tiles, then the background (never the hover preview).
  function snapshot() {
    const cs = siteCanvases();
    const layers = [cs[2], cs[1], cs[0]].filter(Boolean).map((c) => {
      try {
        return { s: cssScale(c), w: c.width, h: c.height, data: c.getContext('2d').getImageData(0, 0, c.width, c.height).data };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
    return (sx, sy) => {
      for (const L of layers) {
        const x = Math.floor(sx * L.s), y = Math.floor(sy * L.s);
        if (x < 0 || y < 0 || x >= L.w || y >= L.h) return null;
        const i = (y * L.w + x) * 4;
        if (L.data[i + 3] !== 255) continue;
        return [L.data[i], L.data[i + 1], L.data[i + 2], 255];
      }
      return null;
    };
  }

  window.EDSite = {
    getView: () => view,
    onView(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    snapshot,
    siteCanvases,
    centerPixel: () => (view ? centerOf(view) : shareCenter() || C.parseLocation(location.href)),
    refresh: () => dispatchEvent(new Event('resize')),
  };
  window.EDSite.refresh(); // make the site redraw so we learn the view right away
})();
```

- [ ] **Step 3: Delete the old local page**

Run: `rm index.html app.js`

- [ ] **Step 4: Verify**

Run: `node --check site.js && node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))" && echo OK`
Expected: `OK`

---

### Task 3: overlay.js

**Files:**
- Create: `overlay.js`

- [ ] **Step 1: Create the file**

```js
// Draws the template on its own canvas right above the site's canvases (below the site's buttons).
// pointer-events:none, so every click still goes to the site.
(function () {
  'use strict';
  const S = window.EDSite;
  if (!S) return;
  const C = window.EDCore;
  let canvas = null, ctx = null;
  let model = null;               // {q, palette, origin, matched, active, show}
  let ghost = null, focus = null; // offscreen q.w x q.h canvases
  let pulse = null;               // {x, y, until}
  let raf = 0;

  function ensureCanvas() {
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.dataset.edhelper = '1';
      canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:-1;';
      ctx = canvas.getContext('2d');
    }
    const site = S.siteCanvases();
    const last = site[site.length - 1];
    if (last) {
      if (last.nextElementSibling !== canvas) last.after(canvas);
    } else if (!canvas.isConnected) {
      document.body.appendChild(canvas);
    }
  }

  // ghost = other colors still to draw, focus = the chosen color still to draw.
  function rebuild() {
    ghost = focus = null;
    if (!model || !model.q) return;
    const { q, palette, matched, active } = model;
    const make = () => {
      const c = document.createElement('canvas');
      c.width = q.w; c.height = q.h;
      return c;
    };
    ghost = make();
    focus = make();
    const gi = new ImageData(q.w, q.h), fi = new ImageData(q.w, q.h);
    for (let p = 0; p < q.idx.length; p++) {
      const c = q.idx[p];
      if (c < 0 || matched[p]) continue;
      const [r, g, b] = palette[c].rgb;
      (active < 0 || c === active ? fi : gi).data.set([r, g, b, 255], p * 4);
    }
    ghost.getContext('2d').putImageData(gi, 0, 0);
    focus.getContext('2d').putImageData(fi, 0, 0);
  }

  function outline(x, y, z) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.strokeRect(x + 1, y + 1, z - 2, z - 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(x + 2.5, y + 2.5, z - 5, z - 5);
  }

  function render() {
    ensureCanvas();
    const dpr = window.devicePixelRatio || 1, W = innerWidth, H = innerHeight;
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const view = S.getView();
    if (!model || !model.show || !model.q || !model.origin || !view || !ghost) return;
    const { q, origin, matched, active } = model;
    const z = view.zoom;
    const tl = C.screenRect(view, origin.x, origin.y);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.3;
    ctx.drawImage(ghost, tl.x, tl.y, q.w * z, q.h * z);
    ctx.globalAlpha = 0.65;
    ctx.drawImage(focus, tl.x, tl.y, q.w * z, q.h * z);
    ctx.globalAlpha = 1;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ff004d';
    ctx.strokeRect(tl.x - 0.5, tl.y - 0.5, q.w * z + 1, q.h * z + 1);
    ctx.setLineDash([]);
    if (z >= 8) {
      const v = C.visibleCells(view, origin, q.w, q.h, W, H);
      if (v && (v.c1 - v.c0 + 1) * (v.r1 - v.r0 + 1) <= 5000) {
        for (let r = v.r0; r <= v.r1; r++) {
          for (let c = v.c0; c <= v.c1; c++) {
            const p = r * q.w + c, ci = q.idx[p];
            if (ci < 0 || matched[p] || (active >= 0 && ci !== active)) continue;
            const pos = C.toCanvas(c, r, origin.x, origin.y);
            const rect = C.screenRect(view, pos.x, pos.y);
            outline(rect.x, rect.y, z);
          }
        }
      }
    }
    if (pulse) {
      const now = performance.now();
      if (now > pulse.until) {
        pulse = null;
      } else {
        const rect = C.screenRect(view, pulse.x, pulse.y);
        const grow = 6 + 6 * Math.abs(Math.sin(now / 150));
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ff004d';
        ctx.strokeRect(rect.x - grow, rect.y - grow, z + grow * 2, z + grow * 2);
        loop();
      }
    }
  }

  function loop() {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); });
  }

  window.EDOverlay = {
    setModel(m) { model = m; rebuild(); render(); },
    update() { rebuild(); render(); },
    pulse(x, y) { pulse = { x, y, until: performance.now() + 3000 }; loop(); },
  };
  S.onView(render);
  addEventListener('resize', loop);
})();
```

- [ ] **Step 2: Verify**

Run: `node --check overlay.js && echo OK`
Expected: `OK`

---

### Task 4: panel.js

**Files:**
- Create: `panel.js`

- [ ] **Step 1: Create the file**

```js
// Floating panel on everyonedraw: load an image, place it, pick a color, see progress.
// The human places every pixel; this panel only shows where.
(function () {
  'use strict';
  const S = window.EDSite, O = window.EDOverlay;
  if (!S || !O) return;
  const C = window.EDCore;
  const KEY = 'edhelper.v2';
  const MAX_SRC = 2048;
  const ALL_COLORS = 'conic-gradient(#ff004d 0 25%, #29adff 0 50%, #ffec27 0 75%, #00e436 0)';

  const state = {
    src: null,                       // {data, w, h} source pixels (not saved)
    q: null,                         // {w, h, idx}
    palette: C.getPalette(false),
    layers: [],
    width: 64, dither: 'none', useApp: false,
    origin: null,                    // world pixel of the image's top-left cell
    active: -1,                      // palette index being drawn, -1 = all colors
    show: true,
    matched: new Uint8Array(0),      // 1 = the site already has the right color
    collapsed: false,
    pos: { x: 12, y: 84 },
  };

  // ---------- DOM ----------
  const host = document.createElement('div');
  host.dataset.edhelper = '1';
  host.style.cssText = 'position:fixed;z-index:2147483000;left:12px;top:84px;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host { all: initial; }
  .panel { width: 290px; max-height: calc(100vh - 150px); display: flex; flex-direction: column;
    background: #fffdf9; color: #1d1d1f; border: 1px solid #d9d4cc; border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0,0,0,.18); overflow: hidden;
    font: 13px/1.55 system-ui, "Myanmar Text", "Noto Sans Myanmar", sans-serif; }
  .head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #7e2553; color: #fff; cursor: move; user-select: none; touch-action: none; }
  .head b { flex: 1; font-size: 14px; }
  .head button { background: rgba(255,255,255,.18); color: #fff; border: 0; border-radius: 6px; width: 28px; height: 24px; cursor: pointer; font: inherit; }
  .body { padding: 10px; overflow: auto; }
  .collapsed .body { display: none; }
  section { margin-bottom: 12px; }
  h3 { margin: 0 0 6px; font-size: 12px; color: #6b6b70; font-weight: 600; }
  .drop { border: 2px dashed #d9d4cc; border-radius: 8px; padding: 10px; text-align: center; cursor: pointer; color: #6b6b70; }
  .drop.over, .drop:focus { border-color: #7e2553; color: #7e2553; outline: none; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 6px; }
  label { display: block; font-size: 12px; color: #6b6b70; }
  input[type=text], input[type=number], select { width: 100%; box-sizing: border-box; padding: 4px 6px; border: 1px solid #d9d4cc; border-radius: 6px; font: inherit; background: #fff; color: #1d1d1f; }
  .check { display: flex; align-items: center; gap: 6px; margin-top: 6px; color: #1d1d1f; }
  .btn { font: inherit; padding: 6px 10px; border-radius: 7px; border: 1px solid #d9d4cc; background: #fff; color: #1d1d1f; cursor: pointer; }
  .btn:disabled { opacity: .45; cursor: not-allowed; }
  .btn.primary { background: #7e2553; border-color: #7e2553; color: #fff; font-weight: 600; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .hint { font-size: 12px; color: #6b6b70; margin: 4px 0 0; }
  .msg { font-size: 12px; color: #d0103a; margin: 4px 0 0; }
  .msg:empty, .hint:empty { display: none; }
  .now { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 8px; background: #f4e8ee; }
  .sw { width: 16px; height: 16px; border-radius: 4px; border: 1px solid rgba(0,0,0,.25); flex: none; }
  .now .sw { width: 34px; height: 34px; }
  ul { list-style: none; margin: 6px 0 0; padding: 0; max-height: 200px; overflow: auto; }
  li { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; cursor: pointer; }
  li:hover { background: #f3f1ec; }
  li.active { background: #f4e8ee; outline: 1px solid #7e2553; }
  li.done .name { text-decoration: line-through; color: #6b6b70; }
  li .name { flex: 1; }
  li .count { color: #6b6b70; font-variant-numeric: tabular-nums; }
  .bar { height: 8px; background: #e7e3dc; border-radius: 4px; overflow: hidden; margin-top: 6px; }
  .bar > div { height: 100%; width: 0; background: #00b543; }
</style>
<div class="panel">
  <div class="head"><b>🎨 ပုံဆွဲအကူ</b><button data-act="collapse" title="ချုံ့/ချဲ့" aria-label="ချုံ့/ချဲ့">–</button></div>
  <div class="body">
    <section>
      <h3>၁။ ပုံ</h3>
      <div class="drop" tabindex="0" role="button">ပုံကို ဒီမှာ ဆွဲချပါ၊ click နှိပ်ရွေးပါ၊ သို့ ဒီကို click ပြီး Ctrl+V</div>
      <input type="file" accept="image/*" hidden>
      <div class="grid2">
        <label>အကျယ် (pixel)<input data-k="width" type="number" min="1" max="512"></label>
        <label>Dithering<select data-k="dither"><option value="none">None</option><option value="fs">Floyd–Steinberg</option></select></label>
      </div>
      <label class="check"><input data-k="useApp" type="checkbox"> App အရောင် ၃၂ ရောင်</label>
      <p class="msg" data-out="imgMsg"></p>
    </section>
    <section>
      <h3>၂။ နေရာ (ပုံရဲ့ ဘယ်အပေါ်ထောင့်)</h3>
      <div class="grid2">
        <label>x<input data-k="ox" type="text" inputmode="numeric"></label>
        <label>y<input data-k="oy" type="text" inputmode="numeric"></label>
      </div>
      <div class="row"><button class="btn" data-act="here">screen အလယ်မှာ ထားမယ်</button></div>
      <p class="hint" data-out="range"></p>
    </section>
    <section>
      <h3>၃။ ဆွဲမယ့် အရောင်</h3>
      <div class="now"><span class="sw" data-out="nowSw"></span><div data-out="nowText">ပုံ ထည့်ပါ</div></div>
      <ul data-out="layers"></ul>
      <div class="row">
        <button class="btn primary" data-act="next">နောက်တစ်ကွက် ရှာ</button>
        <button class="btn" data-act="toggle">Overlay ဖျောက်</button>
      </div>
    </section>
    <section>
      <h3>၄။ Progress</h3>
      <div class="bar"><div data-out="bar"></div></div>
      <p class="hint" data-out="progress"></p>
      <div class="row"><button class="btn" data-act="clear">ပုံ ဖယ်မယ်</button></div>
    </section>
  </div>
</div>`;

  const out = (name) => root.querySelector(`[data-out="${name}"]`);
  const inp = (k) => root.querySelector(`[data-k="${k}"]`);
  const act = (a) => root.querySelector(`[data-act="${a}"]`);
  const panel = root.querySelector('.panel');
  const head = root.querySelector('.head');
  const drop = root.querySelector('.drop');
  const fileInput = root.querySelector('input[type=file]');

  // Keep the site's own shortcuts and pan/zoom handlers from seeing events inside the panel.
  for (const type of ['keydown', 'keyup', 'keypress', 'pointerdown', 'pointerup', 'pointermove', 'mousedown',
    'mouseup', 'click', 'dblclick', 'wheel', 'touchstart', 'touchmove', 'touchend', 'paste', 'contextmenu']) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }

  // ---------- panel position ----------
  function clampPos(x, y) {
    return { x: Math.max(0, Math.min(innerWidth - 80, x)), y: Math.max(0, Math.min(innerHeight - 40, y)) };
  }
  function place() {
    host.style.left = state.pos.x + 'px';
    host.style.top = state.pos.y + 'px';
    panel.classList.toggle('collapsed', state.collapsed);
    act('collapse').textContent = state.collapsed ? '+' : '–';
  }
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const offX = e.clientX - state.pos.x, offY = e.clientY - state.pos.y;
    head.setPointerCapture(e.pointerId);
    const move = (ev) => { state.pos = clampPos(ev.clientX - offX, ev.clientY - offY); place(); };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      save();
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });

  // ---------- image ----------
  async function loadFile(file) {
    out('imgMsg').textContent = '';
    if (!file || !file.type || !file.type.startsWith('image/')) {
      out('imgMsg').textContent = 'ပုံဖိုင် မဟုတ်ပါဘူး။';
      return;
    }
    let bmp;
    try { bmp = await createImageBitmap(file); }
    catch (e) { out('imgMsg').textContent = 'ပုံကို ဖွင့်လို့ မရပါဘူး။'; return; }
    const scale = Math.min(1, MAX_SRC / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(bmp, 0, 0, w, h);
    state.src = { data: cx.getImageData(0, 0, w, h).data, w, h };
    processImage();
  }

  function processImage() {
    state.palette = C.getPalette(state.useApp);
    const r = C.resizeImage(state.src.data, state.src.w, state.src.h, state.width);
    state.q = C.quantize(r.data, r.w, r.h, state.palette, state.dither);
    state.layers = C.buildLayers(state.q);
    state.matched = new Uint8Array(state.q.idx.length);
    if (!state.layers.some((l) => l.colorIndex === state.active)) {
      state.active = state.layers.length ? state.layers[0].colorIndex : -1;
    }
    if (state.origin) changed();
    else placeHere();
  }

  function clearImage() {
    state.src = null;
    state.q = null;
    state.layers = [];
    state.matched = new Uint8Array(0);
    state.active = -1;
    changed();
  }

  // ---------- location ----------
  function setOrigin(o) {
    state.origin = o;
    if (state.q) state.matched = new Uint8Array(state.q.idx.length);
    changed();
  }

  function placeHere() {
    const c = S.centerPixel();
    if (!c) return;
    const w = state.q ? state.q.w : 0, h = state.q ? state.q.h : 0;
    setOrigin({ x: c.x - Math.floor(w / 2), y: c.y + Math.floor(h / 2) });
  }

  function findNext() {
    if (!state.q || !state.origin) return;
    const c = S.centerPixel() || state.origin;
    const t = C.findNearest(state.q, state.origin, state.matched, state.active, c.x, c.y);
    if (!t) { renderPanel(); return; }
    const view = S.getView();
    if (view && view.zoom >= 4) {
      const r = C.screenRect(view, t.x, t.y);
      if (r.x >= 0 && r.y >= 0 && r.x + r.size <= innerWidth && r.y + r.size <= innerHeight) {
        O.pulse(t.x, t.y);
        return;
      }
    }
    const zoom = Math.max(10, Math.round(view ? view.zoom : 20));
    try { sessionStorage.setItem(KEY + '.pulse', JSON.stringify({ x: t.x, y: t.y })); } catch (e) { /* ignore */ }
    location.href = C.siteUrl(t.x, t.y, zoom);
  }

  // ---------- detection ----------
  let detectTimer = 0;
  function scheduleDetect(ms) {
    clearTimeout(detectTimer);
    detectTimer = setTimeout(detect, ms);
  }
  function detect() {
    const view = S.getView();
    if (!state.q || !state.origin || !view) return;
    const n = C.detectMatches(state.q, state.palette, state.origin, view, S.snapshot(), innerWidth, innerHeight, state.matched);
    if (n) { O.update(); renderPanel(); saveSoon(); }
  }
  setInterval(() => { if (!document.hidden) detect(); }, 1500);
  addEventListener('pointerup', () => scheduleDetect(400), true);

  let hadView = false;
  S.onView((v) => {
    if (!!v !== hadView) { hadView = !!v; renderPanel(); }
    if (!v) return;
    try {
      const raw = sessionStorage.getItem(KEY + '.pulse');
      if (raw) {
        sessionStorage.removeItem(KEY + '.pulse');
        const p = JSON.parse(raw);
        O.pulse(p.x, p.y);
      }
    } catch (e) { /* ignore */ }
    scheduleDetect(250);
  });

  // ---------- render ----------
  function layerRow(color, hex, name, left) {
    const li = document.createElement('li');
    li.dataset.color = String(color);
    if (color === state.active) li.classList.add('active');
    if (color >= 0 && left === 0) li.classList.add('done');
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = hex || ALL_COLORS;
    const nm = document.createElement('span');
    nm.className = 'name';
    nm.textContent = name;
    const ct = document.createElement('span');
    ct.className = 'count';
    ct.textContent = `${left} ကျန်`;
    li.append(sw, nm, ct);
    return li;
  }

  function renderPanel() {
    const q = state.q;
    inp('width').value = state.width;
    inp('dither').value = state.dither;
    inp('useApp').checked = state.useApp;
    for (const [k, v] of [['ox', state.origin && state.origin.x], ['oy', state.origin && state.origin.y]]) {
      if (root.activeElement !== inp(k)) inp(k).value = state.origin ? String(v) : '';
    }
    out('range').textContent = q && state.origin
      ? `x: ${state.origin.x} → ${state.origin.x + q.w - 1}, y: ${state.origin.y} → ${state.origin.y - q.h + 1} (${q.w}×${q.h})`
      : '';

    let total = 0, done = 0;
    const remaining = new Map();
    if (q) {
      for (let p = 0; p < q.idx.length; p++) {
        const c = q.idx[p];
        if (c < 0) continue;
        total++;
        if (state.matched[p]) done++;
        else remaining.set(c, (remaining.get(c) || 0) + 1);
      }
    }
    const ul = out('layers');
    ul.textContent = '';
    if (q) {
      ul.append(layerRow(-1, null, 'အရောင်အားလုံး', total - done));
      for (const l of state.layers) {
        const col = state.palette[l.colorIndex];
        ul.append(layerRow(l.colorIndex, col.hex, col.name, remaining.get(l.colorIndex) || 0));
      }
    }

    const sw = out('nowSw'), nowText = out('nowText');
    if (!q) {
      sw.style.background = 'transparent';
      nowText.textContent = 'ပုံ ထည့်ပါ';
    } else if (state.active < 0) {
      sw.style.background = ALL_COLORS;
      nowText.textContent = `အရောင်အားလုံး — ${total - done} ကွက် ကျန်`;
    } else {
      const col = state.palette[state.active];
      const left = remaining.get(state.active) || 0;
      sw.style.background = col.hex;
      nowText.textContent = left
        ? `${col.name} — ${left} ကွက် ကျန်။ site ညာဘက်မှာ ဒီအရောင်ကို ရွေးပြီး ဘောင်ခတ်ထားတဲ့ ကွက်တွေကို click ပါ။`
        : `${col.name} — ပြီးပြီ 🎉 နောက်အရောင် ရွေးပါ။`;
    }

    const pct = total ? Math.floor((done / total) * 1000) / 10 : 0;
    out('bar').style.width = pct + '%';
    out('progress').textContent = q
      ? `${done} / ${total} ကွက် (${pct.toFixed(1)}%)` + (S.getView() ? '' : ' · canvas ကို ရှာနေတယ်…')
      : '';
    act('next').disabled = !q || !state.origin;
    act('here').disabled = !q;
    act('clear').disabled = !q;
    act('toggle').textContent = state.show ? 'Overlay ဖျောက်' : 'Overlay ပြ';
  }

  function changed() {
    O.setModel(state.q ? {
      q: state.q, palette: state.palette, origin: state.origin,
      matched: state.matched, active: state.active, show: state.show,
    } : null);
    renderPanel();
    save();
    scheduleDetect(150);
  }

  // ---------- persistence ----------
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        q: state.q ? { w: state.q.w, h: state.q.h, idx: C.encodeIdx(state.q.idx) } : null,
        width: state.width, dither: state.dither, useApp: state.useApp,
        origin: state.origin, active: state.active, show: state.show,
        matched: state.q ? Array.from(state.matched).join('') : '',
        collapsed: state.collapsed, pos: state.pos,
      }));
    } catch (e) {
      out('imgMsg').textContent = 'Browser မှာ သိမ်းလို့ မရပါဘူး။ page ပြန်ဖွင့်ရင် ပုံ ပြန်ထည့်ရမယ်။';
    }
  }
  let saveTimer = 0;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1000);
  }

  function load() {
    let s;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return; }
    if (!s || typeof s !== 'object') return;
    state.width = Number.isInteger(s.width) ? Math.max(1, Math.min(C.MAX_SIDE, s.width)) : 64;
    state.dither = s.dither === 'fs' ? 'fs' : 'none';
    state.useApp = !!s.useApp;
    state.show = s.show !== false;
    state.collapsed = !!s.collapsed;
    if (s.pos && Number.isFinite(s.pos.x) && Number.isFinite(s.pos.y)) state.pos = clampPos(s.pos.x, s.pos.y);
    state.palette = C.getPalette(state.useApp);
    if (s.origin && Number.isSafeInteger(s.origin.x) && Number.isSafeInteger(s.origin.y)) {
      state.origin = { x: s.origin.x, y: s.origin.y };
    }
    const sq = s.q;
    const idx = sq && Number.isInteger(sq.w) && Number.isInteger(sq.h) ? C.decodeIdx(sq.idx) : null;
    if (!idx || idx.length !== sq.w * sq.h || idx.some((c) => c >= state.palette.length)) return;
    state.q = { w: sq.w, h: sq.h, idx };
    state.layers = C.buildLayers(state.q);
    state.matched = new Uint8Array(idx.length);
    if (typeof s.matched === 'string' && s.matched.length === idx.length && /^[01]*$/.test(s.matched)) {
      for (let i = 0; i < idx.length; i++) state.matched[i] = s.matched.charCodeAt(i) === 49 ? 1 : 0;
    }
    const known = s.active === -1 || state.layers.some((l) => l.colorIndex === s.active);
    state.active = known ? s.active : (state.layers.length ? state.layers[0].colorIndex : -1);
  }

  // ---------- events ----------
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    loadFile(f);
  });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  root.addEventListener('paste', (e) => {
    const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
    const item = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (item) { e.preventDefault(); loadFile(item.getAsFile()); }
  });

  function setting(k, read, write) {
    inp(k).addEventListener('change', () => {
      if (!state.src && state.q) {
        out('imgMsg').textContent = 'Setting ပြောင်းဖို့ ပုံကို ပြန်ထည့်ပါ။';
        write();
        return;
      }
      read();
      write();
      if (state.src) processImage();
    });
  }
  setting('width',
    () => { state.width = Math.max(1, Math.min(C.MAX_SIDE, Math.round(Number(inp('width').value)) || 64)); },
    () => { inp('width').value = state.width; });
  setting('dither',
    () => { state.dither = inp('dither').value === 'fs' ? 'fs' : 'none'; },
    () => { inp('dither').value = state.dither; });
  setting('useApp',
    () => { state.useApp = inp('useApp').checked; },
    () => { inp('useApp').checked = state.useApp; });

  for (const k of ['ox', 'oy']) {
    inp(k).addEventListener('change', () => {
      const p = C.parseLocation(`${inp('ox').value}, ${inp('oy').value}`);
      if (!p) { renderPanel(); return; }
      if (state.origin && p.x === state.origin.x && p.y === state.origin.y) return;
      setOrigin(p);
    });
  }

  root.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (li && li.dataset.color !== undefined) {
      state.active = Number(li.dataset.color);
      changed();
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a === 'collapse') { state.collapsed = !state.collapsed; place(); save(); }
    else if (a === 'here') placeHere();
    else if (a === 'next') findNext();
    else if (a === 'toggle') { state.show = !state.show; changed(); }
    else if (a === 'clear' && confirm('ပုံကို ဖယ်မလား?')) clearImage();
  });

  // ---------- start ----------
  load();
  document.body.appendChild(host);
  place();
  changed();
})();
```

- [ ] **Step 2: Verify**

Run: `node --check panel.js && echo OK`
Expected: `OK`

---

### Task 5: README.md (Burmese)

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create the file**

```markdown
# Everyone Draw ပုံဆွဲအကူ (Chrome extension)

ပုံတစ်ပုံကို everyonedraw.com ရဲ့ canvas ပေါ်မှာ ဖောက်ထွင်းမြင်ရအောင် ထပ်ပြပေးပြီး
တစ်ရောင်ချင်း ကိုယ်တိုင် ဆွဲဖို့ လမ်းပြပေးတယ်။ **pixel ကို အလိုအလျောက် မချပါဘူး** — အရောင်ရွေးတာ၊ click တာ ကိုယ်တိုင်ပါ။

## Install (တစ်ခါပဲ)

1. Chrome မှာ `chrome://extensions` ကို ဖွင့်ပါ။
2. ညာဘက်အပေါ်က **Developer mode** ကို ဖွင့်ပါ။
3. **Load unpacked** ကို နှိပ်ပြီး ဒီ folder (`everyone-draw`) ကို ရွေးပါ။
4. https://everyonedraw.com ကို ဖွင့် (ဖွင့်ထားပြီးသားဆို reload) — ဘယ်ဘက်မှာ 🎨 ပုံဆွဲအကူ panel ပေါ်လာမယ်။

code ပြင်ပြီးရင် `chrome://extensions` မှာ extension ရဲ့ ↻ (reload) ကို နှိပ်ပြီး site ကို reload ပါ။

## သုံးနည်း

1. **ပုံထည့်** — panel ထဲက ကွက်ကို click ပြီး ပုံရွေး၊ ပုံဆွဲချ၊ သို့ ကွက်ကို click ပြီး Ctrl+V။ အကျယ် 32–64 က ဆွဲရလွယ်တယ်။
2. **နေရာ** — site ကို ဆွဲချင်တဲ့နေရာ ရွှေ့ပြီး "screen အလယ်မှာ ထားမယ်" ကို နှိပ်ပါ (သို့ x, y ရိုက်ထည့်)။ ပုံက site ပေါ်မှာ အနီ dashed ဘောင်နဲ့ ပေါ်လာမယ်။
3. **အရောင်ရွေး** — panel ရဲ့ အရောင်စာရင်းက အရောင်တစ်ခုကို ရွေးပါ။ အဲအရောင် ဆွဲရမယ့် ကွက်တွေက ထင်ထင်ရှားရှား (zoom ကြီးရင် ဘောင်ခတ်) ပေါ်မယ်။
4. **ဆွဲ** — site ရဲ့ ညာဘက် အရောင်တန်းမှာ အဲအရောင်ကို ရွေးပြီး ဘောင်ခတ်ထားတဲ့ ကွက်တွေကို click ပါ။
   ဆွဲပြီးသား (အရောင်မှန်ပြီးသား) ကွက်တွေကို extension က အလိုလို သိပြီး overlay ကနေ ဖျောက်ပေးတယ်။
5. ကွက်ရှာမတွေ့ရင် **"နောက်တစ်ကွက် ရှာ"** — screen ပေါ်မှာရှိရင် အနီဘောင်နဲ့ ပြမယ်၊ မရှိရင် အဲနေရာကို ခေါ်သွားမယ်။

## မှတ်ချက်

- progress က screen ပေါ်မှာ zoom ≥ 2 နဲ့ မြင်ဖူးတဲ့ ကွက်တွေကိုပဲ စစ်နိုင်တယ်။
- site က update လုပ်ရင် (canvas ဆွဲပုံ ပြောင်းရင်) overlay နေရာ လွဲနိုင်တယ် — ဒါဆို "canvas ကို ရှာနေတယ်…" ပေါ်ပြီး overlay ပျောက်မယ်။
- ပုံနဲ့ progress ကို everyonedraw.com ရဲ့ browser storage မှာ သိမ်းထားတယ်။
```

---

### Task 6: Browser verification (controller)

**Files:** none

- [ ] **Step 1:** `node --test core.test.js` → 35 pass.
- [ ] **Step 2:** Open `https://everyonedraw.com/20/5000/5000` with Chrome DevTools MCP; inject `core.js`, `site.js`, `overlay.js`, `panel.js` in order (evaluate each file's source as a script). Expected: panel appears top-left; `EDSite.getView()` returns a view whose `worldAt(view, innerWidth/2, innerHeight/2)` equals the Share center (±1).
- [ ] **Step 3:** Load a generated test image through the panel's file input; click "screen အလယ်မှာ ထားမယ်". Expected: overlay drawn centered; dashed border; screenshot shows the template aligned to the site's grid lines.
- [ ] **Step 4:** Pan with a synthetic drag (≥ 40 px movement) and reload at another zoom. Expected: overlay stays aligned (compare the hover-preview cell from canvas 4 with `worldAt`).
- [ ] **Step 5:** Detection: choose the color of an existing site pixel inside the template area. Expected: matching cells disappear from the overlay and the counts update.
- [ ] **Step 6:** Panel events: typing in x/y doesn't trigger site shortcuts; dragging the panel doesn't pan the map; reload restores image/origin/active color.
