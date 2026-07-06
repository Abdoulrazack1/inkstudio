// ═══════════════════════════════════════════════════════════════════════════
// InkStudio — SUBTITLES (captions)
// A subtitle track timed to the voice-over: add/edit cues, auto-segment them
// on detected speech bursts, preview them live, burn them into the exported
// video, and export .srt / .vtt. 100% local — automatic transcription (the
// text) is the only piece that would need a speech-to-text model; everything
// else (timing, editing, karaoke look, burn-in, SRT/VTT) works today.
// Shares the global scope (state, showToast, scheduleAutoSave, AudioVO…).
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => (window.escapeHtml || String)(s);

  let cues = [];          // [{start, end, text}]
  const opts = { on: true, size: 5.2, color: '#ffffff', box: true, upper: false };
  let rowEl = null, listEl = null, overlayEl = null, editing = false;

  const _fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const _clampNum = (v, d) => { const n = parseFloat(v); return isNaN(n) ? d : n; };

  // ── Persistence ───────────────────────────────────────────────────────────

  function serialize() {
    if (!cues.length) return null;
    return { cues: cues.map(c => ({ start: c.start, end: c.end, text: c.text })), opts: { ...opts } };
  }
  function onProjectLoaded(savedState) {
    const s = savedState && savedState.subtitles;
    cues = (s && Array.isArray(s.cues)) ? s.cues.map(c => ({
      start: +c.start || 0, end: +c.end || 0, text: String(c.text || '').slice(0, 500),
    })).filter(c => c.end > c.start).sort((a, b) => a.start - b.start) : [];
    if (s && s.opts) Object.assign(opts, s.opts);
    _renderRow();
  }

  // ── Cue helpers ───────────────────────────────────────────────────────────

  function _sort() { cues.sort((a, b) => a.start - b.start); }
  function _activeAt(t) { for (const c of cues) if (t >= c.start && t < c.end) return c; return null; }

  function addCueAtPlayhead() {
    if (!window.AudioVO || !AudioVO.hasAudio()) { showToast('Importe/enregistre d\'abord une voix off'); return; }
    const t = AudioVO.playheadTime();
    const dur = AudioVO.duration();
    const end = Math.min(dur, t + 2);
    cues.push({ start: Math.round(t * 10) / 10, end: Math.round(end * 10) / 10, text: 'Nouveau sous-titre' });
    _sort(); editing = true; _renderRow(); scheduleAutoSave();
  }

  function autoSegment() {
    if (!window.AudioVO || !AudioVO.hasAudio()) { showToast('Importe/enregistre d\'abord une voix off'); return; }
    const segs = AudioVO.speechSegments();
    if (!segs.length) { showToast('Aucune parole détectée'); return; }
    // Merge very short gaps so we don't get one cue per word
    const merged = [];
    segs.forEach(([a, b]) => {
      if (merged.length && a - merged[merged.length - 1][1] < 0.4) merged[merged.length - 1][1] = b;
      else merged.push([a, b]);
    });
    cues = merged.map(([a, b]) => ({ start: Math.round(a * 10) / 10, end: Math.round(b * 10) / 10, text: '' }));
    editing = true; _renderRow(); scheduleAutoSave();
    showToast(`${cues.length} sous-titres créés sur les phrases — écris le texte de chacun`, null, 4500);
  }

  function removeCue(i) { cues.splice(i, 1); _renderRow(); scheduleAutoSave(); }
  function clearAll() { if (cues.length && !confirm('Effacer tous les sous-titres ?')) return; cues = []; _renderRow(); scheduleAutoSave(); }

  // ── Burn-in rendering (export) + live preview ─────────────────────────────

  function _wrap(ctx, text, maxW) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  // Draw the cue active at time t into a canvas-sized context
  function _drawCue(ctx, W, H, t) {
    if (!opts.on) return;
    const c = _activeAt(t);
    if (!c || !c.text.trim()) return;
    const text = opts.upper ? c.text.toUpperCase() : c.text;
    const fs = Math.round(H * opts.size / 100);
    ctx.save();
    ctx.font = `700 ${fs}px "Bebas Neue","DM Sans",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const maxW = W * 0.86;
    const lines = _wrap(ctx, text, maxW);
    const lh = fs * 1.18;
    const totalH = lines.length * lh;
    let cy = H * 0.80 - totalH / 2 + lh / 2; // sit above the TikTok caption zone
    lines.forEach(line => {
      const w = ctx.measureText(line).width;
      if (opts.box) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        const padX = fs * 0.35, padY = fs * 0.14;
        _roundRect(ctx, W / 2 - w / 2 - padX, cy - lh / 2 - padY / 2, w + padX * 2, lh + padY, fs * 0.18);
        ctx.fill();
      }
      ctx.lineWidth = Math.max(2, fs * 0.14);
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineJoin = 'round';
      ctx.strokeText(line, W / 2, cy);
      ctx.fillStyle = opts.color;
      ctx.fillText(line, W / 2, cy);
      cy += lh;
    });
    ctx.restore();
  }
  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  // Public: called by the export composite each frame
  function drawBurn(ctx, W, H) {
    if (!opts.on || !cues.length) return;
    if (!window.AudioVO || !AudioVO.hasAudio()) return;
    _drawCue(ctx, W, H, AudioVO.time());
  }
  window.SubKit = { serialize, onProjectLoaded, drawBurn, count: () => cues.length };

  // Live preview overlay (HTML, over the canvas) during playback/scrub
  function _ensureOverlay() {
    const wrap = $('canvas-wrapper');
    if (!wrap) return;
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.id = 'ink-sub-overlay';
      wrap.appendChild(overlayEl);
    }
  }
  (function previewLoop() {
    requestAnimationFrame(previewLoop);
    if (!overlayEl) return;
    if (!opts.on || !cues.length || !window.AudioVO || !AudioVO.hasAudio()) { overlayEl.style.display = 'none'; return; }
    const t = AudioVO.isPlaying() ? AudioVO.time() : AudioVO.playheadTime();
    const c = _activeAt(t);
    if (c && c.text.trim()) {
      overlayEl.style.display = 'block';
      overlayEl.style.fontSize = 'clamp(11px, ' + (opts.size * 0.9) + 'cqh, 40px)';
      overlayEl.textContent = opts.upper ? c.text.toUpperCase() : c.text;
      overlayEl.style.color = opts.color;
      overlayEl.style.background = opts.box ? 'rgba(0,0,0,0.55)' : 'transparent';
    } else {
      overlayEl.style.display = 'none';
    }
  })();

  // ── SRT / VTT export ──────────────────────────────────────────────────────

  function _stamp(t, vtt) {
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
    const ms = Math.round((t - Math.floor(t)) * 1000);
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return `${p(h)}:${p(m)}:${p(s)}${vtt ? '.' : ','}${p(ms, 3)}`;
  }
  function _download(text, ext, mime) {
    const name = ($('project-name-display')?.textContent || 'inkstudio').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'inkstudio';
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${name}.${ext}`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportSRT() {
    if (!cues.length) { showToast('Aucun sous-titre'); return; }
    const out = window.PureUtils ? PureUtils.toSRT(cues)
      : cues.slice().sort((a, b) => a.start - b.start).map((c, i) => `${i + 1}\n${_stamp(c.start)} --> ${_stamp(c.end)}\n${c.text}\n`).join('\n');
    _download(out, 'srt', 'text/plain');
    showToast('Sous-titres exportés (.srt)');
  }
  function exportVTT() {
    if (!cues.length) { showToast('Aucun sous-titre'); return; }
    const out = window.PureUtils ? PureUtils.toVTT(cues)
      : 'WEBVTT\n\n' + cues.slice().sort((a, b) => a.start - b.start).map(c => `${_stamp(c.start, true)} --> ${_stamp(c.end, true)}\n${c.text}\n`).join('\n');
    _download(out, 'vtt', 'text/vtt');
    showToast('Sous-titres exportés (.vtt)');
  }

  // ── UI row (under the audio timeline in the scene strip) ──────────────────

  function _renderRow() {
    const strip = $('scene-strip');
    if (!strip) return;
    if (!rowEl) {
      rowEl = document.createElement('div');
      rowEl.className = 'ss-row';
      rowEl.id = 'sub-row';
      strip.appendChild(rowEl);
    }
    _ensureOverlay();
    rowEl.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'ss-title';
    title.textContent = 'Subs';
    rowEl.appendChild(title);

    const mk = (label, title2, fn) => {
      const b = document.createElement('button');
      b.className = 'ss-btn';
      b.textContent = label;
      b.title = title2;
      b.addEventListener('click', fn);
      rowEl.appendChild(b);
      return b;
    };
    mk('＋ Sous-titre', 'Ajouter un sous-titre à la position du playhead voix', addCueAtPlayhead);
    mk('✨ Auto', 'Créer un sous-titre vide par phrase détectée dans la voix — tu remplis le texte', autoSegment);
    const editBtn = mk(editing ? '▾ Éditer' : '▸ Éditer', 'Afficher/masquer la liste des sous-titres', () => { editing = !editing; _renderRow(); });
    editBtn.classList.toggle('running', editing);

    const onLbl = document.createElement('label');
    onLbl.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:10px;color:#555;flex-shrink:0;cursor:pointer;';
    onLbl.title = 'Incruster les sous-titres dans la vidéo exportée';
    onLbl.innerHTML = `<input type="checkbox" ${opts.on ? 'checked' : ''}> Incruster`;
    onLbl.querySelector('input').addEventListener('change', e => { opts.on = e.target.checked; scheduleAutoSave(); });
    rowEl.appendChild(onLbl);

    const upLbl = document.createElement('label');
    upLbl.style.cssText = onLbl.style.cssText;
    upLbl.title = 'Tout en MAJUSCULES (style TikTok)';
    upLbl.innerHTML = `<input type="checkbox" ${opts.upper ? 'checked' : ''}> MAJ`;
    upLbl.querySelector('input').addEventListener('change', e => { opts.upper = e.target.checked; scheduleAutoSave(); });
    rowEl.appendChild(upLbl);

    mk('⬇ SRT', 'Exporter les sous-titres en .srt', exportSRT);
    mk('⬇ VTT', 'Exporter les sous-titres en .vtt', exportVTT);

    const count = document.createElement('div');
    count.className = 'vo-meta';
    count.style.marginLeft = 'auto';
    count.textContent = cues.length ? `${cues.length} sous-titre${cues.length > 1 ? 's' : ''}` : '';
    rowEl.appendChild(count);

    if (cues.length) {
      const clr = document.createElement('button');
      clr.className = 'ss-btn'; clr.textContent = '✕'; clr.title = 'Tout effacer';
      clr.addEventListener('click', clearAll);
      rowEl.appendChild(clr);
    }

    // Editable list
    let list = $('sub-list');
    if (list) list.remove();
    if (editing && cues.length) {
      list = document.createElement('div');
      list.id = 'sub-list';
      _sort();
      list.innerHTML = cues.map((c, i) => `
        <div class="sub-item">
          <input type="number" step="0.1" min="0" value="${c.start}" data-i="${i}" data-k="start" title="Début (s)">
          <input type="number" step="0.1" min="0" value="${c.end}" data-i="${i}" data-k="end" title="Fin (s)">
          <input type="text" value="${esc(c.text)}" data-i="${i}" data-k="text" placeholder="Texte du sous-titre…">
          <button data-del="${i}" title="Supprimer">✕</button>
        </div>`).join('');
      list.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('change', () => {
          const i = +inp.dataset.i, k = inp.dataset.k;
          if (!cues[i]) return;
          cues[i][k] = (k === 'text') ? inp.value.slice(0, 500) : _clampNum(inp.value, cues[i][k]);
          scheduleAutoSave();
          if (k !== 'text') { _sort(); }
        });
      });
      list.querySelectorAll('button[data-del]').forEach(b => b.addEventListener('click', () => removeCue(+b.dataset.del)));
      rowEl.after(list);
    }

    if (typeof fitCanvas === 'function') setTimeout(fitCanvas, 0);
  }

  function _injectStyles() {
    const css = `
#ink-sub-overlay {
  position: absolute; left: 7%; right: 7%; bottom: 16%; z-index: 56; display: none;
  text-align: center; font-family: "Bebas Neue","DM Sans",sans-serif; font-weight: 700;
  letter-spacing: 0.01em; line-height: 1.15; padding: 4px 10px; border-radius: 8px;
  container-type: size; text-shadow: 0 2px 6px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9);
  pointer-events: none; word-wrap: break-word;
}
#sub-list {
  max-height: 132px; overflow-y: auto; margin: 2px 0 4px; padding: 6px 8px;
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
  display: flex; flex-direction: column; gap: 5px;
}
#sub-list .sub-item { display: flex; gap: 5px; align-items: center; }
#sub-list .sub-item input[type="number"] { width: 58px; }
#sub-list .sub-item input[type="text"] { flex: 1; min-width: 0; }
#sub-list .sub-item input { border: 1px solid var(--border-hi); border-radius: 5px; padding: 4px 6px; font-size: 11px; background: #fff; color: #1a1a1a; }
#sub-list .sub-item button { border: 1px solid var(--border-hi); background: #fff; border-radius: 5px; width: 24px; cursor: pointer; }
`;
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  _injectStyles();
  _renderRow();
})();
