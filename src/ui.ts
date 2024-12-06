// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import packageInfo from '../package.json';
import { storage } from './storage';

$('#version').text(`Version: ${packageInfo.version}`);

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

function setStyle(component: string, name: string) {
  $(`#${component}`).attr('href', `assets/css/${component}s/${name}.css`);
  storage.set(component, name);
}

// color theme controls
const theme = storage.get('theme');
if (theme != null) {
  $('#theme').attr('href', `assets/css/themes/${theme}.css`);
}

$('#theme-default').on('click', () => { setStyle('theme', 'default') });
$('#theme-green').on('click', () => { setStyle('theme', 'green') });
$('#theme-yellow').on('click', () => { setStyle('theme', 'yellow') });
$('#theme-gray').on('click', () => { setStyle('theme', 'gray') });
$('#theme-purple').on('click', () => { setStyle('theme', 'purple') });
$('#theme-ic').on('click', () => { setStyle('theme', 'ic') });
$('#theme-newspaper').on('click', () => { setStyle('theme', 'newspaper') });

// board piece controls
const piece = storage.get('piece');
if (piece != null) {
  $('#piece').attr('href', `assets/css/pieces/${piece}.css`);
}

$('#pieces-merida').on('click', () => { setStyle('piece', 'default') });
$('#pieces-cburnett').on('click', () => { setStyle('piece', 'cburnett') });
$('#pieces-alpha').on('click', () => { setStyle('piece', 'alpha') });
$('#pieces-cardinal').on('click', () => { setStyle('piece', 'cardinal') });
$('#pieces-leipzig').on('click', () => { setStyle('piece', 'leipzig') });
$('#pieces-maestro').on('click', () => { setStyle('piece', 'maestro') });
