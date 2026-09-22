# G3X Flight Log — Technical / Developer notes

Electron desktop app. The window loads a small **local backend** (Fastify) that
runs in the same process, bound to `127.0.0.1` on a random port — nothing is
exposed to the network, there is no login. The heavy lifting (CSV parsing, Rotax
limits, flight classification) lives in one shared module used unchanged.

## How it works
- **`core/g3x-core.cjs`** — parser + Rotax-915-iS limits + flight classification
  (✈️ flight / 🔧 ground run / 🔌 avionics-only) + UTC handling + takeoff
  detection. Pure, no DOM.
  - `detectTakeoff(rows)` finds the first takeoff in a log: the start of the roll
    (last sample at a standstill, i.e. brake release — or the transition to
    takeoff power for a rolling start) and the liftoff (the altitude leaving
    field elevation, extrapolated back from the first seconds of climb so the
    1 Hz sampling does not add a systematic ~10 % overshoot). The distance is the
    time integral of GPS groundspeed, which is more robust than summing GPS
    positions and more accurate than `time × liftoff speed`.
  - `summarize()` stores `startUtc` / `endUtc` / `utcOff` and `takeoff` in the
    per-log summary. **Bumping `SUMMARY_VER` re-summarizes stored logs**: the
    folder scan re-reads files whose stored summary is older.
- **`backend/`**
  - `server.mjs` — `createBackend({ dataDir, stateFile })`; the local HTTP API +
    static SPA.
  - `folder-scan.mjs` — reads the CSVs **in place** in the chosen folder. Nothing
    is moved or renamed, no sub-folders are created. Dedup by SHA-256 content
    hash; deleting a file from the folder removes it from the app on next scan.
  - `store-json.mjs` — the index (flight summaries) as a JSON file kept in the
    app-data directory, **not** in the CSV folder. No native modules.
- **`app/`** — the frontend (single `index.html`) + locally vendored Leaflet.
  Talks to the backend over `fetch`. Only OSM map tiles come from the internet.
- **`electron/`** — `main.cjs` (window, menu, folder picker, per-folder index
  path, one-time migration of legacy sub-folders), `preload.cjs` (tiny IPC
  bridge), `settings.cjs` (data folder, language, units).

## Run from source
```bash
npm install
npm start          # Electron dev
npm test           # SPA syntax check + backend tests (scan / dedup / upload /
                   # delete / persistence / UTC / takeoff / re-summarize)
npm run test:ui    # end-to-end UI smoke test in a hidden Electron window
```
`test/takeoff-fixture.mjs` generates a synthetic G3X log with a takeoff whose
ground roll is analytically known (`0.5·a·t²`), so the detection can be checked
against an exact expected value in both languages.

## Build

### Windows
```bash
npm run dist       # -> release\G3X-Flight-Log-Setup-<version>.exe   (NSIS installer)
npm run dist -- --dir   # portable app -> release\win-unpacked\G3X Flight Log.exe
```
> **One-time requirement for the installer:** enable Windows **Developer Mode**
> (*Settings → Privacy & security → For developers*) **or** run the build from an
> **Administrator** terminal. electron-builder unpacks its signing helper with
> symlinks, which otherwise fails. The portable `--dir` build does not need this.

### macOS (must run on a Mac)
```bash
npm run dist:mac   # -> release/G3X-Flight-Log-<version>-arm64.dmg (+ x64)
```
electron-builder cannot build macOS apps on Windows/Linux. The app is unsigned;
open the first time via **right-click → Open** (Gatekeeper).

## Project layout
```
core/g3x-core.cjs      parser + Rotax limits + classification + takeoff/UTC
backend/               server.mjs, folder-scan.mjs, store-json.mjs, selftest.mjs
app/                   frontend (index.html) + vendored Leaflet
electron/              main.cjs, preload.cjs, settings.cjs, migrate.cjs
test/                  sample.csv, takeoff-fixture.mjs, syntax-check.mjs, ui-smoke.cjs
build/                 icon.ico (Windows), icon.png (macOS source)
```

## Notes
- Storage model is **read-only in place**: the CSV folder stays exactly as the
  user keeps it; the index lives in `…/userData/index/idx-<hash>.json` per folder.
- Uploads are written atomically (`.part` → rename) directly into the folder and
  back-dated so the very next scan shows them immediately.
- Limit values follow BRP-Rotax Operator's Manual OM-915 i A (Rev. 2); "derived"
  caution zones are this app's own early-warning bands, not official Rotax limits.
