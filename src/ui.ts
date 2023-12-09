// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import Cookies from 'js-cookie';
import packageInfo from '../package.json';

$('#version').text('Version: ' + packageInfo.version);

// color theme controls
const colorTheme = Cookies.get('theme');
if (colorTheme !== undefined) {
  $('#colortheme').attr('href', 'assets/css/themes/' + colorTheme + '.css');
}

$('#colortheme-default').on('click', (event) => {
  $('#colortheme').attr('href', 'assets/css/themes/default.css');
  Cookies.set('theme', 'default', { expires: 365 });
});

$('#colortheme-green').on('click', (event) => {
  $('#colortheme').attr('href', 'assets/css/themes/green.css');
  Cookies.set('theme', 'green', { expires: 365 });
});

$('#colortheme-yellow').on('click', (event) => {
  $('#colortheme').attr('href', 'assets/css/themes/yellow.css');
  Cookies.set('theme', 'yellow', { expires: 365 });
});

$('#colortheme-gray').on('click', (event) => {
  $('#colortheme').attr('href', 'assets/css/themes/gray.css');
  Cookies.set('theme', 'gray', { expires: 365 });
});

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

// board piece controls
const piece = Cookies.get('piece');
if (piece !== undefined) {
  $('#piece').attr('href', 'assets/css/pieces/' + piece + '.css');
}

$('#pieces-merida').on('click', (event) => {
  $('#piece').attr('href', 'assets/css/pieces/default.css');
  Cookies.set('piece', 'default', { expires: 365 });
});

$('#pieces-cburnett').on('click', (event) => {
  $('#piece').attr('href', 'assets/css/pieces/cburnett.css');
  Cookies.set('piece', 'cburnett', { expires: 365 });
});

$('#pieces-alpha').on('click', (event) => {
  $('#piece').attr('href', 'assets/css/pieces/alpha.css');
  Cookies.set('piece', 'alpha', { expires: 365 });
});
