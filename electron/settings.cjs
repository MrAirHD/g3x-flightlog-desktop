// Persistente Einstellungen in userData/settings.json:
// Datenordner, Sprache, Maßeinheiten.
const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const FILE = path.join(app.getPath("userData"), "settings.json");

function defaults() {
  return {
    dataDir: path.join(app.getPath("documents"), "G3X-Flightlog"),
    language: (app.getLocale() || "en").toLowerCase().startsWith("de") ? "de" : "en",
    units: { temp: "C", press: "psi", map: "inHg", alt: "ft", speed: "kt", fuel: "lph" },
  };
}

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const d = defaults();
    return { ...d, ...s, units: { ...d.units, ...(s.units || {}) } };
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
