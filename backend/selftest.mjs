// Headless-Test des lokalen Backends (In-Place-Modell): der CSV-Ordner wird
// direkt gelesen, nichts verschoben, Index liegt separat.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBackend } from "./server.mjs";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "  OK " : "FAIL "} ${m}`); if (!c) fails++; };
const SAMPLE = process.env.G3X_SAMPLE || "test/sample.csv";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "g3xdesk-"));
const folder = path.join(tmp, "MeineLogs");            // der CSV-Ordner des Nutzers
const stateFile = path.join(tmp, "appdata", "idx.json"); // Index getrennt (App-Daten)
await fs.mkdir(folder, { recursive: true });
const sample = await fs.readFile(SAMPLE);
await fs.writeFile(path.join(folder, "log_a.csv"), sample);

const be = await createBackend({ dataDir: folder, stateFile, quietMs: 0, scanIntervalMs: 999999 });
const j = async (p, opt) => (await fetch(be.url + p, opt)).json();

let list = await j("/api/flights");
ok(list.total === 1, `CSV im Ordner erkannt: total=${list.total}`);
const id = list.flights[0].id;

// KEINE Unterordner im CSV-Ordner angelegt (nur die eine CSV liegt drin)
const inFolder = (await fs.readdir(folder, { withFileTypes: true }));
ok(inFolder.every(e => e.isFile()), "keine Unterordner im CSV-Ordner angelegt");
ok(inFolder.some(e => e.name === "log_a.csv"), "Originaldatei bleibt unverändert liegen");

// Index liegt NICHT im CSV-Ordner (sondern in den App-Daten)
ok(!(await fs.readdir(folder)).some(n => n.endsWith(".json")), "keine Index-/JSON-Datei im CSV-Ordner");
ok(path.dirname(stateFile) !== folder, "Index-Ort liegt außerhalb des CSV-Ordners");

// Roh-CSV wird aus der Originaldatei geliefert
const raw = await (await fetch(be.url + "/api/flights/" + id + "/raw")).text();
ok(raw.includes("RPM"), "Roh-CSV aus Originaldatei abrufbar");

// Upload landet DIREKT im CSV-Ordner (anderer Inhalt -> neuer Flug)
const csv2 = sample.toString("utf8").replace(/2026-05-16/g, "2026-05-17");
const fd = new FormData();
fd.append("file", new Blob([csv2], { type: "text/csv" }), "log_b.csv");
let up = await j("/api/upload", { method: "POST", body: fd });
ok(up.counts.new === 1, `Upload -> neu (${JSON.stringify(up.counts)})`);
ok((await fs.stat(path.join(folder, "log_b.csv"))).isFile(), "hochgeladene Datei liegt direkt im CSV-Ordner");
ok((await j("/api/flights")).total === 2, "jetzt 2 Flüge");

// Identischer Inhalt erneut -> Duplikat, kein zweiter Eintrag
const fd2 = new FormData();
fd2.append("file", new Blob([sample], { type: "text/csv" }), "log_a_kopie.csv");
up = await j("/api/upload", { method: "POST", body: fd2 });
ok(up.counts.dup === 1 && (await j("/api/flights")).total === 2, `identischer Inhalt -> Duplikat (${JSON.stringify(up.counts)})`);

// Datei aus dem Ordner löschen (extern) -> verschwindet beim Scan aus der App
await fs.unlink(path.join(folder, "log_b.csv"));
const c = await j("/api/rescan", { method: "POST" });
ok(c.counts.removed === 1, `gelöschte Datei entfernt (removed=${c.counts.removed})`);
ok((await j("/api/flights")).total === 1, "App zeigt sie nicht mehr");

// Override + Persistenz
await fetch(be.url + "/api/flights/" + id, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ typeOverride: "flight" }) });
await be.close();
const be2 = await createBackend({ dataDir: folder, stateFile, quietMs: 0, scanIntervalMs: 999999 });
ok((await (await fetch(be2.url + "/api/flights")).json()).total === 1, "Persistenz nach Neustart");
ok((await (await fetch(be2.url + "/api/flights?type=flight")).json()).total === 1, "Override erhalten");

// Löschen über die App entfernt die echte Datei
await fetch(be2.url + "/api/flights/" + id, { method: "DELETE" });
let gone = false; try { await fs.stat(path.join(folder, "log_a.csv")); } catch { gone = true; }
ok(gone, "Löschen in der App entfernt die CSV aus dem Ordner");
await be2.close();

// Upload muss SOFORT erscheinen, auch bei aktiver Ruhephase (Drag&drop-Bug)
const folderQ = path.join(tmp, "Quiet");
const stateQ = path.join(tmp, "appdataQ", "idx.json");
await fs.mkdir(folderQ, { recursive: true });
const beQ = await createBackend({ dataDir: folderQ, stateFile: stateQ, quietMs: 3000, scanIntervalMs: 999999 });
const jq = async (p, opt) => (await fetch(beQ.url + p, opt)).json();
const fdQ = new FormData();
fdQ.append("file", new Blob([sample], { type: "text/csv" }), "sofort.csv");
const upQ = await jq("/api/upload", { method: "POST", body: fdQ });
ok(upQ.counts.new === 1, `Upload erscheint SOFORT trotz Ruhephase (${JSON.stringify(upQ.counts)})`);
ok((await jq("/api/flights")).total === 1, "hochgeladener Flug direkt in der Liste");
// Eine „von außen“ frisch abgelegte Datei bleibt dagegen kurz in der Ruhephase
await fs.writeFile(path.join(folderQ, "frisch.csv"), sample.toString("utf8").replace(/2026-05-16/g, "2026-05-20"));
const c2 = await jq("/api/rescan", { method: "POST" });
ok(c2.counts.new === 0, `frisch extern abgelegte Datei wartet Ruhephase ab (${JSON.stringify(c2.counts)})`);
await beQ.close();

await fs.rm(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} FEHLER` : "\nAlle Tests bestanden");
process.exit(fails ? 1 : 0);
