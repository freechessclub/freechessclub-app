// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import packageInfo from '../package.json';
import { storage } from './storage';

$('#version').text('Version: ' + packageInfo.version);

// text size controls
const textSize = storage.get('text-size');
if (textSize != null) {
  $('.tab-content').css('font-size', textSize + 'em');
  $('#textsize-range').val(parseInt(textSize, 10));
}

$('#textsize-range').on('change', (event) => {
  $('.tab-content').css('font-size', String($(event.target).val()) + 'em');
  storage.set('text-size', String($(event.target).val()));
});

function setStyle(component: string, name: string) {
  $('#' + component).attr('href', 'assets/css/' + component + 's/' + name + '.css');
  storage.set(component, name);
}

// color theme controls
const theme = storage.get('theme');
if (theme != null) {
  $('#theme').attr('href', 'assets/css/themes/' + theme + '.css');
}

$('#theme-default').on('click', (event) => { setStyle('theme', 'default') });
$('#theme-green').on('click', (event) => { setStyle('theme', 'green') });
$('#theme-yellow').on('click', (event) => { setStyle('theme', 'yellow') });
$('#theme-gray').on('click', (event) => { setStyle('theme', 'gray') });
$('#theme-purple').on('click', (event) => { setStyle('theme', 'purple') });
$('#theme-ic').on('click', (event) => { setStyle('theme', 'ic') });
$('#theme-newspaper').on('click', (event) => { setStyle('theme', 'newspaper') });

// board piece controls
const piece = storage.get('piece');
if (piece != null) {
  $('#piece').attr('href', 'assets/css/pieces/' + piece + '.css');
}

$('#pieces-merida').on('click', (event) => { setStyle('piece', 'default') });
$('#pieces-cburnett').on('click', (event) => { setStyle('piece', 'cburnett') });
$('#pieces-alpha').on('click', (event) => { setStyle('piece', 'alpha') });
$('#pieces-cardinal').on('click', (event) => { setStyle('piece', 'cardinal') });
$('#pieces-leipzig').on('click', (event) => { setStyle('piece', 'leipzig') });
$('#pieces-maestro').on('click', (event) => { setStyle('piece', 'maestro') });
