// ═══════════════════════════════════════════════════════════════════════════
// InkStudio — VOICE-OVER SYSTEM
// Import a narration track (mp3/wav/ogg/m4a), see its waveform under the
// scene strip, and pin scenes to moments of the audio. During "Play all"
// and video export the audio is the master clock: each pinned scene starts
// exactly when the voice reaches its marker, so what you say and what gets
// drawn stay matched. The track is muxed into both WebM and MP4 exports.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  let actx = null;            // AudioContext (lazy)
  let buffer = null;          // decoded AudioBuffer
  let fileName = null;
  let dataURL = null;         // persisted copy of the file

  // Background music (separate looping track, mixed under the voice)
  const music = { buffer: null, dataURL: null, fileName: null, volume: 0.25, duck: true };
  let musicSrc = null, duckGain = null, volGain = null;
  let _speechCache = null;    // [[t0,t1],…] speech intervals of the voice track

  // Playback
  let srcNode = null;
  let playingSince = null;    // actx.currentTime at start, null = stopped
  let previewMode = false;
  let exportDest = null;      // MediaStreamAudioDestinationNode for WebM export

  // UI
  let waveCanvas = null, waveWrap = null, rowEl = null;
  let playheadEl = null, playheadRaf = null;

  const _fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function _ctx() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    return actx;
  }

  // ── Import / decode ───────────────────────────────────────────────────────

  async function importFile(file) {
    try {
      const url = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.readAsDataURL(file);
      });
      const ab = await file.arrayBuffer();
      buffer = await _ctx().decodeAudioData(ab);
      dataURL = url;
      fileName = file.name;
      _speechCache = null;
      _renderRow();
      showToast(`Voice-over loaded — ${_fmt(buffer.duration)}. Click the waveform to pin the current scene.`, null, 4500);
      scheduleAutoSave();
    } catch (err) {
      console.error('Voice-over import failed:', err);
      showToast('⚠️ Could not read that audio file', null, 3500);
    }
  }

  function clearAudio() {
    if (buffer && !confirm('Remove the voice-over track? Scene markers will be kept.')) return;
    stopPlayback();
    buffer = null; fileName = null; dataURL = null;
    _speechCache = null;
    _renderRow();
    scheduleAutoSave();
  }

  // ── Playback / master clock ───────────────────────────────────────────────

  async function startPlayback(opts = {}) {
    stopPlayback();
    if (!buffer && !music.buffer) return;
    const c = _ctx();
    if (c.state === 'suspended') { try { await c.resume(); } catch (e) {} }
    const offset = Math.max(0, Math.min(buffer ? duration() : Infinity, opts.offset || 0));
    if (buffer) {
      srcNode = c.createBufferSource();
      srcNode.buffer = buffer;
      srcNode.connect(c.destination);
      if (opts.forExport && exportDest) srcNode.connect(exportDest);
      srcNode.onended = () => { /* time() is clamped to duration */ };
      srcNode.start(0, offset);
    }
    _startMusic(offset, !!opts.forExport);
    playingSince = c.currentTime - offset; // time() = position on the track
    previewMode = !!opts.preview;
    _startPlayhead();
    _syncPreviewBtn();
  }

  function stopPlayback() {
    if (srcNode) { try { srcNode.stop(); srcNode.disconnect(); } catch (e) {} srcNode = null; }
    _stopMusic();
    playingSince = null;
    previewMode = false;
    _stopPlayhead();
    _syncPreviewBtn();
  }

  // ── Background music playback ─────────────────────────────────────────────

  const DUCK_LEVEL = 0.3, DUCK_ATTACK = 0.12;

  // Speech intervals of the voice track (for ducking the music underneath)
  function _speechIntervals() {
    if (!buffer) return [];
    if (_speechCache) return _speechCache;
    const data = buffer.getChannelData(0);
    const sr = buffer.sampleRate;
    const win = Math.round(sr * 0.05);
    const rms = [];
    for (let o = 0; o + win <= data.length; o += win) {
      let sum = 0;
      for (let i = o; i < o + win; i += 4) sum += data[i] * data[i];
      rms.push(Math.sqrt(sum / (win / 4)));
    }
    const peak = Math.max(...rms, 1e-6);
    const thr = Math.max(0.008, peak * 0.08);
    const raw = [];
    let start = null;
    for (let i = 0; i < rms.length; i++) {
      if (rms[i] >= thr) { if (start == null) start = i * 0.05; }
      else if (start != null) { raw.push([start, i * 0.05]); start = null; }
    }
    if (start != null) raw.push([start, rms.length * 0.05]);
    // Merge gaps < 0.5 s so the music doesn't pump between words
    const merged = [];
    raw.forEach(iv => {
      if (merged.length && iv[0] - merged[merged.length - 1][1] < 0.5) merged[merged.length - 1][1] = iv[1];
      else merged.push([...iv]);
    });
    _speechCache = merged.filter(([a, b]) => b - a > 0.15);
    return _speechCache;
  }

  function _scheduleDucking(gainParam, ctxTimeAt0, offset) {
    _speechIntervals().forEach(([t0, t1]) => {
      const s = t0 - offset, e = t1 - offset;
      if (e <= 0) return;
      gainParam.setTargetAtTime(DUCK_LEVEL, ctxTimeAt0 + Math.max(0, s), DUCK_ATTACK);
      gainParam.setTargetAtTime(1, ctxTimeAt0 + Math.max(0, e), DUCK_ATTACK);
    });
  }

  function _startMusic(offset, forExport) {
    if (!music.buffer) return;
    const c = _ctx();
    musicSrc = c.createBufferSource();
    musicSrc.buffer = music.buffer;
    musicSrc.loop = true;
    duckGain = c.createGain();
    volGain = c.createGain();
    duckGain.gain.value = 1;
    volGain.gain.value = music.volume;
    musicSrc.connect(duckGain);
    duckGain.connect(volGain);
    volGain.connect(c.destination);
    if (forExport && exportDest) volGain.connect(exportDest);
    if (music.duck && buffer) _scheduleDucking(duckGain.gain, c.currentTime, offset);
    musicSrc.start(0, offset % music.buffer.duration);
  }

  function _stopMusic() {
    if (musicSrc) { try { musicSrc.stop(); musicSrc.disconnect(); } catch (e) {} musicSrc = null; }
    duckGain = null; volGain = null;
  }

  async function importMusicFile(file) {
    try {
      const url = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.readAsDataURL(file);
      });
      const ab = await file.arrayBuffer();
      music.buffer = await _ctx().decodeAudioData(ab);
      music.dataURL = url;
      music.fileName = file.name;
      _renderMusicRow();
      showToast(`Musique chargée — ${_fmt(music.buffer.duration)}, en boucle sous la voix 🎵`, null, 4000);
      scheduleAutoSave();
    } catch (err) {
      console.error('Music import failed:', err);
      showToast('⚠️ Could not read that audio file', null, 3500);
    }
  }

  function clearMusic() {
    if (music.buffer && !confirm('Retirer la musique de fond ?')) return;
    _stopMusic();
    music.buffer = null; music.dataURL = null; music.fileName = null;
    _renderMusicRow();
    scheduleAutoSave();
  }

  const hasAudio = () => !!(buffer || music.buffer);
  const duration = () => buffer ? buffer.duration : 0;
  const isPlaying = () => playingSince != null;

  function time() {
    if (playingSince == null || !actx) return 0;
    return Math.min(duration(), actx.currentTime - playingSince);
  }

  function waitUntil(t, cancelled) {
    return new Promise(resolve => {
      const iv = setInterval(() => {
        if ((cancelled && cancelled()) || playingSince == null || time() >= t || time() >= duration()) {
          clearInterval(iv); resolve();
        }
      }, 40);
    });
  }

  function waitUntilEnd(cancelled) {
    return waitUntil(Infinity, cancelled);
  }

  // ── WebM export stream ────────────────────────────────────────────────────

  function createExportStream() {
    if (!buffer && !music.buffer) return null;
    exportDest = _ctx().createMediaStreamDestination();
    return exportDest.stream;
  }

  // ── MP4 export: AAC encode into mp4-muxer ─────────────────────────────────

  const channels = () => music.buffer ? 2 : (buffer ? Math.min(2, buffer.numberOfChannels) : 2);
  const sampleRate = () => buffer ? buffer.sampleRate : (music.buffer ? music.buffer.sampleRate : 44100);

  // Offline mix of voice + looping music (with ducking), trimmed to the video
  async function _mixdownBuffer(durationSec) {
    const sr = sampleRate();
    const ch = channels();
    const len = Math.max(1, Math.ceil(durationSec * sr));
    const oc = new OfflineAudioContext(ch, len, sr);
    if (buffer) {
      const s = oc.createBufferSource();
      s.buffer = buffer;
      s.connect(oc.destination);
      s.start(0);
    }
    if (music.buffer) {
      const s = oc.createBufferSource();
      s.buffer = music.buffer;
      s.loop = true;
      const dg = oc.createGain(), vg = oc.createGain();
      dg.gain.value = 1;
      vg.gain.value = music.volume;
      if (music.duck && buffer) _scheduleDucking(dg.gain, 0, 0);
      s.connect(dg); dg.connect(vg); vg.connect(oc.destination);
      s.start(0);
    }
    return oc.startRendering();
  }

  async function encodeAacInto(muxer, durationSec) {
    if (!buffer && !music.buffer) return;
    const mixed = await _mixdownBuffer(durationSec);
    const sr = mixed.sampleRate;
    const ch = mixed.numberOfChannels;
    const cfg = { codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: ch, bitrate: 128000 };

    const support = await AudioEncoder.isConfigSupported(cfg);
    if (!support.supported) throw new Error('AAC encoding not supported by this browser');

    let encErr = null;
    const enc = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: e => { encErr = e; },
    });
    enc.configure(cfg);

    const totalFrames = mixed.length;
    const CHUNK = 16384;
    for (let off = 0; off < totalFrames; off += CHUNK) {
      const n = Math.min(CHUNK, totalFrames - off);
      const planar = new Float32Array(n * ch);
      for (let c = 0; c < ch; c++) {
        const src = mixed.getChannelData(c).subarray(off, off + n);
        planar.set(src, c * n);
      }
      enc.encode(new AudioData({
        format: 'f32-planar',
        sampleRate: sr,
        numberOfFrames: n,
        numberOfChannels: ch,
        timestamp: Math.round((off / sr) * 1_000_000),
        data: planar,
      }));
      if (encErr) throw encErr;
      // Yield so the UI/progress stays responsive on long tracks
      if ((off / CHUNK) % 16 === 15) await new Promise(r => setTimeout(r, 0));
    }
    await enc.flush();
    enc.close();
    if (encErr) throw encErr;
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  function serialize() {
    if (!dataURL && !music.dataURL) return null;
    return {
      fileName, dataURL,
      music: music.dataURL
        ? { fileName: music.fileName, dataURL: music.dataURL, volume: music.volume, duck: music.duck }
        : null,
    };
  }

  async function onProjectLoaded(savedState) {
    stopPlayback();
    const vo = savedState && savedState.voiceover;
    _speechCache = null;
    if (vo && vo.dataURL) {
      try {
        const ab = await (await fetch(vo.dataURL)).arrayBuffer();
        buffer = await _ctx().decodeAudioData(ab);
        dataURL = vo.dataURL;
        fileName = vo.fileName || 'voice-over';
      } catch (err) {
        console.error('Voice-over restore failed:', err);
        buffer = null; dataURL = null; fileName = null;
      }
    } else {
      buffer = null; dataURL = null; fileName = null;
    }
    const m = vo && vo.music;
    if (m && m.dataURL) {
      try {
        const ab = await (await fetch(m.dataURL)).arrayBuffer();
        music.buffer = await _ctx().decodeAudioData(ab);
        music.dataURL = m.dataURL;
        music.fileName = m.fileName || 'music';
        music.volume = (typeof m.volume === 'number') ? m.volume : 0.25;
        music.duck = m.duck !== false;
      } catch (err) {
        console.error('Music restore failed:', err);
        music.buffer = null; music.dataURL = null; music.fileName = null;
      }
    } else {
      music.buffer = null; music.dataURL = null; music.fileName = null;
      music.volume = 0.25; music.duck = true;
    }
    _renderRow();
    _renderMusicRow();
  }

  // ── Waveform + markers UI ─────────────────────────────────────────────────

  function _injectStyles() {
    const css = `
#vo-row { display: flex; align-items: center; gap: 10px; }
#vo-row .ss-title { align-self: center; }
.vo-wave-wrap {
  position: relative; flex: 1; min-width: 0; height: 44px;
  border: 1px solid rgba(0,0,0,0.14); border-radius: 6px; background: #fff; overflow: hidden;
  cursor: crosshair;
}
.vo-wave-wrap.empty { display: flex; align-items: center; justify-content: center;
  color: #999; font-size: 11px; cursor: default; background: rgba(255,255,255,0.5); }
.vo-wave-wrap canvas { display: block; width: 100%; height: 100%; }
.vo-playhead {
  position: absolute; top: 0; bottom: 0; width: 2px; background: var(--accent2);
  pointer-events: none; display: none;
}
.vo-pin {
  position: absolute; top: 0; bottom: 0; width: 14px; margin-left: -7px; cursor: ew-resize; z-index: 2;
}
.vo-pin::before {
  content: ''; position: absolute; left: 6px; top: 0; bottom: 0; width: 2px; background: #16a34a;
}
.vo-pin-label {
  position: absolute; top: 2px; left: 8px; background: #16a34a; color: #fff;
  font-size: 9px; font-weight: 700; border-radius: 3px; padding: 0 4px; white-space: nowrap;
}
.vo-pin:hover .vo-pin-label { background: #15803d; }
.vo-meta { font-size: 10px; color: #666; flex-shrink: 0; max-width: 130px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vo-seg {
  position: absolute; top: 0; bottom: 0; pointer-events: none; z-index: 1;
  border-left: 1px solid rgba(0,0,0,0.05);
}
.vo-seg.overrun {
  background-image: repeating-linear-gradient(135deg, rgba(220,38,38,0.22) 0 6px, transparent 6px 12px) !important;
}
.vo-seg-label {
  position: absolute; bottom: 2px; left: 3px; font-size: 8px; font-weight: 700;
  color: rgba(0,0,0,0.45); pointer-events: none;
}
`;
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  function _drawWave() {
    if (!waveCanvas || !buffer) return;
    const w = waveCanvas.clientWidth || 600;
    const h = waveCanvas.clientHeight || 44;
    waveCanvas.width = w * 2; waveCanvas.height = h * 2; // retina-ish
    const g = waveCanvas.getContext('2d');
    g.scale(2, 2);
    g.clearRect(0, 0, w, h);
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / w));
    g.fillStyle = 'rgba(26,26,26,0.55)';
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1;
      const s0 = x * step, s1 = Math.min(data.length, s0 + step);
      for (let i = s0; i < s1; i += Math.max(1, Math.floor(step / 20))) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const y0 = (1 - max) * 0.5 * h, y1 = (1 - min) * 0.5 * h;
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  }

  function _xToTime(clientX) {
    const r = waveWrap.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return f * duration();
  }

  function _renderPins() {
    if (!waveWrap || !buffer) return;
    waveWrap.querySelectorAll('.vo-pin, .vo-seg').forEach(el => el.remove());
    if (!window.SceneManager) return;
    const scenes = SceneManager.getScenes();
    const dur = duration();

    // ── Colored segment bands: from each pinned scene to the next pin ──
    scenes.forEach((s, i) => {
      if (s.audioStart == null) return;
      let end = dur;
      for (let j = i + 1; j < scenes.length; j++) {
        if (scenes[j].audioStart != null) { end = scenes[j].audioStart; break; }
      }
      if (end <= s.audioStart) return;
      const seg = document.createElement('div');
      const col = SceneManager.colorFor(i);
      const slot = end - s.audioStart;
      const overrun = s._lastDur != null && s._lastDur > slot + 0.05;
      seg.className = 'vo-seg' + (overrun ? ' overrun' : '');
      seg.style.left = `${(s.audioStart / dur) * 100}%`;
      seg.style.width = `${(slot / dur) * 100}%`;
      seg.style.background = col + '2e'; // ~18% alpha
      seg.innerHTML = `<div class="vo-seg-label" style="color:${col}">${s.name}${overrun ? ` ⚠ ${s._lastDur.toFixed(1)}s > ${slot.toFixed(1)}s` : (s._lastDur != null ? ` · ${s._lastDur.toFixed(1)}s` : '')}</div>`;
      if (overrun) seg.title = `"${s.name}" takes ~${s._lastDur.toFixed(1)}s to draw but only has ${slot.toFixed(1)}s before the next scene — it will be cut short. Increase its Reveal speed or move the next pin.`;
      waveWrap.appendChild(seg);
    });

    // ── Draggable pins ──
    scenes.forEach((s, i) => {
      if (s.audioStart == null) return;
      const pin = document.createElement('div');
      pin.className = 'vo-pin';
      pin.style.left = `${(s.audioStart / dur) * 100}%`;
      pin.title = `${s.name} starts here — drag to move, click to listen, double-click to unpin`;
      const col = SceneManager.colorFor(i);
      pin.innerHTML = `<div class="vo-pin-label" style="background:${col}">${i + 1}</div>`;
      pin.querySelector('.vo-pin-label').style.background = col;
      pin.style.setProperty('--pin-col', col);

      pin.addEventListener('dblclick', e => {
        e.stopPropagation();
        s.audioStart = null;
        _renderPins(); SceneManager.renderStrip(); scheduleAutoSave();
      });
      pin.addEventListener('mousedown', e => {
        e.preventDefault(); e.stopPropagation();
        let moved = false;
        const startX = e.clientX;
        const move = ev => {
          if (Math.abs(ev.clientX - startX) > 3) moved = true;
          if (!moved) return;
          s.audioStart = Math.round(_xToTime(ev.clientX) * 10) / 10;
          pin.style.left = `${(s.audioStart / dur) * 100}%`;
          pin.querySelector('.vo-pin-label').textContent = `${i + 1} · ${s.audioStart.toFixed(1)}s`;
        };
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          if (moved) { _renderPins(); SceneManager.renderStrip(); scheduleAutoSave(); }
          else startPlayback({ preview: true, offset: s.audioStart }); // simple click = listen from here
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
      waveWrap.appendChild(pin);
    });
  }

  // ── Auto-pins: put scene markers on detected speech pauses ────────────────

  function autoPins() {
    if (!buffer || !window.SceneManager) return;
    const scenes = SceneManager.getScenes();
    const n = scenes.length;
    const dur = duration();
    if (n < 2) { showToast('Add more scenes first — auto-sync places one marker per scene'); return; }

    // RMS over 50 ms windows on channel 0
    const data = buffer.getChannelData(0);
    const sr = buffer.sampleRate;
    const win = Math.round(sr * 0.05);
    const rms = [];
    for (let o = 0; o + win <= data.length; o += win) {
      let sum = 0;
      for (let i = o; i < o + win; i += 4) sum += data[i] * data[i];
      rms.push(Math.sqrt(sum / (win / 4)));
    }
    const peak = Math.max(...rms, 1e-6);
    const thr = Math.max(0.008, peak * 0.08);

    // Silent runs ≥ 250 ms, away from the very start/end
    const silences = [];
    let runStart = null;
    for (let i = 0; i < rms.length; i++) {
      if (rms[i] < thr) { if (runStart == null) runStart = i; }
      else if (runStart != null) {
        const len = (i - runStart) * 0.05;
        const center = (runStart + (i - runStart) / 2) * 0.05;
        if (len >= 0.25 && center > 0.6 && center < dur - 0.6) silences.push({ center, len });
        runStart = null;
      }
    }

    let markers;
    if (silences.length >= n - 1) {
      // Longest pauses = most likely idea boundaries
      markers = silences.sort((a, b) => b.len - a.len).slice(0, n - 1)
        .map(s => s.center).sort((a, b) => a - b);
      showToast(`Auto-sync: ${n - 1} scene change${n > 2 ? 's' : ''} placed on speech pauses`);
    } else {
      markers = Array.from({ length: n - 1 }, (_, i) => (dur * (i + 1)) / n);
      showToast('Not enough clear pauses found — scenes spread evenly instead', null, 4000);
    }
    scenes[0].audioStart = 0;
    markers.forEach((t, i) => { scenes[i + 1].audioStart = Math.round(t * 10) / 10; });
    _renderPins();
    SceneManager.renderStrip();
    scheduleAutoSave();
  }

  function _startPlayhead() {
    if (!playheadEl) return;
    playheadEl.style.display = 'block';
    const tick = () => {
      if (playingSince == null) { _stopPlayhead(); return; }
      playheadEl.style.left = `${(time() / Math.max(0.001, duration())) * 100}%`;
      playheadRaf = requestAnimationFrame(tick);
    };
    playheadRaf = requestAnimationFrame(tick);
  }

  function _stopPlayhead() {
    if (playheadRaf) cancelAnimationFrame(playheadRaf);
    playheadRaf = null;
    if (playheadEl) playheadEl.style.display = 'none';
  }

  function _syncPreviewBtn() {
    const b = document.getElementById('vo-preview-btn');
    if (b) b.textContent = (isPlaying() && previewMode) ? '■' : '▶';
  }

  function _renderRow() {
    const strip = document.getElementById('scene-strip');
    if (!strip) return;
    if (!rowEl) {
      rowEl = document.createElement('div');
      rowEl.className = 'ss-row';
      rowEl.id = 'vo-row';
      strip.appendChild(rowEl);
    }
    rowEl.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'ss-title';
    title.textContent = 'Voice';
    rowEl.appendChild(title);

    const importBtn = document.createElement('button');
    importBtn.className = 'ss-btn';
    importBtn.innerHTML = '🎙 ' + (buffer ? 'Replace' : 'Import voice-over');
    importBtn.title = 'Load a narration audio file (mp3, wav, ogg, m4a…)';
    importBtn.addEventListener('click', () => fileInput.click());
    rowEl.appendChild(importBtn);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) importFile(fileInput.files[0]);
      fileInput.value = '';
    });
    rowEl.appendChild(fileInput);

    if (buffer) {
      const preview = document.createElement('button');
      preview.className = 'ss-btn';
      preview.id = 'vo-preview-btn';
      preview.title = 'Preview the voice-over track';
      preview.textContent = '▶';
      preview.addEventListener('click', () => {
        (isPlaying() && previewMode) ? stopPlayback() : startPlayback({ preview: true });
      });
      rowEl.appendChild(preview);

      const auto = document.createElement('button');
      auto.className = 'ss-btn';
      auto.textContent = '✨ Auto-sync';
      auto.title = 'Detect pauses in the narration and place one scene marker per pause';
      auto.addEventListener('click', autoPins);
      rowEl.appendChild(auto);
    }

    waveWrap = document.createElement('div');
    waveWrap.className = 'vo-wave-wrap' + (buffer ? '' : ' empty');
    if (buffer) {
      waveCanvas = document.createElement('canvas');
      waveWrap.appendChild(waveCanvas);
      playheadEl = document.createElement('div');
      playheadEl.className = 'vo-playhead';
      waveWrap.appendChild(playheadEl);
      waveWrap.title = 'Click: pin the current scene here · Shift+click: listen from here · click a pin: listen · double-click a pin: unpin';
      waveWrap.addEventListener('click', e => {
        if (e.target.closest('.vo-pin')) return;
        if (!window.SceneManager) return;
        const t = Math.round(_xToTime(e.clientX) * 10) / 10;
        if (e.shiftKey) { startPlayback({ preview: true, offset: t }); return; }
        const scenes = SceneManager.getScenes();
        const s = scenes[SceneManager.currentIndex()];
        if (!s) return;
        s.audioStart = t;
        _renderPins();
        SceneManager.renderStrip();
        scheduleAutoSave();
        showToast(`"${s.name}" pinned at ${t.toFixed(1)}s`);
      });
    } else {
      waveWrap.textContent = 'No voice-over — import one to sync scenes with your narration';
    }
    rowEl.appendChild(waveWrap);

    const meta = document.createElement('div');
    meta.className = 'vo-meta';
    meta.textContent = buffer ? `${fileName} · ${_fmt(duration())}` : '';
    rowEl.appendChild(meta);

    if (buffer) {
      const clear = document.createElement('button');
      clear.className = 'ss-btn';
      clear.textContent = '✕';
      clear.title = 'Remove voice-over';
      clear.addEventListener('click', clearAudio);
      rowEl.appendChild(clear);
    }

    if (buffer) {
      requestAnimationFrame(() => { _drawWave(); _renderPins(); });
    }
    if (typeof fitCanvas === 'function') setTimeout(fitCanvas, 0);
  }

  // ── Background music row ──────────────────────────────────────────────────

  let musicRowEl = null;

  function _renderMusicRow() {
    const strip = document.getElementById('scene-strip');
    if (!strip) return;
    if (!musicRowEl) {
      musicRowEl = document.createElement('div');
      musicRowEl.className = 'ss-row';
      musicRowEl.id = 'music-row';
      strip.appendChild(musicRowEl);
    }
    musicRowEl.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'ss-title';
    title.textContent = 'Music';
    musicRowEl.appendChild(title);

    const importBtn = document.createElement('button');
    importBtn.className = 'ss-btn';
    importBtn.innerHTML = '🎵 ' + (music.buffer ? 'Remplacer' : 'Ajouter une musique');
    importBtn.title = 'Musique de fond en boucle, mixée sous la voix off dans les exports';
    importBtn.addEventListener('click', () => fileInput.click());
    musicRowEl.appendChild(importBtn);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) importMusicFile(fileInput.files[0]);
      fileInput.value = '';
    });
    musicRowEl.appendChild(fileInput);

    if (music.buffer) {
      const volWrap = document.createElement('label');
      volWrap.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:10px;color:#555;flex-shrink:0;';
      volWrap.title = 'Volume de la musique';
      volWrap.innerHTML = `🔉 <input type="range" min="0" max="100" step="1" value="${Math.round(music.volume * 100)}" style="width:110px;"> <span style="min-width:30px;font-variant-numeric:tabular-nums;">${Math.round(music.volume * 100)}%</span>`;
      const slider = volWrap.querySelector('input');
      const val = volWrap.querySelector('span');
      slider.addEventListener('input', () => {
        music.volume = slider.value / 100;
        val.textContent = `${slider.value}%`;
        if (volGain) volGain.gain.value = music.volume;
      });
      slider.addEventListener('change', scheduleAutoSave);
      musicRowEl.appendChild(volWrap);

      const duckWrap = document.createElement('label');
      duckWrap.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:10px;color:#555;flex-shrink:0;cursor:pointer;';
      duckWrap.title = 'Baisse automatiquement la musique pendant que la voix parle';
      duckWrap.innerHTML = `<input type="checkbox" ${music.duck ? 'checked' : ''}> Baisser sous la voix`;
      duckWrap.querySelector('input').addEventListener('change', e => {
        music.duck = e.target.checked;
        scheduleAutoSave();
      });
      musicRowEl.appendChild(duckWrap);

      const meta = document.createElement('div');
      meta.className = 'vo-meta';
      meta.style.flex = '1';
      meta.textContent = `${music.fileName} · ${_fmt(music.buffer.duration)} · en boucle`;
      musicRowEl.appendChild(meta);

      const clear = document.createElement('button');
      clear.className = 'ss-btn';
      clear.textContent = '✕';
      clear.title = 'Retirer la musique';
      clear.addEventListener('click', clearMusic);
      musicRowEl.appendChild(clear);
    } else {
      const hint = document.createElement('div');
      hint.className = 'vo-meta';
      hint.style.flex = '1';
      hint.textContent = 'Pas de musique de fond — ajoute un mp3 lofi/épique pour tes TikToks';
      musicRowEl.appendChild(hint);
    }
    if (typeof fitCanvas === 'function') setTimeout(fitCanvas, 0);
  }

  window.addEventListener('resize', () => { if (buffer) { _drawWave(); _renderPins(); } });

  // ── Public API ────────────────────────────────────────────────────────────

  window.AudioVO = {
    hasAudio, duration, time, isPlaying,
    startPlayback, stopPlayback,
    waitUntil, waitUntilEnd,
    createExportStream,
    channels, sampleRate, encodeAacInto,
    serialize, onProjectLoaded,
    importFile, autoPins,
    importMusicFile, clearMusic,
    hasMusic: () => !!music.buffer,
    onScenesChanged: () => { if (buffer) _renderPins(); },
  };

  // ── Init ──────────────────────────────────────────────────────────────────

  _injectStyles();
  _renderRow();
  _renderMusicRow();
})();
