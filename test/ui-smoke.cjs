// End-to-End-Rauchtest der Oberfläche: startet das lokale Backend mit einem
// synthetischen Start-Log, lädt die echte SPA in einem unsichtbaren Fenster und
// liest ab, was der Detailbericht tatsächlich anzeigt.
//   Aufruf:  npx electron test/ui-smoke.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "  OK " : "FAIL "} ${m}`); if (!c) fails++; };

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const { createBackend } = await import(
    "file://" + path.join(__dirname, "..", "backend", "server.mjs").replace(/\\/g, "/"));
  const { makeTakeoffCsv } = await import(
    "file://" + path.join(__dirname, "takeoff-fixture.mjs").replace(/\\/g, "/"));

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "g3x-ui-"));
  const folder = path.join(tmp, "logs");
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, "start.csv"), makeTakeoffCsv());

  const be = await createBackend({
    dataDir: folder, stateFile: path.join(tmp, "idx.json"),
    quietMs: 0, scanIntervalMs: 999999,
  });

  const win = new BrowserWindow({ show: false, width: 1400, height: 1000 });
  const errors = [];
  win.webContents.on("console-message", (_e, level, message) => {
    // Electrons Entwickler-Warnungen (CSP o. Ä.) sind keine Fehler der App.
    if (level >= 2 && !message.includes("Electron Security Warning")) errors.push(message);
  });
  await win.loadURL(be.url);

  const read = () => win.webContents.executeJavaScript(`(() => {
    const q = s => document.querySelector(s);
    return {
      listHtml: q("#flightList") ? q("#flightList").innerHTML : "",
      meta: q("#meta") ? q("#meta").textContent : "",
      ovTiles: q("#ovTiles") ? q("#ovTiles").textContent : "",
      takeoffShown: q("#takeoffCard") ? q("#takeoffCard").style.display !== "none" : false,
      takeoffTiles: q("#takeoffTiles") ? q("#takeoffTiles").textContent : "",
      takeoffNote: q("#takeoffNote") ? q("#takeoffNote").textContent : "",
      phaseTimes: q("#phaseTimes") ? q("#phaseTimes").textContent : "",
      landingTiles: q("#landingTiles") ? q("#landingTiles").textContent : "",
      takeoffH: q("#takeoffH") ? q("#takeoffH").textContent : "",
      landingH: q("#landingH") ? q("#landingH").textContent : "",
      charts: [...document.querySelectorAll("#takeoffChart svg, #landingChart svg")].length,
      chartText: [...document.querySelectorAll("#takeoffChart, #landingChart")].map(e => e.textContent).join(" "),
    };
  })()`);

  const waitFor = async (fn, ms = 15000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await read();
      if (fn(v)) return v;
      if (Date.now() - t0 > ms) return v;
      await new Promise(r => setTimeout(r, 200));
    }
  };

  // ---- Übersicht ----
  let v = await waitFor(x => x.listHtml.includes("fl-when"));
  ok(/09:35Z/.test(v.listHtml), `UTC-Zeit steht in der Zeitleiste ${/09:35Z/.test(v.listHtml) ? "(09:35Z)" : ""}`);
  ok(/Startlauf<\/span>|Startlauf /.test(v.listHtml.replace(/<b>/g, "")) || v.listHtml.includes("Startlauf"),
    "Startrollstrecke steht als Fakt in der Zeitleiste");
  ok(/Ø Startrollstrecke/.test(v.ovTiles), "Übersichtskachel „Ø Startrollstrecke“ vorhanden");
  ok(v.listHtml.includes("09:35Z") && v.listHtml.includes("09:45Z") && v.listHtml.includes("🛬"),
    "Start- und Landezeit (UTC) stehen in der Zeitleiste");

  // ---- Detailbericht öffnen ----
  await win.webContents.executeJavaScript(`document.querySelector("#flightList li").click()`);
  v = await waitFor(x => x.takeoffShown);

  ok(v.takeoffShown, "Startlauf-Karte wird im Detailbericht angezeigt");
  ok(/UTC/.test(v.meta) && /09:35:00/.test(v.meta), `Kopfzeile zeigt UTC: ${v.meta.slice(0, 160)}`);
  const tiles = v.takeoffTiles.replace(/\s+/g, " ");
  ok(/Startrollstrecke ?2\d\d m/.test(tiles), `Startrollstrecke in der Karte: ${tiles.slice(0, 90)}`);
  ok(tiles.includes("09:35:39 UTC"), "Losrollen mit UTC-Zeit");
  const times = v.phaseTimes.replace(/\s+/g, " ");
  ok(/Startzeit \(Abheben\) ?09:35:57 UTC ?11:35:57 lokal/.test(times), `Startzeit in UTC: ${times.slice(0, 80)}`);
  ok(/Landezeit \(Aufsetzen\) ?09:45:57 UTC ?11:45:57 lokal/.test(times), "Landezeit in UTC");
  ok(/Flugzeit ?10 min/.test(times), "Flugzeit Abheben–Aufsetzen");
  const ltiles = v.landingTiles.replace(/\s+/g, " ");
  ok(/Landerollstrecke ?2\d\d m/.test(ltiles) && /Aufsetzgeschwindigkeit ?\d+ kt IAS/.test(ltiles),
    `Landekacheln: ${ltiles.slice(0, 120)}`);
  ok(!/undefined|NaN|–\s*m/.test(ltiles + times), "keine leeren Werte in den Landekacheln");
  ok(v.charts === 2 && /Abheben · 2\d\d m/.test(v.chartText) && /Aufsetzen · \d+ m/.test(v.chartText),
    `Start- und Landeverlauf als Diagramm (${v.charts} Diagramme)`);
  ok(/Abhebegeschwindigkeit ?\d+ kt IAS/.test(tiles), "Abhebegeschwindigkeit als IAS");
  ok(!/undefined|NaN|–\s*m/.test(tiles), `keine leeren Werte in den Kacheln (${tiles.slice(0, 200)})`);
  ok(v.takeoffNote.length > 80, "Erläuterung unter der Karte vorhanden");

  // ---- Dasselbe auf Englisch (alle neuen Texte müssen übersetzt sein) ----
  await win.webContents.executeJavaScript(
    `localStorage.setItem("g3x-cfg", JSON.stringify({ lang: "en" }))`);
  await win.webContents.reload();
  v = await waitFor(x => x.listHtml.includes("fl-when"));
  await win.webContents.executeJavaScript(`document.querySelector("#flightList li").click()`);
  v = await waitFor(x => x.takeoffShown);
  const en = v.takeoffTiles.replace(/\s+/g, " ");
  ok(/Ground roll ?2\d\d m/.test(en), `englische Kachelbeschriftung: ${en.slice(0, 80)}`);
  const enAll = en + v.takeoffNote + v.phaseTimes + v.landingTiles + v.takeoffH + v.landingH + v.chartText;
  ok(!/Startrollstrecke|Abheben|Platzhöhe|Losrollen|Landung|Aufsetzen|Flugzeit|lokal|Höhe|Strecke|bis 10|ab 50/.test(enAll),
    "keine deutschen Resttexte in der englischen Start-/Landekarte" + ((enAll.match(/Startrollstrecke|Abheben|Platzhöhe|Losrollen|Landung|Aufsetzen|Flugzeit|lokal|Höhe|Strecke|bis 10|ab 50/g) || []).length ? ": " + enAll.match(/.{0,40}(Startrollstrecke|Abheben|Platzhöhe|Losrollen|Landung|Aufsetzen|Flugzeit|lokal|Höhe|Strecke|bis 10|ab 50).{0,40}/g).join(" | ") : ""));
  ok(/Takeoff time \(liftoff\)/.test(v.phaseTimes) && /Landing roll/.test(v.landingTiles), "englische Start-/Landezeiten");
  ok(/Liftoff/.test(v.takeoffNote), "Erläuterung ist übersetzt");

  ok(errors.length === 0, `keine JS-Fehler in der Konsole${errors.length ? ": " + errors.join(" | ") : ""}`);

  await be.close();
  await fs.rm(tmp, { recursive: true, force: true });
  console.log(fails ? `\n${fails} FEHLER` : "\nOberfläche OK");
  app.exit(fails ? 1 : 0);
}).catch(e => { console.error("ABBRUCH:", e); app.exit(1); });
