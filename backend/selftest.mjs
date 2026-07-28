// Headless-Test des lokalen Backends: JSON-Store, Ingest, HTTP-API, Upload.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBackend } from "./server.mjs";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "  OK " : "FAIL "} ${m}`); if (!c) fails++; };
const SAMPLE = "C:/Users/maxim/Downloads/log_20260516_113501______.csv";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "g3xdesk-"));
const sample = await fs.readFile(SAMPLE);
await fs.mkdir(path.join(tmp, "ingest"), { recursive: true });
await fs.writeFile(path.join(tmp, "ingest", "log_a.csv"), sample);

const be = await createBackend({ dataDir: tmp, scanIntervalMs: 999999, quietMs: 0 });
const j = async (p, opt) => (await fetch(be.url + p, opt)).json();

// Startscan hat die Ingest-Datei verarbeitet
let list = await j("/api/flights");
ok(list.total === 1, `Ingest beim Start: total=${list.total}`);
ok(list.flights[0].summary.type === "ground", `Typ ground (${list.flights[0].summary.type})`);
ok((await fs.readdir(path.join(tmp, "ingest"))).length === 0, "Eingang geleert");
const fid = list.flights[0].id;

// Roh-CSV abrufbar
const raw = await (await fetch(be.url + "/api/flights/" + encodeURIComponent(fid) + "/raw")).text();
ok(raw.startsWith("#airframe_info") || raw.includes("RPM"), "Roh-CSV abrufbar");

// Upload (neu) + Upload (dup)
const fd1 = new FormData();
fd1.append("file", new Blob([sample], { type: "text/csv" }), "b.csv");
let up = await j("/api/upload", { method: "POST", body: fd1 });
ok(up.counts.dup === 1, `identischer Upload -> Duplikat (${JSON.stringify(up.counts)})`);

const csv2 = sample.toString("utf8").replace(/2026-05-16/g, "2026-05-17");
const fd2 = new FormData();
fd2.append("file", new Blob([csv2], { type: "text/csv" }), "c.csv");
up = await j("/api/upload", { method: "POST", body: fd2 });
ok(up.counts.new === 1, `neuer Upload -> new (${JSON.stringify(up.counts)})`);
ok((await j("/api/flights")).total === 2, "jetzt 2 Flüge");

// Override + Filter
await fetch(be.url + "/api/flights/" + encodeURIComponent(fid), {
  method: "PATCH", headers: { "content-type": "application/json" },
  body: JSON.stringify({ typeOverride: "flight" }) });
ok((await j("/api/flights?type=flight")).total === 1, "Filter nach manuellem Typ");

// Stats + Status
const st = await j("/api/stats");
ok(st.total === 2 && st.dateMin === "2026-05-16", `Stats total=${st.total} min=${st.dateMin}`);
const status = await j("/api/status");
ok(status.archiveWritable === true && status.dataDir === tmp, "Status: Archiv schreibbar, dataDir gesetzt");

// Persistenz: Store neu laden (neues Backend, gleicher Ordner)
await be.close();
const be2 = await createBackend({ dataDir: tmp, scanIntervalMs: 999999, quietMs: 0 });
ok((await (await fetch(be2.url + "/api/flights")).json()).total === 2, "Persistenz: 2 Flüge nach Neustart");
ok((await (await fetch(be2.url + "/api/flights?type=flight")).json()).total === 1, "Persistenz: Override erhalten");
await be2.close();

await fs.rm(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} FEHLER` : "\nAlle Tests bestanden");
process.exit(fails ? 1 : 0);
