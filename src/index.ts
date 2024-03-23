// Copyright 2023 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import Chess from 'chess.js';
import Cookies from 'js-cookie';
import { Chessground } from 'chessground';
import { Color, Key } from 'chessground/types';
import NoSleep from '@uriopass/nosleep.js'; // Prevent screen dimming
import Chat from './chat';
import { Clock } from './clock';
import { Engine, EvalEngine } from './engine';
import { game, Role } from './game';
import History from './history';
import { GetMessageType, MessageType, Session } from './session';
import * as Sounds from './sounds';
import { Reason } from './parser';
import './ui';
import packageInfo from '../package.json';

export const enum Layout {
  Desktop = 0,
  Mobile,
  ChatMaximized
}

let session: Session;
let chat: Chat;
let engine: Engine | null;
let evalEngine: EvalEngine | null;
let playEngine: Engine | null;
let clock: Clock | null;

// toggle game sounds
let soundToggle: boolean = (Cookies.get('sound') !== 'false');
// toggle for auto-promote to queen
let autoPromoteToggle: boolean = (Cookies.get('autopromote') === 'true');
// toggle for showing Computer opponents in the lobby
let lobbyShowComputersToggle: boolean = (Cookies.get('lobbyshowcomputers') === 'true');
// toggle for automatically showing new slide-down notifications or notifications in chat channels
export let notificationsToggle: boolean = (Cookies.get('notifications') !== 'false');
// toggle for showing highlights/graphics on the board
let highlightsToggle: boolean = (Cookies.get('highlights') !== 'false');
// toggle for showing highlights/graphics on the board
let wakelockToggle: boolean = (Cookies.get('wakelock') !== 'false');
// toggle for creating a window for chat
export let chattabsToggle: boolean = (Cookies.get('chattabs') !== 'false');

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
let prevWindowWidth = 0;
let layout = Layout.Desktop;
let addressBarHeight;
let soundTimer
let showSentOffersTimer;
let removeSubvariationRequested = false;
let prevCaptured;
let activeTab;
let promotePiece;
let promoteSource;
let promoteTarget;
let promoteIsPremove;
let bufferedHistoryIndex = -1;
let bufferedHistoryCount = 0;
let newGameVariant = '';
let lobbyEntries = new Map();
let lobbyScrolledToBottom;
let scrollBarWidth; // Used for sizing the layout
let noSleep = new NoSleep(); // Prevent screen dimming
let openings;
let fetchOpeningsPromise = null;
let isRegistered = false;
let lastComputerGame = null; // Attributes of the last game played against the Computer. Used for Rematch and alternating colors each game.
let lastComputerMoveEval = null; // Keeps track of the current eval for a game against the Computer. Used for draw offers

function cleanupGame() {
  if(game.role === Role.PLAYING_COMPUTER)
    return;

  game.role = Role.NONE;

  if(playEngine) {
    playEngine.terminate();
    playEngine = null;
  }

  hideButton($('#stop-observing'));
  hideButton($('#stop-examining'));
  hideCloseGamePanel();
  hidePromotionPanel();
  $('#takeback').prop('disabled', false);
  $('#play-computer').prop('disabled', false);  
  $('#playing-game-buttons').hide();
  $('#viewing-game-buttons').show();
  $('#lobby-pane-status').hide();

  clock.stopClocks();

  if(game.watchers)
    clearInterval(game.watchers);
  game.watchers = null;
  $('#game-watchers').empty();

  game.id = 0;
  delete game.chess;
  game.chess = null;
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
  $('#pills-pairing *').prop('disabled', disable);
  $('#pills-lobby *').prop('disabled', disable);
  $('#quick-game').prop('disabled', disable);
  $('#pills-examine *').prop('disabled', disable);
  $('#pills-observe *').prop('disabled', disable);
  $('#chan-dropdown *').prop('disabled', disable);
  $('#input-form *').prop('disabled', disable);
}

function initCategory() {
  // Check if game category (variant) is supported by Engine
  if(Engine.categorySupported(game.category)) {
    if(!evalEngine) {
      // Configure for variants
      var options = {};
      if(game.category === 'wild/fr')
        options['UCI_Chess960'] = true;
      else if(game.category === 'crazyhouse')
        options['UCI_Variant'] = game.category;
      
      evalEngine = new EvalEngine(game.history, options);
    }
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
      sendMove(iMove.move);
    }
    while(i < id) {
      i = game.history.next(i);
      const iMove = game.history.get(i);
      sendMove(iMove.move);
    }
  }
  else
    var entry = game.history.display(id);
}

function sendMove(move: any) {
  var moveStr = '';
  if(move.san.startsWith('O-O') || move.san.includes('@')) // support for variants
    moveStr = move.san;
  else
    moveStr = move.from + '-' + move.to + (move.promotion ? '=' + move.promotion : ''); 

  session.send(moveStr);
}

const board: any = Chessground(document.getElementById('board'), {
  highlight: {
    lastMove: highlightsToggle,
    check: highlightsToggle
  },  
  movable: {
    free: false,
    color: undefined,
    events: {
      after: movePiece,
      afterNewPiece: movePiece,
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
  if(game.category === 'losers' || game.category.startsWith('wild'))
    return variantToDests(chess);

  var dests = new Map();
  chess.SQUARES.forEach(s => {
    var ms = chess.moves({square: s, verbose: true});
    if(ms.length)    
      dests.set(s, ms.map(m => m.to));
  });

  return dests;
}

function variantToDests(chess: any): Map<Key, Key[]> {
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
  board.playPredrop(() => true);

  checkGameEnd(); // Check whether game is over when playing against computer (offline mode)
}

export function movePiece(source: any, target: any, metadata: any) {
  let fen = '';
  let move = null;

  if(game.isPlaying() || game.isExamining() || game.role === Role.NONE) {  
    if(game.isPlaying() || game.isExamining()) 
      var chess = game.chess;
    else
      var chess = new Chess(game.history.get().fen);

    var inMove = {from: source, to: target, promotion: (promotePiece ? promotePiece : 'q')};
    
    // Crazyhouse/bughouse piece placement
    const cgRoles = {pawn: 'p', rook: 'r', knight: 'n', bishop: 'b', queen: 'q', king: 'k'};
    if(cgRoles.hasOwnProperty(source)) { // Crazyhouse/bughouse piece placement
      inMove['piece'] = cgRoles[source];
      inMove.from = '';
    }
  
    var parsedMove = parseMove(chess.fen(), inMove, game.category);
    if(!parsedMove) {
      updateBoard();
      return;
    }

    fen = parsedMove.fen;
    move = parsedMove.move;

    if(!promotePiece && !autoPromoteToggle && move && move.flags.includes('p')) {
      showPromotionPanel(source, target, false);
      board.set({ movable: { color: undefined } });
      return;
    }

    chess.load(fen);

    if (game.isPlaying() && game.chess.turn() !== game.color && game.role !== Role.PLAYING_COMPUTER)
      sendMove(move);
   
    if(game.isExamining()) {
      var nextMove = game.history.get(game.history.next());
      if(nextMove && !nextMove.subvariation && !game.history.scratch() && fen === nextMove.fen) 
        session.send('for');
      else
        sendMove(move);
    }

    hitClock(false);
  }

  game.wtime = clock.getWhiteTime();
  game.btime = clock.getBlackTime();

  promotePiece = null;  
  if (move !== null)
    movePieceAfter(move, fen);

  if(game.role === Role.PLAYING_COMPUTER) // Send move to engine in Play Computer mode
    playEngine.move(game.history.last());

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

function showBoardModal(type: string, title: string, msg: string, btnFailure: string[], btnSuccess: string[], progress = false, useSessionSend = true): any {
  var modalHtml = createModal(type, title, msg, btnFailure, btnSuccess, progress, useSessionSend);
  var modal = $(modalHtml).appendTo($('#game-requests'));
  modal.addClass('board-modal');
  modal.toast('show');

  return modal;
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

  if((btnSuccess && btnSuccess.length === 2) || (btnFailure && btnFailure.length === 2)) {
    req += '<div class="mt-2 pt-2 border-top center">';
    if (btnSuccess && btnSuccess.length === 2) {
      let successCmd = btnSuccess[0];
      if(useSessionSend) 
        successCmd = "sessionSend('" + btnSuccess[0] + "');";
      req += '<button type="button" onclick="' + successCmd + `" class="button-success btn btn-sm btn-outline-success me-4" data-bs-dismiss="toast">
          <span class="fa fa-check-circle-o" aria-hidden="false"></span> ` + btnSuccess[1] + '</button>';
    }
    if (btnFailure && btnFailure.length === 2) {
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

function createNotification(type: string, title: string, msg: string, btnFailure: string[], btnSuccess: string[], progress = false, useSessionSend = true): any {
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

  return modal;
}

function removeNotification(element: any) {
  if(!element.length)
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

  var transformMatrix = element.css('transform');
  var matrix = transformMatrix.replace(/[^0-9\-.,]/g, '').split(',');
  var x = matrix[12] || matrix[4]; // translate x
  slideNotification(element, (x < 0 ? 'left' : 'right'));
}

function showNotifications(modals: any) {
  if(!modals.length)
    return;
  
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

// Helper function which returns an array of square coordinates which are adjacent (including diagonally) to the given square
function getAdjacentSquares(square: string) : string[] {
  var adjacent = [];
  var file = square[0];
  var rank = square[1];
  if(rank !== '1') 
    adjacent.push(file + (+rank - 1));
  if(rank !== '8')
    adjacent.push(file + (+rank + 1));
  if(file !== 'a') {
    var prevFile = String.fromCharCode(file.charCodeAt(0) - 1);
    adjacent.push(prevFile + rank);
    if(rank !== '1') 
      adjacent.push(prevFile + (+rank - 1));
    if(rank !== '8')
      adjacent.push(prevFile + (+rank + 1));
  }
  if(file !== 'h') {
    var nextFile = String.fromCharCode(file.charCodeAt(0) + 1);
    adjacent.push(nextFile + rank);
    if(rank !== '1') 
      adjacent.push(nextFile + (+rank - 1));
    if(rank !== '8')
      adjacent.push(nextFile + (+rank + 1));
  }
  return adjacent;
}

function splitFEN(fen: string) {
  var words = fen.split(/\s+/);
  return {
    board: words[0],
    color: words[1],
    castlingRights: words[2],
    enPassant: words[3],
    plyClock: words[4],
    moveNo: words[5]
  };
}

function joinFEN(obj: any) {
  return Object.keys(obj).map(key => obj[key]).join(' ');
}

export function parseMove(fen: string, move: any, category: string) {
  // Parse variant move
  if(category.includes('wild') || category.includes('house')) 
    return parseVariantMove(fen, move, category);

  // Parse standard move
  var chess = new Chess(fen);
  var outMove = chess.move(move);
  var outFen = chess.fen();
  return { fen: outFen, move: outMove };
}

function parseVariantMove(fen: string, move: any, category: string) {
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

  // Pre-processing of FEN before calling chess.move()
  var beforePre = splitFEN(fen); // Stores FEN components from before pre-processing of FEN starts
  var afterPre = Object.assign({}, beforePre); // Stores FEN components for after pre-procesisng is finished

  if(category.startsWith('wild')) {
    // Remove opponent's castling rights since it confuses chess.js
    if(beforePre.color === 'w') {
      var opponentRights = beforePre.castlingRights.replace(/[KQ-]/g,'');
      var castlingRights = beforePre.castlingRights.replace(/[kq]/g,'');
    }
    else {
      var opponentRights = beforePre.castlingRights.replace(/[kq-]/g,'');
      var castlingRights = beforePre.castlingRights.replace(/[KQ]/g,'');
    }
    if(castlingRights === '')
      castlingRights = '-';
  
    afterPre.castlingRights = castlingRights;
    fen = joinFEN(afterPre);
    chess.load(fen);
  }

  /*** Try to make standard move ***/
  var outMove = chess.move(move);
  var outFen = chess.fen();

  /*** Manually update FEN for non-standard moves ***/
  if(!outMove 
      || (category.startsWith('wild') && san.toUpperCase().startsWith('O-O'))) {
    san = san.replace(/[+#]/, ''); // remove check and checkmate, we'll add it back at the end
    chess = new Chess(fen);
    outMove = {color: color, san: san};
   
    var board = afterPre.board;
    var color = afterPre.color;
    var castlingRights = afterPre.castlingRights;
    var enPassant = afterPre.enPassant;
    var plyClock = afterPre.plyClock;
    var moveNo = afterPre.moveNo;

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

      // Can't place a pawn on the 1st or 8th rank
      var rank = outMove.to.charAt(1);

      if(outMove.piece === 'p' && (rank === '1' || rank === '8')) 
        return null;

      chess.put({type: outMove.piece, color: color}, outMove.to);

      // Piece placement didn't block check/checkmate
      if(chess.in_check() || chess.in_checkmate())
        return null;

      outMove.flags = 'z';
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

      var castlingRightsAfter = castlingRights;
      if(rookFrom === leftRook) 
        castlingRightsAfter = castlingRightsAfter.replace((color === 'w' ? 'Q' : 'q'), '');
      else 
        castlingRightsAfter = castlingRightsAfter.replace((color === 'w' ? 'K' : 'k'), '');

      // On FICS there is a weird bug (feature?) where as long as the king hasn't moved after castling, 
      // you can castle again! 
      if(kingFrom !== kingTo) {
        if(rookFrom === leftRook) 
          castlingRightsAfter = castlingRightsAfter.replace((color === 'w' ? 'K' : 'k'), '');
        else
          castlingRightsAfter = castlingRightsAfter.replace((color === 'w' ? 'Q' : 'q'), '');
      }

      if(castlingRightsAfter === '')
        castlingRightsAfter = '-';

      outMove.piece = 'k';
      outMove.from = kingFrom;

      if(category === 'wild/fr')
        outMove.to = rookFrom; // Fischer random specifies castling to/from coorindates using 'rook castling'
      else
        outMove.to = kingTo;
    }

    var boardAfter = chess.fen().split(/\s+/)[0];
    outFen = boardAfter + ' ' + colorAfter + ' ' + castlingRightsAfter + ' ' + enPassantAfter + ' ' + plyClockAfter + ' ' + moveNoAfter;
  
    chess.load(outFen);
    if(chess.in_checkmate())
      outMove.san += '#';
    else if(chess.in_check())
      outMove.san += '+';
  }

  // Post-processing on FEN after calling chess.move() 
  var beforePost = splitFEN(outFen); // Stores FEN components before post-processing starts
  var afterPost = Object.assign({}, beforePost); // Stores FEN components after post-processing is completed
  
  if(category === 'crazyhouse' || category === 'bughouse') {
    afterPost.plyClock = '0'; // FICS doesn't use the 'irreversable moves count' for crazyhouse/bughouse, so set it to 0
    
    // Check if it's really mate, i.e. player can't block with a held piece
    // (Yes this is a lot of code for something so simple)
    if(chess.in_checkmate()) {
      // Get square of king being checkmated
      for(const s of chess.SQUARES) {
        var piece = chess.get(s);
        if(piece && piece.type === 'k' && piece.color === chess.turn()) {
          var kingSquare = s;
          break;
        }
      }
      // place a pawn on every adjacent square to the king and check if it blocks the checkmate
      // If so the checkmate can potentially be blocked by a held piece
      var adjacent = getAdjacentSquares(kingSquare);
      var blockingSquare = null;
      for(let adj of adjacent) {
        if(!chess.get(adj)) {
          chess.put({type: 'p', color: chess.turn()}, adj);  
          if(!chess.in_checkmate()) {
            blockingSquare = adj;
            break;
          }
          chess.remove(adj);
        }
      };
      if(blockingSquare) {
        if(category === 'crazyhouse') {
          // check if we have a held piece capable of occupying the blocking square
          var canBlock = false;
          var holdings = game.history.get().holdings;
          for(let k in holdings) {
            if(holdings[k] === 0)
              continue;

            if((chess.turn() === 'w' && k.toLowerCase() !== k) ||
                (chess.turn() === 'b' && k.toUpperCase() !== k))
              continue;

            // held pawns can't be placed on the 1st or 8th rank
            var rank = blockingSquare.charAt(1);
            if(k.toLowerCase() !== 'p' || (rank !== '1' && rank !== '8'))
              canBlock = true;           
          }
        }
        // If playing a bughouse game, and the checkmate can be blocked in the future, then it's not checkmate
        if((game.isPlaying() && category === 'bughouse') || canBlock) 
          outMove.san = outMove.san.replace('#', '+');
      }
    }
  }
  if(category.startsWith('wild')) {
    // Adjust castling rights after rook move
    if(outMove.piece === 'r') {
      // Check if rook moved from starting position
      var startChess = new Chess(game.history.get(0).fen);
      var files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
      var rank = (afterPre.color === 'w' ? '1' : '8');
      var leftRook = '';
      var rightRook = '';
      for(const file of files) {
        // Get starting location of rooks
        let square = file + rank;
        let piece = startChess.get(square);
        if(piece && piece.type === 'r' && piece.color === afterPre.color) {
          if(!leftRook) 
            var leftRook = square;
          else 
            var rightRook = square;
        }
      }
      if(outMove.from === leftRook) 
        var leftRookMoved = true;
      if(outMove.from === rightRook) 
        var rightRookMoved = true;

      if(leftRookMoved || rightRookMoved) {
        var castlingRights = afterPre.castlingRights;
        if(leftRookMoved)
          var castlingRights = castlingRights.replace((afterPre.color === 'w' ? 'Q' : 'q'), '');
        else
          var castlingRights = castlingRights.replace((afterPre.color === 'w' ? 'K' : 'k'), '');

        if(!castlingRights)
          castlingRights = '-';

        afterPost.castlingRights = castlingRights;
      }
    }

    // Don't let chess.js change the castling rights erroneously
    if(outMove.piece !== 'k' && outMove.piece !== 'r') 
      afterPost.castlingRights = beforePre.castlingRights;
    else if(opponentRights) {
      // Restore opponent's castling rights (which were removed at the start so as not to confuse chess.js)
      var castlingRights = afterPost.castlingRights;
      if(castlingRights === '-')
        castlingRights = '';
      if(afterPost.color === 'w')
        afterPost.castlingRights = opponentRights + castlingRights;
      else
        afterPost.castlingRights = castlingRights + opponentRights;
    }
  }
  outFen = joinFEN(afterPost);

  // Move was not made, something went wrong
  if(afterPost.board === beforePre.board)
    return null;

  return {fen: outFen, move: outMove};
}

export function parseMovelist(movelist: string) {
  const moves = [];
  let found : string[] & { index?: number } = [''];
  let n = 1;
  var wtime = game.time * 60000;
  var btime = game.time * 60000;

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
    found = movelist.match(new RegExp(n + '\\.\\s*(\\S*)\\s*\\((\\d+):(\\d+)\.(\\d+)\\)\\s*(?:(\\S*)\\s*\\((\\d+):(\\d+)\.(\\d+)\\))?.*', 'm'));
    if (found !== null && found.length > 4) {
      const m1 = found[1].trim();
      if(m1 !== '...') {
        wtime += (n === 1 ? 0 : game.inc * 1000) - (+found[2] * 60000 + +found[3] * 1000 + +found[4]);
        var parsedMove = parseMove(chess.fen(), m1, game.category);
        if(!parsedMove)
          break;
        chess.load(parsedMove.fen);
        game.history.add(parsedMove.move, parsedMove.fen, false, wtime, btime);
        getOpening();
        updateVariantMoveData();
      }
      if (found.length > 5 && found[5]) {
        const m2 = found[5].trim();
        btime += (n === 1 ? 0 : game.inc * 1000) - (+found[6] * 60000 + +found[7] * 1000 + +found[8]);
        parsedMove = parseMove(chess.fen(), m2, game.category);
        if(!parsedMove)
          break;
        chess.load(parsedMove.fen);
        game.history.add(parsedMove.move, parsedMove.fen, false, wtime, btime);
        getOpening();
        updateVariantMoveData();
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
        session.send('set interface Free Chess Club (' + packageInfo.version + ')');
        session.send('iset defprompt 1'); // Force default prompt. Used for splitting up messages
        session.send('iset nowrap 1'); // Stop chat messages wrapping which was causing spaces to get removed erroneously
        session.send('iset pendinfo 1'); // Receive detailed match request info (both that we send and receive)
        session.send('iset ms 1'); // Style12 receives clock times with millisecond precision
        session.send('=ch');
        channelListRequested = true;
        session.send('=computer'); // get Computers list, to augment names in Observe panel
        computerListRequested = true;

        if($('#pills-observe').hasClass('active'))
          initObservePane();
        else if($('#pills-examine').hasClass('active'))
          initExaminePane();
        else if($('#pills-play').hasClass('active')) {
          if($('#pills-lobby').hasClass('active'))
            initLobbyPane();
          else if($('#pills-pairing').hasClass('active'))
            initPairingPane();
        }         
      } else if (data.command === 2) {
        session.disconnect();
        $('#chat-status').popover({
          animation: true,
          content: data.control,
          placement: 'top',
        });
        $('#chat-status').popover('show');
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
                
        if(data.role === Role.PLAYING_COMPUTER)
          cleanupGame();  
        else {
          gameChangePending = true;
          break;
        }
      }
      else if(game.role === Role.PLAYING_COMPUTER && data.role !== Role.PLAYING_COMPUTER) {
        game.role = Role.NONE;
        cleanupGame(); // Allow player to imemediately play/examine/observe a game at any time while playing the Computer. The Computer game will simply be aborted.
      }

      Object.assign(game, data);

      var amIblack = game.bname === session.getUser();
      var amIwhite = game.wname === session.getUser();
      if(Role.PLAYING_COMPUTER && game.color === 'b')
        amIblack = true;  

      if (game.chess === null) {
        if(getPlyFromFEN(game.fen) === 1)
          game.chess = new Chess(game.fen);
        else
          game.chess = new Chess();

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
        setFontSizes();

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

        $('#exit-subvariation').tooltip('hide');
        $('#exit-subvariation').hide();
        $('#player-captured').text('');
        $('#opponent-captured').text('');
        $('#player-status').css('background-color', '');
        $('#opponent-status').css('background-color', '');
        $('#pairing-pane-status').hide();
        $('#opening-name').hide();

        if(game.isPlaying() || game.isExamining()) {
          clearMatchRequests();
 
          if(game.role !== Role.PLAYING_COMPUTER) {
            session.send('allobs ' + game.id);
            if(game.isPlaying()) {
              game.watchers = setInterval(() => {
                const time = game.color === 'b' ? game.btime : game.wtime;
                if (time > 60000) {
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
        }

        if(evalEngine) {
          evalEngine.terminate();
          evalEngine = null;
        }

        game.history = new History(game.fen, board, game.time * 60000, game.time * 60000);
        updateBoard();

        // Adjust settings for game category (variant)
        // When examining we do this after requesting the movelist (since the category is told to us by the 'moves' command)
        if(game.isPlaying() || game.isObserving()) {
          initCategory();

          if(game.isPlaying()) {
            $('#viewing-game-buttons').hide();
            $('#playing-game').hide();
            $('#playing-game-buttons').show();

            if (soundToggle) {
              Sounds.startSound.play();
            }

            if(game.role === Role.PLAYING_COMPUTER) { // Play Computer mode
              $('#takeback').prop('disabled', true);

              playEngine = new Engine(game.history, playComputerBestMove, null, getPlayComputerEngineOptions(), getPlayComputerMoveParams());
              if(amIblack) 
                playEngine.move(0); 
            } 
            else {            
              $('#play-computer').prop('disabled', true);              
              if (game.wname === session.getUser()) 
                chat.createTab(game.bname);
              else 
                chat.createTab(game.wname);
            }
          }
        }

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

      if(game.role === Role.NONE || game.role >= -2 || game.role === Role.PLAYING_COMPUTER) {
        const lastPly = getPlyFromFEN(game.chess.fen());
        const thisPly = getPlyFromFEN(game.fen);
 
        if (game.move !== 'none' && thisPly === lastPly + 1) { // make sure the move no is right
          var parsedMove = parseMove(game.chess.fen(), game.move, game.category);
          game.chess.load(game.fen);
          movePieceAfter((parsedMove ? parsedMove.move : {san: game.move}));
        }
        else {
          game.chess.load(game.fen);
          updateHistory();
        }

        hitClock(true);
      }
      break;
    case MessageType.GameStart:
      break;
    case MessageType.GameEnd:
      // Set clock time to the time that the player resigns/aborts etc.
      game.history.updateClockTimes(game.history.last(), clock.getWhiteTime(), clock.getBlackTime());

      if (data.reason <= 4 && $('#player-name').text() === data.winner) {
        // player won
        $('#player-status').css('background-color', 'var(--game-win-color)');
        $('#opponent-status').css('background-color', 'var(--game-lose-color)');
        if (soundToggle) {
          Sounds.winSound.play();
        }
      } else if (data.reason <= 4 && $('#player-name').text() === data.loser) {
        // opponent won
        $('#player-status').css('background-color', 'var(--game-lose-color)');
        $('#opponent-status').css('background-color', 'var(--game-win-color)');
        if (soundToggle) {
          Sounds.loseSound.play();
        }
      } else {
        // tie
        $('#player-status').css('background-color', 'var(--game-tie-color)');
        $('#opponent-status').css('background-color', 'var(--game-tie-color)');
      }

      showStatusMsg(data.message);
      let rematch = [];
      var useSessionSend = true;   
      if(data.reason !== 2 && data.reason !== 7) {
        if(game.role === Role.PLAYING_COMPUTER) {
          rematch = ['rematchComputer();', 'Rematch']
          useSessionSend = false;
        }
        else if($('#player-name').text() === session.getUser()) 
          rematch = ['rematch', 'Rematch']
      }

      showBoardModal('Match Result', '', data.message, rematch, [], false, useSessionSend);
      game.role = Role.NONE;
      cleanupGame();
      break;
    case MessageType.GameHoldings:
      game.history.get().holdings = data.holdings;
      break;
    case MessageType.Offers:
      var offers = data.offers;
      // Clear the lobby
      if(offers[0].type === 'sc')
        $('#lobby-table').html('');

      // Add seeks to the lobby
      var seeks = offers.filter((item) => item.type === 's');
      if(seeks.length && lobbyRequested) {
        seeks.forEach((item) => {
          if(!lobbyShowComputersToggle && item.title === 'C')
            return;

          var lobbyEntryText = formatLobbyEntry(item);

          $('#lobby-table').append(
            `<button type="button" data-offer-id="` + item.id + `" class="btn btn-outline-secondary lobby-entry" onclick="acceptSeek(` 
              + item.id + `);">` + lobbyEntryText + `</button>`);
        });

        if(lobbyScrolledToBottom) {
          var container = $('#lobby-table-container')[0];
          container.scrollTop = container.scrollHeight;
        }
      }      

      // Add our own seeks and match requests to the top of the Play pairing pane 
      var sentOffers = offers.filter((item) => item.type === 'sn' 
        || (item.type === 'pt' && (item.subtype === 'partner' || item.subtype === 'match')));
      if(sentOffers.length) {
        var newOffers = [];
        sentOffers.forEach((item) => {
          if(!$('.sent-offer[data-offer-id="' + item.id + '"]').length) {
            if(matchRequested)
              matchRequested--;
            newOffers.push(item);
          }
        });
        if(newOffers.length) {
          clearTimeout(showSentOffersTimer);
          showSentOffersTimer = setTimeout(() => showSentOffers(newOffers), 1000);
        }
        $('#pairing-pane-status').hide();
      }

      // Offers received from another player
      var otherOffers = offers.filter((item) => item.type === 'pf');
      otherOffers.forEach((item) => {
        var headerTitle = '', bodyTitle = '', bodyText = '', displayType = '';
        switch(item.subtype) {
          case 'match': 
            displayType = 'notification';
            var time = !isNaN(item.initialTime) ? ' ' + item.initialTime + ' ' + item.increment : '';
            bodyText = item.ratedUnrated + ' ' + item.category + time;
            headerTitle = 'Match Request';
            bodyTitle = item.opponent + ' (' + item.opponentRating + ')' + (item.color ? ' [' + item.color + ']' : '');
            $('.notification').each((index, element) => {
              var headerTextElement = $(element).find('.header-text');
              var bodyTextElement = $(element).find('.body-text');
              if(headerTextElement.text() === 'Match Request' && bodyTextElement.text().startsWith(item.opponent + '(')) {
                $(element).attr('data-offer-id', item.id);
                bodyTextElement.text(bodyTitle + ' ' + bodyText);
                var btnSuccess = $(element).find('.button-success');
                var btnFailure = $(element).find('.button-failure');
                btnSuccess.attr('onclick', `sessionSend('accept ` + item.id + `');`);
                btnFailure.attr('onclick', `sessionSend('decline ` + item.id + `');`);
                displayType = '';
              }
            });
            break;
          case 'partner':
            displayType = 'notification';
            headerTitle = 'Partnership Request';
            bodyTitle = item.toFrom;
            bodyText = 'offers to be your bughouse partner.';
            break;
          case 'takeback':
            displayType = 'modal';
            headerTitle = 'Takeback Request';
            bodyTitle = item.toFrom;
            bodyText = 'would like to take back ' + item.parameters + ' half move(s).';
            break;
          case 'abort': 
            displayType = 'modal';
            headerTitle = 'Abort Request';
            bodyTitle = item.toFrom;
            bodyText = 'would like to abort the game.';
            break;
          case 'draw':
            displayType = 'modal';
            headerTitle = 'Draw Request';
            bodyTitle = item.toFrom;
            bodyText = 'offers you a draw.';
            break;
        }
        
        if(displayType) {
          if(displayType === 'notification')
            var modal = createNotification(headerTitle, bodyTitle, bodyText, ['decline ' + item.id, 'Decline'], ['accept ' + item.id, 'Accept']);
          else if(displayType === 'modal')
            var modal = showBoardModal(headerTitle, bodyTitle, bodyText, ['decline ' + item.id, 'Decline'], ['accept ' + item.id, 'Accept']);
          modal.attr('data-offer-id', item.id);
        }
      });

      // Remove match requests and seeks. Note our own seeks are removed in the MessageType.Unknown section
      // since <sr> info is only received when we are in the lobby. 
      var removals = offers.filter((item) => item.type === 'pr' || item.type === 'sr');
      removals.forEach((item) => {
        item.ids.forEach((id) => {
          removeNotification($('.notification[data-offer-id="' + id + '"]')); // If match request was not ours, remove the Notification
          $('.board-modal[data-offer-id="' + id + '"]').toast('hide'); // if in-game request, hide the modal
          $('.sent-offer[data-offer-id="' + id + '"]').remove(); // If offer, match request or seek was sent by us, remove it from the Play pane
          $('.lobby-entry[data-offer-id="' + id + '"]').remove(); // Remove seek from lobby
        });
        if(!$('#sent-offers-status').children().length)
          $('#sent-offers-status').hide();
      });
      break;
    case MessageType.Unknown:
    default:
      const msg = data.message;

      var match = msg.match(/(?:Observing|Examining)\s+(\d+) [\(\[].+[\)\]]: (.+) \(\d+ users?\)/);
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

      // Retrieve status/error messages from commands sent to the server via the left menus
      match = msg.match(/^There is no player matching the name \w+\./m);
      if(!match)
        match = msg.match(/^\S+ is not a valid handle\./m);
      if(!match)
        match = msg.match(/^\w+ has no history games\./m);
      if(!match)
        match = msg.match(/^You need to specify at least two characters of the name\./m);
      if(!match)
        match = msg.match(/^Ambiguous name (\w+):/m);
      if(!match)
        match = msg.match(/^\w+ is not logged in\./m);
      if(!match)
        match = msg.match(/^\w+ is not playing a game\./m);
      if(!match)
        match = msg.match(/^Sorry, game \d+ is a private game\./m);
      if(!match)
        match = msg.match(/^\w+ is playing a game\./m);
      if(!match)
        match = msg.match(/^\w+ is examining a game\./m);
      if(!match)
        match = msg.match(/^You can't match yourself\./m);
      if(!match)
        match = msg.match(/^You cannot challenge while you are (?:examining|playing) a game\./m);
      if(!match) 
        match = msg.match(/^You are already offering an identical match to \w+\./m);
      if(!match)
        match = msg.match(/^You can only have 3 active seeks\./m);
      if(!match) 
        match = msg.match(/^There is no such game\./m);
      if(!match)
        match = msg.match(/^You cannot seek bughouse games\./m);
      if(!match)
        match = msg.match(/^\w+ is not open for bughouse\./m);
      if(!match)
        match = msg.match(/^Your opponent has no partner for bughouse\./m);
      if(!match) 
        match = msg.match(/^You have no partner for bughouse\./m);
      if(match && (historyRequested || obsRequested || matchRequested)) {
        let status;
        if(historyRequested) 
          status = $('#examine-pane-status');
        else if(obsRequested) 
          status = $('#observe-pane-status');
        else if(matchRequested) 
          status = $('#pairing-pane-status');
        
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
        else if(matchRequested) 
          matchRequested--;
        
        if(match[0].startsWith('Ambiguous name'))
          status.text('There is no player matching the name ' + match[1] + '.');
        else if(match[0].includes('is not open for bughouse.'))
          status.text(match[0] + ' Ask them to \'set bugopen 1\' in the Console.');
        else if(match[0] === 'You cannot seek bughouse games.') 
          status.text('You must specify an opponent for bughouse.');
        else if(match[0].includes('no partner for bughouse.'))
          status.text(match[0] + ' Get one by using \'partner <username>\' in the Console.');
        else
          status.text(match[0]);
        status.show();

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

      // A match request sent to a player was declined or the player left
      match = msg.match(/^(\w+ declines the match offer\.)/m);
      if(!match) 
        match = msg.match(/^(\w+, whom you were challenging, has departed\.)/m);
      if(match && match.length > 1) {
        $('#pairing-pane-status').show();
        $('#pairing-pane-status').text(match[1]);
      }

      match = msg.match(/^(\w+ (accepts|declines) the partnership request\.)/m);
      if(match && match.length > 1) {
        let headerTitle = 'Partnership ' + (match[2] === 'accepts' ? 'Accepted' : 'Declined');
        let bodyTitle = match[1];
        createNotification(headerTitle, bodyTitle, '', null, null);
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

      match = msg.match(/^(Issuing match request since the seek was set to manual\.)/m);
      if(match && match.length > 1 && lobbyRequested) {
        $('#lobby-pane-status').text(match[1]); 
        $('#lobby-pane-status').show();
      }
        
      match = msg.match(/^Your seek has been posted with index \d+\./m);
      if(match) {
        // retrieve <sn> notification
        session.send('iset showownseek 1');
        session.send('iset seekinfo 1');
        session.send('iset seekinfo 0');
        session.send('iset showownseek 0');
        chat.newMessage('console', data);
        return;
      }

      match = msg.match(/^Your seeks have been removed\./m);
      if(!match) 
        match = msg.match(/^Your seek (\d+) has been removed\./m);
      if(match) {
        if(match.length > 1) // delete seek by id
          $('.sent-offer[data-offer-id="' + match[1] + '"]').remove();
        else  // Remove all seeks
          $('.sent-offer[data-offer-type="sn"]').remove();

        if(!$('#sent-offers-status').children().length)
          $('#sent-offers-status').hide();

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

            $('#player-rating').text(game.color === 'b' ? game.brating : game.wrating);
            $('#opponent-rating').text(game.color === 'b' ? game.wrating : game.brating);

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
        msg === 'seekinfo set.' || msg === 'seekinfo unset.' ||
        msg === 'seekremove set.' || msg === 'seekremove unset.' || 
        msg === 'defprompt set.' ||
        msg === 'nowrap set.' ||
        msg === 'startpos set.' || msg === 'startpos unset.' ||
        msg === 'showownseek set.' || msg === 'showownseek unset.' ||
        msg === 'pendinfo set.' || 
        msg === 'ms set.' ||
        msg.startsWith('No one is observing game ') 
      ) {
        return;
      }

      chat.newMessage('console', data);
      break;
  }
}

function showSentOffers(offers: any) {
  var requestsHtml = '';
  offers.forEach((offer) => {
    requestsHtml += `<div class="sent-offer" data-offer-type="` + offer.type + `" data-offer-id="` + offer.id + `">`;
    requestsHtml += `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>&nbsp;&nbsp;`;

    if(offer.type === 'pt') {
      if(offer.subtype === 'partner') {
        requestsHtml += 'Making a partnership offer to ' + offer.toFrom + '.';
        var removeCmd = 'withdraw ' + offer.id;
      }
      else if(offer.subtype === 'match') {
        // convert match offers to the same format as seeks
        let color = '';
        if(offer.color === 'black')
          color = ' B';
        else if(offer.color === 'white')
          color = ' W';

        // Display 'u' if we are a registered user playing an unrated game.
        let unrated = '';
        if(session.isRegistered() && offer.ratedUnrated === 'unrated') 
          unrated = 'u ';

        let time = offer.initialTime + ' ' + offer.increment + ' ';
        if(offer.category === 'untimed') {
          time = '';
          unrated = '';
        }

        requestsHtml += 'Challenging ' + offer.opponent + ' to ' + (time === '' ? 'an ' : 'a ') + time + unrated + offer.category + color + ' game.';
        var removeCmd = 'withdraw ' + offer.id;
      }
    }
    else if(offer.type === 'sn') {
      // Display 'u' if we are a registered user playing an unrated game.
      let unrated = '';
      if(session.isRegistered() && offer.ratedUnrated === 'u')
        unrated = 'u ';

      // Change 0 0 to 'untimed'
      let time = offer.initialTime + ' ' + offer.increment + ' ';
      if(offer.category === 'untimed') {
        unrated = '';
        time = '';
      }
      let color = (offer.color !== '?' ? offer.color : '');

      requestsHtml += 'Seeking ' + (time === '' ? 'an ' : 'a ') + time + unrated + offer.category + color + ' game.';
      var removeCmd = 'unseek ' + offer.id;
    }
    
    var lastIndex = requestsHtml.lastIndexOf(' ') + 1;
    var lastWord = requestsHtml.slice(lastIndex);
    requestsHtml = requestsHtml.substring(0, lastIndex);

    requestsHtml += `<span style="white-space: nowrap">` + lastWord + `<span class="fa fa-times-circle btn btn-default btn-sm" onclick="sessionSend('` + removeCmd + `')" aria-hidden="false"></span></span></div>`;
  });

  $('#sent-offers-status').append(requestsHtml);
  $('#sent-offers-status').show();
  $('#play-pane-subcontent')[0].scrollTop = 0;
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

function showCapturedMaterial(fen: string) {
  var whiteChanged = false;
  var blackChanged = false;

  const material = { 
    P: 0, R: 0, B: 0, N: 0, Q: 0, K: 0, p: 0, r: 0, b: 0, n: 0, q: 0, k: 0 
  };

  const pos = fen.split(/\s+/)[0];
  for(let i = 0; i < pos.length; i++) {
    if(material.hasOwnProperty(pos[i]))
      material[pos[i]]++;
  }
  
  var captured = { 
    P: 0, R: 0, B: 0, N: 0, Q: 0, K: 0, p: 0, r: 0, b: 0, n: 0, q: 0, k: 0 
  };

  if(game.category === 'crazyhouse' || game.category === 'bughouse') 
    captured = game.history.get().holdings; // for crazyhouse/bughouse we display the actual pieces captured
  else {
    // Get material difference between white and black, represented as "captured pieces"
    // e.g. if black is 2 pawns up on white, then 'captured' will contain P: 2 (two white pawns).
    var pieces = Object.keys(material).filter(key => key === key.toUpperCase());
    for(let whitePiece of pieces) {
      var blackPiece = whitePiece.toLowerCase(); 
      if(material[whitePiece] > material[blackPiece]) {
        captured[blackPiece] = material[whitePiece] - material[blackPiece];
        captured[whitePiece] = 0;
      }
      else {
        captured[whitePiece] = material[blackPiece] - material[whitePiece];
        captured[blackPiece] = 0;
      }
    }
  }

  if(prevCaptured !== undefined) {
    for(let key in captured) {
      if(prevCaptured[key] != captured[key]) {
        if(key === key.toUpperCase())
          blackChanged = true;
        else
          whiteChanged = true;
      }
    }
  }
  prevCaptured = captured; 

  if(whiteChanged) {
    let panel = (game.color === 'w' ? $('#player-captured') : $('#opponent-captured'));   
    panel.empty();
  }
  if(blackChanged) {
    let panel = (game.color === 'b' ? $('#player-captured') : $('#opponent-captured'));   
    panel.empty();
  } 

  for (const key in captured) {
    let panel = undefined;
    if(whiteChanged && key === key.toLowerCase() && captured[key] > 0) {
      var color = 'b';
      var piece = color + key.toUpperCase();
      var num = captured[key];
      panel = (game.color === 'w' ? $('#player-captured') : $('#opponent-captured'));
    }
    else if(blackChanged && key === key.toUpperCase() && captured[key] > 0) {
      var color = 'w';
      var piece = color + key;
      var num = captured[key];
      panel = (game.color === 'b' ? $('#player-captured') : $('#opponent-captured'));
    }
    if(panel) {
      panel.append(
        `<span class="captured-piece" id="` + piece + `"><img src="assets/css/images/pieces/merida/` +
          piece + `.svg"/><small>` + num + `</small></span>`);

      if(game.category === 'crazyhouse' || game.category === 'bughouse') {
        $('#' + piece)[0].addEventListener('touchstart', dragCapturedPiece, {passive: false});
        $('#' + piece)[0].addEventListener('mousedown', dragCapturedPiece);
      }
    }
  }
}

function dragCapturedPiece(event: any) {  
  lockOverflow();

  var id = $(event.currentTarget).attr('id');
  var color = id.charAt(0);
  var type = id.charAt(1);
  
  const cgRoles = {
    p: 'pawn',
    r: 'rook',
    n: 'knight',
    b: 'bishop',
    q: 'queen',
    k: 'king',
  };

  var piece = {
    role: cgRoles[type.toLowerCase()], 
    color: (color === 'w' ? 'black' : 'white')
  };
  board.dragNewPiece(piece, event);

  event.preventDefault();
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
        if(subvariation) {
          $('#exit-subvariation').show();
          $('#navigation-toolbar [data-bs-toggle="tooltip"]').tooltip('update');
        }
      }

      game.history.add(move, fen, subvariation, game.wtime, game.btime);
      getOpening();      
      updateVariantMoveData();
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
      game.history.updateClockTimes(index, game.wtime, game.btime);

    // move is already displayed
    if(index === game.history.index()) {
      setClocks();
      return;
    }

    // move is earlier, we need to take-back
    if(game.isPlaying() || game.isObserving()) {
      if(index < game.history.length()) {
        board.cancelPremove();
        board.cancelPredrop();
      }
      while(index < game.history.length())
        game.history.removeLast();
    }
  }

  game.history.display(index, move !== undefined);

  if(removeSubvariationRequested && !game.history.get(index).subvariation) {
    game.history.removeSubvariation();
    $('#exit-subvariation').tooltip('hide');
    $('#exit-subvariation').hide();
    removeSubvariationRequested = false;
  }
}

function updateVariantMoveData() {
  // Maintain map of captured pieces for crazyhouse variant
  if(game.category === 'crazyhouse' || game.category === 'bughouse') {
    var prevIndex = game.history.prev();
    var prevMove = game.history.get(prevIndex);

    var currMove = game.history.get();
    var move = currMove.move;

    if(prevMove.holdings === undefined)
      prevMove.holdings = {P: 0, R: 0, B: 0, N: 0, Q: 0, K: 0, p: 0, r: 0, b: 0, n: 0, q: 0, k: 0};

    var holdings = { ...prevMove.holdings };

    if(game.category === 'crazyhouse') {
      if(prevMove.promoted === undefined) 
        prevMove.promoted = [];

      var promoted = prevMove.promoted.slice();

      if(move.flags && move.flags.includes('c')) {
        var chess = new Chess(prevMove.fen);
        var piece = chess.get(move.to);
        let pieceType = (promoted.indexOf(move.to) !== -1 ? 'p' : piece.type);
        pieceType = (piece.color === 'w' ? pieceType.toUpperCase() : pieceType.toLowerCase());
        holdings[pieceType]++;
      }
      else if(move.flags && move.flags.includes('e')) {
        var color = History.getTurnColorFromFEN(prevMove.fen);
        let pieceType = (color === 'w' ? 'p' : 'P');
        holdings[pieceType]++;
      }

      promoted = updatePromotedList(move, promoted);
      currMove.promoted = promoted;
    }

    if(move.san && move.san.includes('@')) {
      var color = History.getTurnColorFromFEN(prevMove.fen);
      let pieceType = (color === 'w' ? move.piece.toLowerCase() : move.piece.toUpperCase());
      holdings[pieceType]--;
    }

    currMove.holdings = holdings;
  }
}

// Maintain a list of the locations of pieces which were promoted
// This is used by crazyhouse and bughouse variants, since capturing a promoted piece only gives you a pawn  
function updatePromotedList(move: any, promoted: any) {
  // Remove captured piece
  var index = promoted.indexOf(move.to);
  if(index !== -1) 
    promoted.splice(index, 1);
  // Update piece's location
  if(move.from) {
    var index = promoted.indexOf(move.from);
    if(index !== -1) 
      promoted[index] = move.to;  
  }
  // Add newly promoted piece to the list
  if(move.promotion)
    promoted.push(move.to);

  return promoted;
}

function setClocks() {
  var hEntry = game.history.get();

  if(!game.isPlaying() && game.role !== Role.OBSERVING) {
    clock.setWhiteClock(hEntry.wtime);
    clock.setBlackClock(hEntry.btime);
  }

  // Add my-turn highlighting to clock
  var whiteClock = (game.color === 'w' ? $('#player-clock') : $('#opponent-clock'));
  var blackClock = (game.color === 'b' ? $('#player-clock') : $('#opponent-clock'));
  var turnColor;
  if(game.isPlaying() || game.role === Role.OBSERVING)
    turnColor = game.chess.turn();
  else
    turnColor = History.getTurnColorFromFEN(hEntry.fen);

  if(turnColor === 'b') {
    whiteClock.removeClass('my-turn');
    blackClock.addClass('my-turn');
  }
  else {
    blackClock.removeClass('my-turn');
    whiteClock.addClass('my-turn');
  }
}

// Start clock after a move, switch from white to black's clock etc
function hitClock(setClocks: boolean = false) {
  if(game.isPlaying() || game.role === Role.OBSERVING) {
    const thisPly = History.getPlyFromFEN(game.chess.fen());  
    
    // If a move was received from the server, set the clocks to the updated times
    // Note: When in examine mode this is handled by setClocks() instead
    if(setClocks) { // Get remaining time from server message
      if(game.category === 'untimed') {
        clock.setWhiteClock(null); 
        clock.setBlackClock(null);
      }
      else {
        clock.setWhiteClock(); 
        clock.setBlackClock();
      }
    }
    else if(game.inc !== 0) { // Manually add time increment
      if(game.chess.turn() === 'w' && thisPly >= 5) 
        clock.setBlackClock(clock.getBlackTime() + game.inc * 1000);
      else if(game.chess.turn() === 'b' && thisPly >= 4)
        clock.setWhiteClock(clock.getWhiteTime() + game.inc * 1000);
    }

    if(thisPly >= 3 && game.chess.turn() === 'w') 
      clock.startWhiteClock();
    else if(thisPly >= 4 && game.chess.turn() === 'b') {
      clock.startBlackClock();
    }
  }
}

export function updateBoard(playSound = false) {
  const move = game.history.get().move;
  const fen = game.history.get().fen;

  setClocks();

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
    showDests: highlightsToggle,
    rookCastle: game.category === 'wild/fr'
  };

  board.set({
    turnColor,
    movable,
    highlight: {
      lastMove: highlightsToggle,
      check: highlightsToggle
    },
    predroppable: { enabled: game.category === 'crazyhouse' || game.category === 'bughouse' },
    check: localChess.in_check() ? toColor(localChess) : false,
    blockTouchScroll: (game.isPlaying() ? true : false),
  });

  showCapturedMaterial(fen);
  showOpeningName();
  setFontSizes(); 

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

    var options = {};
    if(numPVs > 1)
      options['MultiPV'] = numPVs;
    
    // Configure for variants
    if(game.category === 'wild/fr')
      options['UCI_Chess960'] = true;
    else if(game.category === 'crazyhouse')
      options['UCI_Variant'] = game.category;
    
    engine = new Engine(game.history, null, displayEnginePV, options);
    if(!movelistRequested)
      engine.move(game.history.index());
  }
}

function displayEnginePV(pvNum: number, pvEval: string, pvMoves: string) {
  $('#engine-pvs li').eq(pvNum - 1).html('<b>(' + pvEval + ')</b> ' + pvMoves + '<b/>');

  if(pvNum === 1 && pvMoves) {
    var words = pvMoves.split(/\s+/);
    var san = words[0].split(/\.+/)[1];
    var parsed = parseMove(game.history.get().fen, san, game.category);
    board.setAutoShapes([{
      orig: parsed.move.from || parsed.move.to, // For crazyhouse, just draw a circle on dest square
      dest: parsed.move.to,
      brush: 'yellow',
    }]);
  }
}

function getPlayComputerEngineOptions(): object {
  var skillLevels = [0, 1, 2, 3, 5, 7, 9, 11, 13, 15]; // Skill Level for each difficulty level
  
  var engineOptions = {}
  if(game.category === 'wild/fr')
    engineOptions['UCI_Chess960'] = true;
  else if(game.category === 'crazyhouse')
    engineOptions['UCI_Variant'] = game.category;

  engineOptions['Skill Level'] = skillLevels[game.difficulty - 1];

  return engineOptions;
}

function getPlayComputerMoveParams(): string {
  // Max nodes for each difficulty level. This is also used to limit the engine's thinking time
  // but in a way that keeps the difficulty the same across devices
  var maxNodes = [100000, 200000, 300000, 400000, 500000, 600000, 700000, 800000, 900000, 1000000];
  var moveParams = 'nodes ' + maxNodes[game.difficulty - 1];

  return moveParams;
}

function playComputer(params: any) {
  if(game.role === Role.PLAYING_COMPUTER) {
    game.role = Role.NONE;
    cleanupGame();
  }

  var playerName = (session.isConnected() ? session.getUser() : 'Player');
  var playerTimeRemaining = params.playerTime * 60000;
  if(params.playerTime === 0) {
    if(params.playerInc === 0) 
      playerTimeRemaining = null; // untimed game
    else
      playerTimeRemaining = 10000; // if initial player time is 0, player gets 10 seconds
  }

  var wname = (params.playerColor === 'White' ? playerName : 'Computer');
  var bname = (params.playerColor === 'Black' ? playerName : 'Computer');
  
  var category = params.gameType.toLowerCase();
  if(params.gameType === 'Chess960')
    category = 'wild/fr';

  var data = {
    fen: params.fen,                        // game state
    turn: 'W',                              // color whose turn it is to move ("B" or "W")
    id: -1,                                 // The game number
    wname: wname, // White's name
    bname: bname, // Black's name
    role: Role.PLAYING_COMPUTER,            // my relation to this game
    time: params.playerTime,                // initial time in seconds         
    inc: params.playerInc,                  // increment per move in seconds
    wtime: (params.playerColor === 'White' ? playerTimeRemaining : null), // White's remaining time
    btime: (params.playerColor === 'Black' ? playerTimeRemaining : null), // Black's remaining time
    moveNo: 1,                              // the number of the move about to be made
    move: 'none',                           // pretty notation for the previous move ("none" if there is none)
    flip: (params.playerColor === 'White' ? false : true), // whether game starts with board flipped
    category: category,                     // game variant or type
    color: params.playerColor === 'White' ? 'w' : 'b',
    difficulty: params.difficulty           // Computer difficulty level
  }

  // Show game status mmessage
  var computerName = 'Computer (Lvl ' + params.difficulty + ')'; 
  if(params.playerColor === 'White')
    bname = computerName;
  else
    wname = computerName;
  let time = ' ' + params.playerTime + ' ' + params.playerInc;
  if(params.playerTime === 0 && params.playerInc === 0)
    time = '';
  let gameType = '';
  if(params.gameType !== 'Standard')
    gameType = ' ' + params.gameType;
  const statusMsg = wname + ' vs. ' + bname + gameType + time;
  showStatusMsg(statusMsg);

  messageHandler(data); 
}

(window as any).rematchComputer = () => {
  if(lastComputerGame.playerColorOption === 'Any') 
    lastComputerGame.playerColor = (lastComputerGame.playerColor === 'White' ? 'Black' : 'White');
  playComputer(lastComputerGame);
};

function playComputerBestMove(bestMove: string, score: string) {
  var move;
  if(bestMove[1] === '@') // Crazyhouse/bughouse
    move = bestMove;
  else
    move = { 
      from: bestMove.slice(0,2),
      to: bestMove.slice(2,4),
      promotion: (bestMove.length === 5 ? bestMove[4] : undefined)
    }

  lastComputerMoveEval = score;

  var parsedMove = parseMove(game.chess.fen(), move, game.category);

  var moveData = {
    role: Role.PLAYING_COMPUTER,                      // game mode
    id: -1,                                           // game id, always -1 for playing computer
    fen: parsedMove.fen,                              // board/game state
    turn: History.getTurnColorFromFEN(parsedMove.fen), // color whose turn it is to move ("B" or "W")
    wtime: clock.getWhiteTime(),                      // White's remaining time
    btime: clock.getBlackTime(),                      // Black's remaining time
    moveNo: History.getMoveNoFromFEN(parsedMove.fen), // the number of the move about to be made
    moveVerbose: parsedMove,                          // verbose coordinate notation for the previous move ("none" if there werenone) [note this used to be broken for examined games]
    move: parsedMove.move.san,                        // pretty notation for the previous move ("none" if there is none)
  }
  messageHandler(moveData);  
}

function generateChess960FEN(): string {
  // Generate random Chess960 starting position using Scharnagl's method. 

  const kingsTable = {
    0: 'QNNRKR',   192: 'QNRKNR',   384: 'QRNNKR',   576: 'QRNKRN',   768: 'QRKNRN',   
    16: 'NQNRKR',   208: 'NQRKNR',   400: 'RQNNKR',   592: 'RQNKRN',   784: 'RQKNRN',   
    32: 'NNQRKR',   224: 'NRQKNR',   416: 'RNQNKR',   608: 'RNQKRN',   800: 'RKQNRN',   
    48: 'NNRQKR',   240: 'NRKQNR',   432: 'RNNQKR',   624: 'RNKQRN',   816: 'RKNQRN',   
    64: 'NNRKQR',   256: 'NRKNQR',   448: 'RNNKQR',   640: 'RNKRQN',   832: 'RKNRQN',   
    80: 'NNRKRQ',   272: 'NRKNRQ',   464: 'RNNKRQ',   656: 'RNKRNQ',   848: 'RKNRNQ',   
    96: 'QNRNKR',   288: 'QNRKRN',   480: 'QRNKNR',   672: 'QRKNNR',   864: 'QRKRNN',   
    112: 'NQRNKR',  304: 'NQRKRN',  496: 'RQNKNR',   688: 'RQKNNR',   880: 'RQKRNN',   
    128: 'NRQNKR',  320: 'NRQKRN',  512: 'RNQKNR',   704: 'RKQNNR',   896: 'RKQRNN',   
    144: 'NRNQKR',  336: 'NRKQRN',  528: 'RNKQNR',   720: 'RKNQNR',   912: 'RKRQNN',   
    160: 'NRNKQR',  352: 'NRKRQN',  544: 'RNKNQR',   736: 'RKNNQR',   928: 'RKRNQN',   
    176: 'NRNKRQ',  368: 'NRKRNQ',  560: 'RNKNRQ',   752: 'RKNNRQ',   944: 'RKRNNQ'
  };

  const bishopsTable = [
    ['B', 'B', '-', '-', '-', '-', '-', '-'],
    ['B', '-', '-', 'B', '-', '-', '-', '-'],
    ['B', '-', '-', '-', '-', 'B', '-', '-'],
    ['B', '-', '-', '-', '-', '-', '-', 'B'],
    ['-', 'B', 'B', '-', '-', '-', '-', '-'],
    ['-', '-', 'B', 'B', '-', '-', '-', '-'],
    ['-', '-', 'B', '-', '-', 'B', '-', '-'],
    ['-', '-', 'B', '-', '-', '-', '-', 'B'],
    ['-', 'B', '-', '-', 'B', '-', '-', '-'],
    ['-', '-', '-', 'B', 'B', '-', '-', '-'],
    ['-', '-', '-', '-', 'B', 'B', '-', '-'],
    ['-', '-', '-', '-', 'B', '-', '-', 'B'],
    ['-', 'B', '-', '-', '-', '-', 'B', '-'],
    ['-', '-', '-', 'B', '-', '-', 'B', '-'],
    ['-', '-', '-', '-', '-', 'B', 'B', '-'],
    ['-', '-', '-', '-', '-', '-', 'B', 'B']
  ];

  var idn = Math.floor(Math.random() * 960); // Get random Chess960 starting position identification number 
  var kIndex = idn - idn % 16; // Index into King's Table
  var bIndex = idn - kIndex; // Index into Bishop's Table
  var kEntry = kingsTable[kIndex];

  // Fill in empty spots in the row from Bishop's Table with pieces from the row in King's Table
  var backRow = [...bishopsTable[bIndex]]; // Copy row from array
  var p = 0;
  for(let sq = 0; sq < 8; sq++) {
    if(backRow[sq] === '-') {
      backRow[sq] = kEntry[p];
      p++;
    }
  }

  var whiteBackRow = backRow.join('');
  var blackBackRow = whiteBackRow.toLowerCase();
  var fen = blackBackRow + '/pppppppp/8/8/8/8/PPPPPPPP/' + whiteBackRow + ' w KQkq - 0 1';

  return fen;
}

function checkGameEnd() {  
  if(game.role !== Role.PLAYING_COMPUTER)
    return;

  var chess = game.chess;
  var gameEnd = false;
  var isThreefold = game.history.isThreefoldRepetition();
  var winner = '', loser = '';
  var turnColor = History.getTurnColorFromFEN(chess.fen());
  var gameStr = '(' + game.wname + ' vs. ' + game.bname + ')';

  // Check white or black is out of time
  if(clock.getWhiteTime() < 0 || clock.getBlackTime() < 0) {
    var wtime = clock.getWhiteTime();
    var btime = clock.getBlackTime();

    // Check if the side that is not out of time has sufficient material to mate, otherwise its a draw
    var insufficientMaterial = false;
    if(wtime < 0) 
      var fen = chess.fen().replace(' ' + 'w' + ' ', ' ' + 'b' + ' '); // Set turn color to the side not out of time in order to check their material
    else if(btime < 0) 
      var fen = chess.fen().replace(' ' + 'b' + ' ', ' ' + 'w' + ' ');

    chess.load(fen);
    insufficientMaterial = chess.insufficient_material();

    if(insufficientMaterial) {
      var reason = Reason.Draw;
      var reasonStr = (wtime < 0 ? game.wname : game.bname) + ' ran out of time and ' + (wtime >= 0 ? game.wname : game.bname) + ' has no material to mate';
      var scoreStr = '1/2-1/2';
    }
    else {
      winner = (wtime >= 0 ? game.wname : game.bname);
      loser = (wtime < 0 ? game.wname : game.bname);
      var reason = Reason.TimeForfeit;
      var reasonStr = loser + ' forfeits on time';
      var scoreStr = (winner === game.wname ? '1-0' : '0-1');
    }
    gameEnd = true;
  } 
  else if(chess.in_checkmate()) {
    winner = (turnColor === 'w' ? game.bname : game.wname);
    loser = (turnColor === 'w' ? game.wname : game.bname);
    var reason = Reason.Checkmate;
    var reasonStr = loser + ' checkmated';
    var scoreStr = (winner === game.wname ? '1-0' : '0-1');

    gameEnd = true;
  }
  else if(chess.in_draw() || isThreefold) {
    var reason = Reason.Draw;
    var scoreStr = '1/2-1/2';

    if(isThreefold) 
      var reasonStr = 'Game drawn by repetition';
    else if(chess.insufficient_material()) 
      var reasonStr = 'Neither player has mating material';
    else if(chess.in_stalemate()) 
      var reasonStr = 'Game drawn by stalemate';
    else 
      var reasonStr = 'Game drawn by the 50 move rule';

    gameEnd = true;
  }

  if(gameEnd) { 
    var gameEndData = {
      game_id: -1,
      winner,
      loser,
      reason,
      message: gameStr + ' ' + reasonStr + ' ' + scoreStr
    };
    messageHandler(gameEndData);  
  }
}

async function showOpeningName() {
  await fetchOpeningsPromise; // Wait for the openings file to be loaded

  var index = game.history.index();
  if(index === 0)
    index = game.history.last();

  var hItem = game.history.get(index);
  while(!hItem.opening) {
    index = game.history.prev(index);
    if(index === undefined)
      return;
    hItem = game.history.get(index);
  }

  $('#opening-name').text(hItem.opening.name);
  $('#opening-name').show();
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
  if(!activeTab.length)
    activeTab = $('#pills-play-tab');
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

$('#lobby-table-container').on('scroll', (e) => {
  var container = $('#lobby-table-container')[0];
  lobbyScrolledToBottom = container.scrollHeight - container.clientHeight < container.scrollTop + 1.5;
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

(window as any).setNewGameVariant = (title: string, command: string) => {
  newGameVariant = command;
  $('#variants-button').text(title); 
  if(command === 'bughouse') 
    $('#opponent-player-name').attr('placeholder', 'Enter opponent\'s username');
  else 
    $('#opponent-player-name').attr('placeholder', 'Anyone');
};

(window as any).setNewGameRated = (option: string) => {
  if(!session.isRegistered() && option === 'Rated') {
    $('#rated-unrated-menu').popover({
      animation: true,
      content: 'You must be registered to play rated games. <a href="https://www.freechess.org/cgi-bin/Register/FICS_register.cgi?Language=English" target="_blank">Register now</a>.',
      html: true,
      placement: 'top',
    });
    $('#rated-unrated-menu').popover('show');
    return;
  }

  $('#rated-unrated-button').text(option);
};

(window as any).setNewGameColor = (option: string) => {
  $('#player-color-button').text(option);
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

  clock = new Clock(game, checkGameEnd);
  
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

  $('input').each(function() {
    selectOnFocus($(this));
  });
  
  prevWindowWidth = NaN;
  // Here we create a temporary hidden element in order to measure its scrollbar width.
  $('body').append(`<div id="scrollbar-measure" style="position: absolute; top: -9999px; overflow: scroll"></div>`);
  scrollBarWidth = $('#scrollbar-measure')[0].offsetWidth - $('#scrollbar-measure')[0].clientWidth;
  $('#scrollbar-measure').remove();
  
  // Change layout for mobile or desktop and resize panels 
  // Split it off into a timeout so that onDeviceReady doesn't take too long.
  setTimeout(() => { $(window).trigger('resize'); }, 0);

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
  setTimeout(() => { // Split this off since it's quite slow.
    $('[data-bs-toggle="tooltip"]').each(function(index, element) {  
      createTooltip($(element));
    });
  }, 0);
}

function selectOnFocus(input: any) {
  $(input).on('focus', function (e) {  
    $(this).one('mouseup', function (e) {
      setTimeout(() => { $(this).trigger('select'); }, 0);
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
  layout = Layout.Mobile;
}

function useDesktopLayout() {
  swapLeftRightPanelHeaders();
  $('#chat-maximize-btn').show();
  $('#stop-observing').appendTo($('#close-game-panel').last());
  $('#stop-examining').appendTo($('#close-game-panel').last());
  if(game.isObserving() || game.isExamining())
    showCloseGamePanel();
  createTooltips();
  layout = Layout.Desktop;
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
  if(!isSmallWindow() && isSmallWindow(prevWindowWidth)) {
    $('#mid-panel-header').css('height', '');
    $('#mid-panel-footer').css('height', '');
  }

  // Make sure the board is smaller than the window height and also leaves room for the other columns' min-widths
  if(!isSmallWindow()) {
    // Set board width a bit smaller in order to leave room for a scrollbar on <body>. This is because 
    // we don't want to resize all the panels whenever a dropdown or something similar overflows the body.   
    var cardBorderWidth = $('#mid-card').outerWidth() - $('#mid-card').width();
    var bordersWidth = cardBorderWidth + scrollBarWidth;
    if(window.innerWidth < 992) // display 2 columns on md (medium) display
      var boardMaxWidth = window.innerWidth - $('#left-col').outerWidth() - bordersWidth;
    else
      var boardMaxWidth = window.innerWidth - $('#left-col').outerWidth() - parseFloat($('#right-col').css('min-width')) - bordersWidth;    
    
    var feature3Border = $('.feature3').outerHeight(true) - $('.feature3').height();
    var cardBorderHeight = $('#mid-card').outerHeight() - $('#mid-card').height();
    var bordersHeight = feature3Border + cardBorderHeight;
    var boardMaxHeight = $(window).height() - $('#mid-panel-header').outerHeight()
        - $('#mid-panel-footer').outerHeight() - bordersHeight;
    
    var boardWidth = Math.min(boardMaxWidth, boardMaxHeight) - 0.1; // Subtract 0.1 for rounding error

    // Force resizing of bootstrap row after scrollbars disappear
    setTimeout(() => { $('#mid-card').width($('#mid-card').width()); }, 0);
  }
  else {
    $('#mid-card').css('width', '');
    var boardWidth = $('#mid-card').width();
  }

  // Recalculate the width of the board so that the squares align to integer pixel boundaries, this is to match 
  // what chessground does internally
  boardWidth = (Math.floor((boardWidth * window.devicePixelRatio) / 8) * 8) / window.devicePixelRatio + 0.1;
  // Set board width
  $('#mid-card').width(boardWidth);

  // Set the height of dynamic elements inside left and right panel collapsables.
  // Try to do it in a robust way that won't break if we add/remove elements later.

  // Get and store the height of the address bar in mobile browsers.
  if(addressBarHeight === undefined)
    addressBarHeight = $(window).height() - window.innerHeight;

  // On mobile, slim down player status panels in order to fit everything within window height
  if(isSmallWindow()) {
    const originalStatusHeight = $('#left-panel-header').height();
    const cardBorders = $('#mid-card').outerHeight() - $('#mid-card').height()
      + Math.round(parseFloat($('#left-card').css('border-bottom-width')))
      + Math.round(parseFloat($('#right-card').css('border-top-width')));
    const playerStatusBorder = $('#mid-panel-header').outerHeight() - $('#mid-panel-header').height();
    var playerStatusHeight = ($(window).height() - addressBarHeight - $('#board-card').outerHeight() - $('#left-panel-footer').outerHeight() - $('#right-panel-header').outerHeight() - cardBorders) / 2 - playerStatusBorder;
    playerStatusHeight = Math.min(Math.max(playerStatusHeight, originalStatusHeight - 20), originalStatusHeight);

    $('#mid-panel-header').height(playerStatusHeight);
    $('#mid-panel-footer').height(playerStatusHeight);
  }

  // set height of left menu panel inside collapsable
  const boardHeight = $('#board').innerHeight();
  if (boardHeight) {
    if($('#left-panel').height() === 0)
        $('#left-panel-bottom').css('height', '');

    var siblingsHeight = 0;
    var siblings = $('#collapse-history').siblings();
    siblings.each(function() {
      if($(this).is(':visible'))
        siblingsHeight += $(this).outerHeight();
    });
    const leftPanelBorder = $('#left-panel').outerHeight() - $('#left-panel').height();

    if(isSmallWindow()) 
      $('#left-panel').css('height', ''); // Reset back to CSS defined height
    else {
      var leftPanelHeight = boardHeight - leftPanelBorder - siblingsHeight;
      $('#left-panel').height(Math.max(leftPanelHeight, 0));
      // If we've made the left panel height as small as possible, reduce size of status panel instead
      // Note leftPanelHeight is negative in that case
      if(leftPanelHeight < 0)
        $('#left-panel-bottom').height($('#left-panel-bottom').height() + leftPanelHeight);
    }
  }

  // set height of right panel inside collapsable
  var siblingsHeight = 0;
  var siblings = $('#collapse-chat').siblings();
  siblings.each(function() {
    if($(this).is(':visible'))
      siblingsHeight += $(this).outerHeight();
  });
  const rightPanelBorder = $('#right-panel').outerHeight() - $('#right-panel').height();

  if(isSmallWindow() || !boardHeight) {
    var stuff = $(window).height() - addressBarHeight - rightPanelBorder - siblingsHeight
    - $('#right-panel-header').outerHeight() - $('#right-panel-footer').outerHeight();
    var feature3Border = $('.feature3').outerHeight(true) - $('.feature3').height();
    var rightCardBorder = $('#right-card').outerHeight(true) - $('#right-card').height();
    var borders = rightPanelBorder + rightCardBorder + feature3Border + addressBarHeight;
    $('#right-panel').height($(window).height() - borders - siblingsHeight
        - $('#right-panel-header').outerHeight() - $('#right-panel-footer').outerHeight());
  }
  else
    $('#right-panel').height(boardHeight - rightPanelBorder - siblingsHeight);

  // Adjust Notifications drop-down width
  if(isSmallWindow() && !isSmallWindow(prevWindowWidth)) 
    $('#notifications').css('width', '100%');
  else if(isMediumWindow() && !isMediumWindow(prevWindowWidth)) 
    $('#notifications').css('width', '50%');
  else if(isLargeWindow()) 
    $('#notifications').width($(document).outerWidth(true) - $('#left-col').outerWidth(true) - $('#mid-col').outerWidth(true));
}

function calculateFontSize(container: any, containerMaxWidth: number, minWidth?: number, maxWidth?: number) {
  if(minWidth === undefined)
    var minWidth = +$('body').css('font-size').replace('px', '');
  if(maxWidth === undefined)
    var maxWidth = +container.css('font-size').replace('px', '');

  var fontFamily = container.css('font-family');
  var fontWeight = container.css('font-weight');

  var canvas = document.createElement("canvas");
  var context = canvas.getContext("2d");
  
  function getTextWidth(text, font) {
    context.font = font;
    var metrics = context.measureText(text);
    return metrics.width;
  }

  var fontSize = maxWidth + 1; // Initial font size
  var textWidth;
  do {
    fontSize--;
    textWidth = getTextWidth(container.text(), fontWeight + ' ' + fontSize + 'px ' + fontFamily);
  } while (textWidth > containerMaxWidth && fontSize > minWidth);
  return fontSize;
}

async function getOpening() {
  var historyItem = game.history.get();
  
  var fetchOpenings = async () => {
    var inputFilePath = 'assets/data/openings.tsv';
    openings = new Map();
    var chess = new Chess();
    await fetch(inputFilePath)
    .then(response => response.text())
    .then(data => {
      const rows = data.split('\n');
      for(const row of rows) {
        var cols = row.split('\t');
        if(cols.length === 4 && cols[2].startsWith('1.')) {
          var eco = cols[0];
          var name = cols[1];
          var moves = cols[2];
          var fen = cols[3];
          var fenNoPlyCounts = fen.split(' ').slice(0, -2).join(' ');
          openings.set(fenNoPlyCounts, {eco, name, moves}); 
        }
      }
    })
    .catch(error => {
      console.error('Couldn\'t fetch opening:', error);
    });
  };

  if(!openings && !fetchOpeningsPromise) {
    fetchOpeningsPromise = fetchOpenings();
  }
  await fetchOpeningsPromise;

  var fen = historyItem.fen.split(' ').slice(0, -2).join(' '); // Remove ply counts
  var opening = null;
  if(['blitz', 'lightning', 'untimed', 'standard', 'nonstandard'].includes(game.category)) 
    var opening = openings.get(fen);
  
  historyItem.opening = opening;
}

$(document).ready(() => {
  if ((window as any).cordova !== undefined) {
    document.addEventListener('deviceready', onDeviceReady, false);
  } else {
    onDeviceReady();
  }
});

function lockOverflow() {
  // Stop scrollbar appearing when an element (like a captured piece) is dragged below the bottom of the window,
  // unless the scrollbar is already visible
  if($('body')[0].scrollHeight <= $('body')[0].clientHeight) {
    $('body').css('overflow-y', 'hidden');
    $('html').css('overflow-y', 'hidden');
    $(document).one('mouseup touchend touchcancel', (e) => {
      $('body').css('overflow-y', '');
      $('html').css('overflow-y', '');
    });
  }
}

// Prevent screen dimming, must be enabled in a user input event handler
$(document).one('click', (event) => {
  if (wakelockToggle) {
    noSleep.enable();
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
  if(!game.isPlaying()) {
    showStatusMsg('You are not playing a game.');
    return;
  }

  if(game.role === Role.PLAYING_COMPUTER) {
    var winner = (game.color === 'w' ? game.bname : game.wname);
    var loser = (game.color === 'w' ? game.wname : game.bname);
    var gameStr = '(' + game.wname + ' vs. ' + game.bname + ')';
    var reasonStr = loser + ' resigns';
    var scoreStr = (winner === game.wname ? '1-0' : '0-1');
    var gameEndData = {
      game_id: -1,
      winner,
      loser,
      reason: Reason.Resign,
      message: gameStr + ' ' + reasonStr + ' ' + scoreStr
    };
    messageHandler(gameEndData);  
  }
  else 
    session.send('resign');
});

$('#abort').on('click', (event) => {
  if(!game.isPlaying()) {
    showStatusMsg('You are not playing a game.');
    return;
  }

  if(game.role === Role.PLAYING_COMPUTER) {
    var gameStr = '(' + game.wname + ' vs. ' + game.bname + ')';
    var reasonStr = 'Game aborted';
    var gameEndData = {
      game_id: -1,
      winner: '',
      loser: '',
      reason: Reason.Abort,
      message: gameStr + ' ' + reasonStr
    };
    messageHandler(gameEndData);  
  }
  else 
    session.send('abort');
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
  if(game.chess !== null) {
    if(game.role === Role.PLAYING_COMPUTER) {
      // Computer accepts a draw if they're behind or it's dead equal and the game is on move 30 or beyond
      var gameEval = lastComputerMoveEval;
      if(gameEval === null)
        gameEval = '';
      gameEval = gameEval.replace(/[#+=]/, '');
      if(gameEval !== '' && game.history.length() >= 60 && (game.color === 'w' ? +gameEval >= 0 : +gameEval <= 0)) {
        var gameStr = '(' + game.wname + ' vs. ' + game.bname + ')';
        var reasonStr = 'Game drawn by mutual agreement';
        var scoreStr = '1/2-1/2';
        var gameEndData = {
          game_id: -1,
          winner: '',
          loser: '',
          reason: Reason.Draw,
          message: gameStr + ' ' + reasonStr + ' ' + scoreStr
        };
        messageHandler(gameEndData);  
      }
      else 
        showBoardModal('Draw Offer Declined', '', 'Computer declines the draw offer', [], [], false, false);
    }
    else
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

  var ratedUnrated = ($('#rated-unrated-button').text() === 'Rated' ? 'r' : 'u');
  var colorName = $('#player-color-button').text();
  var color = '';
  if(colorName === 'White')
    color = 'W ';
  else if(colorName === 'Black')
    color = 'B ';

  matchRequested++;

  const cmd: string = (opponent !== '') ? 'match ' + opponent : 'seek'; 
  if(game.isExamining())
    session.send('unex'); 
  session.send(cmd + ' ' + min + ' ' + sec + ' ' + ratedUnrated + ' ' + color + newGameVariant);
}
(window as any).getGame = getGame;

function clearMatchRequests() {
  matchRequested = 0;
  $('#sent-offers-status').html('');
  $('#sent-offers-status').hide();
}

$('#input-text').on('focus', () => {
  $('#board')[0].addEventListener('touchstart', (event) => {
    $('#input-text').trigger('blur');
  }, {once: true, passive: true}); // Got sick of Google Chrome complaining about passive event listeners
});

$('#quick-game').on('click', (event) => {
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
  const sec: string = getValue('#custom-control-inc');
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
          sendMove(nextMove.move);
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
      $('#exit-subvariation').tooltip('hide');
      $('#exit-subvariation').hide();
    }
  }
  else {
    game.history.removeSubvariation();
    $('#exit-subvariation').tooltip('hide');
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

$('#notifications-toggle').prop('checked', notificationsToggle);
$('#notifications-toggle').on('click', (event) => {
  notificationsToggle = !notificationsToggle;
  Cookies.set('notifications', String(notificationsToggle), { expires: 365 })
});

$('#autopromote-toggle').prop('checked', autoPromoteToggle);
$('#autopromote-toggle').on('click', (event) => {
  autoPromoteToggle = !autoPromoteToggle;
  Cookies.set('autopromote', String(autoPromoteToggle), { expires: 365 })
});

$('#highlights-toggle').prop('checked', highlightsToggle);
$('#highlights-toggle').on('click', (event) => {
  highlightsToggle = !highlightsToggle;
  updateBoard();
  Cookies.set('highlights', String(highlightsToggle), { expires: 365 })
});

$('#wakelock-toggle').prop('checked', wakelockToggle);
$('#wakelock-toggle').on('click', (event) => {
  wakelockToggle = !wakelockToggle;
  if (wakelockToggle) {
    noSleep.enable();
  } else {
    noSleep.disable();
  }
  Cookies.set('wakelock', String(wakelockToggle), { expires: 365 })
});

$('#chattabs-toggle').prop('checked', chattabsToggle);
$('#chattabs-toggle').on('click', (event) => {
  chattabsToggle = !chattabsToggle;
  Cookies.set('chattabs', String(chattabsToggle), { expires: 365 })
});

$('#disconnect').on('click', (event) => {
  if (session) 
    session.disconnect();
});

$('#play-computer-form').on('submit', (event) => {
  $('#play-computer-modal').modal('hide');
  event.preventDefault();

  const params = {
    playerColorOption: $('[name="play-computer-color"]:checked').next().text(),
    playerColor: '',
    playerTime: +$('#play-computer-min').val(),
    playerInc: +$('#play-computer-inc').val(),
    gameType: $('[name="play-computer-type"]:checked').next().text(),
    difficulty: $('[name="play-computer-level"]:checked').next().text(),
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  };

  if(params.playerColorOption === 'Any') {
    if(!lastComputerGame) 
      params.playerColor = (Math.random() < 0.5 ? 'White' : 'Black');
    else
      params.playerColor = (lastComputerGame.playerColor === 'White' ? 'Black' : 'White');
  }
  else
    params.playerColor = params.playerColorOption;

  if(params.gameType === 'Chess960')
    params.fen = generateChess960FEN();

  lastComputerGame = params;
  playComputer(params);
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

// Hide popover if user clicks anywhere outside
$('body').on('click', function (e) {
  if(!$('#rated-unrated-menu').is(e.target) 
      && $('#rated-unrated-menu').has(e.target).length === 0
      && $('.popover').has(e.target).length === 0)
    $('#rated-unrated-menu').popover('dispose');
});

$(window).on('resize', () => {
  if(!$('#mid-col').is(':visible'))
    layout = Layout.ChatMaximized;
  else if(layout === Layout.ChatMaximized)
    layout = Layout.Desktop;

  if(isSmallWindow() && layout === Layout.Desktop)
    useMobileLayout();
  else if(!isSmallWindow() && layout === Layout.Mobile)
    useDesktopLayout();

  setPanelSizes();
  setFontSizes();

  prevWindowWidth = window.innerWidth;

  if(evalEngine)
    evalEngine.redraw();
});

function setFontSizes() {
  // Resize fonts for player and opponent name to fit
  $('#opponent-name').css('font-size', ''); 
  var nameBorderWidth = $('#opponent-name').outerWidth() - $('#opponent-name').width();
  var nameMaxWidth = $('#opponent-name-rating').width() - $('#opponent-rating').outerWidth() - nameBorderWidth;
  var fontSize = calculateFontSize($('#opponent-name'), nameMaxWidth);
  $('#opponent-name').css('font-size', fontSize + 'px');

  $('#player-name').css('font-size', ''); 
  var nameBorderWidth = $('#player-name').outerWidth() - $('#player-name').width();
  var nameMaxWidth = $('#player-name-rating').width() - $('#player-rating').outerWidth() - nameBorderWidth;
  var fontSize = calculateFontSize($('#player-name'), nameMaxWidth);
  $('#player-name').css('font-size', fontSize + 'px');
}

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
  if(game.isPlaying() && game.role !== Role.PLAYING_COMPUTER) {
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
  else if($('#pills-pairing').hasClass('active'))
    initPairingPane();
});

$(document).on('shown.bs.tab', 'button[data-bs-target="#pills-lobby"]', (e) => {
  initLobbyPane();
});

$(document).on('shown.bs.tab', 'button[data-bs-target="#pills-pairing"]', (e) => {
  initPairingPane();
});

$(document).on('hidden.bs.tab', 'button[data-bs-target="#pills-play"]', (e) => {
  $('#play-computer-modal').modal('hide');
});

function initLobbyPane() {
  if(!session || !session.isConnected())
    $('#lobby').hide();
  else if(game.isExamining() || (game.isPlaying() && game.role !== Role.PLAYING_COMPUTER)) {
    if(game.isExamining())
      $('#lobby-pane-status').text('Can\'t enter lobby while examining a game.');
    else
      $('#lobby-pane-status').text('Can\'t enter lobby while playing a game.');
    $('#lobby-pane-status').show();
    $('#lobby').hide();
  }
  else {
    $('#lobby-pane-status').hide();
    $('#lobby-show-computers').prop('checked', lobbyShowComputersToggle);
    $('#lobby').show();
    $('#lobby-table').html('');
    lobbyScrolledToBottom = true;
    lobbyRequested = true;
    lobbyEntries.clear();
    session.send('iset seekremove 1');
    session.send('iset seekinfo 1');
  }
}

function initPairingPane() {
  // If user has changed from unregistered to registered or vice versa, set Rated/Unrated option
  // in pairing panel appopriately. 
  if(session && isRegistered !== session.isRegistered()) {  
    isRegistered = session.isRegistered();      
    $('#rated-unrated-button').text((isRegistered ? 'Rated' : 'Unrated'));
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

function formatLobbyEntry(seek: any): string {
  var title = (seek.title !== '' ? '(' + seek.title + ')' : '');
  var color = (seek.color !== '?' ? ' ' + seek.color : '');
  var rating = (seek.rating !== '' ? '(' + seek.rating + ')' : '');
  return seek.toFrom + title + rating + ' ' + seek.initialTime + ' ' + seek.increment + ' ' 
      + seek.ratedUnrated + ' ' + seek.category + color;
}



