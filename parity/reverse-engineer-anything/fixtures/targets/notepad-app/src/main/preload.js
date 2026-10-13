const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('notesApi', {
  search: (query) => ipcRenderer.invoke('notes:search', query),
});
