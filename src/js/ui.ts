// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import packageInfo from '../../package.json';
import { storage } from './storage';
import { isMac, isCapacitor } from './utils';

$('#version').text(`Version: ${packageInfo.version}`);

type Shortcut = {
  code?: string;
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  commands?: string[];
};

const themes = {};
let shortcuts: Shortcut[] = [];

// text size controls
const textSize = storage.get('text-size');
if (textSize != null) {
  $('.tab-content').css('font-size', `${textSize}em`);
  $('#textsize-range').val(parseInt(textSize, 10));
}

$('#textsize-range').on('change', (event) => {
  $('.tab-content').css('font-size', `${String($(event.target).val())}em`);
  storage.set('text-size', String($(event.target).val()));
});

initStyles();
initShortcuts();

$('#themes-menu li').on('click', (event) => {
  $('#themes-button').text($(event.currentTarget).text());
  $('#board-style').remove();
  storage.remove('board');

  const theme = $(event.currentTarget).attr('id').split('theme-')[1];
  setTheme(theme);
});

$('#boards-menu button').on('click', (event) => {
  const board = $(event.target).attr('id').split('board-')[1];
  injectBoardStyle(board);
  storage.set('board', board);
});

$('#pieces-merida').on('click', () => { setStyle('piece', 'default') });
$('#pieces-cburnett').on('click', () => { setStyle('piece', 'cburnett') });
$('#pieces-alpha').on('click', () => { setStyle('piece', 'alpha') });
$('#pieces-cardinal').on('click', () => { setStyle('piece', 'cardinal') });
$('#pieces-leipzig').on('click', () => { setStyle('piece', 'leipzig') });
$('#pieces-maestro').on('click', () => { setStyle('piece', 'maestro') });
$('#pieces-pirouetti').on('click', () => { setStyle('piece', 'pirouetti') });
$('#pieces-spatial').on('click', () => { setStyle('piece', 'spatial') });

$('#settings-modal').on('show.bs.modal', () => {
  $('.settings-pane').hide();
  $('#settings-title-text').text('Settings');
  $('#basic-settings').show();
});

$('#settings-modal').on('shown.bs.modal', () => {
  $('.settings-pane').height($('#basic-settings').height());
});

$('#settings-modal').on('hide.bs.modal', () => {
  if($('#custom-shortcuts-settings').is(':visible'))
    updateCustomShortcuts();
});

$('#advanced-settings-link').on('click', () => {
  $('.settings-pane').hide();
  $('#settings-title-text').text('Advanced Settings');
  $('#advanced-settings').show();
});

$('#advanced-settings-back').on('click', () => {
  $('.settings-pane').hide();
  $('#settings-title-text').text('Settings');
  $('#basic-settings').show();
});

export function getShortcuts() {
  return shortcuts;
}

function initShortcuts() {
  shortcuts = JSON.parse(storage.get('custom-shortcuts') || '[]');

  $('#custom-shortcuts-button').on('click', () => {
    $('.settings-pane').hide();
    $('#settings-title-text').text('Custom Keyboard Shortcuts');
    $('#shortcuts-list').html('');
    shortcuts.forEach(item => addShortcutMenuItem(item));
    selectShortcutMenuItem($('#shortcuts-list a').first());
    const modKey = isMac() ? 'Meta' : 'Ctrl';
    $('#shortcut-modifier-label').text(`${modKey} + Shift + `);
    $('#custom-shortcuts-settings').show();
    $('#shortcut-settings-right-col').width($('#shortcut-buttons').width());
  });

  $('#custom-shortcuts-back').on('click', () => {
    $('.settings-pane').hide();
    $('#settings-title-text').text('Advanced Settings');
    updateCustomShortcuts();
    $('#advanced-settings').show();
  });

  $('#new-shortcut').on('click', () => {
    $('#shortcut-key').val('');
    $('#shortcut-commands').val('');
    $('#shortcuts-list a').removeClass('active');
    addShortcutMenuItem();
  });

  $('#remove-shortcut').on('click', () => {
    const menuItem = $('#shortcuts-list .active');
    if(!menuItem.length)
      return;

    let prevItem = menuItem.closest('li').prev().find('a') as any;
    menuItem.remove();

    if(!prevItem.length) 
      prevItem = $('#shortcuts-list a').first();
    if(prevItem.length) 
      selectShortcutMenuItem(prevItem);
    else {
      $('#shortcut-key').val('');
      $('#shortcut-commands').val(''); 
    }
  });

  $('#shortcut-key').on('keydown', (e) => {
    if(e.key.length !== 1 && !/F\d+|Backspace|Delete|Tab|Arrow|Enter|Home|End|Page|Insert/.test(e.key))
      return;

    e.preventDefault();

    $('#shortcut-key').removeClass('is-invalid');

    if(e.key === 'Delete' || e.key === 'Backspace') {
      $('#shortcut-key').val('');
      const menuItem = $('#shortcuts-list .active');
      if(menuItem.length) {
        const shortcut = menuItem.data('shortcut');
        shortcut.key = '';
        shortcut.code = '';
        const itemText = menuItem.text();
        if(itemText.includes('+'))
        menuItem.text(itemText.substring(0, itemText.lastIndexOf('+') + 1));
      }
      return;
    }

    const modKey = isMac() ? 'Meta' : 'Ctrl';

    let key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if(key === ' ')
      key = 'Space';
    else if(key === 'Enter' && e.code === 'NumpadEnter')
      key = e.code;

    const name = `${modKey}+Shift+${key}`; 
    
    const newSC: Shortcut = {
      code: e.code,
      key,
      ctrlKey: modKey === 'Ctrl',
      metaKey: modKey === 'Meta',
      shiftKey: true,
      altKey: false,
    }

    const duplicates = $('#shortcuts-list a').filter(function() {
      const sc = $(this).data('shortcut');
      return !$(this).hasClass('active')
          && sc.code === newSC.code 
          && sc.ctrlKey === newSC.ctrlKey
          && sc.metaKey === newSC.metaKey
          && sc.shiftKey === newSC.shiftKey
          && sc.altKey === newSC.altKey
    });
    if(duplicates.length) {
      $('#shortcut-key-feedback').text('Shortcut with that key already exists'); 
      $('#shortcut-key').addClass('is-invalid');
      return;
    }      

    $('#shortcut-key').val(key);

    let menuItem = $('#shortcuts-list .active');
    if(!menuItem.length)
      menuItem = addShortcutMenuItem(newSC);
    else {
      menuItem.text(name);
      let shortcut = menuItem.data('shortcut');
      Object.assign(shortcut, newSC);
    }
  });

  $('#shortcut-commands').on('input', () => {
    let menuItem = $('#shortcuts-list .active');
    if(!menuItem.length)
      menuItem = addShortcutMenuItem();

    const commandsStr = ($('#shortcut-commands').val() as string).trim()
    const commands = commandsStr ? commandsStr.split(/\r?\n/) : undefined;

    const shortcut = menuItem.data('shortcut');
    shortcut.commands = commands;
  });

  $('#shortcuts-list').on('click', 'a', (event) => {
    const menuItem = $(event.target);
    selectShortcutMenuItem(menuItem);
  });
}

function selectShortcutMenuItem(menuItem: JQuery<HTMLElement>) {
  $('#shortcut-key').removeClass('is-invalid');
  $('#shortcuts-list a').removeClass('active');
  if(!menuItem.length) {
    $('#shortcut-key').val('');
    $('#shortcut-commands').val(''); 
  }

  menuItem.addClass('active');
  const shortcut = menuItem.data('shortcut');
  if(shortcut) {
    $('#shortcut-key').val(shortcut.key);
    $('#shortcut-commands').val(shortcut.commands?.join('\n')); 
  }
}

function addShortcutMenuItem(shortcut?: Shortcut): JQuery<HTMLElement> {
  let name = '';
  if(shortcut) {
    const keys: string[] = [];
    if(shortcut.ctrlKey) keys.push('Ctrl'); 
    if(shortcut.metaKey) keys.push('Meta');
    if(shortcut.shiftKey) keys.push('Shift');
    if(shortcut.altKey) keys.push('Alt');
    keys.push(shortcut.key);
    name = keys.join('+');
  }
  else {
    name = 'New Shortcut';
    shortcut = {};
  }

  const elem = $(`<li><a class="dropdown-item noselect active">${name}</a></li>`);
  $('#shortcuts-list').append(elem);
  const menuItem = elem.find('a');
  menuItem.data('shortcut', shortcut);
  return menuItem;
}

function updateCustomShortcuts() {
  shortcuts = [];
  $('#shortcuts-list a').each(function() {
    const shortcut: Shortcut = $(this).data('shortcut');
    if(shortcut.code && shortcut.commands)
      shortcuts.push(shortcut); 
  });
  storage.set('custom-shortcuts', JSON.stringify(shortcuts));
}

async function initStyles() {
  // theme styles
  let theme = storage.get('theme');
  if(!theme)
    theme = 'default';

  let themeName: string;
  if(theme)
    themeName = $('#themes-menu li').filter((index, element) => $(element).attr('id').endsWith(`-${theme}`)).text();
  else
    themeName = $('#themes-menu li').first().text();
  $('#themes-button').text(themeName);

  await setTheme(theme);

  // board styles
  const board = storage.get('board');
  if (board != null) {
    injectBoardStyle(board);
  }

  // piece styles
  const piece = storage.get('piece');
  if (piece != null) {
    $('#piece').attr('href', `assets/css/pieces/${piece}.css`);
  }
}

function setStyle(component: string, name: string, directory?: string) {
  $(`#${component}`).attr('href', `assets/css/${component}s/${name}.css`);
  storage.set(component, name);
}

async function setBaseTheme(baseTheme: string) {
  storage.set('base-theme', baseTheme);

  if(isCapacitor()) 
    Capacitor.Plugins.StatusBar.setStyle({ style: baseTheme === 'base-theme-dark' ? "DARK" : "LIGHT" });

  $('#base-theme').remove();
  if(themes[baseTheme]) {
    $(themes[baseTheme]).appendTo('head');
    return;
  }

  const styleInjectionPromise = waitForStyleInjection();
 
  const mod = (baseTheme === 'base-theme-dark'
    ? await import(/* webpackChunkName: "themes/base-theme-dark" */ 'assets/css/themes/base-theme-dark.css')
    : await import(/* webpackChunkName: "themes/base-theme-light" */ 'assets/css/themes/base-theme-light.css'));

  const elem = await styleInjectionPromise;
  themes[baseTheme] = elem;
  elem.setAttribute('id', 'base-theme');
}

async function setTheme(theme: string) {
  const baseTheme = (theme === 'gray' ? 'base-theme-dark' : 'base-theme-light');
  await setBaseTheme(baseTheme);

  storage.set('theme', theme);

  $('#theme').remove();
  if(themes[theme]) {
    $(themes[theme]).appendTo('head');
    return;
  }

  const styleInjectionPromise = waitForStyleInjection();

  let mod = null;
  switch(theme) {
    case 'brown':
      mod = await import(/* webpackChunkName: "themes/brown" */ 'assets/css/themes/brown.css');
      break;
    case 'gray':
      mod = await import(/* webpackChunkName: "themes/gray" */ 'assets/css/themes/gray.css');
      break;
    case 'green':
      mod = await import(/* webpackChunkName: "themes/green" */ 'assets/css/themes/green.css');
      break;
    case 'ic':
      mod = await import(/* webpackChunkName: "themes/ic" */ 'assets/css/themes/ic.css');
      break;
    case 'newspaper':
      mod = await import(/* webpackChunkName: "themes/newspaper" */ 'assets/css/themes/newspaper.css');
      break;
    case 'purple':
      mod = await import(/* webpackChunkName: "themes/purple" */ 'assets/css/themes/purple.css');
      break;
    case 'red':
      mod = await import(/* webpackChunkName: "themes/red" */ 'assets/css/themes/red.css');
      break;
    case 'yellow':
      mod = await import(/* webpackChunkName: "themes/yellow" */ 'assets/css/themes/yellow.css');
      break;
    default:
      mod = await import(/* webpackChunkName: "themes/default" */ 'assets/css/themes/default.css');
  }

  const elem = await styleInjectionPromise;
  themes[theme] = elem;
  elem.setAttribute('id', 'theme');
}

function waitForStyleInjection(): Promise<HTMLElement> {
  return new Promise((resolve) => {
    const observer = new MutationObserver((mutationsList) => {
      for(const mutation of mutationsList) {
        for(const node of mutation.addedNodes) {
          if(node instanceof HTMLLinkElement || node instanceof HTMLStyleElement) {
            observer.disconnect();
            resolve(node);
            return node;
          }
        }
      }
    });
    observer.observe(document.head, { childList: true });
  });
}

// board controls
function injectBoardStyle(board: string) {
  $('#board-style').remove();
  $('<style>', {
    id: 'board-style',
    type: 'text/css',
    text: `
      cg-board {
        background-image: url('assets/css/images/board/${board}.svg')
      }
    `
  }).appendTo('head');
}