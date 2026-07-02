# 🎬 InkStudio

**Personal whiteboard animation studio — multi-scene projects, voice-over sync, everything unlocked, 100% in the browser.**

InkStudio is my heavily reworked fork of [Inkplainer](https://github.com/NadirWeb-App/Inkplainer-OS) (Apache-2.0). It keeps the excellent hand-drawn animation engine and adds what a real explainer-video workflow needs: **several canvases (scenes) per project** and an **imported voice-over track that drives the timing**, so what you say and what gets drawn appear together.

---

## ✨ What InkStudio adds over Inkplainer

### 🎞 Multi-scene projects
- A project is now a **list of scenes**, each with its own layers, groups and background
- Scene strip under the canvas: thumbnails, add ( + ), duplicate, delete, reorder (◀ ▶), rename (double-click)
- **▶ Play all** — scenes play back-to-back on the canvas
- **Export renders every scene into a single video** (WebM or MP4)
- `PageUp` / `PageDown` to jump between scenes

### 🎙 Voice-over with real sync
- Import your narration (mp3, wav, ogg, m4a…) — waveform appears under the scene strip
- **Click the waveform to pin the current scene to that moment** of the audio; drag pins to adjust, double-click to unpin
- **✨ Auto-sync**: detects the pauses in your narration and places one scene marker per pause
- **Colored segments** on the waveform show each scene's time slot, with its measured drawing time — and a ⚠ hatched warning when a scene draws longer than its slot
- **Audition anywhere**: click a pin (or Shift+click the waveform) to listen from that point
- During playback and export **the audio is the master clock**: each pinned scene starts exactly on its marker (a scene still drawing gets snapped to its final frame so the narration never drifts)
- The voice-over is **muxed into the exported video** — AAC in MP4, Opus/Vorbis in WebM
- MP4 export is now paced to real time, so exported timing matches the preview exactly

### 🎬 Editing (montage)
- **Transitions between scenes**: cut, fade, slide, wipe — visible in Play all and baked into the export
- **Per-scene settings popover (⚙ on a thumbnail)**: rename, hold duration, transition, precise voice-over start time, listen-from-here
- Measured scene durations shown on thumbnails after each playback

### 🎨 Colors & fonts
- 18 text fonts (10 new handwriting/display Google Fonts: Kalam, Amatic SC, Shadows Into Light, Gloria Hallelujah, Indie Flower, Architects Daughter, Bangers, Pacifico, Bebas Neue, Courgette)
- 19 text color swatches (pastels included) + quick color dots next to every outline color picker
- 6 new canvas backgrounds: Midnight, Sunset, Mint, Ocean, Dotted paper, Slate

### 💾 Portable projects
- **Export / Import project file** (`.inkstudio.json`) from the Projects modal — scenes, images and voice-over all baked in; move projects between machines or keep backups
- `Ctrl+S` saves instantly (auto-save still runs every 5s)

### 🔧 Fixes
- Fixed a layer-ID collision bug after loading a saved project (upstream `window._layerIdCounter` bug)
- Faster saves: images already backed by data URLs are no longer re-encoded

### 🆓 Everything unlocked
All features are local and free — no accounts, no paywall, no watermark, no tracking.

---

## 🖋 Inherited from Inkplainer

- Multiple animation styles (Chunk Jump, Scanner, Contour, Outline Chunks + 7 subject-aware specialized styles)
- 5 stroke styles, 4 outline detection algorithms, 3 coloring styles, 6 image reveals
- Layer system with sequence/parallel animation ordering, slicer tool, text layers
- Export MP4 / WebM at 720p, 1080p, 1440p + final-frame PNG
- Undo/redo, auto-save to the browser (IndexedDB), fully private

---

## 🚀 Run it

```bash
git clone https://github.com/Abdoulrazack1/inkstudio.git
cd inkstudio
npx serve .        # any static server works
```

Open `http://localhost:3000` (or the port shown) in **Chrome or Edge** (best support: MP4 export needs WebCodecs). Firefox/Safari fall back to WebM.

> Video export requires a **secure context** (HTTPS or `localhost`) because it uses the WebCodecs API. For hosting, any static host with HTTPS works (Cloudflare Pages, Netlify, GitHub Pages…).

## 🗂 Code layout

| File | Role |
|---|---|
| `index.html` | Core app (UI + animation orchestration + storage + export) |
| `animations.js` | Animation engine (styles, outline algorithms, ticks) |
| `js/scenes.js` | **InkStudio** — multi-scene system + ExportDriver |
| `js/audio.js` | **InkStudio** — voice-over import, waveform, markers, AAC/stream muxing |
| `js/extras.js` | **InkStudio** — portable project files, extra shortcuts |

## 📜 License & credits

Apache-2.0. Original animation engine by [NadirWeb-App/Inkplainer-OS](https://github.com/NadirWeb-App/Inkplainer-OS) — huge thanks. Scene system, voice-over sync, portable projects and fixes by Abdoulrazack.
