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

  function importProjectFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        if (!payload || payload.app !== 'inkstudio' || !payload.state) {
          showToast('⚠️ Not a valid InkStudio project file', null, 3500);
          return;
        }
        if (!db) { showToast('⚠️ Storage unavailable', null, 3000); return; }
        const project = {
          name: payload.name || 'Imported Project',
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
          state: payload.state,
        };
        const tx = db.transaction(['projects'], 'readwrite');
        const store = tx.objectStore('projects');
        const req = store.add(project);
        req.onsuccess = () => {
          loadProject(req.result);
          if (typeof refreshProjectsList === 'function') refreshProjectsList();
          showToast(`Imported "${project.name}"`);
        };
        req.onerror = () => showToast('⚠️ Could not store imported project', null, 3500);
      } catch (err) {
        console.error('Project import failed:', err);
        showToast('⚠️ Could not read that project file', null, 3500);
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

  window.InkExtras = { exportProjectFile, importProjectFile };

  _injectProjectButtons();
})();
