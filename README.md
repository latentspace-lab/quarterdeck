# ⛵ Segel-Simulator 3D — Webbasiert

Ein spielbarer **3D-Segel-Simulator** im Browser, gebaut mit **Vite + Three.js**.
Reine 3D-Optik (Wasser-Shader, Wellen, Himmel, Sonne, Wolken, Schiff mit Masten & Segeln)
und **semi-realistische Segelphysik**: scheinbarer Wind, Segelkurse (TWA/Point-of-Sail),
Polar-Kurve, VMG, Gier (Heel), Kenter, Backen (Luffing) — plus **drei Spielmodi**.

Gesegelt wird wahlweise eine moderne Yacht oder einer von **drei Rahseglern der
Royal Navy** aus der Hornblower-Ära — bis hinauf zum 74-Kanonen-Linienschiff,
inklusive **Breitseiten**.

> „3D Optik" im Sinne von 3D-Grafik: echte 3D-Szene mit WebGL, kein Karten-Top-Down.

---

## Schnellstart

```bash
npm run dev
```

Danach im Browser öffnen: **http://localhost:5173/**

```bash
npm run build     # Produktions-Build → ./dist
npm run preview   # Build testen → http://localhost:4173/
```

> **Wichtig:** Befehle immer **ohne** angehängten Kommentar ausführen.
> In zsh ist `#` interaktiv standardmäßig *kein* Kommentar — `npm run dev  # → ...`
> übergibt `#`, `→`, `http://...` als Argumente an vite und der Start bricht mit
> `Unused args` ab.

> Die Abhängigkeiten `three` + `vite` befinden sich bereits in `node_modules/`.
> Falls `npm install` über den globalen npm-Cache klagt (EPERM), den Cache lokal
> umleiten: `npm install --cache "$(pwd)/.npmcache" three vite`.

---

## Steuerungen

| Taste | Aktion |
|-------|--------|
| **A / D** oder **← / →** | Ruder — Backbord / Steuerbord (Kurs ändern) |
| **W / S** | Yacht: Segel trimmen · Rahsegler: Segel **setzen / reffen** |
| **Q / E / F** | Breitseite **Backbord** / **Steuerbord** / **beide** |
| **V** | Schiff wechseln (ohne Umweg übers Menü) |
| **C** oder **1–4** | Kamera: **1** Verfolger · **2** Cockpit · **3** Draufsicht · **4** Orbit |
| **M / Esc** | Menü / Pause |
| **R** | Kurs (Regatta) / Übung (Training) zurücksetzen |
| **G** | Wind-Gusts & Veer an/aus |
| **H** | HUD ein/aus |
| **Leertaste** | Boot nach Kenter aufrichten |
| **Mausrad** | Zoom · **Maus ziehen** | Ansicht drehen |

> **Grundregel:** Du steuerst den **Kurs** (den Ruder). Daraus ergibt sich der
> **Segelkurs TWA** zum Wind und damit die Geschwindigkeit — das klassische
> „point-and-go" der Segelphysik.

---

## Die drei Spielmodi

1. **Freeride** — Frei auf offener See segeln, Wind erleben, Manöver üben.
2. **Regatta** — Ein **Windward-Leeward-Kurs** (Startlinie → Windward-Wendeboje
   → Leeward-Wendeboje → Ziellinie). Runden-Zeitnahme + Bestzeit, Fortschritt,
   Distanz & Kompass-Rgk zur nächsten Boje.
3. **Training** — Reihenfolge von **Übungen** (Krausen halten, Upwind-VMG,
   Wenden/Halse, Raumschot, Gieren, Kenter vermeiden, Boje erreichen)
   mit Fortschrittsleiste.

---

## Die Schiffe

Im Startmenü (und im Spiel mit **V**) wird das Schiff gewählt. Jedes hat eine
eigene Polarkurve, No-Go-Zone, Drehrate, Trägheit und Krängungsneigung — die
Unterschiede sind spürbar, nicht kosmetisch.

| Schiff | Rate | LüA | Am Wind | Breitseite | Charakter |
|--------|------|-----|---------|-----------|-----------|
| **Nordwind** | Bermuda-Sloop | 11 m | 32° | — | Leicht, kreuzt hoch, dreht auf dem Teller |
| **HMS Hotspur** | 20-Kanonen-Sloop-of-War | 28 m | 62° | 90 lb | Kleinster Rahsegler, flink und dünnhäutig |
| **HMS Lydia** | 36-Kanonen-Fregatte | 43 m | 65° | 234 lb | Der klassische Hornblower |
| **HMS Sutherland** | 74-Kanonen-Zweidecker | 52 m | 68° | 700 lb | Träge wie eine Kirche, zwei Decks Eisen |

### Warum sich ein Rahsegler anders anfühlt

- **Er kommt nicht hoch an den Wind.** Bei etwa **sechs Strich** (62–68° je nach
  Schiff) ist Schluss; darunter liegen die Segel back und die Fahrt läuft aus.
  Das ist keine Willkür, sondern folgt direkt aus dem Brassen (siehe unten).
- **Sein schnellster Kurs liegt achterlicher.** Während die Yacht am Beam (~105°)
  am besten läuft, ist es bei den Rahseglern die **Backstagsbrise** bei ~140°.
- **Masse bedeutet Trägheit.** Die Fregatte braucht gut zwei Minuten bis zur
  vollen Fahrt, das Linienschiff noch länger. Anluven, Abfallen und Wenden
  dauern — man muss vorausdenken. Beim Durchgehen durch den Wind behält das
  Schiff „Fahrt im Schiff", sonst käme es nie herum.
- **Er kentert praktisch nicht.** Breiter Rumpf, viel Ballast: selbst bei 34 kn
  bleibt die Fregatte steif. Dafür macht sie deutlich mehr Leeweg.
- **W / S setzt und refft die Segel.** Weniger Tuch heißt weniger Fahrt, aber
  auch weniger Krängung — im Sturm die richtige Antwort.

### Brassen (warum die Rahen so stehen, wie sie stehen)

Die Rahen drehen sich mit dem scheinbaren Wind nach der Regel

```
Rahwinkel = 90° − |AwA| / 2,   begrenzt auf 45°
```

Vor dem Wind (AwA 180°) stehen die Rahen **quer**, am Beam (90°) sind sie mit
45° **am Anschlag** — schärfer ließ die Takelage sich nicht brassen. Genau
dieser Anschlag ist der physikalische Grund für die große No-Go-Zone: unter
etwa 65° AwA kann das Segel nicht mehr angestellt werden und fällt back.
Die luvseitige Rahnock geht dabei nach achtern, das Tuch wölbt sich nach Lee.

### Die Geschütze

**Q** feuert die Backbord-, **E** die Steuerbord-, **F** beide Breitseiten.

- Die Bedienungen lösen **versetzt** aus — der Donner rollt vom Bug nach achtern.
- Jedes Rohr erzeugt Mündungsfeuer, eine Pulverwolke und eine Kugel, die
  ballistisch fällt und eine **Einschlagfontäne** setzt.
- Der Rauch **treibt mit dem Wind ab**: zu Lee steht man schnell im eigenen Qualm.
- Der Rückstoß gibt einen kurzen **Krängungsstoß** zur Gegenseite, die Rohre
  fahren zurück und werden wieder ausgerannt.
- **Nachladen** dauert 9 s (Sloop) bis 13 s (Linienschiff), je Seite getrennt.
  Der Balken im HUD zeigt den Fortschritt.

---

## Die Physik (semi-realistisch)

Im Kern (siehe `src/physics.js`, voll testbar unter `tests/`):

- **True Wind Angle (TWA)** aus Bootskurs und Windrichtung — mit Vorzeichen
  (Port/Stbd-Tack). Kein direkter Wind (No-Go-Zone < 32° → **Backen/Luffing**).
- **Scheinbarer Wind (AwA)** = Zusammensetzung von Echtem Wind und Bootsgeschwindigkeit
  (Vektor-Addition).
- **Polar-Kurve**: Boots-Speed als Funktion von TWA & Windstärke (Beaufort-skaliert).
  Beam-Reach (~90°) ist der schnellste Windkurs; optimaler Upwind-VMG liegt bei ~45° TWA.
- **VMG** (Velocity Made Good): Up- und Downwind-Fortschritt, im HUD sichtbar.
- **Gier (Heel)** — steigt mit Wind und Upwind-Winkel; bei extremem Wind → **Kenter**
  (Automatisches Aufrichten, oder mit Leertaste).
- **Leeway**, **Ruderautorität** (geschwindigkeitabhängig), **Backen** mit Bug-Druck.
- **Wind** mit Gusts & Veer (schwankende Stärke/Richtung), einstellbar.

### 3D-Wasser & -Boot (an die Windphysik gekoppelt)

- **Gerstner-Wellenmeer** (`ocean.js`): echte trochoidale Wellen mit horizontaler
  Verschiebung — scharfe Kämme, flache Täler, 6 überlagerte Wellenlängen, deren
  Laufrichtung der **Windrichtung** folgt. Wellenhöhe skaliert mit der Windstärke.
  JS und GLSL benutzen dieselbe Wellentabelle → das Boot sitzt **exakt** auf der
  sichtbaren Welle (Auftrieb, Pitch & Roll aus echter Wellenneigung).
  Shading: Fresnel-Himmelsspiegelung, Sonnenfunkeln, Streulicht durch die Kämme,
  Schaum an gequetschten Wellenbergen (Jakobi-Determinante), Horizont-Dunst.
- **Windgerechte Segel** (`boat.js`/`game.js`): der **Baumwinkel folgt dem
  scheinbaren Wind** — eng am Wind fast mittschiffs, auf Raumwinden raus, vor dem
  Wind quer (±~90°), **immer auf der Leeseite** (schlägt beim Wenden/Halsen über).
  Großsegel hängt exakt am schwenkenden Baum, die Fock an ihrer Schot; das Tuch
  wölbt sich nach Lee, wird auf Raumwinden voller, flattert in der **No-Go-Zone**.
- **Echte Rumpfform**: aus Stationsquerschnitten gelofter Rumpf mit spitzem Bug,
  klassischer Scheuerlinie, Spiegelheck, Wasserpass-Band und Antifouling unter
  der Wasserlinie; dazu Flossenkiel mit Rumpfbirne, Ruderblatt, Vorstag/Backstag/
  Wanten, Reling und Cockpit.

---

## Projektstruktur

```
segel-simulator/
├─ index.html            # Viewport + HUD + Menü + Kompass-Canvas
├─ vite.config.js
├─ package.json
├─ src/
│  ├─ main.js            # Einstiegspunkt (Renderer-Loop, WebGL-Fallback)
│  ├─ game.js            # Simulations-Loop: bindet Szene/Boot/Physik/Kamera/Modi/UI
│  ├─ physics.js         # Kernphysik (Test: tests/physics.test.js)
│  ├─ wind.js            # Wind (Gusts, Veer, Beaufort)
│  ├─ ocean.js           # Gerstner-Wellenmeer, windabhängig (JS ↔ GLSL identisch)
│  ├─ scene.js           # Szene: Himmel, Sonne, Lichter, Wolken
│  ├─ boat.js            # 3D-Yacht: gelofteter Rumpf, Rigg, windgetriebene Segel
│  ├─ vessels.js         # Schiffskatalog: Masse, Polarkurven, Dynamik, Batterien
│  ├─ warship.js         # 3D-Rahsegler: Rumpf mit Stückpforten, Masten, Rahsegel
│  ├─ guns.js            # Breitseiten: Mündungsfeuer, Rauch, Kugeln, Nachladen
│  ├─ camera.js          # Kamera-Regie (4 Modi + Maus-Orbit)
│  ├─ controls.js        # Tastatur-/Maussteuerung
│  ├─ marks.js           # Regatta-Kurs: Bojen, Start- & Ziellinie, Runden
│  ├─ trainer.js         # Trainings-Herausforderungen (Edge- & Zeit-Logik)
│  ├─ ui.js              # 2D-HUD + 2D-Kompass + Menü + Trainings-Panel
│  └─ styles.css         # Optik
└─ tests/
   ├─ physics.test.js    # 20 Einzelfalltests (Knoten/Winkel/Polar/Kenter)
   ├─ sim.smoke.js       # 10 Integrationssimulationen (Wenden/Gieren/Kenter/Gusts)
   ├─ visual.test.js     # 31 Checks: Gerstner-Wellen, Segel/Baum/Rumpf (headless)
   └─ vessels.test.js    # 72 Checks: Katalog, Rahsegler-Physik, Brassen, Batterie
```

---

## Tests

```bash
npm test                     # alle vier Suiten, 133 Checks

# oder einzeln:
node tests/physics.test.js   # 20/20
node tests/sim.smoke.js      # 10/10
node tests/visual.test.js    # 31/31 (Gerstner-Wellen + Segel-3D, headless)
node tests/vessels.test.js   # 72/72 (Schiffe, Brassen, Geschütze, headless)
```

Die Tests brauchen **kein npm-Installation** (reines Node, nur für `physics`/`wind`/`trainer`):
`node tests/sim.smoke.js`.

---

## Erweiterbar

- **Segeltypen** (Genua, Spinnaker): neue Segel-Meshes in `boat.js`, Trim-Verhalten in `physics.js`.
- **Kursvarianten**: `marks.js` — `legs[]`-Array erweitern (z. B. Offset-Boje, Gate-Kreuzung).
- **Training**: `trainer.js` — neue Challenge-Objekte `{title,desc,dur,ok(edge)}`.
- **Wetter**: `wind.js` `variability/gust/veer` anheben; `scene.js` Sonne/Beaufort.
- **Polar-Kurve**: `POLAR_15KTS` in `physics.js` anpassen.
- **Neues Schiff**: Eintrag in `VESSELS` (`vessels.js`) — Rumpfmaße, Polarkurve,
  `noGo`, Dynamik und optional `guns`. Rigg `"square"` baut automatisch einen
  Rahsegler, alles andere die Yacht. Menü, HUD, Kamera und Trainer ziehen nach.
- **Bewaffnung**: `guns.decks[]` — jedes Deck bekommt Höhe (Bruchteil des
  Freibords), Anzahl Rohre je Seite, Längsbereich und Kaliber.

---

## Hinweise / Grenzen (semi-realistisch, bewusst vereinfacht)

- Alle Schiffe sind geloftete 3D-Rümpfe aus Stationsquerschnitten (prozedural, kein importiertes Mesh).
- Die Geschütze schießen ins Leere: es gibt (noch) kein Ziel und keinen Trefferschaden.
  Fall of Shot wird gezeigt, getroffen wird nichts.
- Leeweg (Drift) und Ruderautorität sind vereinfacht, aber die **Qualitative** des
  Verhaltens (Krausen, Wenden, Gieren, VMG, Kenter) ist realistisch.
- Kein Wellen-Boot-Kontakt-Rendering (Boot „schwimmt" auf der berechneten Wasserhöhe,
  die exakt dem Wasser-Shader entspricht → keine Auf-/Abreißer an der Waterline).

## Lizenz
Frei zum Experimentieren, Umbauen und Lernen.
