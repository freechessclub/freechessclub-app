// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import * as Cookies from 'js-cookie';

// enable tooltips
$(() => {
  $('[data-toggle="tooltip"]').tooltip();
});

if ($(window).width() < 767) {
  $('#collapse-chat').collapse('hide');
}

if ($(window).width() < 767) {
  $('#collapse-history').collapse('hide');
}

// color theme controls
$('#colortheme-default').on('click', (event) => {
  $('#colortheme').attr('href', 'www/css/themes/default.css');
});

$('#colortheme-green').on('click', (event) => {
  $('#colortheme').attr('href', 'www/css/themes/green.css');
});

$('#colortheme-yellow').on('click', (event) => {
  $('#colortheme').attr('href', 'www/css/themes/yellow.css');
});

$('#colortheme-gray').on('click', (event) => {
  $('#colortheme').attr('href', 'www/css/themes/gray.css');
});

const textSize = Cookies.get('text-size');
if (textSize !== undefined) {
  $('.chat-text').css('font-size', textSize + 'px');
  $("#textsize-range").val(parseInt(textSize));
}

$('#textsize-range').on('change', (event) => {
  $('.chat-text').css('font-size', String($(event.target).val()) + 'px');
  Cookies.set('text-size', String($(event.target).val()), { expires: 365 })
});
