const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { searchNotes } = require('./search');
const nativeIndex = require('../../build/native/index.node');

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 900, height: 600, webPreferences: { preload: `${__dirname}/preload.js`, contextIsolation: true } });
  win.loadFile('src/renderer/index.html');
});

ipcMain.handle('notes:search', async (_event, query) => {
  const rows = searchNotes(query, nativeIndex.buildIndex());
  return dialog.showMessageBox ? rows : rows;
});
