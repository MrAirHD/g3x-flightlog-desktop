// Electron-Hauptprozess: startet das lokale Backend im selben Prozess (nur
// 127.0.0.1, kein Login), öffnet das Fenster darauf und bietet Datenordner-
// Wahl + Sprachumschaltung (Menü). 100% lokal, keine Cloud, keine Ports nach außen.
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require("electron");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { load, save } = require("./settings.cjs");

// Index-Datei je CSV-Ordner in den App-Daten (der Ordner selbst bleibt sauber).
function indexFileFor(dataDir) {
  const h = crypto.createHash("sha1").update(path.resolve(dataDir)).digest("hex").slice(0, 16);
  return path.join(app.getPath("userData"), "index", `idx-${h}.json`);
}

let settings = null;
let backend = null;
let win = null;
let createBackend = null;

const T = {
  en: {
    file: "File", chooseFolder: "Choose data folder…", openFolder: "Open data folder",
    rescan: "Rescan now", quit: "Quit", language: "Language", view: "View",
    reload: "Reload", devtools: "Toggle DevTools", fullscreen: "Toggle Fullscreen",
    help: "Help", about: "About",
    chooseTitle: "Choose data folder",
    aboutMsg: (v, d) => `G3X Flugbuch ${v}\n\n100% local. Data folder:\n${d}`,
  },
  de: {
    file: "Datei", chooseFolder: "Datenordner wählen…", openFolder: "Datenordner öffnen",
    rescan: "Jetzt neu einlesen", quit: "Beenden", language: "Sprache", view: "Ansicht",
    reload: "Neu laden", devtools: "Entwicklertools", fullscreen: "Vollbild",
    help: "Hilfe", about: "Über",
    chooseTitle: "Datenordner wählen",
    aboutMsg: (v, d) => `G3X Flugbuch ${v}\n\n100% lokal. Datenordner:\n${d}`,
  },
};

async function startBackend(dataDir) {
  if (!createBackend) {
    const mod = await import(pathToFileURL(path.join(__dirname, "..", "backend", "server.mjs")).href);
    createBackend = mod.createBackend;
  }
  return createBackend({ dataDir, stateFile: indexFileFor(dataDir) });
}

async function switchDataDir(newDir) {
  if (!newDir || newDir === settings.dataDir) return;
  settings.dataDir = newDir;
  save(settings);
  try { await backend.close(); } catch {}
  backend = await startBackend(newDir);
  await win.loadURL(backend.url);
  buildMenu();
}

async function chooseFolder() {
  const t = T[settings.language] || T.en;
  const res = await dialog.showOpenDialog(win, {
    title: t.chooseTitle, defaultPath: settings.dataDir, properties: ["openDirectory", "createDirectory"],
  });
  if (!res.canceled && res.filePaths[0]) await switchDataDir(res.filePaths[0]);
}

function buildMenu() {
  const t = T[settings.language] || T.en;
  const template = [
    {
      label: t.file,
      submenu: [
        { label: t.chooseFolder, accelerator: "CmdOrCtrl+O", click: chooseFolder },
        { label: t.openFolder, click: () => shell.openPath(settings.dataDir) },
        { type: "separator" },
        { label: t.rescan, accelerator: "CmdOrCtrl+R", click: async () => { try { await backend.scan(); } catch {} win.webContents.reload(); } },
        { type: "separator" },
        { role: "quit", label: t.quit },
      ],
    },
    {
      label: t.language,
      submenu: [
        { label: "English", type: "radio", checked: settings.language === "en",
          click: () => { settings.language = "en"; save(settings); buildMenu(); } },
        { label: "Deutsch", type: "radio", checked: settings.language === "de",
          click: () => { settings.language = "de"; save(settings); buildMenu(); } },
      ],
    },
    {
      label: t.view,
      submenu: [
        { role: "reload", label: t.reload },
        { role: "toggleDevTools", label: t.devtools },
        { type: "separator" },
        { role: "togglefullscreen", label: t.fullscreen },
        { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" },
      ],
    },
    {
      label: t.help,
      submenu: [
        { label: t.about, click: () => dialog.showMessageBox(win, {
          type: "info", title: t.about, message: "G3X Flugbuch",
          detail: t.aboutMsg(app.getVersion(), settings.dataDir),
        }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- IPC für die Statusleiste im Frontend ----
ipcMain.handle("desktop:getInfo", () => ({
  dataDir: settings.dataDir, language: settings.language, version: app.getVersion(),
}));
ipcMain.handle("desktop:chooseFolder", async () => { await chooseFolder(); return settings.dataDir; });
ipcMain.handle("desktop:openFolder", () => shell.openPath(settings.dataDir));

async function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: "#0d0d0d",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL(backend.url);
}

// Nur eine Instanz zulassen
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(async () => {
    settings = load();
    backend = await startBackend(settings.dataDir);
    buildMenu();
    await createWindow();

    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on("window-all-closed", async () => {
    try { await backend?.close(); } catch {}
    if (process.platform !== "darwin") app.quit();
  });
}
