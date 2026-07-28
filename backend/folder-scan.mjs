// Desktop-Ordnerscan: liest die CSVs DIREKT im gewählten Ordner, ohne sie zu
// verschieben, umzubenennen oder Unterordner anzulegen. Der Ordner bleibt genau
// so, wie der Nutzer ihn kennt — nur der Index (Zusammenfassungen) liegt separat
// in den App-Daten. Löscht der Nutzer eine CSV aus dem Ordner, verschwindet sie
// beim nächsten Scan auch aus der App.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export function makeFolderScan({ store, core, getDataDir, quietMs = 2500, log = () => {} }) {
  let running = false, pending = false;

  async function scanOnce() {
    const dataDir = getDataDir();
    const counts = { new: 0, dup: 0, error: 0, removed: 0, messages: [] };
    let entries = [];
    try { entries = await fs.readdir(dataDir, { withFileTypes: true }); }
    catch { return counts; }

    const seenPaths = new Set();
    for (const e of entries) {
      if (!e.isFile()) continue;
      const name = e.name;
      if (name.startsWith(".") || /\.(part|tmp|crdownload)$/i.test(name)) continue;
      if (!name.toLowerCase().endsWith(".csv")) continue;

      const full = path.join(dataDir, name);
      let st;
      try { st = await fs.stat(full); } catch { continue; }
      seenPaths.add(full);                       // vorhanden -> Index-Eintrag behalten

      const existing = store.getByPath(full);
      if (existing && existing.mtimeMs === st.mtimeMs && existing.size === st.size) continue; // unverändert
      if (Date.now() - st.mtimeMs < quietMs) continue;   // wird evtl. noch geschrieben

      let buf;
      try { buf = await fs.readFile(full); } catch { continue; }
      const hash = createHash("sha256").update(buf).digest("hex");

      // Gleicher Inhalt schon unter anderem Dateinamen indiziert -> Duplikat.
      const byHash = store.get(hash);
      if (byHash && byHash.sourcePath !== full) { counts.dup++; continue; }
      if (byHash && byHash.sourcePath === full) {  // nur mtime/size aktualisieren
        store.touch(hash, { sourcePath: full, mtimeMs: st.mtimeMs, size: st.size, name });
        continue;
      }

      let summary;
      try { summary = core.summarize(core.parseG3X(buf.toString("utf8"))); }
      catch (err) {
        store.addError(name, err.message);
        counts.error++; counts.messages.push(`${name}: ${err.message}`);
        continue;
      }
      store.add({ id: hash, hash, name, summary, sourcePath: full,
                  mtimeMs: st.mtimeMs, size: st.size, typeOverride: existing?.typeOverride || null });
      counts.new++;
      log(`neu: ${name} [${summary.type}]`);
    }

    counts.removed = store.retainPaths(seenPaths);   // gelöschte Dateien aus dem Index entfernen
    return counts;
  }

  async function scan() {
    if (running) { pending = true; return null; }
    running = true;
    try {
      let c = await scanOnce();
      while (pending) { pending = false; const x = await scanOnce();
        c = { new: c.new + x.new, dup: c.dup + x.dup, error: c.error + x.error,
              removed: c.removed + x.removed, messages: [...c.messages, ...x.messages] }; }
      return c;
    } finally { running = false; }
  }

  return { scan };
}
