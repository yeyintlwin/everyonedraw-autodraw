(function (root, factory) {
  const api = factory();
  // Node (tests) gets module.exports; in a page always use a global, even if the page defines `module`.
  if (typeof window === 'undefined' && typeof module === 'object' && module.exports) module.exports = api;
  else root.EDCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_SIDE = 512;

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

  function resizeImage(rgba, w, h, newW) {
    newW = Math.max(1, Math.min(MAX_SIDE, Math.round(newW)));
    let newH = Math.max(1, Math.round((h * newW) / w));
    if (newH > MAX_SIDE) {
      newH = MAX_SIDE;
      newW = Math.max(1, Math.round((w * MAX_SIDE) / h));
    }
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

  // ---------- everyonedraw view math ----------
  // The site draws 128x128 world-pixel blocks whose edges sit at 128k + 64 on both axes.
  const BLOCK = 128;
  const BLOCK_OFFSET = 64;

  // A view maps world pixels to screen CSS px: pixel X's left edge is at ax + X*zoom,
  // row Y's top edge is at ay - Y*zoom (world y grows up).
  // (dx, dy, size) is one block rect the site drew; (wx, wy) is a guess of the continuous world
  // point under screen point (sx, sy), accurate to well under 64 pixels.
  function viewFromBlockAt(dx, dy, size, wx, wy, sx, sy) {
    const zoom = size / BLOCK;
    const leftEst = wx + (dx - sx) / zoom;
    const left = Math.round((leftEst - BLOCK_OFFSET) / BLOCK) * BLOCK + BLOCK_OFFSET;
    const topEst = wy + (sy - dy) / zoom;
    const top = Math.round((topEst - (BLOCK - 1) - BLOCK_OFFSET) / BLOCK) * BLOCK + BLOCK_OFFSET + BLOCK - 1;
    return { zoom, ax: dx - left * zoom, ay: dy + top * zoom };
  }

  // Same, with the guess given as the integer screen-center pixel (estX, estY) of a vw x vh viewport.
  function viewFromBlock(dx, dy, size, estX, estY, vw, vh) {
    return viewFromBlockAt(dx, dy, size, estX + 0.5, estY - 0.5, vw / 2, vh / 2);
  }

  // Continuous world coordinates of screen point (sx, sy).
  function worldPoint(view, sx, sy) {
    return { x: (sx - view.ax) / view.zoom, y: (view.ay - sy) / view.zoom };
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
  // The site's canvas can read back a few units off the palette (e.g. yellow #FFEC27 reads as #FFED24).
  const COLOR_TOLERANCE = 6;

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
        const ok = px[3] === 255
          && Math.abs(px[0] - t[0]) <= COLOR_TOLERANCE
          && Math.abs(px[1] - t[1]) <= COLOR_TOLERANCE
          && Math.abs(px[2] - t[2]) <= COLOR_TOLERANCE ? 1 : 0;
        if (matched[p] !== ok) { matched[p] = ok; changed++; }
      }
    }
    return changed;
  }

  // Nearest not-yet-matched pixel of colorIndex (-1 = any color) to world point (cx, cy),
  // also leaving out cells set in the optional `skip` array.
  function findNearest(q, origin, matched, colorIndex, cx, cy, skip) {
    let best = null, bestD = Infinity;
    for (let p = 0; p < q.idx.length; p++) {
      const ci = q.idx[p];
      if (ci < 0 || matched[p] || (skip && skip[p]) || (colorIndex >= 0 && ci !== colorIndex)) continue;
      const pos = toCanvas(p % q.w, Math.floor(p / q.w), origin.x, origin.y);
      const d = (pos.x - cx) ** 2 + (pos.y - cy) ** 2;
      if (d < bestD) { bestD = d; best = { x: pos.x, y: pos.y, p }; }
    }
    return best;
  }

  // First cell, row by row, that the overlay highlights for colorIndex (still to draw, on screen)
  // and that isn't set in `skip` (e.g. cells already clicked). Returns {p, sx, sy} with an integer screen
  // point (CSS px) inside the cell, or null. Needs zoom >= 2 so the rounded point stays in the cell.
  function nextClick(q, origin, matched, colorIndex, view, vw, vh, skip) {
    if (colorIndex < 0 || view.zoom < 2) return null;
    const v = visibleCells(view, origin, q.w, q.h, vw, vh);
    if (!v) return null;
    const half = view.zoom / 2;
    for (let r = v.r0; r <= v.r1; r++) {
      for (let c = v.c0; c <= v.c1; c++) {
        const p = r * q.w + c;
        if (q.idx[p] !== colorIndex || matched[p] || skip[p]) continue;
        const pos = toCanvas(c, r, origin.x, origin.y);
        const rect = screenRect(view, pos.x, pos.y);
        const sx = Math.floor(rect.x + half), sy = Math.floor(rect.y + half);
        if (sx < 0 || sy < 0 || sx >= vw || sy >= vh) continue;
        return { p, sx, sy };
      }
    }
    return null;
  }

  function toCanvas(c, r, X0, Y0) {
    return { x: X0 + c, y: Y0 - r };
  }

  function parseLocation(text) {
    const s = String(text == null ? '' : text)
      .replace(/[\u1040-\u1049]/g, (d) => String(d.charCodeAt(0) - 0x1040)) // Burmese digits
      .replace(/\u2212/g, '-') // Unicode minus sign
      .replace(/\u104A/g, ',') // Burmese comma
      .trim();
    const m = s.match(/everyonedraw\.com\/[\d.]+\/(-?\d+)\/(-?\d+)(?=$|[\s/?#])/i)
      || s.match(/^\(?\s*(-?\d+)\s*(?:,\s*|\s+)(-?\d+)\s*\)?$/);
    if (!m) return null;
    const x = Number(m[1]), y = Number(m[2]);
    return Number.isSafeInteger(x) && Number.isSafeInteger(y) ? { x, y } : null;
  }

  function siteUrl(x, y, zoom) {
    return `https://everyonedraw.com/${zoom}/${x}/${y}`;
  }

  function encodeIdx(idx) {
    return Array.from(idx, (c) => (c + 1).toString(36)).join('');
  }

  function decodeIdx(str) {
    if (typeof str !== 'string' || !/^[0-9a-w]*$/.test(str)) return null;
    const out = new Int16Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = parseInt(str[i], 36) - 1;
    return out;
  }

  return {
    MAX_SIDE, PALETTE_WEB, PALETTE_APP, getPalette, srgbToOklab, nearestColor, resizeImage, quantize,
    buildLayers, toCanvas, parseLocation, siteUrl, encodeIdx, decodeIdx,
    viewFromBlock, viewFromBlockAt, worldPoint, worldAt, screenRect, parseShare,
    visibleCells, detectMatches, findNearest, nextClick, COLOR_TOLERANCE,
  };
});
