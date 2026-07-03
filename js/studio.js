// ═══════════════════════════════════════════════════════════════════════════
// InkStudio — STUDIO TOOLS
// Everything that turns the editor into a comfortable TikTok/manga workbench:
//   • Canvas zoom / pan / fit + focus mode (hide panels, maximize the stage)
//   • Animated GIF engine (decode with ImageDecoder, loop on canvas + exports)
//   • TikTok safe-zone overlay (9:16 guide for captions / action rail)
//   • Emoji sticker picker, flip & duplicate layer, manga text presets
//
// Classic script sharing the inline script's global lexical scope
// (state, canvas, redrawLayersOnCanvas, addLayer, _ts, …).
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ═════════════════════════════════════════════════════════════════════════
  // 1. ANIMATED GIF ENGINE
  // ═════════════════════════════════════════════════════════════════════════

  const GifKit = {
    supported: () => typeof ImageDecoder !== 'undefined',

    // Decode layer.gifSrc (data URL) into playable frames. Idempotent.
    async hydrate(layer) {
      if (!layer || !layer.gifSrc || layer.gif || layer._gifLoading || !this.supported()) {
        return !!(layer && layer.gif);
      }
      layer._gifLoading = true;
      try {
        const buf = await (await fetch(layer.gifSrc)).arrayBuffer();
        const dec = new ImageDecoder({ data: buf, type: 'image/gif' });
        await dec.tracks.ready;
        const count = Math.min(dec.tracks.selectedTrack.frameCount, 240); // cap runaway GIFs
        const frames = [];
        let total = 0;
        for (let i = 0; i < count; i++) {
          const { image } = await dec.decode({ frameIndex: i });
          const c = document.createElement('canvas');
          c.width = image.displayWidth;
          c.height = image.displayHeight;
          c.getContext('2d').drawImage(image, 0, 0);
          const dur = Math.max(20, (image.duration || 100000) / 1000); // µs → ms
          image.close();
          total += dur;
          frames.push({ c, end: total });
        }
        dec.close();
        if (frames.length > 1) layer.gif = { frames, total };
        return !!layer.gif;
      } catch (err) {
        console.warn('GIF decode failed:', err);
        return false;
      } finally {
        layer._gifLoading = false;
      }
    },

    // Current frame for a layer (shared wall clock so all GIFs stay smooth)
    frameFor(layer) {
      const g = layer.gif;
      if (!g || !g.frames.length) return layer.img;
      const t = performance.now() % g.total;
      for (const f of g.frames) if (t < f.end) return f.c;
      return g.frames[g.frames.length - 1].c;
    },
  };
  window.GifKit = GifKit;

  // Repaint loop: keeps GIF layers moving while editing, after a scene's
  // drawing animation completes, and during export holds (the exports
  // composite the main canvas every frame, so they capture this for free).
  let _lastGifPaint = 0;
  (function gifTick() {
    requestAnimationFrame(gifTick);
    if (window._gifPause) return;
    if (typeof state === 'undefined' || state.playing) return;
    if (typeof _ts !== 'undefined' && _ts.active) return; // text editor open
    const layers = state.layers || [];
    let hasGif = false;
    for (const l of layers) {
      if (l.visible === false) continue;
      if (l.gifSrc && !l.gif && !l._gifLoading) {
        GifKit.hydrate(l).then(ok => { if (ok) redrawLayersOnCanvas(); });
      }
      if (l.gif) hasGif = true;
    }
    if (!hasGif) return;
    const now = performance.now();
    if (now - _lastGifPaint < 33) return; // ~30 fps is plenty
    _lastGifPaint = now;
    redrawLayersOnCanvas();
  })();

  // ═════════════════════════════════════════════════════════════════════════
  // 2. CANVAS ZOOM / PAN / FOCUS MODE
  // ═════════════════════════════════════════════════════════════════════════

  const area = document.getElementById('canvas-area');
  const wrap = document.getElementById('canvas-wrapper');

  const view = { z: 1, x: 0, y: 0 };
  const Z_MIN = 1, Z_MAX = 8; // never smaller than fit — zooming out below fit only causes confusion

  function _applyView() {
    const noop = view.z === 1 && !view.x && !view.y;
    wrap.style.transform = noop ? '' : `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    _syncZoomLabel();
  }

  function _fitScale() {
    // CSS width the fit logic gave the canvas ÷ its bitmap width
    const w = parseFloat(canvas.style.width) || canvas.getBoundingClientRect().width / view.z;
    return w / state.canvasW;
  }

  function _clampPan() {
    // At fit there is nothing to pan; when zoomed, never let the canvas
    // wander further than its own overflow (plus a small margin).
    if (view.z <= 1.001) { view.x = 0; view.y = 0; return; }
    const mx = Math.max(0, (wrap.offsetWidth * view.z - area.clientWidth) / 2) + 60;
    const my = Math.max(0, (wrap.offsetHeight * view.z - area.clientHeight) / 2) + 60;
    view.x = Math.max(-mx, Math.min(mx, view.x));
    view.y = Math.max(-my, Math.min(my, view.y));
  }

  // Zoom keeping the screen point (cx, cy) fixed
  function zoomAt(factor, cx, cy) {
    const r = wrap.getBoundingClientRect();
    const cs = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; // transformed center
    const c0 = { x: cs.x - view.x, y: cs.y - view.y };               // untransformed center
    const nz = Math.max(Z_MIN, Math.min(Z_MAX, view.z * factor));
    if (nz === view.z) return;
    const wx = (cx - cs.x) / view.z, wy = (cy - cs.y) / view.z;
    view.x = cx - nz * wx - c0.x;
    view.y = cy - nz * wy - c0.y;
    view.z = nz;
    _clampPan();
    _applyView();
  }

  function zoomCenter(factor) {
    const r = area.getBoundingClientRect();
    zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
  }

  function resetView() {
    view.z = 1; view.x = 0; view.y = 0;
    _applyView();
  }

  function zoom100() {
    // 1 canvas pixel = 1 screen pixel
    const target = 1 / Math.max(0.0001, _fitScale());
    const r = area.getBoundingClientRect();
    zoomAt(target / view.z, r.left + r.width / 2, r.top + r.height / 2);
  }

  // Ctrl+wheel (and trackpad pinch) = zoom · plain wheel = pan
  area.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    } else {
      if (view.z <= 1.001) return; // nothing to pan at fit — plain scrolling must not move the canvas
      if (e.shiftKey) view.x -= e.deltaY;
      else { view.x -= e.deltaX; view.y -= e.deltaY; }
      _clampPan();
      _applyView();
    }
  }, { passive: false });

  // Middle-drag or Alt+drag = pan (Space is already play/pause in the app)
  area.addEventListener('mousedown', e => {
    const panBtn = e.button === 1 || (e.altKey && e.button === 0);
    if (!panBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX - view.x, sy = e.clientY - view.y;
    area.style.cursor = 'grabbing';
    const move = ev => {
      view.x = ev.clientX - sx;
      view.y = ev.clientY - sy;
      _clampPan();
      _applyView();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      area.style.cursor = '';
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, true);

  function _typing() {
    const t = document.activeElement?.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
  }

  // ── Focus mode: hide the side panels so the stage takes the whole window ──

  function toggleFocus(force) {
    const on = typeof force === 'boolean' ? force : !document.body.classList.contains('ink-focus');
    document.body.classList.toggle('ink-focus', on);
    const btn = document.getElementById('ink-focus-btn');
    if (btn) btn.classList.toggle('on', on);
    resetView();
    setTimeout(() => { fitCanvas(); redrawLayersOnCanvas(); if (typeof drawSelectionHandles === 'function') drawSelectionHandles(); }, 50);
    if (on) showToast('Mode focus — F ou Échap pour revenir', null, 2500);
  }

  // ── Zoom toolbar (floating pill, bottom-right of the stage) ───────────────

  function _syncZoomLabel() {
    const lbl = document.getElementById('ink-zoom-label');
    if (!lbl) return;
    lbl.textContent = Math.round(_fitScale() * view.z * 100) + '%';
  }

  function _buildZoomPill() {
    const pill = document.createElement('div');
    pill.id = 'ink-zoom-pill';
    pill.innerHTML = `
      <button data-zp="out"  title="Zoom arrière (Ctrl+molette / Ctrl −)">−</button>
      <button data-zp="fit"  id="ink-zoom-label" title="Réinitialiser (Ctrl+0)">100%</button>
      <button data-zp="in"   title="Zoom avant (Ctrl+molette / Ctrl +)">+</button>
      <span class="zp-sep"></span>
      <button data-zp="px"   title="Taille réelle — 1 pixel canvas = 1 pixel écran">1:1</button>
      <button data-zp="tiktok" title="Format TikTok — passe le canvas en 9:16 1080×1920 et affiche la safe-zone">🎬 TikTok</button>
      <button data-zp="safe" id="ink-safe-btn" title="Safe-zone TikTok — zones cachées par l'interface (légende, boutons)">📱</button>
      <button data-zp="focus" id="ink-focus-btn" title="Mode focus — masque les panneaux (F)">⛶</button>`;
    pill.addEventListener('click', e => {
      const act = e.target?.dataset?.zp;
      if (act === 'in') zoomCenter(1.25);
      else if (act === 'out') zoomCenter(0.8);
      else if (act === 'fit') resetView();
      else if (act === 'px') zoom100();
      else if (act === 'tiktok') setTikTokFormat();
      else if (act === 'safe') toggleSafeZone();
      else if (act === 'focus') toggleFocus();
    });
    area.appendChild(pill);
    _syncZoomLabel();
  }

  // Keyboard: Ctrl +/−/0 zoom, F focus, Esc leaves focus
  document.addEventListener('keydown', e => {
    if (_typing()) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomCenter(1.25); }
    else if (mod && e.key === '-') { e.preventDefault(); zoomCenter(0.8); }
    else if (mod && e.key === '0') { e.preventDefault(); resetView(); }
    else if (!mod && (e.key === 'f' || e.key === 'F')) { toggleFocus(); }
    else if (e.key === 'Escape' && document.body.classList.contains('ink-focus')) { toggleFocus(false); }
  });

  // One-click TikTok format: 9:16 vertical, 1080×1920, safe-zone on
  function setTikTokFormat() {
    const ratioBtn = document.querySelector('.ratio-btn[data-ratio="9:16"]');
    const resBtn = document.querySelector('.res-btn[data-res="1080"]');
    if (ratioBtn && typeof selectRatio === 'function') selectRatio(ratioBtn);
    if (resBtn && typeof selectRes === 'function') selectRes(resBtn);
    toggleSafeZone(true);
    resetView();
    showToast('Canvas TikTok — 1080 × 1920 (9:16) 🎬');
  }
  window.setTikTokFormat = setTikTokFormat;

  // ═════════════════════════════════════════════════════════════════════════
  // 3. TIKTOK SAFE-ZONE OVERLAY
  // ═════════════════════════════════════════════════════════════════════════

  let _safeOn = false;

  function _buildSafeZone() {
    const el = document.createElement('div');
    el.id = 'ink-safezone';
    el.innerHTML = `
      <div class="sz-band sz-top"><span>≈ pseudo + Live</span></div>
      <div class="sz-band sz-bottom"><span>légende · description · musique</span></div>
      <div class="sz-band sz-right"><span>❤<br>💬<br>↪</span></div>`;
    wrap.appendChild(el);
  }

  function toggleSafeZone(force) {
    _safeOn = typeof force === 'boolean' ? force : !_safeOn;
    const el = document.getElementById('ink-safezone');
    if (el) el.classList.toggle('on', _safeOn);
    const btn = document.getElementById('ink-safe-btn');
    if (btn) btn.classList.toggle('on', _safeOn);
    try { localStorage.setItem('ink-safezone', _safeOn ? '1' : '0'); } catch (e) {}
  }
  window.toggleSafeZone = toggleSafeZone;

  // ═════════════════════════════════════════════════════════════════════════
  // 4. LAYER TOOLS — flip, duplicate
  // ═════════════════════════════════════════════════════════════════════════

  function _imgSize(img) {
    return { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
  }

  function _flipCanvas(srcW, srcH, draw, vertical) {
    const c = document.createElement('canvas');
    c.width = srcW; c.height = srcH;
    const g = c.getContext('2d');
    g.translate(vertical ? 0 : srcW, vertical ? srcH : 0);
    g.scale(vertical ? 1 : -1, vertical ? -1 : 1);
    draw(g);
    return c;
  }

  function flipSelectedLayer(vertical) {
    const layer = typeof getSelectedLayer === 'function' ? getSelectedLayer() : null;
    if (!layer || !layer.img || state.playing) return;
    pushUndoSnapshot();
    const { w, h } = _imgSize(layer.img);
    const flipped = _flipCanvas(w, h, g => g.drawImage(layer.img, 0, 0), vertical);
    // GIF layers: flip every frame so the animation stays mirrored
    if (layer.gif) {
      layer.gif.frames.forEach(f => {
        f.c = _flipCanvas(f.c.width, f.c.height, g => g.drawImage(f.c, 0, 0), vertical);
      });
    }
    const img = new Image();
    img.onload = () => {
      layer.img = img;
      redrawLayersOnCanvas();
      if (window.SceneManager) SceneManager.renderStrip();
      scheduleAutoSave();
    };
    img.src = flipped.toDataURL('image/png');
  }

  function duplicateSelectedLayer() {
    const layer = typeof getSelectedLayer === 'function' ? getSelectedLayer() : null;
    if (!layer || state.playing) return;
    pushUndoSnapshot();
    const copy = {
      ...layer,
      id: ++_layerIdCounter,
      name: `${layer.name} copy`,
      x: Math.min(layer.x + 24, state.canvasW - 40),
      y: Math.min(layer.y + 24, state.canvasH - 40),
      groupId: null,
      textProps: layer.textProps ? JSON.parse(JSON.stringify(layer.textProps)) : null,
    };
    delete copy._gifLoading;
    state.layers.push(copy);
    renderLayerList();
    selectLayer(copy.id);
    redrawLayersOnCanvas();
    scheduleAutoSave();
    showToast('Calque dupliqué');
  }
  window.duplicateSelectedLayer = duplicateSelectedLayer;
  window.flipSelectedLayer = flipSelectedLayer;

  // Ctrl+D duplicates the selected layer
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D') && !_typing()) {
      e.preventDefault();
      duplicateSelectedLayer();
    }
  });

  function _injectLayerButtons() {
    const actions = document.querySelector('.layer-panel-actions');
    if (!actions) return;
    const mk = (label, title, fn) => {
      const b = document.createElement('button');
      b.className = 'lp-action-btn';
      b.title = title;
      b.textContent = label;
      b.addEventListener('click', fn);
      actions.appendChild(b);
    };
    mk('⇋', 'Miroir horizontal du calque sélectionné', () => flipSelectedLayer(false));
    mk('⇅', 'Miroir vertical du calque sélectionné', () => flipSelectedLayer(true));
    mk('⧉', 'Dupliquer le calque sélectionné (Ctrl+D)', duplicateSelectedLayer);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 5. EMOJI STICKERS
  // ═════════════════════════════════════════════════════════════════════════

  const STICKERS = [
    '😂','🤣','😱','😭','🥶','😳','🤯','💀',
    '🔥','⚡','💥','✨','💢','💯','❗','❓',
    '❤️','💔','👀','👍','👎','🙏','💪','🫵',
    '🎌','⚔️','🥷','🐉','🍜','🎴','📚','🏆',
  ];

  function addSticker(ch) {
    const S = 320;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    g.font = `${Math.round(S * 0.78)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ch, S / 2, S / 2 + S * 0.04);
    const img = new Image();
    img.onload = () => {
      const layer = addLayer(img, `Sticker ${ch}`);
      if (!layer) return;
      layer.hasPngAlpha = true;
      // Sticker-sized, not poster-sized
      const side = Math.round(Math.min(state.canvasW, state.canvasH) * 0.22);
      layer.w = side; layer.h = side;
      layer.x = Math.round((state.canvasW - side) / 2);
      layer.y = Math.round((state.canvasH - side) / 2);
      if (typeof syncLayerResizeFromCurrentSize === 'function') syncLayerResizeFromCurrentSize(layer);
      redrawLayersOnCanvas();
      if (typeof drawSelectionHandles === 'function') drawSelectionHandles();
      scheduleAutoSave();
    };
    img.src = c.toDataURL('image/png');
  }
  window.addSticker = addSticker;

  function _closeStickerPop() { document.getElementById('ink-sticker-pop')?.remove(); }

  function _openStickerPop(anchor) {
    _closeStickerPop();
    const pop = document.createElement('div');
    pop.id = 'ink-sticker-pop';
    pop.innerHTML = `
      <div class="sp-grid">${STICKERS.map(s => `<button class="sp-e" data-e="${s}">${s}</button>`).join('')}</div>
      <div class="sp-row">
        <input type="text" id="sp-custom" placeholder="Tape un emoji… (Win + ;)" maxlength="8">
        <button id="sp-add">Ajouter</button>
      </div>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 250, r.left)) + 'px';
    pop.style.top = (r.bottom + 8) + 'px';
    pop.addEventListener('click', e => {
      const em = e.target?.dataset?.e;
      if (em) { addSticker(em); _closeStickerPop(); }
    });
    const custom = pop.querySelector('#sp-custom');
    const commit = () => { const v = custom.value.trim(); if (v) { addSticker(v); _closeStickerPop(); } };
    pop.querySelector('#sp-add').addEventListener('click', commit);
    custom.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') _closeStickerPop(); });
    setTimeout(() => {
      const onDoc = e => { if (!pop.contains(e.target) && e.target !== anchor) { _closeStickerPop(); document.removeEventListener('mousedown', onDoc); } };
      document.addEventListener('mousedown', onDoc);
    }, 0);
    custom.focus();
  }

  function _injectStickerButton() {
    const bar = document.getElementById('tool-toolbar');
    if (!bar) return;
    const div = document.createElement('div');
    div.className = 'tool-divider';
    bar.appendChild(div);
    const b = document.createElement('button');
    b.className = 'tool-btn';
    b.id = 'btn-sticker-tool';
    b.innerHTML = '😀 Sticker';
    b.title = 'Ajouter un emoji en calque (il s\'anime avec le style de dessin choisi)';
    b.addEventListener('click', () => _openStickerPop(b));
    bar.appendChild(b);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 5bis. SHAPES — hand-drawn arrows, circles, bubbles… as regular layers.
  // A shape layer keeps its parameters (shapeProps) so color / thickness /
  // angle can be changed after placement: the bitmap is simply re-rendered.
  // ═════════════════════════════════════════════════════════════════════════

  const SHAPE_SIZE = 640;

  const SHAPES = [
    { type: 'arrow',       label: 'Flèche' },
    { type: 'arrowDouble', label: 'Double' },
    { type: 'arrowCurve',  label: 'Courbée' },
    { type: 'circle',      label: 'Cercle' },
    { type: 'rect',        label: 'Cadre' },
    { type: 'underline',   label: 'Souligné' },
    { type: 'bubble',      label: 'Bulle' },
    { type: 'burst',       label: 'Focus' },
    { type: 'star',        label: 'Étoile' },
    { type: 'heart',       label: 'Cœur' },
  ];

  const SHAPE_COLORS = ['#1a1a1a', '#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#facc15', '#ffffff'];

  // Deterministic wobble so a recolor keeps the exact same hand-drawn strokes
  function _rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  }

  // Each shape = a list of polylines in center coordinates (working radius 260)
  function _shapePaths(type, rnd) {
    const R = 260;
    const pts = [];
    const line = (x1, y1, x2, y2, segs = 10) => {
      const p = [];
      for (let i = 0; i <= segs; i++) { const t = i / segs; p.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]); }
      return p;
    };
    const quad = (x1, y1, cx, cy, x2, y2, segs = 26) => {
      const p = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs, u = 1 - t;
        p.push([u * u * x1 + 2 * u * t * cx + t * t * x2, u * u * y1 + 2 * u * t * cy + t * t * y2]);
      }
      return p;
    };
    switch (type) {
      case 'arrow':
        pts.push(line(-R, 0, R - 20, 0, 14));
        pts.push(line(R, 0, R - 85, -55, 6));
        pts.push(line(R, 0, R - 85, 55, 6));
        break;
      case 'arrowDouble':
        pts.push(line(-R + 20, 0, R - 20, 0, 14));
        pts.push(line(R, 0, R - 85, -55, 6));
        pts.push(line(R, 0, R - 85, 55, 6));
        pts.push(line(-R, 0, -R + 85, -55, 6));
        pts.push(line(-R, 0, -R + 85, 55, 6));
        break;
      case 'arrowCurve': {
        const c = quad(-R + 30, 150, -40, -300, R - 50, 40);
        pts.push(c);
        const [ex, ey] = c[c.length - 1], [px, py] = c[c.length - 3];
        const a = Math.atan2(ey - py, ex - px), h = 95;
        pts.push(line(ex, ey, ex - h * Math.cos(a - 0.5), ey - h * Math.sin(a - 0.5), 6));
        pts.push(line(ex, ey, ex - h * Math.cos(a + 0.5), ey - h * Math.sin(a + 0.5), 6));
        break;
      }
      case 'circle': {
        const p = [], n = 40, ph = rnd() * 6.28;
        for (let i = 0; i <= n; i++) { const a = ph + (i / n) * 6.283; p.push([Math.cos(a) * R, Math.sin(a) * R * 0.72]); }
        pts.push(p);
        break;
      }
      case 'rect': {
        const w = R, h = R * 0.62;
        pts.push(line(-w, -h, w, -h, 12));
        pts.push(line(w, -h, w, h, 8));
        pts.push(line(w, h, -w, h, 12));
        pts.push(line(-w, h, -w, -h, 8));
        break;
      }
      case 'underline': {
        const p = [], n = 30;
        for (let i = 0; i <= n; i++) { const t = i / n; p.push([-R + 2 * R * t, Math.sin(t * Math.PI * 2.2) * 20]); }
        pts.push(p);
        break;
      }
      case 'bubble': {
        const w = R, top = -R * 0.7, bot = R * 0.28, r = 40;
        pts.push(line(-w + r, top, w - r, top, 12));
        pts.push(quad(w - r, top, w, top, w, top + r, 8));
        pts.push(line(w, top + r, w, bot - r, 8));
        pts.push(quad(w, bot - r, w, bot, w - r, bot, 8));
        pts.push(line(w - r, bot, -w * 0.05, bot, 10));
        pts.push(line(-w * 0.05, bot, -w * 0.25, bot + R * 0.42, 5)); // tail
        pts.push(line(-w * 0.25, bot + R * 0.42, -w * 0.42, bot, 5));
        pts.push(line(-w * 0.42, bot, -w + r, bot, 8));
        pts.push(quad(-w + r, bot, -w, bot, -w, bot - r, 8));
        pts.push(line(-w, bot - r, -w, top + r, 8));
        pts.push(quad(-w, top + r, -w, top, -w + r, top, 8));
        break;
      }
      case 'burst': {
        const n = 16;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * 6.283 + rnd() * 0.15;
          const r2 = R * (0.55 + rnd() * 0.12);
          pts.push(line(Math.cos(a) * R, Math.sin(a) * R * 0.8, Math.cos(a) * r2, Math.sin(a) * r2 * 0.8, 4));
        }
        break;
      }
      case 'star': {
        const p = [];
        for (let i = 0; i <= 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const r = i % 2 === 0 ? R : R * 0.45;
          p.push([Math.cos(a) * r, Math.sin(a) * r]);
        }
        pts.push(p);
        break;
      }
      case 'heart': {
        const p = [], n = 44;
        for (let i = 0; i <= n; i++) {
          const t = (i / n) * 6.283;
          p.push([
            (16 * Math.pow(Math.sin(t), 3) * R) / 17,
            (-(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * R) / 17,
          ]);
        }
        pts.push(p);
        break;
      }
    }
    return pts;
  }

  function renderShape(props) {
    const c = document.createElement('canvas');
    c.width = SHAPE_SIZE; c.height = SHAPE_SIZE;
    const g = c.getContext('2d');
    const rnd = _rng(props.seed || 1);
    const th = props.thickness ?? 10;
    g.translate(SHAPE_SIZE / 2, SHAPE_SIZE / 2);
    g.rotate(((props.angle || 0) * Math.PI) / 180);
    g.scale(0.88, 0.88);
    g.strokeStyle = props.color || '#1a1a1a';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const j = th * 0.35 + 2; // wobble amplitude
    _shapePaths(props.type, rnd).forEach(poly => {
      for (let pass = 0; pass < 2; pass++) {
        g.globalAlpha = pass ? 0.5 : 1;
        g.lineWidth = th * (pass ? 0.62 : 1);
        g.beginPath();
        poly.forEach(([x, y], i) => {
          const jx = x + (rnd() - 0.5) * j * 2, jy = y + (rnd() - 0.5) * j * 2;
          i ? g.lineTo(jx, jy) : g.moveTo(jx, jy);
        });
        g.stroke();
      }
    });
    g.globalAlpha = 1;
    return c;
  }

  const _shapeSettings = { color: '#dc2626', thickness: 10, angle: 0 };

  function addShape(type) {
    const props = { type, ...(_shapeSettings), seed: (Math.random() * 1e9) | 0 };
    const src = renderShape(props);
    const img = new Image();
    img.onload = () => {
      const layer = addLayer(img, `Forme ${SHAPES.find(s => s.type === type)?.label || type}`);
      if (!layer) return;
      layer.kind = 'shape';
      layer.shapeProps = props;
      layer.hasPngAlpha = true;
      const side = Math.round(Math.min(state.canvasW, state.canvasH) * 0.42);
      layer.w = side; layer.h = side;
      layer.x = Math.round((state.canvasW - side) / 2);
      layer.y = Math.round((state.canvasH - side) / 2);
      if (typeof syncLayerResizeFromCurrentSize === 'function') syncLayerResizeFromCurrentSize(layer);
      renderLayerList();
      redrawLayersOnCanvas();
      if (typeof drawSelectionHandles === 'function') drawSelectionHandles();
      scheduleAutoSave();
    };
    img.src = src.toDataURL('image/png');
  }

  // Change color / thickness / angle of an existing shape layer (same wobble)
  function restyleShape(id, patch) {
    const layer = typeof getLayerById === 'function' ? getLayerById(id) : null;
    if (!layer || layer.kind !== 'shape' || !layer.shapeProps) return;
    pushUndoSnapshot();
    Object.assign(layer.shapeProps, patch);
    const img = new Image();
    img.onload = () => {
      layer.img = img;
      redrawLayersOnCanvas();
      if (typeof drawSelectionHandles === 'function') drawSelectionHandles();
      if (window.SceneManager) SceneManager.renderStrip();
      scheduleAutoSave();
    };
    img.src = renderShape(layer.shapeProps).toDataURL('image/png');
  }
  window.ShapeKit = { addShape, restyleShape, renderShape, colors: SHAPE_COLORS };

  function _closeShapePop() { document.getElementById('ink-shape-pop')?.remove(); }

  function _openShapePop(anchor) {
    _closeShapePop();
    const pop = document.createElement('div');
    pop.id = 'ink-shape-pop';
    pop.innerHTML = `
      <div class="shp-grid"></div>
      <div class="shp-row shp-colors">
        ${SHAPE_COLORS.map(c => `<div class="shp-dot${c === _shapeSettings.color ? ' sel' : ''}" data-c="${c}" style="background:${c}"></div>`).join('')}
        <label class="shp-custom" title="Couleur personnalisée">🎨<input type="color" value="${_shapeSettings.color}"></label>
      </div>
      <div class="shp-row">
        <label>Épaisseur <input type="range" id="shp-th" min="3" max="26" value="${_shapeSettings.thickness}"></label>
        <label>Angle <input type="range" id="shp-an" min="0" max="359" value="${_shapeSettings.angle}"><span id="shp-an-val">${_shapeSettings.angle}°</span></label>
      </div>`;
    document.body.appendChild(pop);

    // Live thumbnails rendered with the current settings
    const grid = pop.querySelector('.shp-grid');
    const _thumbs = [];
    const _refreshThumbs = () => {
      _thumbs.forEach(({ cnv, type }) => {
        const t = cnv.getContext('2d');
        t.clearRect(0, 0, cnv.width, cnv.height);
        t.drawImage(renderShape({ type, ..._shapeSettings, seed: 7 }), 0, 0, cnv.width, cnv.height);
      });
    };
    SHAPES.forEach(({ type, label }) => {
      const b = document.createElement('button');
      b.className = 'shp-item';
      b.title = label;
      const cnv = document.createElement('canvas');
      cnv.width = 52; cnv.height = 52;
      b.appendChild(cnv);
      const lb = document.createElement('span');
      lb.textContent = label;
      b.appendChild(lb);
      b.addEventListener('click', () => { addShape(type); _closeShapePop(); });
      grid.appendChild(b);
      _thumbs.push({ cnv, type });
    });
    _refreshThumbs();

    pop.querySelectorAll('.shp-dot').forEach(d => d.addEventListener('click', () => {
      _shapeSettings.color = d.dataset.c;
      pop.querySelectorAll('.shp-dot').forEach(x => x.classList.toggle('sel', x === d));
      _refreshThumbs();
    }));
    pop.querySelector('.shp-custom input').addEventListener('input', e => {
      _shapeSettings.color = e.target.value;
      pop.querySelectorAll('.shp-dot').forEach(x => x.classList.remove('sel'));
      _refreshThumbs();
    });
    pop.querySelector('#shp-th').addEventListener('input', e => { _shapeSettings.thickness = +e.target.value; _refreshThumbs(); });
    pop.querySelector('#shp-an').addEventListener('input', e => {
      _shapeSettings.angle = +e.target.value;
      pop.querySelector('#shp-an-val').textContent = `${e.target.value}°`;
      _refreshThumbs();
    });

    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 300, r.left)) + 'px';
    pop.style.top = (r.bottom + 8) + 'px';
    setTimeout(() => {
      const onDoc = e => { if (!pop.contains(e.target) && e.target !== anchor) { _closeShapePop(); document.removeEventListener('mousedown', onDoc); } };
      document.addEventListener('mousedown', onDoc);
    }, 0);
  }

  function _injectShapeButton() {
    const bar = document.getElementById('tool-toolbar');
    if (!bar) return;
    const div = document.createElement('div');
    div.className = 'tool-divider';
    bar.appendChild(div);
    const b = document.createElement('button');
    b.className = 'tool-btn';
    b.id = 'btn-shape-tool';
    b.innerHTML = '➜ Formes';
    b.title = 'Flèches, cercles, bulles… en style dessiné à la main — couleur/épaisseur/angle modifiables après coup';
    b.addEventListener('click', () => _openShapePop(b));
    bar.appendChild(b);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 6. MANGA TEXT PRESETS
  // ═════════════════════════════════════════════════════════════════════════

  const TEXT_PRESETS = [
    { label: '💥 Onomatopée', font: 'Bangers',       size: 150, color: '#dc2626', bold: false },
    { label: '📢 Titre',      font: 'Bebas Neue',    size: 110, color: '#1a1a1a', bold: false },
    { label: '💬 Dialogue',   font: 'Kalam',         size: 60,  color: '#1a1a1a', bold: false },
    { label: '✏️ Narration',  font: 'Patrick Hand',  size: 48,  color: '#475569', bold: false },
  ];

  function _applyTextPreset(p) {
    if (typeof selectFont === 'function') selectFont(p.font);
    const sizeInput = document.getElementById('tp-size');
    if (sizeInput) sizeInput.value = p.size;
    if (typeof onTextCustomColor === 'function') onTextCustomColor(p.color);
    if (typeof updateTextState === 'function') updateTextState();
    showToast(`Preset « ${p.label} » — clique le canvas pour placer le texte`);
    if (typeof activateTextPlacement === 'function' && !_ts.active) activateTextPlacement();
  }

  function _injectTextPresets() {
    const picker = document.getElementById('font-picker');
    if (!picker) return;
    const row = document.createElement('div');
    row.id = 'ink-text-presets';
    TEXT_PRESETS.forEach(p => {
      const b = document.createElement('button');
      b.textContent = p.label;
      b.title = `${p.font} · ${p.size}px`;
      b.addEventListener('click', () => _applyTextPreset(p));
      row.appendChild(b);
    });
    picker.parentElement.insertBefore(row, picker);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // STYLES + INIT
  // ═════════════════════════════════════════════════════════════════════════

  function _injectStyles() {
    const css = `
/* Zoom pill */
#ink-zoom-pill {
  position: absolute; right: 16px; bottom: 14px; z-index: 60;
  display: flex; align-items: center; gap: 2px;
  background: rgba(255,255,255,0.95); border: 1px solid rgba(0,0,0,0.15);
  border-radius: 999px; padding: 3px 6px; box-shadow: 0 4px 16px rgba(0,0,0,0.14);
  user-select: none;
}
#ink-zoom-pill button {
  border: none; background: transparent; cursor: pointer; color: #333;
  font-size: 12px; font-weight: 700; min-width: 26px; height: 26px;
  border-radius: 999px; padding: 0 6px; line-height: 1;
}
#ink-zoom-pill button:hover { background: rgba(0,0,0,0.07); }
#ink-zoom-pill button.on { background: var(--accent, #1a1a1a); color: #fff; }
#ink-zoom-pill .zp-sep { width: 1px; height: 16px; background: rgba(0,0,0,0.15); margin: 0 3px; }
#ink-zoom-label { font-variant-numeric: tabular-nums; min-width: 44px !important; }

/* Focus mode */
body.ink-focus #sidebar,
body.ink-focus #right-panel,
body.ink-focus #bottom-bar { display: none !important; }

/* Canvas wrapper gets transformed by the zoom; the area clips it so a
   zoomed canvas can never cover the surrounding panels */
#canvas-wrapper { will-change: transform; }
#canvas-area { overflow: hidden; }

/* TikTok safe zone */
#ink-safezone { position: absolute; inset: 0; z-index: 50; pointer-events: none; display: none; }
#ink-safezone.on { display: block; }
#ink-safezone .sz-band {
  position: absolute;
  background: repeating-linear-gradient(135deg, rgba(220,38,38,0.13) 0 8px, rgba(220,38,38,0.05) 8px 16px);
  display: flex; align-items: center; justify-content: center;
}
#ink-safezone .sz-band span {
  font-size: 11px; font-weight: 700; color: rgba(185,28,28,0.75);
  background: rgba(255,255,255,0.75); border-radius: 6px; padding: 2px 8px;
  text-align: center; line-height: 1.5;
}
#ink-safezone .sz-top    { top: 0; left: 0; right: 0; height: 8%; border-bottom: 1.5px dashed rgba(220,38,38,0.55); }
#ink-safezone .sz-bottom { bottom: 0; left: 0; right: 0; height: 27%; border-top: 1.5px dashed rgba(220,38,38,0.55); }
#ink-safezone .sz-right  { top: 30%; right: 0; width: 13%; height: 43%; border-left: 1.5px dashed rgba(220,38,38,0.55); }

/* Sticker popover */
#ink-sticker-pop {
  position: fixed; z-index: 4000; width: 244px; background: #fff;
  border: 1px solid rgba(0,0,0,0.18); border-radius: 10px; padding: 10px;
  box-shadow: 0 10px 32px rgba(0,0,0,0.22);
  display: flex; flex-direction: column; gap: 8px;
}
#ink-sticker-pop .sp-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; }
#ink-sticker-pop .sp-e {
  border: none; background: transparent; font-size: 18px; cursor: pointer;
  border-radius: 6px; padding: 3px 0;
  font-family: "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif;
}
#ink-sticker-pop .sp-e:hover { background: rgba(0,0,0,0.08); transform: scale(1.15); }
#ink-sticker-pop .sp-row { display: flex; gap: 6px; }
#ink-sticker-pop .sp-row input {
  flex: 1; border: 1px solid rgba(0,0,0,0.18); border-radius: 6px; padding: 5px 8px; font-size: 12px; min-width: 0;
}
#ink-sticker-pop .sp-row button {
  border: none; background: var(--accent, #1a1a1a); color: #fff; border-radius: 6px;
  padding: 5px 10px; font-size: 11px; font-weight: 600; cursor: pointer;
}

/* Shape popover */
#ink-shape-pop {
  position: fixed; z-index: 4000; width: 296px; background: #fff;
  border: 1px solid rgba(0,0,0,0.18); border-radius: 10px; padding: 10px;
  box-shadow: 0 10px 32px rgba(0,0,0,0.22);
  display: flex; flex-direction: column; gap: 9px;
}
#ink-shape-pop .shp-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
#ink-shape-pop .shp-item {
  border: 1px solid rgba(0,0,0,0.12); background: #fff; border-radius: 8px; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 3px 0 4px;
}
#ink-shape-pop .shp-item:hover { border-color: var(--accent, #1a1a1a); background: rgba(0,0,0,0.03); }
#ink-shape-pop .shp-item span { font-size: 8px; color: #666; }
#ink-shape-pop .shp-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
#ink-shape-pop .shp-row label { display: flex; align-items: center; gap: 5px; font-size: 10px; color: #555; flex: 1; }
#ink-shape-pop .shp-row input[type="range"] { flex: 1; min-width: 0; }
#ink-shape-pop #shp-an-val { font-size: 9px; color: #777; min-width: 26px; }
#ink-shape-pop .shp-dot {
  width: 17px; height: 17px; border-radius: 50%; cursor: pointer;
  border: 1px solid rgba(0,0,0,0.25); transition: transform .1s;
}
#ink-shape-pop .shp-dot:hover { transform: scale(1.2); }
#ink-shape-pop .shp-dot.sel { outline: 2px solid var(--accent2, #6c63ff); outline-offset: 1px; }
#ink-shape-pop .shp-custom { cursor: pointer; font-size: 13px; position: relative; }
#ink-shape-pop .shp-custom input { position: absolute; opacity: 0; width: 0; height: 0; }

/* Manga text presets */
#ink-text-presets { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 8px; }
#ink-text-presets button {
  border: 1px solid rgba(0,0,0,0.16); background: #fff; border-radius: 999px;
  font-size: 10px; font-weight: 600; padding: 4px 9px; cursor: pointer; color: #333;
}
#ink-text-presets button:hover { border-color: var(--accent, #1a1a1a); }
`;
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  _injectStyles();
  _buildZoomPill();
  _buildSafeZone();
  _injectLayerButtons();
  _injectStickerButton();
  _injectShapeButton();
  _injectTextPresets();
  try { if (localStorage.getItem('ink-safezone') === '1') toggleSafeZone(true); } catch (e) {}

  window.InkView = { zoomAt, zoomCenter, resetView, zoom100, toggleFocus };
})();
