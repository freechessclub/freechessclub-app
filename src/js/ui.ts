// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import packageInfo from '../../package.json';
import { storage } from './storage';

$('#version').text(`Version: ${packageInfo.version}`);

const themes = {};

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

$('#themes-menu li').on('click', (event) => {
  $('#themes-button').text($(event.target).text());
  $('#board-style').remove();
  storage.remove('board');

  const theme = $(event.target).attr('id').split('theme-')[1];
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