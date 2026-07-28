// Ingest-Worker: überwacht den Eingangsordner (Synology-Mount) und den
// Upload-Ordner, erkennt neue CSVs, parst+fasst sie serverseitig zusammen und
// VERSCHIEBT sie ins Archiv. Dedup über SHA-256-Inhaltshash — dadurch ist das
// Verschieben sicher (ein Duplikat wird erkannt, bevor es etwas überschreibt).
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

async function ensureDir(d) { await fs.mkdir(d, { recursive: true }); }

async function moveFile(src, dest) {
  await ensureDir(path.dirname(dest));
  try {
    await fs.rename(src, dest);
  } catch (e) {
    if (e.code !== "EXDEV") throw e;         // z. B. lokaler Upload -> NFS-Archiv
    await fs.copyFile(src, dest);
    await fs.unlink(src);
  }
}

// Eindeutiger, kollisionsfreier Zielname, falls schon eine Datei so heißt.
async function uniqueDest(dest) {
  let p = dest, i = 1;
  for (;;) {
    try { await fs.access(p); } catch { return p; }
    const ext = path.extname(dest), base = dest.slice(0, -ext.length);
    p = `${base}_${i++}${ext}`;
  }
}

export function makeIngest({ store, core, dirs, log = () => {}, quietMs = 5000 }) {
  let running = false;
  let pending = false;

  // quiet=true (Synology-Eingang): Dateien überspringen, die noch geschrieben
  // werden — Temp-Namen und alles, was vor < quietMs zuletzt geändert wurde.
  // So wird eine halb kopierte CSV vom NAS nicht verfrüht (fehlerhaft) gelesen.
  async function listCsvs(dir, quiet) {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return []; }
    const out = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      const n = e.name;
      if (n.startsWith(".") || /\.(part|tmp|crdownload)$/i.test(n)) continue;
      if (!n.toLowerCase().endsWith(".csv")) continue;
      const full = path.join(dir, n);
      if (quiet && quietMs > 0) {
        try { const st = await fs.stat(full); if (Date.now() - st.mtimeMs < quietMs) continue; }
        catch { continue; }
      }
      out.push(full);
    }
    return out;
  }

  async function processFile(file) {
    const base = path.basename(file);
    const buf = await fs.readFile(file);
    const hash = createHash("sha256").update(buf).digest("hex");

    // Duplikat? -> ins _duplicates-Archiv verschieben, nicht löschen.
    if (store.hasHash(hash)) {
      try {
        const dest = await uniqueDest(path.join(dirs.archive, "_duplicates", base));
        await moveFile(file, dest);
      } catch (err) {
        return { status: "error", reason: `Archiv nicht beschreibbar: ${err.message}` };
      }
      log(`dup:  ${base} -> _duplicates`);
      return { status: "dup" };
    }

    let summary;
    try {
      summary = core.summarize(core.parseG3X(buf.toString("utf8")));
    } catch (err) {
      store.addError(base, err.message);
      try {
        const dest = await uniqueDest(path.join(dirs.archive, "_errors", base));
        await moveFile(file, dest);
      } catch { /* _errors nicht beschreibbar -> Datei bleibt liegen */ }
      log(`err:  ${base} -> _errors (${err.message})`);
      return { status: "error", reason: `Ungültiger Log: ${err.message}` };
    }

    const id = `${summary.date || "unknown"}_${summary.start || hash.slice(0, 8)}`;
    const year = (summary.date || "0000").slice(0, 4);
    const stamp = (summary.start || "000000").replace(/:/g, "");
    const archiveName = `${summary.date || "unknown"}_${stamp}_${hash.slice(0, 8)}.csv`;
    let dest;
    try {
      dest = await uniqueDest(path.join(dirs.archive, year, archiveName));
      await moveFile(file, dest);
    } catch (err) {
      // Datei bleibt im Eingang/Upload liegen -> nächster Scan versucht es erneut,
      // sobald die Rechte auf dem Synology-Mount stimmen.
      return { status: "error", reason: `Archiv nicht beschreibbar (Rechte am Synology-Mount prüfen): ${err.message}` };
    }

    store.add({ id, hash, name: base, summary, archivedPath: dest, typeOverride: null });
    log(`new:  ${base} -> ${path.relative(dirs.archive, dest)} [${summary.type}]`);
    return { status: "new" };
  }

  async function scanOnce() {
    // Synology-Eingang mit Stabilitäts-Check; Uploads sind atomar geschrieben
    // (siehe /api/upload) und werden sofort verarbeitet.
    const files = [...await listCsvs(dirs.ingest, true), ...await listCsvs(dirs.uploads, false)];
    const counts = { new: 0, dup: 0, error: 0 };
    const messages = [];
    for (const f of files) {
      let r;
      try {
        r = await processFile(f);
      } catch (err) {
        r = { status: "error", reason: err.message };
      }
      counts[r.status]++;
      if (r.reason) { messages.push(`${path.basename(f)}: ${r.reason}`); log(`FAIL ${path.basename(f)}: ${r.reason}`); }
    }
    return { ...counts, messages };
  }

  // Serialisiert: läuft nie zweimal parallel; ein während des Laufs
  // angeforderter Scan wird einmal nachgeholt.
  async function scan() {
    if (running) { pending = true; return null; }
    running = true;
    try {
      let counts = await scanOnce();
      while (pending) { pending = false; const c = await scanOnce();
        counts = { new: counts.new + c.new, dup: counts.dup + c.dup, error: counts.error + c.error,
                   messages: [...counts.messages, ...c.messages] }; }
      return counts;
    } finally {
      running = false;
    }
  }

  return { scan };
}
