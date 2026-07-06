# Privacy Policy

**Last updated: July 2026**

InkStudio is built on a simple principle: your content is yours. It is never collected, stored on a server, or sent anywhere. This document explains exactly what the app does and doesn't do with your data.

---

## Summary

| | |
|--|--|
| 🖥️ **Project content stays local** | Your images, audio, and videos are never uploaded to any server |
| 🎙️ **Microphone audio stays local** | Voice-over you record is processed and stored only on your device |
| 🚫 **No accounts or analytics** | No sign-up required. No analytics. No session recording |
| 🆓 **Free to use** | No ads, no subscriptions, no sale of personal data |

---

## 1. What InkStudio does with your content

> ✓ Your images, text, audio, and exported videos never leave your device. All animation processing, audio mixing, and video recording happens entirely on your machine using local computation.

When you upload an image, import a GIF, add a text layer, or load an audio track, that content is stored locally in your browser's storage (IndexedDB) so your project is automatically saved between sessions. It is never transmitted to any server — because InkStudio has no server that receives your content.

When you export a video, the recording, audio mixing, and encoding happen on your device using your browser's built-in capabilities. The resulting file is downloaded directly to your computer. No one receives, processes, or stores that file.

---

## 2. Microphone

InkStudio can record a voice-over directly from your microphone (the **⏺ Enregistrer** button in the audio timeline). When you use this feature:

- Your browser (or the desktop app) asks for microphone permission. Recording only starts after you grant it, and only while you have explicitly started a recording.
- The captured audio is kept entirely on your device: it becomes part of your project in local storage (IndexedDB) and is mixed into your exported video locally.
- The microphone audio is **never** streamed, uploaded, or sent to any server. If you never use the recording feature, the microphone is never accessed.

You can revoke microphone permission at any time through your browser or operating system settings.

---

## 3. What data we collect

None. InkStudio has no user accounts, no login system, and no analytics. No cookies are used for tracking. No third-party analytics services (Google Analytics, Mixpanel, Hotjar, or similar) are used.

Your browser's `localStorage` stores a few small pieces of local preference state (for example: whether you have completed the onboarding tour, your custom animation presets, and toolbar toggles such as the TikTok safe-zone and auto-camera). This data lives only on your device and is never sent anywhere.

---

## 4. Google Fonts

InkStudio loads fonts from [Google Fonts](https://fonts.google.com). When your browser loads the app for the first time, it makes a request to Google's servers to download the font files.

As a result of this request, Google may log your IP address and the referring URL in accordance with [Google's privacy policy](https://policies.google.com/privacy). InkStudio does not receive or have access to this data. This is standard behavior for any website that uses Google Fonts.

The fonts are cached by your browser after the first visit, so subsequent visits do not require a new request to Google's servers.

If you self-host InkStudio and want to avoid this entirely, you can download the font files and serve them locally, then update the `<link>` tags in `index.html` accordingly.

---

## 5. MP4 export library

MP4 export uses [mp4-muxer](https://github.com/Vanilagy/mp4-muxer), a small open-source library that runs entirely in your browser and only packages the video — no video or audio data is sent anywhere.

- **Desktop app and normal use:** this library is **bundled with InkStudio** (`js/vendor/mp4-muxer.mjs`) and loaded from your own machine. No network request is made, and MP4 export works fully offline.
- **Fallback only:** if, in a self-hosted web deployment, the bundled copy fails to load, the app may fall back to loading the same library from jsDelivr (a free public CDN), which may log your IP address as is standard for any CDN. This fallback does not run in the desktop app.

If you export in WebM format, this library is never loaded at all.

---

## 6. Local storage and project data

Your InkStudio projects — including all layers, scenes, settings, images, GIFs, and audio (voice-over and music) — are saved in your browser's IndexedDB storage. This is local to your browser and device. It cannot be accessed remotely and is not synced to any cloud service.

Clearing your browser's site data will permanently delete your saved projects. Export important projects with **⬇ Export file** (a portable `.inkstudio.json`) or keep copies of your source assets.

---

## 7. Importing project files

You can import `.inkstudio.json` project files shared by others. InkStudio validates the structure of an imported file and escapes all names/labels before displaying them, so a malformed or malicious file is rejected rather than executed. As with any file you receive from a third party, only import project files from sources you trust.

---

## 8. Third-party links

This repository and any deployment of InkStudio may link to external sites (GitHub, jsDelivr, Google Fonts). Those sites have their own privacy policies. We are not responsible for the content or practices of any external site.

---

## 9. Children's privacy

InkStudio does not knowingly collect any information from children under the age of 13. The app has no data collection of any kind, making it suitable for use in educational environments.

---

## 10. Changes to this policy

If meaningful changes are made to this policy — for example, if analytics or external services are added — this document will be updated and the "Last updated" date at the top will be revised.

---

## 11. Contact

For questions about this privacy policy, open an issue on GitHub: [github.com/Abdoulrazack1/inkstudio](https://github.com/Abdoulrazack1/inkstudio)

---

© 2026 · Apache 2.0 License · InkStudio is a fork of Inkplainer-OS
