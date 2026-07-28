# G3X Flugbuch & Motoranalyse — Desktop (100% lokal)

Windows-Desktop-App (Electron) zur Auswertung der Garmin-G3X-Motorlogs für den
**Rotax 915 iS**. **Vollständig offline** — keine Cloud, kein Server, kein Login.
Du wählst einen **Datenordner**, ziehst CSVs per **Drag&drop** hinein (oder legst
sie direkt in dessen `ingest/`-Unterordner), und die App liest sie automatisch
ein, klassifiziert jeden Log (✈️ Flug / 🔧 Standlauf / 🔌 Nur Avionik), prüft die
Rotax-Grenzwerte (OM-915 i A) und zeigt Zeitleiste, Karten und Diagramme.

Dies ist die lokale Schwester der self-hosted Server-Variante
([g3x-flugbuch](https://github.com/MrAirHD/g3x-flugbuch)) und nutzt denselben
Parser, dieselbe Ingest-Pipeline und dasselbe Frontend — nur ohne Docker/Auth,
mit lokalem JSON-Speicher statt SQLite.

*A fully local Windows desktop app to analyse Garmin G3X engine logs (Rotax 915
iS). No cloud, no server, no login. Pick a data folder, drag & drop CSVs in, done.*

## Datenordner & Ablauf
- **Datenordner** (Standard: `Dokumente\G3X-Flugbuch`) enthält:
  `ingest/` (Eingang), `archive/` (verarbeitet, nach Jahr; `_duplicates/`,
  `_errors/`), `uploads/` (Drag&drop-Zwischenablage), `state/` (Index).
- **Neue Logs**: per Drag&drop ins Fenster **oder** direkt in `ingest/` kopieren.
- **Dedup** über Inhalts-Hash (SHA-256) — dieselbe Datei wird nie doppelt geführt.
- Ordner wechseln jederzeit über die Leiste oben oder Menü **Datei → Datenordner
  wählen…**.

## Installer bauen (erzeugt die .exe)
Voraussetzung: Node.js 18+ und Windows.

> **Einmalig nötig:** Windows **Entwicklermodus** einschalten
> (*Einstellungen → Datenschutz & Sicherheit → Für Entwickler → Entwicklermodus:
> Ein*) **oder** das Terminal **als Administrator** öffnen. Grund: electron-builder
> entpackt sein Signatur-Werkzeug mit Symlinks, was sonst am fehlenden Recht
> scheitert. Ohne das bricht `npm run dist` beim Schritt „winCodeSign" ab.

```bash
npm install
npm run dist        # -> release\G3X-Flugbuch-Setup-1.0.0.exe
```
Der **Installer fragt beim Start nach der Sprache (English / Deutsch)** und lässt
den Installationsordner wählen (kein „One-Click"). Danach liegt „G3X Flugbuch" im
Startmenü und auf dem Desktop.

Nur die App als Ordner (ohne Installer, umgeht das obige Recht) zum Ausprobieren:
```bash
npm run dist -- --dir     # -> release\win-unpacked\G3X Flugbuch.exe
```

### macOS-Installer (.dmg) bauen
> **Muss auf einem Mac gebaut werden** — electron-builder kann macOS-Apps nicht
> unter Windows/Linux erzeugen. Die Konfiguration (Icon, dmg, Universal arm64+x64)
> ist bereits im Projekt vorbereitet.

```bash
# auf einem Mac (Node.js 18+):
npm install
npm run dist:mac          # -> release/G3X-Flight-Log-1.0.0-arm64.dmg  (+ x64)
```
Die App ist **nicht signiert/notarisiert**. Beim ersten Öffnen meldet Gatekeeper
„nicht verifizierter Entwickler“ — dann per **Rechtsklick → Öffnen** (bzw.
*Systemeinstellungen → Datenschutz & Sicherheit → Trotzdem öffnen*) starten.
Für eine signierte/notarisierte Version braucht es ein Apple-Developer-Konto
(`CSC_LINK`/`APPLE_ID` als Umgebungsvariablen).

*Build the installer with `npm run dist`; the NSIS setup asks for its language
(English/German) at launch.*

## Entwicklung / direkt starten
```bash
npm install
npm start           # startet Electron im Dev-Modus
npm test            # Backend-Tests (Ingest/Dedup/Upload/Persistenz)
```

## Menü
- **Datei**: Datenordner wählen…, Datenordner öffnen, Jetzt neu einlesen, Beenden
- **Sprache**: English / Deutsch (Menü-Sprache; die Analyse-Oberfläche ist
  aktuell deutsch)
- **Ansicht**: Neu laden, Entwicklertools, Vollbild, Zoom

## Technik
- **Electron** (Fenster) + im selben Prozess ein lokales Fastify-Backend, nur an
  `127.0.0.1` auf einem zufälligen Port — nichts ist von außen erreichbar.
- **`core/g3x-core.cjs`**: Parser + Rotax-Grenzwerte + Klassifizierung (geteilt
  mit der Server-Variante).
- **`backend/`**: `server.mjs` (lokale API), `ingest.mjs` (Ordner-Watch/Dedup/
  Archiv), `store-json.mjs` (JSON-Index, kein natives Modul).
- **`app/`**: Frontend + lokal eingebundenes Leaflet (nur die OSM-Kartenkacheln
  kommen aus dem Internet; ohne Netz zeichnet die Detailkarte einen Umriss).

## Hinweise
- Ein eigenes App-Icon kannst du unter `build/icon.ico` ablegen (256×256), sonst
  nutzt electron-builder das Standard-Electron-Icon.
- Grenzwerte lt. BRP-Rotax Operators Manual OM-915 i A (Rev. 2); „abgeleitete"
  Vorwarnbereiche sind keine offiziellen Limits. Maßgeblich bleiben Operators
  Manual und Flughandbuch.
