// Schmale, sichere Bridge in die Seite.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  getInfo: () => ipcRenderer.invoke("desktop:getInfo"),
  chooseFolder: () => ipcRenderer.invoke("desktop:chooseFolder"),
  openFolder: () => ipcRenderer.invoke("desktop:openFolder"),
  setSettings: (patch) => ipcRenderer.invoke("desktop:setSettings", patch),
});
