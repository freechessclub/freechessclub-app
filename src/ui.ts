// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import * as bootstrap from 'bootstrap';
import * as Cookies from 'js-cookie';

// enable tooltips
$(() => {
  $('[data-bs-toggle="tooltip"]').tooltip();
});

if ($(window).width() < 767) {
  $('#collapse-chat').collapse('hide');
}

if ($(window).width() < 767) {
  $('#collapse-history').collapse('hide');
}

// color theme controls
const colorTheme = Cookies.get('theme');
if (colorTheme !== undefined) {
  $('#colortheme').attr('href', 'www/css/themes/' + colorTheme + '.css');
}

$('#colortheme-default').on('click', (event) => {
  $('#colortheme').attr('href', 'www/css/themes/default.css');
  Cookies.set('theme', 'default', { expires: 365 });
});

$('#colortheme-green').on('click', (event) => {
  $('#colortheme').attr('href', 'www/css/themes/green.css');
  Cookies.set('theme', 'green', { expires: 365 });
});

$('#colortheme-yellow').on('click', (event) => {
  $('#colortheme').attr('href', 'www/css/themes/yellow.css');
  Cookies.set('theme', 'yellow', { expires: 365 });
});

$('#colortheme-gray').on('click', (event) => {
  $('#colortheme').attr('href', 'www/css/themes/gray.css');
  Cookies.set('theme', 'gray', { expires: 365 });
});

const textSize = Cookies.get('text-size');
if (textSize !== undefined) {
  $('.tab-content').css('font-size', textSize + 'em');
  $('#textsize-range').val(parseInt(textSize, 10));
}

$('#textsize-range').on('change', (event) => {
  $('.tab-content').css('font-size', String($(event.target).val()) + 'em');
  Cookies.set('text-size', String($(event.target).val()), { expires: 365 })
});
