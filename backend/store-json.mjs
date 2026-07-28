// Lokaler Index als JSON-Datei (in den App-Daten, NICHT im CSV-Ordner).
// Ein Eintrag je CSV, referenziert die Originaldatei (sourcePath) — es wird
// nichts verschoben. Schlüssel ist der Inhalts-Hash (Dedup).
import { promises as fs, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export function makeJsonStore(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  let data = { flights: {}, errors: [] };
  if (existsSync(file)) {
    try { data = JSON.parse(readFileSync(file, "utf8")); } catch {}
  }
  data.flights ||= {};
  data.errors ||= [];

  let saveTimer = null, saving = false, dirty = false;
  async function persist() {
    if (saving) { dirty = true; return; }
    saving = true; dirty = false;
    try { await fs.writeFile(file + ".tmp", JSON.stringify(data)); await fs.rename(file + ".tmp", file); }
    catch (e) { console.error("Index speichern fehlgeschlagen:", e.message); }
    finally { saving = false; if (dirty) await persist(); }
  }
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 250); }
  async function flush() { clearTimeout(saveTimer); await persist(); }

  const arr = () => Object.values(data.flights);
  const effType = f => f.typeOverride || f.summary.type;

  return {
    get: (id) => data.flights[id],
    getByPath: (p) => arr().find(f => f.sourcePath === p),
    remove: (id) => { delete data.flights[id]; save(); },
    setOverride: (id, val) => { if (data.flights[id]) { data.flights[id].typeOverride = val || null; save(); } },
    touch: (id, patch) => { if (data.flights[id]) { Object.assign(data.flights[id], patch); save(); } },
    addError: (name, reason) => { data.errors.unshift({ path: name, reason, at: Date.now() });
      if (data.errors.length > 500) data.errors.length = 500; save(); },
    errors: () => data.errors.slice(0, 200),

    add(rec) {
      data.flights[rec.id] = {
        id: rec.id, hash: rec.hash, name: rec.name, summary: rec.summary,
        typeOverride: rec.typeOverride ?? null, sourcePath: rec.sourcePath,
        mtimeMs: rec.mtimeMs, size: rec.size, addedAt: Date.now(),
      };
      save();
    },

    // Entfernt alle Einträge, deren Datei nicht mehr im Ordner liegt.
    retainPaths(seenPaths) {
      let removed = 0;
      for (const [id, f] of Object.entries(data.flights)) {
        if (!seenPaths.has(f.sourcePath)) { delete data.flights[id]; removed++; }
      }
      if (removed) save();
      return removed;
    },

    list({ type = "all", month = "all", warnOnly = false, sort = "desc", offset = 0, limit = 300 } = {}) {
      let rows = arr().filter(f => {
        const s = f.summary;
        if (type !== "all" && effType(f) !== type) return false;
        if (month !== "all" && !(s.date || "").startsWith(month)) return false;
        if (warnOnly && !s.nCrit && !s.nWarn) return false;
        return true;
      });
      const dir = sort === "asc" ? 1 : -1;
      rows.sort((a, b) => (a.summary.startTs - b.summary.startTs || String(a.id).localeCompare(String(b.id))) * dir);
      const total = rows.length;
      const flights = rows.slice(offset, offset + limit).map(f => ({
        id: f.id, name: f.name, typeOverride: f.typeOverride || null, summary: f.summary,
      }));
      return { total, flights };
    },

    stats() {
      const rows = arr();
      const agg = { total: rows.length, flight: 0, ground: 0, panel: 0,
        runSecs: 0, dist: 0, nCrit: 0, nWarn: 0, maxOilT: null, maxRpm: null, maxAlt: null,
        dateMin: null, dateMax: null };
      for (const f of rows) {
        const s = f.summary;
        agg[effType(f)] = (agg[effType(f)] || 0) + 1;
        agg.runSecs += s.runSecs || 0; agg.dist += s.dist || 0;
        agg.nCrit += s.nCrit || 0; agg.nWarn += s.nWarn || 0;
        if (s.maxOilT != null) agg.maxOilT = Math.max(agg.maxOilT ?? -1e9, s.maxOilT);
        if (s.maxRpm != null)  agg.maxRpm  = Math.max(agg.maxRpm ?? -1e9, s.maxRpm);
        if (s.maxAlt != null)  agg.maxAlt  = Math.max(agg.maxAlt ?? -1e9, s.maxAlt);
        if (s.date) { if (!agg.dateMin || s.date < agg.dateMin) agg.dateMin = s.date;
                      if (!agg.dateMax || s.date > agg.dateMax) agg.dateMax = s.date; }
      }
      return agg;
    },

    months() {
      return [...new Set(arr().map(f => (f.summary.date || "").slice(0, 7)).filter(Boolean))].sort().reverse();
    },

    flush,
  };
}
