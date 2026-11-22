const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bubble', {
  onUpdate: callback => ipcRenderer.on('bubble:update', (_event, value) => callback(value)),
  resized: height => ipcRenderer.send('bubble:resized', height)
});
