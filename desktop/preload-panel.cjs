const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('plana', {
  initialize: () => ipcRenderer.invoke('panel:initialize'),
  onFeedback: fn => ipcRenderer.on('panel:feedback', () => fn()),
  request: (route, body, id) => ipcRenderer.invoke('panel:request', { route, body, id }),
  cancel: id => ipcRenderer.send('panel:cancel', id),
  configure: patch => ipcRenderer.invoke('panel:configure', patch),
  hide: () => ipcRenderer.send('panel:hide'),
  activity: value => ipcRenderer.send('panel:activity', value),
  onMode: callback => { ipcRenderer.on('panel:mode', (_event, value) => callback(value)); },
  onTouch: callback => { ipcRenderer.on('panel:touch', () => callback()); },
  onSettings: callback => { ipcRenderer.on('panel:settings', (_event, value) => callback(value)); },
  onTab: callback => { ipcRenderer.on('panel:tab', (_event, value) => callback(value)); },
  onStop: callback => { ipcRenderer.on('panel:stop', () => callback()); },
  onReconnect: callback => { ipcRenderer.on('panel:reconnect', () => callback()); }
});
