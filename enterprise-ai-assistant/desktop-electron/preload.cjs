// Preload: expose a minimal, safe bridge to the renderer.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("eaiDesktop", {
  version: () => ipcRenderer.invoke("app:version"),
  isDesktop: true,
});
