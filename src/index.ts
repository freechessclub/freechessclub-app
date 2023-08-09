// Copyright 2023 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import Chess from 'chess.js';
import Cookies from 'js-cookie';
import { Chessground } from 'chessground';
import { Color, Key } from 'chessground/types';

import Chat from './chat';
import * as clock from './clock';
import { Engine, EvalEngine } from './engine';
import { game, Role } from './game';
import History from './history';
import { GetMessageType, MessageType, Session } from './session';
import * as Sounds from './sounds';
import './ui';

let session: Session;
let chat: Chat;
let engine: Engine | null;
let evalEngine: EvalEngine | null;

// toggle game sounds
let soundToggle: boolean = (Cookies.get('sound') !== 'false');
// toggle for auto-promote to queen
let autoPromoteToggle: boolean = (Cookies.get('autopromote') === 'true');
// toggle for showing Computer opponents in the lobby
let lobbyShowComputersToggle: boolean = (Cookies.get('lobbyshowcomputers') === 'true');
// toggle for automatically showing new slide-down notifications or notifications in chat channels
export let notificationsToggle: boolean = (Cookies.get('notifications') !== 'false');

let historyRequested = 0;
let obsRequested = 0;
let gamesRequested = false;
let movelistRequested = 0;
let lobbyRequested = false;
let channelListRequested = false;
let computerListRequested = false;
let computerList = [];
let modalCounter = 0;
let numPVs = 1;
let gameChangePending = false;
let matchRequested = 0;
let matchRequests = new Map();
let prevWindowWidth = 0;
let addressBarHeight;
let soundTimer
let showMatchTimer;
let removeSubvariationRequested = false;
let prevDiff;
let activeTab;
let promotePiece;
let promoteSource;
let promoteTarget;
let promoteIsPremove;
let bufferedHistoryIndex = -1;
let bufferedHistoryCount = 0;
let seekMap = new Map();

function cleanupGame() {
  hideButton($('#stop-observing'));
  hideButton($('#stop-examining'));
  hideCloseGamePanel();
  hidePromotionPanel();
  $('#playing-game-buttons').hide();
  $('#viewing-game-buttons').show();
  $('#lobby-pane-status').hide();

  if(game.wclock)
    clearInterval(game.wclock);
  if(game.bclock)
    clearInterval(game.bclock);
  if(game.watchers)
    clearInterval(game.watchers);
  game.watchers = null;
  $('#game-watchers').empty();

  game.id = 0;
  delete game.chess;
  game.chess = null;
  game.role = Role.NONE;
  board.cancelMove();
  updateBoard();
  if($('#left-panel-bottom').is(':visible'))
    showStatusPanel();

  if($('#pills-play').hasClass('active') && $('#pills-lobby').hasClass('active'))
    initLobbyPane();

  bufferedHistoryIndex = -1;
  bufferedHistoryCount = 0;
}

export function cleanup() {
  historyRequested = 0;
  obsRequested = 0;
  gamesRequested = false;
  movelistRequested = 0;
  lobbyRequested = false;
  channelListRequested = false;
  computerListRequested = false;
  gameChangePending = false;
  removeSubvariationRequested = false;
  clearMatchRequests();
  clearNotifications();
  cleanupGame();
}

export function disableOnlineInputs(disable: boolean) {
  $('#pills-play *').prop('disabled', disable);
  $('#pills-examine *').prop('disabled', disable);
  $('#pills-observe *').prop('disabled', disable);
  $('#chan-dropdown *').prop('disabled', disable);
  $('#input-form *').prop('disabled', disable);
}

function initCategory() {
  // Check if game category (variant) is supported by Engine
  if(Engine.categorySupported(game.category)) {
    if(!evalEngine)
      evalEngine = new EvalEngine(game.history, game.category);
    showAnalyzeButton();
  }
  else 
    hideAnalysis();  
}

function hideCloseGamePanel() {
  $('#close-game-panel').hide();
  setPanelSizes();
}

function showCloseGamePanel() {
  $('#close-game-panel').show();
  setPanelSizes();
}

function hideStatusPanel() {
  $('#show-status-panel').text('Status/Analysis');
  $('#show-status-panel').attr('title', 'Show Status Panel');
  $('#show-status-panel').show();
  $('#left-panel-bottom').hide();
  stopEngine();
  setPanelSizes();
}

function showStatusPanel() {
  $('#left-panel-bottom').show();
  if(game.isPlaying()) {
    $('#close-status').hide(); 
    hideAnalysis();
  }
  else {
    showAnalyzeButton();
    if($('#engine-tab').is(':visible') && evalEngine) 
      evalEngine.evaluate();
    $('#close-status').show();
  }
  setPanelSizes();
}

function showPromotionPanel(source: string, target: string, premove: boolean = false) {
  promoteSource = source;
  promoteTarget = target;
  promoteIsPremove = premove;
  var orientation = board.state.orientation;
  var color = (target.charAt(1) === '8' ? 'white' : 'black');
  var fileNum = target.toLowerCase().charCodeAt(0) - 97;

  // Add temporary pieces to the DOM in order to retrieve the background-image style from them
  var pieces = $('<div class="cg-wrap d-none"></div>').appendTo($('body'));
  var bgQueen = $('<piece class="queen ' + color + '"></piece>').appendTo(pieces).css('background-image').replace(/\"/g, '\'');
  var bgKnight = $('<piece class="knight ' + color + '"></piece>').appendTo(pieces).css('background-image').replace(/\"/g, '\'');
  var bgRook = $('<piece class="rook ' + color + '"></piece>').appendTo(pieces).css('background-image').replace(/\"/g, '\'');
  var bgBishop = $('<piece class="bishop ' + color + '"></piece>').appendTo(pieces).css('background-image').replace(/\"/g, '\'');  
  pieces.remove();
  $('#promotion-panel').css('left', $('#promotion-panel').width() * (orientation === "white" ? fileNum : 7 - fileNum));
  if(orientation === color) {
    $('#promotion-panel').css('top', 0);
    $('#promotion-panel').html(`
      <button id="promote-piece-q" class="btn btn-default promote-piece w-100 h-25" style="background-image: ` + bgQueen + `; background-size: cover;"></button>
      <button id="promote-piece-n" class="btn btn-default promote-piece w-100 h-25" style="background-image: ` + bgKnight + `; background-size: cover;"></button>
      <button id="promote-piece-r" class="btn btn-default promote-piece w-100 h-25" style="background-image: ` + bgRook + `; background-size: cover;"></button>
      <button id="promote-piece-b" class="btn btn-default promote-piece w-100 h-25" style="background-image: ` + bgBishop + `; background-size: cover;"></button>
    `);
  }
  else {
    $('#promotion-panel').css('top', '50%');
    $('#promotion-panel').html(`
      <button id="promote-piece-b" class="btn btn-default promote-piece w-100 h-25" style="background-image: ` + bgBishop + `; background-size: cover;"></button>
      <button id="promote-piece-r" class="btn btn-default promote-piece w-100 h-25" style="background-image: ` + bgRook + `; background-size: cover;"></button>
      <button id="promote-piece-n" class="btn btn-default promote-piece w-100 h-25" style="background-image: ` + bgKnight + `; background-size: cover;"></button>
      <button id="promote-piece-q" class="btn btn-default promote-piece w-100 h-25" style="background-image: ` + bgQueen + `; background-size: cover;"></button>
    `);
  }
 
  $('.promote-piece').on('click', (event) => {
    hidePromotionPanel();
    promotePiece = $(event.target).attr('id').slice(-1);
    if(!premove)
      movePiece(source, target, null);
  });

  $('#promotion-panel').show();
}

function hidePromotionPanel() {
  promotePiece = null;
  $('#promotion-panel').hide();
}

// Restricts input for the set of matched elements to the given inputFilter function.
function setInputFilter(textbox: Element, inputFilter: (value: string) => boolean, errMsg: string): void {
  ['input', 'keydown', 'keyup', 'mousedown', 'mouseup', 'select', 'contextmenu', 'drop', 'focusout'].forEach(function(event) {
    textbox.addEventListener(event, function(this: (HTMLInputElement | HTMLTextAreaElement) & {oldValue: string; oldSelectionStart: number | null, oldSelectionEnd: number | null}) {
      if (inputFilter(this.value)) {
        this.oldValue = this.value;
        this.oldSelectionStart = this.selectionStart;
        this.oldSelectionEnd = this.selectionEnd;
      } else if (Object.prototype.hasOwnProperty.call(this, 'oldValue')) {
        this.value = this.oldValue;
        if (this.oldSelectionStart !== null &&
          this.oldSelectionEnd !== null) {
          this.setSelectionRange(this.oldSelectionStart, this.oldSelectionEnd);
        }
      } else {
        this.value = '';
      }
    });
  });
}

$('#move-history').on('click', '.selectable', function() {
  const id = $('#move-history .selectable').index(this) + 1;
  gotoMove(id);
});

export function gotoMove(id: number) {
  if(game.isExamining()) {
    const move = game.history.get(id);
    const prevMove = game.history.get();

    let mainlineId = id;
    let firstSubvarId = id;
    if(!prevMove.subvariation && move.subvariation) {
      do {
        firstSubvarId = mainlineId;
        mainlineId = game.history.prev(mainlineId);
      }
      while(game.history.get(mainlineId).subvariation);
    }

    let backNum = 0;
    let i = game.history.index();
    while(i > id || (!move.subvariation && game.history.get(i).subvariation)) {
      i = game.history.prev(i);
      backNum++;
    }
    if(i > mainlineId)
      backNum++;
    if(backNum > 0) {
      session.send('back ' + backNum);
    }

    let forwardNum = 0;
    while(i < mainlineId && !game.history.scratch() && (!prevMove.subvariation || !move.subvariation)) {
      i = game.history.next(i);
      forwardNum++;
    }
    if(forwardNum > 0)
      session.send('for ' + forwardNum);

    if(!prevMove.subvariation && move.subvariation) {
      i = firstSubvarId;
      const iMove = game.history.get(i);
      session.send(iMove.move.san);
    }
    while(i < id) {
      i = game.history.next(i);
      const iMove = game.history.get(i);
      session.send(iMove.move.san);
    }
  }
  else
    var entry = game.history.display(id);
}

function showCapturePiece(color: string, p: string): void {
  if (game.color === color) {
    if (game.oppCaptured[p] !== undefined && game.oppCaptured[p] > 0) {
      game.oppCaptured[p]--;
    } else {
      if (game.playerCaptured[p] === undefined) {
        game.playerCaptured[p] = 0;
      }
      game.playerCaptured[p]++;
    }
  } else {
    if (game.playerCaptured[p] !== undefined && game.playerCaptured[p] > 0) {
      game.playerCaptured[p]--;
    } else {
      if (game.oppCaptured[p] === undefined) {
        game.oppCaptured[p] = 0;
      }
      game.oppCaptured[p]++;
    }
  }

  $('#player-captured').empty();
  $('#opponent-captured').empty();
  for (const key in game.playerCaptured) {
    if (game.playerCaptured.hasOwnProperty(key) && game.playerCaptured[key] > 0) {
      const piece = swapColor(game.color) + key.toUpperCase();
      $('#player-captured').append(
        '<img id="' + piece + '" src="assets/css/images/pieces/merida/' +
          piece + '.svg"/><small>' + game.playerCaptured[key] + '</small>');
    }
  }
  for (const key in game.oppCaptured) {
    if (game.oppCaptured.hasOwnProperty(key) && game.oppCaptured[key] > 0) {
      const piece = game.color + key.toUpperCase();
      $('#opponent-captured').append(
        '<img id="' + piece + '" src="assets/css/images/pieces/merida/' +
          piece + '.svg"/><small>' + game.oppCaptured[key] + '</small>');
    }
  }
}

const board: any = Chessground(document.getElementById('board'), {
  movable: {
    free: false,
    color: undefined,
    events: {
      after: movePiece,
    }
  },
  premovable: {
    events: {
      set: preMovePiece,
      unset: hidePromotionPanel,
    }
  }
});

function toDests(chess: any): Map<Key, Key[]> {
  // In 'losers' variant, if a capture is possible then include only captures in dests
  if(game.category === 'losers') {
    var dests = new Map();
    chess.SQUARES.forEach(s => {
      var ms = chess.moves({square: s, verbose: true}).filter((m) => {
        return /[ec]/.test(m.flags);
      }); 
      if(ms.length)
        dests.set(s, ms.map(m => m.to));
    });
  }

  if(!dests || !dests.size) {
    var dests = new Map();
    chess.SQUARES.forEach(s => {
      var ms = chess.moves({square: s, verbose: true});
      if(ms.length)    
        dests.set(s, ms.map(m => m.to));
    });
  }

  // Add irregular castling moves for wild variants
  if(game.category.startsWith('wild')) {
    var color = chess.turn();
    var rank = (color === 'w' ? '1' : '8');
    var files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    var startChess = new Chess(game.history.get(0).fen);
    for(const file of files) {
      let square = file + rank;
      let piece = startChess.get(square);
      if(piece && piece.color === color && piece.type === 'r') {
        if(!leftRook)
          var leftRook = square;
        else
          var rightRook = square;      
      }
      piece = chess.get(square);
      if(piece && piece.color === color && piece.type === 'k')
        var king = square;
    }

    // Remove any castling moves already in dests
    var kingDests = dests.get(king);
    if(kingDests) {
      kingDests.filter((dest) => {
        return Math.abs(dest.charCodeAt(0) - king.charCodeAt(0)) > 1;
      }).forEach((dest) => {
        kingDests.splice(kingDests.indexOf(dest), 1);
      });
      if(kingDests.length === 0)
        dests.delete(king);
    }
    
    var parsedMove = parseMove(chess.fen(), 'O-O', game.category);
    if(parsedMove) {
      var from = parsedMove.move.from;
      if(game.category === 'wild/fr')
        var to = rightRook;
      else 
        var to = parsedMove.move.to;
      var kingDests = dests.get(from);
      if(kingDests)
        kingDests.push(to);
      else dests.set(from, [to]);
    }
    var parsedMove = parseMove(chess.fen(), 'O-O-O', game.category);
    if(parsedMove) {
      var from = parsedMove.move.from;
      if(game.category === 'wild/fr')
        var to = leftRook;
      else
        var to = parsedMove.move.to;
      var kingDests = dests.get(from);
      if(kingDests)
        kingDests.push(to);
      else dests.set(from, [to]);
    }
  }

  return dests;
}

export function swapColor(color: string): string {
  return (color === 'w') ? 'b' : 'w';
}

function toColor(chess: any): Color {
  return (chess.turn() === 'w') ? 'white' : 'black';
}

function inCheck(san: string) {
  return (san.slice(-1) === '+');
}

function movePieceAfter(move: any, fen?: string) {
  if(!fen)
    fen = game.chess.fen();

  // go to current position if user is looking at earlier move in the move list
  if((game.isPlaying() || game.isObserving()) && game.history.ply() < game.history.length())
    game.history.display(game.history.length());

  updateHistory(move, fen);

  board.playPremove();
}

export function movePiece(source: any, target: any, metadata: any) {
  let fen = '';
  let move = null;

  if(game.isPlaying() || game.isExamining() || game.role === Role.NONE) {  
    if(game.isPlaying() || game.isExamining()) 
      var chess = game.chess;
    else
      var chess = new Chess(game.history.get().fen);

    var parsedMove = parseMove(chess.fen(), {from: source, to: target, promotion: (promotePiece ? promotePiece : 'q')}, game.category);
    fen = parsedMove.fen;
    move = parsedMove.move;

    if(!promotePiece && !autoPromoteToggle && move && move.flags.includes('p')) {
      showPromotionPanel(source, target, false);
      board.set({ movable: { color: undefined } });
      return;
    }

    chess.load(fen);

    var promotion = (promotePiece ? '=' + promotePiece : '');
    if (game.isPlaying() && game.chess.turn() !== game.color)
      session.send(move.from + '-' + move.to + promotion);
   
    if(game.isExamining()) {
      var nextMove = game.history.get(game.history.next());
      if(nextMove && !nextMove.subvariation && !game.history.scratch() && fen === nextMove.fen) 
        session.send('for');
      else
        session.send(move.from + '-' + move.to + promotion);
    }
  }

  promotePiece = null;  
  if (move !== null)
    movePieceAfter(move, fen);

  showTab($('#pills-game-tab'));
  // Show 'Analyze' button once any moves have been made on the board
  showAnalyzeButton();
}

function preMovePiece(source: any, target: any, metadata: any) {
  var chess = new Chess(board.getFen() + ' w KQkq - 0 1'); 
  if(!promotePiece && chess.get(source).type === 'p' && (target.charAt(1) === '1' || target.charAt(1) === '8')) {
    showPromotionPanel(source, target, true);
  }
}

function showStatusMsg(msg: string) {
  showStatusPanel();
  $('#game-status').html(msg + '<br/>');
}

function showModal(type: string, title: string, msg: string, btnFailure: string[], btnSuccess: string[], progress = false, useSessionSend = true) {
  var modalHtml = createModal(type, title, msg, btnFailure, btnSuccess, progress, useSessionSend);
  var modal = $(modalHtml).appendTo($('#game-requests'));
  modal.toast('show');
}

function createModal(type: string, title: string, msg: string, btnFailure: string[], btnSuccess: string[], progress = false, useSessionSend = true) { 
  const modalId = 'modal' + modalCounter++;
  let req = `
  <div id="` + modalId + `" class="toast" data-bs-autohide="false" role="status" aria-live="polite" aria-atomic="true">
    <div class="toast-header">
      <strong class="header-text me-auto">` + type + `</strong>
      <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>
    <div class="toast-body">
      <div class="d-flex align-items-center">
        <strong class="body-text text-primary my-auto">` + title + ' ' + msg + '</strong>';
  
  if (progress) {
    req += '<div class="spinner-border ms-auto" role="status" aria-hidden="true"></div>';
  }
  req += '</div>';

  if(btnSuccess !== undefined || btnFailure !== undefined) {
    req += '<div class="mt-2 pt-2 border-top center">';
    if (btnSuccess !== undefined && btnSuccess.length === 2) {
      let successCmd = btnSuccess[0];
      if(useSessionSend) 
        successCmd = "sessionSend('" + btnSuccess[0] + "');";
      req += '<button type="button" onclick="' + successCmd + `" class="button-success btn btn-sm btn-outline-success me-4" data-bs-dismiss="toast">
          <span class="fa fa-check-circle-o" aria-hidden="false"></span> ` + btnSuccess[1] + '</button>';
    }
    if (btnFailure !== undefined && btnFailure.length === 2) {
      let failureCmd = btnFailure[0];
      if(useSessionSend) 
        failureCmd = "sessionSend('" + btnFailure[0] + "');";  
      req += '<button type="button" onclick="' + failureCmd + `" class="button-failure btn btn-sm btn-outline-danger" data-bs-dismiss="toast">
          <span class="fa fa-times-circle-o" aria-hidden="false"></span> ` + btnFailure[1] + '</button>';
    }
    req += '</div>';
  }

  req += '</div></div>';

  return req;
}

function createNotification(type: string, title: string, msg: string, btnFailure: string[], btnSuccess: string[], progress = false, useSessionSend = true) {
  var modalHtml = createModal(type, title, msg, btnFailure, btnSuccess, progress, useSessionSend);
  var modal = $(modalHtml).insertBefore($('#notifications-footer')); 
  modal.find('[data-bs-dismiss="toast"]').removeAttr('data-bs-dismiss');  
  modal.on('click', 'button', (event) => {
    removeNotification(modal);
  });
  modal.addClass('notification'); 
  modal.addClass('notification-panel');
  $('#notifications-btn').prop('disabled', false); 
  $('#notifications-btn').parent().prop('title', 'Notifications');
  createTooltip($('#notifications-btn').parent());

  $('#notifications-number').text($('.notification:not([data-remove="true"])').length);
  $('#notifications-bubble').show();
  
  if(notificationsToggle || $('#notifications-header').attr('data-show'))
    showNotifications(modal);
}

function removeNotification(element: any) {
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

  var transformMatrix = element.css('transform');
  var matrix = transformMatrix.replace(/[^0-9\-.,]/g, '').split(',');
  var x = matrix[12] || matrix[4]; // translate x
  slideNotification(element, (x < 0 ? 'left' : 'right'));
}

function showNotifications(modals: any) {
  // If not all notifications are displayed, add a 'Show All' button to the footer
  var allShown = true;
  $('.notification').each((index, element) => {
    if(!$(element).attr('data-show') && !$(element).attr('data-remove') && modals.index($(element)) === -1) 
      allShown = false;
  });
  if(allShown) 
    $('#notifications-show-all').hide();
  else
    $('#notifications-show-all').show(); 

  if(!$('#notifications-header').attr('data-show')) {
    $('#notifications-header').attr('data-show', 'true');
    $('#notifications-header').toast('show');
    slideNotification($('#notifications-header'), 'down');
  }

  modals.each((index, element) => {
    if(!$(element).attr('data-show')) {
      $(element).attr('data-show', 'true');
      $(element).toast('show');
      slideNotification($(element), 'down');
    }
  });

  if($('.notification:not([data-remove="true"])').length > 1 && !$('#notifications-footer').attr('data-show')) {
    $('#notifications-footer').attr('data-show', 'true');
    $('#notifications-footer').toast('show');
    slideNotification($('#notifications-footer'), 'down');
  }
}

/* Perform slide transition (animation) on Notification panel */
function slideNotification(element: any, direction: 'down' | 'up' | 'left' | 'right') {
  if(direction === 'down') {
    // Set initial state before transition
    resetSlide(element);
    $('#notifications').css('opacity', '');
    $('#notifications').css('transform', '');
    $('#notifications').show();
    element.css('margin-top', -element[0].getBoundingClientRect().height);
    element.css('z-index', '-1');
    element.css('opacity', '0');
    // Trigger transition after toast is shown
    element.one('shown.bs.toast', (event) => {
      // Add transition (animation)
      $(event.target).addClass('slide-down'); 
      $(event.target).css('margin-top', '');
      $(event.target).css('z-index', '');
      $(event.target).css('opacity', '');
      $(event.target).one('transitionend', (event) => {
        $(event.target).removeClass('slide-down');
        $(event.target).height($(event.target).height()); // Fixes a layout glitch from the transition
      });
    });
  }
  else if(direction === 'up') {
    // Set initial state before transition
    element.addClass('slide-up'); 
    element.css('margin-top', -element[0].getBoundingClientRect().height);
    element.css('opacity', '0');
    element.one('transitionend', (event) => {
      if(!$(event.target).attr('data-show')) 
        $(event.target).toast('hide');
      $(event.target).removeClass('slide-up');
      $(event.target).css('opacity', '');
      $(event.target).css('margin-top', '');
    });
  }
  else if(direction === 'left' || direction === 'right') {
    // Set initial state before transition
    element.css('z-index', '-1');
    element.addClass('slide-sideways'); 
    element.css('transform', 'translateX(' + (direction === 'left' ? '-' : '') + '100%)');
    element.css('opacity', '0');
    element.one('transitionend', (event) => {
      $(event.target).removeClass('slide-sideways');
      $(event.target).toast('hide');
      $(event.target).css('z-index', ''); 
      $(event.target).css('transform', '');
      $(event.target).css('opacity', '');
    });
  }
}

function slideAllNotifications() {
  $('#notifications').children().each((index, element) => resetSlide($(element)));
  $('#notifications').addClass('slide-up'); 
  $('#notifications').css('opacity', 0);
  $('#notifications').css('transform', 'translateY(-100%)');
  $('#notifications').one('transitionend', (event) => {
    $(event.currentTarget).removeClass('slide-up');
    var shown = false;
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
function notificationMouseDown(e) {
  if(!$(e.target).is('div'))
    return;

  if($(':focus').length > 0) 
      $(':focus').trigger('blur');
  
  if(window.getSelection) 
    window.getSelection().removeAllRanges();

  $('#notifications').css('--dragX', 0);
  $('#notifications').css('--dragY', 0);
  $('#notifications').css('--opacityY', 1);   
  $('#notifications').css('--opacityX', 1);   

  var modal = $(e.target).closest('.toast');
  modal.css('transition', 'none');

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

  var swipeStart = getTouchClickCoordinates(e);
  var swipeLocked = '';
  const mouseMoveHandler = (e) => {   
    var mouse = getTouchClickCoordinates(e);
    if(swipeLocked) {
      var xMax = $('#notifications').outerWidth(true);
      var yMax = $('#notifications').outerHeight(true);
      var xOffset = Math.min(xMax, Math.max(-xMax, mouse.x - swipeStart.x));
      var yOffset = Math.min(0, mouse.y - swipeStart.y);
      $('#notifications').css('--dragX', xOffset + 'px');
      $('#notifications').css('--dragY', yOffset + 'px');
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
      else if(modal.hasClass('notification') && Math.abs(swipeStart.x - mouse.x) > 20 && Math.abs(swipeStart.x - mouse.x) > Math.abs(swipeStart.y - mouse.y)) {
        // Perform horizontal swipe
        swipeStart = mouse;
        swipeLocked = 'horizontal';
        modal.css('transform', 'translateX(var(--dragX))');
        modal.css('opacity', 'var(--opacityX)');
      }
    }
  };
  $(document).on('mousemove touchmove', mouseMoveHandler);

  $(document).one('mouseup touchend touchcancel', (e) => {
    var mouse = getTouchClickCoordinates(e);
    $('#mouse-capture-layer').remove();
    $(document).off('mousemove touchmove', mouseMoveHandler);
    if(swipeLocked === 'vertical') {
      if(swipeStart.y - mouse.y > 30 && e.type !== 'touchcancel')
        hideAllNotifications();
      else {
        $('#notifications').css('transform', '');
        $('#notifications').css('opacity', '');
      }
    }
    else if(swipeLocked === 'horizontal') {
      if(Math.abs(mouse.x - swipeStart.x) > 50 && e.type !== 'touchcancel')
        removeNotification(modal);
      else {
        modal.css('transform', '');
        modal.css('opacity', '');
      }
    }
    swipeLocked = '';
    swipeStart = null;
    modal.css('transition', '');
  });

  e.preventDefault();
}

function getTouchClickCoordinates(event: any) {
  event = (event.originalEvent || event);
  if(event.type == 'touchstart' || event.type == 'touchmove' || event.type == 'touchend' || event.type == 'touchcancel') {
      var touch = event.touches[0] || event.changedTouches[0];
      var x = touch.pageX;
      var y = touch.pageY;
  } else if (event.type == 'mousedown' || event.type == 'mouseup' || event.type == 'mousemove' || event.type == 'mouseover' || event.type=='mouseout' || event.type=='mouseenter' || event.type=='mouseleave') {
      var x = event.clientX;
      var y = event.clientY;
  }
  return {x, y};
}

function showAllNotifications() {
  showNotifications($('.notification:not([data-show="true"])'));
}

function hideAllNotifications() {
  $('#notifications').children('[data-show="true"]').each((index, element) => {
    $(element).removeAttr('data-show'); 
  });
  if($('#notifications-btn').hasClass('active'))
    $('#notifications-btn').button('toggle');
  slideAllNotifications();
}

function clearNotifications() {
  $('.notification').removeAttr('data-show'); 
  var delay = 0;
  $('.notification.show').each((index, element) => {
    setTimeout(() => removeNotification($(element)), delay);
    delay += 100;
  });
}

// Check if square is under attack. We can remove this after upgrading to latest version of chess.js, 
// since it has its own version of the function
function isAttacked(fen: string, square: string, color: string) : boolean {
  var oppositeColor = color === 'w' ? 'b' : 'w';

  // Switch to the right turn
  if(History.getTurnColorFromFEN(fen) !== color)
    fen = fen.replace(' ' + oppositeColor + ' ', ' ' + color + ' ');

  var chess = new Chess(fen);

  // Find king and replace it with a placeholder pawn
  for(const s in Chess.SQUARES) {
    var piece = chess.get(s);
    if(piece && piece.type === 'k' && piece.color === color) {
      chess.remove(s);
      chess.put({type: 'p', color: color}, s);
      break;
    }
  }

  // Place king on square we want to test and see if it's in check
  chess.remove(square);
  chess.put({type: 'k', color: color}, square);
  return chess.in_check() ? true : false;
}

export function parseMove(fen: string, move: any, category: string) {
  var chess = new Chess(fen);
  var san = '';

  // Convert algebraic coordinates to SAN for non-standard moves
  if (typeof move !== 'string') {
    if(move.from) 
      var fromPiece = chess.get(move.from);
    else 
      san = move.piece.toUpperCase() + '@' + move.to; // Crazyhouse/bughouse piece placement
    var toPiece = chess.get(move.to);

    if(fromPiece && fromPiece.type === 'k') {
      if((toPiece && toPiece.type === 'r' && toPiece.color === chess.turn())) { // Fischer random rook-castling 
        if(move.to.charCodeAt(0) - move.from.charCodeAt(0) > 0) 
          san = 'O-O';
        else 
          san = 'O-O-O';
      }
      else if(Math.abs(move.to.charCodeAt(0) - move.from.charCodeAt(0)) > 1) { // Normal castling (king moved 2 or more squares)
        if(move.to.charCodeAt(0) - move.from.charCodeAt(0) > 0) { // King moved towards the h-file
          san = (category === 'wild/fr' || move.from[0] === 'e' ? 'O-O' : 'O-O-O');
        }
        else // King moved towards the a-file
          san = (category === 'wild/fr' || move.from[0] === 'e' ? 'O-O-O' : 'O-O');
      }
    }  
    if(san)
      move = san;
  }
  else
    san = move;

  // Make standard move
  var outMove = chess.move(move);
  var outFen = chess.fen();

  // Manually update FEN for non-standard moves
  if(!outMove 
      || (category.startsWith('wild') && san.toUpperCase().startsWith('O-O'))) {
    san = san.replace(/[+#]/, ''); // remove check and checkmate, we'll add it back at the end
    chess = new Chess(fen);
    outMove = {color: color, san: san};

    var splitFen = fen.split(/\s+/);
    var board = splitFen[0];
    var color = splitFen[1];
    var castlingRights = splitFen[2];
    var enPassant = splitFen[3];
    var plyClock = splitFen[4];
    var moveNo = splitFen[5];
    
    var boardAfter = board;
    var colorAfter = (color === 'w' ? 'b' : 'w');
    var castlingRightsAfter = castlingRights;
    var enPassantAfter = '-';
    var plyClockAfter = +plyClock + 1;
    var moveNoAfter = (colorAfter === 'w' ? +moveNo + 1 : moveNo);

    if(san.includes('@')) {
      // Parse crazyhouse or bughouse piece placement
      outMove.piece = san.charAt(0).toLowerCase();
      outMove.to = san.substring(2);
      outMove.flags = 'z';
      chess.put({type: outMove.piece, color: color}, outMove.to);
      plyClockAfter = 0;
    }
    else if(san.toUpperCase() === 'O-O' || san.toUpperCase() === 'O-O-O') {
      // Parse irregular castling moves for fischer random and wild variants    
      var kingFrom = '';
      var rank = (color === 'w' ? '1' : '8');
      var files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
      var startChess = new Chess(game.history.get(0).fen);
      for(const file of files) {
        let square = file + rank;
        let piece = startChess.get(square);
        if(piece && piece.color === color && piece.type === 'r') {
          if(!leftRook)
            var leftRook = square;
          else
            var rightRook = square;   
        }

        piece = chess.get(square);
        if(piece && piece.color === color && piece.type === 'k')
          kingFrom = square;
      }

      if(san.toUpperCase() === 'O-O') {
        if(category === 'wild/fr') {
          // fischer random
          var kingTo = 'g' + rank;
          var rookFrom = rightRook;
          var rookTo = 'f' + rank;
        }
        else {
          // wild/0, wild/1 etc
          if(kingFrom[0] === 'e') {
            var kingTo = 'g' + rank;
            var rookFrom = rightRook;
            var rookTo = 'f' + rank;
          }
          else {
            var kingTo = 'b' + rank;
            var rookFrom = leftRook;
            var rookTo = 'c' + rank;
          }
        }
      }
      else if(san.toUpperCase() === 'O-O-O') {
        if(category === 'wild/fr') {
          var kingTo = 'c' + rank;
          var rookFrom = leftRook;
          var rookTo = 'd' + rank;
        }
        else {
          // wild/0, wild/1
          if(kingFrom[0] === 'e') {
            var kingTo = 'c' + rank;
            var rookFrom = leftRook;
            var rookTo = 'd' + rank;
          }
          else {
            var kingTo = 'f' + rank;
            var rookFrom = rightRook;
            var rookTo = 'e' + rank;
          }
        }
      }

      if(rookFrom === leftRook) {
        // Do we have castling rights?     
        if(!castlingRights.includes(color === 'w' ? 'Q' : 'q'))
          return null;
        outMove.flags = 'q';
      }
      else {
        if(!castlingRights.includes(color === 'w' ? 'K' : 'k'))
          return null;
        outMove.flags = 'k';
      }

      // Check castling is legal
      // Can king pass through all squares between start and end squares?
      if(kingFrom.charCodeAt(0) < kingTo.charCodeAt(0)) {
        var startCode = kingFrom.charCodeAt(0);
        var endCode = kingTo.charCodeAt(0);
      }
      else {
        var startCode = kingTo.charCodeAt(0);
        var endCode = kingFrom.charCodeAt(0);
      }
      for(let code = startCode; code <= endCode; code++) {
        var square = String.fromCharCode(code) + kingFrom[1];
        // square blocked?
        if(square !== kingFrom && square !== rookFrom && chess.get(square))
          return null;
        // square under attack?
        if(isAttacked(fen, square, color))
          return null;
      }
      // Can rook pass through all squares between start and end squares?
      if(rookFrom.charCodeAt(0) < rookTo.charCodeAt(0)) {
        var startCode = rookFrom.charCodeAt(0);
        var endCode = rookTo.charCodeAt(0);
      }
      else {
        var startCode = rookTo.charCodeAt(0);
        var endCode = rookFrom.charCodeAt(0);
      }
      for(let code = startCode; code <= endCode; code++) {
        var square = String.fromCharCode(code) + rookFrom[1];
        // square blocked?
        if(square !== rookFrom && square !== kingFrom && chess.get(square))
          return null;
      }
      
      chess.remove(kingFrom);
      chess.remove(rookFrom);
      chess.put({type: 'k', color: color}, kingTo);
      chess.put({type: 'r', color: color}, rookTo);
    
      if(color === 'w')
        castlingRightsAfter = castlingRights.replace(/[KQ]/g, '');
      else
        castlingRightsAfter = castlingRights.replace(/[kq]/g, '');
      if(castlingRightsAfter === '')
        castlingRightsAfter = '-';

      outMove.piece = 'k';
      outMove.from = kingFrom;
      outMove.to = kingTo;
    }

    boardAfter = chess.fen().split(/\s+/)[0];
    outFen = boardAfter + ' ' + colorAfter + ' ' + castlingRightsAfter + ' ' + enPassantAfter + ' ' + plyClockAfter + ' ' + moveNoAfter;
  
    chess.load(outFen);
    if(chess.in_checkmate())
      outMove.san += '#';
    else if(chess.in_check())
      outMove.san += '+';
  }

  // Post-processing on FEN after chess.move() for variants 
  if(category === 'crazyhouse' || category === 'bughouse') 
    outFen = outFen.replace(/ \d+ /, ' 0 '); // FICS doesn't use the 'irreversable moves count' for crazyhouse/bughouse, so set it to 0
  if(category.startsWith('wild')) {
    // Adjust castling rights after rook move
    var color = fen.split(/\s+/)[1];
    if(outMove.piece === 'r') {
      // Check if rook moved from starting position
      var startChess = new Chess(game.history.get(0).fen);
      var files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
      var rank = (color === 'w' ? '1' : '8');
      for(const file of files) {
        // Get starting location of rooks
        let square = file + rank;
        let piece = startChess.get(square);
        if(piece && piece.type === 'r' && piece.color === color) {
          if(!leftRook) 
            var leftRook = square;
          else 
            var rightRook = square;
        }
        // Get current location of king
        if(piece && piece.type === 'k' && piece.color === color) 
          var kingSquare = square;
      }
      if(outMove.from === leftRook)
        var leftRookMoved = true;
      if(outMove.from === rightRook)
        var rightRookMoved = true;
      
      if(leftRookMoved || rightRookMoved) {
        var castlingRights = fen.split(/\s+/)[2];

        if(leftRookMoved)
          var castlingRightsAfter = castlingRights.replace((color === 'w' ? 'Q' : 'q'), '');
        else
          var castlingRightsAfter = castlingRights.replace((color === 'w' ? 'K' : 'k'), '');

        if(!castlingRightsAfter)
          castlingRightsAfter = '-';

        var castlingRightsBefore = outFen.split(/\s+/)[2];
        outFen = outFen.replace(' ' + castlingRightsBefore + ' ', ' ' + castlingRightsAfter + ' ');
      }
    }
  }

  return {fen: outFen, move: outMove};
}

export function parseMovelist(movelist: string) {
  const moves = [];
  let found : string[] & { index?: number } = [''];
  let n = 1;
  var wtime = game.time * 60;
  var btime = game.time * 60;

  // We've set 'iset startpos 1' so that the 'moves' command also returns the start position in style12 in cases 
  // where the start position is non-standard, e.g. fischer random. 
  var match = movelist.match(/^<12>.*/m);
  if(match) {
    // FICS sets the role parameter (my relation to this game) in the style12 to -4, which the parser
    // doesn't parse by default, since we want it to be parsed together with the movelist. 
    // Change the role to -3 so it won't get ignored by the parser this time.
    let s = match[0].replace(/(<12> (\S+\s){18})([-\d]+)/, '$1-3');         
    let startpos = session.getParser().parse(s);
    var chess = Chess(startpos.fen);  
  }
  else
    var chess = Chess(); 

  game.history.reset(chess.fen(), wtime, btime);
  while (found !== null) {
    found = movelist.match(new RegExp(n + '\\.\\s*(\\S*)\\s*\\((\\d+):(\\d+)\\)\\s*(?:(\\S*)\\s*\\((\\d+):(\\d+)\\))?.*', 'm'));
    if (found !== null && found.length > 3) {
      const m1 = found[1].trim();
      if(m1 !== '...') {
        wtime += (n === 1 ? 0 : game.inc) - (+found[2] * 60 + +found[3]);
        var parsedMove = parseMove(chess.fen(), m1, game.category);
        if(!parsedMove)
          break;
        chess.load(parsedMove.fen);
        game.history.add(parsedMove.move, parsedMove.fen, false, wtime, btime);
      }
      if (found.length > 4 && found[4]) {
        const m2 = found[4].trim();
        btime += (n === 1 ? 0 : game.inc) - (+found[5] * 60 + +found[6]);
        parsedMove = parseMove(chess.fen(), m2, game.category);
        if(!parsedMove)
          break;
        chess.load(parsedMove.fen);
        game.history.add(parsedMove.move, parsedMove.fen, false, wtime, btime);
      }
      n++;
    }
  }
  if(game.isExamining() && game.history.length())
    session.send('back 999');
  else
    game.history.display();
}

function messageHandler(data) {
  if (data === undefined || data === null) {
    return;
  }

  const type = GetMessageType(data);
  switch (type) {
    case MessageType.Control:
      if (!session.isConnected() && data.command === 1) {
        cleanup();
        disableOnlineInputs(false);
        session.setUser(data.control);
        if (!chat) {
          chat = new Chat(data.control);
        }
        chat.setUser(data.control);
        session.send('set seek 0');
        session.send('set echo 1');
        session.send('set style 12');
        session.send('set interface www.freechess.club');
        session.send('iset defprompt 1'); // Force default prompt. Used for splitting up messages
        session.send('iset nowrap 1'); // Stop chat messages wrapping which was causing spaces to get removed erroneously
        session.send('iset pendinfo 1'); // Receive detailed match request info (both that we send and receive)
        session.send('=ch');
        channelListRequested = true;
        session.send('=computer'); // get Computers list, to augment names in Observe panel
        computerListRequested = true;

        if($('#pills-observe').hasClass('active'))
          initObservePane();
        else if($('#pills-examine').hasClass('active'))
          initExaminePane();
        else if($('#pills-play').hasClass('active') && $('#pills-lobby').hasClass('active'))
          initLobbyPane();

      } else if (data.command === 2) {
        session.disconnect();
        showModal('Authentication Failure', '', data.control, [], []);
      }
      break;
    case MessageType.ChannelTell:
      chat.newMessage(data.channel, data);
      break;
    case MessageType.PrivateTell:
      chat.newMessage(data.user, data);
      break;
    case MessageType.GameMove:
      // Check we are not examining/observing another game already
      if((game.isExamining() || game.isObserving()) && game.id !== data.id) {
        if(game.isExamining())
          session.send('unex');
        else if(game.isObserving()) 
          session.send('unobs ' + game.id);
        gameChangePending = true;
        break;
      }

      Object.assign(game, data);
      const amIblack = game.bname === session.getUser();
      const amIwhite = game.wname === session.getUser();

      if (game.chess === null) {
        game.chess = new Chess();
        game.wclock = game.bclock = null;
        hidePromotionPanel();
        board.cancelMove();

        if (!amIblack || amIwhite) {
          game.color = 'w';
          $('#player-name').text(game.wname);
          $('#opponent-name').text(game.bname);
        } else {
          game.color = 'b';
          $('#player-name').text(game.bname);
          $('#opponent-name').text(game.wname);
        }       

        var flipped = $('#opponent-status').parent().hasClass('bottom-panel');
        board.set({
          orientation: ((game.color === 'b') === flipped ? 'white' : 'black'),
        });

        // Check if server flip variable is set and flip board if necessary
        if(game.isPlaying())
          var v_flip = (game.color === 'b') !== game.flip; 
        else 
          var v_flip = game.flip;

        if(v_flip != flipped)
          flipBoard();

        $('#exit-subvariation').hide();
        $('#player-captured').text('');
        $('#opponent-captured').text('');
        $('#player-status').css('background-color', '');
        $('#opponent-status').css('background-color', '');

        if(game.isPlaying() || game.isExamining()) {
          clearMatchRequests();
          session.send('allobs ' + game.id);
          if(game.isPlaying()) {
            game.watchers = setInterval(() => {
              const time = game.color === 'b' ? game.btime : game.wtime;
              if (time > 60) {
                session.send('allobs ' + game.id);
              }
            }, 90000); // 90000 seems a bit slow
          }
          else {
            game.watchers = setInterval(() => {
              session.send('allobs ' + game.id);
            }, 5000);
          }
        }

        if(evalEngine) {
          evalEngine.terminate();
          evalEngine = null;
        }

        game.history = new History(game.fen, board, game.time * 60, game.time * 60);
        updateBoard();

        // Adjust settings for game category (variant)
        // When examining we do this after requesting the movelist (since the category is told to us by the 'moves' command)
        if(game.isPlaying() || game.isObserving())
          initCategory();

        if (game.role === Role.NONE || game.isObserving() || game.isExamining()) {
          if(game.isExamining() || game.isObserving()) {      
            if(!isSmallWindow())
              showCloseGamePanel();
            
            if(game.isExamining()) {
              showButton($('#stop-examining'));
              if(game.wname === game.bname)
                game.history.scratch(true);
              else {
                if(getPlyFromFEN(game.fen) !== 1)
                  session.send('back 999');
                session.send('for 999');
              }
            }
            else if(game.isObserving()) 
              showButton($('#stop-observing'));

            movelistRequested++;
            session.send('iset startpos 1'); // Show the initial board position before the moves list 
            session.send('moves ' + game.id);
            session.send('iset startpos 0');
          }

          $('#playing-game').hide();

          // Show analysis buttons
          $('#playing-game-buttons').hide();
          $('#viewing-game-buttons').show();
        }
        showTab($('#pills-game-tab'));
        showStatusPanel();
        scrollToBoard();
      }

      if (data.role === Role.NONE || data.role >= -2) {
        const lastPly = getPlyFromFEN(game.chess.fen());
        const thisPly = getPlyFromFEN(data.fen);

        if (data.move !== 'none' && thisPly === lastPly + 1) { // make sure the move no is right
          var parsedMove = parseMove(game.chess.fen(), data.move, game.category);
          game.chess.load(data.fen);
          movePieceAfter((parsedMove ? parsedMove.move : {san: data.move}));
        }
        else {
          game.chess.load(data.fen);
          updateHistory();
        }

        if (game.isPlaying() || data.role === Role.OBSERVING) {
          if(thisPly >= 2 && !game.wclock)
            game.wclock = clock.startWhiteClock(game);
          if(thisPly >= 3 && !game.bclock) 
            game.bclock = clock.startBlackClock(game);
        }
      }
      break;
    case MessageType.GameStart:
      $('#viewing-game-buttons').hide();
      $('#playing-game').hide();
      $('#playing-game-buttons').show();
      if (data.player_one === session.getUser()) {
        chat.createTab(data.player_two);
      } else {
        chat.createTab(data.player_one);
      }
      if (soundToggle) {
        Sounds.startSound.play();
      }
      break;
    case MessageType.GameEnd:
      if (data.reason <= 4 && $('#player-name').text() === data.winner) {
        // player won
        $('#player-status').css('background-color', '#d4f9d9');
        $('#opponent-status').css('background-color', '#f9d4d4');
        if (soundToggle) {
          Sounds.winSound.play();
        }
      } else if (data.reason <= 4 && $('#player-name').text() === data.loser) {
        // opponent won
        $('#player-status').css('background-color', '#f9d4d4');
        $('#opponent-status').css('background-color', '#d4f9d9');
        if (soundToggle) {
          Sounds.loseSound.play();
        }
      } else {
        // tie
        $('#player-status').css('background-color', '#fcddae');
        $('#opponent-status').css('background-color', '#fcddae');
      }

      showStatusMsg(data.message);
      let rematch = [];
      if ($('#player-name').text() === session.getUser()
        && data.reason !== 2 && data.reason !== 7) {
        rematch = ['rematch', 'Rematch']
      }
      showModal('Match Result', '', data.message, rematch, []);
      cleanupGame();
      break;
    case MessageType.Unknown:
    default:
      // const msg = data.message.replace(/\n/g, ''); // Not sure this is a good idea. Newlines provide
      // useful information for parsing. For example, to
      // prevent other people injecting commands into messages
      // somehow
      const msg = data.message;

      // For takebacks, board was already updated when new move received and
      // updating the history is now done more generally in updateHistory().
      let match = msg.match(/(\w+) (\w+) the takeback request\./);
      if (match !== null && match.length > 1)
        return;
      match = msg.match(/You (\w+) the takeback request from (\w+)\./);
      if (match !== null && match.length > 1)
        return;

      match = msg.match(/(?:Observing|Examining)\s+(\d+) [\(\[].+[\)\]]: (.+) \(\d+ users?\)/);
      if (match != null && match.length > 1) {
        $('#game-watchers').empty();
        if (+match[1] === game.id) {
          match[2] = match[2].replace(/\(U\)/g, '');
          const watchers = match[2].split(' ');
          let req = '';
          let numWatchers = 0;
          for (let i = 0; i < watchers.length; i++) {
            if(watchers[i].replace('#', '') === session.getUser())
              continue;
            numWatchers++;
            if(numWatchers == 1)
              req = 'Watchers:';
            req += '<span class="ms-1 badge rounded-pill bg-secondary noselect">' + watchers[i] + '</span>';
            if (numWatchers > 5) {
              req += ' + ' + (watchers.length - i) + ' more.';
              break;
            }
          }
          $('#game-watchers').html(req);
        }
        return;
      }

      match = msg.match(/(\w+) would like to take back (\d+) half move\(s\)\./);
      if (match != null && match.length > 1) {
        if (match[1] === $('#opponent-name').text()) {
          showModal('Takeback Request', match[1], 'would like to take back ' + match[2] + ' half move(s).',
            ['decline', 'Decline'], ['accept', 'Accept']);
        }
        return;
      }

      match = msg.match(/.*\d+\s[0-9\+]+\s\w+\s+[0-9\+]+\s\w+\s+\[[\w\s]+\]\s+[\d:]+\s*\-\s*[\d:]+\s\(\s*\d+\-\s*\d+\)\s+[BW]:\s+\d+\s*\d+ games displayed./g);
      if (match != null && match.length > 0 && gamesRequested) {
        showGames(msg);
        gamesRequested = false;
        return;
      }

      match = msg.match(/^History for (\w+):.*/m);
      if (match != null && match.length > 1) {
        if (historyRequested) {
          historyRequested--;
          if(!historyRequested) {
            $('#examine-username').val(match[1]);
            showHistory(match[1], data.message);
          }
        }
        else
          chat.newMessage('console', data);

        return;
      }

      match = msg.match(/^(There is no player matching the name (\w+)\.)/m);
      if(!match)
        match = msg.match(/^('(\S+(?='))' is not a valid handle\.)/m);
      if(!match)
        match = msg.match(/^((\w+) has no history games\.)/m);
      if(!match)
        match = msg.match(/^(You need to specify at least two characters of the name\.)/m);
      if(!match)
        match = msg.match(/^(Ambiguous name ([^s:]+):)/m);
      if(!match)
        match = msg.match(/^((\w+) is not logged in\.)/m);
      if(!match)
        match = msg.match(/^((\w+) is not playing a game\.)/m);
      if(!match)
        match = msg.match(/^(Sorry, game \d+ is a private game\.)/m);
      if(!match)
        match = msg.match(/^((\w+) is playing a game\.)/m);
      if(!match)
        match = msg.match(/^((\w+) is examining a game\.)/m);
      if(!match)
        match = msg.match(/^(You can't match yourself\.)/m);
      if(!match)
        match = msg.match(/^(You cannot challenge while you are (?:examining|playing) a game\.)/m);
      if(!match) 
        match = msg.match(/^(You are already offering an identical match to \w+\.)/m);
      if(!match)
        match = msg.match(/^(You can only have 3 active seeks\.)/m);
      if(!match) 
        match = msg.match(/^(There is no such game\.)/m);
      if(match !== null) {
        if(historyRequested || obsRequested || matchRequested) {
          let user = '';
          let status;
          if(historyRequested) {
            user = getValue('#examine-username');
            status = $('#examine-pane-status');
          }
          else if(obsRequested) {
            user = getValue('#observe-username');
            status = $('#observe-pane-status');
          }
          else if(matchRequested) {
            user = getValue('#opponent-player-name');
            status = $('#pairing-pane-status');
          }

          if(match.length >= 2) {
            if(historyRequested) {
              historyRequested--;
              if(historyRequested)
                return;

              $('#history-table').html('');
            }
            else if(obsRequested) {
              obsRequested--;
              if(obsRequested)
                return;
            }
            else if(matchRequested) {
              matchRequested--;
              if(!matchRequested) {
                session.send('iset seekinfo 0');
                session.send('iset showownseek 0');  
              }
            }

            status.show();
            if(match[1].startsWith('Ambiguous name'))
              status.text('There is no player matching the name ' + user + '.');
            else
              status.text(match[1]);

            return;
          }
        }
        chat.newMessage('console', data);
        return;
      }

      match = msg.match(/^You are now observing game \d+\./m);
      if(match) {
        if(obsRequested) {
          obsRequested--;
          $('#observe-pane-status').hide();
        }

        chat.newMessage('console', data);
        return;
      }

      match = msg.match(/^(Issuing match request since the seek was set to )(manual\.)/m);
      if(match && match.length > 2 && lobbyRequested) {
        $('#lobby-pane-status').html(match[1] + 
          `<span style="white-space: nowrap">` + match[2] + `<span class="fa fa-times-circle btn btn-default btn-sm" onclick="withdrawAll()" aria-hidden="false"></span></span>`); 
        $('#lobby-pane-status').show();
      }

      if(/^\<(?:sn|pt)\>.*/m.test(msg) && matchRequested) {
        var newRequest = false;
        match = msg.match(/^\<sn\>.*/m);
        if(match) {
          var seeks = parseSeeks(match.join('\n'));
          seeks.forEach((value, key) => {
            value = value.substring(value.indexOf(' ') + 1); 
            if(matchRequests.get(key) !== value) {
              newRequest = true;
              matchRequested--;
              matchRequests.set(key, value);   
            }       
          });
        }
        match = msg.match(/^\<pt\>.*/m);
        if(match) {
          var pending = parsePending(match.join('\n'));
          pending.forEach((pValue, pKey) => {
            if(matchRequests.get(pKey) !== pValue) {
              newRequest = true;
              var opponent = pValue.split(/s+/)[0];
              matchRequests.forEach((mValue, mKey) => {
                if(opponent === mValue.split(/s+/)[0])
                  matchRequests.delete(mKey);
              });
              matchRequested--;
              matchRequests.set(pKey, pValue);   
            }     
          });
        }
        if(!matchRequested) {
          session.send('iset seekinfo 0');
          session.send('iset showownseek 0');
        }
        if(newRequest) {
          clearTimeout(showMatchTimer);
          showMatchTimer = setTimeout(() => showMatchRequests(), 1000);
        }
        $('#pairing-pane-status').hide();
        return;
      }
          
      if(/^\<(s|sc|sr)\>/m.test(msg)) {
        if(lobbyRequested) {
          parseSeeks(msg, seekMap);
          $('#lobby-table').html('');
          seekMap.forEach((value, key) => {
            if(!lobbyShowComputersToggle && value.includes('(C)'))
              return;

            $('#lobby-table').append(
              `<button type="button" class="btn btn-outline-secondary" onclick="acceptSeek(` 
                + key + `);">` + value + `</button>`);
          });
        }
        return;
      }

      match = msg.match(/^Your seeks have been removed\./m);
      if(!match) 
        match = msg.match(/^Your seek (\d+) has been removed\./m);
      if(!match)
        match = msg.match(/^You withdraw the match offer to (\w+)\./m);
      if(match) {
        if(match.length > 1) {
          if(isNaN(match[1])) { // delete match offer by opponent name
            matchRequests.forEach((value, key) => {
              if(value.split(/\s+/)[0] === match[1]) // First word matches opponent name
                matchRequests.delete(key);
            });
          }
          else // delete seek by id
            matchRequests.delete(match[1]);
        }
        else { // Remove all seeks
          matchRequests.forEach((value, key) => {
            if(!isNaN(value.split(/\s+/)[0])) // First word is not opponent, therefore it's a seek
              matchRequests.delete(key);
          });
        }

        showMatchRequests();

        chat.newMessage('console', data);
        return;
      }
     
      match = msg.match(/(?:^|\n)\s*Movelist for game (\d+):\s+(\w+) \((\d+|UNR)\) vs\. (\w+) \((\d+|UNR)\)[^\n]+\s+(\w+) (\S+) match, initial time: (\d+) minutes, increment: (\d+) seconds\./);
      if (match != null && match.length > 9) {
        if (+match[1] === game.id && movelistRequested) {
          movelistRequested--;
          if(movelistRequested)
            return;

          if(game.isExamining()) {
            var wname = match[2];
            var wrating = game.wrating = match[3];
            var bname = match[4];
            var brating = game.brating = match[5];
            var rated = match[6].toLowerCase();
            game.category = match[7];
            var initialTime = match[8];
            var increment = match[9];
    
            if(wrating === 'UNR') {
              game.wrating = '';
              match = wname.match(/Guest[A-Z]{4}/);
              if(match)
                wrating = '++++';
              else wrating = '----';
            }
            if(brating === 'UNR') {
              game.brating = '';
              match = bname.match(/Guest[A-Z]{4}/);
              if(match)
                brating = '++++';
              else brating = '----';
            }

            $('#player-rating').text(bname === session.getUser() ? game.brating : game.wrating);
            $('#opponent-rating').text(bname === session.getUser() ? game.wrating : game.brating);
    
            let time = ' ' + initialTime + ' ' + increment;
            if(initialTime === '0' && increment === '0')
              time = '';
    
            const statusMsg = wname + ' (' + wrating + ') ' + bname + ' (' + brating + ') '
              + rated + ' ' + game.category + time;

            showStatusMsg(statusMsg);
            initCategory();
          }

          parseMovelist(msg);
          return;          
        }
        else {
          chat.newMessage('console', data);
          return;
        }
      }
  
      match = msg.match(/(Creating|Game\s(\d+)): (\w+) \(([\d\+\-\s]+)\) (\w+) \(([\d\-\+\s]+)\) \S+ (\S+).+/);
      if (match != null && match.length > 7) {
        game.wrating = (isNaN(match[4]) || match[4] === '0') ? '' : match[4];
        game.brating = (isNaN(match[6]) || match[6] === '0') ? '' : match[6];
        game.category = match[7];
        showStatusMsg(match[0].substring(match[0].indexOf(':')+1));
        if (match[3] === session.getUser() || match[1].startsWith('Game')) {
          if (game.id === 0) {
            game.id = +match[2];
          }
          $('#player-rating').text(game.wrating);
          $('#opponent-rating').text(game.brating);
        } else if (match[5] === session.getUser()) {
          $('#opponent-rating').text(game.wrating);
          $('#player-rating').text(game.brating);
        }
        return;
      }

      // Match request received from another player
      match = msg.match(/^\<pf\> (\d+) \S+ \S+ p=(\S+) (\S+)(?: (\[(?:black|white)\]))? \S+ \S+ (.+)/m); 
      if(match) {
        var id = match[1];
        var opponentName = match[2];
        var opponentRating = match[3];
        var color = match[4];
        var details = match[5];

        var bodyTitle = opponentName + opponentRating + (color ? ' ' + color : '');
        var found = false;
        $('.notification').each((index, element) => {
          var headerTextElement = $(element).find('.header-text');
          var bodyTextElement = $(element).find('.body-text');
          if(headerTextElement.text() === 'Match Request' && bodyTextElement.text().startsWith(opponentName + '(')) {
            bodyTextElement.text(bodyTitle + ' ' + details);
            var btnSuccess = $(element).find('.button-success');
            var btnFailure = $(element).find('.button-failure');
            btnSuccess.attr('onclick', `sessionSend('accept ` + id + `');`);
            btnFailure.attr('onclick', `sessionSend('decline ` + id + `');`);
            found = true;
          }
        });
        if(!found)
          createNotification('Match Request', bodyTitle, details, ['decline ' + id, 'Decline'], ['accept ' + id, 'Accept']);
        return;
      }
      if(/^Challenge:/m.test(msg)) // Ignore challenge messages. Using <pf> instead
        return;

      match = msg.match(/^(\w+) withdraws the match offer\./m);
      if (match != null && match.length > 1) {
        $('.notification').each((index, element) => {
          var headerTextElement = $(element).find('.header-text');
          var bodyTextElement = $(element).find('.body-text');
          if(headerTextElement.text() === 'Match Request' && bodyTextElement.text().startsWith(match[1] + '('))
            removeNotification($(element));
        });
        return;
      }
      if(/^\<pr\>/m.test(msg)) // Ignore <pr> pendinfo messages (match request removed) 
        return;

      match = msg.match(/(\w+) would like to abort the game; type "abort" to accept./);
      if (match != null && match.length > 1) {
        if (match[1] === $('#opponent-name').text()) {
          showModal('Abort Request', match[1], 'would like to abort the game.',
            ['decline', 'Decline'], ['accept', 'Accept']);
        }
        return;
      }

      match = msg.match(/(\w+) offers you a draw./);
      if (match != null && match.length > 1) {
        if (match[1] === $('#opponent-name').text()) {
          showModal('Draw Request', match[1], 'offers you a draw.',
            ['decline', 'Decline'], ['accept', 'Accept']);
        }
        return;
      }

      match = msg.match(/Removing game (\d+) from observation list./);
      if (match != null && match.length > 1) {
        if(gameChangePending)
          session.send('refresh');

        stopEngine();
        cleanupGame();
        return;
      }

      match = msg.match(/You are no longer examining game (\d+)./);
      if (match != null && match.length > 1) {
        if(gameChangePending)
          session.send('refresh');
        stopEngine();
        cleanupGame();
        return;
      }

      match = msg.match(/^Notification: .*/m);
      if(!match)
        match = msg.match(/^\w+ is not logged in./m);
      if(!match)
        match = msg.match(/^Player [a-zA-Z\"]+ is censoring you./m);
      if(!match)
        match = msg.match(/^Sorry the message is too long./m);
      if(!match)
        match = msg.match(/^You are muted./m);
      if(match && match.length > 0) {
        chat.newNotification(match[0]);
        return;
      }

      match = msg.match(/-- channel list: \d+ channels --([\d\s]*)/);
      if (match !== null && match.length > 1) {
        if(!channelListRequested) 
          chat.newMessage('console', data);

        channelListRequested = false;
        return chat.addChannels(match[1].split(/\s+/));
      }
      
      match = msg.match(/-- computer list: \d+ names --([\w\s]*)/);
      if (match !== null && match.length > 1) {
        if(!computerListRequested) 
          chat.newMessage('console', data);

        computerListRequested = false;
        computerList = match[1].split(/\s+/);
        return; 
      }

      match = msg.match(/^\[\d+\] (?:added to|removed from) your channel list\./m);
      if (match != null && match.length > 0) {
        session.send('=ch');
        channelListRequested = true;
        chat.newMessage('console', data);
        return;
      }

      // Suppress messages when 'moves' command issued internally
      match = msg.match(/^You're at the (?:beginning|end) of the game\./m);
      if(match && movelistRequested)
        return;

      // Moving backwards and forwards is now handled more generally by updateHistory()
      match = msg.match(/Game\s\d+: \w+ backs up (\d+) moves?\./);
      if (match != null && match.length > 1)
        return;
      match = msg.match(/Game\s\d+: \w+ goes forward (\d+) moves?\./);
      if (match != null && match.length > 1)
        return;

      if (
        msg === 'Style 12 set.' ||
        msg === 'You will not see seek ads.' ||
        msg === 'You will now hear communications echoed.' ||
        msg === 'seekinfo unset.' ||
        msg === 'seekremove set.' || msg === 'seekremove unset.' || 
        msg === 'defprompt set.' ||
        msg === 'nowrap set.' ||
        msg === 'startpos set.' || msg === 'startpos unset.' ||
        msg === 'showownseek set.' || msg === 'showownseek unset.' ||
        msg === 'pendinfo set.' || 
        msg.startsWith('No one is observing game ') 
      ) {
        return;
      }

      chat.newMessage('console', data);
      break;
  }
}

function showMatchRequests() {
  $('#matches-status').hide();
  let requestsHtml = '';
  matchRequests.forEach((value, key) => {
    requestsHtml += '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>&nbsp;&nbsp;'
    
    var words = value.split(/\s+/);
    if(isNaN(words[0])) {
      var opponent = words[0];
      words.splice(0, 1);
    }
    words.splice(2, 1); // remove rated/unrated
    // Change 0 0 to 'untimed'
    if(words[0] === '0' && words[1] === '0') {
      if(words[2] !== 'untimed') 
        words.splice(0, 2, 'untimed');
      else
        words.splice(0, 2);
    }

    if(opponent) {
      requestsHtml += 'Challenging ' + opponent + ' to ' + (words[0] === 'untimed' ? 'an ' : 'a ') + words.join(' ') + ' ';
      var removeCmd = 'withdraw ' + key;
    }
    else {
      requestsHtml += 'Seeking ' + (words[0] === 'untimed' ? 'an ' : 'a ') + words.join(' ') + ' ';
      var removeCmd = 'unseek ' + key;
    }

    requestsHtml += `<span style="white-space: nowrap">game.<span class="fa fa-times-circle btn btn-default btn-sm" onclick="sessionSend('` + removeCmd + `')" aria-hidden="false"></span></span><br>`;
  });
  if(matchRequests.size > 0) {
    $('#matches-status').html(requestsHtml);
    $('#matches-status').show();
  }
}

export function scrollToBoard() {
  if(isSmallWindow())
    $(document).scrollTop($('#right-panel-header').offset().top + $('#right-panel-header').outerHeight() - $(window).height());
}

function scrollToLeftPanelBottom() {
  if(isSmallWindow())
    $(document).scrollTop($('#left-panel-bottom').offset().top);
}

function scrollToTop() {
  if(isSmallWindow())
    $(document).scrollTop($('#left-panel-header').offset().top);
}

function getPlyFromFEN(fen: string) {
  const turn_color = fen.split(/\s+/)[1];
  const move_no = +fen.split(/\s+/).pop();
  const ply = move_no * 2 - (turn_color === 'w' ? 1 : 0);

  return ply;
}

function showStrengthDiff(fen: string) {
  var whiteChanged = false;
  var blackChanged = false;

  const diff = {
    P: 0, R: 0, B: 0, N: 0, Q: 0, K: 0
  };

  const pos = fen.split(/\s+/)[0];
  for(let i = 0; i < pos.length; i++) {
    if(diff.hasOwnProperty(pos[i].toUpperCase()))
      diff[pos[i].toUpperCase()] = diff[pos[i].toUpperCase()] + (pos[i] === pos[i].toUpperCase() ? 1 : -1);
  }

  if(prevDiff !== undefined) {
    for(let key in diff) {
      if(prevDiff[key] != diff[key]) {
        if(prevDiff[key] > 0 || diff[key] > 0)
          whiteChanged = true;
        if(prevDiff[key] < 0 || diff[key] < 0) 
          blackChanged = true;
      }
    }

  }
  prevDiff = diff;

  if(whiteChanged) {
    let panel = (game.color === 'w' ? $('#player-captured') : $('#opponent-captured'));   
    panel.empty();
  }
  if(blackChanged) {
    let panel = (game.color === 'b' ? $('#player-captured') : $('#opponent-captured'));   
    panel.empty();
  } 

  for (const key in diff) {
    let piece = '';
    let strength = 0;
    let panel = undefined;
    if (whiteChanged && diff[key] > 0) {
      piece = 'b' + key;
      strength = diff[key];
      panel = (game.color === 'w' ? $('#player-captured') : $('#opponent-captured'));
    }
    else if(blackChanged && diff[key] < 0) {
      piece = 'w' + key;
      strength = -diff[key];
      panel = (game.color === 'b' ? $('#player-captured') : $('#opponent-captured'));
    }
    if(panel) {
      panel.append(
        '<img id="' + piece + '" src="assets/css/images/pieces/merida/' +
          piece + '.svg"/><small>' + strength + '</small>');
    }
  }
}

function updateHistory(move?: any, fen?: string) {
  // This is to allow multiple fast 'forward' or 'back' button presses in examine mode before the command reaches the server
  // bufferedHistoryIndex contains a temporary index of the current move which is used for subsequent forward/back button presses
  if(bufferedHistoryCount)
    bufferedHistoryCount--;
  
  if(!fen) 
    fen = game.chess.fen();

  const index = game.history.find(fen);

  if(index === undefined) {
    if(move) {
      var subvariation = false;

      if(game.role === Role.NONE || game.isExamining()) {
        if(game.history.length() === 0)
          game.history.scratch(true);

        var subvariation = !game.history.scratch();
        if(subvariation)
          $('#exit-subvariation').show();
      }

      game.history.add(move, fen, subvariation, game.wtime, game.btime);
      $('#playing-game').hide();
    }
    else if(!movelistRequested) { 
      // move not found, request move list
      movelistRequested++;
      session.send('iset startpos 1'); // Show the initial board position before the moves list 
      session.send('moves ' + game.id);
      session.send('iset startpos 0');
    }
  }
  else {
    if(!movelistRequested && game.role !== Role.NONE) 
      game.history.setClockTimes(index, game.wtime, game.btime);

    // move is already displayed
    if(index === game.history.index()) {
      updateClocks();
      return;
    }

    // move is earlier, we need to take-back
    if(game.isPlaying() || game.isObserving()) {
      if(index < game.history.length())
        board.cancelPremove();
      while(index < game.history.length())
        game.history.removeLast();
    }
  }

  game.history.display(index, move !== undefined);

  if(removeSubvariationRequested && !game.history.get(index).subvariation) {
    game.history.removeSubvariation();
    $('#exit-subvariation').hide();
    removeSubvariationRequested = false;
  }
}

function updateClocks() {
  if(game.role === Role.NONE || game.role >= -2) {
    if((!game.isPlaying() && game.role !== Role.OBSERVING) ||
          game.history.index() === game.history.length()) {
      clock.updateWhiteClock(game, game.history.get().wtime);
      clock.updateBlackClock(game, game.history.get().btime);
    }
  }
}

export function updateBoard(playSound = false) {
  const move = game.history.get().move;
  const fen = game.history.get().fen;

  updateClocks();

  board.set({ fen });

  if($('#promotion-panel').is(':visible')) {
    board.cancelPremove();
    hidePromotionPanel();
  }

  const localChess = new Chess(fen);

  if(move && move.from && move.to) 
    board.set({ lastMove: [move.from, move.to] });
  else if(move && move.to)
    board.set({ lastMove: [move.to] });
  else
    board.set({ lastMove: false });

  let dests : Map<Key, Key[]> | undefined;
  let movableColor : string | undefined;
  let turnColor : string | undefined;

  if(game.isObserving()) {
    turnColor = toColor(game.chess);
  }
  else if(game.isPlaying()) {
    movableColor = (game.color === 'w' ? 'white' : 'black');
    dests = toDests(game.chess);
    turnColor = toColor(game.chess);
  }
  else {
    movableColor = toColor(localChess);
    dests = toDests(localChess);
    turnColor = toColor(localChess);
  }

  let movable : any = {};
  movable = {
    color: movableColor,
    dests,
    rookCastle: game.category === 'wild/fr'
  };

  board.set({
    turnColor,
    movable,
    check: localChess.in_check() ? toColor(localChess) : false,
    blockTouchScroll: (game.isPlaying() ? true : false),
  });

  showStrengthDiff(fen);

  if(playSound && soundToggle) {
    clearTimeout(soundTimer);
    soundTimer = setTimeout(() => {
      const entry = game.history.get();
      const chess = new Chess(entry.fen);
      if(chess.in_check()) {
        Sounds.checkSound.pause();
        Sounds.checkSound.currentTime = 0;
        Sounds.checkSound.play();
      }
      else if(entry.move.captured) {
        Sounds.captureSound.pause();
        Sounds.captureSound.currentTime = 0;
        Sounds.captureSound.play();
      }
      else {
        Sounds.moveSound.pause();
        Sounds.moveSound.currentTime = 0;
        Sounds.moveSound.play();
      }
    }, 50);
  }

  // create new imstance of Stockfish for each move, since waiting for new position/go commands is very slow (with current SF build)
  if(engine != null) {
    stopEngine();
    startEngine();
  }
  if(evalEngine)
    evalEngine.evaluate();
}

function startEngine() {
  if(Engine.categorySupported(game.category)) {
    $('#start-engine').text('Stop');

    $('#engine-pvs').empty();
    for(let i = 0; i < numPVs; i++)
      $('#engine-pvs').append('<li>&nbsp;</li>');

    engine = new Engine(board, game.category, numPVs);
    if(!movelistRequested)
      engine.move(game.history.get().fen);
    else
      engine.move(game.fen);
  }
}

function stopEngine() {
  $('#start-engine').text('Go');

  if(engine) {
    engine.terminate();
    engine = null;
    board.setAutoShapes([]);
  }
}

function hideAnalysis() {
  stopEngine();
  closeLeftBottomTab($('#engine-tab'));
  closeLeftBottomTab($('#eval-graph-tab'));
  showAnalyzeButton();
}

function showAnalyzeButton() { 
  if($('#left-panel-bottom').is(':visible')) {
    $('#show-status-panel').text('Analyze');
    $('#show-status-panel').attr('title', 'Analyze Game');
  }  

  if(!$('#engine-tab').is(':visible') && Engine.categorySupported(game.category))
    $('#show-status-panel').show();
  else if($('#left-panel-bottom').is(':visible'))
    $('#show-status-panel').hide();
}

function showAnalysis() {
  openLeftBottomTab($('#engine-tab'));
  openLeftBottomTab($('#eval-graph-tab'));
  $('#engine-pvs').empty();
  for(let i = 0; i < numPVs; i++)
    $('#engine-pvs').append('<li>&nbsp;</li>');
  $('#engine-pvs').css('white-space', (numPVs === 1 ? 'normal' : 'nowrap'));
  if(evalEngine)
    evalEngine.evaluate();
}

function closeLeftBottomTab(tab: any) {
  $('#status-tab').tab('show');
  tab.parent().hide();
  if($('#left-bottom-tabs li:visible').length === 1)
    $('#left-bottom-tabs').css('visibility', 'hidden');
}

function openLeftBottomTab(tab: any) {
  tab.parent().show();
  $('#left-bottom-tabs').css('visibility', 'visible');
  tab.tab('show');
}

function getMoves() {
  let moves = '';
  const history = game.chess.history({verbose: true});
  for (let i = 0; i < history.length; ++i) {
    const move = history[i];
    moves += ' ' + move.from + move.to + (move.promotion ? move.promotion : '');
  }
  return moves;
}

function getMoveNoFromFEN(fen: string) {
  return +fen.split(/\s+/).pop();
}

$('#collapse-history').on('hidden.bs.collapse', (event) => {
  $('#history-toggle-icon').removeClass('fa-toggle-up').addClass('fa-toggle-down');

  activeTab = $('#pills-tab button').filter('.active');
  activeTab.removeClass('active');
  activeTab.parent('li').removeClass('active');
  $(activeTab.attr('data-bs-target')).removeClass('active');

  $('#collapse-history').removeClass('collapse-init');
});

$('#collapse-history').on('show.bs.collapse', (event) => {
  $('#history-toggle-icon').removeClass('fa-toggle-down').addClass('fa-toggle-up');
  scrollToTop();
  activeTab.tab('show');
});

$('#pills-tab button').on('click', function(event) {
  activeTab = $(this);
  $('#collapse-history').collapse('show');
  scrollToTop();
});

$('#flip-toggle').on('click', (event) => {
  flipBoard();
});

function flipBoard() {
  board.toggleOrientation();

  // If pawn promotion dialog is open, redraw it in the correct location
  if($('#promotion-panel').is(':visible')) 
    showPromotionPanel(promoteSource, promoteTarget, promoteIsPremove);

  // Swap player and opponent status panels
  if($('#player-status').parent().hasClass('top-panel')) {
    $('#player-status').appendTo('#mid-card .bottom-panel');
    $('#opponent-status').appendTo('#mid-card .top-panel');
  }
  else {
    $('#player-status').appendTo('#mid-card .top-panel');
    $('#opponent-status').appendTo('#mid-card .bottom-panel');
  }
}


function getValue(elt: string): string {
  return $(elt).val() as string;
}

(window as any).sessionSend = (cmd: string) => {
  session.send(cmd);
};

$('#input-form').on('submit', (event) => {
  event.preventDefault();
  let text;
  let val: string = getValue('#input-text');
  val = val.replace(/[“‘”]/g, "'");
  val = val.replace(/[^ -~]+/g, '#');
  if (val === '' || val === '\n') {
    return;
  }

  const tab = chat.currentTab();
  if (tab !== 'console') {
    if (val.charAt(0) !== '@') {
      if (tab.startsWith('game-')) {
        text = 'kib ' + val;
      } else {
        text = 't ' + tab + ' ' + val;
      }
    } else {
      text = val.substr(1);
    }
  } else {
    if (val.charAt(0) !== '@') {
      text = val;
    } else {
      text = val.substr(1);
    }
  }

  const cmd = text.split(' ');
  if (cmd.length > 2 && (cmd[0] === 't' || cmd[0].startsWith('te')) && (!/^\d+$/.test(cmd[1]))) {
    chat.newMessage(cmd[1], {
      type: MessageType.PrivateTell,
      user: session.getUser(),
      message: cmd.slice(2).join(' '),
    });
  }
  session.send(text);
  $('#input-text').val('');
});

function onDeviceReady() {
  disableOnlineInputs(true);

  $('#opponent-time').text('00:00');
  $('#player-time').text('00:00');
  
  if(isSmallWindow()) {
    $('#collapse-chat').collapse('hide');
    $('#collapse-history').collapse('hide');
  }
  else {
    createTooltips();
    $('#pills-play-tab').tab('show');
    $('#collapse-history').removeClass('collapse-init');
    $('#collapse-chat').removeClass('collapse-init');
    $('#chat-toggle-btn').toggleClass('toggle-btn-selected');
  }

  selectOnFocus($('#opponent-player-name'));
  selectOnFocus($('#custom-control-min'));
  selectOnFocus($('#custom-control-sec'));
  selectOnFocus($('#observe-username'));
  selectOnFocus($('#examine-username'));

  prevWindowWidth = NaN;
  $(window).trigger('resize');

  game.role = Role.NONE;
  game.category = 'untimed';
  game.history = new History(new Chess().fen(), board);

  const user = Cookies.get('user');
  const pass = Cookies.get('pass');
  if (user !== undefined && pass !== undefined) {
    session = new Session(messageHandler, user, atob(pass));
  } else {
    session = new Session(messageHandler);
  }

  evalEngine = new EvalEngine(game.history);
  updateBoard();
}

// Enable tooltips. 
// Allow different tooltip placements for mobile vs desktop display.
// Make tooltips stay after click/focus on mobile, but only when hovering on desktop.
function createTooltip(element: any) {
  var windowWidth = $(window).width();

  var sm = element.attr('data-bs-placement-sm');
  var md = element.attr('data-bs-placement-md');
  var lg = element.attr('data-bs-placement-lg');
  var xl = element.attr('data-bs-placement-xl');
  var general = element.attr('data-bs-placement');

  var placement = (windowWidth >= 1200 ? xl : undefined) ||
      (windowWidth >= 992 ? lg : undefined) ||
      (windowWidth >= 768 ? md : undefined) ||
      sm || general || "top";

  var newTitle = element.prop('title');

  element.tooltip('dispose').tooltip({
    placement: placement as "left" | "top" | "bottom" | "right" | "auto",
    trigger: (isSmallWindow() ? 'hover focus' : 'hover'), // Tooltips stay visible after element is clicked on mobile, but only when hovering on desktop 
    ...newTitle && {title: newTitle}, // Only set title if it's defined
  });
}

function createTooltips() {
  $('[data-bs-toggle="tooltip"]').each(function(index, element) {  
    createTooltip($(element));
  });
}

function selectOnFocus(input: any) {
  $(input).on('focus', function (e) {
    $(this).one('mouseup', function () {
      $(this).trigger('select');
      return false;
    })
      .trigger('select');
  });
}

// Wrapper function for showing hidden button in btn-toolbar 
// Hidden buttons were causing visible buttons to not center properly in toolbar
// Set the margin of the last visible button to 0
function showButton(button: any) {
  button.parent().find('visible:last').removeClass('me-0');
  button.addClass('me-0');
  button.show();
}

// Wrapper function for hiding a button in btn-toolbar 
// Hidden buttons were causing visible buttons to not center properly in toolbar
// Set the margin of the last visible button to 0
function hideButton(button: any) {
  button.hide();
  button.removeClass('me-0');
  button.parent().find('visible:last').addClass('me-0');
}

// If on small screen device displaying 1 column, move the navigation buttons so they are near the board
function useMobileLayout() {
  swapLeftRightPanelHeaders();
  $('#chat-maximize-btn').hide();
  $('#viewing-games-buttons:visible:last').removeClass('me-0'); 
  $('#stop-observing').appendTo($('#viewing-game-buttons').last());
  $('#stop-examining').appendTo($('#viewing-game-buttons').last());
  $('#viewing-games-buttons:visible:last').addClass('me-0'); // This is so visible buttons in the btn-toolbar center properly
  hideCloseGamePanel();
  createTooltips();
}

function useDesktopLayout() {
  swapLeftRightPanelHeaders();
  $('#chat-maximize-btn').show();
  $('#stop-observing').appendTo($('#close-game-panel').last());
  $('#stop-examining').appendTo($('#close-game-panel').last());
  if(game.isObserving() || game.isExamining())
    showCloseGamePanel();
  createTooltips();
}

function swapLeftRightPanelHeaders() {
  // Swap top left and top right panels to bring navigation buttons closer to board
  const leftHeaderContents = $('#left-panel-header').children();
  const rightHeaderContents = $('#right-panel-header').children();
  rightHeaderContents.appendTo($('#left-panel-header'));
  leftHeaderContents.appendTo($('#right-panel-header'));

  const leftHeaderClass = $('#left-panel-header').attr('class');
  const rightHeaderClass = $('#right-panel-header').attr('class');
  $('#left-panel-header').attr('class', rightHeaderClass);
  $('#right-panel-header').attr('class', leftHeaderClass);

  if(isSmallWindow()) {
    $('#chat-toggle-btn').appendTo($('#chat-collapse-toolbar').last());
    $('#history-toggle-btn').appendTo($('#left-panel-header .btn-toolbar').last());
  }
  else {
    $('#chat-toggle-btn').appendTo($('#right-panel-header .btn-toolbar').last());
    $('#history-toggle-btn').appendTo($('#navigation-toolbar').last());
  }
}

function setPanelSizes() {
  // Reset player status panels that may have been previously slimmed down on single column screen
  $('#player-status').height('');
  $('#opponent-status').height('');

  // Make sure the board is smaller than the window height and also leaves room for the other columns' min-widths
  if(!isSmallWindow()) {
    $('#mid-col').width(0);

    if($(window).innerWidth() < 992) // display 2 columns on md (medium) display
      var boardMaxWidth = $('#col-group').innerWidth() - $('#left-col').outerWidth();
    else
      var boardMaxWidth = $('#col-group').innerWidth() - $('#left-col').outerWidth() - parseFloat($('#right-col').css('min-width'));    
    
    var cardBorderHeight = $('#mid-card').outerHeight() - $('#mid-card').height();
    var boardMaxHeight = $(window).height() - $('#player-status').outerHeight()
        - $('#opponent-status').outerHeight() - cardBorderHeight;
    
    $('#mid-col').width(Math.min(boardMaxWidth, boardMaxHeight) - 0.1); 
  }
  else 
    $('#mid-col').css('width', '');

  // Recalculate the width of the board so that the squares align to integer pixel boundaries, this is to match 
  // what chessground does internally
  var newBoardWidth = (Math.floor(($('#board').width() * window.devicePixelRatio) / 8) * 8) / window.devicePixelRatio;
  var widthDiff = $('#board').width() - newBoardWidth - 0.1; // Add 0.1px to column size, this is to stop chessground rounding down when board size is e.g. 59.999px due to floating point imprecision.
  $('#mid-col').width($('#mid-col').width() - widthDiff);

  // Set the height of dynamic elements inside left and right panel collapsables.
  // Try to do it in a robust way that won't break if we add/remove elements later.

  // Get and store the height of the address bar in mobile browsers.
  if(isSmallWindow() && addressBarHeight === undefined)
    addressBarHeight = $(window).height() - window.innerHeight;

  // On mobile, slim down player status panels in order to fit everything within window height
  if(isSmallWindow()) {
    const originalStatusHeight = $('#left-panel-header').height();
    const cardBorders = $('#mid-card').outerHeight() - $('#mid-card').height()
      + Math.round(parseFloat($('#left-card').css('border-bottom-width')))
      + Math.round(parseFloat($('#right-card').css('border-top-width')));
    const playerStatusBorder = $('#player-status').outerHeight() - $('#player-status').height();
    var playerStatusHeight = ($(window).height() - addressBarHeight - $('#board-card').outerHeight() - $('#left-panel-footer').outerHeight() - $('#right-panel-header').outerHeight() - cardBorders) / 2 - playerStatusBorder;
    playerStatusHeight = Math.min(Math.max(playerStatusHeight, originalStatusHeight - 20), originalStatusHeight);

    $('#player-status').height(playerStatusHeight);
    $('#opponent-status').height(playerStatusHeight);
  }

  // set height of left menu panel inside collapsable
  const boardHeight = $('#board').innerHeight();
  if (boardHeight) {
    var siblingsHeight = 0;
    var siblings = $('#collapse-history').siblings();
    siblings.each(function() {
      if($(this).is(':visible'))
        siblingsHeight += $(this).outerHeight();
    });
    const leftPanelBorder = $('#left-panel').outerHeight() - $('#left-panel').height();

    if(isSmallWindow())
      $('#left-panel').height(430);
    else
      $('#left-panel').height(boardHeight - leftPanelBorder - siblingsHeight);

    // set height of right panel inside collapsable
    var siblingsHeight = 0;
    var siblings = $('#collapse-chat').siblings();
    siblings.each(function() {
      if($(this).is(':visible'))
        siblingsHeight += $(this).outerHeight();
    });
    const rightPanelBorder = $('#right-panel').outerHeight() - $('#right-panel').height();

    if(isSmallWindow())
      $('#right-panel').height($(window).height() - addressBarHeight - rightPanelBorder - siblingsHeight
          - $('#right-panel-header').outerHeight() - $('#right-panel-footer').outerHeight());
    else
      $('#right-panel').height(boardHeight - rightPanelBorder - siblingsHeight);
  }

  // Adjust Notifications drop-down width
  if(isSmallWindow() && !isSmallWindow(prevWindowWidth)) 
    $('#notifications').css('width', '100%');
  else if(isMediumWindow() && !isMediumWindow(prevWindowWidth)) 
    $('#notifications').css('width', '50%');
  else if(isLargeWindow()) 
    $('#notifications').width($(document).outerWidth(true) - $('#left-col').outerWidth(true) - $('#mid-col').outerWidth(true));
}

$(document).ready(() => {
  if ((window as any).cordova !== undefined) {
    document.addEventListener('deviceready', onDeviceReady, false);
  } else {
    onDeviceReady();
  }
});

$(window).on('load', function() {
  $('#left-panel-header').css('visibility', 'visible');
  $('#right-panel-header').css('visibility', 'visible');
});

$('#notifications-header .btn-close').on('click', (event) => {
  hideAllNotifications();
});

$('#notifications-show-all').on('click', (event) => {
  showAllNotifications();
});

$('#notifications-clear-all').on('click', (event) => {
  clearNotifications();
});

$('#notifications-btn').on('click', function(event) {
  if($(this).hasClass('active')) 
    showAllNotifications();
  else 
    hideAllNotifications();
});

$('#resign').on('click', (event) => {
  if (game.chess !== null) {
    session.send('resign');
  } else {
    showStatusMsg('You are not playing a game.');
  }
});

$('#abort').on('click', (event) => {
  if (game.chess !== null) {
    session.send('abort');
  } else {
    showStatusMsg('You are not playing a game.');
  }
});

$('#takeback').on('click', (event) => {
  if (game.chess !== null) {
    if (game.chess.turn() === game.color)
      session.send('take 2');
    else
      session.send('take 1');
  } else {
    showStatusMsg('You are not playing a game.');
  }
});

$('#draw').on('click', (event) => {
  if (game.chess !== null) {
    session.send('draw');
  } else {
    showStatusMsg('You are not playing a game.');
  }
});

$('#show-status-panel').on('click', (event) => {
  if($('#show-status-panel').text() === 'Analyze') 
    showAnalysis();
  showStatusPanel();
  scrollToLeftPanelBottom();
});

$('#close-status').on('click', (event) => {
  hideStatusPanel();
});

$('#start-engine').on('click', (event) => {
  if(!engine)
    startEngine();
  else
    stopEngine();
});

$('#add-pv').on('click', (event) => {
  numPVs++;
  $('#engine-pvs').css('white-space', (numPVs === 1 ? 'normal' : 'nowrap'));
  $('#engine-pvs').append('<li>&nbsp;</li>');
  if(engine) {
    stopEngine();
    startEngine();
  }
});

$('#remove-pv').on('click', (event) => {
  if(numPVs == 1)
    return;

  numPVs--;
  $('#engine-pvs').css('white-space', (numPVs === 1 ? 'normal' : 'nowrap'));
  $('#engine-pvs li').last().remove();
  if(engine)
    engine.setNumPVs(numPVs);
});

function getGame(min: number, sec: number) {
  let opponent = getValue('#opponent-player-name')
  opponent = opponent.trim().split(/\s+/)[0];
  $('#opponent-player-name').val(opponent);
  matchRequested++;
  const cmd: string = (opponent !== '') ? 'match ' + opponent : 'seek';
  if(game.isExamining())
    session.send('unex');
  if(cmd === 'seek') {
    session.send('iset showownseek 1');
    session.send('iset seekinfo 1');
  }
  session.send(cmd + ' ' + min + ' ' + sec);
}
(window as any).getGame = getGame;

function clearMatchRequests() {
  if(session && session.isConnected()) {
    session.send('iset seekinfo 0');
    session.send('iset showownseek 0');
  }
  matchRequested = 0;
  matchRequests.clear();
  $('#matches-status').hide();
}

$('#input-text').on('focus', () => {
  $('#board')[0].addEventListener('touchstart', (event) => {
    $('#input-text').trigger('blur');
  }, {once: true, passive: true}); // Got sick of Google Chrome complaining about passive event listeners
});

$('#new-game').on('click', (event) => {
  if (game.chess === null)
    session.send('getga');
});

$('#stop-observing').on('click', (event) => {
  session.send('unobs');
});

$('#stop-examining').on('click', (event) => {
  session.send('unex');
});

$('#custom-control').on('submit', (event) => {
  event.preventDefault();

  $('#custom-control-go').trigger('focus');
  const min: string = getValue('#custom-control-min');
  const sec: string = getValue('#custom-control-sec');
  getGame(+min, +sec);

  return false;
});

$('#fast-backward').off('click');
$('#fast-backward').on('click', () => {
  fastBackward();
});

function fastBackward() {
  if (game.isExamining()) {
    var index = (bufferedHistoryCount ? bufferedHistoryIndex : game.history.index());
    if(index !== 0) {
      bufferedHistoryIndex = 0;
      bufferedHistoryCount++;
      session.send('back 999');
    }
  }
  else if(game.history)
    game.history.beginning();
  showTab($('#pills-game-tab'));
}

$('#backward').off('click');
$('#backward').on('click', () => {
  backward();
});

function backward() {
  if(game.history) {
    if(game.isExamining()) {
      var index = (bufferedHistoryCount ? bufferedHistoryIndex : game.history.index());
      var prevIndex = game.history.prev(index);

      if(prevIndex !== undefined) {
        bufferedHistoryIndex = prevIndex;
        bufferedHistoryCount++;
        session.send('back');
      }        
    }
    else
      game.history.backward();
  }
  showTab($('#pills-game-tab'));
}

$('#forward').off('click');
$('#forward').on('click', () => {
  forward();
});

function forward() {
  if(game.history) {
    if (game.isExamining()) {
      var index = (bufferedHistoryCount ? bufferedHistoryIndex : game.history.index());
      var nextIndex = game.history.next(index);

      if(nextIndex !== undefined) {
        const nextMove = game.history.get(nextIndex);
        if(nextMove.subvariation || game.history.scratch()) {
          session.send(nextMove.move.san);
        }
        else
          session.send('for');

        bufferedHistoryIndex = nextIndex;
        bufferedHistoryCount++;
      }
    }
    else
      game.history.forward();
  }
  showTab($('#pills-game-tab'));
}

$('#fast-forward').off('click');
$('#fast-forward').on('click', () => {
  fastForward();
});

function fastForward() {
  if (game.isExamining()) {
    if(!game.history.scratch()) {
      fastBackward();
      var index = (bufferedHistoryCount ? bufferedHistoryIndex : game.history.index());
      if(index !== game.history.last()) {
        session.send('for 999');
        bufferedHistoryCount++;
        bufferedHistoryIndex = game.history.last();
      }
    }
    else {
      var index = (bufferedHistoryCount ? bufferedHistoryIndex : game.history.index());
      while(index = game.history.next(index))
        forward();
    }
  }
  else if(game.history)
    game.history.end();
  showTab($('#pills-game-tab'));
}


$('#exit-subvariation').off('click');
$('#exit-subvariation').on('click', () => {
  if(game.isExamining()) {
    var index = (bufferedHistoryCount ? bufferedHistoryIndex : game.history.index());
    let move = game.history.get(index);
    let backNum = 0;
    while(move.subvariation) {
      backNum++;
      index = game.history.prev(index);
      move = game.history.get(index);
    }
    if(backNum > 0) {
      session.send('back ' + backNum);
      removeSubvariationRequested = true;
      bufferedHistoryCount++;
      bufferedHistoryIndex = index;
    }
    else {
      game.history.removeSubvariation();
      $('#exit-subvariation').hide();
    }
  }
  else {
    game.history.removeSubvariation();
    $('#exit-subvariation').hide();
  }
  showTab($('#pills-game-tab'));
});

$(document).on('keydown', (e) => {
  if ($(e.target).closest('input')[0]) {
    return;
  }

  if(e.key === 'ArrowLeft')
    backward();

  else if(e.key === 'ArrowRight')
    forward();
});

updateDropdownSound();
$('#sound-toggle').on('click', (event) => {
  soundToggle = !soundToggle;
  updateDropdownSound();
  Cookies.set('sound', String(soundToggle), { expires: 365 })
});
function updateDropdownSound() {
  const iconClass = 'dropdown-icon fa fa-volume-' + (soundToggle ? 'up' : 'off');
  $('#sound-toggle').html('<span id="sound-toggle-icon" class="' + iconClass +
    '" aria-hidden="false"></span>Sounds ' + (soundToggle ? 'ON' : 'OFF'));
}

updateDropdownNotifications();
$('#notifications-toggle').on('click', (event) => {
  notificationsToggle = !notificationsToggle;
  updateDropdownNotifications();
  Cookies.set('notifications', String(notificationsToggle), { expires: 365 })
});
function updateDropdownNotifications() {
  const iconClass = 'dropdown-icon fa fa-bell' + (notificationsToggle ? '' : '-slash');
  $('#notifications-toggle').html('<span id="notifications-toggle-icon" class="' + iconClass +
    '" aria-hidden="false"></span>Notifications ' + (notificationsToggle ? 'ON' : 'OFF'));
  $('#notifications-icon').removeClass(notificationsToggle ? 'fa-bell-slash' : 'fa-bell');
  $('#notifications-icon').addClass(notificationsToggle ? 'fa-bell' : 'fa-bell-slash');
}

updateDropdownAutoPromote();
$('#autopromote-toggle').on('click', (event) => {
  autoPromoteToggle = !autoPromoteToggle;
  updateDropdownAutoPromote();
  Cookies.set('autopromote', String(autoPromoteToggle), { expires: 365 })
});
function updateDropdownAutoPromote() {
  const iconClass = 'fa-solid fa-chess-queen';
  $('#autopromote-toggle').html('<span id="autopromote-toggle-icon" class="' + iconClass +
  ' dropdown-icon" aria-hidden="false"></span>Promote to Queen ' + (autoPromoteToggle ? 'ON' : 'OFF'));
}

$('#disconnect').on('click', (event) => {
  if (session) {
    session.disconnect();
    session = null;
  }
});

$('#login-user').on('change', () => $('#login-user').removeClass('is-invalid'));

$('#login-form').on('submit', (event) => {
  const user: string = getValue('#login-user');
  if (session && user === session.getUser()) {
    $('#login-user').addClass('is-invalid');
    event.preventDefault();
    event.stopPropagation();
    return false;
  }
  const pass: string = getValue('#login-pass');
  if(session)
    session.disconnect();
  session = new Session(messageHandler, user, pass);
  if ($('#remember-me').prop('checked')) {
    Cookies.set('user', user, { expires: 365 });
    Cookies.set('pass', btoa(pass), { expires: 365 });
  } else {
    Cookies.remove('user');
    Cookies.remove('pass');
  }
  $('#login-screen').modal('hide');
  event.stopPropagation();
  event.preventDefault();
  return false;
});

$('#login-screen').on('show.bs.modal', (e) => {
  const user = Cookies.get('user');
  if (user !== undefined) {
    $('#login-user').val(user);
  }
  const pass = Cookies.get('pass');
  if (pass !== undefined) {
    $('#login-pass').val(atob(pass));
    $('#remember-me').prop('checked', true);
  }
});

$('#sign-in').on('click', (event) => {
  $('#login-screen').modal('show');
});

$('#connect-user').on('click', (event) => {
  $('#login-screen').modal('show');
});

$('#connect-guest').on('click', (event) => {
  if(session)
    session.disconnect();
  session = new Session(messageHandler);
});

$('#login-as-guest').on('click', (event) => {
  if ($('#login-as-guest').is(':checked')) {
    $('#login-user').val('guest');
    $('#login-user').prop('disabled', true);
    $('#login-pass').val('');
    $('#login-pass').prop('disabled', true);
  } else {
    $('#login-user').val('');
    $('#login-user').prop('disabled', false);
    $('#login-pass').val('');
    $('#login-pass').prop('disabled', false);
  }
});

export function isSmallWindow(size?: number) {
  if(size === undefined)
    size = window.innerWidth;
  return size < 768;
}

export function isMediumWindow(size?: number) {
  if(size === undefined)
    size = window.innerWidth;
  return size < 992 && size >= 768;
}

export function isLargeWindow(size?: number) {
  if(size === undefined)
    size = window.innerWidth;
  return size >= 992;
}

$(window).on('resize', () => {
  if(isSmallWindow() && !isSmallWindow(prevWindowWidth))
    useMobileLayout();
  else if(!isSmallWindow() && isSmallWindow(prevWindowWidth))
    useDesktopLayout();

  setPanelSizes();

  prevWindowWidth = window.innerWidth;

  // Put other resizing stuff in here. Need time for columns to resize properly, 
  // i.e. scrollbar takes a while to appear/disappear after resizing board
  setTimeout(() => {
    if(evalEngine)
      evalEngine.redraw();
  }, 0);
});

// prompt before unloading page if in a game
$(window).on('beforeunload', () => {
  if(game.isPlaying()) 
    return true;
});

function getHistory(user: string) {
  if (session && session.isConnected()) {
    user = user.trim().split(/\s+/)[0];
    if(user.length === 0)
      user = session.getUser();
    $('#examine-username').val(user);
    historyRequested++;
    session.send('hist ' + user);
  }
}

export function parseHistory(history: string) {
  const h = history.split('\n');
  h.splice(0, 2);
  return h;
}

function showTab(tab: any) {
  if($('#collapse-history').hasClass('show'))
    tab.tab('show');
  else
    activeTab = tab;  
}

(window as any).showGameTab = () => {
  showTab($('#pills-game-tab'));
};

(window as any).withdrawAll = () => {
  session.send('withdraw t all');
  $('#lobby-pane-status').hide();
};

(window as any).acceptSeek = (id: number) => {
  matchRequested++;
  session.send('play ' + id);
};

function showHistory(user: string, history: string) {
  if (!$('#pills-examine').hasClass('active')) {
    return;
  }

  $('#examine-pane-status').hide();
  $('#history-table').html('');

  const exUser = getValue('#examine-username');
  if (exUser.localeCompare(user, undefined, { sensitivity: 'accent' }) !== 0) {
    return;
  }
  const hArr = parseHistory(history);
  for(let i = hArr.length - 1; i >= 0; i--) {
    const id = hArr[i].slice(0, hArr[i].indexOf(':'));
    $('#history-table').append(
      `<button type="button" class="w-100 btn btn-outline-secondary" onclick="examineGame('` + user + `', '` +
      + id + `');">` + hArr[i] + `</button>`);
  }
}

(window as any).examineGame = (user, id) => {
  if(game.isExamining())
    session.send('unex');
  session.send('ex ' + user + ' ' + id);
};

$(document).on('shown.bs.tab', 'button[data-bs-target="#pills-examine"]', (e) => {
  initExaminePane();
});

function initExaminePane() {
  historyRequested = 0;
  $('#history-table').html('');
  let username = getValue('#examine-username');
  if (username === undefined || username === '') {
    if (session) {
      username = session.getUser();
      $('#examine-username').val(username);
    }
  }
  getHistory(username);
}

$('#examine-user').on('submit', (event) => {
  event.preventDefault();
  $('#examine-go').trigger('focus');
  const username = getValue('#examine-username');
  getHistory(username);
  return false;
});

$('#observe-user').on('submit', (event) => {
  event.preventDefault();
  $('#observe-go').trigger('focus');
  observe();
  return false;
});

function observe(id?: string) {
  if(game.isPlaying()) {
    $('#observe-pane-status').text("You're already playing a game.");
    $('#observe-pane-status').show();
    return false;
  }

  if(!id) {
    id = getValue('#observe-username');
    id = id.trim().split(/\s+/)[0];
    $('#observe-username').val(id);
  }
  if(id.length > 0) {
    obsRequested++;
    session.send('obs ' + id);
  }
}

function showGames(games: string) {
  if (!$('#pills-observe').hasClass('active')) {
    return;
  }

  $('#observe-pane-status').hide();

  for (const g of games.split('\n').slice(0, -2).reverse()) {
    var match = g.match(/\s+(\d+)\s+(\(Exam\.\s+)?(\S+)\s+(\w+)\s+(\S+)\s+(\w+)\s+(\)\s+)?(\[\s*)(\w+)(.*)/);
    if(match) {
      var id = match[1];

      if(match[9].startsWith('p')) // Don't list private games
        continue;

      computerList.forEach(comp => {
        if(comp === match[4] || (match[4].length === 11 && comp.startsWith(match[4])))
          match[4] += '(C)';
        if(comp === match[6] || (match[6].length === 11 && comp.startsWith(match[6])))
          match[6] += '(C)';
      });

      var gg = match.slice(1).join(' ')

      $('#games-table').append(
        '<button type="button" class="w-100 btn btn-outline-secondary" onclick="observeGame(\''
        + id + '\');">' + gg + '</button>');
    }
  }
}

(window as any).observeGame = (id: string) => {
  observe(id);
};

$(document).on('shown.bs.tab', 'button[data-bs-target="#pills-observe"]', (e) => {
  initObservePane();
});

function initObservePane() {
  obsRequested = 0;
  $('#games-table').html('');
  if (session && session.isConnected()) {
    gamesRequested = true;
    session.send('games /bsl');
  }
}

$('#puzzlebot').on('click', (event) => {
  session.send('t puzzlebot getmate');
  showTab($('#pills-game-tab'));
});

$(document).on('shown.bs.tab', 'button[href="#eval-graph-panel"]', (e) => {
  if(evalEngine)
    evalEngine.redraw();
});

$('#left-bottom-tabs .closeTab').on('click', (event) => {
  var id = $(event.target).parent().siblings('.nav-link').attr('id');
  if(id === 'engine-tab' || id === 'eval-graph-tab')
    hideAnalysis();
});

$(document).on('shown.bs.tab', 'button[data-bs-target="#pills-play"]', (e) => {
  if($('#pills-lobby').hasClass('active'))
    initLobbyPane();
});

$(document).on('shown.bs.tab', 'button[data-bs-target="#pills-lobby"]', (e) => {
  initLobbyPane();
});

function initLobbyPane() {
  if(!session || !session.isConnected())
    $('#lobby').hide();
  else if(game.isExamining() || game.isPlaying()) {
    if(game.isExamining())
      $('#lobby-pane-status').text('Can\'t enter lobby while examining a game.');
    else
      $('#lobby-pane-status').text('Can\'t enter lobby while playing a game.');
    $('#lobby-pane-status').show();
    $('#lobby').hide();
  }
  else {
    $('#lobby-show-computers').prop('checked', lobbyShowComputersToggle);
    $('#lobby').show();
    $('#lobby-table').html('');
    lobbyRequested = true;
    seekMap.clear();
    session.send('iset seekremove 1');
    session.send('iset seekinfo 1');
  }
}

$(document).on('hidden.bs.tab', 'button[data-bs-target="#pills-play"]', (e) => {
  leaveLobbyPane();
});

$(document).on('hidden.bs.tab', 'button[data-bs-target="#pills-lobby"]', (e) => {
  leaveLobbyPane();
});

function leaveLobbyPane() {
  if(lobbyRequested) {
    $('#lobby-table').html('');
    lobbyRequested = false;

    if (session && session.isConnected()) {
      session.send('iset seekremove 0');
      session.send('iset seekinfo 0');
    }
  }
}

$('#lobby-show-computers').on('change', function (e) {
  lobbyShowComputersToggle = $(this).is(':checked');
  Cookies.set('lobbyshowcomputers', String(lobbyShowComputersToggle), { expires: 365 });
  initLobbyPane();
});

const titleToString = {
  0x0 : '',
  0x1 : '(U)',
  0x2 : '(C)',
  0x4 : '(GM)',
  0x8 : '(IM)',
  0x10 : '(FM)',
  0x20 : '(WGM)',
  0x40 : '(WIM)',
  0x80 : '(WFM)',
};

function parseSeeks(msgs: string, map?: any): any {
  if(!map)
    map = new Map();

  for (const msg of msgs.split('\n')) {
    const m = msg.trim();
    if (m.startsWith('<s>') || m.startsWith('<sn>')) {
      const seek = m.split(/\s+/).slice(1);
      const seekDetails = seek.slice(1).map(pair => pair.split('=')[1]).slice(0, -3);
      seekDetails[0] = seekDetails[0] + titleToString[+seekDetails[1]];
      if (seekDetails[2] !== '0P') {
        seekDetails[0] = seekDetails[0] + '(' + seekDetails[2] + ')';
      }
      seekDetails.splice(1, 2);
      if(seekDetails[5] === '?') 
        seekDetails.splice(5, 1);
      map.set(seek[0], seekDetails.join(' '));
    }
    else if (m.startsWith('<sr>')) {
      for (const r of m.split(' ').slice(1)) {
        map.delete(r);
      }
    }
  }

  return map;
}

function parsePending(msgs: string): any {
  const pending = new Map();

  var lines = msgs.split('\n');
  for(const line of lines) {
    var match = line.match(/\<pt\> (\d+) w=(\S+) \S+ \S+ \S+(?: \[(black|white)\])? \S+ \S+ (rated|unrated) (\S+)( \d+ \d+)?/m); 
    if(match) {
      // output match offers in the same format as parseSeeks returns
      var color = '';
      if(match[3] === 'black')
        color = ' B';
      else if(match[2] === 'white')
        color = ' W';

      if(match[4] === 'rated')
        var rated = 'r';
      else if(match[4] === 'unrated')
        var rated = 'u';

      var time = match[6];
      if(!time)
        time = ' 0 0';
      
      pending.set(match[1], match[2] + time + ' ' + rated + ' ' + match[5] + color);
    }
  }
  
  return pending;
}
