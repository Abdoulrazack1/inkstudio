// ═══════════════════════════════════════════════════════════════════════════
// InkStudio — VOICE-OVER & AUDIO TIMELINE
// Import a narration track, edit it on a real timeline (zoomable waveform,
// time ruler, transport with pause/scrub, start/end trim, voice volume),
// pin scenes to moments of the audio, and lay a background music bed
// (volume, ducking under the voice, start offset, fade-in). During "Play
// all" and video export the audio is the master clock. Voice + music are
// muxed into both WebM and MP4 exports.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  let actx = null;            // AudioContext (lazy)
  let origBuffer = null;      // decoded full voice track
  let buffer = null;          // WORKING buffer (trimmed) — the app's timeline
  let fileName = null;
  let dataURL = null;         // persisted copy of the file
  let trimStart = 0;          // seconds on the ORIGINAL track
  let trimEnd = null;         // null = end of track
  let voiceVolume = 1;

  // Background music (separate looping track, mixed under the voice)
  const music = { buffer: null, dataURL: null, fileName: null, volume: 0.25, duck: true, start: 0, fadeIn: 0 };
  let musicSrc = null, duckGain = null, volGain = null;
  let _speechCache = null;    // [[t0,t1],…] speech intervals of the working voice

  // Playback
  let srcNode = null;
  let voiceGain = null;
  let playingSince = null;    // actx.currentTime at start, null = stopped
  let previewMode = false;
  let pausedAt = 0;           // preview resume position (seconds, working timeline)
  let exportDest = null;      // MediaStreamAudioDestinationNode for WebM export

  // UI
  let waveCanvas = null, waveWrap = null, waveOuter = null, rowEl = null, transportEl = null;
  let playheadEl = null, playheadRaf = null, seekGhostEl = null;
  let waveZoom = 1;           // 1..16 horizontal zoom

  const _fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const _fmtD = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

  function _ctx() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    return actx;
  }

  // ── Working buffer = original minus the trimmed head/tail ─────────────────

  function _rebuildWorking() {
    _speechCache = null;
    if (!origBuffer) { buffer = null; return; }
    const sr = origBuffer.sampleRate;
    const s = Math.max(0, Math.min(trimStart || 0, origBuffer.duration - 0.05));
    const e = (trimEnd == null || trimEnd <= s + 0.05) ? origBuffer.duration : Math.min(trimEnd, origBuffer.duration);
    if (s <= 0.01 && e >= origBuffer.duration - 0.01) { buffer = origBuffer; return; }
    const len = Math.max(1, Math.round((e - s) * sr));
    const nb = _ctx().createBuffer(origBuffer.numberOfChannels, len, sr);
    const off = Math.round(s * sr);
    for (let c = 0; c < origBuffer.numberOfChannels; c++) {
      nb.copyToChannel(origBuffer.getChannelData(c).subarray(off, off + len), c);
    }
    buffer = nb;
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
      origBuffer = await _ctx().decodeAudioData(ab);
      dataURL = url;
      fileName = file.name;
      trimStart = 0; trimEnd = null; pausedAt = 0; waveZoom = 1;
      _rebuildWorking();
      _renderRow();
      showToast(`Voix off chargée — ${_fmt(buffer.duration)}. Place le playhead puis 📍 pour épingler une scène.`, null, 4500);
      scheduleAutoSave();
    } catch (err) {
      console.error('Voice-over import failed:', err);
      showToast('⚠️ Impossible de lire ce fichier audio', null, 3500);
    }
  }

  function clearAudio() {
    if (buffer && !confirm('Retirer la voix off ? Les marqueurs de scènes sont conservés.')) return;
    stopPlayback();
    origBuffer = null; buffer = null; fileName = null; dataURL = null;
    trimStart = 0; trimEnd = null; pausedAt = 0;
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
      voiceGain = c.createGain();
      voiceGain.gain.value = voiceVolume;
      srcNode.connect(voiceGain);
      voiceGain.connect(c.destination);
      if (opts.forExport && exportDest) voiceGain.connect(exportDest);
      srcNode.onended = () => { /* time() is clamped to duration */ };
      srcNode.start(0, offset);
    }
    _startMusic(offset, !!opts.forExport);
    playingSince = c.currentTime - offset; // time() = position on the track
    previewMode = !!opts.preview;
    _startPlayhead();
    _syncTransport();
  }

  function stopPlayback() {
    if (srcNode) { try { srcNode.stop(); srcNode.disconnect(); } catch (e) {} srcNode = null; }
    if (voiceGain) { try { voiceGain.disconnect(); } catch (e) {} voiceGain = null; }
    _stopMusic();
    playingSince = null;
    previewMode = false;
    _stopPlayhead();
    _syncTransport();
  }

  function pausePlayback() {
    pausedAt = time();
    stopPlayback();
    _positionPlayheadAt(pausedAt);
  }

  function seekTo(t) {
    t = Math.max(0, Math.min(duration(), t));
    const wasPlaying = isPlaying();
    pausedAt = t;
    if (wasPlaying) startPlayback({ preview: true, offset: t });
    else { _positionPlayheadAt(t); _syncTransport(); }
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

  // ── Background music playback ─────────────────────────────────────────────

  const DUCK_LEVEL = 0.3, DUCK_ATTACK = 0.12;

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
    // Fade-in relative to the start of the video
    if (music.fadeIn > 0 && offset < music.fadeIn) {
      const g = volGain.gain;
      g.setValueAtTime(music.volume * (offset / music.fadeIn), c.currentTime);
      g.linearRampToValueAtTime(music.volume, c.currentTime + (music.fadeIn - offset));
    }
    musicSrc.start(0, ((music.start || 0) + offset) % music.buffer.duration);
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
      showToast('⚠️ Impossible de lire ce fichier audio', null, 3500);
    }
  }

  function clearMusic() {
    if (music.buffer && !confirm('Retirer la musique de fond ?')) return;
    _stopMusic();
    music.buffer = null; music.dataURL = null; music.fileName = null;
    music.start = 0; music.fadeIn = 0;
    _renderMusicRow();
    scheduleAutoSave();
  }

  // ── WebM export stream ────────────────────────────────────────────────────

  function createExportStream() {
    if (!buffer && !music.buffer) return null;
    exportDest = _ctx().createMediaStreamDestination();
    return exportDest.stream;
  }

  // ── MP4 export: offline mix (voice + music) → AAC into mp4-muxer ─────────

  const channels = () => music.buffer ? 2 : (buffer ? Math.min(2, buffer.numberOfChannels) : 2);
  const sampleRate = () => buffer ? buffer.sampleRate : (music.buffer ? music.buffer.sampleRate : 44100);

  async function _mixdownBuffer(durationSec) {
    const sr = sampleRate();
    const ch = channels();
    const len = Math.max(1, Math.ceil(durationSec * sr));
    const oc = new OfflineAudioContext(ch, len, sr);
    if (buffer) {
      const s = oc.createBufferSource();
      s.buffer = buffer;
      const vg = oc.createGain();
      vg.gain.value = voiceVolume;
      s.connect(vg); vg.connect(oc.destination);
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
      if (music.fadeIn > 0) {
        vg.gain.setValueAtTime(0.0001, 0);
        vg.gain.linearRampToValueAtTime(music.volume, music.fadeIn);
      }
      s.connect(dg); dg.connect(vg); vg.connect(oc.destination);
      s.start(0, (music.start || 0) % music.buffer.duration);
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
      trimStart, trimEnd, voiceVolume,
      music: music.dataURL
        ? { fileName: music.fileName, dataURL: music.dataURL, volume: music.volume, duck: music.duck, start: music.start, fadeIn: music.fadeIn }
        : null,
    };
  }

  async function onProjectLoaded(savedState) {
    stopPlayback();
    const vo = savedState && savedState.voiceover;
    _speechCache = null;
    pausedAt = 0; waveZoom = 1;
    if (vo && vo.dataURL) {
      try {
        const ab = await (await fetch(vo.dataURL)).arrayBuffer();
        origBuffer = await _ctx().decodeAudioData(ab);
        dataURL = vo.dataURL;
        fileName = vo.fileName || 'voice-over';
        trimStart = vo.trimStart || 0;
        trimEnd = (typeof vo.trimEnd === 'number') ? vo.trimEnd : null;
        voiceVolume = (typeof vo.voiceVolume === 'number') ? vo.voiceVolume : 1;
        _rebuildWorking();
      } catch (err) {
        console.error('Voice-over restore failed:', err);
        origBuffer = null; buffer = null; dataURL = null; fileName = null;
      }
    } else {
      origBuffer = null; buffer = null; dataURL = null; fileName = null;
      trimStart = 0; trimEnd = null; voiceVolume = 1;
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
        music.start = m.start || 0;
        music.fadeIn = m.fadeIn || 0;
      } catch (err) {
        console.error('Music restore failed:', err);
        music.buffer = null; music.dataURL = null; music.fileName = null;
      }
    } else {
      music.buffer = null; music.dataURL = null; music.fileName = null;
      music.volume = 0.25; music.duck = true; music.start = 0; music.fadeIn = 0;
    }
    _renderRow();
    _renderMusicRow();
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  function _injectStyles() {
    const css = `
#vo-transport { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
#vo-transport .ss-title { align-self: center; }
.vo-tbtn {
  flex-shrink: 0; border: 1px solid rgba(0,0,0,0.18); background: #fff; color: var(--accent);
  border-radius: 6px; width: 30px; height: 26px; font-size: 12px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; transition: all .15s; padding: 0;
}
.vo-tbtn:hover { border-color: var(--accent); }
.vo-tbtn:disabled { opacity: 0.35; cursor: default; }
.vo-tbtn.primary { background: var(--accent); color: #fff; border-color: var(--accent); width: 36px; }
#vo-time {
  font-size: 11px; font-variant-numeric: tabular-nums; color: #444; min-width: 92px;
  text-align: center; background: rgba(0,0,0,0.05); border-radius: 5px; padding: 4px 6px;
}
.vo-ctl { display: flex; align-items: center; gap: 5px; font-size: 10px; color: #555; flex-shrink: 0; }
.vo-ctl input[type="range"] { width: 76px; }
.vo-ctl input[type="number"] { width: 52px; font-size: 10px; padding: 3px 4px; border: 1px solid rgba(0,0,0,0.18); border-radius: 5px; }
#vo-row { display: flex; align-items: center; gap: 10px; }
.vo-wave-outer {
  position: relative; flex: 1; min-width: 0; overflow-x: auto; overflow-y: hidden;
  border: 1px solid rgba(0,0,0,0.14); border-radius: 6px; background: #fff;
}
.vo-wave-wrap { position: relative; height: 66px; cursor: text; min-width: 100%; }
.vo-wave-wrap.empty { display: flex; align-items: center; justify-content: center;
  color: #999; font-size: 11px; cursor: default; background: rgba(255,255,255,0.5); }
.vo-wave-wrap canvas { display: block; width: 100%; height: 100%; }
.vo-playhead {
  position: absolute; top: 0; bottom: 0; width: 2px; background: var(--accent2);
  pointer-events: none; display: none; z-index: 3;
}
.vo-playhead::after {
  content: ''; position: absolute; top: 0; left: -4px; border: 5px solid transparent;
  border-top-color: var(--accent2);
}
.vo-pin {
  position: absolute; top: 0; bottom: 0; width: 14px; margin-left: -7px; cursor: ew-resize; z-index: 2;
}
.vo-pin::before {
  content: ''; position: absolute; left: 6px; top: 0; bottom: 0; width: 2px; background: #16a34a;
}
.vo-pin-label {
  position: absolute; top: 13px; left: 8px; background: #16a34a; color: #fff;
  font-size: 9px; font-weight: 700; border-radius: 3px; padding: 0 4px; white-space: nowrap;
}
.vo-pin:hover .vo-pin-label { background: #15803d; }
.vo-meta { font-size: 10px; color: #666; flex-shrink: 0; max-width: 150px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vo-seg {
  position: absolute; top: 12px; bottom: 0; pointer-events: none; z-index: 1;
  border-left: 1px solid rgba(0,0,0,0.05);
}
.vo-seg.overrun {
  background-image: repeating-linear-gradient(135deg, rgba(220,38,38,0.22) 0 6px, transparent 6px 12px) !important;
}
.vo-seg-label {
  position: absolute; bottom: 2px; left: 3px; font-size: 8px; font-weight: 700;
  color: rgba(0,0,0,0.45); pointer-events: none;
}
#music-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
`;
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ── Waveform + time ruler ─────────────────────────────────────────────────

  function _drawWave() {
    if (!waveCanvas || !buffer) return;
    const w = waveCanvas.clientWidth || 600;
    const h = waveCanvas.clientHeight || 66;
    waveCanvas.width = w * 2; waveCanvas.height = h * 2; // retina-ish
    const g = waveCanvas.getContext('2d');
    g.scale(2, 2);
    g.clearRect(0, 0, w, h);

    const RULER_H = 12;
    const dur = duration();

    // Waveform body
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / w));
    g.fillStyle = 'rgba(26,26,26,0.55)';
    const wy = RULER_H, wh = h - RULER_H;
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1;
      const s0 = x * step, s1 = Math.min(data.length, s0 + step);
      for (let i = s0; i < s1; i += Math.max(1, Math.floor(step / 20))) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const y0 = wy + (1 - max) * 0.5 * wh, y1 = wy + (1 - min) * 0.5 * wh;
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }

    // Time ruler: pick a tick step giving >= 55px between labeled ticks
    const pxPerSec = w / Math.max(0.001, dur);
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
    const tick = steps.find(s => s * pxPerSec >= 55) || 120;
    g.fillStyle = 'rgba(0,0,0,0.06)';
    g.fillRect(0, 0, w, RULER_H);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.fillStyle = '#555';
    g.font = '8px "DM Sans", sans-serif';
    g.textBaseline = 'top';
    g.lineWidth = 1;
    for (let t = 0; t <= dur; t += tick / 5) {
      const x = Math.round(t * pxPerSec) + 0.5;
      const major = Math.abs(t / tick - Math.round(t / tick)) < 1e-6;
      g.beginPath();
      g.moveTo(x, RULER_H - (major ? 8 : 4));
      g.lineTo(x, RULER_H);
      g.stroke();
      if (major && t > 0) g.fillText(tick < 1 ? t.toFixed(1) : _fmt(t), x + 2, 1);
    }
  }

  function _xToTime(clientX) {
    const r = waveWrap.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return f * duration();
  }

  function _setZoom(z, anchorClientX) {
    z = Math.max(1, Math.min(16, z));
    if (!waveOuter || z === waveZoom) return;
    // Keep the time under the cursor fixed while zooming
    const tAnchor = anchorClientX != null ? _xToTime(anchorClientX) : null;
    waveZoom = z;
    waveWrap.style.width = (z * 100) + '%';
    _drawWave();
    _renderPins();
    _positionPlayheadAt(isPlaying() ? time() : pausedAt);
    if (tAnchor != null && duration() > 0) {
      const r = waveOuter.getBoundingClientRect();
      const px = (tAnchor / duration()) * waveWrap.clientWidth;
      waveOuter.scrollLeft = Math.max(0, px - (anchorClientX - r.left));
    }
  }

  // ── Pins & scene segments (positions in % — zoom-proof) ──────────────────

  function _renderPins() {
    if (!waveWrap || !buffer) return;
    waveWrap.querySelectorAll('.vo-pin, .vo-seg').forEach(el => el.remove());
    if (!window.SceneManager) return;
    const scenes = SceneManager.getScenes();
    const dur = duration();

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
      seg.style.background = col + '2e';
      seg.innerHTML = `<div class="vo-seg-label" style="color:${col}">${s.name}${overrun ? ` ⚠ ${s._lastDur.toFixed(1)}s > ${slot.toFixed(1)}s` : (s._lastDur != null ? ` · ${s._lastDur.toFixed(1)}s` : '')}</div>`;
      if (overrun) seg.title = `"${s.name}" met ~${s._lastDur.toFixed(1)}s à se dessiner mais n'a que ${slot.toFixed(1)}s avant la scène suivante — il sera coupé. Augmente sa vitesse (ou fixe une Durée) ou déplace le marqueur suivant.`;
      waveWrap.appendChild(seg);
    });

    scenes.forEach((s, i) => {
      if (s.audioStart == null) return;
      const pin = document.createElement('div');
      pin.className = 'vo-pin';
      pin.style.left = `${(s.audioStart / dur) * 100}%`;
      pin.title = `${s.name} démarre ici — glisse pour déplacer, double-clic pour désépingler`;
      const col = SceneManager.colorFor(i);
      pin.innerHTML = `<div class="vo-pin-label" style="background:${col}">${i + 1}</div>`;

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
          else seekTo(s.audioStart); // simple click on a pin = place the playhead there
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
    if (n < 2) { showToast('Ajoute d\'abord des scènes — l\'auto-sync place un marqueur par scène'); return; }

    const silences = [];
    {
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
    }

    let markers;
    if (silences.length >= n - 1) {
      markers = silences.sort((a, b) => b.len - a.len).slice(0, n - 1)
        .map(s => s.center).sort((a, b) => a - b);
      showToast(`Auto-sync : ${n - 1} changement${n > 2 ? 's' : ''} de scène placé${n > 2 ? 's' : ''} sur les pauses`);
    } else {
      markers = Array.from({ length: n - 1 }, (_, i) => (dur * (i + 1)) / n);
      showToast('Pas assez de pauses nettes — scènes réparties uniformément', null, 4000);
    }
    scenes[0].audioStart = 0;
    markers.forEach((t, i) => { scenes[i + 1].audioStart = Math.round(t * 10) / 10; });
    _renderPins();
    SceneManager.renderStrip();
    scheduleAutoSave();
  }

  // ── Playhead + time readout ───────────────────────────────────────────────

  function _positionPlayheadAt(t) {
    if (!playheadEl || !buffer) return;
    playheadEl.style.display = 'block';
    playheadEl.style.left = `${(Math.max(0, Math.min(duration(), t)) / Math.max(0.001, duration())) * 100}%`;
    const timeEl = document.getElementById('vo-time');
    if (timeEl) timeEl.textContent = `${_fmtD(t)} / ${_fmt(duration())}`;
  }

  function _startPlayhead() {
    if (!playheadEl) return;
    playheadEl.style.display = 'block';
    const tick = () => {
      if (playingSince == null) { _stopPlayhead(); return; }
      _positionPlayheadAt(time());
      // Keep the playhead visible when zoomed
      if (waveOuter && waveZoom > 1) {
        const px = (time() / Math.max(0.001, duration())) * waveWrap.clientWidth;
        if (px < waveOuter.scrollLeft + 20 || px > waveOuter.scrollLeft + waveOuter.clientWidth - 20) {
          waveOuter.scrollLeft = Math.max(0, px - waveOuter.clientWidth / 3);
        }
      }
      playheadRaf = requestAnimationFrame(tick);
    };
    playheadRaf = requestAnimationFrame(tick);
  }

  function _stopPlayhead() {
    if (playheadRaf) cancelAnimationFrame(playheadRaf);
    playheadRaf = null;
    if (playheadEl && !buffer) playheadEl.style.display = 'none';
  }

  function _syncTransport() {
    const play = document.getElementById('vo-play-btn');
    if (play) play.innerHTML = (isPlaying() && previewMode) ? '⏸' : '▶';
  }

  // ── Transport + voice controls row ────────────────────────────────────────

  function _renderTransport() {
    const strip = document.getElementById('scene-strip');
    if (!strip) return;
    if (!transportEl) {
      transportEl = document.createElement('div');
      transportEl.className = 'ss-row';
      transportEl.id = 'vo-transport';
      strip.appendChild(transportEl);
    }
    transportEl.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'ss-title';
    title.textContent = 'Voice';
    transportEl.appendChild(title);

    const importBtn = document.createElement('button');
    importBtn.className = 'ss-btn';
    importBtn.innerHTML = '🎙 ' + (buffer ? 'Remplacer' : 'Importer la voix off');
    importBtn.title = 'Charger la narration (mp3, wav, ogg, m4a…)';
    importBtn.addEventListener('click', () => fileInput.click());
    transportEl.appendChild(importBtn);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) importFile(fileInput.files[0]);
      fileInput.value = '';
    });
    transportEl.appendChild(fileInput);

    if (!buffer) return;

    const mk = (html, title, fn, cls = 'vo-tbtn') => {
      const b = document.createElement('button');
      b.className = cls;
      b.innerHTML = html;
      b.title = title;
      b.addEventListener('click', fn);
      transportEl.appendChild(b);
      return b;
    };

    mk('⏮', 'Retour au début', () => seekTo(0));
    const play = mk('▶', 'Lecture / pause (depuis le playhead)', () => {
      (isPlaying() && previewMode) ? pausePlayback() : startPlayback({ preview: true, offset: pausedAt });
    }, 'vo-tbtn primary');
    play.id = 'vo-play-btn';
    mk('■', 'Stop (retour au début)', () => { stopPlayback(); pausedAt = 0; _positionPlayheadAt(0); });

    const timeEl = document.createElement('div');
    timeEl.id = 'vo-time';
    timeEl.textContent = `${_fmtD(pausedAt)} / ${_fmt(duration())}`;
    transportEl.appendChild(timeEl);

    mk('📍', 'Épingler la scène courante à la position du playhead', () => {
      if (!window.SceneManager) return;
      const s = SceneManager.getScenes()[SceneManager.currentIndex()];
      if (!s) return;
      const t = Math.round((isPlaying() ? time() : pausedAt) * 10) / 10;
      s.audioStart = t;
      _renderPins(); SceneManager.renderStrip(); scheduleAutoSave();
      showToast(`« ${s.name} » épinglée à ${t.toFixed(1)}s`);
    });

    const auto = document.createElement('button');
    auto.className = 'ss-btn';
    auto.textContent = '✨ Auto-sync';
    auto.title = 'Détecte les pauses de la narration et place un marqueur de scène par pause';
    auto.addEventListener('click', autoPins);
    transportEl.appendChild(auto);

    // Voice volume
    const vol = document.createElement('label');
    vol.className = 'vo-ctl';
    vol.title = 'Volume de la voix (lecture + exports)';
    vol.innerHTML = `🎙🔊 <input type="range" min="0" max="150" value="${Math.round(voiceVolume * 100)}"><span style="min-width:32px;font-variant-numeric:tabular-nums;">${Math.round(voiceVolume * 100)}%</span>`;
    const volInp = vol.querySelector('input'), volVal = vol.querySelector('span');
    volInp.addEventListener('input', () => {
      voiceVolume = volInp.value / 100;
      volVal.textContent = `${volInp.value}%`;
      if (voiceGain) voiceGain.gain.value = voiceVolume;
    });
    volInp.addEventListener('change', scheduleAutoSave);
    transportEl.appendChild(vol);

    // Trim
    const trim = document.createElement('div');
    trim.className = 'vo-ctl';
    trim.title = 'Découpe la voix : tout ce qui est avant « Début » et après « Fin » est retiré de la vidéo (0:00 devient le nouveau départ). Les temps sont en secondes du fichier original.';
    trim.innerHTML = `✂ Début <input type="number" id="vo-trim-s" min="0" step="0.1" value="${trimStart || 0}">
      Fin <input type="number" id="vo-trim-e" min="0" step="0.1" placeholder="${origBuffer ? origBuffer.duration.toFixed(1) : ''}" value="${trimEnd ?? ''}">`;
    const applyTrim = () => {
      const sIn = trim.querySelector('#vo-trim-s'), eIn = trim.querySelector('#vo-trim-e');
      const s = parseFloat(sIn.value);
      const e = parseFloat(eIn.value);
      trimStart = (isNaN(s) || s <= 0) ? 0 : s;
      trimEnd = (isNaN(e) || e <= 0 || e >= (origBuffer?.duration || 0)) ? null : e;
      stopPlayback(); pausedAt = 0;
      _rebuildWorking();
      _drawWave(); _renderPins(); _positionPlayheadAt(0);
      const timeEl2 = document.getElementById('vo-time');
      if (timeEl2) timeEl2.textContent = `${_fmtD(0)} / ${_fmt(duration())}`;
      scheduleAutoSave();
      showToast(`Voix : ${_fmt(duration())} après découpe`);
    };
    trim.querySelectorAll('input').forEach(i => i.addEventListener('change', applyTrim));
    transportEl.appendChild(trim);

    const meta = document.createElement('div');
    meta.className = 'vo-meta';
    meta.style.marginLeft = 'auto';
    meta.textContent = `${fileName} · ${_fmt(duration())}`;
    transportEl.appendChild(meta);

    const clear = document.createElement('button');
    clear.className = 'ss-btn';
    clear.textContent = '✕';
    clear.title = 'Retirer la voix off';
    clear.addEventListener('click', clearAudio);
    transportEl.appendChild(clear);
  }

  // ── Waveform row ──────────────────────────────────────────────────────────

  function _renderRow() {
    const strip = document.getElementById('scene-strip');
    if (!strip) return;
    _renderTransport();
    if (!rowEl) {
      rowEl = document.createElement('div');
      rowEl.className = 'ss-row';
      rowEl.id = 'vo-row';
      strip.appendChild(rowEl);
    }
    rowEl.innerHTML = '';
    waveZoom = Math.max(1, Math.min(16, waveZoom));

    const title = document.createElement('div');
    title.className = 'ss-title';
    title.textContent = '';
    rowEl.appendChild(title);

    waveOuter = document.createElement('div');
    waveOuter.className = 'vo-wave-outer';
    waveWrap = document.createElement('div');
    waveWrap.className = 'vo-wave-wrap' + (buffer ? '' : ' empty');
    waveWrap.style.width = (waveZoom * 100) + '%';
    waveOuter.appendChild(waveWrap);

    if (buffer) {
      waveCanvas = document.createElement('canvas');
      waveWrap.appendChild(waveCanvas);
      playheadEl = document.createElement('div');
      playheadEl.className = 'vo-playhead';
      waveWrap.appendChild(playheadEl);
      waveWrap.title = 'Clic : placer le playhead · glisser : scrub · Ctrl+molette : zoom · 📍 épingle la scène au playhead';

      // Click = seek · drag = scrub
      waveWrap.addEventListener('mousedown', e => {
        if (e.target.closest('.vo-pin')) return;
        e.preventDefault();
        const wasPlaying = isPlaying() && previewMode;
        if (wasPlaying) stopPlayback();
        const applyAt = ev => {
          pausedAt = Math.round(_xToTime(ev.clientX) * 20) / 20;
          _positionPlayheadAt(pausedAt);
        };
        applyAt(e);
        const move = ev => applyAt(ev);
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          if (wasPlaying) startPlayback({ preview: true, offset: pausedAt });
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });

      // Ctrl+wheel = horizontal zoom
      waveOuter.addEventListener('wheel', e => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        _setZoom(waveZoom * (e.deltaY < 0 ? 1.4 : 1 / 1.4), e.clientX);
      }, { passive: false });
    } else {
      waveWrap.textContent = 'Pas de voix off — importe ta narration pour monter les scènes dessus';
    }
    rowEl.appendChild(waveOuter);

    if (buffer) {
      requestAnimationFrame(() => { _drawWave(); _renderPins(); _positionPlayheadAt(pausedAt); });
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
      volWrap.className = 'vo-ctl';
      volWrap.title = 'Volume de la musique';
      volWrap.innerHTML = `🔉 <input type="range" min="0" max="100" step="1" value="${Math.round(music.volume * 100)}"> <span style="min-width:30px;font-variant-numeric:tabular-nums;">${Math.round(music.volume * 100)}%</span>`;
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
      duckWrap.className = 'vo-ctl';
      duckWrap.style.cursor = 'pointer';
      duckWrap.title = 'Baisse automatiquement la musique pendant que la voix parle';
      duckWrap.innerHTML = `<input type="checkbox" ${music.duck ? 'checked' : ''}> Baisser sous la voix`;
      duckWrap.querySelector('input').addEventListener('change', e => {
        music.duck = e.target.checked;
        scheduleAutoSave();
      });
      musicRowEl.appendChild(duckWrap);

      const startWrap = document.createElement('label');
      startWrap.className = 'vo-ctl';
      startWrap.title = 'Commencer la musique à cette seconde du fichier (pour sauter une intro)';
      startWrap.innerHTML = `⏩ Départ <input type="number" min="0" step="0.5" value="${music.start || 0}"> s`;
      startWrap.querySelector('input').addEventListener('change', e => {
        const v = parseFloat(e.target.value);
        music.start = (isNaN(v) || v < 0) ? 0 : v;
        scheduleAutoSave();
      });
      musicRowEl.appendChild(startWrap);

      const fadeWrap = document.createElement('label');
      fadeWrap.className = 'vo-ctl';
      fadeWrap.title = 'Fondu d\'entrée de la musique au début de la vidéo';
      fadeWrap.innerHTML = `Fondu <input type="number" min="0" max="10" step="0.5" value="${music.fadeIn || 0}"> s`;
      fadeWrap.querySelector('input').addEventListener('change', e => {
        const v = parseFloat(e.target.value);
        music.fadeIn = (isNaN(v) || v < 0) ? 0 : Math.min(10, v);
        scheduleAutoSave();
      });
      musicRowEl.appendChild(fadeWrap);

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
    startPlayback, stopPlayback, pausePlayback, seekTo,
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
