// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import packageInfo from '../../package.json';
import { storage } from './storage';
import { isMac, isCapacitor, rgbToHex, isTouchscreen, getBrightness, removeWithPoppers, loadSvg, svgToImg, svgToUrl, normalizeColor, parseRgb, rgbToHsl, hslToRgb, createColorPicker } from './utils';
import { showDialog } from './dialogs';

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

/**
 * Defines a rule for replacing colors from a board or piece set SVG 
 */
type ReplaceColorsRule = {
  name: string,       // The name of the feature, e.g. 'light squares' for board, 'primary' or 'accent' for pieces
  color: string,      // The new color to replace with 
  type?: string,      // The type of SVG to apply the rule to, e.g. 'white' for white pieces or 'all' for all pieces
  indices?: number[]  // Indices into the array of existing colors extracted from the SVG to replace, see replaceSvgColors for more information
}

/**
 * Defines a board and its appearance
 */
type Board = {
  name: string;                        // A unique name for the board
  replaceColors: ReplaceColorsRule[],  // A set of rules for defining custom colors for board
  assetName?: string,                  // The name of SVG asset
  user?: boolean                       // true if this is a user created board, otherwise false
}

/**
 * The list of boards used by Themes and/or shown in the Appearance Settings.
 * When a feature is specified it becomes editable in the 'Pick board colors' dialog
 */
let boards: Board[] = [
  { name: 'blue', replaceColors: [
    { name: 'light squares', color: '#dee3e6' }, 
    { name: 'dark squares', color: '#8ca2ad' }] },
  { name: 'green', replaceColors: [
    { name: 'light squares', color: '#eaffea' }, 
    { name: 'dark squares', color: '#7aab80' }] },   
  { name: 'yellow', replaceColors: [
    { name: 'light squares', color: '#f4ede1' }, 
    { name: 'dark squares', color: '#c6ab8e' }] },   
  { name: 'gray', replaceColors: [
    { name: 'light squares', color: '#d3d3d3' }, 
    { name: 'dark squares', color: '#555555' }] },  
  { name: 'purple', replaceColors: [
    { name: 'light squares', color: '#decfef' }, 
    { name: 'dark squares', color: '#b160ca' }] },   
  { name: 'ic', replaceColors: [
    { name: 'light squares', color: '#ececec' }, 
    { name: 'dark squares', color: '#c1c18e' }] },     
  { name: 'newspaper', assetName: 'newspaper', replaceColors: [
    { name: 'light squares', color: '#dcdcdc' }, 
    { name: 'dark squares', color: '#c9c9c9' },
    { name: 'lines', color: null }], },    
  { name: 'brown', replaceColors: [
    { name: 'light squares', color: '#f0d9b5' }, 
    { name: 'dark squares', color: '#b58863' }] },  
  { name: 'red', replaceColors: [
    { name: 'light squares', color: '#ffc8c8' }, 
    { name: 'dark squares', color: '#d94e4e' }] },  
  { name: 'oak', replaceColors: [
    { name: 'light squares', color: '#b49c8a' }, 
    { name: 'dark squares', color: '#63534b' }] },  
  { name: 'clay', replaceColors: [
    { name: 'light squares', color: '#cc9f87' }, 
    { name: 'dark squares', color: '#93584b' }] },  
  { name: 'slate', replaceColors: [
    { name: 'light squares', color: '#8C8681' }, 
    { name: 'dark squares', color: '#57534E' }] },  
];

/**
 * Specify how color features for a given board SVG asset should be extracted and replaced
 */
const boardsColorDefs = {};

/**
 * Defines a piece set and its appearance
 */
type PieceSet = {
  name: string;                           // A unique name for the piece set
  replaceColors?: ReplaceColorsRule[],    // A set of rules for defining custom colors for pieces
  assetName?: string,                     // The name of SVG asset
  user?: boolean                          // true if this is a user created piece set, otherwise false
}

/**
 * The list of piece sets shown in the Appearance Settings.
 */
let pieceSets: PieceSet[] = [
  { name: 'merida' },
  { name: 'cburnett' },
  { name: 'alpha' },
  { name: 'cardinal' },
  { name: 'leipzig' },
  { name: 'maestro' },
  { name: 'pirouetti' },
  { name: 'spatial' },
  { name: 'chessnut' },
  { name: 'fantasy' },
  { name: 'pixel' },
];

/**
 * Specify how color features for a given piece set SVG asset should be extracted 
 * and replaced. If no def is specified then replaceSvgColors tries to automatically determine features.
 * See replaceSvgColors for more information
 */
const piecesColorDefs = {
  cardinal: [
    { name: 'primary', type: 'white', indices: [0] },
    { name: 'accent', type: 'white', indices: [1, 2] }, 
  ],
  fantasy: [
    { name: 'primary', type: 'black', indices: [1] },
    { name: 'accent', type: 'black', indices: [0] } 
  ],
  maestro: [
    { name: 'primary', type: 'white', indices: [1, 0] },
    { name: 'accent', type: 'white', indices: [2] },
    { name: 'primary', type: 'black', indices: [1, 2, 3] },
    { name: 'accent', type: 'black', indices: [0] }  
  ],
  pirouetti: [
    { name: 'primary', type: 'black', indices: [1, 2] },
    { name: 'accent', type: 'black', indices: [0] }    
  ],
  pixel: [
    { name: 'primary', type: 'white', indices: [2, 0, 1, 3] },
    { name: 'accent', type: 'white', indices: [4] },
    { name: 'primary', type: 'black', indices: [2, 1, 3, 4] },
    { name: 'accent', type: 'black', indices: [0] }
  ],
  spatial: [
    { name: 'primary', type: 'black', indices: [1] },
    { name: 'accent', type: 'black', indices: [0] } 
  ],
};

const themes = {};
let shortcuts: Shortcut[] = [];
let currentBoard = null;

export function initUi() {
  const textSize = storage.get('text-size');
  if(textSize != null) {
    $('#chat-tabContent').css('font-size', `${textSize}em`);
    $('#textsize-range').val(+textSize);
  }

  $('#textsize-range').on('change', (event) => {
    $('#chat-tabContent').css('font-size', `${String($(event.target).val())}em`);
    storage.set('text-size', String($(event.target).val()));
  });

  loadUserBoards();
  loadUserPieces();
  initStyles();
  initBoardsMenu();
  initPiecesMenu();
  initShortcuts();

  $('#themes-menu li').on('click', async (event) => {
    $('#themes-button').text($(event.currentTarget).text());
    $('#board-style').remove();
    storage.remove('board');

    const theme = $(event.currentTarget).attr('id').split('theme-')[1];
    await setTheme(theme);
    setThemeDefaultBoard();
  });

  /** When a board is clicked in the Appearance Settings */
  $('#boards-menu').on('click', '.boards-menu-btn', (event) => {
    selectBoard($(event.currentTarget).data('name'));
  });

  /** Delete button for a user defined board */
  $('#boards-menu').on('click', '.overlaid-close-btn', (event) => {
    const menuBtn = $(event.currentTarget).prev();
    const name = menuBtn.data('name');
    if(currentBoard === name) 
      setThemeDefaultBoard();
    boards = boards.filter(b => b.name !== name);
    storage.set('user-boards', JSON.stringify(boards.filter(b => b.user)));
    removeWithPoppers(menuBtn.parent());
    $('#color-picker-btn').hide();
  });
  
  /** When a piece set is clicked in the Appearance Settings */
  $('#pieces-menu').on('click', '.pieces-menu-btn', (event) => {
    selectPieces($(event.currentTarget).data('name'));
  });

  /** Delete button for a user defined piece set */
  $('#pieces-menu').on('click', '.overlaid-close-btn', (event) => {
    const menuBtn = $(event.currentTarget).prev();
    const name = menuBtn.data('name');
    if(storage.get('piece') === name) 
      selectPieces(); 
    pieceSets = pieceSets.filter(p => p.name !== name);
    storage.set('custom-pieces', JSON.stringify(pieceSets.filter(p => p.user)));
    removeWithPoppers(menuBtn.parent());
    $('#color-picker-btn').hide();
  });

  $('#settings-modal').on('show.bs.modal', () => {
    $('.settings-pane').hide();
    $('#settings-title-text').text('Settings');
    $('#basic-settings').show();
    $('#settings-general-tab').tab('show');
  });

  $('#settings-modal').on('shown.bs.modal', () => {
    const basicSettingsHeight = $('#basic-settings').outerHeight() || 0;
    $('.settings-pane').css({
      height: 'auto',
      'min-height': `${basicSettingsHeight}px`,
    });
  });

  $('#settings-modal').on('hide.bs.modal', () => {
    updateCustomShortcuts();
    removeWithPoppers($('.above-modal-dialog'));
    $('#color-picker-btn').hide();
  });
}

export function getShortcuts() {
  return shortcuts;
}

function initShortcuts() {
  shortcuts = JSON.parse(storage.get('custom-shortcuts') || '[]');

  const populateShortcutsEditor = () => {
    $('#shortcuts-list').html('');
    shortcuts.forEach(item => addShortcutMenuItem(item));
    selectShortcutMenuItem($('#shortcuts-list a').first());
    const modKey = isMac() ? 'Meta' : 'Ctrl';
    $('#shortcut-modifier-label').text(`${modKey} + Shift + `);
  };

  $('#settings-modal').on('show.bs.modal', () => {
    shortcuts = JSON.parse(storage.get('custom-shortcuts') || '[]');
    populateShortcutsEditor();
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
  if(board != null) {
    if(boards.find(b => b.name === board)) 
      selectBoard(board);
    else 
      setThemeDefaultBoard();
  }
  else
    setThemeDefaultBoard();

  // piece styles
  const pieces = storage.get('piece');
  selectPieces(pieces);
}

async function setBaseTheme(baseTheme: string) {
  storage.set('base-theme', baseTheme);

  document.documentElement.setAttribute(
    'data-bs-theme',
    baseTheme === 'base-theme-dark' ? 'dark' : 'light'
  );

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
  if(themes[theme]) 
    $(themes[theme]).appendTo('head');
  else {
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

  // Set StatusBar background color for phones that don't have EdgeToEdge
  if(isCapacitor())
    Capacitor.Plugins.StatusBar.setBackgroundColor({ color: rgbToHex($('body').css('background-color')) });
}

/**
 * Sets the current board to the one specified by --board CSS variable in the current theme
 */
function setThemeDefaultBoard() {
  const name = getComputedStyle(document.documentElement).getPropertyValue('--board').trim();
  currentBoard = name;
  const board = boards.find(b => b.name === name) || boards[0];
  injectBoardStyle(board);
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

/**
 * Get user created boards (custom colors) from local storage
 */
function loadUserBoards() {
  const userBoardsStr = storage.get('user-boards');
  if(userBoardsStr) {
    const userBoards = JSON.parse(userBoardsStr);
    userBoards.forEach((b => boards.push(b)));
  }
}

/**
 * Add all boards to Appearance Settings
 */
function initBoardsMenu() {
  boards.forEach(board => {
    addBoardMenuOption(board);
  });
}

/**
 * Add a board to Apperance Settings
 */
function addBoardMenuOption(board: Board) {
  const lightSquaresColor = board.replaceColors?.find(rule => rule.name === 'light squares')?.color || 'white';
  const darkSquaresColor = board.replaceColors?.find(rule => rule.name === 'dark squares')?.color || 'black';

  $('#boards-menu').append(`
    <div class="boards-menu-btn-wrapper">
      <button type="button" class="boards-menu-btn btn btn-outline-dark py-3" style="--light-squares:${lightSquaresColor}; --dark-squares:${darkSquaresColor};" data-name="${board.name}"></button>
      ${board.user ? `<div type="button" class="overlaid-close-btn btn btn-sm btn-outline-secondary btn-transparent">
        <svg height="16px" width="16px"><use href="#icon-close-circle" /></svg>  
      </div>` : ''}
    </div>`);
}

/**
 * Select the specified board as the current board
 */
export function selectBoard(name?: string) {
  const board = boards.find(b => b.name === name);
  if(!board) {
    setThemeDefaultBoard();
    return;
  }

  currentBoard = name;
  injectBoardStyle(board);
  storage.set('board', name);
}

/**
 * Add the board to chessground as a background-image style
 */
async function injectBoardStyle(board: Board) {
  const assetName = board.assetName || 'default';

  const svg = await loadSvg(`assets/css/images/board/${assetName}.svg`);
  
  replaceBoardColors(svg, board.replaceColors, assetName);
  const output = new XMLSerializer().serializeToString(svg);
  const encoded = encodeURIComponent(output);

  $('#board-style').remove();

  $('<style>', {
    id: 'board-style',
    text: `
      cg-board {
        background-image: url("data:image/svg+xml,${encoded}");
      }
    `
  }).appendTo('head');
}

/**
 * Get user created piece sets (custom colors) from local storage
 */
function loadUserPieces() {
  const userPiecesStr = storage.get('user-pieces');
  if(userPiecesStr) {
    const userPieces = JSON.parse(userPiecesStr);
    userPieces.forEach((p => pieceSets.push(p)));
  }
}

/**
 * Add all piece sets to Appearance Settings
 */
function initPiecesMenu() { 
  pieceSets.forEach(pieces => {
    addPiecesMenuOption(pieces);
  });
}

/**
 * Add a piece set to Apperance Settings
 */
function addPiecesMenuOption(pieces: PieceSet) {
  const menuBtnWrapper = $(`<div class="pieces-menu-btn-wrapper">
      <button type="button" class="pieces-menu-btn btn btn-outline-secondary" data-name="${pieces.name}" data-bs-toggle="tooltip" title="${pieces.name.charAt(0).toUpperCase() + pieces.name.slice(1)}"></button>
      ${pieces.user ? `<div type="button" class="overlaid-close-btn btn btn-sm btn-outline-secondary btn-transparent">
        <svg height="16px" width="16px"><use href="#icon-close-circle" /></svg>  
      </div>` : ''}
    </div>`);
  $('#pieces-menu').append(menuBtnWrapper);
  
  // Add a white king to the menu button
  const menuBtn = menuBtnWrapper.find('.pieces-menu-btn');
  const assetName = pieces.assetName || pieces.name;
  loadSvg(`assets/css/images/pieces/${assetName}/wK.svg`).then(svg => {
    replacePieceColors(svg, pieces.replaceColors, assetName, 'white' );
    menuBtn.append(svgToImg(svg));
  });
}

/**
 * Select the specified piece set as the current piece set
 */
export function selectPieces(name?: string) {
  const pieces = pieceSets.find(p => p.name === name) || pieceSets[0];
  injectPieceStyles(pieces);
  storage.set('piece', pieces.name);
}

/**
 * Add the piece set to chessground as background-image styles
 */
async function injectPieceStyles(pieces: PieceSet) {
  const assetName = pieces.assetName || pieces.name;

  const pieceTypes = {
    Q: 'queen', 
    R: 'rook', 
    B: 'bishop', 
    N: 'knight', 
    P: 'pawn', 
    K: 'king'
  };

  const getPieceStyle = async (color: string, type: string) => {
    const svg = await loadSvg(`assets/css/images/pieces/${assetName}/${color[0]}${type}.svg`);
    
    replacePieceColors(svg, pieces.replaceColors, assetName, color);

    const output = new XMLSerializer().serializeToString(svg);
    const encoded = encodeURIComponent(output);

    return `.cg-wrap piece.${pieceTypes[type]}.${color} {
      background-image: url("data:image/svg+xml,${encoded}");
    }`;
  };

  const jobs = [];
  for(const piece of Object.keys(pieceTypes)) {
    jobs.push(getPieceStyle('white', piece));
    jobs.push(getPieceStyle('black', piece));
  }
  const results = await Promise.all(jobs); // Wait for all SVG files to be loaded
  const styles = results.join('\n');

  $('#piece').remove();

  $('<style>', {
    id: 'piece',
    text: styles
  }).appendTo('head');
}

/** BOARD AND PIECE COLORING FUNCTIONS **/

let colorPickerTargetHovered = false; // Menu button is hovered, so display color picker icon
let colorPickerIconHovered = false;   // Color picker icon is hovered 
let colorPickerTarget = null;         // The menu button currently displaying the color picker icon

/**
 * Replaces colors in an SVG element based on a set of rules. All unique fill, stroke and 
 * lineargradient stop-color (offset=0) values are extracted from the SVG and sorted from perceived 
 * brightest to darkest (or from darkest to brightest when 'dark' is specified in svgColor). By default
 * each color is aasigned to a replace rule from the top down, e.g. the brightest color is assigned to the 
 * first replace rule, second color to second rule etc. Colors are then replaced using the colors specified
 * in the replace rules. If a replace rule's replace color is null, then no replacement is done,
 * however the matching extracted color is skipped over. For linear gradients, offsets after 0 are replaced
 * in a way that maintains their original relative lightness to offset 0. A rule can also specify an array 
 * of indices into the extracted colors. In this case those colors will be replaced by the rule's replace 
 * color. The first index in the array is the base color and the others are replaced based on their relative
 * lightness. If svgColor parameter is 'dark' then indices instead go from darkest to brightest. For example 
 * if the first rule is { name: 'primary', color: '#AAAAAA', indices: [0, 1] } and the first 2 extracted 
 * colors are #DDDDDD and #BBBBBB, then the brightest color (#DDDDDD) in the SVG will be replaced by
 * #AAAAAA and the 2nd brightest color (#BBBBBB) will be replaced by #AAAAAA adjusted for the lightness 
 * difference between #DDDDDD and #BBBBBB. 
 * @param svg SVG element 
 * @param rules ReplaceColorRules for each color feature, ordered from brightest to darkest or 
 * darkest to brightest (generally you want most important to least important)
 * @param svgColor 'light' (default) colors should be replaced from brightest to darkest or 'dark'
 * from darkest to brightest
 * @returns A cloned copy of the rules parameter with null colors replaced with the original extracted
 * values. This can be used to get the original SVG colors for each rule.
 */
export function replaceSvgColors(svg: SVGSVGElement, rules: ReplaceColorsRule[], svgColor: 'light' | 'dark' = 'light') {
  /** 
   * Getter/setter functions for color attributes. If normalize = true then color strings are first
   * normalized to 'rgb(<R>, <G>, <B>)' format.
   */
  const getFillStyle = (el: SVGElement, normalize = true) => {
    const color = el.style?.fill;
    return normalize ? normalizeColor(color) : color;
  };
  const getFillAttribute = (el: SVGElement, normalize = true) => {
    const color = el.getAttribute('fill');
    if(color)
      return normalize ? normalizeColor(color) : color;

    // No explicit color attribute, but we must determine if this element has an implicit (#000) fill color
    // (only if it has no inherited fill color).

    const paintable = ['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'text', 'textPath', 'tspan']
      .includes(el.tagName.toLowerCase());

    if(!paintable)
      return null;

    while(el) {
      if(el.nodeType === 1) {
        if(el.style?.fill || el.hasAttribute('fill'))
          return null;
      }

      if(!(el.parentNode instanceof SVGElement))
        break;
      el = el.parentNode;
    }
    return 'rgb(0, 0, 0)';
  };
  const getFill = (el: SVGElement, normalize = true) => {
    let color = null;
    if((color = getFillStyle(el, false))
        || (color = getFillAttribute(el, false)))
      return normalize ? normalizeColor(color) : color;
  };
  const setFillStyle = (el: SVGElement, color: string, normalize = true) => {
    el.style.fill = normalize ? normalizeColor(color) : color;
  }
  const setFillAttribute = (el: SVGElement, color: string, normalize = true) => {
    el.setAttribute('fill', normalize ? normalizeColor(color) : color);
  }

  const getStopColorStyle = (el: SVGElement, normalize = true) => {
    const match = el.getAttribute('style')?.match(/stop-color\s*:\s*([^;]+)/i);
    const color = match ? match[1].trim() : null;
    return normalize ? normalizeColor(color) : color;
  }
  const getStopColorAttribute = (el: SVGElement, normalize = true) => {
    const color = el.getAttribute('stop-color');
    if(color)
      return normalize ? normalizeColor(color) : color;      

    // No explicit color attribute, but could be an implicit (#000) stop-color.
    if(el.tagName.toLowerCase() === 'stop')
      return 'rgb(0, 0, 0)';

    return null;
  }
  const getStopColor = (el: SVGElement, normalize = true) => {
    let color = null;
    if((color = getStopColorStyle(el, false))
        || (color = getStopColorAttribute(el, false)))
      return normalize ? normalizeColor(color) : color;
  };
  const setStopColorStyle = (el: SVGElement, color: string, normalize = true) => {
    (el as SVGStopElement).style.stopColor = normalize ? normalizeColor(color) : color;
  }
  const setStopColorAttribute = (el: SVGElement, color: string, normalize = true) => {
    el.setAttribute('stop-color', normalize ? normalizeColor(color) : color);
  }

  const getStrokeStyle = (el: SVGElement, normalize = true) => {
    const color = el.style?.stroke;
    return normalize ? normalizeColor(color) : color;
  };
  const getStrokeAttribute = (el: SVGElement, normalize = true) => {
    const color = el.getAttribute('stroke');
    return normalize ? normalizeColor(color) : color;
  }
  const getStroke = (el: SVGElement, normalize = true) => {
    let color = null;
    if((color = getStrokeStyle(el, false))
        || (color = getStrokeAttribute(el, false)))
      return normalize ? normalizeColor(color) : color;
  };
  const setStrokeStyle = (el: SVGElement, color: string, normalize = true) => {
    el.style.stroke = normalize ? normalizeColor(color) : color;
  }
  const setStrokeAttribute = (el: SVGElement, color: string, normalize = true) => {
    el.setAttribute('stroke', normalize ? normalizeColor(color) : color);
  }

  const outRules = rules?.map(rule => ({ ...rule })) ?? [];

  // ---- collect all fill + stop-color (offset="0") + stroke colors
  const colorSet = new Set<string>();
  const elements = svg.querySelectorAll<SVGElement>('*');
  elements.forEach(el => {
    const fill = getFill(el);
    if(fill)
      colorSet.add(fill); 

    if(el.parentElement?.querySelector('stop') === el) {
      const stop = getStopColor(el);
      if(stop)
        colorSet.add(stop);
    }

    const stroke = getStroke(el);
    if(stroke)
      colorSet.add(stroke);
  });

  // Extract colors from style sheet
  const styleEls = svg.querySelectorAll('style');
  styleEls.forEach(styleEl => {
    const cssText = styleEl.textContent ?? "";
    const matches = cssText.match(/(fill|stroke)\s*:\s*([^;}\s]+)/g);
    matches?.forEach(m => {
      const value = normalizeColor(m.split(":")[1]?.trim());
      if(value) 
        colorSet.add(value);
    });
  });

  // ---- sort by brightness ----

  const colors = Array.from(colorSet);
  colors.sort((a, b) => {
    const diff = getBrightness(a) - getBrightness(b);
    return svgColor === 'light' ? -diff : diff;
  });

  const excluded = new Set<string>();
  let colorIndex = 0;

  const nextColor = () => {
    while (colorIndex < colors.length) {
      const color = colors[colorIndex++];
      if (excluded.has(color)) continue;
      return color;
    }
    return undefined;
  };

  const removeColor = (color: string) => {
    excluded.add(color);
  };

  // ---- rule processing ----
  for(const rule of rules ?? []) {
    const name = rule.name;
    const newColor = rule.color;

    let oldColors = [];
    if(rule.indices?.length) { // Explicitly assigned rule -> colors
      rule.indices.forEach(i => {
        if(colors[i]) {
          oldColors.push(colors[i]);
          removeColor(colors[i]);
        }
      });
    }
    else { // Automatically assignmed rule -> color
      const c = nextColor();
      oldColors = c == null ? null : [c];
    }

    if(!oldColors || !newColor) { // if !oldColors then there are no more unique colors in the SVG to replace
      // 'color:' in rule was null, put original SVG color in outRules or leave it as null if there are
      // no more unqiue colors in the SVG
      if(oldColors) 
        outRules.find(r => r.name === name)!.color = oldColors[0];
      continue;
    }

    /**
     * Get the replace color for an extracted SVG color. 
     * The replace color may be remapped to maintain relative lightness (when indices are specified)
     */
    const getReplaceColor = (findColor: string | null) => {
      if(!findColor || !oldColors.includes(findColor))
        return null;

      if(findColor === oldColors[0]) 
        return newColor;
      else 
        return remapLightness(normalizeColor(newColor), findColor, oldColors[0]);
    }

    // Replace colors
    elements.forEach(el => {
      // Replace fills
      let color = null, replaceColor = null;
      if((color = getFillStyle(el))) {
        if((replaceColor = getReplaceColor(color)))
          setFillStyle(el, replaceColor);
      }
      else if((replaceColor = getReplaceColor(getFillAttribute(el)))) 
        setFillAttribute(el, replaceColor);

      // Replace lineargradient stop-colors
      if(el.parentElement?.querySelector('stop') === el) {
        let stopColorFound = false;
        let stop0 = null;
        if((stop0 = getStopColorStyle(el))) {
          if((replaceColor = getReplaceColor(stop0))) {
            stopColorFound = true;
            setStopColorStyle(el, replaceColor);
          }
        }
        else {
          stop0 = getStopColorAttribute(el);
          if((replaceColor = getReplaceColor(stop0))) {
            stopColorFound = true;
            setStopColorAttribute(el, replaceColor);
          }
        }
        if(stopColorFound) {
          const parent = el.parentElement;
          const stops = [...parent.querySelectorAll('stop')].slice(1);
          stops.forEach(s => {
            let isStyle = true;
            let stopColor = getStopColorStyle(s); 
            if(!stopColor) {
              isStyle = false;
              stopColor = getStopColor(s);
            }
            if(stopColor) {
              const newStopColor = remapLightness(normalizeColor(replaceColor), stopColor, stop0);
              if(isStyle)
                setStopColorStyle(s, newStopColor);
              else
                setStopColorAttribute(s, newStopColor);
            }
          });
        }
      }

      // Replace strokes
      if((color = getStrokeStyle(el))) {
        if((replaceColor = getReplaceColor(color)))
          setStrokeStyle(el, replaceColor);
      }
      else if((replaceColor = getReplaceColor(getStrokeAttribute(el)))) 
        setStrokeAttribute(el, replaceColor);
    });

    // Replace colors in style sheet
    styleEls.forEach(styleEl => {
      let cssText = styleEl.textContent ?? "";
      cssText = cssText.replace(/(fill|stroke)\s*:\s*([^;}\s]+)/g, (match, prop, value) => {
        const color = getReplaceColor(normalizeColor(value));
        if(color) 
          return `${prop}:${color}`;
        return match;
      });
      styleEl.textContent = cssText;
    });
  }

  return outRules;
}

/**
 * Remaps the lightness, HS(L) component) of a color based on the relative lightness of a
 * reference color compared to a base reference. For example if reference is lighter than refBase
 * than color is lightened by the same amount. All colors should be specified as 'rgb(<R>, <G>, <B>)' 
 * strings.
 * @param color The color to remap
 * @param reference The reference color 
 * @param refBase The base reference color
 * @returns The remapped color
 */
function remapLightness(color: string, reference: string, refBase: string) {
  const colorRgb = parseRgb(color);
  const referenceRgb = parseRgb(reference);
  const refBaseRgb = parseRgb(refBase);

  const colorHsl = rgbToHsl(...colorRgb);
  const referenceHsl = rgbToHsl(...referenceRgb);
  const refBaseHsl = rgbToHsl(...refBaseRgb);

  const deltaL = referenceHsl.l - refBaseHsl.l;
  const newL = Math.min(1, Math.max(0, colorHsl.l + deltaL));
  const [r, g, b] = hslToRgb(colorHsl.h, colorHsl.s, newL);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Replaces the colors of a board SVG element using the colors specified by
 * replaceColors. The rules are adjusted for the given SVG asset using color definitions for 
 * that asset in boardColorDefs
 * @param svg the SVG element
 * @param replaceColors replace color rules
 * @param assetName The name of the SVG asset
 * @returns A cloned copy of the color rules with 'color: null' values replaced with the original
 * colors from the SVG 
 */
function replaceBoardColors(svg: SVGSVGElement, replaceColors: ReplaceColorsRule[], assetName: string) {
  replaceColors?.forEach(rule => {
    const boardDefs = boardsColorDefs[assetName];
    const def = boardDefs?.find(d => d.name === rule.name);
    if(def)
      rule.indices = def.indices;    
  });  
  return replaceSvgColors(svg, replaceColors);
}

/**
 * Replaces the colors of a piece SVG element using the colors specified by
 * replaceColors. The rules are adjusted for the given SVG asset using color definitions for 
 * that asset in pieceColorDefs
 * @param svg the SVG element
 * @param replaceColors replace color rules
 * @param assetName The name of the SVG asset
 * @param color The piece color 'white' or 'black'
 * @returns A cloned copy of the color rules with 'color: null' values replaced with the original
 * colors from the SVG 
 */
function replacePieceColors(svg: SVGSVGElement, replaceColors: ReplaceColorsRule[], assetName: string, color: string) {
  const rules = replaceColors?.filter(r => r.type === color);
  rules?.forEach(rule => {
    // Adjust each rule with information on which colors to replace for this SVG asset
    const pieceDefs = piecesColorDefs[assetName];
    const def = pieceDefs?.find(d => d.name === rule.name && (d.type === color || d.type === 'all'));
    if(def)
      rule.indices = def.indices; 
  });
  return replaceSvgColors(svg, rules, color === 'white' ? 'light' : 'dark');
}

/** Show color picker icon when a board or pieces button is hovered in Appearance Settings */
$('#boards-menu, #pieces-menu')
  .on('mouseenter', '.boards-menu-btn, .pieces-menu-btn', (e) => {
    if(!$('#settings-modal').hasClass('show') || $('.above-modal-dialog').hasClass('show'))
      return;

    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();

    // Color picker button is initially semi-transparent and inactive, so that the user doesn't accidently
    // click it when they were trying to click the menu button 
    $('#color-picker-btn').css({
      position: 'fixed',
      left: rect.right,
      top: rect.top,
      display: 'block',
    });
    
    $('#color-picker-btn').addClass('inactive-hover');
    $('#color-picker-btn').css('opacity', 0.2);

    $('#color-picker-btn')[0].offsetWidth;
    $('#color-picker-btn').css('opacity', '');

    // If the user is hovering the the color picker button, then slowly fade it in before enabling it
    $('#color-picker-btn').on('transitionend', (e) => {
      const oe = e.originalEvent as TransitionEvent;
      if(e.target !== e.currentTarget || oe.propertyName !== 'opacity') 
        return;
      $('#color-picker-btn').removeClass('inactive-hover');
      $('#color-picker-btn').off('transitionend');
    });

    setTimeout(() => {
      // If the user is not initially hovering the color picker button then it's safe to enable
      // it straight away without the fade in. 
      if(!colorPickerIconHovered || isTouchscreen()) 
        $('#color-picker-btn').removeClass('inactive-hover');
    }, 50);

    colorPickerTarget = btn;
    colorPickerTargetHovered = true;
  })
  .on('mouseleave', '.boards-menu-btn, .pieces-menu-btn', (e) => {
    colorPickerTargetHovered = false;
    colorPickerHide();
  });

/** Keep the color picker button visible when it's hovered */
$('#color-picker-btn')
  .on('mouseenter', function (e) {
    colorPickerIconHovered = true;
  })
  .on('mouseleave', function (e) {
    colorPickerIconHovered = false;
    colorPickerHide();
  })
  .on('click', function (e) { // Color picker button clicked
    const menuBtn = $(colorPickerTarget);

    if($(e.currentTarget).hasClass('inactive-hover')) {
      menuBtn.trigger('click'); // Color picker button was semi-transparent/inactive, so click the menu button underneath instead
      return;
    }

    $('#color-picker-btn').hide();
    const name = menuBtn.data('name');

    if($(colorPickerTarget).closest('#boards-menu').length)
      pickBoardColors(name); // Show 'Pick Board Colors' dialog
    else if($(colorPickerTarget).closest('#pieces-menu').length)
      pickPieceColors(name); // Show 'Pick Piece Colors' dialog
  });

/**
 * If neither the menu button nor the color picker button are being hovered then hide the color picker button
 */
function colorPickerHide() {
  setTimeout(() => {
    if(!colorPickerTargetHovered && !colorPickerIconHovered) {
      $('#color-picker-btn').hide();
    }
  }, 0);
}

/**
 * Display a 'Pick Board Colors' dialog for creating a board with custom colors
 * @param origName the name of the board to use as a template
 */
async function pickBoardColors(origName: string) {
  const origBoard = boards.find(b => b.name === origName);
  const assetName = origBoard.assetName || 'default'; // The SVG asset name

  const origColors = origBoard.replaceColors || [
    { name: 'light squares', color: null }, // The default replaceable rules/features
    { name: 'dark squares', color: null },
  ];
  const replaceColors = origColors.map(entry => ({ ...entry }));
  
  /** Add the new board to the Boards list, create a menu button for it and select it as the user's board */
  const createNewBoard = () => {
    if(origColors.every((o, i) => normalizeColor(o.color) === normalizeColor(replaceColors[i].color))) { 
      // No colors were changed so revert to the original
      selectBoard(origName);
      return;
    }

    const name = getNextCustomName(boards);
    const newBoard = {
      name,
      assetName,
      replaceColors,
      user: true
    };
    boards.push(newBoard);
    storage.set('user-boards', JSON.stringify(boards.filter(b => b.user)));
    addBoardMenuOption(newBoard);
    selectBoard(newBoard.name);
  };

  // Create dialog with preview mini-board and list of replaceable color features
  const dialogBody = 
    `<div class="mb-3 center">
      <div class="mini-board cg-wrap">
        <div class="mini-board-square open-color-picker" data-role="light squares">
          <piece class="black pawn mini-board-piece"></piece>
        </div>
        <div class="mini-board-square open-color-picker" data-role="dark squares">
          <piece class="white knight mini-board-piece"></piece>
        </div>
        <div class="mini-board-square open-color-picker" data-role="dark squares"></div>
        <div class="mini-board-square open-color-picker" data-role="light squares"></div>
      </div>
    </div>
    <div class="color-picker-settings">
    </div>`;
  const dialog = showDialog({type: 'Pick Square Colors', msg: dialogBody, btnSuccess: [createNewBoard, 'OK'], btnFailure: [null, 'Cancel'], htmlMsg: true}, 'modal');
  
  const renderPreview = () => {
    const modifiedSvg = svg.cloneNode(true) as SVGSVGElement; // Replace colors in a copy of the original template board
    const outColors = replaceBoardColors(modifiedSvg, replaceColors, assetName); // Get initial picker colors from the preview board
    const output = new XMLSerializer().serializeToString(modifiedSvg);
    const encoded = encodeURIComponent(output);
    const url = `data:image/svg+xml,${encoded}`;
    const img = new Image();
    img.src = url;
    img.onload = () => {
      dialog.find('.mini-board').css('background-image', `url("${url}")`);
    };
    return outColors;
  };

  // Load the template board and display it as a 4-square example board
  const svg = await loadSvg(`assets/css/images/board/${assetName}.svg`);
  const pickerColors = renderPreview();
   
  // Display list of editable color features, one for each rule
  const pickerSettings = dialog.find('.color-picker-settings');
  pickerColors.forEach((pc, index) => {
    const roleId = pc.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
    const id = `color-picker-${roleId}`;
    let pickerLabel = $(`<label class="color-label" for="${id}" data-role="${pc.name}">
      ${pc.name[0].toUpperCase() + pc.name.slice(1)} color:
    </label>`);
    if(pc.name === 'light squares')
      pickerLabel.addClass('color-label-light');
    else if(pc.name === 'dark squares')
      pickerLabel.addClass('color-label-dark'); 
    let pickerBtn = $(`<button type="button" id="${id}" class="btn btn-outline-secondary color-picker-btn" data-role="${pc.name}"></button>`);     
    pickerBtn.css('--swatch-color', pc.color);
    pickerSettings.append(pickerLabel);
    pickerSettings.append(pickerBtn);
  });

  const updateReplaceColor = (pickerBtn: HTMLElement, color: string) => {
    const pickerRole = $(pickerBtn).data('role');
    const pickerType = $(pickerBtn).data('type');

    // Did color actually change?
    const pickerColorRule = pickerColors.find(pc => pc.name === pickerRole && pc.type === pickerType);
    if(normalizeColor(pickerColorRule.color) !== color) {
      pickerColorRule.color = color;
      replaceColors.find(pc => pc.name === pickerRole && pc.type === pickerType).color = color;
    }
    renderPreview();
  };

  /** Open a color picker */
  dialog.on('click', '.open-color-picker', (e) => {
    const pickerRole = $(e.currentTarget).data('role');
    dialog.find(`.color-picker-btn[data-role="${pickerRole}"]`).trigger('click');
  });

  await createColorPicker(dialog, updateReplaceColor);
}

/**
 * Display a 'Pick Piece Colors' dialog for creating a piece set with custom colors
 * @param origName the name of the piece set to use as a template
 */
async function pickPieceColors(origName: string) {
  const origPieces = pieceSets.find(p => p.name === origName);
  const assetName = origPieces.assetName || origName;
  let pickerColors = null;
 
  const origColors = origPieces.replaceColors || [
    { name: 'primary', type: 'white', color: null }, // The default replaceable rules/features
    { name: 'accent', type: 'white', color: null },
    { name: 'primary', type: 'black', color: null },
    { name: 'accent', type: 'black', color: null },
  ];
  const replaceColors = origColors.map(entry => ({ ...entry }));
  
  /** 
   * Add the new piece set to the PieceSet list, create a menu button for it and select it as the user's 
   * piece set 
   */
  const createNewPieces = () => {
    if(origColors.every((o, i) => o.color === replaceColors[i].color)) {
      // No colors were changed so revert to the original
      selectPieces(origName);
      return;
    }

    const name = getNextCustomName(pieceSets);
    const newPieces = {
      name,
      assetName,
      replaceColors,
      user: true,
    };
    pieceSets.push(newPieces);
    storage.set('user-pieces', JSON.stringify(pieceSets.filter(p => p.user)));
    addPiecesMenuOption(newPieces);
    selectPieces(newPieces.name);
  };

  // Create dialog with 4 square mini-board showing preview pieces and list of replaceable color features
  const dialogBody = 
    `<div class="mb-3 center">
      <div class="mini-board cg-wrap">
        <div class="mini-board-square"></div>
        <div class="mini-board-square"></div>
        <div class="mini-board-square"></div>
        <div class="mini-board-square"></div>
      </div>
    </div>
    <div class="color-picker-settings">
    </div>`;
  const dialog = showDialog({type: 'Pick Piece Colors', msg: dialogBody, btnSuccess: [createNewPieces, 'OK'], btnFailure: [null, 'Cancel'], htmlMsg: true}, 'modal');
  
  // Display a 4 square example board using the user's current board
  const boardImage = $('#main-board-area cg-board').css('background-image');
  dialog.find('.mini-board').css('background-image', boardImage);

  /** Render preview pieces after their color changes */
  const renderPreview = (pickerType: string) => {
    let outColors = null;
    previewPieces.forEach(p => {
      if(p.color !== pickerType)
        return;
      const modifiedSvg = p.svg.cloneNode(true) as SVGSVGElement;
      outColors = replacePieceColors(modifiedSvg, replaceColors, assetName, p.color);
      
      if(!p.img) {
        p.img = svgToImg(modifiedSvg);
        p.img.classList.add('open-color-picker', 'open-color-picker');
        p.img.setAttribute('data-type', p.color);
        p.img.setAttribute('data-role', 'primary');
      }
      else
        p.img.src = svgToUrl(modifiedSvg);
    });
    return outColors; 
  }

  // Display some preview pieces
  const previewPieces: any[] = [
    { svg: await loadSvg(`assets/css/images/pieces/${assetName}/wB.svg`), color: 'white' },
    { svg: await loadSvg(`assets/css/images/pieces/${assetName}/bB.svg`), color: 'black' },
    { svg: await loadSvg(`assets/css/images/pieces/${assetName}/wR.svg`), color: 'white' },
    { svg: await loadSvg(`assets/css/images/pieces/${assetName}/bR.svg`), color: 'black' }
  ];

  const whitePickerColors = renderPreview('white');
  const blackPickerColors = renderPreview('black');
  pickerColors = [...whitePickerColors, ...blackPickerColors];

  const squares = dialog.find('.mini-board-square');
  for(let i = 0; i < squares.length; i++) 
    squares.eq(i).append(previewPieces[i].img);

  // Display list of editable color features, one for each rule
  const pickerSettings = dialog.find('.color-picker-settings');
  pickerColors.forEach(pc => {
    const roleId = pc.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
    const typeId = pc.type.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
    const id = `color-picker-${typeId}-${roleId}`; // Create a unique id
    let pickerLabel = $(`<label class="color-label color-label-${pc.type === 'white' ? 'light' : 'dark'}" for="${id}" data-type="${pc.type}" data-role="${pc.name}">
      ${pc.type[0].toUpperCase() + pc.type.slice(1)} ${pc.name} color:
    </label>`);
    let pickerBtn = $(`<button type="button" id="${id}" class="btn btn-outline-secondary color-picker-btn" data-type="${pc.type}" data-role="${pc.name}"></button>`);     
    pickerBtn.css('--swatch-color', pc.color);
    pickerSettings.append(pickerLabel);
    pickerSettings.append(pickerBtn);
  });

  /** User changed the color in a color picker */
  const updateReplaceColor = (pickerBtn: HTMLElement, color: string) => {
    const pickerRole = $(pickerBtn).data('role');
    const pickerType = $(pickerBtn).data('type');

    // Did color actually change?
    const pickerColorRule = pickerColors.find(pc => pc.name === pickerRole && pc.type === pickerType);
    if(normalizeColor(pickerColorRule.color) !== color) {
      pickerColorRule.color = color;
      replaceColors.find(pc => pc.name === pickerRole && pc.type === pickerType).color = color;
    }
    renderPreview(pickerType);
  };

  /** Open a color picker */
  dialog.on('click', '.open-color-picker', (e) => {
    const pickerType = $(e.currentTarget).data('type');
    const pickerRole = $(e.currentTarget).data('role');
    dialog.find(`.color-picker-btn[data-type="${pickerType}"][data-role="${pickerRole}"]`).trigger('click');
  });

  await createColorPicker(dialog, updateReplaceColor);
}

/** Generate a unique name for the user created board or piece set in the form 'Custom<N>' */
function getNextCustomName(items, prefix = 'custom') {
  const nums = items
    .map(x => x.name)
    .filter(n => n.startsWith(prefix))
    .map(n => parseInt(n.slice(prefix.length), 10))
    .filter(n => !Number.isNaN(n))
    .sort((a, b) => a - b);

  let expected = 1;

  for(const n of nums) {
    if(n === expected) 
      expected++;
    else if (n > expected) 
      break;
  }
  return `${prefix}${expected}`;
}