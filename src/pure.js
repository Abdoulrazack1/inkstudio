// ═══════════════════════════════════════════════════════════════════════════
// InkStudio — PURE UTILITIES (no DOM, no globals)
// The first extracted, unit-tested module (audit §11 incremental modularity).
// UMD: attaches to window.PureUtils in the browser and exports in Node so the
// exact same code that ships is what the tests exercise.
// ═══════════════════════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.PureUtils = api;
    if (!root.escapeHtml) root.escapeHtml = api.escapeHtml; // shared XSS-safe escape
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Escape a user string before it touches innerHTML (stored-XSS guard).
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Auto-chunk mapping: tile count derived from a layer's duration (seconds).
  // ~10 chunks/second, clamped [6, 200]. Short drawings punchy, long ones fine.
  function autoChunkCount(seconds) {
    return Math.max(6, Math.min(200, Math.round(10 * (+seconds || 0))));
  }

  // Remap a timestamp onto a timeline where only `ranges` (kept intervals,
  // sorted, non-overlapping) survive — used by the voice silence-removal.
  function remapTime(t, ranges) {
    let acc = 0;
    for (const [a, b] of ranges) {
      if (t < a) return acc;             // t fell in a removed gap → next kept start
      if (t <= b) return acc + (t - a);  // t inside a kept range
      acc += (b - a);
    }
    return acc;                          // past the end
  }

  // Caption timestamp: SRT uses "HH:MM:SS,mmm", VTT uses "HH:MM:SS.mmm".
  function captionStamp(t, vtt) {
    t = Math.max(0, +t || 0);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
    const ms = Math.round((t - Math.floor(t)) * 1000);
    const p = (n, l) => String(n).padStart(l || 2, '0');
    return `${p(h)}:${p(m)}:${p(s)}${vtt ? '.' : ','}${p(ms, 3)}`;
  }

  function toSRT(cues) {
    const sorted = cues.slice().sort((a, b) => a.start - b.start);
    return sorted.map((c, i) =>
      `${i + 1}\n${captionStamp(c.start)} --> ${captionStamp(c.end)}\n${c.text}\n`).join('\n');
  }

  function toVTT(cues) {
    const sorted = cues.slice().sort((a, b) => a.start - b.start);
    return 'WEBVTT\n\n' + sorted.map(c =>
      `${captionStamp(c.start, true)} --> ${captionStamp(c.end, true)}\n${c.text}\n`).join('\n');
  }

  // Structural validation for imported .inkstudio.json project files.
  // Returns { ok:true } or { ok:false, error }.
  function validateProjectShape(payload, limits) {
    const L = Object.assign({ maxScenes: 500, maxLayers: 500, maxDim: 8000 }, limits || {});
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'fichier illisible' };
    if (payload.app !== 'inkstudio') return { ok: false, error: 'ce n\'est pas un projet InkStudio' };
    const st = payload.state;
    if (!st || typeof st !== 'object') return { ok: false, error: 'projet sans données' };
    if (st.canvasW != null && (!Number.isFinite(st.canvasW) || st.canvasW <= 0 || st.canvasW > L.maxDim)) return { ok: false, error: 'taille de canvas invalide' };
    if (st.canvasH != null && (!Number.isFinite(st.canvasH) || st.canvasH <= 0 || st.canvasH > L.maxDim)) return { ok: false, error: 'taille de canvas invalide' };
    if (st.scenes != null) {
      if (!Array.isArray(st.scenes)) return { ok: false, error: 'liste de scènes invalide' };
      if (st.scenes.length > L.maxScenes) return { ok: false, error: 'trop de scènes' };
      for (const sc of st.scenes) {
        if (!sc || typeof sc !== 'object') return { ok: false, error: 'scène corrompue' };
        if (sc.layers != null) {
          if (!Array.isArray(sc.layers)) return { ok: false, error: 'calques invalides' };
          if (sc.layers.length > L.maxLayers) return { ok: false, error: 'trop de calques' };
          for (const l of sc.layers) {
            if (!l || typeof l !== 'object') return { ok: false, error: 'calque corrompu' };
            if (l.imageDataURL != null && typeof l.imageDataURL !== 'string') return { ok: false, error: 'image de calque invalide' };
          }
        }
      }
    }
    return { ok: true };
  }

  return { escapeHtml, autoChunkCount, remapTime, captionStamp, toSRT, toVTT, validateProjectShape };
});
