"use strict";
// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.
exports.__esModule = true;
var electron_1 = require("electron");
var path = require("path");
var url = require("url");
var electron_updater_1 = require("electron-updater");
var mainWindow = null;
var template = [{
        label: 'Edit',
        submenu: [{
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                role: 'undo'
            }, {
                label: 'Redo',
                accelerator: 'Shift+CmdOrCtrl+Z',
                role: 'redo'
            }, {
                type: 'separator'
            }, {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                role: 'cut'
            }, {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                role: 'copy'
            }, {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                role: 'paste'
            }, {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                role: 'selectall'
            }]
    }, {
        label: 'View',
        submenu: [{
                label: 'Reload',
                accelerator: 'CmdOrCtrl+R',
                click: function (item, focusedWindow) {
                    if (focusedWindow) {
                        if (focusedWindow.id === 1) {
                            electron_1.BrowserWindow.getAllWindows().forEach(function (win) {
                                if (win.id > 1) {
                                    win.close();
                                }
                            });
                        }
                        focusedWindow.reload();
                    }
                }
            }, {
                label: 'Toggle Full Screen',
                accelerator: (function () {
                    if (process.platform === 'darwin') {
                        return 'Ctrl+Command+F';
                    }
                    else {
                        return 'F11';
                    }
                })(),
                click: function (item, focusedWindow) {
                    if (focusedWindow) {
                        focusedWindow.setFullScreen(!focusedWindow.isFullScreen());
                    }
                }
            }, {
                label: 'Toggle Dev Tools',
                accelerator: (function () {
                    if (process.platform === 'darwin') {
                        return 'Command+Option+I';
                    }
                    else {
                        return 'F12';
                    }
                })(),
                click: function (item, focusedWindow) {
                    if (focusedWindow) {
                        focusedWindow.toggleDevTools();
                    }
                }
            }]
    }, {
        label: 'Window',
        role: 'window',
        submenu: [{
                label: 'Minimize',
                accelerator: 'CmdOrCtrl+M',
                role: 'minimize'
            }, {
                label: 'Close',
                accelerator: 'CmdOrCtrl+W',
                role: 'close'
            }, {
                type: 'separator'
            }, {
                label: 'Reopen Window',
                accelerator: 'CmdOrCtrl+Shift+T',
                enabled: false,
                key: 'reopenMenuItem',
                click: function () {
                    electron_1.app.emit('activate');
                }
            }]
    }, {
        label: 'Help',
        role: 'help',
        submenu: [{
                label: 'Learn More',
                click: function () {
                    electron_1.shell.openExternal('https://www.freechess.club');
                }
            }]
    }];
function addUpdateMenuItems(items, position) {
    if (process.mas) {
        return;
    }
    var version = electron_1.app.getVersion();
    var updateItems = [{
            label: "Version ".concat(version),
            enabled: false
        }, {
            label: 'Checking for Update',
            enabled: false,
            key: 'checkingForUpdate'
        }, {
            label: 'Check for Update',
            visible: false,
            key: 'checkForUpdate',
            click: function () {
                electron_updater_1.autoUpdater.checkForUpdatesAndNotify();
            }
        }, {
            label: 'Restart and Install Update',
            enabled: true,
            visible: false,
            key: 'restartToUpdate',
            click: function () {
                electron_updater_1.autoUpdater.quitAndInstall();
            }
        }];
    items.splice.apply(items, [position, 0].concat(updateItems));
}
if (process.platform === 'darwin') {
    var name_1 = electron_1.app.getName();
    template.unshift({
        label: name_1,
        submenu: [{
                label: "About ".concat(name_1),
                role: 'about'
            }, {
                type: 'separator'
            }, {
                label: 'Services',
                role: 'services',
                submenu: []
            }, {
                type: 'separator'
            }, {
                label: "Hide ".concat(name_1),
                accelerator: 'Command+H',
                role: 'hide'
            }, {
                label: 'Hide Others',
                accelerator: 'Command+Alt+H',
                role: 'hideothers'
            }, {
                label: 'Show All',
                role: 'unhide'
            }, {
                type: 'separator'
            }, {
                label: 'Quit',
                accelerator: 'Command+Q',
                click: function () {
                    electron_1.app.quit();
                }
            }]
    });
    // Window menu.
    template[3].submenu.push({
        type: 'separator'
    }, {
        label: 'Bring All to Front',
        role: 'front'
    });
    addUpdateMenuItems(template[0].submenu, 1);
}
if (process.platform === 'win32') {
    var helpMenu = template[template.length - 1].submenu;
    addUpdateMenuItems(helpMenu, 0);
}
function findReopenMenuItem() {
    var menu = electron_1.Menu.getApplicationMenu();
    if (!menu) {
        return;
    }
    var reopenMenuItem;
    menu.items.forEach(function (item) {
        if (item.submenu) {
            item.submenu.items.forEach(function (subitem) {
                if (subitem.key === 'reopenMenuItem') {
                    reopenMenuItem = subitem;
                }
            });
        }
    });
    return reopenMenuItem;
}
function createWindow() {
    var _a = electron_1.screen.getPrimaryDisplay().workAreaSize, width = _a.width, height = _a.height;
    mainWindow = new electron_1.BrowserWindow({
        width: width,
        height: height,
        center: true,
        resizable: true,
        title: electron_1.app.getName(),
        icon: path.join(__dirname, '../assets/img/tfcc-small.png')
    });
    var ur = url.format({
        protocol: 'file',
        slashes: true,
        pathname: path.join(__dirname, '../play.html')
    });
    mainWindow.loadURL(ur, {
        userAgent: 'Free Chess Club'
    });
    mainWindow.on('closed', function () {
        mainWindow = null;
    });
    // Stop 'beforeunload' event (confirmation dialog in browser) from preventing the window closing 
    mainWindow.webContents.on('will-prevent-unload', function (event) {
        event.preventDefault();
    });
    var menu = electron_1.Menu.buildFromTemplate(template);
    electron_1.Menu.setApplicationMenu(menu);
    mainWindow.show();
}
electron_1.app.on('browser-window-created', function () {
    var reopenMenuItem = findReopenMenuItem();
    if (reopenMenuItem) {
        reopenMenuItem.enabled = false;
    }
});
electron_1.app.setName('Free Chess Club');
if (process.platform === 'darwin') {
    electron_1.app.setAboutPanelOptions({
        applicationName: electron_1.app.getName(),
        applicationVersion: electron_1.app.getVersion(),
        copyright: 'Released under the MIT license',
        credits: 'Free Chess Club Author(s)'
    });
}
electron_1.app.on('ready', createWindow);
electron_1.app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
    var reopenMenuItem = findReopenMenuItem();
    if (reopenMenuItem) {
        reopenMenuItem.enabled = true;
    }
});
electron_1.app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});
