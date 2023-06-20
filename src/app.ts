// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { app, BrowserWindow, dialog, Menu, session, screen, shell } from 'electron'
import * as Electron from 'electron'
import * as path from 'path'
import * as url from 'url'
import { autoUpdater } from 'electron-updater'

let mainWindow = null;

const template = [{
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

  items.splice.apply(items, [position, 0].concat(updateItems));
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

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    center: true,
    resizable: true,
    title: app.getName(),
    icon: path.join(__dirname, '../assets/img/tfcc-small.png'),
  });

  const ur = url.format({
    protocol: 'file',
    slashes: true,
    pathname: path.join(__dirname, '../play.html'),
  });

  mainWindow.loadURL(ur, {
    userAgent: 'Free Chess Club',
  });

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

app.on('ready', createWindow);

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
