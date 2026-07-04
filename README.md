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
- Import your narration (mp3, wav, ogg, m4a…) — a **real audio timeline** appears under the scene strip: 66px waveform, time ruler, `Ctrl+wheel` horizontal zoom (×1–×16) with scroll
- **Transport**: play/pause with resume, stop, back-to-start, live time readout, click/drag the waveform to seek & scrub
- **✂ Trim**: cut the head/tail of the narration (Début/Fin in seconds) — the video timeline starts at the trimmed point, in preview and exports
- **Voice volume** (0–150%), applied in preview, WebM and MP4
- **📍 Pin the current scene at the playhead**; drag pins to adjust, double-click to unpin, click a pin to place the playhead there
- **✨ Scènes**: detects the pauses in your narration and places one scene marker per pause
- **✨ Calques**: spreads the current scene's drawings over the speech bursts inside its voice segment — sets each layer's *Départ* and *Durée* automatically so drawings land on the words
- **🎯 Caler au playhead** (on each layer): listen, drop the playhead on the exact word, click — the drawing now starts precisely there (relative to the scene's marker)
- **Layer markers for EVERY scene on the waveform**: each drawing of each scene shows where it starts on the voice (colored by scene, current scene brighter). Drag any of them — even a drawing from another scene — to retime it without leaving the current scene; double-click clears it
- **✨ Tout**: one click times every layer of every pinned scene across the whole voice-over
- **Colored segments** on the waveform show each scene's time slot, with its measured drawing time — and a ⚠ hatched warning when a scene draws longer than its slot
- **Audition anywhere**: click a pin (or Shift+click the waveform) to listen from that point
- During playback and export **the audio is the master clock**: each pinned scene starts exactly on its marker (a scene still drawing gets snapped to its final frame so the narration never drifts)
- The voice-over is **muxed into the exported video** — AAC in MP4, Opus/Vorbis in WebM
- MP4 export is now paced to real time, so exported timing matches the preview exactly

### 🎬 Editing (montage)
- **Transitions between scenes**: cut, fade, slide, wipe — visible in Play all and baked into the export
- **Per-scene settings popover (⚙ on a thumbnail)**: rename, hold duration, transition, precise voice-over start time, listen-from-here
- **Drag & drop the thumbnails** to reorder scenes · **▶ on a thumbnail = play from that scene** (audio seeks to its marker)
- **Estimated total video duration** next to Play all (voice-over duration when a track is loaded)
- Measured scene durations shown on thumbnails after each playback

### 🎯 Precision canvas
- **Magnetic smart guides** while dragging: layers snap to the canvas center/edges and to other layers' edges & centers (dashed pink guides, hold `Alt` to disable)
- **Live readout** while dragging (`x, y`) and resizing (`w × h`)
- **Arrow keys nudge** the selected layer 1px (`Shift` = 10px) · **`Ctrl+↑/↓` moves it through the layer stack**

### 🎨 Colors & fonts
- 18 text fonts (10 new handwriting/display Google Fonts: Kalam, Amatic SC, Shadows Into Light, Gloria Hallelujah, Indie Flower, Architects Daughter, Bangers, Pacifico, Bebas Neue, Courgette)
- 19 text color swatches (pastels included) + quick color dots next to every outline color picker
- 6 new canvas backgrounds: Midnight, Sunset, Mint, Ocean, Dotted paper, Slate

### 💾 Portable projects
- **Export / Import project file** (`.inkstudio.json`) from the Projects modal — scenes, images and voice-over all baked in; move projects between machines or keep backups
- `Ctrl+S` saves instantly (auto-save still runs every 5s)

### 🔍 Stage zoom & focus mode
- **Zoom pill** (bottom-right of the canvas): − / % / + / 1:1, plus one-click **🎬 TikTok format** (9:16, 1080×1920, safe-zone on)
- `Ctrl+wheel` (or trackpad pinch) zooms at the cursor · plain wheel pans · middle-drag or `Alt`+drag pans · `Ctrl` `+` / `−` / `0`
- **⛶ Focus mode** (`F`): hides the side panels so the stage fills the window — `Esc` to come back

### 🎞 Animated GIFs
- Import a `.gif` like any image: it loops on the canvas **and in the exported video** (WebM & MP4)
- Frames decoded natively (ImageDecoder), persisted with the project, flip-safe

### 📱 TikTok toolkit
- **Safe-zone overlay** (📱): shows the areas TikTok covers with the caption, action rail and username — never put text there
- **🎵 Background music track**: loops under the whole video, volume slider, **auto-ducking** (music dips while the voice-over speaks), **start offset** (skip the track's intro) and **fade-in** — mixed into both WebM and MP4 exports
- **Manga text presets**: 💥 Onomatopée, 📢 Titre, 💬 Dialogue, ✏️ Narration — one click sets font/size/color and arms text placement
- **😀 Emoji stickers**: pick from a manga-flavored grid (or type any emoji) — lands as a normal layer that gets hand-drawn like the rest
- Exported files are named after the project (`mon-projet-2026-….mp4`)

### 🎥 Auto camera
- During playback **and in the exported video**, the virtual camera eases toward each drawing/text while it's being drawn, then eases back to the full frame — automatic Ken Burns
- Moderate by design: 35% breathing margin around the drawing, zoom capped at ×1.7 (adjustable ×1.2–×2.6 in the 🎥 popover of the zoom pill, on/off toggle, persisted)
- Combine with per-layer timing for full control: "focus on this spot at second 6 for 2.5s" = give that layer Départ 6 / Durée 2.5

### ➜ Hand-drawn shapes
- **Shapes tool** in the canvas toolbar: arrow, double arrow, curved arrow, circle, frame, underline, speech bubble, manga focus lines, star, heart — all in a wobbly hand-drawn style with live preview thumbnails
- Pick **color, thickness and angle** before placing — and change them **after** placement too (Forme section on the layer): the shape re-renders with the exact same strokes
- Shapes are normal layers: they get hand-drawn by the animation, support timing (départ/durée), flip, duplicate, and persist with the project

### 🧰 Layer tools
- **⇋ / ⇅ flip** the selected layer (GIF frames flip too) · **⧉ duplicate** (`Ctrl+D`)
- **⟳ Rotation** for every layer: drag the knob above the selection (Shift = 15° steps), or use the Rotation row in the layer card (±90, ±15, exact angle). Always re-rendered from the original image — no quality loss; shapes rotate as vectors, GIF frames rotate too
- **⏱ Per-drawing timing** (Timing section on the selected layer): **Départ** = the drawing waits until that second of the scene before starting · **Durée** = exact drawing time — snapped to its finished image if too slow, held on screen if it finishes early. Works in Play, Play all and both exports.

### 🔧 Fixes
- Fixed a layer-ID collision bug after loading a saved project (upstream `window._layerIdCounter` bug)
- Fixed the dead **text animation direction** (← → ↑ ↓) and **text draw style** (Reveal / Outline / Outline+Fill) buttons — their handlers were missing upstream
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

## 🖥 Desktop app (Windows)

```bash
npm install
npm start          # run in dev
npm run dist       # build dist/InkStudio Setup <version>.exe (installer + desktop shortcut)
```

The Electron shell serves the app from an internal `127.0.0.1` server, so WebCodecs / MP4 export work exactly like on localhost — and `js/vendor/mp4-muxer.mjs` is bundled, so MP4 export works fully offline. Projects are stored in the app's own profile (separate from your browser).

## 🚀 Run it in a browser

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
| `js/studio.js` | **InkStudio** — zoom/pan/focus, GIF engine, safe-zone, stickers, presets |
| `electron/main.js` | **InkStudio** — desktop shell (internal static server + window) |

## 📜 License & credits

Apache-2.0. Original animation engine by [NadirWeb-App/Inkplainer-OS](https://github.com/NadirWeb-App/Inkplainer-OS) — huge thanks. Scene system, voice-over sync, portable projects and fixes by Abdoulrazack.
