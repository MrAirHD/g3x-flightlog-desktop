// Persistente Einstellungen in userData/settings.json (Datenordner, Sprache).
const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const FILE = path.join(app.getPath("userData"), "settings.json");

function defaults() {
  return {
    // Standard-Datenordner: Dokumente/G3X-Flugbuch (enthält ingest/archive/uploads/state)
    dataDir: path.join(app.getPath("documents"), "G3X-Flugbuch"),
    language: (app.getLocale() || "en").toLowerCase().startsWith("de") ? "de" : "en",
  };
}

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { ...defaults(), ...s };
  } catch {
    return defaults();
  }
}

function save(settings) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error("Einstellungen speichern fehlgeschlagen:", e.message);
  }
}

module.exports = { load, save, FILE };
