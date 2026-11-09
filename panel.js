// Floating panel on everyonedraw: load an image, place it, pick a color, see progress, and
// keep the chosen color in sync with the site's palette, and optionally auto-draw that color.
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
    clicked: new Uint8Array(0),      // 1 = auto draw already clicked it (saved, so a run can resume)
    collapsed: false,
    pos: { x: 12, y: 84 },
    delay: 1000,                     // ms between auto clicks
  };
  const clampDelay = (v) => Math.max(100, Math.min(60000, Math.round(Number(v)) || 1000));

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
  .row.auto { align-items: flex-end; }
  .row.auto label { flex: 1; }
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
      <div class="drop" tabindex="0" role="button">ပုံကို ဒီမှာ ဆွဲချပါ၊ click နှိပ်ရွေးပါ၊ သို့ Ctrl+V နဲ့ paste လုပ်ပါ</div>
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
      <div class="row auto">
        <label>Click ကြား (ms)<input data-k="delay" type="number" min="100" max="60000" step="100"></label>
        <button class="btn primary" data-act="auto">▶ ဒီအရောင် ဆွဲ</button>
      </div>
      <p class="hint" data-out="autoMsg"></p>
    </section>
    <section>
      <h3>၄။ Progress</h3>
      <div class="bar"><div data-out="bar"></div></div>
      <p class="hint" data-out="progress"></p>
      <div class="row">
        <button class="btn" data-act="reset" title="ဒီအရောင်ရဲ့ auto click မှတ်တမ်းကို ဖျက်ပြီး မဆွဲရသေးတဲ့ ကွက်တွေကို အစက ပြန်ဆွဲမယ်">ပြန်စ</button>
        <button class="btn" data-act="clear">ပုံ ဖယ်မယ်</button>
      </div>
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

  // Keep the site's pan/zoom handlers from reacting to presses and wheel inside the panel, and its
  // shortcuts from reacting to typing in our inputs. A drag that started on the map and ends over
  // the panel still reaches the site, so its pan never gets stuck.
  let pressInPanel = false;
  addEventListener('pointerdown', (e) => {
    pressInPanel = e.composedPath().includes(host);
    // Pressing anywhere else takes focus out of the panel, so keys go back to the site and can't
    // accidentally change a setting (e.g. Space on the checkbox).
    if (!pressInPanel && root.activeElement) root.activeElement.blur();
  }, true);
  for (const type of ['pointerdown', 'mousedown', 'touchstart', 'wheel']) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }
  for (const type of ['pointerup', 'pointermove', 'pointercancel', 'mouseup', 'mousemove', 'touchmove',
    'touchend', 'click', 'dblclick', 'contextmenu']) {
    host.addEventListener(type, (e) => { if (pressInPanel) e.stopPropagation(); });
  }
  const isTextField = (t) => t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;
  for (const type of ['keydown', 'keyup', 'keypress', 'paste']) {
    host.addEventListener(type, (e) => { if (isTextField(e.composedPath()[0])) e.stopPropagation(); });
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
    if (e.button !== 0 || e.target.closest('button')) return;
    const offX = e.clientX - state.pos.x, offY = e.clientY - state.pos.y;
    try { head.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    const move = (ev) => { state.pos = clampPos(ev.clientX - offX, ev.clientY - offY); place(); };
    const end = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', end);
      head.removeEventListener('pointercancel', end);
      head.removeEventListener('lostpointercapture', end);
      save();
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    head.addEventListener('lostpointercapture', end);
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
    state.clicked = new Uint8Array(state.q.idx.length);
    if (!state.layers.some((l) => l.colorIndex === state.active)) {
      state.active = state.layers.length ? state.layers[0].colorIndex : -1;
    }
    if (!state.origin) state.origin = centeredOrigin();
    changed();
  }

  function clearImage() {
    state.src = null;
    state.q = null;
    state.layers = [];
    state.matched = new Uint8Array(0);
    state.clicked = new Uint8Array(0);
    state.active = -1;
    changed();
  }

  // ---------- location ----------
  function setOrigin(o) {
    state.origin = o;
    if (state.q) {
      state.matched = new Uint8Array(state.q.idx.length);
      state.clicked = new Uint8Array(state.q.idx.length);
    }
    changed();
  }

  // Origin that puts the image's middle at the screen-center pixel, or null if unknown.
  function centeredOrigin() {
    const c = S.centerPixel();
    if (!c) return null;
    const w = state.q ? state.q.w : 0, h = state.q ? state.q.h : 0;
    return { x: c.x - Math.floor(w / 2), y: c.y + Math.floor(h / 2) };
  }

  function placeHere() {
    const o = centeredOrigin();
    if (!o || (state.origin && o.x === state.origin.x && o.y === state.origin.y)) return;
    setOrigin(o);
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
    try { sessionStorage.setItem(KEY + '.pulse', JSON.stringify({ x: t.x, y: t.y, t: Date.now() })); } catch (e) { /* ignore */ }
    flushSave();
    location.href = C.siteUrl(t.x, t.y, zoom);
  }

  // After a find-next reload: flash the pixel we jumped to (once, and only if recent).
  function pulsePending() {
    try {
      const raw = sessionStorage.getItem(KEY + '.pulse');
      if (!raw) return;
      sessionStorage.removeItem(KEY + '.pulse');
      const p = JSON.parse(raw);
      if (Date.now() - p.t < 15000 && Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y)) O.pulse(p.x, p.y);
    } catch (e) { /* ignore */ }
  }

  // ---------- detection ----------
  let detectTimer = 0;
  function scheduleDetect(ms) {
    clearTimeout(detectTimer);
    detectTimer = setTimeout(detect, ms);
  }
  function detect() {
    const view = S.getView();
    const { q, origin } = state;
    if (!q || !origin || !view || view.zoom < 2) return;
    const v = C.visibleCells(view, origin, q.w, q.h, innerWidth, innerHeight);
    if (!v) return;
    // Only read the part of the site's canvases that the image covers.
    const tl = C.screenRect(view, origin.x + v.c0, origin.y - v.r0);
    const br = C.screenRect(view, origin.x + v.c1, origin.y - v.r1);
    const read = S.snapshot(tl.x, tl.y, br.x + view.zoom, br.y + view.zoom);
    const n = C.detectMatches(q, state.palette, origin, view, read, innerWidth, innerHeight, state.matched);
    if (n) { O.update(); renderPanel(); saveSoon(); }
  }
  setInterval(() => { if (!document.hidden) detect(); }, 1500);
  addEventListener('pointerup', () => scheduleDetect(400), true);

  let hadView = false;
  S.onView((v) => {
    if (!!v !== hadView) { hadView = !!v; renderPanel(); }
    if (!v) return;
    pulsePending();
    resumePending();
    scheduleDetect(250);
  });

  // ---------- color sync + auto draw ----------
  // The color chosen here and the site's palette color follow each other (site.js does the clicks).
  // ▶ draws the chosen color only: it clicks that color's highlighted cells on screen every
  // state.delay ms, and when the rest is off screen it opens the page there (a reload) and carries
  // on. It never reads the site to check a click: state.clicked remembers every cell it clicked
  // (saved), so ▶ after a stop or reload continues where it left off. "ပြန်စ" forgets the chosen
  // color's clicks, to retry its cells that still aren't drawn.
  const AUTO_KEY = KEY + '.auto';
  const WEB_COLORS = C.PALETTE_WEB.length;   // the site's palette; app-only colors can't be picked
  let auto = null;   // {q, origin, color, selected, clicks, sinceJump, jumpedTo, noView, timer}
  let autoMsg = '';
  const autoStale = () => auto.q !== state.q || auto.origin !== state.origin || auto.color !== state.active;
  const onSite = (c) => c >= 0 && c < WEB_COLORS;

  // Chosen here: pick it on the site too (again, if it's already chosen here).
  function chooseColor(c, fromSite) {
    if (!fromSite && onSite(c)) S.selectColor(c);
    if (c === state.active) return;
    state.active = c;
    changed(); // also stops a run of another color
  }
  // Chosen on the site: pick it here too, if the image uses it.
  S.onColorPick((c) => {
    if (state.layers.some((l) => l.colorIndex === c)) chooseColor(c, true);
  });

  // jumpedTo = the cell a jump just went to (-1 for a fresh start); wait = ms before the first step.
  function startAuto(jumpedTo, wait) {
    if (auto || !state.q || !state.origin || !onSite(state.active)) return;
    auto = {
      q: state.q, origin: state.origin, color: state.active, selected: -1,
      clicks: 0, sinceJump: 0, jumpedTo, noView: 0, timer: 0,
    };
    autoMsg = '';
    auto.timer = setTimeout(autoTick, wait);
    renderPanel();
  }

  function stopAuto(msg) {
    if (!auto) return;
    clearTimeout(auto.timer);
    auto = null;
    autoMsg = msg || '';
    renderPanel();
    flushSave();
  }

  function autoTick() {
    if (!auto) return;
    if (autoStale()) { stopAuto('ပုံ၊ နေရာ သို့ အရောင် ပြောင်းလို့ ရပ်လိုက်တယ်။'); return; }
    const view = S.getView();
    if (!view) {
      if (++auto.noView > 20) stopAuto('canvas ကို မတွေ့လို့ ရပ်လိုက်တယ်။');
      else auto.timer = setTimeout(autoTick, 500);
      return;
    }
    auto.noView = 0;
    if (view.zoom < 2) { stopAuto('zoom နည်းလွန်းတယ် — zoom ချဲ့ပြီး ▶ ပြန်နှိပ်ပါ။'); return; }
    const { q, origin, palette } = state;
    const color = auto.color;
    if (auto.selected !== color) { // make sure the site has this color, even if it was changed there
      if (!S.selectColor(color)) { stopAuto('site ရဲ့ အရောင်ခလုတ်ကို မတွေ့လို့ ရပ်လိုက်တယ်။'); return; }
      auto.selected = color;
      auto.timer = setTimeout(autoTick, 400); // the site applies the pick a frame or two later
      return;
    }
    const t = C.nextClick(q, origin, state.matched, color, view, innerWidth, innerHeight, state.clicked);
    if (t) {
      if (S.click(t.sx, t.sy)) {
        state.clicked[t.p] = 1;
        auto.clicks++;
        auto.sinceJump++;
        renderPanel();
        saveSoon();
      }
      auto.timer = setTimeout(autoTick, state.delay);
      return;
    }
    // The rest of this color is off screen: open the page at the nearest cell left, carry on there.
    const c = S.centerPixel() || origin;
    const n = C.findNearest(q, origin, state.matched, color, c.x, c.y, state.clicked);
    if (!n) {
      stopAuto(`${palette[color].name} ပြီးပြီ 🎉 နောက်အရောင် ရွေးပြီး ▶ နှိပ်ပါ။`);
      return;
    }
    if (auto.sinceJump === 0 && auto.jumpedTo === n.p) {
      stopAuto('နောက်ကွက်ဆီ ရွှေ့လို့ မရလို့ ရပ်လိုက်တယ်။ screen ရွှေ့ပြီး ▶ ပြန်နှိပ်ပါ။');
      return;
    }
    try {
      sessionStorage.setItem(AUTO_KEY, JSON.stringify({ p: n.p, t: Date.now() }));
    } catch (e) {
      stopAuto('screen ပြင်ပ ကွက်တွေ ကျန်တယ် — screen ရွှေ့ပြီး ▶ ပြန်နှိပ်ပါ။');
      return;
    }
    flushSave();
    location.href = C.siteUrl(n.x, n.y, Math.round(view.zoom));
  }

  // After an auto draw jump (once, and only if recent): carry on, giving the site a moment to
  // connect before the first click.
  function resumePending() {
    let r = null;
    try {
      r = JSON.parse(sessionStorage.getItem(AUTO_KEY) || 'null');
      sessionStorage.removeItem(AUTO_KEY);
    } catch (e) { /* ignore */ }
    if (r && Date.now() - r.t < 30000 && Number.isInteger(r.p)) startAuto(r.p, 2000);
  }

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
    // Never overwrite the field the user is typing in.
    const idle = (k) => root.activeElement !== inp(k);
    if (idle('width')) inp('width').value = state.width;
    if (idle('dither')) inp('dither').value = state.dither;
    if (idle('delay')) inp('delay').value = state.delay;
    inp('useApp').checked = state.useApp;
    if (idle('ox')) inp('ox').value = state.origin ? String(state.origin.x) : '';
    if (idle('oy')) inp('oy').value = state.origin ? String(state.origin.y) : '';
    out('range').textContent = q && state.origin
      ? `x: ${state.origin.x} → ${state.origin.x + q.w - 1}, y: ${state.origin.y} → ${state.origin.y - q.h + 1} (${q.w}×${q.h})`
      : '';

    // mine = cells of the chosen color (all if none) auto draw clicked; toGo = its cells still to click.
    let total = 0, done = 0, clicked = 0, mine = 0, toGo = 0;
    const remaining = new Map();
    if (q) {
      for (let p = 0; p < q.idx.length; p++) {
        const c = q.idx[p];
        if (c < 0) continue;
        total++;
        if (state.clicked[p]) clicked++;
        if (state.active < 0 || c === state.active) {
          if (state.clicked[p]) mine++;
          else if (!state.matched[p]) toGo++;
        }
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
        ? `${col.name} — ${left} ကွက် ကျန်။ ▶ နဲ့ auto ဆွဲ၊ သို့ ဘောင်ခတ်ထားတဲ့ ကွက်တွေကို ကိုယ်တိုင် click ပါ။`
        : `${col.name} — ပြီးပြီ 🎉 နောက်အရောင် ရွေးပါ။`;
    }

    const pct = total ? Math.floor((done / total) * 1000) / 10 : 0;
    out('bar').style.width = pct + '%';
    out('progress').textContent = q
      ? `${done} / ${total} ကွက် (${pct.toFixed(1)}%)` + (clicked ? ` · auto click ${clicked} ကွက်` : '')
        + (S.getView() ? '' : ' · canvas ကို ရှာနေတယ်…')
      : '';
    act('next').disabled = !q || !state.origin;
    act('here').disabled = !q;
    act('clear').disabled = !q;
    act('toggle').textContent = state.show ? 'Overlay ဖျောက်' : 'Overlay ပြ';
    act('auto').disabled = !auto && (!q || !state.origin || !onSite(state.active) || !toGo);
    act('auto').textContent = auto ? '■ ရပ်' : mine && toGo ? '▶ ဆက်ဆွဲ' : '▶ ဒီအရောင် ဆွဲ';
    act('reset').disabled = !!auto || !mine;
    let hint = autoMsg;
    if (auto) {
      hint = `${state.palette[auto.color].name} ဆွဲနေတယ် — ဒီတစ်ခါ ${auto.clicks} ကွက်။ site ရဲ့ map ကို မထိပါနဲ့။`;
    } else if (!hint && q) {
      if (state.active < 0) hint = 'Auto ဆွဲဖို့ အရောင်တစ်ခုကို ရွေးပါ။';
      else if (!onSite(state.active)) hint = 'ဒီအရောင်က app မှာပဲ ရှိလို့ site မှာ ရွေးလို့ မရဘူး။';
      else if (!toGo && mine) hint = 'ဒီအရောင် click ပြီးပြီ။ မကျသေးတဲ့ ကွက် ကျန်ရင် "ပြန်စ" ပြီး ▶ ပြန်နှိပ်ပါ။';
    }
    out('autoMsg').textContent = hint;
  }

  function changed() {
    if (auto && autoStale()) stopAuto('ပုံ၊ နေရာ သို့ အရောင် ပြောင်းလို့ ရပ်လိုက်တယ်။');
    O.setModel(state.q ? {
      q: state.q, palette: state.palette, origin: state.origin,
      matched: state.matched, active: state.active, show: state.show,
    } : null);
    renderPanel();
    save();
    scheduleDetect(150);
  }

  // ---------- persistence ----------
  const toBits = (a) => Array.from(a).join('');
  function fromBits(str, n) {
    const a = new Uint8Array(n);
    if (typeof str === 'string' && str.length === n && /^[01]*$/.test(str)) {
      for (let i = 0; i < n; i++) a[i] = str.charCodeAt(i) === 49 ? 1 : 0;
    }
    return a;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        q: state.q ? { w: state.q.w, h: state.q.h, idx: C.encodeIdx(state.q.idx) } : null,
        width: state.width, dither: state.dither, useApp: state.useApp,
        origin: state.origin, active: state.active, show: state.show,
        matched: state.q ? toBits(state.matched) : '',
        clicked: state.q ? toBits(state.clicked) : '',
        collapsed: state.collapsed, pos: state.pos, delay: state.delay,
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
  function flushSave() {
    clearTimeout(saveTimer);
    save();
  }
  addEventListener('pagehide', flushSave);

  function load() {
    let s;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return; }
    if (!s || typeof s !== 'object') return;
    state.width = Number.isInteger(s.width) ? Math.max(1, Math.min(C.MAX_SIDE, s.width)) : 64;
    state.dither = s.dither === 'fs' ? 'fs' : 'none';
    state.useApp = !!s.useApp;
    state.show = s.show !== false;
    state.collapsed = !!s.collapsed;
    state.delay = clampDelay(s.delay);
    if (s.pos && Number.isFinite(s.pos.x) && Number.isFinite(s.pos.y)) state.pos = clampPos(s.pos.x, s.pos.y);
    state.palette = C.getPalette(state.useApp);
    if (s.origin && Number.isSafeInteger(s.origin.x) && Number.isSafeInteger(s.origin.y)) {
      state.origin = { x: s.origin.x, y: s.origin.y };
    }
    const sq = s.q;
    const sizeOk = (n) => Number.isInteger(n) && n >= 1 && n <= C.MAX_SIDE;
    const idx = sq && sizeOk(sq.w) && sizeOk(sq.h) ? C.decodeIdx(sq.idx) : null;
    if (!idx || idx.length !== sq.w * sq.h || idx.some((c) => c >= state.palette.length)) return;
    state.q = { w: sq.w, h: sq.h, idx };
    state.layers = C.buildLayers(state.q);
    state.matched = fromBits(s.matched, idx.length);
    state.clicked = fromBits(s.clicked, idx.length);
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
  // Ctrl+V on the page: only image clipboards are taken; text pastes and pastes into the site's own
  // text fields are left alone. Replacing a loaded image asks first.
  addEventListener('paste', (e) => {
    const t = e.composedPath()[0];
    if (!e.composedPath().includes(host) && (isTextField(t) || (t && t.isContentEditable))) return;
    const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
    const item = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    if (state.q && !confirm('ပုံအသစ်နဲ့ အစားထိုးမလား?')) return;
    loadFile(item.getAsFile());
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

  inp('delay').addEventListener('change', () => {
    state.delay = clampDelay(inp('delay').value);
    inp('delay').value = state.delay;
    save();
  });

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
      autoMsg = '';
      chooseColor(Number(li.dataset.color));
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    b.blur(); // so Space/Enter on the site doesn't press this button again
    const a = b.dataset.act;
    if (a === 'collapse') { state.collapsed = !state.collapsed; place(); save(); }
    else if (a === 'here') placeHere();
    else if (a === 'next') findNext();
    else if (a === 'auto') { if (auto) stopAuto(); else startAuto(-1, 0); }
    else if (a === 'toggle') { state.show = !state.show; changed(); }
    else if (a === 'reset' && confirm('ဒီအရောင်ရဲ့ auto click မှတ်တမ်းကို ဖျက်ပြီး မဆွဲရသေးတဲ့ ကွက်တွေကို အစက ပြန်ဆွဲမလား?')) {
      for (let p = 0; p < state.clicked.length; p++) {
        if (state.active < 0 || state.q.idx[p] === state.active) state.clicked[p] = 0;
      }
      autoMsg = '';
      renderPanel();
      save();
    }
    else if (a === 'clear' && confirm('ပုံကို ဖယ်မလား?')) { stopAuto(); clearImage(); }
  });

  // ---------- start ----------
  load();
  document.body.appendChild(host);
  place();
  changed();
  if (S.getView()) { pulsePending(); resumePending(); }
})();
