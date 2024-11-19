// Copyright 2024 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electron', {
  encrypt: (value) => ipcRenderer.invoke('encrypt', value),
  decrypt: (value) => ipcRenderer.invoke('decrypt', value),
});
