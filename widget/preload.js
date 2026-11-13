// 渲染层与主进程之间只开放这几个通道
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  onData: (cb) => ipcRenderer.on('data', (_e, payload) => cb(payload)),
  onPinned: (cb) => ipcRenderer.on('pinned', (_e, v) => cb(v)),
  onMode: (cb) => ipcRenderer.on('mode', (_e, m) => cb(m)),
  onPet: (cb) => ipcRenderer.on('pet', (_e, v) => cb(v)),
  onOpenConfig: (cb) => ipcRenderer.on('open-config', () => cb()),
  act: (name, arg) => ipcRenderer.send('action', name, arg),
});
