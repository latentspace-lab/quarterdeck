# ⛵ Segel-Simulator 3D — Webbasiert

Ein spielbarer **3D-Segel-Simulator** im Browser, gebaut mit **Vite + Three.js**.
Reine 3D-Optik (Wasser-Shader, Wellen, Himmel, Sonne, Wolken, Schiff mit Masten & Segeln)
und **semi-realistische Segelphysik**: scheinbarer Wind, Segelkurse (TWA/Point-of-Sail),
Polar-Kurve, VMG, Gier (Heel), Kenter, Backen (Luffing) — plus **drei Spielmodi**.

Gesegelt wird wahlweise eine moderne Yacht oder einer von **drei Rahseglern der
Royal Navy** aus der Hornblower-Ära — bis hinauf zum 74-Kanonen-Linienschiff,
inklusive **Breitseiten**. Im Modus **Gefecht** steht ein französischer Gegner
in Luv, und die Schiffe gehen dabei kaputt: Masten fallen über Bord und
schleppen als Wrack längsseit, Lecks unter Wasser lassen sich nur begrenzt
lenzen, und Holzsplitter, Rundhölzer und Segelfetzen treiben als richtige
Starrkörper davon.

> „3D Optik" im Sinne von 3D-Grafik: echte 3D-Szene mit WebGL, kein Karten-Top-Down.

---

## Schnellstart

```bash
npm run dev
```

Danach im Browser öffnen: **http://localhost:5173/**

```bash
npm run build     # Produktions-Build → packages/client/dist
npm run preview   # Build testen → http://localhost:4173/
npm run typecheck # TypeScript in shared/ und server/ prüfen
npm run server    # game server (Colyseus) on ws://0.0.0.0:2567 — PORT/HOST override
npm run server:headless  # run a simulation without browser or socket, print timings
npm test          # alle Testebenen
```

### Multiplayer

```bash
npm run server   # terminal 1: game server on ws://0.0.0.0:2567
npm run dev      # terminal 2: client on http://localhost:5173/sailing/
```

In the menu choose **Multiplayer**: the open rooms on the server are listed
(name, players, AI enemies, wind) with a Join button each. Or pick a ship and
press Join to enter any open room — or create one, with the room name, wind
and the AI enemies from the scenario cards. **Practice** creates a private
one-seat room against the AI on the server. Deep link:
`http://localhost:5173/sailing/?mp=1&server=ws://localhost:2567&vessel=lydia&name=Hornblower&enemies=amelie&roomName=Trafalgar`
(`&mode=practice` for a practice room, `&room=<id>` to join a specific one).

What is shared: ships, wind, sea, damage, masts, collisions, grounding and
gunnery come from the server. Q/E/F order a broadside; the server fires it,
every client plays the salvo, the balls (with the server's exact ballistics)
and the hits. The helm is predicted: your ship answers the rudder at once,
and every acknowledged server state is replayed with the inputs the server
has not seen yet - the two agree to the centimetre unless something the
server alone knows (a collision, the ground) intervened, and then the
picture eases onto the corrected place instead of jumping.

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
| **Z** | Ladung wechseln: Vollkugel · Kettenkugel · Kartätsche |
| **X** | Wrack kappen (gefallenen Mast loswerden) |
| **V** | Schiff wechseln (ohne Umweg übers Menü) |
| **Mausrad / Ziehen** | Zoom / Ansicht — aus der Nähe sieht man die Besatzung arbeiten |
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

## Die Parteien

Zuerst wird die **Flagge** gewählt, dann das Schiff. Die Partei bestimmt, welche
Schiffe zur Verfügung stehen, wie sie aussehen, wie gut die Bedienungen sind —
und wer einem gegenübersteht.

| Partei | Schiffe | Eigenart |
|--------|---------|----------|
| **Royal Navy** | Hotspur · Lydia · Sutherland | Beste Geschützausbildung der Welt. Schießt in den **Rumpf** und nimmt den Gegner. |
| **Marine Impériale** | Hirondelle · Amélie · Vengeur | Größer und schneller gebaut. Schießt in die **Takelage**, um sich abzusetzen. |
| **Armada Española** | Descubierta · El Gamo · San Juan Nepomuceno | Spanten wie Kathedralenpfeiler — steckt am meisten weg, feuert am langsamsten. |
| **Piraten** | Seeteufel · Rache · Schwarze Krone | Alles erbeutet: dünnhäutig, schnell, riesige Enterbesatzung, miserable Kanoniere. **Streichen nie die Flagge.** |

Jede Partei stellt ein Schiff in drei Größenklassen: Korvette/Sloop, Fregatte,
Linienschiff. Die Gefechtslagen sind über diese Klassen definiert, nicht über
feste Schiffe — deshalb funktioniert jede Lage mit jeder Paarung. Wer als
Spanier ins Einzelgefecht geht, bekommt einen gleich großen Briten vor den Bug.

Die Yacht *Nordwind* steht in jeder Partei als Übungsboot zur Verfügung.

Jede Partei führt ihre eigene Flagge (White Ensign, Tricolore, die spanische
Rot-Gelb-Rot, den Totenkopf) und ihren eigenen Anstrich — das Nelson-Schachbrett
in Ocker, den französischen roten Strake, spanisches Dunkelrot mit Gelb, und bei
den Piraten verwittertes Schwarz mit dem Rest dessen, was der Vorbesitzer
aufgemalt hatte. Im Pulverdampf erkennt man Freund und Feind daran auf einen Blick.

---

## Die Schiffe

Im Startmenü (und im Spiel mit **V**, innerhalb der eigenen Partei) wird das
Schiff gewählt. Jedes hat eine
eigene Polarkurve, No-Go-Zone, Drehrate, Trägheit und Krängungsneigung — die
Unterschiede sind spürbar, nicht kosmetisch.

Beispiel Royal Navy (die anderen Parteien entsprechend):

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

## Gefecht und Schäden

Im Modus **Gefecht** wählt man zusätzlich die Lage: Einzelgefecht, Übermacht
(zwei Gegner) oder gegen ein Linienschiff. Der Gegner ist KI-geführt und kann
nur, was der Spieler auch kann — er segelt nicht gegen den Wind und läuft nicht
schneller als seine Polarkurve.

### Munition (Taste **Z**)

| Ladung | Wirkung | Reichweite |
|--------|---------|-----------|
| **Vollkugel** | Durchschlägt die Bordwand, schlägt Rohre aus, reißt Lecks | voll (~550 m) |
| **Kettenkugel** | Mäht Takelage und Segel nieder, lässt den Rumpf heil | kurz (~300 m) |
| **Kartätsche** | Schwarm kleiner Kugeln, fegt das Deck und die Bedienungen | sehr kurz (~150 m) |

Die Royal Navy schoss auf den **Rumpf** (Gegner niederkämpfen), die französische
Marine bevorzugt in die **Takelage** (manövrierunfähig machen und entkommen).
Beide Doktrinen stecken in der KI und führen zu spürbar verschiedenen Gefechten.

### Warum auf Distanz kaum etwas trifft

Die Rohre werden auf eine **geschätzte** Entfernung gerichtet, und der
Schätzfehler wächst mit der Distanz. Dazu kommt die Rollbewegung im Moment des
Abfeuerns — ein Grad Rollen ist auf 400 m schon ein Schiff daneben. Darum wurde
„auf der Rolle" geschossen, und darum sehen die Trefferquoten so aus:

| Entfernung | Vollkugel | Kettenkugel | Kartätsche |
|-----------:|----------:|------------:|-----------:|
| 50 m | ~100 % | ~100 % | ~95 % |
| 200 m | ~66 % | ~99 % | ~85 % |
| 300 m | ~36 % | ~98 % | ~20 % |
| 600 m | ~11 % | — | — |

### Was kaputtgehen kann

- **Rumpf** — sechs Abschnitte (Bug/Mitte/Achterschiff × Backbord/Steuerbord).
  Ein Schiff ist erledigt, wenn *eine* Seite aufgerissen ist. Die Bordwandstärke
  skaliert mit der Größe: was eine Sloop durchschlägt, prallt am Zweidecker ab.
  Im HUD zeigt ein **Rumpfplan** jeden Abschnitt einzeln — ein Mittelwert über
  den ganzen Rumpf verschweigt genau das, worauf es ankommt: *wo* sie getroffen
  ist. Eine zerschossene Breitseite ist etwas anderes als gleichmäßiger
  Verschleiß. Die drei Masten und das Ruder sitzen als eigene Marken im selben
  Plan, mit Zustand in Prozent.
- **Lecks unter Wasser** — die Pumpen halten wenige in Schach, viele nicht.
  Wasser im Schiff kostet Fahrt, legt sie auf die Seite und versenkt sie am Ende.
- **Masten** — **kippen** über Bord: der gebrochene Mast bleibt am Mastfuß im
  stehenden Gut hängen, dreht sich um seine Spur über die Bordwand, schlägt ins
  Wasser und legt sich dort flach. Danach hängt er als **12-Tonnen-Wrack
  längsseit**: das Schiff wird langsam und zieht ständig zur Wrackseite, bis
  **X** die Wanten kappt.
- **Besatzung** — Verluste an den Geschützen, in der Takelage und an den Pumpen
  (siehe oben). Sie ist die vierte Baugruppe neben Rumpf, Rigg und Ruder.
  Nicht nur Beschuss kostet Leute: ein **über Bord gehender Mast** nimmt die
  Toppsgasten in seinen Wanten mit, und herabstürzendes Rundholz fegt das Deck.
  Ein Zusammenstoß und eine Grundberührung ebenso. Dazu kommt der **Schock** —
  nach einem solchen Ereignis bricht die Moral ein und erholt sich erst langsam.
- **Segel** — reißen erst und fliegen dann weg. Mit sinkendem Tuchzustand
  **platzen einzelne Bahnen auf**: es entstehen echte Löcher im Tuch, die
  Ränder sacken aus und schlagen. Ist genug weg, fliegt das Segel **aus den
  Lieken** und treibt in mehreren flatternden Bahnen nach Lee davon. Die oberen
  Segel gehen zuerst — dort steht der meiste Wind und dorthin geht die
  Kettenkugel; die Untersegel halten am längsten.
- **Ruder** — Treffer achtern kosten die Kurskontrolle.
- **Batterie** — ausgeschlagene Rohre verkleinern die eigene Breitseite sichtbar
  (sie verschwinden aus den Stückpforten).
- **Brand** — greift um sich, frisst Tuch und Tauwerk; im Extremfall fliegt sie
  in die Luft.
- **Flagge streichen** — ein geschlagener Gegner kämpft nicht bis zum Untergang.

### Nicht nur Kugeln: Kräfte

- **Zu viel Tuch im Sturm.** Der Staudruck geht mit dem Quadrat der
  Windgeschwindigkeit. Volles Zeug hält bis etwa 30 kn; bei 34 kn gehen die
  Stengen nach ein paar Minuten über Bord, bei 42 kn in Sekunden. Gerefft hält
  sie es aus — genau dafür gibt es **W / S**.
- **Zusammenstöße.** Rümpfe werden als Kette von drei Kreisen genähert. Beim
  Stoß werden Impuls und Schaden aus Annäherungsgeschwindigkeit und Verdrängung
  berechnet; bei langsamer Berührung verhaken sich die Schiffe im Tauwerk.
- **Grundberührung.** Der Meeresgrund ist eine analytische Funktion — dieselbe,
  aus der das sichtbare Gelände gebaut wird. Man kann also nie auf etwas
  auflaufen, das man nicht sieht. Die Brandung über den Riffen ist die Warnung.

### Die Wrackteile

`debris.js` ist eine kleine eigene Starrkörper-Simulation (kein Physik-Framework):

- **Schwerkraft** greift im Schwerpunkt an — erzeugt also kein Drehmoment.
- **Auftrieb** nach Archimedes, aber **verteilt über Stützpunkte längs des
  Körpers**. Genau daraus entsteht das Drehmoment: solange ein Mast senkrecht
  steht, sitzt sein Auftriebsschwerpunkt unter dem Massenschwerpunkt — ein
  labiles Gleichgewicht. Er kippt um, bis er flach im Wasser liegt, ganz von
  selbst. Mit einem einzigen Auftriebspunkt bliebe jeder Mast senkrecht stehen
  wie eine Spierentonne; das war der erste Anlauf und sah entsprechend falsch aus.
- Eiche (720 kg/m³) treibt auf, Kiefer schwimmt gut, ein Kanonenrohr sinkt sofort.
- **Quadratischer Wasserwiderstand** an jedem Stützpunkt einzeln — bremst
  dadurch auch die Kippbewegung.
- **Freie Rotation** mit Quaternion-Integration; in der Luft bleibt der Drehimpuls
  praktisch erhalten.
- **Trossenzwang** für gefallene Masten: greift am Mastfuß an, mit korrekter
  effektiver Masse am Angriffspunkt, damit sich der Zwang nicht aufschaukelt.

---

## Seegang

Die See hängt am Wind, und zwar **quadratisch**. Nach Pierson-Moskowitz gilt
für eine voll entwickelte See `Hs = 0.21 · U² / g` — doppelter Wind heißt also
rund vierfache Wellenhöhe:

| Wind | Signifikante Höhe | Seezustand |
|-----:|------------------:|------------|
| 5 kn | 0,1 m | ruhig |
| 12 kn | 0,8 m | schwach bewegt |
| 20 kn | 2,3 m | leicht bewegt |
| 30 kn | 5,1 m | grob |
| 35 kn | 6,9 m | sehr grob |

Mit dem Wind wachsen auch die **Wellenlängen** — aber nur mit der Wurzel, nicht
linear. Sonst wird die See zwar hoch, aber so flach geneigt, dass sie wie eine
glatte Dünung wirkt. So bleibt sie steil: eine Sturmsee ist steil.

Woran man die Windstärke aber wirklich erkennt, sind die **Weißkappen**. Sie
setzen bei Bft 4 ein und bedecken die See mit zunehmendem Wind — bei Bft 6 ist
sie flächig weiß gesprenkelt, bei Bft 8 durchgehend. Ohne sie wirkt selbst eine
3,5-m-See flach, weil dem Auge der Maßstab fehlt.

Zwei Details, die den Unterschied machen:

- **Die See folgt dem Wind nur träge.** Sie baut sich über etwa eine Minute auf
  und läuft langsamer wieder ab. Sonst würde jede Bö die Wellen pulsieren lassen.
- **Shader und Physik rechnen mit derselben Oberfläche.** Die Wellenlängen-
  streckung läuft über eine aufsummierte Phasenzeit statt über die Uhrzeit,
  sonst würde das ganze Wellenfeld springen, sobald sich der Wind ändert.

---

## Die Besatzung

Ein Schiff dieser Zeit ist nichts ohne seine Leute. Die Mannschaft ist deshalb
kein Zahlenschmuck, sondern hängt an allen drei Systemen — Geschütze, Segel,
Pumpen.

| Rolle | Anteil | Wofür sie gebraucht wird |
|-------|-------:|--------------------------|
| Offiziere & Rudergänger | 7 % | Ruderwirkung, Befehlskette, Moral |
| Geschützbedienungen | 49 % | wie viele Rohre bedient werden und wie schnell |
| Toppsgasten | 22 % | Segel setzen und reffen |
| Seesoldaten | 11 % | Musketenfeuer, Enterabwehr |
| Zimmerleute & Pumpen | 6 % | Lecks stopfen, Wasser lenzen |
| Pulverjungen | 5 % | Nachschub an die Batterie |

**Verluste.** Der große Töter an Bord war nicht die Kugel selbst, sondern der
Holzsplitterhagel, den sie aus der Bordwand riss — und auf kurze Distanz die
Kartätsche. Wo ein Treffer einschlägt, entscheidet, wen es erwischt: Splitter
an der Bordwand treffen die Geschützbedienungen, Kartätsche fegt das offene
Deck, Kettenkugeln holen Toppsgasten aus der Takelage. Rund ein Drittel der
Getroffenen fällt, der Rest geht verwundet nach unten und fällt trotzdem aus.
Ein hart ausgefochtenes Fregattengefecht kostet so 5–20 % der Besatzung.

**Folgen.** Fehlende Bedienungen heißt: weniger Rohre und langsameres Nachladen.
Fehlende Toppsgasten heißt: träges Segelmanöver. Fehlende Zimmerleute heißt:
die Pumpen kommen gegen das Wasser nicht mehr an. Und wenn Verluste und
Führungsverlust zusammenkommen, bricht die **Moral** — ein ausgeblutetes Schiff
streicht die Flagge, auch wenn der Rumpf noch steht.

**An Deck** stehen sie auch wirklich: `crewview.js` besetzt die Stationen mit
Figuren — Bedienungen an jedem Rohr, die im Takt des Nachladens ausrennen und
zurücktreten, Toppsgasten in den Wanten, wenn Segel bedient werden, ein
Rudergänger am Rad, Zimmerleute an den Pumpen (die umso schneller arbeiten, je
mehr Wasser im Schiff steht), Pulverjungen, die zwischen Luke und Batterie hin
und her laufen. Wer gefallen ist, steht nicht mehr da. Die ganze Besatzung
kostet zwei Zeichenaufrufe (zwei InstancedMeshes).

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

Seit Phase 0 der Mehrspieler-Umstellung ([Issue #23](https://github.com/latentspace-lab/sailing/issues/23))
liegt das Projekt als npm-Workspace vor. Die Trennlinie ist streng: `shared/`
enthaelt reine Logik ohne DOM und ohne Renderer, `client/` alles Sichtbare.

```
segel-simulator/
├─ packages/
│  ├─ shared/            # @segel/shared — reine Logik (TypeScript, kein Three.js-Renderer)
│  │  └─ src/
│  │     ├─ utils.ts         # Winkel, Interpolation, approach() (dt-invariante Glaettung)
│  │     ├─ rng.ts           # mulberry32, abgeleitete Stroeme, gauss()
│  │     ├─ timestep.ts      # SIM_DT (30 Hz) + Akkumulator fuer die Spielschleife
│  │     ├─ types.ts         # Protokoll: ShipState, SeaSync, InputCommand, WorldParams
│  │     ├─ physics.ts       # Segelphysik, BoatDynamics (fester Schritt)
│  │     ├─ wind.ts          # Wind — reine Funktion der Simulationszeit
│  │     ├─ ocean-math.ts    # Gerstner-Wellen, SeaState (nachlaufender Seegang + Phase)
│  │     ├─ terrain-math.ts  # Seekarte aus einem Seed: World, Tiefe, Riffe
│  │     ├─ pose.ts          # Rumpflage auf der Welle + Interpolation fuers Bild
│  │     ├─ ballistics.ts    # Wurfbahn, Salvenwurf, Trefferpruefung
│  │     ├─ damage.ts        # Strukturmodell: Rumpf, Masten, Ruder, Lecks, Brand
│  │     ├─ crew.ts          # Besatzung: Rollen, Verluste, Wirkung auf alle Systeme
│  │     ├─ collide.ts       # Schiff gegen Schiff, Grundberuehrung
│  │     ├─ vessels.ts       # Schiffskatalog: Masse, Polarkurven, Dynamik, Batterien
│  │     └─ factions.ts      # Parteien: Doktrin, Ausbildungsstand, Flagge
│  │
│  ├─ server/            # @segel/server — the game server (Colyseus 0.18)
│  │  ├─ src/index.ts        # startServer(): HTTP + WebSocket transport, room registry
│  │  ├─ src/rooms/BattleRoom.ts  # clients -> ships, messages -> inputs, tick -> patches
│  │  ├─ src/state/GameState.ts   # synchronised schema: ships, wind, sea, tick
│  │  ├─ src/sim/Simulation.ts    # one room's world: wind, sea, ships, guns, collisions, grounding
│  │  ├─ src/sim/ServerShip.ts    # a ship without Three.js: dynamics, damage, crew, guns, pose
│  │  ├─ src/sim/ServerBattery.ts # the deciding half of a battery: salvo, flight, hit test
│  │  ├─ src/sim/Captain.ts       # AI captain (port of the client's fleet.js)
│  │  └─ src/headless.ts          # CLI: run a simulation headless and print timings
│  │
│  └─ client/            # @segel/client — Browser: Three.js, Eingabe, HUD
│     ├─ index.html
│     ├─ vite.config.js
│     └─ src/
│        ├─ main.js          # Spielschleife: feste Simulation, freie Darstellung
│        ├─ game.js          # stepFixed() (Simulation) + render(alpha) (Bild)
│        ├─ ship.js          # Schiff als Einheit: Modell + Fahrt + Schaden + Batterie
│        ├─ guns.js          # Breitseiten-DARSTELLUNG (Ballistik in @segel/shared)
│        ├─ ocean.js         # Wellen-Mesh und Shader (Mathematik in @segel/shared)
│        ├─ terrain.js       # Gelaendemesh und Brandung (Seekarte in @segel/shared)
│        ├─ scene.js         # Szene: Himmel, Sonne, Lichter, Wolken
│        ├─ boat.js          # 3D-Yacht: gelofteter Rumpf, Rigg, windgetriebene Segel
│        ├─ warship.js       # 3D-Rahsegler: Rumpf mit Stueckpforten, Masten, Rahsegel
│        ├─ debris.js        # Starrkoerper-Simulation der Wrackteile (Auftrieb, Drall)
│        ├─ fleet.js         # Gegner und ihre Kapitaene (Doktrin, Manoever, Feuer)
│        ├─ crewview.js      # die Leute an Deck (zwei InstancedMeshes, animiert)
│        ├─ fx.js            # gemeinsame Effekt-Texturen (Rauch, Feuer, Loecher)
│        ├─ camera.js        # Kamera-Regie (4 Modi + Maus-Orbit)
│        ├─ controls.js      # Tastatur-/Maussteuerung
│        ├─ marks.js         # Regatta-Kurs: Bojen, Start- & Ziellinie, Runden
│        ├─ trainer.js       # Trainings-Herausforderungen (Edge- & Zeit-Logik)
│        ├─ ui.js            # 2D-HUD + 2D-Kompass + Menue + Trainings-Panel
│        ├─ audio.js         # Sprachansagen je Nation
│        ├─ styles.css       # Optik
│        └─ physics.js …     # Re-Exporte aus @segel/shared (alte Importpfade)
└─ tests/                # siehe unten
```

### Feste Simulationsrate

Die Simulation laeuft mit **30 Hz** (`SIM_DT`), gerendert wird mit
Bildschirmrate. `main.js` sammelt die vergangene Zeit in einem Akkumulator und
gibt sie in ganzen Schritten aus; der Rest (`alpha`) interpoliert die
Schiffslagen zwischen den letzten beiden Schritten.

Der Grund ist nicht Eleganz, sondern Notwendigkeit: die Physik enthaelt
Glaettungsterme, und `f(dt₁)` gefolgt von `f(dt₂)` ist nicht dasselbe wie
`f(dt₁+dt₂)`. Client-Prediction verlangt aber genau das — der Client rechnet
Eingaben nach, die der Server schon gerechnet hat. Deshalb gibt es fuer die
Ruderglaettung seit Phase 0B' auch nur noch **einen** Smoother, und der sitzt
in `BoatDynamics.step()`.

---

## Tests

Drei Ebenen, weil sie verschiedene Fragen beantworten.

```bash
npm test                  # alles (Build + 699 Checks, ~60 s)

npm run test:unit         # ein Modul, eine Zusicherung      (~0.1 s)
npm run test:regression   # was sich nicht aendern darf      (~0.2 s)
npm run test:integration  # mehrere Module ueber Zeit        (~55 s)
npm run test:pending      # zusaetzlich die offenen Faelle

node tests/run.js ocean ballistics   # nur Suiten, deren Pfad das enthaelt
node tests/unit/pose.test.js         # eine Suite direkt, ohne Runner
```

| Ebene | Was sie prueft |
|---|---|
| `tests/unit/` | Einzelne Module: Winkel, Zufall, Akkumulator, Wellen, Seekarte, Rumpflage, Ballistik, Schaden, Mannschaft, Segelphysik. Schnell und deterministisch — faellt hier etwas um, weiss man sofort, wo. |
| `tests/regression/` | Die Zusagen, auf denen der Mehrspieler-Umbau steht: **dt-Invarianz**, **Determinismus** (gleicher Seed → gleiches Gefecht, inklusive eines Laufs mit abgeklemmtem `Math.random`) und eine **Golden-Spur** gegen `tests/fixtures/golden-trace.json`. |
| `tests/integration/` | Mehrere Module ueber Zeit: Segeln, Schiffe und Rigg, Geometrie, ein vollstaendiges Gefecht, die Headless-Simulation und die Render-Interpolation. Dazu ein **Boot-Smoke-Test**, der das gebaute Spiel in Chromium startet — der faengt fehlende Importe, die kein Modultest sieht. |
| `tests/pending/` | Faelle fuer Funktionen, die es noch nicht gibt. Laeuft nur mit `--pending` und zaehlt nicht gegen den Exit-Code. |

Die Golden-Spur neu festschreiben — nur, wenn die Aenderung gewollt ist:

```bash
node tests/regression/golden-trace.test.js --update
```

Der Boot-Smoke-Test braucht einen Build und Chromium
(`npx playwright install chromium`); fehlt eines davon, ueberspringt er sich
selbst. Alles andere laeuft mit reinem Node.

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
- Wrackteile kollidieren nicht untereinander und nicht mit den Schiffen — sie
  reagieren auf Wasser, Wind und Schwerkraft, nicht aufeinander. Für Splitter,
  Planken und treibende Masten ist das ausreichend und spart sehr viel Rechenzeit.
- Einschlaglöcher im **Rumpf** sind aufgesetzte Decals, keine echten Löcher in der
  Geometrie. Die Risse im **Segeltuch** dagegen sind echt: dort werden die
  betroffenen Dreiecke zusammengezogen.
- Entern ist nicht implementiert — die Schiffe verhaken sich, mehr passiert nicht.
- Leeweg (Drift) und Ruderautorität sind vereinfacht, aber die **Qualitative** des
  Verhaltens (Krausen, Wenden, Gieren, VMG, Kenter) ist realistisch.
- Kein Wellen-Boot-Kontakt-Rendering (Boot „schwimmt" auf der berechneten Wasserhöhe,
  die exakt dem Wasser-Shader entspricht → keine Auf-/Abreißer an der Waterline).

## Lizenz
Frei zum Experimentieren, Umbauen und Lernen.
