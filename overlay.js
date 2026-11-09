// Draws the template on its own canvas, stacked above the site's pixels but below the site's grid
// lines, hover preview and input layer. pointer-events:none, so every click still goes to the site.
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
    // Right after the site's live-pixel canvas (index 2), so the site's grid (3), hover preview (4)
    // and input layer (5) stay on top of us.
    const site = S.siteCanvases();
    const anchor = site[Math.min(2, site.length - 1)];
    if (anchor) {
      if (anchor.nextElementSibling !== canvas) anchor.after(canvas);
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
      const d = (active < 0 || c === active ? fi : gi).data, rgb = palette[c].rgb, i = p * 4;
      d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255;
    }
    ghost.getContext('2d').putImageData(gi, 0, 0);
    focus.getContext('2d').putImageData(fi, 0, 0);
  }

  // Thin black + white frame inside each cell still to draw in the chosen color (zoomed in only).
  function outlines(view, W, H) {
    const { q, origin, matched, active } = model;
    const z = view.zoom;
    const v = C.visibleCells(view, origin, q.w, q.h, W, H);
    if (!v || (v.c1 - v.c0 + 1) * (v.r1 - v.r0 + 1) > 20000) return;
    const dark = new Path2D(), light = new Path2D();
    for (let r = v.r0; r <= v.r1; r++) {
      for (let c = v.c0; c <= v.c1; c++) {
        const p = r * q.w + c, ci = q.idx[p];
        if (ci < 0 || matched[p] || (active >= 0 && ci !== active)) continue;
        const pos = C.toCanvas(c, r, origin.x, origin.y);
        const rect = C.screenRect(view, pos.x, pos.y);
        dark.rect(rect.x + 0.5, rect.y + 0.5, z - 1, z - 1);
        light.rect(rect.x + 1.5, rect.y + 1.5, z - 3, z - 3);
      }
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.stroke(dark);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke(light);
  }

  function render() {
    ensureCanvas();
    const dpr = window.devicePixelRatio || 1, W = innerWidth, H = innerHeight;
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const view = S.getView();
    if (!view) return;
    if (model && model.show && model.q && model.origin && ghost) {
      const { q, origin } = model;
      const z = view.zoom;
      const tl = C.screenRect(view, origin.x, origin.y);
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.3;
      ctx.drawImage(ghost, tl.x, tl.y, q.w * z, q.h * z);
      ctx.globalAlpha = 0.8;
      ctx.drawImage(focus, tl.x, tl.y, q.w * z, q.h * z);
      ctx.globalAlpha = 1;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#ff004d';
      ctx.strokeRect(tl.x - 0.5, tl.y - 0.5, q.w * z + 1, q.h * z + 1);
      ctx.setLineDash([]);
      if (z >= 16) outlines(view, W, H);
    }
    if (pulse) {
      const now = performance.now();
      if (now > pulse.until) {
        pulse = null;
      } else {
        const z = view.zoom;
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
