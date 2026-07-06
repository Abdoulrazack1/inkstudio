# Audit complet — InkStudio
### Whiteboard animation studio (fork d'Inkplainer-OS) — github.com/Abdoulrazack1/inkstudio

*Audit réalisé sur le dépôt en l'état au 6 juillet 2026 (21 commits, dernier commit `3305e33`). Basé sur une lecture ligne à ligne de `index.html` (11 307 lignes), `animations.js` (3 639 lignes), `js/scenes.js`, `js/audio.js`, `js/studio.js`, `js/extras.js`, `electron/main.js`, `package.json` et `PRIVACY.md`.*

---

## 0. Résumé exécutif

InkStudio est un projet impressionnant en termes de **fonctionnalités livrées** : multi-scènes, synchronisation voix-off réelle, transitions, caméra automatique, formes dessinées à la main, export MP4/WebM avec mux audio... C'est rare de voir autant de features dans un fork perso. Mais l'audit fait remonter un écart important entre la **richesse fonctionnelle** et la **solidité technique** :

| Axe | Verdict |
|---|---|
| Fonctionnalités | 🟢 Très riche, au-dessus de beaucoup d'outils gratuits |
| Sécurité | 🔴 **Faille XSS stockée exploitable**, confirmée à plusieurs endroits |
| Architecture | 🔴 Monolithe global de ~18 600 lignes, sans module, sans build |
| Fiabilité des données | 🟠 Aucune sauvegarde hors navigateur ; undo fragile |
| Performance export | 🟠 Export toujours en temps réel (jamais plus rapide que la lecture) |
| Qualité de code | 🟠 Aucun test, aucun CI, aucun linter, fonctions géantes |
| Accessibilité | 🔴 Quasiment nulle (0 `role`, 0 `tabindex`, 1 `alt`) |
| Documentation | 🟠 `PRIVACY.md` non mis à jour depuis le fork (parle encore d'« Inkplainer ») |

**Top 5 priorités absolues, dans l'ordre :**
1. **Corriger la faille XSS stockée** (noms de projet/calque/texte injectés via `innerHTML`) — exploitable dès aujourd'hui via l'import de `.inkstudio.json` partagés.
2. **Mettre à jour et compléter `PRIVACY.md`** (nom du produit, micro, CDN).
3. **Découpler l'undo/redo du changement de scène** et alléger son coût mémoire.
4. **Sortir `index.html` de son statut de monolithe** (au minimum : passer aux modules ES, séparer HTML/CSS/JS).
5. **Ajouter un filet de sécurité pour les données** (export automatique de sauvegarde, avertissement de perte de données plus visible).

Le reste du document détaille chaque point avec preuves de code (fichier + ligne), explique le *pourquoi* du problème, et propose une feuille de route priorisée avec une architecture cible.

---

## 1. Ce que le projet est réellement (constat factuel)

```
index.html      11 307 lignes  — markup + CSS inline (~4260 lignes) + DEUX <script> inline géants
animations.js    3 639 lignes  — moteur d'animation (IIFE, exposé via window.AnimationEngine)
js/scenes.js       943 lignes  — multi-scènes + ExportDriver (IIFE)
js/audio.js       1 282 lignes — voix-off, waveform, mux audio (IIFE)
js/studio.js      1 274 lignes — zoom/pan, GIF, TikTok toolkit, caméra (IIFE)
js/extras.js        187 lignes — import/export de projet, raccourcis
electron/main.js     90 lignes — shell Electron (serveur HTTP interne)
images/             22 Mo      — 24 PNG de mains (4 mains × 3 résolutions × 2 orientations)
```

Aucun `src/`, aucun bundler (Vite/Webpack/esbuild), aucun `tsconfig`, aucun test, aucun fichier CI (`.github/workflows`), aucun linter (`.eslintrc`) ni formatter (`.prettierrc`). Le seul outillage de build est `electron-builder` pour l'installeur Windows.

`index.html` contient **deux balises `<script>` inline** de respectivement ~1 400 et ~5 450 lignes (`index.html:4263` et `index.html:5659`), qui déclarent environ **218 fonctions globales** et un objet `state` global mutable partagé par tout le reste de l'application. Les 4 fichiers `js/*.js` sont chargés *après* ces scripts et lisent/écrivent directement ces globales sans import explicite — le commentaire en tête de `scenes.js` le dit lui-même :

```js
// Runs after the main inline script — shares its global lexical scope
// (state, ctx, _mainCtx, generate, renderLayerList, …).
```

C'est un couplage **temporel et implicite** : l'app ne fonctionne que si les 6 balises `<script>` se chargent dans le bon ordre, dans le même document, avec les mêmes noms de variables. Aucun de ces fichiers n'est testable isolément, ni réutilisable ailleurs.

---

## 2. 🔴 Sécurité — le point le plus urgent

### 2.1 Faille XSS stockée, confirmée et exploitable

Trois zones de code injectent des données **fournies par l'utilisateur** dans le DOM via `innerHTML`, sans aucun échappement :

**a) Nom de projet** — `index.html:4835`
```js
<div class="project-name">${project.name}</div>
```
`project.name` est éditable librement par l'utilisateur (renommage de projet) et vient aussi, sans validation, d'un fichier `.inkstudio.json` importé (`js/extras.js:76` : `name: payload.name || 'Imported Project'`).

**b) Nom de calque (layer)** — `index.html:6476`
```js
<div class="layer-name" title="${layer.name}">${layer.name}</div>
```
Or `layer.name`, pour un calque texte, est dérivé **directement du texte tapé par l'utilisateur** (`index.html:8795`) :
```js
name: text.split('\n')[0].slice(0, 24) || 'Text',
```
Il suffit de créer un calque texte dont la première ligne est, par exemple, un payload `<img src=x onerror=...>` de moins de 24 caractères pour que le nom du calque exécute du JavaScript dès que la liste de calques se re-rend.

**c) Marqueurs de la piste voix-off** — `js/audio.js:724`
```js
el.innerHTML = `<div class="vo-lay-label" ...>${cue.scene + 1}·✏ ${cue.name}...</div>`;
```
Même `cue.name`, même origine (nom de calque).

**Pourquoi c'est grave et pas juste théorique :** le README présente explicitement l'export/import de projet comme un moyen de **partager des fichiers entre machines** (« move projects between machines or keep backups »). Le chargement d'un `.inkstudio.json` reçu d'un tiers (forum, Discord, réseau social) suffit à faire exécuter du code arbitraire dans l'origine de l'app, avec accès à **tout l'IndexedDB de la victime** (donc à tous ses autres projets, potentiellement exfiltrables ou corruptibles). `js/extras.js:70` ne valide que `payload.app === 'inkstudio'` et la présence de `payload.state` — aucune validation de schéma, aucune sanitation de chaîne, aucune limite de taille.

**Correctif concret :**
- Remplacer tous les `el.innerHTML = ...${data}...` par `el.textContent = ...` quand il n'y a pas de HTML à injecter, ou construire les nœuds avec `document.createElement` + `.textContent`.
- Là où du HTML *est* nécessaire (icônes SVG mêlées à du texte utilisateur), séparer clairement la partie statique (HTML) de la partie dynamique (assignée en `textContent` sur un nœud enfant dédié), ou passer par une fonction d'échappement HTML systématique (`escapeHtml()`) appliquée à **toute** valeur qui provient de l'utilisateur avant interpolation.
- Ajouter une validation de schéma stricte à l'import (`js/extras.js:importProjectFile`) : whitelist des clés attendues, types attendus, longueur maximale des chaînes, rejet des projets contenant des clés inconnues ou des tailles aberrantes.

### 2.2 Absence de Content-Security-Policy

Aucune balise `<meta http-equiv="Content-Security-Policy">` n'existe dans `index.html`. Combiné aux dizaines d'attributs `onclick="..."` inline (`onclick="selectLayer(${layer.id})"`, etc.), il est aujourd'hui impossible d'ajouter un CSP strict sans une refonte du câblage d'événements (les gestionnaires inline nécessitent `unsafe-inline`, ce qui annule une bonne partie de l'intérêt d'un CSP). C'est un chantier à part entière mais qui devrait être la finalité du nettoyage des `innerHTML`/`onclick`.

### 2.3 Dépendance CDN sans intégrité, chargée dynamiquement

`index.html:9697` :
```js
mod = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs');
```
C'est un *fallback* si la copie vendored locale (`js/vendor/mp4-muxer.mjs`) échoue à charger. Le code exécuté vient alors d'un tiers, sans `integrity` (Subresource Integrity), sans épinglage de hash. Si jsdelivr est compromis ou si le paquet est retiré/modifié, ce fallback devient un vecteur d'exécution de code non maîtrisé. À la version figée `js/vendor/`, ce fallback devrait être supprimé (il ne sert qu'en environnement web hors Electron où le fichier vendored ne se chargerait pas — un cas qui, en pratique, ne devrait jamais arriver) ou a minima recevoir un attribut `integrity`.

### 2.4 `PRIVACY.md` obsolète et incomplet — risque de confiance, pas juste cosmétique

Le fichier mentionne encore **12 fois** le nom « Inkplainer » (jamais renommé après le fork) et affirme que le contenu « n'est jamais envoyé nulle part ». Or :
- Le micro est utilisé (`js/audio.js:78`, `navigator.mediaDevices.getUserMedia`) pour l'enregistrement de voix-off en direct — non mentionné dans le document.
- Le fallback CDN décrit en 2.3 constitue bien une requête réseau sortante — non mentionné non plus.

Pour un outil dont l'argument de vente est justement « rien ne quitte votre machine », ce décalage documentaire est le genre de chose qu'un utilisateur technique remarque et qui entame la confiance. Correction rapide (quelques lignes), à traiter en même temps que le rebranding du texte.

### 2.5 Electron — bon réflexe global, un point à vérifier

`electron/main.js` fait plutôt bien les choses : `contextIsolation: true`, `nodeIntegration: false`, contrôle du path traversal sur le mini-serveur HTTP interne (`filePath.startsWith(ROOT)`), ouverture des liens externes dans le navigateur système plutôt que dans une nouvelle fenêtre Electron. C'est solide. Un point à durcir : le serveur écoute sur `127.0.0.1` avec un port aléatoire mais n'a **aucune vérification d'origine/referer** sur les requêtes qu'il sert — un autre process local malveillant sur la même machine qui devinerait/scannerait le port pourrait lire les fichiers de l'app (faible risque, mais gratuit à corriger en ajoutant un token partagé entre le process principal et la page chargée).

---

## 3. 🏗️ Architecture et organisation du code

### 3.1 Le monolithe global

Comme détaillé en §1, l'app entière vit dans l'espace global (`window`), à travers 218 fonctions et un objet `state` mutable. Conséquences concrètes :
- **Aucun test unitaire possible** sans faire tourner un DOM complet et charger les 6 fichiers dans l'ordre exact — donc en pratique, aucun test n'existe.
- **Collisions de noms silencieuses** : rien n'empêche une fonction dans `js/studio.js` d'écraser une fonction du même nom définie dans le script inline précédent ; il n'y a que la convention (préfixe `_`) pour s'en prémunir, pas de garantie du langage.
- **Duplication de logique** : `animations.js` définit *dans sa propre IIFE* deux fonctions `setOutlineVisible()` et `setOutlineOpacity()` (`animations.js:3580-3591`) qui font strictement la même chose que les fonctions globales de même nom définies dans `index.html:9260` et `index.html:9265`. Elles ne rentrent pas en collision au runtime (portées différentes) mais c'est la même logique maintenue à deux endroits différents — le jour où l'une est corrigée et pas l'autre, le comportement diverge silencieusement selon qui appelle qui.
- **`console.log` de debug oubliés en production** : `animations.js:24` (`console.log('🎨 Loading Animation Engine...')`) et sa contrepartie en fin de fichier — anodin, mais révélateur d'un manque de nettoyage avant livraison.

### 3.2 Mélange HTML / CSS / logique / gestion d'événements

Les ~4 260 premières lignes de `index.html` sont du HTML+CSS pur, suivies de deux blocs `<script>` géants, avec des gestionnaires d'événements *inline* (`onclick="..."`, `oninput="..."`) disséminés dans les templates de `innerHTML` générés en JS (ex. `index.html:6471` à `6493`). Cette approche :
- interdit un CSP strict (§2.2),
- rend le HTML généré illisible en diff/review (logique JS encodée en chaîne de caractères dans du HTML généré par du JS),
- complique tout renommage de fonction (recherche/remplacement doit couvrir aussi le texte des templates).

### 3.3 Pas de séparation données / rendu

L'objet `state` mélange des données de domaine (calques, groupes, réglages d'export) avec de l'état d'UI éphémère (`state.recording`, `state.playing`, `state.chunks`) et des références DOM/canvas (`ctx`, `hctx`). Rien ne distingue « ce qui doit être sauvegardé » de « ce qui est juste de la mécanique d'affichage » — d'où la nécessité, visible dans `_serializeState()` (`index.html:4958`), de lister à la main **chaque** champ à extraire pour la sauvegarde, deux fois (une fois pour `_serializeState`, une fois quasi identique pour `_applySnapshot`). Le moindre nouveau champ de calque oublié dans une de ces deux listes est un bug de sauvegarde/undo silencieux.

### 3.4 Bonne pratique à saluer

Le choix d'encapsuler `scenes.js`, `audio.js`, `studio.js` et `extras.js` dans des IIFE avec une API publique explicite (`window.SceneManager`, `window.AudioVO`, `window.Camera`, `window.ExportDriver`, `window.InkExtras`) est la bonne direction — c'est un embryon de modularité qu'il faut généraliser à l'ensemble du code plutôt que de le laisser cohabiter avec un cœur toujours 100 % global.

---

## 4. ⚙️ Performance

### 4.1 L'export vidéo n'est jamais plus rapide que le temps réel

Que ce soit `recordWebM()` (`index.html:9568`) ou `recordMP4()` (`index.html:9686`), l'export **relit l'animation en direct** et capture image par image au rythme de l'horloge murale :
```js
if (performance.now() - _startWall < frameCount * (1000 / FPS)) {
  rafId = requestAnimationFrame(captureFrame);
  return;
}
```
Autrement dit, exporter une vidéo de 90 secondes prend **au moins 90 secondes**, quelle que soit la puissance de la machine — contrairement à un vrai moteur de rendu hors-ligne qui découplerait le rendu de l'horloge réelle et pourrait produire une frame dès qu'elle est prête. Pire : comme la capture tourne sur le même thread principal que le rendu canvas, tout ralentissement pendant l'export (onglet en arrière-plan où `requestAnimationFrame` est throttlé, fenêtre minimisée, autre onglet gourmand) dégrade directement la fluidité de la vidéo produite — ce n'est pas un simple export, c'est un enregistrement d'écran de l'app elle-même.

C'est exactement le type de limitation qui justifierait, comme pour d'autres projets similaires, une **bascule vers un pipeline de rendu déterministe hors navigateur** (rendu frame par frame indépendant de l'horloge, encodage FFmpeg) plutôt que la capture temps réel actuelle. C'est le changement isolé qui aurait le plus d'impact perçu par l'utilisateur (temps d'export divisé potentiellement par 5-10 sur les projets longs, fiabilité de l'export indépendante des performances de l'onglet).

### 4.2 Undo/redo : sérialisation complète de l'état, images incluses, à chaque action

`pushUndoSnapshot()` (`index.html:5016`) appelle `_serializeState()` qui, pour **chaque calque**, régénère une **data URL base64 complète de l'image** (`getImageDataURL(layer.img)`, `index.html:4977`). Cette opération :
- est synchrone et bloque le thread principal (`JSON.parse(JSON.stringify(...))`, encodage base64) à chaque action annulable (déplacer un calque, changer une couleur, taper un caractère dans un champ de texte...),
- duplique en mémoire, pour chaque niveau d'historique (jusqu'à `UNDO_MAX_DEPTH`), le poids total des images du projet — pour un projet à plusieurs calques en 1440p, chaque étape d'undo peut peser plusieurs Mo, multipliés par la profondeur d'historique,
- ne fait aucune déduplication : si une image n'a pas changé entre deux snapshots, elle est quand même ré-encodée et dupliquée intégralement.

**Recommandation :** stocker dans l'historique une **référence** vers l'image (les objets `Image`/blobs sont déjà en mémoire, pas besoin de les re-sérialiser en base64 à chaque undo — seule la sauvegarde IndexedDB en a besoin) et ne cloner en profondeur que les champs scalaires qui changent réellement. Idéalement, passer à un modèle de **patches** (diff entre deux états) plutôt que des snapshots complets.

### 4.3 22 Mo d'images embarquées dans le dépôt et l'installeur

Le dossier `images/` contient 4 mains × 3 résolutions (720p/1080p/1440p) × 2 orientations = 24 PNG, pour 22 Mo. Ces fichiers sont inclus tels quels dans le build Electron (`package.json:"files"`) et gonflent d'autant l'installeur Windows et le poids du dépôt Git. Deux pistes : (a) compresser en WebP (gain probable de 60-80 % à qualité égale), (b) ne stocker **qu'une seule résolution de référence** par main/orientation et laisser le canvas la redimensionner à la volée avec un léger flou de lissage (le code a déjà une fonction `resSoftBlur()` qui compense justement les artefacts de mise à l'échelle — l'infrastructure pour ne garder qu'une résolution existe presque déjà).

### 4.4 Pas de Web Worker pour les traitements lourds

La détection de contours, le pré-rendu (`preRender()`), les algorithmes d'outline (`animations.js`) tournent tous sur le thread principal. Sur des images haute résolution ou des projets à nombreux calques, cela se traduit par des gels d'interface pendant le traitement (aucune preuve directe de `Worker` dans le code — `grep -c "new Worker"` = 0). Déporter ces calculs dans un Web Worker libérerait le thread principal pour l'UI pendant que l'utilisateur continue d'éditer d'autres scènes.

---

## 5. 💾 Fiabilité et intégrité des données

### 5.1 Aucune sauvegarde en dehors du navigateur

Tous les projets vivent exclusivement dans IndexedDB (`WhiteboardAnimatorDB`). Un « Effacer les données de navigation », un profil de navigation privée, une réinstallation de Chrome ou un changement de machine **efface tout**, sans aucun filet de sécurité côté serveur (ce qui est un choix de confidentialité assumé et défendable — voir `PRIVACY.md`) mais aussi sans alternative de sauvegarde automatique locale (export automatique périodique vers un dossier, par exemple). Le seul filet est l'export manuel `.inkstudio.json` (§2.1), que rien n'incite l'utilisateur à faire régulièrement.

**Recommandation :** proposer, dans l'app Electron (qui a accès au système de fichiers, contrairement à la version web), un export automatique périodique vers un dossier « Sauvegardes » choisi par l'utilisateur — le meilleur des deux mondes (confidentialité + résilience).

### 5.2 L'historique d'annulation est vidé au changement de scène — et les opérations de scène ne sont pas annulables

`js/scenes.js:255` et `js/scenes.js:311` appellent `clearUndoHistory()` dès qu'on change de scène. Cela signifie concrètement :
- si vous faites une erreur sur la Scène 2, puis passez à la Scène 3, votre historique d'annulation de la Scène 2 est **perdu** ;
- **supprimer, dupliquer ou réordonner une scène entière n'est pas une action annulable du tout** — aucune trace de `pushUndoSnapshot` dans `scenes.js` avant ces opérations.

Sur un outil de montage où les scènes portent le travail de plusieurs minutes de dessin et de calage voix-off, une suppression accidentelle de scène (un clic malheureux) est **définitivement irréversible**, sans confirmation renforcée visible dans le code (à vérifier côté UI — mais rien côté logique ne protège cette action). Combiné à l'auto-save toutes les 5 secondes, l'erreur est persistée quasi immédiatement.

**Recommandation :** étendre le système d'undo pour qu'il couvre le niveau « liste de scènes » (ajout/suppression/réordre/duplication), pas seulement le contenu d'une scène — et ajouter une confirmation explicite avant suppression de scène si ce n'est pas déjà le cas dans l'UI.

### 5.3 Import de projet non validé (cf. §2.1)

Au-delà du risque XSS, l'absence de validation de schéma expose aussi à des plantages : un JSON malformé, un champ manquant, un type inattendu (nombre au lieu de chaîne, tableau au lieu d'objet) peut faire planter le rendu en aval sans message d'erreur clair pour l'utilisateur, puisque seule la présence de `payload.state` est vérifiée.

### 5.4 Deux systèmes de stockage différents pour des données similaires

Les projets vivent dans IndexedDB, mais les préréglages personnalisés (« custom presets ») sont sauvegardés dans `localStorage` (`_saveCustomPresetsToStorage`, `index.html:7619`). Deux mécanismes de persistance différents pour deux types de données de configuration utilisateur, sans raison technique impérieuse (les presets sont de petite taille et tiendraient très bien dans IndexedDB, ce qui unifierait la logique de sauvegarde/export/backup).

---

## 6. 🧪 Qualité et maintenabilité du code

- **Zéro test automatisé.** Aucun fichier `*.test.js`, aucun framework de test dans `package.json`. Pour un projet de cette taille (18 600 lignes), toute régression ne peut être détectée que manuellement.
- **Aucune CI/CD.** Pas de `.github/workflows` — chaque merge/commit est poussé sans vérification automatique (pas même un lint).
- **Aucun linter/formatter configuré** (pas d'ESLint, pas de Prettier) — le style de code, globalement propre et cohérent, tient uniquement à la discipline manuelle, ce qui ne passe pas à l'échelle avec plusieurs contributeurs.
- **Pas de TypeScript / JSDoc systématique.** L'objet `state` et la forme d'un « layer » sont documentés uniquement par des commentaires épars (`// [{id, name, img, x, y, w, h, animStyle, hand, animOrder, hasPngAlpha}]`, `index.html:5692`) — cette forme réelle contient en fait beaucoup plus de champs (voir `_serializeState`, §3.3), donc le commentaire lui-même est déjà désynchronisé de la réalité du code.
- **Fonctions géantes.** Plusieurs fonctions dépassent 200-300 lignes (`recordMP4`, `applySlices`, `_runGroupAt`...), mélangeant plusieurs responsabilités (validation, calcul, mise à jour DOM, effets de bord réseau/fichier) — difficiles à tester et à faire évoluer sans risque de régression.
- **Mélange français/anglais dans l'UI et le code.** L'interface principale (`index.html`) est en anglais, mais `js/audio.js` truffe l'UI de chaînes françaises en dur (« Enregistrer », « Départ », « Fondu », « Baisser sous la voix »...). Pour un projet hébergé publiquement sur GitHub avec un README en anglais, ce mélange nuit à l'image professionnelle et empêchera toute traduction propre tant qu'il n'y a pas de couche i18n (fichiers de traduction + clés), qui n'existe pas du tout aujourd'hui.
- **`console.log`/`console.warn` de debug résiduels** dans le code livré (13 dans `index.html`, 4 dans `js/audio.js`...) — à auditer un par un pour ne garder que ceux réellement utiles au diagnostic utilisateur.

---

## 7. ♿ Accessibilité — quasiment absente

Mesures objectives sur `index.html` :

| Attribut | Occurrences |
|---|---|
| `aria-*` | 1 (`aria-hidden`) |
| `role=` | 0 |
| `tabindex` | 0 |
| `alt=` | 1 |

Pour une interface qui compte des centaines de boutons (souvent des icônes SVG ou des émojis sans texte alternatif), c'est un vide quasi total : aucune navigation clavier structurée au-delà des raccourcis ad hoc, aucun support de lecteur d'écran, aucun `alt` sur les miniatures de calques (`<img class="layer-thumb" src="${layer.img.src}" alt="">` — `index.html:6474`, `alt` vide). Ce n'est probablement pas la priorité n°1 d'un outil de montage vidéo très visuel, mais un minimum (labels `aria-label` sur les boutons-icônes, `role="dialog"` sur les modales, piège de focus clavier dans les popovers) rendrait l'outil utilisable par plus de monde à coût très faible.

---

## 8. 📱 Plateformes et responsive

Seulement 2 règles `@media` dans tout `index.html` : l'app est conçue exclusivement pour desktop large (le layout fixe avec sidebars suppose un écran ≥ 1280px). C'est un choix raisonnable pour un outil de montage professionnel (personne ne monte une vidéo sérieusement sur mobile), mais cela mérite d'être **assumé explicitement** dans le README (« nécessite un écran desktop, non conçu pour mobile/tablette ») plutôt que laissé implicite — surtout si le produit vise des créateurs qui pourraient tenter de l'ouvrir sur tablette.

Côté desktop natif : Electron uniquement pour **Windows** (`package.json: "win": {...}`, pas de cible `mac`/`linux`). Si l'ambition est d'en faire un outil « complet et utile » au sens large, l'absence de build macOS/Linux limite l'audience dès le départ — à évaluer selon la cible réelle.

---

## 9. 🎬 Catalogue exhaustif — tout ce qu'il faudrait pour en faire l'app ultime

InkStudio fait déjà très bien une chose précise : l'animation whiteboard synchronisée à une voix-off, en multi-scènes. Cette section liste, **sans se limiter à quelques manques évidents**, l'ensemble des fonctionnalités qui séparent l'outil actuel d'un véritable studio de création tout-en-un pour vidéos explicatives/TikTok — en s'appuyant sur ce qui existe déjà dans le code (pour ne proposer que des extensions cohérentes avec l'architecture et la philosophie du projet) plutôt qu'un copier-coller générique de la fiche produit de CapCut.

Chaque item est marqué :
- **[Local]** — faisable 100 % dans le navigateur/Electron, sans service externe, cohérent avec la promesse « rien ne quitte votre machine ».
- **[IA locale]** — nécessite un modèle ML tournant en local (WASM/ONNX Runtime Web/WebGPU) — plus lourd à intégrer mais préserve la confidentialité.
- **[Optionnel/réseau]** — nécessiterait un service ou une API tierce ; à proposer en **opt-in explicite**, jamais par défaut, pour ne pas trahir la promesse actuelle du produit.

### 9.1 Montage & timeline
- **[Local]** Import de **clips vidéo** comme calques (pas seulement images/GIF), pour intercaler du b-roll ou des captures d'écran filmées entre les scènes dessinées.
- **[Local]** **Pistes multiples réellement empilées** (au-delà de layers dans une scène) : une vraie piste « vidéo/image », une piste « voix », une piste « musique », une piste « SFX », une piste « sous-titres », affichées ensemble sur une timeline unique plutôt que dispersées entre la bande de scènes et la piste voix-off.
- **[Local]** **Keyframes multi-points** sur n'importe quelle propriété de calque (position, échelle, rotation, opacité) plutôt que le seul couple Départ/Durée actuel — permettrait des mouvements de caméra ou d'objet complexes sans dessin animé.
- **[Local]** **Courbes d'accélération (easing)** réglables (linéaire, ease-in, ease-out, ease-in-out, rebond) sur les transitions et les mouvements de calque.
- **[Local]** **Speed ramping** : accélérer/ralentir une portion précise de l'animation (utile pour un effet comique ou pour gagner du rythme sur un passage lent).
- **[Local]** **Scènes imbriquées / groupes de scènes** ("séquences") pour organiser un montage long (par exemple regrouper l'intro, le développement, la conclusion) sans tout mettre à plat dans une seule bande de scènes.
- **[Local]** **Marqueurs/chapitres** sur la timeline globale, indépendants des scènes, pour noter des points de repère ("ici commence la partie 2", "ajouter un effet ici").
- **[Local]** **Bibliothèque de médias centralisée** par projet : un pool d'images/GIFs/clips importés une fois, réutilisables sur plusieurs calques/scènes sans réimporter le fichier à chaque fois (et donc sans dupliquer les octets stockés en IndexedDB).
- **[Local]** **Recadrage intelligent (smart reframe)** : à partir d'un même montage, générer automatiquement les variantes 9:16 / 1:1 / 16:9 en recentrant le contenu plutôt qu'en le rognant bêtement — très utile pour republier un même contenu sur TikTok, Instagram carré et YouTube.
- **[Local]** **Historique de versions nommées** ("checkpoints") en plus de la pile d'undo volatile : pouvoir revenir explicitement à "Version avant la scène 4" même après avoir fermé l'onglet, en s'appuyant sur IndexedDB plutôt que sur la seule mémoire vive.

### 9.2 Texte, sous-titres & typographie
- **[IA locale]** **Sous-titres automatiques** générés depuis la voix-off (un modèle de reconnaissance vocale léger tournant en WASM, type whisper.cpp compilé pour le web, permettrait de rester 100 % local) — l'app détecte déjà les silences de la piste voix pour caler les scènes (« ✨ Scènes »), l'infrastructure de timing est donc à moitié là ; il ne manque que la transcription texte.
- **[Local]** **Édition de sous-titres synchronisée à la forme d'onde** existante, avec styles animés (mot par mot en surbrillance façon karaoké, très demandé sur les formats courts).
- **[Local]** **Export des sous-titres en `.srt`/`.vtt`** séparément de la vidéo, pour les plateformes qui préfèrent des pistes de sous-titres à part (accessibilité, SEO YouTube).
- **[IA locale/Optionnel]** **Traduction des sous-titres** dans une ou plusieurs langues (modèle de traduction local léger, ou service externe en opt-in) — pertinent pour un créateur qui veut toucher un public francophone et anglophone avec le même montage.
- **[Local]** **Suggestion automatique de style de texte selon le mot-clé tapé** : le système de presets manga existe déjà (💥 Onomatopée, 📢 Titre, 💬 Dialogue) — l'étendre pour qu'il **détecte** le type de contenu tapé (ex. tout en majuscules + point d'exclamation → suggère automatiquement le preset Onomatopée) plutôt que de forcer l'utilisateur à choisir le preset avant de taper.
- **[Local]** **Import de la police personnelle de l'utilisateur** (upload d'un `.ttf`/`.woff2`) en plus des 18 polices actuelles, pour une identité visuelle propre à chaque créateur.

### 9.3 Audio & son
- **[Local]** **Piste d'effets sonores (SFX) indépendante** de la musique et de la voix — avec une petite bibliothèque de sons courts intégrée (swoosh, pop, ding, clic) livrée avec l'app, cohérente avec l'esprit "tout est déjà là, rien à télécharger".
- **[Local]** **Suggestion automatique de SFX à partir des presets manga déjà existants** : quand un calque "💥 Onomatopée" est placé, proposer en un clic le son correspondant (un "boum" tapé → suggestion d'un bruit d'impact) — lien direct entre une fonctionnalité déjà présente et le nouveau système SFX.
- **[IA locale]** **Réduction de bruit / nettoyage de la voix-off enregistrée au micro** (la fonctionnalité d'enregistrement direct existe déjà — un traitement même basique, égalisation + gate de bruit, ferait une vraie différence sur un enregistrement fait "à l'arrache" dans une pièce non traitée).
- **[Local]** **Suppression automatique des silences** de la voix-off en un clic (au-delà de leur simple détection actuelle pour le calage de scènes) — resserre le montage sans réenregistrer.
- **[IA locale/Optionnel]** **Détection et suppression des mots de remplissage** ("euh", "du coup", "genre") repérés sur la transcription des sous-titres, avec retrait synchronisé de l'audio et de la vidéo.
- **[Local]** **Synchronisation au rythme de la musique** ("beat sync") : détecter les temps forts d'une piste musicale et proposer de caler automatiquement les coupures de scène dessus — très utilisé dans le montage type CapCut pour dynamiser un montage.
- **[Local]** **Réglage de tonalité/vitesse de la voix-off sans changer le débit** (time-stretch préservant le pitch), utile pour ajuster une narration un peu trop longue pour tenir dans une scène sans la faire sonner "chipmunk".

### 9.4 Génération assistée & IA créative
*(Cette catégorie est la plus sensible vis-à-vis de la promesse "100 % local, aucune donnée envoyée" du projet — à traiter uniquement en fonctionnalités clairement opt-in, jamais activées par défaut, avec un message explicite avant tout envoi de données.)*
- **[Optionnel]** **Génération d'images à partir d'un prompt texte**, pour créer directement les dessins/illustrations d'une scène sans avoir à les dessiner ou les trouver soi-même — pertinent vu que l'app anime déjà n'importe quelle image importée.
- **[Optionnel]** **Voix-off synthétique (text-to-speech) à partir du script**, avec choix de voix — utile pour prototyper le timing d'une vidéo avant d'enregistrer sa vraie voix, ou pour les créateurs qui préfèrent une voix de synthèse.
- **[Optionnel]** **Suppression d'arrière-plan automatique** sur une image importée (utile pour isoler un sujet avant de l'animer en calque, sans avoir à le détourer à la main).
- **[Optionnel]** **Assistant de découpage de script** : coller un texte de narration long et le faire découper automatiquement en scènes suggérées (avec estimation de durée par scène à partir du débit de lecture moyen), qui viendraient peupler le multi-scène existant.

### 9.5 Habillage, marque & templates
- **[Local]** **Kit de marque réutilisable** : enregistrer une fois une palette de couleurs, une police, un logo/watermark, puis l'appliquer en un clic à n'importe quel nouveau projet — au-delà des presets d'animation actuels qui ne couvrent que les réglages de dessin.
- **[Local]** **Watermark/logo permanent optionnel**, positionnable et redimensionnable, qui persiste sur toutes les scènes sans avoir à le dupliquer manuellement calque par calque.
- **[Local]** **Modèles de projet ("templates") réutilisables** : un gabarit "intro + 3 scènes de développement + outro" avec habillage pré-rempli, à dupliquer pour démarrer une nouvelle vidéo plus vite qu'une page blanche.
- **[Local]** **Import de calques vectoriels natifs (SVG)**, pas seulement des PNG rastérisés — permettrait un détourage parfait sans dépendre des algorithmes de détection de contour actuels, et une mise à l'échelle sans perte à n'importe quelle résolution.
- **[Local]** **Import du style d'écriture personnel de l'utilisateur** (au-delà des 4 mains génériques actuelles) — par exemple faire tracer la main avec une police "manuscrite" custom générée depuis l'écriture réelle de l'utilisateur, pour une signature visuelle unique.

### 9.6 Organisation de projet, historique & production
- **[Local]** **Dossiers/tags pour organiser les projets** dans la modale "Projects", qui aujourd'hui n'est qu'une liste plate triée par date de modification.
- **[Local]** **Recherche dans les projets** (par nom, par date, par tag).
- **[Local]** **Annotations/notes de production** attachées à une scène (ex. "revoir le timing ici", "remplacer cette image") — utile pour un créateur qui travaille sur une vidéo en plusieurs sessions étalées.
- **[Local]** **Export/sauvegarde automatique périodique vers un dossier local** (déjà recommandé en §5.1, à rattacher ici comme fonctionnalité produit et pas seulement comme correctif de fiabilité).
- **[Optionnel]** **Historique de versions synchronisé sur un service de stockage personnel** (Google Drive, Dropbox...) en toute transparence et opt-in, pour ceux qui veulent un filet de sécurité au-delà du disque local — sans jamais transiter par un serveur propre à InkStudio, cohérent avec le positionnement "aucune infrastructure à moi qui reçoive vos données".

### 9.7 Export, formats & diffusion
- **[Local]** **Presets d'export par plateforme** au-delà du seul 9:16 TikTok actuel : YouTube Shorts, Instagram Reels, YouTube 16:9, LinkedIn carré — mêmes contraintes de zone de sécurité et de durée, juste des étiquettes et des valeurs par défaut différentes à ajouter à ce qui existe déjà.
- **[Local]** **Export multi-format en une seule passe** (un clic → génère la version TikTok, YouTube et carrée du même montage) en s'appuyant sur le recadrage intelligent de §9.1.
- **[Local]** **Export par lots de plusieurs projets** à la suite (utile pour un créateur qui a une file de vidéos prêtes et veut lancer tous les rendus d'un coup, par exemple la nuit).
- **[Local]** **Réglages d'export avancés** : bitrate personnalisé au-delà des 3 paliers actuels (low/medium/high), choix du framerate (24/30/60 fps), export en boucle GIF pour prévisualisation rapide sur les réseaux qui l'acceptent.
- **[Local]** **Export image par image (sprite sheet / PNG séquence)** pour les utilisateurs qui veulent reprendre le montage final dans un autre logiciel de montage classique.

### 9.8 Accessibilité & internationalisation *(rejoint §7 et §6 mais du point de vue fonctionnalité, pas seulement conformité)*
- **[Local]** **Piste d'audiodescription** optionnelle en plus des sous-titres, pour les vidéos destinées à un public malvoyant.
- **[Local]** **Interface multilingue réelle** (FR/EN au minimum) via une couche i18n — condition préalable pour que le mélange français/anglais relevé en §6 ne soit plus juste un défaut de code mais une vraie fonctionnalité choisie par l'utilisateur.
- **[Local]** **Vérificateur de contraste texte/fond** avant export, pour alerter si un texte incrusté risque d'être illisible sur mobile (police trop fine, contraste trop faible) — spécifiquement utile pour un outil pensé "TikTok toolkit".

### 9.9 Productivité & personnalisation de l'outil
- **[Local]** **Raccourcis clavier personnalisables**, au-delà de la liste fixe actuelle.
- **[Local]** **Panneau de calques repliable par groupe** avec recherche/filtre, utile dès qu'un projet dépasse une dizaine de calques par scène.
- **[Local]** **Mode "présentation live"** : rejouer le dessin en direct sur un second écran ou en partage d'écran pendant un live/stream, sans passer par un export vidéo — détourne intelligemment le moteur d'animation existant vers un nouvel usage (dessin en direct) plutôt qu'un export figé.
- **[Local]** **Système de plugins pour styles d'animation personnalisés** : exposer une API stable pour que la communauté ajoute ses propres algorithmes de dessin à côté des styles intégrés (Chunk Jump, Scanner, Contour...), en s'appuyant sur l'architecture déjà modulaire de `window.AnimationEngine`.

### 9.10 Ce qui est déjà un choix assumé, pas un manque
Pour être honnête dans l'audit : certains "manques" qu'une comparaison naïve avec CapCut/Premiere ferait remonter ne sont pas des lacunes mais des **choix de positionnement** cohérents avec la promesse actuelle du produit, et devraient rester ainsi sauf décision explicite du contraire :
- Zéro collaboration multi-utilisateur en temps réel — cohérent avec un outil personnel, local-first.
- Aucun compte ni connexion à un serveur central — c'est l'argument de vente principal (`PRIVACY.md`), à préserver dans toute nouvelle fonctionnalité (voir le marquage **[Optionnel]** ci-dessus, toujours opt-in).
- Aucune intégration de publication directe vers les plateformes — cohérent avec "l'app télécharge un fichier, point" ; à n'ajouter qu'en option clairement documentée si un jour souhaité.

---

## 10. 🗺️ Feuille de route priorisée

### 🔥 Quick wins (quelques heures à 1-2 jours chacun, fort impact)
1. Corriger la faille XSS (`innerHTML` → `textContent`/échappement systématique) — §2.1.
2. Mettre à jour `PRIVACY.md` (renommage + divulgation micro/CDN) — §2.4.
3. Ajouter la validation de schéma à l'import de projet — §2.1/§5.3.
4. Étendre l'undo aux opérations de scène (suppression/réordre/duplication) — §5.2.
5. Retirer les `console.log` de debug résiduels — §6.
6. Ajouter des `aria-label` sur les boutons-icônes principaux (barre d'outils, export, lecture) — §7.
7. Documenter explicitement dans le README les contraintes desktop-only/Windows-only — §8.
8. Ajouter un attribut `integrity` au fallback CDN, ou le retirer si jugé inutile en pratique — §2.3.

### 🛠 Moyen terme (quelques semaines, un axe à la fois)
1. Alléger l'undo/redo (référencer les images en mémoire au lieu de les ré-encoder en base64 à chaque action) — §4.2.
2. Compresser/réduire les assets d'images de mains (WebP, une seule résolution de base + mise à l'échelle) — §4.3.
3. Introduire une couche i18n minimale (fichiers de clés FR/EN) pour unifier la langue de l'UI — §6.
4. Ajouter un export de sauvegarde automatique périodique côté Electron — §5.1.
5. Sortir la détection de contours/le pré-rendu vers un Web Worker — §4.4.
6. Ajouter des sous-titres auto-générés à partir des timestamps de silence déjà détectés dans la voix-off — §9.2 (le gain perçu par les utilisateurs serait sans doute le plus élevé de toute cette liste).

### 🏗 Refonte long terme (chantier structurant)
1. **Migrer vers des modules ES + un bundler léger (Vite)** : découper les ~5 450 lignes du script inline principal en modules par domaine (`state.js`, `layers.js`, `export.js`, `undo.js`, `presets.js`...), avec de vrais `import`/`export` plutôt que des globales partagées. Peut se faire de façon incrémentale, fichier par fichier, sans tout casser d'un coup.
2. **Séparer les templates HTML de la logique** : remplacer les gros blocs `el.innerHTML = \`...\`` par soit de petits helpers de création de DOM, soit un moteur de templating léger (lit-html, ou même de simples fonctions de rendu), ce qui règle en même temps une bonne partie du problème XSS et ouvre la voie à un CSP strict.
3. **Passer le rendu vidéo à un pipeline déterministe** (rendu frame-par-frame indépendant de l'horloge murale), quitte à rester dans le navigateur via OffscreenCanvas, pour un export plus rapide que le temps réel — §4.1. C'est le changement qui rapprocherait le plus InkStudio d'un « vrai » logiciel de montage en termes de sensation d'usage.
4. **Ajouter des tests** (au minimum des tests unitaires sur la logique pure — sérialisation d'état, calculs de timing de scène/voix-off — et un test end-to-end de fumée sur le flux création → export).
5. **Mettre en place une CI** (lint + tests) sur chaque push/PR, même minimale.

---

## 11. Proposition d'architecture cible (à titre indicatif)

```
inkstudio/
├── src/
│   ├── core/
│   │   ├── state.js          # état central + schéma explicite (types/JSDoc)
│   │   ├── undo.js           # historique par patches, pas par snapshot complet
│   │   └── project-io.js     # save/load/import/export avec validation de schéma
│   ├── engine/
│   │   ├── animation-engine.js   # ex-animations.js, en modules
│   │   └── outline-*.js          # un fichier par algorithme de détection
│   ├── scenes/
│   │   └── scene-manager.js      # ex-scenes.js
│   ├── audio/
│   │   └── voice-over.js         # ex-audio.js
│   ├── studio/
│   │   ├── camera.js
│   │   ├── stickers.js
│   │   └── shapes.js
│   ├── export/
│   │   ├── webm-recorder.js
│   │   └── mp4-recorder.js       # + à terme : rendu déterministe hors horloge
│   ├── ui/
│   │   └── components/           # petits modules de rendu DOM, sans innerHTML brut de données utilisateur
│   └── main.js                   # point d'entrée, câblage des modules
├── electron/
│   └── main.js
├── tests/
│   ├── unit/
│   └── e2e/
├── .github/workflows/ci.yml
├── vite.config.js
└── package.json
```

Cette structure permettrait d'introduire les tests, le linting et un vrai découplage progressivement, module par module, **sans réécrire l'application d'un coup** — chaque fichier `js/*.js` existant peut migrer indépendamment vers ce squelette, en commençant par les modules déjà les plus isolés (`scenes.js`, `audio.js`, `studio.js`, qui ont déjà une API publique claire).

---

## 12. Conclusion

InkStudio est, fonctionnellement, très en avance sur ce qu'on attendrait d'un projet perso de cette taille — la synchronisation voix-off avec calage automatique sur les respirations, la caméra automatique façon Ken Burns, ou les formes dessinées à la main sont des fonctionnalités que peu d'outils gratuits proposent ensemble. Le vrai risque aujourd'hui n'est pas fonctionnel, il est dans la **dette technique et la sécurité** : une faille XSS stockée concrètement exploitable, un historique d'annulation qui peut faire perdre des scènes entières sans recours, et une architecture 100 % globale qui va rendre chaque nouvelle fonctionnalité de plus en plus coûteuse à ajouter sans tout casser.

La bonne nouvelle : rien de tout cela n'exige de repartir de zéro. Les correctifs de sécurité et de fiabilité des données (§2, §5) peuvent être traités en quelques jours. La modularisation (§10.3, §11) peut se faire fichier par fichier, en s'appuyant sur les IIFE déjà en place dans `scenes.js`/`audio.js`/`studio.js` comme modèle à généraliser.
