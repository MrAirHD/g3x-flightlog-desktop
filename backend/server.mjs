// Lokales Backend für die Desktop-App (Electron). Kein Login, nur an 127.0.0.1.
// Liest die CSVs DIREKT im gewählten Ordner (keine Unterordner, nichts wird
// verschoben). Der Index liegt separat in den App-Daten (stateFile).
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fstatic from "@fastify/static";
import { promises as fs, createReadStream } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { makeJsonStore } from "./store-json.mjs";
import { makeFolderScan } from "./folder-scan.mjs";

const require = createRequire(import.meta.url);
const core = require("../core/g3x-core.cjs");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// dataDir = der CSV-Ordner (wird in-place gelesen). stateFile = Index in App-Daten.
export async function createBackend({ dataDir, stateFile, host = "127.0.0.1", port = 0, scanIntervalMs = 8000, quietMs = 2500 } = {}) {
  await fs.mkdir(dataDir, { recursive: true });
  if (!stateFile) stateFile = path.join(dataDir, ".g3x-index.json");

  const store = makeJsonStore(stateFile);
  const app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024, files: 500 } });

  const scanner = makeFolderScan({ store, core, getDataDir: () => dataDir, quietMs, log: () => {} });

  // ---- API ----
  app.get("/api/me", async () => ({ authed: true, needsPassword: false }));
  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/flights", async (req) => {
    const q = req.query || {};
    return store.list({
      type: q.type || "all", month: q.month || "all",
      warnOnly: q.warnOnly === "1" || q.warnOnly === "true",
      sort: q.sort === "asc" ? "asc" : "desc",
      offset: Math.max(0, parseInt(q.offset) || 0),
      limit: Math.min(5000, Math.max(1, parseInt(q.limit) || 300)),
    });
  });
  app.get("/api/stats", async () => ({ ...store.stats(), months: store.months(), errors: store.errors().length }));
  app.get("/api/errors", async () => store.errors());

  app.get("/api/flights/:id", async (req, reply) => {
    const r = store.get(req.params.id);
    if (!r) return reply.code(404).send({ error: "not_found" });
    return { id: r.id, name: r.name, typeOverride: r.typeOverride || null, summary: r.summary };
  });
  app.get("/api/flights/:id/raw", async (req, reply) => {
    const r = store.get(req.params.id);
    if (!r) return reply.code(404).send({ error: "not_found" });
    try { await fs.access(r.sourcePath); }
    catch { return reply.code(410).send({ error: "file_missing" }); }
    reply.header("content-type", "text/csv; charset=utf-8");
    return reply.send(createReadStream(r.sourcePath));
  });
  app.patch("/api/flights/:id", async (req, reply) => {
    const r = store.get(req.params.id);
    if (!r) return reply.code(404).send({ error: "not_found" });
    const val = (req.body && req.body.typeOverride) || null;
    if (val && !["flight", "ground", "panel"].includes(val)) return reply.code(400).send({ error: "bad_type" });
    store.setOverride(req.params.id, val);
    return { ok: true, typeOverride: val };
  });
  // Löschen entfernt die tatsächliche CSV aus dem Ordner (und aus dem Index).
  app.delete("/api/flights/:id", async (req, reply) => {
    const r = store.get(req.params.id);
    if (!r) return reply.code(404).send({ error: "not_found" });
    try { await fs.unlink(r.sourcePath); } catch {}
    store.remove(req.params.id);
    return { ok: true };
  });

  app.post("/api/rescan", async () => ({ ok: true, counts: await scanner.scan() }));

  // Drag&drop: Datei DIREKT in den CSV-Ordner kopieren (atomar), dann scannen.
  app.post("/api/upload", async (req) => {
    let saved = 0;
    for await (const part of req.parts()) {
      if (part.type !== "file") continue;
      if (!part.filename || !part.filename.toLowerCase().endsWith(".csv")) { part.file.resume(); continue; }
      const base = part.filename.replace(/[\\/]/g, "_").replace(/[^A-Za-z0-9._ -]/g, "_");
      let target = path.join(dataDir, base);
      // Namenskollision -> Suffix, damit keine fremde Datei überschrieben wird.
      try {
        let i = 1;
        for (;;) { try { await fs.access(target); } catch { break; }
          const ext = path.extname(base), stem = base.slice(0, -ext.length || undefined);
          target = path.join(dataDir, `${stem} (${i++})${ext}`); }
      } catch {}
      const chunks = [];
      for await (const ch of part.file) chunks.push(ch);
      await fs.writeFile(target + ".part", Buffer.concat(chunks));
      await fs.rename(target + ".part", target);
      // Datei ist atomar geschrieben, also vollständig -> Änderungsdatum bewusst
      // zurückdatieren, damit die Ruhephase (Schutz vor halb kopierten Dateien)
      // sie nicht überspringt und sie SOFORT im nächsten Scan erscheint.
      try { const past = new Date(Date.now() - quietMs - 5000); await fs.utimes(target, past, past); } catch {}
      saved++;
    }
    return { ok: true, saved, counts: await scanner.scan() };
  });

  let writable = true;
  try { const p = path.join(dataDir, ".g3x-write-test"); await fs.writeFile(p, "ok"); await fs.unlink(p); }
  catch { writable = false; }
  app.get("/api/status", async () => ({ archiveWritable: writable, dataDir }));

  // ---- Statik: SPA + geteilter Core + vendored Leaflet ----
  // index.html bindet den Core mit Inhalts-Hash ein (?v=…), beide gehen als
  // no-cache raus. Sonst liefert ein Browser- oder Proxy-Cache (z. B. Cloudflare)
  // nach einem Update den ALTEN Core zur NEUEN Seite — der Bericht bleibt leer.
  const coreFile = path.join(ROOT, "core", "g3x-core.cjs");
  const coreVer = createHash("sha256").update(await fs.readFile(coreFile)).digest("hex").slice(0, 12);
  const indexHtml = (await fs.readFile(path.join(ROOT, "app", "index.html"), "utf8"))
    .replace('src="/g3x-core.js"', `src="/g3x-core.js?v=${coreVer}"`);
  const sendIndex = async (_req, reply) =>
    reply.header("cache-control", "no-cache").type("text/html; charset=utf-8").send(indexHtml);
  app.get("/", sendIndex);
  app.get("/index.html", sendIndex);
  await app.register(fstatic, { root: path.join(ROOT, "app"), prefix: "/", index: false });
  app.get("/g3x-core.js", async (_req, reply) => {
    reply.type("application/javascript").header("cache-control", "no-cache");
    return reply.send(createReadStream(coreFile));
  });

  await scanner.scan();
  const timer = setInterval(() => scanner.scan().catch(() => {}), scanIntervalMs);

  await app.listen({ port, host });
  const actualPort = app.server.address().port;

  return {
    url: `http://${host}:${actualPort}`,
    port: actualPort, dataDir,
    scan: () => scanner.scan(),
    async close() { clearInterval(timer); try { await store.flush(); } catch {} await app.close(); },
  };
}
