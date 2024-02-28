// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import Cookies from 'js-cookie';
import packageInfo from '../package.json';

$('#version').text('Version: ' + packageInfo.version);

// text size controls
const textSize = Cookies.get('text-size');
if (textSize !== undefined) {
  $('.tab-content').css('font-size', textSize + 'em');
  $('#textsize-range').val(parseInt(textSize, 10));
}

$('#textsize-range').on('change', (event) => {
  $('.tab-content').css('font-size', String($(event.target).val()) + 'em');
  Cookies.set('text-size', String($(event.target).val()), { expires: 365 })
});

function setStyle(component: string, name: string) {
  $('#' + component).attr('href', 'assets/css/' + component + 's/' + name + '.css');
  Cookies.set(component, name, { expires: 365 });
}

// color theme controls
const theme = Cookies.get('theme');
if (theme !== undefined) {
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
const piece = Cookies.get('piece');
if (piece !== undefined) {
  $('#piece').attr('href', 'assets/css/pieces/' + piece + '.css');
}

$('#pieces-merida').on('click', (event) => { setStyle('piece', 'default') });
$('#pieces-cburnett').on('click', (event) => { setStyle('piece', 'cburnett') });
$('#pieces-alpha').on('click', (event) => { setStyle('piece', 'alpha') });
$('#pieces-cardinal').on('click', (event) => { setStyle('piece', 'cardinal') });
$('#pieces-leipzig').on('click', (event) => { setStyle('piece', 'leipzig') });
$('#pieces-maestro').on('click', (event) => { setStyle('piece', 'maestro') });
