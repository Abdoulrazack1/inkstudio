// ═══════════════════════════════════════════════════════════════════════════
// InkStudio — MULTI-SCENE SYSTEM
// A project is a list of scenes. Each scene has its own layers, groups and
// background; they share the project canvas size. Scenes play back-to-back
// ("Play all") and export as a single video, optionally driven by the
// voice-over timeline (js/audio.js).
//
// Runs after the main inline script — shares its global lexical scope
// (state, ctx, _mainCtx, generate, renderLayerList, …).
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const THUMB_W = 128, THUMB_H = 72;
  const DEFAULT_HOLD = 0.8; // seconds the final frame holds before next scene

  let scenes = [];   // [{id, name, audioStart, hold, thumb, live:{layers,groups,selectedLayerId,canvasBg}|null, pending:serialized|null}]
  let cur = 0;
  let idc = 0;

  // Playback sequence state (Play all / export)
  let _seq = { active: false, forExport: false, idx: 0, done: false };

  const _sleep = ms => new Promise(r => setTimeout(r, ms));

  // ── Scene construction ────────────────────────────────────────────────────

  function _newScene(name) {
    return {
      id: ++idc,
      name: name || `Scene ${scenes.length + 1}`,
      audioStart: null,   // seconds on the voice-over track; null = right after previous scene
      hold: DEFAULT_HOLD,
      thumb: null,
      live: null,
      pending: null,
    };
  }

  function _liveFromState() {
    return {
      layers: state.layers,
      groups: state.groups,
      selectedLayerId: state.selectedLayerId,
      canvasBg: state.canvasBg,
    };
  }

  function captureCurrent() {
    const s = scenes[cur];
    if (!s) return;
    s.live = _liveFromState();
    s.pending = null;
  }

  // ── Serialization (same layer format as saveProject) ─────────────────────

  function _serLayer(layer, index) {
    return {
      id: layer.id, name: layer.name, savedIndex: index,
      imageDataURL: getImageDataURL(layer.img),
      x: layer.x, y: layer.y, w: layer.w, h: layer.h,
      baseW: layer.baseW, baseH: layer.baseH, resizePct: layer.resizePct,
      animStyle: layer.animStyle, hand: layer.hand, animOrder: layer.animOrder,
      opacity: layer.opacity, visible: layer.visible, groupId: layer.groupId,
      speed: layer.speed, handSpeed: layer.handSpeed,
      chunks: layer.chunks, specChunks: layer.specChunks,
      hasPngAlpha: layer.hasPngAlpha,
      outlineDetect: layer.outlineDetect, outlineAlgorithm: layer.outlineAlgorithm,
      outlineStrokeStyle: layer.outlineStrokeStyle, colorStyle: layer.colorStyle,
      outlineColor: layer.outlineColor, outlineThickness: layer.outlineThickness,
      textAnimDir: layer.textAnimDir, textDrawStyle: layer.textDrawStyle,
      kind: layer.kind || null, textProps: layer.textProps || null,
    };
  }

  function _hydrateLayer(ld, index) {
    return new Promise(resolve => {
      const base = {
        id: ld.id, name: ld.name, _savedIndex: ld.savedIndex ?? index,
        x: ld.x, y: ld.y, w: ld.w, h: ld.h,
        baseW: ld.baseW ?? ld.w, baseH: ld.baseH ?? ld.h,
        resizePct: ld.resizePct ?? 100,
        animStyle: ld.animStyle || 'scanner', hand: ld.hand || 'custom1',
        animOrder: ld.animOrder ?? null, opacity: ld.opacity ?? 1,
        visible: ld.visible !== false, groupId: ld.groupId || null,
        speed: ld.speed ?? 40, handSpeed: ld.handSpeed ?? 6,
        chunks: ld.chunks ?? 30, specChunks: ld.specChunks ?? 35,
        hasPngAlpha: ld.hasPngAlpha || false,
        outlineDetect: ld.outlineDetect, outlineAlgorithm: ld.outlineAlgorithm,
        outlineStrokeStyle: ld.outlineStrokeStyle, colorStyle: ld.colorStyle,
        outlineColor: ld.outlineColor, outlineThickness: ld.outlineThickness,
        textAnimDir: ld.textAnimDir, textDrawStyle: ld.textDrawStyle,
        kind: ld.kind || null, textProps: ld.textProps || null,
      };
      if (!ld.imageDataURL) { resolve({ ...base, img: null }); return; }
      const img = new Image();
      img.onload = () => resolve({ ...base, img });
      img.onerror = () => { console.error('Scene layer image failed to load'); resolve({ ...base, img: null }); };
      img.src = ld.imageDataURL;
    });
  }

  async function _hydrateScene(s) {
    if (s.live || !s.pending) return;
    const d = s.pending;
    const layers = (await Promise.all((d.layers || []).map(_hydrateLayer)))
      .filter(l => l.img || l.kind === 'text')
      .sort((a, b) => (a._savedIndex ?? 0) - (b._savedIndex ?? 0));
    layers.forEach(l => delete l._savedIndex);
    const maxId = layers.reduce((m, l) => Math.max(m, l.id || 0), 0);
    if (maxId >= _layerIdCounter) _layerIdCounter = maxId;
    s.live = {
      layers,
      groups: d.groups || [],
      selectedLayerId: d.selectedLayerId ?? (layers[0]?.id ?? null),
      canvasBg: d.canvasBg || { type: 'solid', val: 'white' },
    };
    s.pending = null;
  }

  function serialize() {
    return scenes.map((s, i) => {
      if (s.pending) return s.pending; // not hydrated → pass through untouched
      const live = (i === cur) ? _liveFromState() : s.live;
      if (!live) return { name: s.name, audioStart: s.audioStart, hold: s.hold, thumb: s.thumb, layers: [], groups: [], selectedLayerId: null, canvasBg: { type: 'solid', val: 'white' } };
      return {
        name: s.name,
        audioStart: s.audioStart,
        hold: s.hold,
        thumb: s.thumb,
        layers: (live.layers || []).map(_serLayer),
        groups: JSON.parse(JSON.stringify(live.groups || [])),
        selectedLayerId: live.selectedLayerId,
        canvasBg: JSON.parse(JSON.stringify(live.canvasBg || { type: 'solid', val: 'white' })),
      };
    });
  }

  function onProjectLoaded(savedState) {
    stopPlayAll();
    if (savedState && Array.isArray(savedState.scenes) && savedState.scenes.length) {
      scenes = savedState.scenes.map(d => {
        const s = _newScene(d.name);
        s.audioStart = (typeof d.audioStart === 'number') ? d.audioStart : null;
        s.hold = (typeof d.hold === 'number') ? d.hold : DEFAULT_HOLD;
        s.thumb = d.thumb || null;
        s.pending = d;
        return s;
      });
      cur = Math.max(0, Math.min(scenes.length - 1, savedState.sceneIndex || 0));
      // Current scene's layers are loaded by the legacy loadProject path into
      // `state`; captureCurrent() will adopt them on first save/switch.
      scenes[cur].pending = null; // legacy path owns the live data
      // Hydrate the rest in the background so switching is instant
      scenes.forEach(s => { if (s.pending) _hydrateScene(s).then(renderStrip); });
    } else {
      // Legacy single-scene project (or brand-new project)
      scenes = [_newScene('Scene 1')];
      cur = 0;
      scenes[0].live = _liveFromState();
    }
    renderStrip();
    if (window.AudioVO) AudioVO.onScenesChanged();
  }

  // ── Activation / switching ────────────────────────────────────────────────

  function _stopAnyAnim() {
    cancelAnimationFrame(state.animFrame);
    state.playing = false;
    state.done = false;
    state._activeSlots = [];
    state._currentSlot = null;
    state._slotMode = false;
    state.bgCanvas = null;
    state._animGroups = null;
    state._groupPos = 0;
    ctx = _mainCtx;
    hctx.clearRect(0, 0, state.canvasW, state.canvasH);
    sctx.clearRect(0, 0, state.canvasW, state.canvasH);
  }

  function _applyBgToUI(bg) {
    document.querySelectorAll('.bg-pill, .bg-preset').forEach(el => el.classList.remove('active'));
    if (!bg) return;
    if (bg.type === 'gradient') {
      const pill = document.querySelector(`.bg-preset[onclick*="'${bg.key || bg.val}'"]`);
      if (pill) pill.classList.add('active');
    } else if (bg.type === 'solid') {
      if (bg.val === 'white' || bg.val === '#ffffff') {
        const p = document.querySelector('.bg-pill[onclick*="white"]'); if (p) p.classList.add('active');
      } else if (bg.val === 'transparent') {
        const p = document.querySelector('.bg-pill[onclick*="transparent"]'); if (p) p.classList.add('active');
      } else if (bg.val === '#000000') {
        const p = document.querySelector('.bg-pill[onclick*="#000000"]'); if (p) p.classList.add('active');
      }
    }
  }

  async function activate(i, opts = {}) {
    if (i < 0 || i >= scenes.length) return;
    if (i === cur && !opts.force) { renderStrip(); return; }

    if (!opts.fromPlayback) captureCurrent();
    const s = scenes[i];
    await _hydrateScene(s);
    if (!s.live) s.live = { layers: [], groups: [], selectedLayerId: null, canvasBg: state.canvasBg };

    _stopAnyAnim();

    state.layers = s.live.layers;
    state.groups = s.live.groups;
    state.selectedLayerId = s.live.selectedLayerId;
    state.canvasBg = s.live.canvasBg;

    cur = i;

    _applyBgToUI(state.canvasBg);
    renderLayerList();
    redrawLayersOnCanvas();
    if (state.selectedLayerId && state.layers.some(l => l.id === state.selectedLayerId)) {
      selectLayer(state.selectedLayerId);
    }
    if (!opts.fromPlayback) {
      clearUndoHistory();
      scheduleAutoSave();
    }
    renderStrip();
  }

  // ── Scene operations ──────────────────────────────────────────────────────

  function addScene() {
    captureCurrent();
    const s = _newScene(`Scene ${scenes.length + 1}`);
    s.live = {
      layers: [], groups: [], selectedLayerId: null,
      canvasBg: JSON.parse(JSON.stringify(state.canvasBg || { type: 'solid', val: 'white' })),
    };
    scenes.splice(cur + 1, 0, s);
    activate(cur + 1, { force: true });
    showToast('Scene added');
  }

  async function duplicateScene(i) {
    captureCurrent();
    const src = scenes[i];
    await _hydrateScene(src);
    const s = _newScene(`${src.name} copy`);
    const live = (i === cur) ? _liveFromState() : src.live;
    s.live = {
      layers: (live.layers || []).map(l => ({ ...l, id: ++_layerIdCounter, textProps: l.textProps ? JSON.parse(JSON.stringify(l.textProps)) : null })),
      groups: JSON.parse(JSON.stringify(live.groups || [])),
      selectedLayerId: null,
      canvasBg: JSON.parse(JSON.stringify(live.canvasBg || { type: 'solid', val: 'white' })),
    };
    s.thumb = src.thumb;
    s.hold = src.hold;
    scenes.splice(i + 1, 0, s);
    activate(i + 1, { force: true });
    showToast('Scene duplicated');
  }

  function deleteScene(i) {
    const s = scenes[i];
    const hasContent = (i === cur ? state.layers : (s.live?.layers || s.pending?.layers || [])).length > 0;
    if (hasContent && !confirm(`Delete "${s.name}" and its layers?`)) return;
    if (scenes.length === 1) {
      // Last scene: clear it instead of removing
      state.layers = []; state.groups = []; state.selectedLayerId = null;
      s.live = _liveFromState(); s.thumb = null;
      _stopAnyAnim(); renderLayerList(); redrawLayersOnCanvas(); renderStrip();
      scheduleAutoSave();
      return;
    }
    scenes.splice(i, 1);
    if (cur > i) { cur--; renderStrip(); scheduleAutoSave(); }
    else if (cur === i) {
      cur = -1; // force re-activation
      activate(Math.min(i, scenes.length - 1), { force: true, fromPlayback: true });
      clearUndoHistory();
      scheduleAutoSave();
    } else { renderStrip(); scheduleAutoSave(); }
    if (window.AudioVO) AudioVO.onScenesChanged();
  }

  function moveScene(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= scenes.length) return;
    captureCurrent();
    const [s] = scenes.splice(i, 1);
    scenes.splice(j, 0, s);
    if (cur === i) cur = j; else if (cur === j) cur = i;
    renderStrip();
    scheduleAutoSave();
    if (window.AudioVO) AudioVO.onScenesChanged();
  }

  function renameScene(i) {
    const name = prompt('Scene name:', scenes[i].name);
    if (name && name.trim()) { scenes[i].name = name.trim(); renderStrip(); scheduleAutoSave(); if (window.AudioVO) AudioVO.onScenesChanged(); }
  }

  // ── Thumbnails ────────────────────────────────────────────────────────────

  function _renderThumbCanvas(live) {
    const c = document.createElement('canvas');
    c.width = THUMB_W; c.height = THUMB_H;
    const tc = c.getContext('2d');
    const sx = THUMB_W / state.canvasW, sy = THUMB_H / state.canvasH;
    tc.save();
    tc.scale(sx, sy);
    const bg = live.canvasBg || { type: 'solid', val: 'white' };
    if (bg.type === 'gradient' && BG_GRADIENTS[bg.key]) {
      try { BG_GRADIENTS[bg.key](tc); } catch (e) { tc.fillStyle = '#fff'; tc.fillRect(0, 0, state.canvasW, state.canvasH); }
    } else if (bg.type === 'solid' && bg.val === 'transparent') {
      // checkerboard
      tc.restore(); tc.save();
      for (let y = 0; y < THUMB_H; y += 8) for (let x = 0; x < THUMB_W; x += 8) {
        tc.fillStyle = ((x + y) / 8) % 2 ? '#e0e0e0' : '#f8f8f8'; tc.fillRect(x, y, 8, 8);
      }
      tc.scale(sx, sy);
    } else {
      tc.fillStyle = (bg.val === 'white') ? '#ffffff' : (bg.val || '#ffffff');
      tc.fillRect(0, 0, state.canvasW, state.canvasH);
    }
    (live.layers || []).forEach(l => {
      if (l.visible === false || !l.img) return;
      tc.globalAlpha = l.opacity ?? 1;
      try { tc.drawImage(l.img, l.x, l.y, l.w, l.h); } catch (e) {}
    });
    tc.restore();
    return c;
  }

  function _refreshCurrentThumb() {
    const s = scenes[cur];
    if (!s) return;
    try { s.thumb = _renderThumbCanvas(_liveFromState()).toDataURL('image/jpeg', 0.7); } catch (e) {}
  }

  // ── Play all (preview + export) ───────────────────────────────────────────

  function _sceneAnimDone() {
    if (!state.done) return false;
    const groups = state._animGroups;
    if (!groups || !groups.length) return true;
    const gp = Number.isFinite(state._groupPos) ? state._groupPos : 0;
    return gp >= groups.length - 1 && !state.playing;
  }

  function _sceneFrac() {
    if (_sceneAnimDone()) return 1;
    const groups = state._animGroups;
    if (!groups || !groups.length) return state.done ? 1 : 0;
    const gp = Math.max(0, Math.min(groups.length - 1, Number.isFinite(state._groupPos) ? state._groupPos : 0));
    const f = state.done ? 1 : Math.max(0, Math.min(1, state._animProgress || 0));
    return Math.max(0, Math.min(1, (gp + f) / groups.length));
  }

  // Force-finish the current scene: draw its final frame and mark done.
  function _snapSceneToEnd() {
    cancelAnimationFrame(state.animFrame);
    state.playing = false;
    state._activeSlots = [];
    state._currentSlot = null;
    state._slotMode = false;
    ctx = _mainCtx;
    state.bgCanvas = null;
    fillBg(_mainCtx);
    (state.layers || []).filter(l => l.visible !== false && l.img).forEach(l => {
      _mainCtx.save();
      _mainCtx.globalAlpha = l.opacity ?? 1;
      _mainCtx.drawImage(l.img, l.x, l.y, l.w, l.h);
      _mainCtx.restore();
    });
    hctx.clearRect(0, 0, state.canvasW, state.canvasH);
    state.done = true;
    if (state._animGroups) state._groupPos = state._animGroups.length - 1;
  }

  function _waitSceneDone(i, hasAudio) {
    return new Promise(resolve => {
      const next = scenes[i + 1];
      const timer = setInterval(() => {
        if (!_seq.active) { clearInterval(timer); resolve(); return; }
        if (_sceneAnimDone()) { clearInterval(timer); resolve(); return; }
        // Audio is the master clock: when the next scene's marker is reached,
        // snap this scene to its final frame so voice and drawings stay matched.
        if (hasAudio && next && next.audioStart != null && AudioVO.time() >= next.audioStart) {
          _snapSceneToEnd();
          clearInterval(timer); resolve();
        }
      }, 80);
    });
  }

  async function playAll(opts = {}) {
    if (_seq.active) return;
    captureCurrent();
    _refreshCurrentThumb();
    _seq = { active: true, forExport: !!opts.forExport, idx: 0, done: false };
    _syncPlayAllBtn();

    const hasAudio = !!(window.AudioVO && AudioVO.hasAudio());
    try {
      if (hasAudio) await AudioVO.startPlayback({ forExport: !!opts.forExport });

      for (let i = 0; i < scenes.length; i++) {
        if (!_seq.active) return;
        _seq.idx = i;
        const marker = scenes[i].audioStart;
        if (hasAudio && marker != null) await AudioVO.waitUntil(marker, () => !_seq.active);
        if (!_seq.active) return;

        await activate(i, { force: true, fromPlayback: true });
        renderStrip();
        if (!_seq.active) return;

        if (!(state.layers || []).length) { await _sleep(400); continue; }
        generate();
        await _waitSceneDone(i, hasAudio);
        if (!_seq.active) return;

        // Hold the completed frame (skip if next scene is gated by an audio marker)
        const next = scenes[i + 1];
        if (!(hasAudio && next && next.audioStart != null)) {
          await _sleep((scenes[i].hold ?? DEFAULT_HOLD) * 1000);
        }
      }

      // Let the rest of the voice-over play out over the final frame
      if (hasAudio && _seq.active) await AudioVO.waitUntilEnd(() => !_seq.active);
      _seq.done = true;
    } finally {
      if (!_seq.forExport) {
        _seq.active = false;
        if (hasAudio) AudioVO.stopPlayback();
        _syncPlayAllBtn();
      }
    }
  }

  function stopPlayAll() {
    _seq.active = false;
    _seq.done = false;
    if (window.AudioVO) AudioVO.stopPlayback();
    _syncPlayAllBtn();
  }

  // ── Export driver (hooked from recordWebM / recordMP4) ────────────────────

  window.ExportDriver = {
    active: false,
    _single: false,
    start() {
      this.active = true;
      const multi = scenes.length > 1 || !!(window.AudioVO && AudioVO.hasAudio());
      if (multi) { this._single = false; playAll({ forExport: true }); }
      else { this._single = true; restartAnim(); }
    },
    isComplete() {
      if (this._single) return _sceneAnimDone();
      return _seq.done;
    },
    progress() {
      if (this._single) return _sceneFrac();
      if (_seq.done) return 1;
      const n = Math.max(1, scenes.length);
      const hasAudio = !!(window.AudioVO && AudioVO.hasAudio());
      const scenePart = Math.min(1, (_seq.idx + _sceneFrac()) / n);
      if (!hasAudio || !AudioVO.duration()) return scenePart;
      // Blend with the audio clock — audio is the real timeline when present
      const audioPart = Math.min(1, AudioVO.time() / AudioVO.duration());
      return Math.max(scenePart * 0.5, audioPart);
    },
    stop() {
      this.active = false;
      this._single = false;
      stopPlayAll();
    },
  };

  // ── Strip UI ──────────────────────────────────────────────────────────────

  function _injectStyles() {
    const css = `
#scene-strip {
  flex-shrink: 0;
  background: var(--panel);
  border-top: 1px solid rgba(0,0,0,0.10);
  padding: 8px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ss-row { display: flex; align-items: center; gap: 10px; min-height: 0; }
.ss-title {
  font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--accent); opacity: 0.65; width: 52px; flex-shrink: 0;
}
.ss-thumbs { display: flex; gap: 8px; overflow-x: auto; padding: 2px; flex: 1; min-width: 0; }
.ss-thumb {
  position: relative; flex-shrink: 0; width: ${THUMB_W}px; cursor: pointer;
  border-radius: 6px; border: 2px solid rgba(0,0,0,0.12); background: #fff;
  overflow: hidden; transition: border-color .15s, box-shadow .15s;
}
.ss-thumb:hover { border-color: rgba(0,0,0,0.35); }
.ss-thumb.active { border-color: var(--accent2); box-shadow: 0 0 0 1px var(--accent2); }
.ss-thumb.playing { border-color: #16a34a; box-shadow: 0 0 0 1px #16a34a; }
.ss-thumb img, .ss-thumb .ss-thumb-empty { display: block; width: 100%; height: ${THUMB_H}px; object-fit: cover; }
.ss-thumb-empty { display: flex; align-items: center; justify-content: center; color: #aaa; font-size: 10px; background: repeating-conic-gradient(#f2f2f2 0% 25%, #fff 0% 50%) 0 0 / 16px 16px; }
.ss-thumb-name {
  font-size: 10px; padding: 3px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  background: rgba(255,255,255,0.92); border-top: 1px solid rgba(0,0,0,0.06); color: #333;
}
.ss-thumb-idx {
  position: absolute; top: 3px; left: 3px; background: rgba(0,0,0,0.65); color: #fff;
  font-size: 9px; font-weight: 700; border-radius: 4px; padding: 1px 5px; pointer-events: none;
}
.ss-thumb-pin {
  position: absolute; top: 3px; right: 3px; background: var(--accent2); color: #fff;
  font-size: 8px; font-weight: 700; border-radius: 4px; padding: 1px 4px; pointer-events: none;
}
.ss-thumb-actions {
  position: absolute; bottom: 20px; right: 3px; display: none; gap: 2px;
}
.ss-thumb:hover .ss-thumb-actions { display: flex; }
.ss-thumb-actions button {
  border: none; background: rgba(0,0,0,0.65); color: #fff; width: 18px; height: 18px;
  border-radius: 4px; font-size: 10px; line-height: 1; cursor: pointer; padding: 0;
}
.ss-thumb-actions button:hover { background: var(--accent2); }
.ss-btn {
  flex-shrink: 0; border: 1px solid rgba(0,0,0,0.18); background: #fff; color: var(--accent);
  border-radius: 6px; padding: 6px 10px; font-size: 11px; font-weight: 600; cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px; transition: all .15s;
}
.ss-btn:hover { border-color: var(--accent); }
.ss-btn.ss-add { width: 34px; height: ${THUMB_H + 22}px; justify-content: center; font-size: 16px; }
.ss-btn.ss-playall.running { border-color: var(--accent2); color: var(--accent2); }
`;
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  function _syncPlayAllBtn() {
    const b = document.getElementById('ss-playall-btn');
    if (!b) return;
    b.classList.toggle('running', _seq.active);
    b.innerHTML = _seq.active ? '■ Stop' : '▶ Play all';
  }

  function renderStrip() {
    const strip = document.getElementById('scene-strip');
    if (!strip) return;
    let row = document.getElementById('ss-scenes-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'ss-row';
      row.id = 'ss-scenes-row';
      strip.prepend(row);
    }
    _refreshCurrentThumb();

    row.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'ss-title';
    title.textContent = 'Scenes';
    row.appendChild(title);

    const thumbs = document.createElement('div');
    thumbs.className = 'ss-thumbs';
    scenes.forEach((s, i) => {
      const el = document.createElement('div');
      el.className = 'ss-thumb' + (i === cur ? ' active' : '') + (_seq.active && _seq.idx === i ? ' playing' : '');
      const src = s.thumb || s.pending?.thumb;
      el.innerHTML = `
        ${src ? `<img src="${src}" draggable="false">` : `<div class="ss-thumb-empty">empty</div>`}
        <div class="ss-thumb-idx">${i + 1}</div>
        ${s.audioStart != null ? `<div class="ss-thumb-pin" title="Starts at ${s.audioStart.toFixed(1)}s on the voice-over">🎙 ${s.audioStart.toFixed(1)}s</div>` : ''}
        <div class="ss-thumb-name">${s.name}</div>
        <div class="ss-thumb-actions">
          <button title="Move left" data-act="left">◀</button>
          <button title="Move right" data-act="right">▶</button>
          <button title="Duplicate" data-act="dup">⧉</button>
          <button title="Delete" data-act="del">✕</button>
        </div>`;
      el.addEventListener('click', e => {
        const act = e.target?.dataset?.act;
        if (act === 'left') { moveScene(i, -1); return; }
        if (act === 'right') { moveScene(i, 1); return; }
        if (act === 'dup') { duplicateScene(i); return; }
        if (act === 'del') { deleteScene(i); return; }
        if (!_seq.active) activate(i);
      });
      el.addEventListener('dblclick', e => {
        if (!e.target?.dataset?.act) renameScene(i);
      });
      thumbs.appendChild(el);
    });
    row.appendChild(thumbs);

    const add = document.createElement('button');
    add.className = 'ss-btn ss-add';
    add.title = 'Add scene (after current)';
    add.textContent = '+';
    add.addEventListener('click', () => { if (!_seq.active) addScene(); });
    row.appendChild(add);

    const play = document.createElement('button');
    play.className = 'ss-btn ss-playall';
    play.id = 'ss-playall-btn';
    play.title = 'Play every scene in order (with voice-over if loaded)';
    play.addEventListener('click', () => { _seq.active ? stopPlayAll() : playAll(); });
    row.appendChild(play);
    _syncPlayAllBtn();

    if (window.AudioVO) AudioVO.onScenesChanged();
  }

  // ── Keyboard: PageUp / PageDown to switch scenes ──────────────────────────

  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (_seq.active) return;
    if (e.key === 'PageDown') { e.preventDefault(); activate(Math.min(cur + 1, scenes.length - 1)); }
    if (e.key === 'PageUp')   { e.preventDefault(); activate(Math.max(cur - 1, 0)); }
  });

  // ── Public API ────────────────────────────────────────────────────────────

  window.SceneManager = {
    captureCurrent,
    serialize,
    onProjectLoaded,
    activate,
    addScene,
    duplicateScene,
    deleteScene,
    moveScene,
    playAll,
    stopPlayAll,
    renderStrip,
    count: () => scenes.length,
    currentIndex: () => cur,
    getScenes: () => scenes,
    isSequenceActive: () => _seq.active,
  };

  // ── Init ──────────────────────────────────────────────────────────────────

  _injectStyles();
  scenes = [_newScene('Scene 1')];
  scenes[0].live = _liveFromState();
  renderStrip();
  // The strip takes vertical space away from the canvas area
  if (typeof fitCanvas === 'function') setTimeout(fitCanvas, 0);

  // Refresh the current thumbnail periodically while editing (cheap at 128px)
  setInterval(() => {
    if (_seq.active || state.playing) return;
    const before = scenes[cur]?.thumb;
    _refreshCurrentThumb();
    if (scenes[cur]?.thumb !== before) renderStrip();
  }, 4000);
})();
