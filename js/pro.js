// ═══════════════════════════════════════════════════════════════════════════
// InkStudio — PRO TOOLS
// Local, no-ML production features layered on top of the editor via injection
// (same pattern as studio.js): platform export presets + framerate + custom
// bitrate, persistent watermark/logo, custom font import, SVG import,
// project search, and an auto text-style suggestion. Shares the global scope.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => (window.escapeHtml || String)(s);

  // ═════════════════════════════════════════════════════════════════════════
  // 1. EXPORT — platform presets, framerate, custom bitrate
  // ═════════════════════════════════════════════════════════════════════════

  const PLATFORMS = [
    { key: 'tiktok',  label: 'TikTok',     ratio: '9:16', res: 1080, safe: true },
    { key: 'reels',   label: 'Reels',      ratio: '9:16', res: 1080, safe: true },
    { key: 'shorts',  label: 'Shorts',     ratio: '9:16', res: 1080, safe: true },
    { key: 'yt',      label: 'YouTube',    ratio: '16:9', res: 1080, safe: false },
    { key: 'square',  label: 'Carré',      ratio: '1:1',  res: 1080, safe: false },
  ];

  function _applyPlatform(p) {
    const rb = document.querySelector(`.ratio-btn[data-ratio="${p.ratio}"]`);
    const rs = document.querySelector(`.res-btn[data-res="${p.res}"]`);
    if (rb && typeof selectRatio === 'function') selectRatio(rb);
    if (rs && typeof selectRes === 'function') selectRes(rs);
    if (p.safe && typeof toggleSafeZone === 'function') toggleSafeZone(true);
    showToast(`Format ${p.label} — ${p.ratio} ${p.res}p`);
  }

  function _injectExportControls() {
    const host = $('export-banner-controls');
    if (!host || $('pro-export-extra')) return;

    const wrap = document.createElement('div');
    wrap.id = 'pro-export-extra';
    wrap.innerHTML = `
      <div class="export-banner-section">
        <div class="export-banner-label">Plateforme</div>
        <div class="pro-plat-row">
          ${PLATFORMS.map(p => `<button class="pro-plat" data-p="${p.key}">${p.label}</button>`).join('')}
        </div>
      </div>
      <div class="export-banner-section">
        <div class="export-banner-label">Images / seconde</div>
        <div class="pro-fps-row">
          ${[24, 30, 60].map(f => `<button class="pro-fps${f === 30 ? ' on' : ''}" data-f="${f}">${f}</button>`).join('')}
        </div>
      </div>
      <div class="export-banner-section">
        <div class="export-banner-label">Bitrate (Mbps, vide = auto)</div>
        <input type="number" id="pro-bitrate" min="1" max="60" step="1" placeholder="auto"
          style="width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:12px;background:var(--panel);color:var(--text);">
      </div>`;
    // Insert before the actions row so it reads Format → Quality → Platform → FPS → Bitrate
    const actions = host.querySelector('.export-banner-actions');
    if (actions) host.insertBefore(wrap, actions); else host.appendChild(wrap);

    wrap.querySelectorAll('.pro-plat').forEach(b => b.addEventListener('click', () => {
      _applyPlatform(PLATFORMS.find(p => p.key === b.dataset.p));
    }));
    wrap.querySelectorAll('.pro-fps').forEach(b => b.addEventListener('click', () => {
      state.exportFPS = +b.dataset.f;
      wrap.querySelectorAll('.pro-fps').forEach(x => x.classList.toggle('on', x === b));
    }));
    $('pro-bitrate').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      state.exportFPS = state.exportFPS || 30;
      state.exportBitrate = (isNaN(v) || v <= 0) ? 0 : Math.min(60, v);
    });
    state.exportFPS = state.exportFPS || 30;
    state.exportBitrate = state.exportBitrate || 0;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 2. WATERMARK / LOGO — persistent overlay, composited into exports
  // ═════════════════════════════════════════════════════════════════════════

  const WM = { img: null, dataURL: null, xPct: 0.72, yPct: 0.86, wPct: 0.2, opacity: 0.85, on: false };
  let wmEl = null;

  function _wmLoad() {
    try {
      const raw = localStorage.getItem('ink-watermark');
      if (!raw) return;
      const d = JSON.parse(raw);
      Object.assign(WM, d);
      if (WM.dataURL) {
        const im = new Image();
        im.onload = () => { WM.img = im; _wmSyncOverlay(); };
        im.src = WM.dataURL;
      }
    } catch (e) {}
  }
  function _wmSave() {
    try {
      localStorage.setItem('ink-watermark', JSON.stringify({
        dataURL: WM.dataURL, xPct: WM.xPct, yPct: WM.yPct, wPct: WM.wPct, opacity: WM.opacity, on: WM.on,
      }));
    } catch (e) {}
  }

  // Draw into any export/composite context sized to the canvas
  function drawWatermark(ctx, W, H) {
    if (!WM.on || !WM.img) return;
    const w = W * WM.wPct;
    const h = w * (WM.img.height / WM.img.width);
    const x = W * WM.xPct - w / 2, y = H * WM.yPct - h / 2;
    ctx.save();
    ctx.globalAlpha = WM.opacity;
    try { ctx.drawImage(WM.img, x, y, w, h); } catch (e) {}
    ctx.restore();
  }
  window.Watermark = { draw: drawWatermark, get: () => WM };

  // Preview overlay (positioned over the canvas-wrapper, like the safe zone)
  function _wmSyncOverlay() {
    const wrap = $('canvas-wrapper');
    if (!wrap) return;
    if (!wmEl) {
      wmEl = document.createElement('img');
      wmEl.id = 'ink-watermark';
      wmEl.draggable = false;
      wrap.appendChild(wmEl);
      _wmMakeDraggable();
    }
    if (WM.on && WM.dataURL) {
      wmEl.src = WM.dataURL;
      wmEl.style.display = 'block';
      wmEl.style.width = (WM.wPct * 100) + '%';
      wmEl.style.left = (WM.xPct * 100) + '%';
      wmEl.style.top = (WM.yPct * 100) + '%';
      wmEl.style.opacity = WM.opacity;
    } else {
      wmEl.style.display = 'none';
    }
  }

  function _wmMakeDraggable() {
    wmEl.addEventListener('mousedown', e => {
      e.preventDefault();
      const wrap = $('canvas-wrapper').getBoundingClientRect();
      const move = ev => {
        WM.xPct = Math.max(0.03, Math.min(0.97, (ev.clientX - wrap.left) / wrap.width));
        WM.yPct = Math.max(0.03, Math.min(0.97, (ev.clientY - wrap.top) / wrap.height));
        wmEl.style.left = (WM.xPct * 100) + '%';
        wmEl.style.top = (WM.yPct * 100) + '%';
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        _wmSave();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  function _openWmPop(anchor) {
    $('ink-wm-pop')?.remove();
    const pop = document.createElement('div');
    pop.id = 'ink-wm-pop';
    pop.innerHTML = `
      <div class="wmp-row"><button id="wm-upload">📁 Choisir un logo…</button><button id="wm-clear" title="Retirer">✕</button></div>
      <label class="wmp-ctl"><input type="checkbox" id="wm-on" ${WM.on ? 'checked' : ''}> Afficher le watermark</label>
      <label class="wmp-ctl">Taille <input type="range" id="wm-size" min="5" max="45" value="${Math.round(WM.wPct * 100)}"></label>
      <label class="wmp-ctl">Opacité <input type="range" id="wm-op" min="10" max="100" value="${Math.round(WM.opacity * 100)}"></label>
      <div class="wmp-hint">Glisse le logo sur le canvas pour le positionner. Il apparaît sur toutes les scènes et dans l'export.</div>
      <input type="file" id="wm-file" accept="image/*" style="display:none">`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 250, r.left)) + 'px';
    pop.style.top = (r.bottom + 8) + 'px';

    const fileInput = pop.querySelector('#wm-file');
    pop.querySelector('#wm-upload').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        WM.dataURL = rd.result;
        const im = new Image();
        im.onload = () => { WM.img = im; WM.on = true; pop.querySelector('#wm-on').checked = true; _wmSyncOverlay(); _wmSave(); };
        im.src = rd.result;
      };
      rd.readAsDataURL(f);
    });
    pop.querySelector('#wm-clear').addEventListener('click', () => {
      WM.dataURL = null; WM.img = null; WM.on = false; _wmSyncOverlay(); _wmSave();
    });
    pop.querySelector('#wm-on').addEventListener('change', e => { WM.on = e.target.checked; _wmSyncOverlay(); _wmSave(); });
    pop.querySelector('#wm-size').addEventListener('input', e => { WM.wPct = e.target.value / 100; _wmSyncOverlay(); });
    pop.querySelector('#wm-size').addEventListener('change', _wmSave);
    pop.querySelector('#wm-op').addEventListener('input', e => { WM.opacity = e.target.value / 100; _wmSyncOverlay(); });
    pop.querySelector('#wm-op').addEventListener('change', _wmSave);
    setTimeout(() => {
      const onDoc = e => { if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('mousedown', onDoc); } };
      document.addEventListener('mousedown', onDoc);
    }, 0);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 3. CUSTOM FONT IMPORT (.ttf / .woff2 / .otf)
  // ═════════════════════════════════════════════════════════════════════════

  async function _importFont(file) {
    try {
      const buf = await file.arrayBuffer();
      const family = file.name.replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, '').trim() || 'Custom Font';
      const ff = new FontFace(family, buf);
      await ff.load();
      document.fonts.add(ff);
      if (typeof TEXT_FONTS !== 'undefined' && !TEXT_FONTS.some(f => f.family === family)) {
        TEXT_FONTS.push({ family, label: family, desc: 'Police importée', preview: 'Aa' });
        if (typeof initFontPicker === 'function') initFontPicker();
      }
      if (typeof selectFont === 'function') selectFont(family);
      showToast(`Police « ${family} » importée`);
    } catch (err) {
      console.error('Font import failed:', err);
      showToast('⚠️ Police illisible (formats : ttf, otf, woff, woff2)', null, 3500);
    }
  }

  function _injectFontImport() {
    const picker = $('font-picker');
    if (!picker || $('pro-font-import')) return;
    const b = document.createElement('button');
    b.id = 'pro-font-import';
    b.textContent = '＋ Importer une police (.ttf)';
    b.style.cssText = 'width:100%;margin-top:6px;padding:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px dashed var(--border-hi);border-radius:6px;background:var(--panel);color:var(--text);';
    const fi = document.createElement('input');
    fi.type = 'file';
    fi.accept = '.ttf,.otf,.woff,.woff2,font/*';
    fi.style.display = 'none';
    fi.addEventListener('change', () => { if (fi.files[0]) _importFont(fi.files[0]); fi.value = ''; });
    b.addEventListener('click', () => fi.click());
    picker.parentElement.insertBefore(b, picker.nextSibling);
    picker.parentElement.appendChild(fi);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 4. PROJECT SEARCH (filters the Projects modal list)
  // ═════════════════════════════════════════════════════════════════════════

  function _injectProjectSearch() {
    const list = $('projects-list');
    if (!list || $('pro-proj-search')) return;
    const inp = document.createElement('input');
    inp.id = 'pro-proj-search';
    inp.type = 'text';
    inp.placeholder = '🔎 Rechercher un projet…';
    inp.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:10px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;background:var(--panel);color:var(--text);';
    list.parentElement.insertBefore(inp, list);
    inp.addEventListener('input', () => {
      const q = inp.value.trim().toLowerCase();
      list.querySelectorAll('.project-item, [class*="project-item"]').forEach(it => {
        const name = (it.querySelector('.project-name')?.textContent || '').toLowerCase();
        it.style.display = (!q || name.includes(q)) ? '' : 'none';
      });
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 4bis. NAMED CHECKPOINTS (version history in IndexedDB)
  // ═════════════════════════════════════════════════════════════════════════

  function saveCheckpoint() {
    // db / currentProjectId are `let` globals (shared lexical scope, not on window)
    if (typeof db === 'undefined' || !db || !currentProjectId) { showToast('Ouvre ou crée un projet d\'abord'); return; }
    if (typeof saveProject === 'function') saveProject();
    setTimeout(() => {
      try {
        const tx = db.transaction(['projects'], 'readwrite');
        const store = tx.objectStore('projects');
        const req = store.get(currentProjectId);
        req.onsuccess = () => {
          const p = req.result;
          if (!p) return;
          const now = new Date();
          const stamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
          // Strip a previous checkpoint suffix so names don't stack up
          const base = String(p.name || 'Projet').replace(/ — ⭐.*$/, '');
          const copy = { name: `${base} — ⭐ ${stamp}`, createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString(), state: p.state };
          const add = store.add(copy);
          add.onsuccess = () => {
            if (typeof refreshProjectsList === 'function') refreshProjectsList();
            setTimeout(_injectProjectSearch, 30);
            showToast(`⭐ Checkpoint « ${copy.name} » enregistré`);
          };
        };
      } catch (e) { showToast('⚠️ Checkpoint impossible', null, 3000); }
    }, 180);
  }
  window.saveCheckpoint = saveCheckpoint;

  function _injectCheckpointButton() {
    const actions = document.querySelector('.projects-actions');
    if (!actions || $('pro-checkpoint-btn')) return;
    const b = document.createElement('button');
    b.id = 'pro-checkpoint-btn';
    b.className = 'projects-new-btn';
    b.style.opacity = '0.85';
    b.title = 'Enregistrer une copie nommée horodatée du projet (checkpoint) — reviens-y à tout moment';
    b.textContent = '⭐ Checkpoint';
    b.addEventListener('click', saveCheckpoint);
    actions.appendChild(b);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 5. AUTO TEXT-STYLE SUGGESTION (ALL CAPS + ! → onomatopée)
  // ═════════════════════════════════════════════════════════════════════════

  let _suggChip = null;
  function _looksLikeSfx(t) {
    const s = t.trim();
    if (s.length < 2 || s.length > 20) return false;
    const letters = s.replace(/[^A-Za-zÀ-ÿ]/g, '');
    if (letters.length < 2) return false;
    const upper = letters === letters.toUpperCase();
    return (upper && /[!?]/.test(s)) || /(BOOM|BAM|POW|WAM|CRASH|SLAM|VLAN|PAF|BADABOUM|WOOSH)/i.test(s);
  }

  function _injectSuggestion() {
    const ta = $('text-editor-ta');
    if (!ta || ta._proHooked) return;
    ta._proHooked = true;
    ta.addEventListener('input', () => {
      const line = (ta.value || '').split('\n')[0];
      if (_looksLikeSfx(line) && typeof _ts !== 'undefined' && _ts.font !== 'Bangers') {
        _showSuggChip(ta);
      } else if (_suggChip) {
        _suggChip.remove(); _suggChip = null;
      }
    });
  }

  function _showSuggChip(ta) {
    if (_suggChip) return;
    _suggChip = document.createElement('button');
    _suggChip.id = 'pro-sugg-chip';
    _suggChip.textContent = '💥 Style onomatopée ?';
    _suggChip.addEventListener('mousedown', e => {
      e.preventDefault();
      if (typeof selectFont === 'function') selectFont('Bangers');
      const sizeInput = $('tp-size'); if (sizeInput) { sizeInput.value = 130; if (typeof updateTextState === 'function') updateTextState(); }
      _suggChip.remove(); _suggChip = null;
    });
    document.body.appendChild(_suggChip);
    const r = ta.getBoundingClientRect();
    _suggChip.style.left = r.left + 'px';
    _suggChip.style.top = (r.top - 34) + 'px';
  }

  // Re-hook the suggestion whenever the text editor opens (it's re-created)
  const _origActivatePlacement = window.activateTextPlacement;
  if (typeof _origActivatePlacement === 'function') {
    window.activateTextPlacement = function () {
      const r = _origActivatePlacement.apply(this, arguments);
      setTimeout(_injectSuggestion, 50);
      return r;
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // WATERMARK toolbar button + styles + init
  // ═════════════════════════════════════════════════════════════════════════

  function _injectWatermarkButton() {
    const bar = $('tool-toolbar');
    if (!bar || $('btn-watermark-tool')) return;
    const div = document.createElement('div');
    div.className = 'tool-divider';
    bar.appendChild(div);
    const b = document.createElement('button');
    b.className = 'tool-btn';
    b.id = 'btn-watermark-tool';
    b.innerHTML = '🏷 Logo';
    b.title = 'Watermark / logo persistant sur toutes les scènes et dans l\'export';
    b.addEventListener('click', () => _openWmPop(b));
    bar.appendChild(b);
  }

  function _injectStyles() {
    const css = `
#pro-export-extra .pro-plat-row, #pro-export-extra .pro-fps-row { display:flex; gap:4px; flex-wrap:wrap; }
#pro-export-extra .pro-plat, #pro-export-extra .pro-fps {
  flex:1; min-width:44px; border:1px solid var(--border); background:var(--panel); color:var(--text);
  border-radius:6px; padding:6px 4px; font-size:11px; font-weight:600; cursor:pointer;
}
#pro-export-extra .pro-plat:hover, #pro-export-extra .pro-fps:hover { border-color:var(--accent); }
#pro-export-extra .pro-fps.on { background:var(--accent); color:#fff; border-color:var(--accent); }
#ink-watermark { position:absolute; z-index:55; transform:translate(-50%,-50%); cursor:grab; pointer-events:auto; user-select:none; }
#ink-watermark:active { cursor:grabbing; }
#ink-wm-pop {
  position:fixed; z-index:4000; width:236px; background:#fff; border:1px solid rgba(0,0,0,0.18);
  border-radius:10px; padding:11px; box-shadow:0 10px 32px rgba(0,0,0,0.22);
  display:flex; flex-direction:column; gap:8px; font-size:11px; color:#333;
}
#ink-wm-pop .wmp-row { display:flex; gap:6px; }
#ink-wm-pop .wmp-row button { flex:1; border:1px solid rgba(0,0,0,0.18); background:#fff; border-radius:6px; padding:6px; cursor:pointer; font-size:11px; }
#ink-wm-pop .wmp-row button#wm-clear { flex:0 0 30px; }
#ink-wm-pop .wmp-ctl { display:flex; align-items:center; gap:6px; }
#ink-wm-pop .wmp-ctl input[type="range"] { flex:1; }
#ink-wm-pop .wmp-hint { font-size:9px; color:#888; line-height:1.5; }
#pro-sugg-chip {
  position:fixed; z-index:4000; border:none; background:var(--accent2,#6c63ff); color:#fff;
  border-radius:999px; padding:5px 11px; font-size:11px; font-weight:700; cursor:pointer;
  box-shadow:0 4px 14px rgba(0,0,0,0.2);
}
`;
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  // Allow SVG in the image import picker
  function _allowSvg() {
    const fi = $('file-input');
    if (fi && !/svg/.test(fi.accept)) fi.accept = 'image/*,.svg';
  }

  // Export banner controls are built when the banner is created; the banner
  // exists in the DOM at load, so inject now and also on open.
  const _origOpenExport = window.openExportBanner;
  if (typeof _origOpenExport === 'function') {
    window.openExportBanner = function () {
      const r = _origOpenExport.apply(this, arguments);
      _injectExportControls();
      return r;
    };
  }
  const _origOpenProjects = window.openProjectsModal;
  if (typeof _origOpenProjects === 'function') {
    window.openProjectsModal = function () {
      const r = _origOpenProjects.apply(this, arguments);
      setTimeout(_injectProjectSearch, 30);
      return r;
    };
  }

  _injectStyles();
  _allowSvg();
  _injectExportControls();
  _injectFontImport();
  _injectWatermarkButton();
  _injectProjectSearch();
  _injectCheckpointButton();
  _wmLoad();
  _wmSyncOverlay();
})();
