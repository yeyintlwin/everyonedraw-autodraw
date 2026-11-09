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

const Q = { w: 3, h: 2, idx: Int16Array.from([2, 0, 2, -1, 2, 0]) };

test('buildLayers: groups by color, row-major, most pixels first', () => {
  assert.deepEqual(C.buildLayers(Q), [
    { colorIndex: 2, pixels: [0, 2, 4] },
    { colorIndex: 0, pixels: [1, 5] },
  ]);
});

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

test('resizeImage: tall image is capped at MAX_SIDE height', () => {
  const src = new Uint8ClampedArray(1 * 2048 * 4).fill(255);
  const out = C.resizeImage(src, 1, 2048, 512);
  assert.equal(out.w, 1);
  assert.equal(out.h, 512);
});

test('resizeImage: wide request is capped at MAX_SIDE width', () => {
  const src = new Uint8ClampedArray(4 * 2 * 4).fill(255);
  const out = C.resizeImage(src, 4, 2, 600);
  assert.equal(out.w, 512);
  assert.equal(out.h, 256);
});

test('resizeImage: non-integer scale weights partial pixels', () => {
  const src = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
  const out = C.resizeImage(src, 3, 1, 2);
  assert.equal(out.w, 2);
  assert.equal(out.h, 1);
  assert.deepEqual(Array.from(out.data), [85, 85, 85, 255, 85, 85, 85, 255]);
});

test('resizeImage: integer upscale replicates', () => {
  const src = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
  const out = C.resizeImage(src, 2, 1, 4);
  assert.equal(out.w, 4);
  assert.equal(out.h, 2);
  for (let row = 0; row < 2; row++) {
    const r = [0, 1, 2, 3].map((x) => out.data[(row * 4 + x) * 4]);
    assert.deepEqual(r, [0, 0, 255, 255]);
  }
});

test('parseLocation: rejects fractions, accepts fragment, Burmese digits, minus sign, unsafe ints', () => {
  assert.equal(C.parseLocation('https://everyonedraw.com/40/5000/-4994.7'), null);
  assert.equal(C.parseLocation('https://everyonedraw.com/40/5000.5/-4994'), null);
  assert.deepEqual(C.parseLocation('https://everyonedraw.com/40/5000/-4994#a'), { x: 5000, y: -4994 });
  assert.deepEqual(C.parseLocation('\u1045\u1040\u1040\u1040, \u1045\u1040\u1040\u1040'), { x: 5000, y: 5000 });
  assert.deepEqual(C.parseLocation('\u221212, 3'), { x: -12, y: 3 });
  assert.equal(C.parseLocation('99999999999999999999, 1'), null);
});

test('decodeIdx: invalid input returns null', () => {
  assert.equal(C.decodeIdx('0!1'), null);
  assert.equal(C.decodeIdx('x'), null);
  assert.equal(C.decodeIdx(5), null);
  assert.equal(C.decodeIdx('').length, 0);
});

test('srgbToOklab: red matches reference', () => {
  const r = C.srgbToOklab(255, 0, 0);
  [0.6280, 0.2249, 0.1258].forEach((v, i) => assert.ok(Math.abs(r[i] - v) < 1e-3));
});

test('quantize fs: average of chosen colors approximates flat gray', () => {
  const pal = C.getPalette(false);
  const q = C.quantize(grayImage(16, 16, 140), 16, 16, pal, 'fs');
  for (let ch = 0; ch < 3; ch++) {
    let sum = 0;
    for (const i of q.idx) sum += pal[i].rgb[ch];
    assert.ok(Math.abs(sum / q.idx.length - 140) <= 6, `channel ${ch}: ${sum / q.idx.length}`);
  }
});

test('quantize fs: transparent stays -1, alpha 128 is opaque', () => {
  // Gray 140 is not a palette color, so dithering error is spread into the transparent neighbors.
  const src = new Uint8ClampedArray([
    140, 140, 140, 255, 140, 140, 140, 0, 140, 140, 140, 128, 140, 140, 140, 127,
  ]);
  const q = C.quantize(src, 4, 1, C.getPalette(false), 'fs');
  assert.equal(q.idx[1], -1);
  assert.equal(q.idx[3], -1);
  assert.ok(q.idx[0] >= 0 && q.idx[2] >= 0);
});

test('parseLocation: Burmese comma and URL inside text', () => {
  assert.deepEqual(C.parseLocation('၅၀၀၀၊ ၅၀၀၀'), { x: 5000, y: 5000 });
  assert.deepEqual(C.parseLocation('see https://everyonedraw.com/40/1/2 here'), { x: 1, y: 2 });
});

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

test('viewFromBlockAt: cursor-anchored zoom with a large center shift', () => {
  // Zoom 2 -> 3 around the cursor at (1800, 1000): the world point under the cursor stays put,
  // but the screen center moves by ~150 world px, too far for a center-based estimate.
  const before = { zoom: 2, ax: 0, ay: 0 };
  const anchor = C.worldPoint(before, 1800, 1000);
  assert.deepEqual(anchor, { x: 900, y: -500 });
  // The site then draws the block whose left edge is world 64 and top row is world 191.
  const v = C.viewFromBlockAt(-708, -1073, 384, anchor.x, anchor.y, 1800, 1000);
  assert.deepEqual(v, { zoom: 3, ax: -900, ay: -500 });
  // The old center-based estimate lands one block off here.
  const c = C.worldAt(before, 960, 540);
  assert.notDeepEqual(C.viewFromBlock(-708, -1073, 384, c.x, c.y, 1920, 1080), v);
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

test('detectMatches: tolerates small color drift on the site canvas', () => {
  // The site's yellow reads back as #FFED24 instead of the palette's #FFEC27.
  const pal = C.getPalette(false);
  const q = { w: 1, h: 1, idx: Int16Array.from([14]) }; // Yellow
  const matched = new Uint8Array(1);
  const view = { zoom: 10, ax: 0, ay: 0 };
  assert.equal(C.detectMatches(q, pal, { x: 0, y: 0 }, view, () => [255, 237, 36, 255], 100, 100, matched), 1);
  assert.equal(matched[0], 1);
  // Orange (#FFA300) is not yellow
  assert.equal(C.detectMatches(q, pal, { x: 0, y: 0 }, view, () => [255, 163, 0, 255], 100, 100, matched), 1);
  assert.equal(matched[0], 0);
});

test('palette: no two colors are within the match tolerance', () => {
  const pal = C.getPalette(true);
  for (let i = 0; i < pal.length; i++) {
    for (let j = i + 1; j < pal.length; j++) {
      const d = Math.max(...pal[i].rgb.map((v, k) => Math.abs(v - pal[j].rgb[k])));
      assert.ok(d > 2 * C.COLOR_TOLERANCE, `${pal[i].name} vs ${pal[j].name}: ${d}`);
    }
  }
});

test('findNearest: closest unmatched pixel of the chosen color', () => {
  const q = { w: 3, h: 1, idx: Int16Array.from([7, 0, 7]) };
  const o = { x: 10, y: 20 };
  assert.deepEqual(C.findNearest(q, o, new Uint8Array(3), 7, 12, 20), { x: 12, y: 20, p: 2 });
  assert.deepEqual(C.findNearest(q, o, Uint8Array.from([0, 0, 1]), 7, 12, 20), { x: 10, y: 20, p: 0 });
  assert.deepEqual(C.findNearest(q, o, new Uint8Array(3), -1, 11, 20), { x: 11, y: 20, p: 1 });
  assert.equal(C.findNearest(q, o, Uint8Array.from([1, 1, 1]), -1, 0, 0), null);
});

test('nextClick: first on-screen cell of the chosen color still to draw, as an integer screen point', () => {
  const q = { w: 3, h: 2, idx: Int16Array.from([7, 0, 7, 7, -1, 7]) };
  const o = { x: 0, y: 0 };
  const view = { zoom: 10, ax: 0, ay: 0 };
  const none = new Uint8Array(6);
  const skip = (...ps) => { const a = new Uint8Array(6); ps.forEach((p) => { a[p] = 1; }); return a; };
  assert.deepEqual(C.nextClick(q, o, none, 7, view, 100, 100, none), { p: 0, sx: 5, sy: 5 });
  assert.deepEqual(C.nextClick(q, o, skip(0), 7, view, 100, 100, none), { p: 2, sx: 25, sy: 5 }); // matched
  assert.deepEqual(C.nextClick(q, o, none, 7, view, 100, 100, skip(0, 2)), { p: 3, sx: 5, sy: 15 }); // clicked
  assert.deepEqual(C.nextClick(q, o, none, 7, view, 20, 100, skip(0)), { p: 3, sx: 5, sy: 15 }); // p 2 off screen
  assert.equal(C.nextClick(q, o, none, 7, view, 100, 100, skip(0, 2, 3, 5)), null);
  assert.equal(C.nextClick(q, o, none, -1, view, 100, 100, none), null); // never "all colors"
  assert.equal(C.nextClick(q, o, none, 7, { zoom: 1, ax: 0, ay: 0 }, 100, 100, none), null);
  assert.deepEqual(C.nextClick(q, o, none, 7, { zoom: 2, ax: 0.7, ay: 0 }, 100, 100, none), { p: 0, sx: 1, sy: 1 });
});

test('findNearest: optional skip list (cells already clicked)', () => {
  const q = { w: 3, h: 1, idx: Int16Array.from([7, 0, 7]) };
  const o = { x: 10, y: 20 };
  assert.deepEqual(C.findNearest(q, o, new Uint8Array(3), 7, 12, 20, Uint8Array.from([0, 0, 1])), { x: 10, y: 20, p: 0 });
  assert.equal(C.findNearest(q, o, Uint8Array.from([1, 0, 0]), 7, 12, 20, Uint8Array.from([0, 0, 1])), null);
});
