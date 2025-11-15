// Copyright 2024 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { getTouchClickCoordinates, createTooltip } from './utils';
import { settings } from './settings';
import { games } from './game';

let dialogCounter = 0;

/** ***********************************
 * DIALOGS AND NOTIFICATONS FUNCTIONS *
 **************************************/

/** DIALOG FUNCTIONS **/

export function showBoardDialog(params: DialogParams): any {
  const dialog = createDialog(params);
  dialog.appendTo($('#game-requests'));
  dialog.addClass('board-dialog');
  dialog.toast('show');

  dialog.on('hidden.bs.toast', function () {
    $(this).remove();
  });

  return dialog;
}

export function showFixedDialog(params: DialogParams): any {
  const dialog = createDialog(params);
  const container = $('<div class="toast-container position-fixed top-50 start-50 translate-middle" style="z-index: 101">');
  container.appendTo('body');
  dialog.appendTo(container);
  dialog.toast('show');

  dialog.on('hidden.bs.toast', function () {
    $(this).parent().remove();
  });

  return dialog;
}

export interface DialogParams {
  type?: string;
  title?: string;
  msg?: string;
  btnFailure?: (string | ((event: any) => void))[];
  btnSuccess?: (string | ((event: any) => void))[];
  useSessionSend?: boolean;
  icons?: boolean;
  progress?: boolean;
  htmlMsg?: boolean;
}

export function createDialog({type = '', title = '', msg = '', btnFailure, btnSuccess, useSessionSend = false, icons = true, progress = false, htmlMsg = false}: DialogParams): JQuery<HTMLElement> {
  const dialogId = `dialog${dialogCounter++}`;
  let req = `
  <div id="${dialogId}" class="toast" data-bs-autohide="false" role="status" aria-live="polite" aria-atomic="true">
    <div class="toast-header">
      <strong class="header-text me-auto">${type}</strong>
      <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>
    <div class="toast-body">`;

  if(htmlMsg) 
    req += msg;
  else {
    title = title.replace(/-/g, "\u2011"); // replace hyphen with non-breaking hyphen
    msg = msg.replace(/-/g, "\u2011");
    req += `<div class="d-flex align-items-center">
          <strong class="body-text text-primary my-auto" style="white-space: pre-wrap;">${title ? `${title} ` : ''}${msg}</strong>`;
    if (progress) {
      req += '<div class="spinner-border ms-auto" role="status" aria-hidden="true"></div>';
    }
    req += '</div>';
  }

  let btnSuccessHandler = null;
  let btnFailureHandler = null;

  if((btnSuccess && btnSuccess.length === 2) || (btnFailure && btnFailure.length === 2)) {
    req += '<div class="mt-2 pt-2 border-top center">';
    if(btnSuccess && btnSuccess.length === 2) {
      let successCmd = '';
      if(typeof btnSuccess[0] === 'function')
        btnSuccessHandler = btnSuccess[0];
      if(typeof btnSuccess[0] === 'string') {
        successCmd = 'onclick="';
        if(useSessionSend)
          successCmd += `sessionSend('${btnSuccess[0]}');`;
        else
          successCmd += btnSuccess[0];
        successCmd += '" ';
      }

      req += `<button type="button" ${successCmd}class="button-success btn btn-sm btn-outline-success`
          + `${btnFailure && btnFailure.length === 2 ? ' me-4' : ''}" data-bs-dismiss="toast">`
          + `${icons ? '<span class="fa fa-check-circle-o" aria-hidden="false"></span> ' : ''}`
          + `${btnSuccess[1]}</button>`;
    }
    if (btnFailure && btnFailure.length === 2) {
      let failureCmd = '';
      if(typeof btnFailure[0] === 'function')
        btnFailureHandler = btnFailure[0];
      if(typeof btnFailure[0] === 'string') {
        failureCmd = 'onclick="';
        if(useSessionSend)
          failureCmd += `sessionSend('${btnFailure[0]}');`;
        else
          failureCmd += btnFailure[0];
        failureCmd += '" ';
      }

      req += `<button type="button" ${failureCmd}" class="button-failure `
          + 'btn btn-sm btn-outline-danger" data-bs-dismiss="toast">'
          + `${icons ? '<span class="fa fa-times-circle-o" aria-hidden="false"></span> ' : ''}`
          + `${btnFailure[1]}</button>`;
    }
    req += '</div>';
  }

  req += '</div></div>';

  const dialog = $(req);

  if(btnSuccessHandler)
    dialog.find('.button-success').on('click', btnSuccessHandler);
  if(btnFailureHandler)
    dialog.find('.button-failure').on('click', btnFailureHandler);

  return dialog;
}

export function showInfoDialog(title: string, text: string) {
  const dialog = $(`<div class="toast info-dialog" data-bs-autohide="false" role="status" aria-live="polite" aria-atomic="true">
    <div class="toast-header">
      <strong class="header-text me-auto">${title}</strong>
      <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>
    <div class="toast-body font-monospace" style="max-height: 500px; overflow: auto; white-space: pre-wrap">${text}</div>
  </div>`);
  const modal = $('.modal.show');
  dialog.appendTo(modal.length ? modal : 'body');
  dialog.toast('show');
}

/** NOTIFICATIONS FUNCTIONS **/

export function createNotification(params: DialogParams): any {
  const dialog = createDialog(params);
  dialog.insertBefore($('#notifications-footer'));
  dialog.find('[data-bs-dismiss="toast"]').removeAttr('data-bs-dismiss');
  dialog.attr('data-bs-animation', 'false');
  dialog.on('click', 'button', () => {
    removeNotification(dialog);
  });
  dialog.addClass('notification');
  dialog.addClass('notification-panel');
  $('#notifications-btn').prop('disabled', false);
  $('#notifications-btn').parent().prop('title', 'Notifications');
  createTooltip($('#notifications-btn').parent());

  $('#notifications-number').text($('.notification:not([data-remove="true"])').length);
  $('#notifications-bubble').show();

  const game = games.getPlayingExaminingGame();
  const playingGame = (game && game.isPlayingOnline() ? true : false); // Don't show notifications if playing a game
  if((settings.notificationsToggle && !playingGame) || $('#notifications-header').attr('data-show'))
    showNotifications(dialog);

  return dialog;
}

export function removeNotification(element: any) {
  if(!element.length || element.attr('data-remove'))
    return;

  element.removeAttr('data-show');
  element.attr('data-remove', 'true');

  if(!$('.notification:not([data-remove="true"])').length) {
    $('#notifications-btn').prop('disabled', true);
    $('#notifications-btn').parent().prop('title', 'No notifications');
    createTooltip($('#notifications-btn').parent());
    $('#notifications-bubble').hide();
  }
  $('#notifications-number').text($('.notification:not([data-remove="true"])').length);

  if($('#notifications-header').attr('data-show') && !$('.notification[data-show="true"]').length) {
    $('#notifications-header').removeAttr('data-show');
    $('#notifications-header').toast('hide');
    if($('#notifications-btn').hasClass('active'))
      $('#notifications-btn').button('toggle');
  }
  if($('#notifications-footer').attr('data-show') && (!$('.notification[data-show="true"]').length || $('.notification:not([data-remove="true"])').length <= 1)) {
    $('#notifications-footer').removeAttr('data-show');
    $('#notifications-footer').toast('hide');
  }

  // Remove notification half way through its slide, because remove() takes a while.
  setTimeout(() => element.remove(), 400);

  const transformMatrix = element.css('transform');
  const matrix = transformMatrix.replace(/[^0-9\-.,]/g, '').split(',');
  const x = matrix[12] || matrix[4]; // translate x
  slideNotification(element, (x < 0 ? 'left' : 'right'));
}

export function showNotifications(dialogs: any) {
  if(!dialogs.length)
    return;

  // If not all notifications are displayed, add a 'Show All' button to the footer
  let allShown = true;
  $('.notification').each((index, element) => {
    if(!$(element).attr('data-show') && !$(element).attr('data-remove') && dialogs.index($(element)) === -1)
      allShown = false;
  });
  if(allShown)
    $('#notifications-show-all').hide();
  else
    $('#notifications-show-all').show();

  if(!$('#notifications-header').attr('data-show')) {
    slideNotification($('#notifications-header'), 'down');
    $('#notifications-header').attr('data-show', 'true');
    $('#notifications-header').toast('show');
  }

  dialogs.each((index, element) => {
    if(!$(element).attr('data-show')) {
      slideNotification($(element), 'down');
      $(element).attr('data-show', 'true');
      $(element).toast('show');
    }
  });

  if($('.notification:not([data-remove="true"])').length > 1 && !$('#notifications-footer').attr('data-show')) {
    slideNotification($('#notifications-footer'), 'down');
    $('#notifications-footer').attr('data-show', 'true');
    $('#notifications-footer').toast('show');
  }
}

export function showAllNotifications() {
  showNotifications($('.notification:not([data-show="true"])'));
}

export function hideAllNotifications() {
  if($('.notification[data-remove="true"').length) {
    setTimeout(hideAllNotifications, 400);
    return;
  }

  $('#notifications').children('[data-show="true"]').each((index, element) => {
    $(element).removeAttr('data-show');
  });
  if($('#notifications-btn').hasClass('active'))
    $('#notifications-btn').button('toggle');
  slideUpAllNotifications();
}

export function clearNotifications() {
  let delay = 0;
  $('.notification').each((index, element) => {
    $(element).removeAttr('data-show');
    if($(element).hasClass('show')) {
      setTimeout(() => removeNotification($(element)), delay);
      delay += 100;
    }
    else
      removeNotification($(element));
  });
}

$('#notifications-header .btn-close').on('click', () => {
  hideAllNotifications();
});

$('#notifications-show-all').on('click', () => {
  showAllNotifications();
});

$('#notifications-clear-all').on('click', () => {
  clearNotifications();
});

$('#notifications-btn').on('click', function() {
  if($(this).hasClass('active'))
    showAllNotifications();
  else
    hideAllNotifications();
});

/* Perform slide transition (animation) on Notification panel */
function slideNotification(element: any, direction: 'down' | 'up' | 'left' | 'right') {
  if(direction === 'down') {
    // Set initial state before transition
    resetSlide(element);
    $('#notifications').css('opacity', '');
    $('#notifications').css('transform', '');
    $('#notifications').show();
    element.css('z-index', '-1');
    element.css('opacity', '0');
    // Trigger transition after toast is shown
    element.one('shown.bs.toast', () => {
      // Add transition (animation)
      element.css('margin-top', -element[0].getBoundingClientRect().height);
      element[0].offsetWidth;
      element.addClass('slide-down');
      element.css('margin-top', '');
      element.css('z-index', '');
      element.css('opacity', '');
      element.one('transitionend', () => {
        element.removeClass('slide-down');
      });
    });
  }
  else if(direction === 'up') {
    element.addClass('slide-up');
    element.css('margin-top', -element[0].getBoundingClientRect().height);
    element.css('opacity', '0');
    element.one('transitionend', () => {
      if(!element.attr('data-show'))
        element.toast('hide');
      element.removeClass('slide-up');
      element.css('opacity', '');
      element.css('margin-top', '');
    });
  }
  else if(direction === 'left' || direction === 'right') {
    element.css('z-index', '-1');
    element.addClass('slide-sideways');
    element.css('transform', `translateX(${direction === 'left' ? '-' : ''}100%)`);
    element.css('opacity', '0');
    element.one('transitionend', () => {
      element.removeClass('slide-sideways');
      element.toast('hide');
      element.css('z-index', '');
      element.css('transform', '');
      element.css('opacity', '');
    });
  }
}

function slideUpAllNotifications() {
  $('#notifications').children().each((index, element) => resetSlide($(element)));
  $('#notifications').addClass('slide-up');
  $('#notifications').css('opacity', 0);
  $('#notifications').css('transform', 'translateY(-100%)');
  $('#notifications').one('transitionend', (event) => {
    $(event.currentTarget).removeClass('slide-up');
    let shown = false;
    $(event.currentTarget).children().each((index, element) => {
      if(!$(element).attr('data-show'))
        $(element).toast('hide');
      else
        shown = true;
    });
    if(!shown)
      $('#notifications').hide();
    $(event.currentTarget).css('transform', '');
    $(event.currentTarget).css('opacity', '');
  });
}

function resetSlide(element: any) {
  element.removeClass('slide-sideways');
  element.removeClass('slide-down');
  element.removeClass('slide-up');
  element.css('z-index', '');
  element.css('transform', '');
  element.css('opacity', '');
  element.css('margin-top', '');
}

$('#notifications')[0].addEventListener('mousedown', notificationMouseDown);
$('#notifications')[0].addEventListener('touchstart', notificationMouseDown, {passive: false});
function notificationMouseDown(mdEvent) {
  if(mdEvent.target.closest('button, input, a, select, textarea, label')) 
    return;

  if($(':focus').length > 0)
    $(':focus').trigger('blur');

  if(window.getSelection)
    window.getSelection().removeAllRanges();

  $('#notifications').css('--dragX', 0);
  $('#notifications').css('--dragY', 0);
  $('#notifications').css('--opacityY', 1);
  $('#notifications').css('--opacityX', 1);

  const dialog = $(mdEvent.target).closest('.toast');
  dialog.css('transition', 'none');

  // Prevent mouse pointer events on webpage while dragging panel
  jQuery('<div/>', {
    id: 'mouse-capture-layer',
    css: {'z-index': '9999',
      'top': '0',
      'left': '0',
      'position': 'fixed',
      'height': '100%',
      'width': '100%'
    }
  }).appendTo('body');

  let swipeStart = getTouchClickCoordinates(mdEvent);
  let swipeLocked = '';
  const mouseMoveHandler = (event) => {
    const mouse = getTouchClickCoordinates(event);
    if(swipeLocked) {
      const xMax = $('#notifications').outerWidth(true);
      const yMax = $('#notifications').outerHeight(true);
      const xOffset = Math.min(xMax, Math.max(-xMax, mouse.x - swipeStart.x));
      const yOffset = Math.min(0, mouse.y - swipeStart.y);
      $('#notifications').css('--dragX', `${xOffset}px`);
      $('#notifications').css('--dragY', `${yOffset}px`);
      $('#notifications').css('--opacityY', (yMax - Math.abs(yOffset)) / yMax);
      $('#notifications').css('--opacityX', (xMax - Math.abs(xOffset)) / xMax);
    }
    else {
      if(swipeStart.y - mouse.y > 20 && Math.abs(swipeStart.y - mouse.y) > Math.abs(swipeStart.x - mouse.x)) {
        // Perform vertical swipe
        swipeStart = mouse;
        swipeLocked = 'vertical';
        $('#notifications').css('transform', 'translateY(var(--dragY))');
        $('#notifications').css('opacity', 'var(--opacityY)');
      }
      else if(dialog.hasClass('notification') && Math.abs(swipeStart.x - mouse.x) > 20 && Math.abs(swipeStart.x - mouse.x) > Math.abs(swipeStart.y - mouse.y)) {
        // Perform horizontal swipe
        swipeStart = mouse;
        swipeLocked = 'horizontal';
        dialog.css('transform', 'translateX(var(--dragX))');
        dialog.css('opacity', 'var(--opacityX)');
      }
    }
  };
  $(document).on('mousemove touchmove', mouseMoveHandler);

  $(document).one('mouseup touchend touchcancel', (event) => {
    const mouse = getTouchClickCoordinates(event);
    $('#mouse-capture-layer').remove();
    $(document).off('mousemove touchmove', mouseMoveHandler);
    if(swipeLocked === 'vertical') {
      if(swipeStart.y - mouse.y > 30 && event.type !== 'touchcancel')
        hideAllNotifications();
      else {
        $('#notifications').css('transform', '');
        $('#notifications').css('opacity', '');
      }
    }
    else if(swipeLocked === 'horizontal') {
      if(Math.abs(mouse.x - swipeStart.x) > 50 && event.type !== 'touchcancel')
        removeNotification(dialog);
      else {
        dialog.css('transform', '');
        dialog.css('opacity', '');
      }
    }
    swipeLocked = '';
    swipeStart = null;
    dialog.css('transition', '');
  });

  mdEvent.preventDefault();
}