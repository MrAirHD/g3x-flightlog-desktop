// Headless-Test des lokalen Backends (In-Place-Modell): der CSV-Ordner wird
// direkt gelesen, nichts verschoben, Index liegt separat.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createBackend } from "./server.mjs";
import { makeTakeoffCsv, expectedRollMetres, expectedLandingRollMetres, touchdownSecond } from "../test/takeoff-fixture.mjs";

const core = createRequire(import.meta.url)("../core/g3x-core.cjs");

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

// ---- UTC-Zeiten, Start und Landung ----
const folderT = path.join(tmp, "Start");
const stateT = path.join(tmp, "appdataT", "idx.json");
await fs.mkdir(folderT, { recursive: true });
const takeoffCsv = makeTakeoffCsv();
await fs.writeFile(path.join(folderT, "start.csv"), takeoffCsv);
const beT = await createBackend({ dataDir: folderT, stateFile: stateT, quietMs: 0, scanIntervalMs: 999999 });
const jt = async (p, opt) => (await fetch(beT.url + p, opt)).json();
const sT = (await jt("/api/flights")).flights[0].summary;

ok(sT.startUtc === "09:35:00" && sT.endUtc && sT.utcOff === "+02:00",
  `UTC-Zeiten in der Zusammenfassung (${sT.start} lokal = ${sT.startUtc} UTC, ${sT.utcOff})`);
ok(sT.type === "flight", `synthetischer Log wird als Flug erkannt (${sT.type})`);
const tk = sT.takeoff;
const expM = expectedRollMetres();
ok(!!tk, "Startlauf erkannt");
ok(tk && Math.abs(tk.distRoll - expM) / expM < 0.05,
  `Startrollstrecke ${tk ? tk.distRoll.toFixed(0) : "–"} m, erwartet ${expM.toFixed(0)} m (< 5 % Abweichung)`);
ok(tk && tk.dist50 > tk.distRoll, "Strecke bis 50 ft ist länger als die Rollstrecke");
ok(tk && tk.rollUtc === "09:35:39" && tk.liftUtc === "09:35:57" && tk.liftStr > tk.rollStr,
  `Losrollen ${tk ? tk.rollStr : "–"} lokal / ${tk ? tk.rollUtc : "–"} UTC, Abheben ${tk ? tk.liftStr : "–"}`);
ok(tk && tk.liftGs >= 45 && tk.liftGs <= 55, `Abhebegeschwindigkeit ${tk ? tk.liftGs : "–"} kt`);

const ld = sT.landing;
const expL = expectedLandingRollMetres();
ok(!!ld, "Landung erkannt");
ok(ld && ld.tdUtc === "09:45:57" && ld.tdStr === "11:45:57",
  `Aufsetzen ${ld ? ld.tdStr : "–"} lokal / ${ld ? ld.tdUtc : "–"} UTC (erwartet 11:45:57 / 09:45:57)`);
ok(ld && Math.abs(ld.distRoll - expL) / expL < 0.05,
  `Landerollstrecke ${ld ? ld.distRoll.toFixed(0) : "–"} m, erwartet ${expL.toFixed(0)} m (< 5 % Abweichung)`);
ok(ld && ld.dist50 > ld.distRoll && ld.tdGs >= 50 && ld.tdGs <= 60,
  `Landestrecke über 50 ft ${ld ? ld.dist50.toFixed(0) : "–"} m, Aufsetzgeschwindigkeit ${ld ? ld.tdGs.toFixed(0) : "–"} kt`);
ok(sT.airTime === 600, `Flugzeit Abheben–Aufsetzen ${sT.airTime} s (erwartet 600 s)`);

// Rollender Start (30 s Rollen mit 8 kt direkt auf die Piste): das Rollen davor
// darf NICHT zur Startrollstrecke zählen.
const rollO = { taxiS: 30 };
const tkR = core.summarize(core.parseG3X(makeTakeoffCsv(rollO))).takeoff;
const expR = expectedRollMetres(rollO);
ok(tkR && tkR.method === "rolling" && Math.abs(tkR.distRoll - expR) / expR < 0.05 && Math.abs(tkR.dur - 18) < 1,
  `rollender Start: ${tkR ? tkR.distRoll.toFixed(0) : "–"} m in ${tkR ? tkR.dur.toFixed(1) : "–"} s, erwartet ${expR.toFixed(0)} m in 18 s (${tkR ? tkR.method : "–"})`);

// Realistisches Messrauschen (Baro ±5 ft, GS ±0,4 kt, Vario ±60 ft/min) und
// Staudruckfehler im Startlauf: Ergebnisse bleiben innerhalb einer Messsekunde.
let worstTo = 0, worstLd = 0, worstTd = 0, missing = 0;
for (let seed = 1; seed <= 30; seed++){
  const o = { noise: seed, dipFt: 15, taxiS: seed % 2 ? 0 : 20 };
  const p = core.parseG3X(makeTakeoffCsv(o));
  const sN = core.summarize(p);
  if (!sN.takeoff || !sN.landing){ missing++; continue; }
  worstTo = Math.max(worstTo, Math.abs(sN.takeoff.distRoll / expectedRollMetres(o) - 1));
  worstLd = Math.max(worstLd, Math.abs(sN.landing.distRoll / expectedLandingRollMetres(o) - 1));
  worstTd = Math.max(worstTd, Math.abs(sN.landing.tdSec - p.rows[0].sec - touchdownSecond(o)));
}
ok(missing === 0 && worstTo < 0.08 && worstLd < 0.12 && worstTd <= 1,
  `mit Rauschen: Start ${(worstTo*100).toFixed(1)} %, Landung ${(worstLd*100).toFixed(1)} %, Aufsetzzeit ±${worstTd.toFixed(1)} s (${missing} nicht erkannt)`);

// Ein Standlauf darf KEINE Startstrecke liefern (sonst wäre die Erkennung zu gierig)
const groundSummary = core.summarize(core.parseG3X(sample.toString("utf8")));
ok(groundSummary.takeoff == null && groundSummary.landing == null, "Standlauf liefert weder Start noch Landung");
ok(groundSummary.startUtc === "09:35:01", `UTC auch im echten Beispiel-Log (${groundSummary.startUtc})`);

// ---- Grenzwert-Episoden: keine Flut kurzer Einträge, Startleistung erlaubt ----
{
  const mk = (fn) => Array.from({ length: 1200 }, (_, t) => ({ sec: t, timeStr: core.clockStr(t), ias: t > 60 ? 80 : 0, ...fn(t) }));
  const base = t => ({ rpm: t < 60 ? 1900 : t < 340 ? 5700 : 5000, map: t >= 60 && t < 340 ? 48 : 40,
                       oilT: 95, oilP: t < 60 ? 20 : 50 });
  let eps = core.allEpisodes(mk(base));
  ok(eps.length === 0, `Startleistung 4:40 min + Öldruck im Leerlauf -> keine Meldung (${eps.length})`);
  eps = core.allEpisodes(mk(t => ({ ...base(t), rpm: t === 100 || t === 101 ? 5820 : base(t).rpm })));
  ok(eps.length === 0, "2-s-Überschwinger über 5800 rpm beim Start -> keine Meldung");
  eps = core.allEpisodes(mk(t => ({ ...base(t), rpm: t >= 60 && t < 420 ? 5700 : base(t).rpm })));
  ok(eps.length === 1 && eps[0].key === "rpm" && eps[0].sev === "warn", "6 min Startleistung -> genau eine gelbe Meldung");
  eps = core.allEpisodes(mk(t => ({ ...base(t), oilT: t > 600 && t < 900 ? (t % 4 < 2 ? 111 : 109) : 95 })));
  ok(eps.length === 1 && eps[0].n > 50, `um 110 °C pendelnde Öltemperatur -> ein Eintrag (${eps.length}, ${eps[0]?.n}×)`);
  eps = core.allEpisodes(mk(t => ({ ...base(t), coolT: t >= 700 && t < 705 ? 125 : 90 })));
  ok(eps.length === 1 && eps[0].sev === "crit" && eps[0].secs === 5, "5 s Kühlmittel über 120 °C -> rot");
}

// Veraltete Zusammenfassung wird beim Scan neu berechnet (ohne Dateiänderung)
await beT.close();
const idx = JSON.parse(await fs.readFile(stateT, "utf8"));
const onlyId = Object.keys(idx.flights)[0];
idx.flights[onlyId].summary = { ...idx.flights[onlyId].summary, ver: 1, takeoff: undefined, startUtc: "" };
await fs.writeFile(stateT, JSON.stringify(idx));
const beT2 = await createBackend({ dataDir: folderT, stateFile: stateT, quietMs: 0, scanIntervalMs: 999999 });
const reS = (await (await fetch(beT2.url + "/api/flights")).json()).flights[0].summary;
ok(reS.ver === core.SUMMARY_VER && reS.takeoff && reS.landing && reS.startUtc === "09:35:00",
  `alte Zusammenfassung (v1) wurde automatisch neu berechnet (jetzt v${reS.ver})`);
await beT2.close();

await fs.rm(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} FEHLER` : "\nAlle Tests bestanden");
process.exit(fails ? 1 : 0);
