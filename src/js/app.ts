// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { session, app, BrowserWindow, safeStorage, ipcMain, Menu, screen, shell } from 'electron'
import * as path from 'path'
import * as url from 'url'
import { autoUpdater } from 'electron-updater'

let mainWindow = null;

const template: any = [{
  label: 'Edit',
  submenu: [{
    label: 'Undo',
    accelerator: 'CmdOrCtrl+Z',
    role: 'undo',
  }, {
    label: 'Redo',
    accelerator: 'Shift+CmdOrCtrl+Z',
    role: 'redo',
  }, {
    type: 'separator',
  }, {
    label: 'Cut',
    accelerator: 'CmdOrCtrl+X',
    role: 'cut',
  }, {
    label: 'Copy',
    accelerator: 'CmdOrCtrl+C',
    role: 'copy',
  }, {
    label: 'Paste',
    accelerator: 'CmdOrCtrl+V',
    role: 'paste',
  }, {
    label: 'Select All',
    accelerator: 'CmdOrCtrl+A',
    role: 'selectall',
  }],
}, {
  label: 'View',
  submenu: [{
    label: 'Reload',
    accelerator: 'CmdOrCtrl+R',
    click: (item, focusedWindow) => {
      if (focusedWindow) {
        if (focusedWindow.id === 1) {
          BrowserWindow.getAllWindows().forEach((win) => {
            if (win.id > 1) {
              win.close();
            }
          });
        }
        focusedWindow.reload();
      }
    },
  }, {
    label: 'Toggle Full Screen',
    accelerator: (() => {
      if (process.platform === 'darwin') {
        return 'Ctrl+Command+F';
      } else {
        return 'F11';
      }
    })(),
    click: (item, focusedWindow) => {
      if (focusedWindow) {
        focusedWindow.setFullScreen(!focusedWindow.isFullScreen());
      }
    },
  }, {
    label: 'Toggle Dev Tools',
    accelerator: (() => {
      if (process.platform === 'darwin') {
        return 'Command+Option+I';
      } else {
        return 'F12';
      }
    })(),
    click: (item, focusedWindow) => {
      if (focusedWindow) {
        focusedWindow.toggleDevTools();
      }
    },
  }],
}, {
  label: 'Window',
  role: 'window',
  submenu: [{
    label: 'Minimize',
    accelerator: 'CmdOrCtrl+M',
    role: 'minimize',
  }, {
    label: 'Close',
    accelerator: 'CmdOrCtrl+W',
    role: 'close',
  }, {
    type: 'separator',
  }, {
    label: 'Reopen Window',
    accelerator: 'CmdOrCtrl+Shift+T',
    enabled: false,
    key: 'reopenMenuItem',
    click: () => {
      app.emit('activate');
    },
  }],
}, {
  label: 'Help',
  role: 'help',
  submenu: [{
    label: 'Learn More',
    click: () => {
      shell.openExternal('https://www.freechess.club');
    },
  }],
}];

function setupAutoUpdater() {
  autoUpdater.on('checking-for-update', () => {
    updateMenuLabel('checkingForUpdate', 'Checking for Update...');
  });

  autoUpdater.on('update-available', () => {
    updateMenuLabel('checkingForUpdate', 'Update available...');
  });

  autoUpdater.on('update-not-available', () => {
    updateMenuLabel('checkingForUpdate', 'No update available');
  });

  autoUpdater.on('error', (error) => {
    updateMenuLabel('checkingForUpdate', `Update error: ${error == null ? "unknown" : (error.message || error.toString())}`);
  });

  autoUpdater.on('update-downloaded', () => {
    updateMenuLabel('checkingForUpdate', 'Update ready to install');
    updateMenuVisibility('restartToUpdate', true);
  });
}

function updateMenuVisibility(key, visible) {
  const match = findMenuItem(key);
  if (match) {
    match.visible = visible;
    refreshMenu();
  }
}

function updateMenuLabel(key, newLabel) {
  const match = findMenuItem(key);
  if (match) {
    match.label = newLabel;
    refreshMenu();
  }
}

function findMenuItem(key) {
  for (const item of template) {
    const match = item.submenu?.find(i => i.key === key);
    if (match)
      return match;
  }
  return null;
}

function refreshMenu() {
  const updatedMenu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(updatedMenu);
}

function addUpdateMenuItems(items, position) {
  if (process.mas) {
    return;
  }

  const version = app.getVersion();
  const updateItems = [{
    label: `Version ${version}`,
    enabled: false,
  }, {
    label: 'Checking for Update',
    enabled: false,
    visible: true,
    key: 'checkingForUpdate',
  }, {
    label: 'Check for Update',
    visible: false,
    key: 'checkForUpdate',
    click: () => {
      autoUpdater.checkForUpdatesAndNotify();
    },
  }, {
    label: 'Restart and Install Update',
    enabled: true,
    visible: false,
    key: 'restartToUpdate',
    click: () => {
      autoUpdater.quitAndInstall();
    },
  }];

  items.splice(position, 0, ...updateItems);
}

if (process.platform === 'darwin') {
  const name = app.getName();
  template.unshift({
    label: name,
    submenu: [{
      label: `About ${name}`,
      role: 'about',
    }, {
      type: 'separator',
    }, {
      label: 'Services',
      role: 'services',
      submenu: [],
    }, {
      type: 'separator',
    }, {
      label: `Hide ${name}`,
      accelerator: 'Command+H',
      role: 'hide',
    }, {
      label: 'Hide Others',
      accelerator: 'Command+Alt+H',
      role: 'hideothers',
    }, {
      label: 'Show All',
      role: 'unhide',
    }, {
      type: 'separator',
    }, {
      label: 'Quit',
      accelerator: 'Command+Q',
      click: () => {
        app.quit();
      },
    }],
  } as any);

  // Window menu.
  (template[3].submenu as any).push({
    type: 'separator',
  }, {
    label: 'Bring All to Front',
    role: 'front',
  });

  addUpdateMenuItems(template[0].submenu, 1);
}

if (process.platform === 'win32') {
  const helpMenu = template[template.length - 1].submenu;
  addUpdateMenuItems(helpMenu, 0);
}

function findReopenMenuItem() {
  const menu = Menu.getApplicationMenu();
  if (!menu) {
    return;
  }

  let reopenMenuItem;
  menu.items.forEach((item: any) => {
    if (item.submenu) {
      item.submenu.items.forEach((subitem: any) => {
        if (subitem.key === 'reopenMenuItem') {
          reopenMenuItem = subitem;
        }
      });
    }
  });
  return reopenMenuItem;
}

/**
 * Functions exposed to the renderer
 */

// secure encryption and key storage
ipcMain.handle('encrypt', (event, value) => {
  const buff = safeStorage.encryptString(value);
  return buff.toString('base64');
});
ipcMain.handle('decrypt', (event, value) => {
  const buff = Buffer.from(value, 'base64');
  return safeStorage.decryptString(buff);
});

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  mainWindow = new BrowserWindow({
    width,
    height,
    center: true,
    resizable: true,
    title: app.getName(),
    icon: path.join(__dirname, '../../www/assets/img/tfcc-small.png'),
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const ur = url.format({
    protocol: 'file',
    slashes: true,
    pathname: path.join(__dirname, '../../www/play.html'),
  });

  mainWindow.loadURL(ur);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Stop 'beforeunload' event (confirmation dialog in browser) from preventing the window closing
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    event.preventDefault();
  })

  const menu = Menu.buildFromTemplate(template as any);
  Menu.setApplicationMenu(menu);
  mainWindow.show();
  setupAutoUpdater();
}

app.on('browser-window-created', () => {
  const reopenMenuItem = findReopenMenuItem();
  if (reopenMenuItem) {
    reopenMenuItem.enabled = false;
  }
});

app.setName('Free Chess Club');

if (process.platform === 'darwin') {
  app.setAboutPanelOptions({
    applicationName: app.getName(),
    applicationVersion: app.getVersion(),
    copyright: 'Released under the MIT license',
    credits: 'Free Chess Club Author(s)',
  });
}

app.on('ready', () => {
  // Add COOP/COEP headers for multi-threading
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp'
      }
    })
  })

  createWindow();
  autoUpdater.checkForUpdatesAndNotify();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }

  const reopenMenuItem = findReopenMenuItem();
  if (reopenMenuItem) {
    reopenMenuItem.enabled = true;
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
