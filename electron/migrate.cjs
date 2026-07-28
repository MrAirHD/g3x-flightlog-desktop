// Einmalige Bereinigung: Alt-Installationen (mit Unterordnern ingest/archive/
// uploads/state im CSV-Ordner) auf das neue Modell bringen -> genau EIN Ordner.
// Verschiebt alle CSVs aus archive/** nach oben in den Ordner und entfernt die
// (danach leeren) Alt-Unterordner. Verändert keine anderen Dateien.
const fs = require("node:fs");
const path = require("node:path");

function uniqueTarget(dir, name) {
  let t = path.join(dir, name);
  if (!fs.existsSync(t)) return t;
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  let i = 1;
  while (fs.existsSync(t)) t = path.join(dir, `${stem} (${i++})${ext}`);
  return t;
}

function moveCsvsUp(fromDir, toDir) {
  let moved = 0;
  let entries = [];
  try { entries = fs.readdirSync(fromDir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const full = path.join(fromDir, e.name);
    if (e.isDirectory()) moved += moveCsvsUp(full, toDir);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".csv")) {
      try { fs.renameSync(full, uniqueTarget(toDir, e.name)); moved++; } catch {}
    }
  }
  return moved;
}

function removeIfEmpty(dir) {
  try {
    const rest = fs.readdirSync(dir);
    if (rest.length === 0) { fs.rmdirSync(dir); return true; }
  } catch {}
  return false;
}

// Gibt { moved, removed } zurück.
function migrateFolder(dataDir) {
  const result = { moved: 0, removed: 0 };
  const legacy = ["archive", "ingest", "uploads", "state"];
  const archive = path.join(dataDir, "archive");
  if (fs.existsSync(archive)) result.moved += moveCsvsUp(archive, dataDir);
  // leere Alt-Unterordner (rekursiv von unten) entfernen
  const purge = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory()) purge(path.join(dir, e.name));
    if (removeIfEmpty(dir)) result.removed++;
  };
  for (const name of legacy) {
    const d = path.join(dataDir, name);
    if (fs.existsSync(d)) purge(d);
  }
  return result;
}

module.exports = { migrateFolder };
