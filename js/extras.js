// ═══════════════════════════════════════════════════════════════════════════
// InkStudio — EXTRAS
// Portable project files (.inkstudio.json with scenes + voice-over baked in),
// plus a few quality-of-life keyboard shortcuts.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── Portable project export/import ────────────────────────────────────────

  function _currentProjectName() {
    return document.getElementById('project-name-display')?.textContent || 'InkStudio Project';
  }

  function exportProjectFile() {
    try {
      if (window.SceneManager) SceneManager.captureCurrent();
      const payload = {
        app: 'inkstudio',
        version: 1,
        name: _currentProjectName(),
        exportedAt: new Date().toISOString(),
        state: {
          canvasW: state.canvasW,
          canvasH: state.canvasH,
          canvasBg: state.canvasBg,
          _currentRatio: window._currentRatio || _currentRatio,
          _currentRes: window._currentRes || _currentRes,
          animStyle: state.animStyle,
          hand: state.hand,
          zigzag: state.zigzag,
          outlineDetect: state.outlineDetect,
          outlineAlgorithm: state.outlineAlgorithm,
          outlineStrokeStyle: state.outlineStrokeStyle,
          colorStyle: state.colorStyle,
          scenes: window.SceneManager ? SceneManager.serialize() : null,
          sceneIndex: window.SceneManager ? SceneManager.currentIndex() : 0,
          voiceover: window.AudioVO ? AudioVO.serialize() : null,
          // Legacy field so older loaders still open the current scene
          layers: [],
          groups: state.groups || [],
          selectedLayerId: state.selectedLayerId,
        },
      };
      // Fill legacy layers from the current scene's serialized form
      const scenes = payload.state.scenes;
      if (scenes && scenes[payload.state.sceneIndex]) {
        payload.state.layers = scenes[payload.state.sceneIndex].layers || [];
      }

      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${payload.name.replace(/[^\w\- ]+/g, '').trim() || 'project'}.inkstudio.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Project file exported');
    } catch (err) {
      console.error('Project export failed:', err);
      showToast('⚠️ Project export failed', null, 3500);
    }
  }

  // ── Import validation: reject malformed / hostile project files ──────────
  // A shared .inkstudio.json is untrusted input, so we validate the shape and
  // clamp string lengths before it ever reaches the loader / IndexedDB.
  const MAX_STR = 4000;          // any single name/label
  const MAX_LAYERS_PER_SCENE = 500;
  const MAX_SCENES = 500;

  function _clampStr(v, fallback = '') {
    if (typeof v !== 'string') return fallback;
    return v.length > MAX_STR ? v.slice(0, MAX_STR) : v;
  }

  // Returns { ok:true, state } or { ok:false, error }
  function _validateProject(payload) {
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'fichier illisible' };
    if (payload.app !== 'inkstudio') return { ok: false, error: 'ce n\'est pas un projet InkStudio' };
    const st = payload.state;
    if (!st || typeof st !== 'object') return { ok: false, error: 'projet sans données' };

    // Canvas size must be sane numbers
    if (st.canvasW != null && (!Number.isFinite(st.canvasW) || st.canvasW <= 0 || st.canvasW > 8000)) return { ok: false, error: 'taille de canvas invalide' };
    if (st.canvasH != null && (!Number.isFinite(st.canvasH) || st.canvasH <= 0 || st.canvasH > 8000)) return { ok: false, error: 'taille de canvas invalide' };

    // Scenes: must be an array of the expected shape, within limits
    if (st.scenes != null) {
      if (!Array.isArray(st.scenes)) return { ok: false, error: 'liste de scènes invalide' };
      if (st.scenes.length > MAX_SCENES) return { ok: false, error: `trop de scènes (> ${MAX_SCENES})` };
      for (const sc of st.scenes) {
        if (!sc || typeof sc !== 'object') return { ok: false, error: 'scène corrompue' };
        sc.name = _clampStr(sc.name, 'Scene');
        const layers = sc.layers;
        if (layers != null) {
          if (!Array.isArray(layers)) return { ok: false, error: 'calques invalides' };
          if (layers.length > MAX_LAYERS_PER_SCENE) return { ok: false, error: `trop de calques (> ${MAX_LAYERS_PER_SCENE})` };
          for (const l of layers) {
            if (!l || typeof l !== 'object') return { ok: false, error: 'calque corrompu' };
            l.name = _clampStr(l.name, 'Layer');
            // Data URLs must actually be strings (they feed <img>.src / decode)
            if (l.imageDataURL != null && typeof l.imageDataURL !== 'string') return { ok: false, error: 'image de calque invalide' };
            if (l.gifSrc != null && typeof l.gifSrc !== 'string') return { ok: false, error: 'GIF de calque invalide' };
          }
        }
      }
    }
    // Voice-over data URLs, if present, must be strings
    const vo = st.voiceover;
    if (vo && typeof vo === 'object') {
      if (vo.dataURL != null && typeof vo.dataURL !== 'string') return { ok: false, error: 'voix off invalide' };
      if (vo.music && typeof vo.music === 'object' && vo.music.dataURL != null && typeof vo.music.dataURL !== 'string') return { ok: false, error: 'musique invalide' };
    }
    return { ok: true, state: st };
  }

  function importProjectFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        let payload;
        try { payload = JSON.parse(reader.result); }
        catch { showToast('⚠️ Fichier JSON illisible', null, 3500); return; }

        const check = _validateProject(payload);
        if (!check.ok) {
          showToast(`⚠️ Import refusé : ${check.error}`, null, 4000);
          return;
        }
        if (!db) { showToast('⚠️ Stockage indisponible', null, 3000); return; }
        const project = {
          name: _clampStr(payload.name, 'Imported Project') || 'Imported Project',
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
          state: check.state,
        };
        const tx = db.transaction(['projects'], 'readwrite');
        const store = tx.objectStore('projects');
        const req = store.add(project);
        req.onsuccess = () => {
          loadProject(req.result);
          if (typeof refreshProjectsList === 'function') refreshProjectsList();
          showToast(`Projet « ${project.name} » importé`);
        };
        req.onerror = () => showToast('⚠️ Impossible d\'enregistrer le projet importé', null, 3500);
      } catch (err) {
        console.error('Project import failed:', err);
        showToast('⚠️ Impossible de lire ce fichier projet', null, 3500);
      }
    };
    reader.readAsText(file);
  }

  // Inject buttons into the Projects modal action row
  function _injectProjectButtons() {
    const actions = document.querySelector('.projects-actions');
    if (!actions) return;

    const mk = (label, title, onClick) => {
      const b = document.createElement('button');
      b.className = 'projects-new-btn';
      b.style.opacity = '0.85';
      b.title = title;
      b.textContent = label;
      b.addEventListener('click', onClick);
      actions.appendChild(b);
      return b;
    };

    mk('⬇ Export file', 'Download the current project (scenes + voice-over) as a portable file', exportProjectFile);
    mk('⬆ Import file', 'Open a .inkstudio.json project file', () => fileInput.click());

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) importProjectFile(fileInput.files[0]);
      fileInput.value = '';
    });
    actions.appendChild(fileInput);
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || typing) return;

    // Ctrl+S — save now
    if (e.key === 's') {
      e.preventDefault();
      saveProject();
      showToast('Project saved');
    }
  });

  // ── Quick color presets next to the outline color pickers ────────────────

  const QUICK_COLORS = ['#000000', '#ffffff', '#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#64748b'];

  function _injectColorDots() {
    const style = document.createElement('style');
    style.textContent = `
.ink-color-dots { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 5px; }
.ink-color-dot {
  width: 14px; height: 14px; border-radius: 50%; cursor: pointer;
  border: 1px solid rgba(0,0,0,0.25); transition: transform .1s;
}
.ink-color-dot:hover { transform: scale(1.25); }
`;
    document.head.appendChild(style);

    ['of-outline-color', 'outlineonly-color', 'text-outline-color'].forEach(id => {
      const input = document.getElementById(id);
      if (!input) return;
      const row = document.createElement('div');
      row.className = 'ink-color-dots';
      QUICK_COLORS.forEach(c => {
        const dot = document.createElement('div');
        dot.className = 'ink-color-dot';
        dot.style.background = c;
        dot.title = c;
        dot.addEventListener('click', () => {
          if (input.disabled) return;
          input.value = c;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        row.appendChild(dot);
      });
      // Place the dots right below the input's row
      (input.closest('div') || input.parentElement).insertAdjacentElement('afterend', row);
    });
  }

  window.InkExtras = { exportProjectFile, importProjectFile };

  _injectProjectButtons();
  _injectColorDots();
})();
