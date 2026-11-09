// Adapter for everyonedraw.com's canvas. Watches how the site draws its background blocks to know
// exactly which world pixel is where on screen, reads pixel colors from the site's canvases, and
// picks colors / clicks pixels when the panel's auto draw asks it to. It never sends requests itself.
(function () {
  'use strict';
  if (!/^\/(?:[\d.]+\/-?\d+\/-?\d+\/?)?$/.test(location.pathname)) return; // canvas page only
  const C = window.EDCore;
  const listeners = new Set();
  let view = null;       // {zoom, ax, ay} in CSS px, or null while unknown
  let last = null;       // [dx, dy, size] of the latest background block the site drew
  let scheduled = false;
  let settleTimer = 0;
  let settleTries = 0;
  let mismatch = false;  // the site's drawing didn't fit our model last time we checked
  let bg = null;
  // Pointer tracking (read-only) to guess the next view: a drag keeps the grabbed world point under
  // the pointer, a wheel zoom keeps the point under the cursor, anything else is assumed to move
  // around the screen center.
  let pointer = { x: innerWidth / 2, y: innerHeight / 2 };
  let prevPointer = pointer;   // pointer position when the current view was computed
  let pointerDown = false;
  let lastDragAt = -1e9, lastWheelAt = -1e9;

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

  // Returns true if the view changed.
  function setView(v) {
    const same = v === view || (v && view && v.zoom === view.zoom && v.ax === view.ax && v.ay === view.ay);
    if (same) return false;
    view = v;
    listeners.forEach((fn) => {
      try { fn(view); } catch (e) { console.error('[edhelper]', e); }
    });
    return true;
  }

  function scheduleSettle() {
    settleTries = 0;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 300);
  }

  // Runs right after the site's draw (same frame): follow the view from the previous one.
  function update() {
    scheduled = false;
    let changed = false;
    try {
      if (!last || mismatch) {
        // keep the overlay hidden until settle() confirms the site fits our model again
      } else if (view) {
        const [dx, dy, size] = last;
        const now = performance.now();
        const center = { x: innerWidth / 2, y: innerHeight / 2 };
        let from = center, to = center;
        if (pointerDown && now - lastDragAt < 150) { from = prevPointer; to = pointer; }
        else if (now - lastWheelAt < 150) { from = pointer; to = pointer; }
        const w = C.worldPoint(view, from.x, from.y);
        changed = setView(C.viewFromBlockAt(dx, dy, size, w.x, w.y, to.x, to.y));
      } else {
        const [dx, dy, size] = last;
        const est = shareCenter() || C.parseLocation(location.href);
        if (est) changed = setView(C.viewFromBlock(dx, dy, size, est.x, est.y, innerWidth, innerHeight));
      }
    } catch (e) {
      console.error('[edhelper]', e);
    }
    prevPointer = pointer;
    if (changed || mismatch || !view || !settleTimer) scheduleSettle();
  }

  // Once the view has been still for a moment the Share label is current: use it to correct a
  // wrong block guess, or to hide the overlay if the site's drawing no longer fits our model.
  function settle() {
    settleTimer = 0;
    if (!last) return;
    const share = shareCenter();
    if (!share) {
      if (++settleTries < 20) settleTimer = setTimeout(settle, 500);
      return;
    }
    const [dx, dy, size] = last;
    const v = C.viewFromBlock(dx, dy, size, share.x, share.y, innerWidth, innerHeight);
    mismatch = far(centerOf(v), share);
    setView(mismatch ? null : v);
  }

  const opts = { capture: true, passive: true };
  addEventListener('pointerdown', (e) => {
    pointer = prevPointer = { x: e.clientX, y: e.clientY };
    pointerDown = true;
    lastDragAt = performance.now();
  }, opts);
  addEventListener('pointermove', (e) => {
    pointer = { x: e.clientX, y: e.clientY };
    if (pointerDown) lastDragAt = performance.now();
  }, opts);
  for (const type of ['pointerup', 'pointercancel']) addEventListener(type, () => { pointerDown = false; }, opts);
  addEventListener('wheel', (e) => {
    pointer = prevPointer = { x: e.clientX, y: e.clientY };
    lastWheelAt = performance.now();
  }, opts);

  const proto = CanvasRenderingContext2D.prototype;
  const fillRect = proto.fillRect;
  proto.fillRect = function (x, y, w, h) {
    // Every block in a frame gives the same view, so only the first one per frame is used.
    // A block is 128 world px, so its size is 128 x zoom; ignore squares outside a sane zoom range.
    if (!scheduled && w === h && w >= 8 && w <= 51200) {
      try {
        if (isBackground(this.canvas)) {
          const m = this.getTransform();
          const s = cssScale(this.canvas);
          last = [(m.a * x + m.e) / s, (m.d * y + m.f) / s, (m.a * w) / s];
          scheduled = true;
          queueMicrotask(update);
        }
      } catch (e) { /* never break the site */ }
    }
    return fillRect.apply(this, arguments);
  };

  // Reads the site's colors inside the screen rectangle (x0, y0)-(x1, y1) (CSS px).
  // Returns read(sx, sy) -> [r, g, b, 255] | null: the first opaque color among live pixels,
  // tiles, then background (never the hover preview).
  function snapshot(x0, y0, x1, y1) {
    const cs = siteCanvases();
    const layers = [cs[2], cs[1], cs[0]].filter(Boolean).map((c) => {
      const s = cssScale(c);
      const rx = Math.max(0, Math.floor(x0 * s)), ry = Math.max(0, Math.floor(y0 * s));
      const rw = Math.min(c.width, Math.ceil(x1 * s)) - rx, rh = Math.min(c.height, Math.ceil(y1 * s)) - ry;
      if (rw <= 0 || rh <= 0) return null;
      try {
        return { s, rx, ry, rw, rh, data: c.getContext('2d').getImageData(rx, ry, rw, rh).data };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
    return (sx, sy) => {
      for (const L of layers) {
        const x = Math.floor(sx * L.s) - L.rx, y = Math.floor(sy * L.s) - L.ry;
        if (x < 0 || y < 0 || x >= L.rw || y >= L.rh) continue;
        const i = (y * L.rw + x) * 4;
        if (L.data[i + 3] !== 255) continue;
        return [L.data[i], L.data[i + 1], L.data[i + 2], 255];
      }
      return null;
    };
  }

  // Left-clicks screen point (sx, sy) (CSS px) on the site's input canvas: the site places a pixel
  // on mousedown + mouseup at the same spot. Skipped (returns false) while the user is pressing or
  // just zoomed, so a click never cuts into a drag or lands on a stale view.
  function click(sx, sy) {
    const input = siteCanvases()[5];
    if (!input || pointerDown || performance.now() - lastWheelAt < 500) return false;
    const init = { bubbles: true, cancelable: true, view: window, clientX: sx, clientY: sy, button: 0 };
    input.dispatchEvent(new MouseEvent('mousedown', { ...init, buttons: 1 }));
    input.dispatchEvent(new MouseEvent('mouseup', init));
    return true;
  }

  // Picks palette color i on the site: its swatches are in PALETTE_WEB order. The site applies the
  // pick a frame or two later, so wait a moment before clicking a pixel. False if there's no swatch i.
  function selectColor(i) {
    const sw = document.querySelectorAll('.swatch')[i];
    if (!sw) return false;
    sw.click();
    return true;
  }

  // Calls fn(i) whenever the user (not selectColor) picks palette color i on the site.
  function onColorPick(fn) {
    addEventListener('click', (e) => {
      if (!e.isTrusted || !(e.target instanceof Element)) return;
      const sw = e.target.closest('.swatch');
      const i = sw ? Array.prototype.indexOf.call(document.querySelectorAll('.swatch'), sw) : -1;
      if (i >= 0) fn(i);
    }, true);
  }

  window.EDSite = {
    getView: () => view,
    onView(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    snapshot,
    click,
    selectColor,
    onColorPick,
    siteCanvases,
    centerPixel: () => (view ? centerOf(view) : shareCenter() || C.parseLocation(location.href)),
    refresh: () => dispatchEvent(new Event('resize')),
  };
  window.EDSite.refresh(); // make the site redraw so we learn the view right away
})();
