// Copyright 2023 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import Chess from 'chess.js';
import Cookies from 'js-cookie';
import { Chessground } from 'chessground';
import { Color, Key } from 'chessground/types';
import { Polyglot } from 'cm-polyglot/src/Polyglot.js';
import PgnParser from '@mliebelt/pgn-parser';
import NoSleep from '@uriopass/nosleep.js'; // Prevent screen dimming
import Chat from './chat';
import { Clock } from './clock';
import { Engine, EvalEngine } from './engine';
import { Game, GameData, Role, NewVariationMode } from './game';
import { History, HEntry } from './history';
import { GetMessageType, MessageType, Session } from './session';
import * as Sounds from './sounds';
import { Reason } from './parser';
import './ui';
import packageInfo from '../package.json';
import { createPopper, Placement } from '@popperjs/core';
import { move } from 'chessground/drag';

export const enum Layout {
  Desktop = 0,
  Mobile,
  ChatMaximized
}

const enum SizeCategory {
  Small = 0,
  Medium,
  Large
}

let session: Session;
let chat: Chat;
let engine: Engine | null;
let evalEngine: EvalEngine | null;
let playEngine: Engine | null;

// toggle game sounds
let soundToggle: boolean = (Cookies.get('sound') !== 'false');
// toggle for auto-promote to queen
let autoPromoteToggle: boolean = (Cookies.get('autopromote') === 'true');
// toggle for showing Computer opponents in the lobby
let lobbyShowComputersToggle: boolean = (Cookies.get('lobbyshowcomputers') === 'true');
// toggle for showing Rated games in the lobby
let lobbyShowUnratedToggle: boolean = (Cookies.get('lobbyshowunrated') !== 'false');
// toggle for automatically showing new slide-down notifications or notifications in chat channels
export let notificationsToggle: boolean = (Cookies.get('notifications') !== 'false');
// toggle for showing highlights/graphics on the board
let highlightsToggle: boolean = (Cookies.get('highlights') !== 'false');
// toggle for showing highlights/graphics on the board
let wakelockToggle: boolean = (Cookies.get('wakelock') !== 'false');
// toggle for multi-board mode / single-board mode
let multiboardToggle: boolean = (Cookies.get('multiboard') !== 'false');
// toggle for creating a window for chat
export let chattabsToggle: boolean = (Cookies.get('chattabs') !== 'false');

let historyRequested = 0;
let obsRequested = 0;
let allobsRequested = 0;
let gamesRequested = false;
let lobbyRequested = false;
let channelListRequested = false;
let computerListRequested = false;
let gameExitPending = [];
let examineModeRequested: Game | null = null;
let computerList = [];
let dialogCounter = 0;
let numPVs = 1;
let matchRequested = 0;
let prevSizeCategory = null;
let layout = Layout.Desktop;
let addressBarHeight;
let soundTimer
let showSentOffersTimer; // Delay showing new offers until the user has finished clicking buttons
let newSentOffers = []; // New sent offers (match requests and seeks) that are waiting to be displayed
let activeTab;
let newGameVariant = '';
let lobbyEntries = new Map();
let lobbyScrolledToBottom;
let noSleep = new NoSleep(); // Prevent screen dimming
let openings; // Opening names with corresponding moves
let fetchOpeningsPromise = null; 
let book; // Opening book used in 'Play Computer' mode
let isRegistered = false;
let lastComputerGame = null; // Attributes of the last game played against the Computer. Used for Rematch and alternating colors each game.
let gameWithFocus: Game = null;
let games: Game[] = []; 
let partnerGameId = null;
let lastPointerCoords = {x: 0, y: 0}; // Stores the pointer coordinates from the last touch/mouse event
let touchStarted = false; // Keeps track of whether a touch is in progress
const mainBoard: any = createBoard($('#main-board-area').children().first().find('.board'));

$(document).ready(() => {
  if ((window as any).cordova !== undefined) {
    document.addEventListener('deviceready', onDeviceReady, false);
  } else {
    onDeviceReady();
  }
});

function onDeviceReady() {
  var game = createGame();
  game.role = Role.NONE;
  game.category = 'untimed';
  game.history = new History(game, new Chess().fen());
  setGameWithFocus(game);

  disableOnlineInputs(true);

  if(isSmallWindow()) {
    $('#collapse-chat').collapse('hide');
    $('#collapse-menus').collapse('hide');
    setViewModeList(); 
  }
  else {
    createTooltips();
    $('#pills-play-tab').tab('show');
    $('#collapse-menus').removeClass('collapse-init');
    $('#collapse-chat').removeClass('collapse-init');
    $('#chat-toggle-btn').toggleClass('toggle-btn-selected');
  }

  $('input').each(function() {
    selectOnFocus($(this));
  });
  
  // Here we create a temporary hidden element in order to measure its scrollbar width.
  $('body').append(`<div id="scrollbar-measure" style="position: absolute; top: -9999px; overflow: scroll"></div>`);
  
  // Change layout for mobile or desktop and resize panels 
  // Split it off into a timeout so that onDeviceReady doesn't take too long.
  setTimeout(() => { $(window).trigger('resize'); }, 0);

  const user = Cookies.get('user');
  const pass = Cookies.get('pass');
  if (user !== undefined && pass !== undefined) {
    session = new Session(messageHandler, user, atob(pass));
  } else {
    session = new Session(messageHandler);
  }

  initDropdownSubmenus();
}

$(window).on('load', function() {
  $('#left-panel-header').css('visibility', 'visible');
  $('#right-panel-header').css('visibility', 'visible');
});

/** Prompt before unloading page if in a game */
$(window).on('beforeunload', () => {
  var game = getPlayingExaminingGame();
  if(game && game.isPlaying()) 
    return true;
});

// Prevent screen dimming, must be enabled in a user input event handler
$(document).one('click', (event) => {
  if (wakelockToggle) {
    noSleep.enable();
  }
});

function cleanupGame(game: Game) {
  if(playEngine && game.role === Role.PLAYING_COMPUTER) {
    playEngine.terminate();
    playEngine = null;
  }

  game.role = Role.NONE;

  if(game === gameWithFocus) {
    hideButton($('#stop-observing'));
    hideButton($('#stop-examining'));
    hideLeftPanelHeader2();
    $('#takeback').prop('disabled', false);
    $('#play-computer').prop('disabled', false);  
    $('#playing-game-buttons').hide();
    $('#viewing-game-buttons').show();
    $('#lobby-pane-status').hide();
  }

  game.element.find($('[title="Close"]')).css('visibility', 'visible');
  game.element.find('.title-bar-text').text('');
  game.statusElement.find('.game-id').remove();
  
  if(chat)
    chat.closeGameTab(game.id);
  hidePromotionPanel(game);
  game.clock.stopClocks();

  if(game.watchersInterval) 
    clearInterval(game.watchersInterval);
  game.watchersInterval = null;
  game.watchers = [];
  game.statusElement.find('.game-watchers').empty();

  game.id = null;
  delete game.chess;
  game.chess = null;
  game.partnerGameId = null;
  game.commitingMovelist = false;
  game.movelistRequested = 0;
  game.gameStatusRequested = false;
  game.board.cancelMove();
  updateBoard(game);
  initStatusPanel();
  initGameTools(game);

  if($('#pills-play').hasClass('active') && $('#pills-lobby').hasClass('active'))
    initLobbyPane();

  game.bufferedHistoryEntry = null;
  game.bufferedHistoryCount = 0;
  game.removeMoveRequested = null;
}

export function cleanup() {
  partnerGameId = null;
  historyRequested = 0;
  obsRequested = 0;
  allobsRequested = 0;
  gamesRequested = false;
  lobbyRequested = false;
  channelListRequested = false;
  computerListRequested = false;
  examineModeRequested = null;
  gameExitPending = [];
  clearMatchRequests();
  clearNotifications();
  games.forEach((game) => {
    if(game.role !== Role.PLAYING_COMPUTER)
      cleanupGame(game);
  });
}

export function disableOnlineInputs(disable: boolean) {
  $('#pills-pairing *').prop('disabled', disable);
  $('#pills-lobby *').prop('disabled', disable);
  $('#quick-game').prop('disabled', disable);
  $('#pills-history *').prop('disabled', disable);
  $('#pills-observe *').prop('disabled', disable);
  $('#chan-dropdown *').prop('disabled', disable);
  $('#input-form *').prop('disabled', disable);
}

function createEvalEngine(game: Game) {
  if(game.category && Engine.categorySupported(game.category)) {
    // Configure for variants
    var options = {};
    if(game.category === 'wild/fr')
      options['UCI_Chess960'] = true;
    else if(game.category === 'crazyhouse')
      options['UCI_Variant'] = game.category;
    
    evalEngine = new EvalEngine(game, options);
  }
}

function initAnalysis(game: Game) {
  // Check if game category (variant) is supported by Engine
  if(game === gameWithFocus) {
    if(evalEngine) {
      evalEngine.terminate();
      evalEngine = null;
    }

    if(game.category) {
      if(Engine.categorySupported(game.category)) {
        if(game.id != -1 || game.history.length()) 
          showAnalyzeButton();
      }
      else 
        hideAnalysis();  
    }

    if($('#eval-graph-panel').is(':visible'))
      createEvalEngine(game);
  }
}

function hideLeftPanelHeader2() {
  $('#left-panel-header-2').hide();
  setLeftColumnSizes();
}

function showLeftPanelHeader2() {
  $('#left-panel-header-2').show();
  setLeftColumnSizes();
}

function hideStatusPanel() {
  $('#show-status-panel').text('Status/Analysis');
  $('#show-status-panel').attr('title', 'Show Status Panel');
  $('#show-status-panel').show();
  $('#left-panel-bottom').hide();
  stopEngine();
  setLeftColumnSizes();
}

function showStatusPanel() {
  $('#left-panel-bottom').show();
  initStatusPanel();
  setLeftColumnSizes();
}

function initStatusPanel() {
  if(gameWithFocus.isPlaying()) {
    $('#close-status').hide(); 
    hideAnalysis();
  }
  else if($('#left-panel-bottom').is(':visible')) {
    if(gameWithFocus.analyzing) 
      showAnalysis();
    else
      hideAnalysis();

    showAnalyzeButton();
    if($('#engine-tab').is(':visible') && evalEngine) 
      evalEngine.evaluate();
    $('#close-status').show();
  }
}

function showPromotionPanel(game: Game, premove: boolean = false) {
  var source = game.movePieceSource;
  var target = game.movePieceTarget;
  var metadata = game.movePieceMetadata;

  game.promoteIsPremove = premove;
  var orientation = game.board.state.orientation;
  var color = (target.charAt(1) === '8' ? 'white' : 'black');
  var fileNum = target.toLowerCase().charCodeAt(0) - 97;

  // Add temporary pieces to the DOM in order to retrieve the background-image style from them
  var pieces = $('<div class="cg-wrap d-none"></div>').appendTo($('body'));
  var bgQueen = $('<piece class="queen ' + color + '"></piece>').appendTo(pieces).css('background-image').replace(/\"/g, '\'');
  var bgKnight = $('<piece class="knight ' + color + '"></piece>').appendTo(pieces).css('background-image').replace(/\"/g, '\'');
  var bgRook = $('<piece class="rook ' + color + '"></piece>').appendTo(pieces).css('background-image').replace(/\"/g, '\'');
  var bgBishop = $('<piece class="bishop ' + color + '"></piece>').appendTo(pieces).css('background-image').replace(/\"/g, '\'');  
  pieces.remove();
  var promotionPanel = game.element.find('.promotion-panel');
  promotionPanel.css('left', promotionPanel.width() * (orientation === "white" ? fileNum : 7 - fileNum));
  if(orientation === color) {
    promotionPanel.css('top', 0);
    promotionPanel.html(`
      <button id="promote-piece-q" class="btn btn-default promote-piece w-100 h-25" style="background-image: ` + bgQueen + `; background-size: cover;"></button>
      <button id="promote-piece-n" class="btn btn-default promote-piece w-100 h-25" style="background-image: ` + bgKnight + `; background-size: cover;"></button>
      <button id="promote-piece-r" class="btn btn-default promote-piece w-100 h-25" style="background-image: ` + bgRook + `; background-size: cover;"></button>
      <button id="promote-piece-b" class="btn btn-default promote-piece w-100 h-25" style="background-image: ` + bgBishop + `; background-size: cover;"></button>
    `);
  }
  else {
    promotionPanel.css('top', '50%');
    promotionPanel.html(`
      <button id="promote-piece-b" class="btn btn-default promote-piece w-100 h-25" style="background-image: ` + bgBishop + `; background-size: cover;"></button>
      <button id="promote-piece-r" class="btn btn-default promote-piece w-100 h-25" style="background-image: ` + bgRook + `; background-size: cover;"></button>
      <button id="promote-piece-n" class="btn btn-default promote-piece w-100 h-25" style="background-image: ` + bgKnight + `; background-size: cover;"></button>
      <button id="promote-piece-q" class="btn btn-default promote-piece w-100 h-25" style="background-image: ` + bgQueen + `; background-size: cover;"></button>
    `);
  }
 
  $('.promote-piece').on('click', (event) => {
    hidePromotionPanel();
    gameWithFocus.promotePiece = $(event.target).attr('id').slice(-1);
    if(!premove)
      movePiece(source, target, metadata);
  });

  promotionPanel.show();
}

function hidePromotionPanel(game?: Game) {
  if(!game)
    game = gameWithFocus;

  game.promotePiece = null;
  game.element.find('.promotion-panel').hide();
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

$('#move-table').on('click', '.selectable', function() {
  gotoMove($(this).data('hEntry'));
});

$('#movelists').on('click', '.move', function() {
  gotoMove($(this).parent().data('hEntry'));
});

$('#movelists').on('click', '.comment', function() {
  if($(this).hasClass('comment-before'))
    gotoMove($(this).next().data('hEntry'));
  else
    gotoMove($(this).prev().data('hEntry'));
});

export function gotoMove(to: HEntry, playSound = false) {
  if(!to)
    return;

  var game = gameWithFocus;
  if(game.isExamining()) {
    var from = bufferedCurrentMove(game);
    var curr = from;
    let i = 0;
    while(curr) {
      curr.visited = i;
      curr = curr.prev;
      i++;
    }
    var path = [];
    curr = to;
    while(curr && curr.visited === undefined) {
      path.push(curr);
      curr = curr.prev;
    }    
    
    var backNum = curr.visited;
    if(backNum > 0) {
      session.send('back ' + backNum);
      game.bufferedHistoryEntry = curr;
      game.bufferedHistoryCount++;
    }

    while(from) {
      from.visited = undefined;
      from = from.prev;
    }

    var forwardNum = 0;
    if(!game.history.scratch()) {
      for(let i = path.length - 1; i >= 0; i--) {
        if(path[i].isSubvariation()) 
          break;
        curr = path[i];
        forwardNum++;
      }
      if(forwardNum > 0) {
        session.send('for ' + forwardNum);
        game.bufferedHistoryEntry = curr;
        game.bufferedHistoryCount++;
      }
    }

    for(let i = path.length - forwardNum - 1; i >= 0; i--) {
      sendMove(path[i].move);
      game.bufferedHistoryEntry = path[i];
      game.bufferedHistoryCount++;
    }
  }
  else
    game.history.display(to, playSound);
}

function sendMove(move: any) {
  var moveStr = '';
  if(move.san.startsWith('O-O') || move.san.includes('@')) // support for variants
    moveStr = move.san;
  else
    moveStr = move.from + '-' + move.to + (move.promotion ? '=' + move.promotion : ''); 

  session.send(moveStr);
}

function toDests(game: Game, chess: any): Map<Key, Key[]> {
  if(game.category === 'losers' || game.category.startsWith('wild'))
    return variantToDests(game, chess);

  var dests = new Map();
  chess.SQUARES.forEach(s => {
    var ms = chess.moves({square: s, verbose: true});
    if(ms.length)    
      dests.set(s, ms.map(m => m.to));
  });

  return dests;
}

function variantToDests(game: Game, chess: any): Map<Key, Key[]> {
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
    var startChess = new Chess(game.history.first().fen);
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
    
    var parsedMove = parseMove(game, chess.fen(), 'O-O');
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
    var parsedMove = parseMove(game, chess.fen(), 'O-O-O');
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

function movePieceAfter(game: Game, move: any, fen?: string) {
  if(!fen)
    fen = game.chess.fen();

  // go to current position if user is looking at earlier move in the move list
  if((game.isPlaying() || game.isObserving()) && game.history.current() !== game.history.last())
    game.history.display(game.history.last());

  updateHistory(game, move, fen);

  game.board.playPremove();
  game.board.playPredrop(() => true);

  checkGameEnd(game); // Check whether game is over when playing against computer (offline mode)
}

export function movePiece(source: any, target: any, metadata: any) {
  let fen = '';
  let move = null;
  var game = gameWithFocus;

  if(game.isPlaying() || game.isExamining() || game.role === Role.NONE) {  
    if(game.isPlaying() || game.isExamining()) 
      var chess = game.chess;
    else
      var chess = new Chess(game.history.current().fen);

    var inMove = {from: source, to: target, promotion: (game.promotePiece ? game.promotePiece : 'q')};
    
    // Crazyhouse/bughouse piece placement
    const cgRoles = {pawn: 'p', rook: 'r', knight: 'n', bishop: 'b', queen: 'q', king: 'k'};
    if(cgRoles.hasOwnProperty(source)) { 
      inMove['piece'] = cgRoles[source];
      inMove.from = '';
    }
  
    var parsedMove = parseMove(game, chess.fen(), inMove);
    if(!parsedMove) {
      updateBoard(game);
      return;
    }

    fen = parsedMove.fen;
    move = parsedMove.move;
    game.movePieceSource = source;
    game.movePieceTarget = target;
    game.movePieceMetadata = metadata;
    var nextMove = game.history.next();

    if(!game.promotePiece && !autoPromoteToggle && move && move.flags.includes('p')) {
      showPromotionPanel(game, false);
      game.board.set({ movable: { color: undefined } });
      return;
    }

    if(game.history.editMode && game.newVariationMode === NewVariationMode.ASK && nextMove) {
      var subFound = false;
      for(let i = 0; i < nextMove.subvariations.length; i++) {
        if(nextMove.subvariations[i].fen === fen)
          var subFound = true;
      }
      if(nextMove.fen !== fen && !subFound) {
        createNewVariationMenu(game);
        return;      
      }
    }

    chess.load(fen);

    if (game.isPlayingOnline() && game.chess.turn() !== game.color) 
      sendMove(move);
  
    if(game.isExamining()) {
      if(nextMove && !nextMove.isSubvariation() && !game.history.scratch() && fen === nextMove.fen) 
        session.send('for');
      else
        sendMove(move);
    }

    hitClock(game, false);
  }

  game.wtime = game.clock.getWhiteTime();
  game.btime = game.clock.getBlackTime();

  game.promotePiece = null;  
  if (move !== null)
    movePieceAfter(game, move, fen);

  if(game.role === Role.PLAYING_COMPUTER) { // Send move to engine in Play Computer mode
    getComputerMove(game);
  } 

  showTab($('#pills-game-tab'));
  // Show 'Analyze' button once any moves have been made on the board
  showAnalyzeButton();
}

/**
 * When in Edit Mode, if a move is made on the board, display a menu asking if the user wishes to
 * create a new variation or overwrite the existing variation.
 */
function createNewVariationMenu(game: Game) {
  var menu = $(`
    <ul class="context-menu dropdown-menu">
      <li><a class="dropdown-item noselect" data-action="overwrite">Overwrite variation</a></li>
      <li><a class="dropdown-item noselect" data-action="new">New variation</a></li>
    </ul>`);

  var closeMenuCallback = (event: any) => {
    updateBoard(game);
  }

  var itemSelectedCallback = (event: any) => {
    var action = $(event.target).data('action');
    if(action === 'new') 
      game.newVariationMode = NewVariationMode.NEW_VARIATION;
    else 
      game.newVariationMode = NewVariationMode.OVERWRITE_VARIATION;
    movePiece(game.movePieceSource, game.movePieceTarget, game.movePieceMetadata);
  }

  var x = lastPointerCoords.x;
  var y = (isSmallWindow() ? lastPointerCoords.y : lastPointerCoords.y + 15);

  createContextMenu(menu, x, y, itemSelectedCallback, closeMenuCallback, 'top', ['top-start', 'top-end', 'bottom-start', 'bottom-end']);
}

// Get Computer's next move either from the opening book or engine
async function getComputerMove(game: Game) {
  var bookMove = '';
  if(game.category === 'standard') { // only use opening book with normal chess
    var fen = game.history.last().fen;
    var moveNo = History.getMoveNoFromFEN(fen);
    // Cool-down function for deviating from the opening book. The chances of staying in book 
    // decrease with each move 
    var coolDownParams = [
      { slope: 0.2, shift: 1.0 }, // Difficulty level 1
      { slope: 0.2, shift: 1.2 }, // 2
      { slope: 0.2, shift: 1.4 }, // 3
      { slope: 0.2, shift: 1.6 }, // 4
      { slope: 0.2, shift: 1.8 }, // 5
      { slope: 0.2, shift: 2.0 }, // 6
      { slope: 0.2, shift: 2.5 }, // 7
      { slope: 0.2, shift: 3.0 }, // 8
      { slope: 0.2, shift: 3.5 }, // 9
      { slope: 0.2, shift: 4.0 }, // 10
    ];
    let a = coolDownParams[game.difficulty - 1].slope;
    let b = coolDownParams[game.difficulty - 1].shift;
    let x = moveNo;
    var sigma = 1 / (1 + Math.exp(a*x - b));
    if(Math.random() < sigma) {
      // Use book move (if there is one)
      var bookMoves = await getBookMoves(fen);
      var totalWeight = bookMoves.reduce((acc, curr) => acc + curr.weight, 0);
      var probability = 0;
      var rValue = Math.random();
      for(let bm of bookMoves) {
        probability += bm.weight / totalWeight; // polyglot moves are weighted based on number of wins and draws
        if(rValue <= probability) {
          bookMove = bm.from + bm.to;
          break;
        }
      }
    }  
  }

  if(bookMove)
    playComputerBestMove(game, bookMove);
  else
    playEngine.move(game.history.last());  
}

function preMovePiece(source: any, target: any, metadata: any) {
  var game = gameWithFocus;
  var chess = new Chess(game.board.getFen() + ' w KQkq - 0 1'); 
  if(!game.promotePiece && chess.get(source).type === 'p' && (target.charAt(1) === '1' || target.charAt(1) === '8')) {
    showPromotionPanel(game, true);
  }
}

function showStatusMsg(game: Game, msg: string) {
  if(game === gameWithFocus)
    showStatusPanel();
  if(msg)
    game.statusElement.find('.game-status').html(msg);
}

function showBoardDialog(params: DialogParams): any {
  var dialog = createDialog(params);
  dialog.appendTo($('#game-requests'));
  dialog.addClass('board-dialog');
  dialog.toast('show');

  dialog.on('hidden.bs.toast', function () {
    $(this).remove();
  });

  return dialog;
}

function showFixedDialog(params: DialogParams): any {
  var dialog = createDialog(params);
  var container = $('<div class="toast-container position-fixed top-50 start-50 translate-middle" style="z-index: 101">');
  container.appendTo('body');
  dialog.appendTo(container);
  dialog.toast('show');

  dialog.on('hidden.bs.toast', function () {
    $(this).parent().remove();
  });

  return dialog;
}

interface DialogParams {
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

function createDialog({type = '', title = '', msg = '', btnFailure, btnSuccess, useSessionSend = false, icons = true, progress = false, htmlMsg = false}: DialogParams): JQuery<HTMLElement> { 
  const dialogId = 'dialog' + dialogCounter++;
  let req = `
  <div id="` + dialogId + `" class="toast" data-bs-autohide="false" role="status" aria-live="polite" aria-atomic="true">
    <div class="toast-header">
      <strong class="header-text me-auto">` + type + `</strong>
      <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>
    <div class="toast-body">`;

  if(htmlMsg)
    req += msg;
  else {
    req += `<div class="d-flex align-items-center">
          <strong class="body-text text-primary my-auto">` + title + ' ' + msg + '</strong>';
    if (progress) {
      req += '<div class="spinner-border ms-auto" role="status" aria-hidden="true"></div>';
    }
    req += '</div>';
  }

  if((btnSuccess && btnSuccess.length === 2) || (btnFailure && btnFailure.length === 2)) {
    req += `<div class="mt-2 pt-2 border-top center">`;
    if (btnSuccess && btnSuccess.length === 2) {
      var successCmd = '';
      if(typeof btnSuccess[0] === 'function') 
        var btnSuccessHandler = btnSuccess[0];
      if(typeof btnSuccess[0] === 'string') {
        var successCmd = `onclick="`;
        if(useSessionSend) 
          successCmd += `sessionSend('` + btnSuccess[0] + `');`;
        else
          successCmd += btnSuccess[0];
        successCmd += `" `;
      }

      req += `<button type="button" ` + successCmd + `class="button-success btn btn-sm btn-outline-success` 
          + (btnFailure && btnFailure.length === 2 ? ` me-4` : ``) + `" data-bs-dismiss="toast">`
          + (icons ? `<span class="fa fa-check-circle-o" aria-hidden="false"></span> ` : ``) 
          + btnSuccess[1] + '</button>';
    }
    if (btnFailure && btnFailure.length === 2) {
      var failureCmd = '';
      if(typeof btnFailure[0] === 'function') 
        var btnFailureHandler = btnFailure[0];
      if(typeof btnFailure[0] === 'string') {
        var failureCmd = `onclick="`;
        if(useSessionSend) 
          failureCmd += `sessionSend('` + btnFailure[0] + `');`;
        else
          failureCmd += btnFailure[0];
        failureCmd += `" `;
      }

      req += `<button type="button" ` + failureCmd + `" class="button-failure btn btn-sm btn-outline-danger" data-bs-dismiss="toast">` 
          + (icons ? `<span class="fa fa-times-circle-o" aria-hidden="false"></span> ` : ``)
          + btnFailure[1] + '</button>';
    }
    req += '</div>';
  }

  req += '</div></div>';

  var dialog = $(req);

  if(btnSuccessHandler)
    dialog.find('.button-success').on('click', btnSuccessHandler);
  if(btnFailureHandler)
    dialog.find('.button-failure').on('click', btnFailureHandler);

  return dialog;
}

function createNotification(params: DialogParams): any {
  var dialog = createDialog(params);
  dialog.insertBefore($('#notifications-footer')); 
  dialog.find('[data-bs-dismiss="toast"]').removeAttr('data-bs-dismiss');  
  dialog.on('click', 'button', (event) => {
    removeNotification(dialog);
  });
  dialog.addClass('notification'); 
  dialog.addClass('notification-panel');
  $('#notifications-btn').prop('disabled', false); 
  $('#notifications-btn').parent().prop('title', 'Notifications');
  createTooltip($('#notifications-btn').parent());

  $('#notifications-number').text($('.notification:not([data-remove="true"])').length);
  $('#notifications-bubble').show();
  
  var game = getPlayingExaminingGame();
  var playingGame = (game && game.isPlayingOnline() ? true : false); // Don't show notifications if playing a game
  if((notificationsToggle && !playingGame) || $('#notifications-header').attr('data-show'))
    showNotifications(dialog);

  return dialog;
}

function removeNotification(element: any) {
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

  var transformMatrix = element.css('transform');
  var matrix = transformMatrix.replace(/[^0-9\-.,]/g, '').split(',');
  var x = matrix[12] || matrix[4]; // translate x
  slideNotification(element, (x < 0 ? 'left' : 'right'));
}

function showNotifications(dialogs: any) {
  if(!dialogs.length)
    return;
  
  // If not all notifications are displayed, add a 'Show All' button to the footer
  var allShown = true;
  $('.notification').each((index, element) => {
    if(!$(element).attr('data-show') && !$(element).attr('data-remove') && dialogs.index($(element)) === -1) 
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

  dialogs.each((index, element) => {
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

function slideUpAllNotifications() {
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

  var dialog = $(e.target).closest('.toast');
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

  e.preventDefault();
}

function getTouchClickCoordinates(event: any, relativeToPage: boolean = false) {
  event = (event.originalEvent || event);
  if(event.type == 'touchstart' || event.type == 'touchmove' || event.type == 'touchend' || event.type == 'touchcancel') {
    var touch = event.touches[0] || event.changedTouches[0];
    var x = relativeToPage ? touch.pageX : touch.clientX;
    var y = relativeToPage ? touch.pageY : touch.clientY;
  } 
  else if (event.type == 'mousedown' || event.type == 'mouseup' || event.type == 'mousemove' || event.type == 'mouseover' || event.type=='mouseout' || event.type=='mouseenter' || event.type=='mouseleave' || event.type == 'contextmenu') {
    var x = relativeToPage ? event.pageX : event.clientX;
    var y = relativeToPage ? event.pageY : event.clientY;
  }
  return {x, y};
}

function showAllNotifications() {
  showNotifications($('.notification:not([data-show="true"])'));
}

function hideAllNotifications() {
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

function clearNotifications() {
  var delay = 0;
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

export function parseMove(game: Game, fen: string, move: any) {
  // Parse variant move
  var category = game.category;
  if(category.includes('wild') || category.includes('house')) 
    return parseVariantMove(game, fen, move);

  // Parse standard move
  var chess = new Chess(fen);
  var outMove = chess.move(move);
  var outFen = chess.fen();
  return { fen: outFen, move: outMove };
}

function parseVariantMove(game: Game, fen: string, move: any) {
  var category = game.category;  
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
      var startChess = new Chess(game.history.first().fen);
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
          var holdings = game.history.current().holdings;
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
      var startChess = new Chess(game.history.first().fen);
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

export function parseMovelist(game: Game, movelist: string) {
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
    game.history.setMetatags({SetUp: '1', FEN: startpos.fen});
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
        var parsedMove = parseMove(game, chess.fen(), m1);
        if(!parsedMove)
          break;
        chess.load(parsedMove.fen);
        game.history.add(parsedMove.move, parsedMove.fen, false, wtime, btime);
        getOpening(game);
        updateVariantMoveData(game);
      }
      if (found.length > 5 && found[5]) {
        const m2 = found[5].trim();
        btime += (n === 1 ? 0 : game.inc * 1000) - (+found[6] * 60000 + +found[7] * 1000 + +found[8]);
        parsedMove = parseMove(game, chess.fen(), m2);
        if(!parsedMove)
          break;
        chess.load(parsedMove.fen);
        game.history.add(parsedMove.move, parsedMove.fen, false, wtime, btime);
        getOpening(game);
        updateVariantMoveData(game);
      }
      n++;
    }
  }
  if(game.isExamining() && game.history.length())
    session.send('back 999');
  else
    game.history.display();
}

function gameStart(game: Game) {
  if(game.role !== Role.NONE) {
    if(game.move === 'none')
      game.chess = new Chess(game.fen);
    else
      game.chess = new Chess();
  }

  hidePromotionPanel(game);
  game.board.cancelMove();
  if(game === gameWithFocus && (!game.history || !game.history.hasSubvariation()))
    $('#exit-subvariation').hide();

  // for bughouse set game.color of partner to opposite of us
  var mainGame = getPlayingExaminingGame();
  var partnerColor = (mainGame && mainGame.partnerGameId === game.id && mainGame.color === 'w' ? 'b' : 'w');

  // Determine the player's color
  var amIblack = game.bname === session.getUser();
  var amIwhite = game.wname === session.getUser();
  if(game.role === Role.PLAYING_COMPUTER && game.color === 'b')
    amIblack = true;  

  if((!amIblack || amIwhite) && partnerColor !== 'b') 
    game.color = 'w';
  else 
    game.color = 'b';
  
  // Set game board text
  var whiteStatus = game.element.find(game.color === 'w' ? '.player-status' : '.opponent-status');
  var blackStatus = game.element.find(game.color === 'b' ? '.player-status' : '.opponent-status');
  whiteStatus.find('.name').text(game.wname.replace(/_/g, ' '));
  blackStatus.find('.name').text(game.bname.replace(/_/g, ' '));
  if(!game.wrating)
    whiteStatus.find('.rating').text('');
  if(!game.brating)
    blackStatus.find('.rating').text('');
  
  if(game.isPlayingOnline() || game.isExamining() || game.isObserving()) {
    if(game.isPlayingOnline())
      var gameType = 'Playing';
    else if(game.isExamining())
      var gameType = 'Examining';
    else if(game.isObserving())
      var gameType = 'Observing';
    game.element.find('.title-bar-text').text('Game ' + game.id + ' (' + gameType + ')');
    var gameStatus = game.statusElement.find('.game-status');
    if(gameStatus.text())
      gameStatus.prepend('<span class="game-id">Game ' + game.id + ': </span>');
  }
  else if(game.role === Role.PLAYING_COMPUTER)
    game.element.find('.title-bar-text').text('Computer (Playing)');
  
  setFontSizes();

  // Set board orientation

  var flipped = game.element.find('.opponent-status').parent().hasClass('bottom-panel');
  game.board.set({
    orientation: ((game.color === 'b') === flipped ? 'white' : 'black'),
  });

  // Check if server flip variable is set and flip board if necessary
  if(game.isPlaying())
    var v_flip = (game.color === 'b') !== game.flip; 
  else 
    var v_flip = game.flip;

  if(v_flip != flipped)
    flipBoard(game);

  // Reset HTML elements
  game.element.find('.player-status .captured').text('');
  game.element.find('.opponent-status .captured').text('');
  game.element.find('.card-header').css('--bs-card-cap-bg', '');
  game.element.find('.card-footer').css('--bs-card-cap-bg', '');
  game.element.find('.clock').removeClass('low-time');
  $('#game-pane-status').hide();
  $('#pairing-pane-status').hide();
  game.statusElement.find('.game-watchers').empty();
  game.statusElement.find('.opening-name').hide();

  if(game.isPlaying() || game.isExamining()) {
    clearMatchRequests();
    $('#game-requests').html('');
    hideAllNotifications();
  }

  if(game.role !== Role.PLAYING_COMPUTER && game.role !== Role.NONE) {
    session.send('allobs ' + game.id);
    allobsRequested++;
    if(game.isPlaying()) {
      game.watchersInterval = setInterval(() => {
        const time = game.color === 'b' ? game.btime : game.wtime;
        if (time > 20000) {
          session.send('allobs ' + game.id);
          allobsRequested++;
        }
      }, 30000);
    }
    else {
      game.watchersInterval = setInterval(() => {
        session.send('allobs ' + game.id);
        allobsRequested++;
      }, 5000);
    }
  }

  if(game === gameWithFocus && evalEngine) {
    evalEngine.terminate();
    evalEngine = null;
  }

  if(!examineModeRequested) {
    game.historyList.length = 0;
    game.gameListFilter = '';
    $('#game-list-button').hide();
    game.history = new History(game, game.fen, game.time * 60000, game.time * 60000);
    updateEditMode(game);
  }
  
  if(game.isPlayingOnline())
    game.element.find($('[title="Close"]')).css('visibility', 'hidden');

  var focusSet = false;
  if(!game.isObserving() || getMainGame().role === Role.NONE) {
    if(game !== gameWithFocus) {
      setGameWithFocus(game);
      focusSet = true;
    }
    maximizeGame(game);
  }
  if(!focusSet) {
    if(game === gameWithFocus)
      initGameControls(game);
    updateBoard(game);
  }

  // Close old unused private chat tabs
  if(chat)
    chat.closeUnusedPrivateTabs();

  // Open chat tabs
  if(game.isPlayingOnline()) {
    if(game.category === 'bughouse' && partnerGameId !== null) 
      chat.createTab('Game ' + game.id + ' and ' + partnerGameId); // Open chat room for all bughouse participants
    else if(game.color === 'w') 
      chat.createTab(game.bname);
    else 
      chat.createTab(game.wname);  
  }
  else if(game.isObserving() || game.isExamining()) {
    if(mainGame && game.id === mainGame.partnerGameId) { // Open chat to bughouse partner
      if(game.color === 'w') 
        chat.createTab(game.wname);
      else 
        chat.createTab(game.bname);
    }
    else 
      chat.createTab('Game ' + game.id);    
  }

  if(game.isPlaying() || game.isObserving()) {
    // Adjust settings for game category (variant)
    // When examining we do this after requesting the movelist (since the category is told to us by the 'moves' command)
    if(game.isPlaying()) {
      if (soundToggle) {
        Sounds.startSound.play();
      }

      if(game.role === Role.PLAYING_COMPUTER) { // Play Computer mode
        playEngine = new Engine(game, playComputerBestMove, null, getPlayComputerEngineOptions(game), getPlayComputerMoveParams(game));
        if(amIblack) 
          getComputerMove(game);
      } 
      else {            
        $('#play-computer').prop('disabled', true);    
        if(game.category === 'bughouse' && partnerGameId !== null) {
          game.partnerGameId = partnerGameId;
          partnerGameId = null;
        }
      }
    }
  }

  if(examineModeRequested) {
    setupGameInExamineMode(game);
    examineModeRequested = null;
  } 
  else {
    if(game.isExamining()) {
      if(game.wname === game.bname) 
        game.history.scratch(true);
      else {
        if(game.move !== 'none')
          session.send('back 999');
        session.send('for 999');
      }
    }

    if(game.isExamining() || ((game.isObserving() || game.isPlayingOnline()) && game.move !== 'none')) {        
      game.movelistRequested++;
      session.send('iset startpos 1'); // Show the initial board position before the moves list 
      session.send('moves ' + game.id);
      session.send('iset startpos 0');
    }

    game.history.initMetatags();
  }

  if(game === gameWithFocus) {
    showTab($('#pills-game-tab'));
    if(game.role !== Role.NONE)
      showStatusPanel();
  }

  if(!mainGame || game.id !== mainGame.partnerGameId) 
    scrollToBoard(game);
}

function removeLine(msg: string, line: string): string {
  line = line.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const re = new RegExp(`^.*${line}.*$\\n?`, 'm');
  return msg.replace(re, '');
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
        else if($('#pills-history').hasClass('active'))
          initHistoryPane();
        else if($('#pills-play').hasClass('active')) {
          if($('#pills-lobby').hasClass('active'))
            initLobbyPane();
          else if($('#pills-pairing').hasClass('active'))
            initPairingPane();
        }         
      } else if (data.command === 2) {
        session.disconnect();
        $('#session-status').popover({
          animation: true,
          content: data.control,
          placement: 'top',
        });
        $('#session-status').popover('show');
      }
      break;
    case MessageType.ChannelTell:
      chat.newMessage(data.channel, data);
      break;
    case MessageType.PrivateTell:
      chat.newMessage(data.user, data);
      break;
    case MessageType.GameMove:
      if(gameExitPending.includes(data.id))
        break;

      // If in single-board mode, check we are not examining/observing another game already     
      if(!multiboardToggle) {
        var game = getMainGame();
        if(game.isPlayingOnline() && game.id !== data.id) {
          if(data.role === Role.OBSERVING || data.role === Role.OBS_EXAMINED)
            session.send('unobs ' + data.id);
          break;
        }
        else if((game.isExamining() || game.isObserving()) && game.id !== data.id) {
          if(game.isExamining())
            session.send('unex');
          else if(game.isObserving()) 
            session.send('unobs ' + game.id);
                  
          if(data.role === Role.PLAYING_COMPUTER)
            cleanupGame(game);  
          else {
            gameExitPending.push(game.id);
            break;
          }
        }
        else if(game.role === Role.PLAYING_COMPUTER && data.role !== Role.PLAYING_COMPUTER) 
          cleanupGame(game); // Allow player to imemediately play/examine/observe a game at any time while playing the Computer. The Computer game will simply be aborted.
      }

      if(examineModeRequested && data.role === Role.EXAMINING) {
        // Converting a game to examine mode
        game = examineModeRequested;
        if(game.role !== Role.NONE && multiboardToggle)
          game = cloneGame(game);
        game.id = data.id;    
        if(!game.wname)
          game.wname = data.wname;
        if(!game.bname)
          game.bname = data.bname;
        game.role = Role.EXAMINING;
      }
      else {
        if(multiboardToggle) {
          // Get game object
          var game = findGame(data.id);
          if(!game)
            game = getFreeGame();
          if(!game)
            game = createGame();
        }

        var prevRole = game.role;
        Object.assign(game, data);
      }

      // New game
      if(examineModeRequested || prevRole === Role.NONE) 
        gameStart(game);

      // Make move
      if(game.role === Role.NONE || game.role >= -2 || game.role === Role.PLAYING_COMPUTER) {
        const lastPly = getPlyFromFEN(game.chess.fen());
        const thisPly = getPlyFromFEN(game.fen);
 
        if (game.move !== 'none' && thisPly === lastPly + 1) { // make sure the move no is right
          var parsedMove = parseMove(game, game.chess.fen(), game.move);
          game.chess.load(game.fen);
          movePieceAfter(game, (parsedMove ? parsedMove.move : {san: game.move}));
        }
        else {
          game.chess.load(game.fen);
          updateHistory(game);
        }

        hitClock(game, true);
      }
      break;
    case MessageType.GameStart:
      break;
    case MessageType.GameEnd:
      var game = findGame(data.game_id);
      if(!game)
        return;

      // Set clock time to the time that the player resigns/aborts etc.
      game.history.updateClockTimes(game.history.last(), game.clock.getWhiteTime(), game.clock.getBlackTime());

      if(data.reason <= 4 && game.element.find('.player-status .name').text() === data.winner) {
        // player won
        game.element.find('.player-status').parent().css('--bs-card-cap-bg', 'var(--game-win-color)');
        game.element.find('.opponent-status').parent().css('--bs-card-cap-bg', 'var(--game-lose-color)');
        if (game === gameWithFocus && soundToggle) {
          Sounds.winSound.play();
        }
      } else if (data.reason <= 4 && game.element.find('.player-status .name').text() === data.loser) {
        // opponent won
        game.element.find('.player-status').parent().css('--bs-card-cap-bg', 'var(--game-lose-color)');
        game.element.find('.opponent-status').parent().css('--bs-card-cap-bg', 'var(--game-win-color)');
        if (game === gameWithFocus && soundToggle) {
          Sounds.loseSound.play();
        }
      } else {
        // tie
        game.element.find('.player-status').parent().css('--bs-card-cap-bg', 'var(--game-tie-color)');
        game.element.find('.opponent-status').parent().css('--bs-card-cap-bg', 'var(--game-tie-color)');
      }

      var status = data.message.replace(/Game \d+ /, '');
      showStatusMsg(game, status);
      
      if(game.isPlaying()) {
        let rematch = [], analyze = [];
        var useSessionSend = true;   
        if(data.reason !== Reason.Disconnect && data.reason !== Reason.Adjourn && data.reason !== Reason.Abort) {
          if(game.role === Role.PLAYING_COMPUTER) {
            rematch = ['rematchComputer();', 'Rematch'];
            useSessionSend = false;
          }
          else if(game.element.find('.player-status .name').text() === session.getUser()) 
            rematch = [`sessionSend('rematch')`, 'Rematch']
        }
        if(data.reason !== Reason.Adjourn && data.reason !== Reason.Abort && game.history.length()) {
          analyze = ['analyze();', 'Analyze'];
        }
        showBoardDialog({type: 'Match Result', msg: data.message, btnFailure: rematch, btnSuccess: analyze, icons: false});
      }
      game.history.setMetatags({Result: data.score, Termination: data.reason});

      cleanupGame(game);
      break;
    case MessageType.GameHoldings:
      var game = findGame(data.game_id);
      if(!game)
        return;

      game.history.current().holdings = data.holdings;
      showCapturedMaterial(game);
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
          if(!lobbyShowUnratedToggle && item.ratedUnrated === 'u')
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
        sentOffers.forEach((item) => {
          if(!$('.sent-offer[data-offer-id="' + item.id + '"]').length) {
            if(matchRequested)
              matchRequested--;
            newSentOffers.push(item);
          }
        });
        if(newSentOffers.length) {
          clearTimeout(showSentOffersTimer);
          showSentOffersTimer = setTimeout(() => {
            showSentOffers(newSentOffers);
            newSentOffers = [];
          }, 1000);
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
            if(item.adjourned)
              headerTitle = 'Resume Adjourned Game Request';
            else
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
            displayType = 'dialog';
            headerTitle = 'Takeback Request';
            bodyTitle = item.toFrom;
            bodyText = 'would like to take back ' + item.parameters + ' half move(s).';
            break;
          case 'abort': 
            displayType = 'dialog';
            headerTitle = 'Abort Request';
            bodyTitle = item.toFrom;
            bodyText = 'would like to abort the game.';
            break;
          case 'draw':
            displayType = 'dialog';
            headerTitle = 'Draw Request';
            bodyTitle = item.toFrom;
            bodyText = 'offers you a draw.';
            break;
          case 'adjourn': 
            displayType = 'dialog';
            headerTitle = 'Adjourn Request';
            bodyTitle = item.toFrom;
            bodyText = 'would like to adjourn the game.';
            break;
        }
        
        if(displayType) {
          if(displayType === 'notification')
            var dialog = createNotification({type: headerTitle, title: bodyTitle, msg: bodyText, btnFailure: ['decline ' + item.id, 'Decline'], btnSuccess: ['accept ' + item.id, 'Accept'], useSessionSend: true});
          else if(displayType === 'dialog')
            var dialog = showBoardDialog({type: headerTitle, title: bodyTitle, msg: bodyText, btnFailure: ['decline ' + item.id, 'Decline'], btnSuccess: ['accept ' + item.id, 'Accept'], useSessionSend: true});
          dialog.attr('data-offer-id', item.id);
        }
      });

      // Remove match requests and seeks. Note our own seeks are removed in the MessageType.Unknown section
      // since <sr> info is only received when we are in the lobby. 
      var removals = offers.filter((item) => item.type === 'pr' || item.type === 'sr');
      removals.forEach((item) => {
        item.ids.forEach((id) => {
          removeNotification($('.notification[data-offer-id="' + id + '"]')); // If match request was not ours, remove the Notification
          $('.board-dialog[data-offer-id="' + id + '"]').toast('hide'); // if in-game request, hide the dialog
          $('.sent-offer[data-offer-id="' + id + '"]').remove(); // If offer, match request or seek was sent by us, remove it from the Play pane
          $('.lobby-entry[data-offer-id="' + id + '"]').remove(); // Remove seek from lobby
        });
        if(!$('#sent-offers-status').children().length)
          $('#sent-offers-status').hide();
      });
      break;
    case MessageType.Unknown:
    default:
      var msg = data.message;
    
      var match = msg.match(/^No one is observing game (\d+)\./m);
      if (match != null && match.length > 1) {
        if(allobsRequested) {
          allobsRequested--;
          return;
        }
        chat.newMessage('console', data);
        return;
      }

      match = msg.match(/^(?:Observing|Examining)\s+(\d+) [\(\[].+[\)\]]: (.+) \(\d+ users?\)/m);
      if (match != null && match.length > 1) {
        if (allobsRequested) {
          allobsRequested--;
          var game = findGame(+match[1]);
          if(!game)
            return;

          game.statusElement.find('.game-watchers').empty();
          match[2] = match[2].replace(/\(U\)/g, '');
          const watchers = match[2].split(' ');
          game.watchers = watchers.filter(item => item.replace('#', '') !== session.getUser());
          var chatTab = chat.getTabFromGameID(game.id);
          if(chatTab)
            chat.updateNumWatchers(chatTab);
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
          game.statusElement.find('.game-watchers').html(req);

          return;
        }
        chat.newMessage('console', data);
        return;
      }

      match = msg.match(/(?:^|\n)\s*\d+\s+(\(Exam\.\s+)?[0-9\+]+\s\w+\s+[0-9\+]+\s\w+\s*(\)\s+)?\[[\w\s]+\]\s+[\d:]+\s*\-\s*[\d:]+\s\(\s*\d+\-\s*\d+\)\s+[BW]:\s+\d+\s*\d+ games displayed/);
      if (match != null && match.length > 0 && gamesRequested) {
        showGames(msg);
        gamesRequested = false;
        return;
      }

      match = msg.match(/^Game (\d+): (\S+) has lagged for 30 seconds\./m);
      if(match) {
        var game = findGame(+match[1]);
        if(game && game.isPlaying()) {
          var bodyText = match[2] + ' has lagged for 30 seconds.<br>You may courtesy adjourn the game.<br><br>If you believe your opponent has intentionally disconnected, you can request adjudication of an adjourned game. Type \'help adjudication\' in the console for more info.';
          showBoardDialog({type: 'Opponent Lagging', msg: bodyText, btnFailure: ['', 'Wait'], btnSuccess: ['adjourn', 'Adjourn'], useSessionSend: true});
        }
        chat.newMessage('console', data);
        return;
      }

      match = msg.match(/^History for (\w+):.*/m);
      if (match != null && match.length > 1) {
        if (historyRequested) {
          historyRequested--;
          if(!historyRequested) {
            $('#history-username').val(match[1]);
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
      if(match && (historyRequested || obsRequested || matchRequested || allobsRequested)) {
        let status;
        if(historyRequested) 
          status = $('#history-pane-status');
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
        else if(allobsRequested && match[0] === 'There is no such game.')
          allobsRequested--;
        
        if(status) {
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
        }
        return;
      }
      
      match = msg.match(/(?:^|\n)(\d+ players?, who (?:has|have) an adjourned game with you, (?:is|are) online:)\n(.*)/);
      if(match && match.length > 2) {
        createNotification({type: 'Resume Game', title: match[1] + '<br>' + match[2], btnSuccess: ['resume', 'Resume Game'], useSessionSend: true});
        chat.newMessage('console', data);
        return;
      }
      match = msg.match(/^Notification: ((\S+), who has an adjourned game with you, has arrived\.)/m);
      if(match && match.length > 2) {
        var alreadyExists = $('.notification').filter(function() {
          var bodyTextElement = $(this).find('.body-text'); 
          return bodyTextElement.length && bodyTextElement.text().startsWith(match[1]);
        }).length;
        if(!alreadyExists)
          createNotification({type: 'Resume Game', title: match[1], btnSuccess: ['resume ' + match[2], 'Resume Game'], useSessionSend: true});
        return;        
      }
      match = msg.match(/^\w+ is not logged in./m);
      if(!match)
        match = msg.match(/^Player [a-zA-Z\"]+ is censoring you./m);
      if(!match)
        match = msg.match(/^Sorry the message is too long./m);
      if(!match)
        match = msg.match(/^You are muted./m);
      if(!match)
        match = msg.match(/^Notification: .*/m);
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

      match = msg.match(/^(\w+ declines the partnership request\.)/m);
      if(match && match.length > 1) {
        let headerTitle = 'Partnership Declined';
        let bodyTitle = match[1];
        createNotification({type: headerTitle, title: bodyTitle, useSessionSend: true});
      }
      match = msg.match(/^(\w+ agrees to be your partner\.)/m);
      if(match && match.length > 1) {
        let headerTitle = 'Partnership Accepted';
        let bodyTitle = match[1];
        createNotification({type: headerTitle, title: bodyTitle, useSessionSend: true});
      }

      match = msg.match(/^You are now observing game \d+\./m);
      if(match) {
        if(obsRequested) {
          obsRequested--;
          $('#observe-pane-status').hide();
          return;
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
        return;
      }
     
      match = msg.match(/(?:^|\n)\s*Movelist for game (\d+):\s+(\S+) \((\d+|UNR)\) vs\. (\S+) \((\d+|UNR)\)[^\n]+\s+(\w+) (\S+) match, initial time: (\d+) minutes, increment: (\d+) seconds\./);
      if (match != null && match.length > 9) {
        var game = findGame(+match[1]);
        if(game && (game.movelistRequested || game.gameStatusRequested)) {
          if(game.isExamining()) {
            var id = match[1];
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

            game.element.find('.player-status .rating').text(game.color === 'b' ? game.brating : game.wrating);
            game.element.find('.opponent-status .rating').text(game.color === 'b' ? game.wrating : game.brating);

            let time = ' ' + initialTime + ' ' + increment;
            if(initialTime === '0' && increment === '0')
              time = '';
    
            const statusMsg = '<span class="game-id">Game ' + id + ': </span>' + wname + ' (' + wrating + ') ' + bname + ' (' + brating + ') '
              + rated + ' ' + game.category + time;
            showStatusMsg(game, statusMsg);

            var tags = game.history.metatags;
            game.history.setMetatags({
              ...(!('WhiteElo' in tags) && { WhiteElo: game.wrating || '-' }), 
              ...(!('BlackElo' in tags) && { BlackElo: game.brating || '-' }), 
              ...(!('Variant' in tags) && { Variant: game.category })
            });
            var chatTab = chat.getTabFromGameID(game.id);
            if(chatTab) 
              chat.updateGameDescription(chatTab);
            initAnalysis(game);
          }

          game.gameStatusRequested = false;
          if(game.movelistRequested) {
            game.movelistRequested--;
            parseMovelist(game, msg);
          }
          return;          
        }
        else {
          chat.newMessage('console', data);
          return;
        }
      }
  
      match = msg.match(/^Your partner is playing game (\d+)/m);
      if (match != null && match.length > 1) {
        if(multiboardToggle)
          session.send('pobserve');

        partnerGameId = +match[1];
        var mainGame = getPlayingExaminingGame();
        if(mainGame) {
          mainGame.partnerGameId = partnerGameId;
          chat.createTab('Game ' + mainGame.id + ' and ' + partnerGameId);
        }
      }

      match = msg.match(/^(Creating|Game\s(\d+)): (\S+) \(([\d\+\-\s]+)\) (\S+) \(([\d\-\+\s]+)\) \S+ (\S+).+/m);
      if (match != null && match.length > 7) {
        if(!multiboardToggle) 
          var game = getMainGame();
        else {     
          var game = findGame(+match[2]);
          if(!game)
            game = getFreeGame();
          if(!game)
            game = createGame();
        }

        if(multiboardToggle || !game.isPlaying() || +match[2] === game.id) {
          game.wrating = (isNaN(match[4]) || match[4] === '0') ? '' : match[4];
          game.brating = (isNaN(match[6]) || match[6] === '0') ? '' : match[6];
          game.category = match[7];
          
          var status = match[0].substring(match[0].indexOf(':')+1);
          if(game.id)
            status = '<span class="game-id">Game ' + game.id + ': </span>' + status;
          showStatusMsg(game, status);

          if(game.history)
            game.history.initMetatags();
          if (match[3] === session.getUser() || match[1].startsWith('Game')) {
            game.element.find('.player-status .rating').text(game.wrating);
            game.element.find('.opponent-status .rating').text(game.brating);
          } else if (match[5] === session.getUser()) {
            game.element.find('.opponent-status .rating').text(game.wrating);
            game.element.find('.player-status .rating').text(game.brating);
          }
        }
        data.message = msg = removeLine(msg, match[0]); // remove the matching line
        if(!msg)
          return;
      }

      /* Parse score and termination reason for examined games */
      match = msg.match(/^Game (\d+): ([a-zA-Z]+)(?:' game|'s)?\s([^\d\*]+)\s([012/]+-[012/]+)/m);
      if(match != null && match.length > 3) {
        var game = findGame(+match[1]);
        if(game && game.history) {
          const who = match[2];
          const action = match[3];
          const score = match[4];
          const [winner, loser, reason] = session.getParser().getGameResult(game.wname, game.bname, who, action);
          game.history.setMetatags({Result: score, Termination: reason});
          return;
        }
      }

      match = msg.match(/^Removing game (\d+) from observation list./m);
      if(!match)
        match = msg.match(/^You are no longer examining game (\d+)./m);
      if(match != null && match.length > 1) {
        var game = findGame(+match[1]);
        if(game) {
          if(game === gameWithFocus)
            stopEngine();
          cleanupGame(game);
        }

        var index = gameExitPending.indexOf(+match[1]);
        if(index !== -1) {
          gameExitPending.splice(index, 1);
          if(!gameExitPending.length && !multiboardToggle)
            session.send('refresh');
        }
        return;
      }

      match = msg.match(/(?:^|\n)-- channel list: \d+ channels --\s*([\d\s]*)/);
      if (match !== null && match.length > 1) {
        if(!channelListRequested) 
          chat.newMessage('console', data);

        channelListRequested = false;
        return chat.addChannels(match[1].split(/\s+/).sort(function(a, b) { return a - b; }));
      }
      
      match = msg.match(/(?:^|\n)-- computer list: \d+ names --([\w\s]*)/);
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
      if(match) {
        for(let i = 0; i < games.length; i++) {
          if(games[i].movelistRequested)
            return;
        }
      }

      // Moving backwards and forwards is now handled more generally by updateHistory()
      match = msg.match(/^Game\s\d+: \w+ backs up (\d+) moves?\./m);
      if (match != null && match.length > 1)
        return;
      match = msg.match(/^Game\s\d+: \w+ goes forward (\d+) moves?\./m);
      if (match != null && match.length > 1)
        return;
      
      // Suppress output when commiting a movelist in examine mode
      match = msg.match(/^Game \d+: \w+ commits the subvariation\./m);
      if(!match) 
        match = msg.match(/^Game \d+: \w+ sets (white|black)'s clock to \S+/m);
      if(!match)
        match = msg.match(/^Game \d+: \w+ moves: \S+/m);
      if(!match)
        match = msg.match(/^Entering setup mode\./m);
      if(!match)
        match = msg.match(/^Castling rights for (white|black) set to \w+\./m);
      if(!match)
        match = msg.match(/^It is now (white|black)'s turn to move\./m);
      if(!match)
        match = msg.match(/^Game is validated - entering examine mode\./m);
      if(!match)
        match = msg.match(/^The game type is now .*/m);
      if(!match)
        match = msg.match(/^done: Command not found\./m); 
      if(match) {
        var game = getPlayingExaminingGame();
        if(game && game.commitingMovelist) {
          if(match[0] === 'done: Command not found.') // This was sent by us to indicate when we are done
            game.commitingMovelist = false;
          return; 
        } 
      }
      
      match = msg.match(/^Starting a game in examine \(scratch\) mode\./m);
      if(match && examineModeRequested)
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
        msg === 'ms set.' 
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

        var adjourned = (offer.adjourned ? ' (adjourned)' : '');

        requestsHtml += 'Challenging ' + offer.opponent + ' to ' + (time === '' ? 'an ' : 'a ') + time + unrated + offer.category + color + ' game' + adjourned + '.';
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

export function scrollToBoard(game?: Game) {
  if(isSmallWindow()) {
    if(!game || game.element.parent().attr('id') === 'main-board-area') {
      if($('#collapse-chat').hasClass('show')) {
        $('#collapse-chat').collapse('hide'); // this will scroll to board after hiding chat
        return;
      }
      const windowHeight = window.visualViewport ? window.visualViewport.height : $(window).height();
      $(document).scrollTop($('#right-panel-header').offset().top + $('#right-panel-header').outerHeight() - windowHeight);
    }
    else
      $(document).scrollTop(game.element.offset().top);
  }
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

function showCapturedMaterial(game: Game) {
  var whiteChanged = false;
  var blackChanged = false;

  var captured = { 
    P: 0, R: 0, B: 0, N: 0, Q: 0, K: 0, p: 0, r: 0, b: 0, n: 0, q: 0, k: 0 
  };

  if(game.category === 'crazyhouse' || game.category === 'bughouse') 
    captured = game.history.current().holdings; // for crazyhouse/bughouse we display the actual pieces captured
  else {
    const material = { 
      P: 0, R: 0, B: 0, N: 0, Q: 0, K: 0, p: 0, r: 0, b: 0, n: 0, q: 0, k: 0 
    };

    const pos = game.history.current().fen.split(/\s+/)[0];
    for(let i = 0; i < pos.length; i++) {
      if(material.hasOwnProperty(pos[i]))
        material[pos[i]]++;
    }
    
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

  if(game.captured !== undefined) {
    for(let key in captured) {
      if(game.captured[key] != captured[key]) {
        if(key === key.toUpperCase())
          blackChanged = true;
        else
          whiteChanged = true;
      }
    }
  }
  game.captured = captured; 

  if(whiteChanged) {
    let panel = (game.color === 'w' ? game.element.find('.player-status .captured') : game.element.find('.opponent-status .captured'));   
    panel.empty();
  }
  if(blackChanged) {
    let panel = (game.color === 'b' ? game.element.find('.player-status .captured') : game.element.find('.opponent-status .captured'));   
    panel.empty();
  } 

  for (const key in captured) {
    let panel = undefined;
    if(whiteChanged && key === key.toLowerCase() && captured[key] > 0) {
      var color = 'b';
      var piece = color + key.toUpperCase();
      var num = captured[key];
      panel = (game.color === 'w' ? game.element.find('.player-status .captured') : game.element.find('.opponent-status .captured'));
    }
    else if(blackChanged && key === key.toUpperCase() && captured[key] > 0) {
      var color = 'w';
      var piece = color + key;
      var num = captured[key];
      panel = (game.color === 'b' ? game.element.find('.player-status .captured') : game.element.find('.opponent-status .captured'));
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
  var game = gameWithFocus;
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

  if((game.isPlaying() && game.color !== color) || game.isExamining() || game.role === Role.NONE) {
    lockOverflow();
    game.board.dragNewPiece(piece, event);
    event.preventDefault();
  }
}

function updateHistory(game: Game, move?: any, fen?: string) {
  // This is to allow multiple fast 'forward' or 'back' button presses in examine mode before the command reaches the server
  // bufferedHistoryEntry contains a temporary reference to the current move which is used for subsequent forward/back button presses
  if(game.bufferedHistoryCount) 
    game.bufferedHistoryCount--;
  if(!game.bufferedHistoryCount)
    game.bufferedHistoryEntry = null;
  
  // If currently commiting a move list in examine mode. Don't display moves until we've finished
  // sending the move list and then navigated back to the current move.
  if(game.commitingMovelist)
    return;
 
  if(!fen) 
    fen = game.chess.fen();

  const hEntry = game.history.find(fen);

  if(!hEntry) {
    if(game.movelistRequested)
      return;

    if(move) {
      var newSubvariation = false;

      if(game.role === Role.NONE || game.isExamining()) {
        if(game.history.length() === 0) 
          game.history.scratch(true);
    
        var newSubvariation = (game.newVariationMode === NewVariationMode.NEW_VARIATION) || 
            (game.newVariationMode !== NewVariationMode.OVERWRITE_VARIATION && !game.history.scratch() && !game.history.current().isSubvariation());
     
        game.newVariationMode = NewVariationMode.ASK;
      }

      game.history.add(move, fen, newSubvariation, game.wtime, game.btime);
      getOpening(game);      
      updateVariantMoveData(game);
      $('#game-pane-status').hide();
    }
    else { 
      // move not found, request move list
      game.movelistRequested++;
      session.send('iset startpos 1'); // Show the initial board position before the moves list 
      session.send('moves ' + game.id);
      session.send('iset startpos 0');
    }
  }
  else {
    if(!game.movelistRequested && game.role !== Role.NONE) 
      game.history.updateClockTimes(hEntry, game.wtime, game.btime);

    // move is already displayed
    if(hEntry === game.history.current()) {
      setClocks(game);
      return;
    }

    // move is earlier, we need to take-back
    if(game.isPlaying() || game.isObserving()) {
      if(hEntry !== game.history.last()) {
        game.board.cancelPremove();
        game.board.cancelPredrop();
      }
      while(hEntry !== game.history.last())
        game.history.removeLast();
    }
  }

  game.history.display(hEntry, move !== undefined);

  if(game.removeMoveRequested && game.removeMoveRequested.prev === hEntry) {
    game.history.remove(game.removeMoveRequested);
    game.removeMoveRequested = null;
    if(game === gameWithFocus && !game.history.hasSubvariation())
      $('#exit-subvariation').hide();
  }
}

function updateVariantMoveData(game: Game) {
  // Maintain map of captured pieces for crazyhouse variant
  if(game.category === 'crazyhouse' || game.category === 'bughouse') {
    var prevMove = game.history.prev();
    var currMove = game.history.current();
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
        var color = prevMove.turnColor;
        let pieceType = (color === 'w' ? 'p' : 'P');
        holdings[pieceType]++;
      }

      promoted = updatePromotedList(move, promoted);
      currMove.promoted = promoted;
    }

    if(move.san && move.san.includes('@')) {
      var color = prevMove.turnColor;
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

function setClocks(game: Game) {
  var hEntry = game.history.current();

  if(!game.isPlaying() && game.role !== Role.OBSERVING) {
    game.clock.setWhiteClock(hEntry.wtime);
    game.clock.setBlackClock(hEntry.btime);
  }

  // Add my-turn highlighting to clock
  var whiteClock = (game.color === 'w' ? game.element.find('.player-status .clock') : game.element.find('.opponent-status .clock'));
  var blackClock = (game.color === 'b' ? game.element.find('.player-status .clock') : game.element.find('.opponent-status .clock'));
  var turnColor;
  if(game.isPlaying() || game.role === Role.OBSERVING)
    turnColor = game.chess.turn();
  else
    turnColor = hEntry.turnColor;

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
function hitClock(game: Game, setClocks: boolean = false) {
  if(game.isPlaying() || game.role === Role.OBSERVING) {
    const thisPly = History.getPlyFromFEN(game.chess.fen());  
    
    // If a move was received from the server, set the clocks to the updated times
    // Note: When in examine mode this is handled by setClocks() instead
    if(setClocks) { // Get remaining time from server message
      if(game.category === 'untimed') {
        game.clock.setWhiteClock(null); 
        game.clock.setBlackClock(null);
      }
      else {
        game.clock.setWhiteClock(); 
        game.clock.setBlackClock();
      }
    }
    else if(game.inc !== 0) { // Manually add time increment
      if(game.chess.turn() === 'w' && thisPly >= 5) 
        game.clock.setBlackClock(game.clock.getBlackTime() + game.inc * 1000);
      else if(game.chess.turn() === 'b' && thisPly >= 4)
        game.clock.setWhiteClock(game.clock.getWhiteTime() + game.inc * 1000);
    }

    if((thisPly >= 3 || game.category === 'bughouse') && game.chess.turn() === 'w')
      game.clock.startWhiteClock();
    else if((thisPly >= 4 || game.category === 'bughouse') && game.chess.turn() === 'b')
      game.clock.startBlackClock();
  }
}

export function updateBoard(game: Game, playSound = false) {
  if(!game.history)
    return;

  const move = game.history.current().move;
  const fen = game.history.current().fen;

  setClocks(game);

  game.board.set({ fen });

  if(game.element.find('.promotion-panel').is(':visible')) {
    game.board.cancelPremove();
    hidePromotionPanel(game);
  }

  const localChess = new Chess(fen);

  if(move && move.from && move.to) 
    game.board.set({ lastMove: [move.from, move.to] });
  else if(move && move.to)
    game.board.set({ lastMove: [move.to] });
  else
    game.board.set({ lastMove: false });

  let dests : Map<Key, Key[]> | undefined;
  let movableColor : string | undefined;
  let turnColor : string | undefined;

  if(game.isObserving()) {
    turnColor = toColor(game.chess);
  }
  else if(game.isPlaying()) {
    movableColor = (game.color === 'w' ? 'white' : 'black');
    dests = toDests(game, game.chess);
    turnColor = toColor(game.chess);
  }
  else {
    movableColor = toColor(localChess);
    dests = toDests(game, localChess);
    turnColor = toColor(localChess);
  }

  let movable : any = {};
  movable = {
    color: movableColor,
    dests,
    showDests: highlightsToggle,
    rookCastle: game.category === 'wild/fr'
  };

  game.board.set({
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

  showCapturedMaterial(game);
  showOpeningName(game);
  setFontSizes(); 

  if(playSound && soundToggle && game === gameWithFocus) {
    clearTimeout(soundTimer);
    soundTimer = setTimeout(() => {
      if(!game.history)
        return; 

      const entry = game.history.current();
      const chess = new Chess(entry.fen);
      if(chess.in_check()) {
        Sounds.checkSound.pause();
        Sounds.checkSound.currentTime = 0;
        Sounds.checkSound.play();
      }
      else if(entry.move?.captured) {
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

  if(game === gameWithFocus) {
    if(game.history.current().isSubvariation()) {
      $('#exit-subvariation').removeClass('disabled');  
      $('#exit-subvariation').show();
    }
    else
      $('#exit-subvariation').addClass('disabled');
    
    // create new imstance of Stockfish for each move, since waiting for new position/go commands is very slow (with current SF build)
    if(engine) {
      stopEngine();
      startEngine();
    }
    if(evalEngine)
      evalEngine.evaluate();
  }
}

function startEngine() {
  var game = gameWithFocus;

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
    
    engine = new Engine(game, null, displayEnginePV, options);
    if(!game.movelistRequested)
      engine.move(game.history.current());
  }
}

function displayEnginePV(game: Game, pvNum: number, pvEval: string, pvMoves: string) {
  $('#engine-pvs li').eq(pvNum - 1).html('<b>(' + pvEval + ')</b> ' + pvMoves + '<b/>');

  if(pvNum === 1 && pvMoves) {
    var words = pvMoves.split(/\s+/);
    var san = words[0].split(/\.+/)[1];
    var parsed = parseMove(game, game.history.current().fen, san);
    game.board.setAutoShapes([{
      orig: parsed.move.from || parsed.move.to, // For crazyhouse, just draw a circle on dest square
      dest: parsed.move.to,
      brush: 'yellow',
    }]);
  }
}

function getPlayComputerEngineOptions(game: Game): object {
  var skillLevels = [0, 1, 2, 3, 5, 7, 9, 11, 13, 15]; // Skill Level for each difficulty level
  
  var engineOptions = {}
  if(game.category === 'wild/fr')
    engineOptions['UCI_Chess960'] = true;
  else if(game.category === 'crazyhouse')
    engineOptions['UCI_Variant'] = game.category;

  engineOptions['Skill Level'] = skillLevels[game.difficulty - 1];

  return engineOptions;
}

function getPlayComputerMoveParams(game: Game): string {
  // Max nodes for each difficulty level. This is also used to limit the engine's thinking time
  // but in a way that keeps the difficulty the same across devices
  var maxNodes = [100000, 200000, 300000, 400000, 500000, 600000, 700000, 800000, 900000, 1000000];
  var moveParams = 'nodes ' + maxNodes[game.difficulty - 1];

  return moveParams;
}

function playComputer(params: any) {
  var computerGame = getComputerGame();
  if(computerGame) {
    cleanupGame(computerGame);
    var game = computerGame; 
  }
  else if(!multiboardToggle) 
    var game = getMainGame();
  else {
    var game = getFreeGame();
    if(!game)
      game = createGame();
    game.id = -1;
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
    wname: wname,                           // White's name
    bname: bname,                           // Black's name
    wrating: '',                            // White's rating
    brating: '',                            // Black's rating
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
  showStatusMsg(game, statusMsg);

  messageHandler(data); 
}

(window as any).rematchComputer = () => {
  if(lastComputerGame.playerColorOption === 'Any') 
    lastComputerGame.playerColor = (lastComputerGame.playerColor === 'White' ? 'Black' : 'White');
  playComputer(lastComputerGame);
};

(window as any).analyze = () => {
  showAnalysis();
  showStatusPanel();
  scrollToLeftPanelBottom();
};

function playComputerBestMove(game: Game, bestMove: string, score: string = '=0.00') {
  var move;
  if(bestMove[1] === '@') // Crazyhouse/bughouse
    move = bestMove;
  else
    move = { 
      from: bestMove.slice(0,2),
      to: bestMove.slice(2,4),
      promotion: (bestMove.length === 5 ? bestMove[4] : undefined)
    }

  game.lastComputerMoveEval = score;

  var parsedMove = parseMove(game, game.chess.fen(), move);

  var moveData = {
    role: Role.PLAYING_COMPUTER,                      // game mode
    id: -1,                                           // game id, always -1 for playing computer
    fen: parsedMove.fen,                              // board/game state
    turn: History.getTurnColorFromFEN(parsedMove.fen), // color whose turn it is to move ("B" or "W")
    wtime: game.clock.getWhiteTime(),                      // White's remaining time
    btime: game.clock.getBlackTime(),                      // Black's remaining time
    moveNo: History.getMoveNoFromFEN(parsedMove.fen), // the number of the move about to be made
    moveVerbose: parsedMove,                          // verbose coordinate notation for the previous move ("none" if there werenone) [note this used to be broken for examined games]
    move: parsedMove.move.san,                        // pretty notation for the previous move ("none" if there is none)
  }
  messageHandler(moveData);  
}

function generateChess960FEN(idn?: number): string {
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

  if(!(idn >= 0 && idn <= 959))
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

function checkGameEnd(game: Game) {  
  if(game.role !== Role.PLAYING_COMPUTER)
    return;

  var chess = game.chess;
  var gameEnd = false;
  var isThreefold = game.history.isThreefoldRepetition();
  var winner = '', loser = '';
  var turnColor = History.getTurnColorFromFEN(chess.fen());
  var gameStr = '(' + game.wname + ' vs. ' + game.bname + ')';

  // Check white or black is out of time
  if(game.clock.getWhiteTime() < 0 || game.clock.getBlackTime() < 0) {
    var wtime = game.clock.getWhiteTime();
    var btime = game.clock.getBlackTime();

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
      score: scoreStr,
      message: gameStr + ' ' + reasonStr + ' ' + scoreStr
    };
    messageHandler(gameEndData);  
  }
}

async function showOpeningName(game: Game) {
  await fetchOpeningsPromise; // Wait for the openings file to be loaded

  if(!game.history)
    return;

  var hEntry = game.history.current();
  if(!hEntry.move)
    hEntry = game.history.last();

  while(!hEntry.opening) {
    if(!hEntry.move)
      return;
    hEntry = hEntry.prev;
  }

  game.statusElement.find('.opening-name').text(hEntry.opening.name);
  game.statusElement.find('.opening-name').show();
}

function stopEngine() {
  $('#start-engine').text('Go');

  if(engine) {
    engine.terminate();
    engine = null;
    setTimeout(() => { gameWithFocus.board.setAutoShapes([]); }, 0); // Need timeout to avoid conflict with board.set({orientation: X}); if that occurs in the same message handler
  }
}

function hideAnalysis() {
  stopEngine();
  closeLeftBottomTab($('#engine-tab'));
  closeLeftBottomTab($('#eval-graph-tab'));
  showAnalyzeButton();
  gameWithFocus.analyzing = false;
  gameWithFocus.currentStatusTab = null;
}

function showAnalyzeButton() { 
  if($('#left-panel-bottom').is(':visible')) {
    $('#show-status-panel').text('Analyze');
    $('#show-status-panel').attr('title', 'Analyze Game');
  }  

  if(!$('#engine-tab').is(':visible') && Engine.categorySupported(gameWithFocus.category))
    $('#show-status-panel').show();
  else if($('#left-panel-bottom').is(':visible'))
    $('#show-status-panel').hide();
}

function showAnalysis() {
  var game = gameWithFocus;
  var currentStatusTab = game.currentStatusTab;

  openLeftBottomTab($('#engine-tab'));
  openLeftBottomTab($('#eval-graph-tab'));

  $('#engine-pvs').empty();
  for(let i = 0; i < numPVs; i++)
    $('#engine-pvs').append('<li>&nbsp;</li>');
  $('#engine-pvs').css('white-space', (numPVs === 1 ? 'normal' : 'nowrap'));
  gameWithFocus.analyzing = true;

  if(currentStatusTab && currentStatusTab.attr('id') !== 'eval-graph-tab')
    currentStatusTab.tab('show');
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

function getMoves(game: Game) {
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

$('#collapse-menus').on('hidden.bs.collapse', (event) => {
  $('#menus-toggle-icon').removeClass('fa-toggle-up').addClass('fa-toggle-down');

  activeTab = $('#pills-tab button').filter('.active');
  if(!activeTab.length)
    activeTab = $('#pills-play-tab');
  activeTab.removeClass('active');
  activeTab.parent('li').removeClass('active');
  $(activeTab.attr('data-bs-target')).removeClass('active');

  $('#collapse-menus').removeClass('collapse-init');
});

$('#collapse-menus').on('show.bs.collapse', (event) => {
  $('#menus-toggle-icon').removeClass('fa-toggle-down').addClass('fa-toggle-up');
  scrollToTop();
  activeTab.tab('show');
});

$('#lobby-table-container').on('scroll', (e) => {
  var container = $('#lobby-table-container')[0];
  lobbyScrolledToBottom = container.scrollHeight - container.clientHeight < container.scrollTop + 1.5;
});

$('#pills-tab button').on('click', function(event) {
  activeTab = $(this);
  $('#collapse-menus').collapse('show');
  scrollToTop();
});

$('#flip-toggle').on('click', (event) => {
  flipBoard(gameWithFocus);
});

function flipBoard(game: Game) {
  game.board.toggleOrientation();

  // If pawn promotion dialog is open, redraw it in the correct location
  if(game.element.find('.promotion-panel').is(':visible')) 
    showPromotionPanel(game, game.promoteIsPremove);

  // Swap player and opponent status panels
  if(game.element.find('.player-status').parent().hasClass('top-panel')) {
    game.element.find('.player-status').appendTo(game.element.find('.bottom-panel'));
    game.element.find('.opponent-status').appendTo(game.element.find('.top-panel'));
  }
  else {
    game.element.find('.player-status').appendTo(game.element.find('.top-panel'));
    game.element.find('.opponent-status').appendTo(game.element.find('.bottom-panel'));
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

function splitMessage(text: string, maxLength: number): string[] {
  let result = [];
  let currentMessage = '';
  let currentLength = 0;
  const regex = /&#\d+;|./g; // Match HTML entities or any character
  
  text.replace(regex, (match) => {
    const matchLength = match.length;
    if (currentLength + matchLength > maxLength) {
      result.push(currentMessage);
      currentMessage = match;
      currentLength = matchLength;
    } 
    else {
      currentMessage += match;
      currentLength += matchLength;
    }
    return match;
  });
  if (currentMessage) 
    result.push(currentMessage);
  
  return result;
}

$('#input-form').on('submit', (event) => {
  event.preventDefault();
  let text;
  let val: string = getValue('#input-text');
  val = val.replace(/[“‘”]/g, "'");
  val = val.replace(/[^\S ]/g, ' '); // replace other whitespace chars with space
  val = val.replace(/[\x00-\x1F\x7F-\x9F]/g, ''); // Strip out ascii and unicode control chars
  if (val === '' || val === '\n') {
    return;
  }

  const tab = chat.currentTab();
  if(val.charAt(0) === '@')
    text = val.substring(1);
  else if(tab !== 'console') {  
    if (tab.startsWith('game-')) {
      var gameNum = tab.split('-')[1];
      var game = findGame(+gameNum);
      if(game && game.role === Role.OBSERVING)          
        var xcmd = 'xwhisper';
      else
        var xcmd = 'xkibitz'; 
          
      text = xcmd + ' ' + gameNum + ' ' + val;
    } 
    else 
      text = 't ' + tab + ' ' + val;
  } 
  else
    text = val;
  
  // Check if input is a chat command, and if so do processing on the message before sending
  var match = text.match(/^\s*(\S+)\s+(\S+)\s+(.+)$/);
  if(match && match.length === 4 && 
      ('tell'.startsWith(match[1]) || 
      (('xwhisper'.startsWith(match[1]) || 'xkibitz'.startsWith(match[1]) || 'xtell'.startsWith(match[1])) && match[1].length >= 2))) {
    var chatCmd = match[1];
    var recipient = match[2];
    var message = match[3];
  }
  else {
    match = text.match(/^\s*([.,])\s*(.+)$/);
    if(!match)
      match = text.match(/^\s*(\S+)\s+(.+)$/);
    if(match && match.length === 3 &&
        ('kibitz'.startsWith(match[1]) || '.,'.includes(match[1]) ||
        (('whisper'.startsWith(match[1]) || 'say'.startsWith(match[1]) || 'ptell'.startsWith(match[1])) && match[1].length >= 2))) {
      var chatCmd = match[1];
      var message = match[2];
    }
  }
  
  if(chatCmd) {
    var maxLength = (session.isRegistered() ? 400 : 200);
    if(message.length > maxLength) 
      message = message.slice(0, maxLength);
    
    message = unicodeToHTMLEncoding(message);
    var messages = splitMessage(message, maxLength); // if message is now bigger than maxLength chars due to html encoding split it

    for(let msg of messages) {
      if(('xtell'.startsWith(chatCmd) || 'tell'.startsWith(chatCmd)) && !/^\d+$/.test(recipient)) {
        chat.newMessage(recipient, {
          type: MessageType.PrivateTell,
          user: session.getUser(),
          message: msg,
        });
      }
      session.send(chatCmd + ' ' + (recipient ? recipient + ' ' : '') + msg);    
    }
  }
  else
    session.send(unicodeToHTMLEncoding(text));

  $('#input-text').val('');
  updateInputText();
});

$('#input-text').on('input', function() {
  updateInputText();
});

$('#input-text').on('keydown', function(event) {
  if(event.key === 'Enter') {
    event.preventDefault(); 
    $('#input-form').trigger('submit'); 
  }
});

$(document).on('shown.bs.tab', '#tabs button[data-bs-toggle="tab"]', (e) => {
  updateInputText();
});

function updateInputText() {
  var element = $('#input-text')[0] as HTMLTextAreaElement;
  var start = element.selectionStart;
  var end = element.selectionEnd;

  var val = element.value as string;
  val = val.replace(/[^\S ]/g, ' '); // replace all whitespace chars with spaces

  // Stop the user being able to type more than max length characters
  const tab = chat.currentTab();
  if(val.charAt(0) === '@')
    var maxLength = 1024;
  else if(tab === 'console')
    var maxLength = 1023;
  else if(!session.isRegistered()) // Guests are limited to half the tell length
    var maxLength = 200;
  else
    var maxLength = 400;

  if(val.length > maxLength) 
    val = val.substring(0, maxLength);

  if(val !== element.value as string) {
    element.value = val;
    element.setSelectionRange(start, end);
  }

  adjustInputTextHeight(); // Resize text area
}

function adjustInputTextHeight() {
  var inputElem = $('#input-text');
  var oldLines = +inputElem.attr('rows');
  inputElem.attr('rows', 1);
  inputElem.css('overflow', 'hidden');

  var lineHeight = parseFloat(inputElem.css('line-height'));
  var numLines = Math.floor(inputElem[0].scrollHeight / lineHeight);
  var maxLines = 0.33 * $('#chat-panel').height() / lineHeight;
  if(numLines > maxLines) 
    numLines = maxLines;

  inputElem.attr('rows', numLines);
  inputElem.css('overflow', '');

  var heightDiff = (numLines - 1) * lineHeight;
  $('#right-panel-footer').height($('#left-panel-footer').height() + heightDiff);
  
  if(numLines !== oldLines && chat) 
    chat.fixScrollPosition();
}

function unicodeToHTMLEncoding(text) {
  return text.replace(/[\u0080-\uffff]/g, function(match) {
    return `&#${match.charCodeAt(0)};`;
  });
}

async function getBookMoves(fen: string): Promise<any[]> {
  if(!book)
    book = new Polyglot("assets/data/gm2600.bin");
  
  var entries = await book.getMovesFromFen(fen);
  return entries;
}

function createBoard(element: any): any {
  return Chessground(element[0], {
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
}

function createGame(): Game {
  var game = new Game();
  if(!games.length) {
    game.element = $('#main-board-area').children().first();
    game.statusElement = $('#game-status-list > :first-child');
    game.moveTableElement = $('#move-table > :first-child');
    game.moveListElement = $('#movelists > :first-child');
    game.board = mainBoard;
  }
  else {
    game.element = $('#main-board-area').children().first().clone();
    game.board = createBoard(game.element.find('.board'));
    makeSecondaryBoard(game);
    game.element.find($('[title="Close"]')).css('visibility', 'visible');
    $('#secondary-board-area').css('display', 'flex');
    $('#collapse-chat-arrow').show();

    game.statusElement = gameWithFocus.statusElement.clone();
    game.statusElement.css('display', 'none');
    game.statusElement.appendTo($('#game-status-list'));

    game.moveTableElement = gameWithFocus.moveTableElement.clone();
    game.moveTableElement.css('display', 'none');
    game.moveTableElement.appendTo($('#move-table'));

    game.moveListElement = gameWithFocus.moveListElement.clone();
    game.moveListElement.css('display', 'none');
    game.moveListElement.appendTo($('#movelists')); 

    $('#secondary-board-area')[0].scrollTop = $('#secondary-board-area')[0].scrollHeight; // Scroll secondary board area to the bottom
  
    $('#game-tools-close').parent().show();
  }

  function gameTouchHandler(event) {
    $('#input-text').trigger('blur');
    setGameWithFocus(game);
  }
  game.element[0].addEventListener('touchstart', gameTouchHandler, {passive: true}); 
  game.element[0].addEventListener('mousedown', gameTouchHandler);

  game.element.on('click', '[title="Close"]', (event) => {
    var game = gameWithFocus;
    if(game.preserved || game.history.editMode)
      closeGameDialog(game);
    else
      closeGame(game);
    event.stopPropagation();
  });

  game.element.on('click', '[title="Maximize"]', (event) => {
    setGameWithFocus(game);
    maximizeGame(game);
  });

  game.element.on('dblclick', (event) => {
    if(getMainGame() === game)
      return;

    setGameWithFocus(game);
    maximizeGame(game);
  });

  game.clock = new Clock(game, checkGameEnd);
  games.push(game);
  setRightColumnSizes();

  return game;
}

function makeSecondaryBoard(game: Game) {
  game.element.detach();
  game.element.find('.top-panel, .bottom-panel').css('height', '');
  game.element.addClass('game-card-sm');
  game.element.find('.title-bar').css('display', 'block');
  game.element.appendTo('#secondary-board-area');
  game.board.set({ coordinates: false }); 
}

function makeMainBoard(game: Game) {
  game.element.detach();
  game.element.removeClass('game-card-sm');
  game.element.removeClass('game-focused');
  game.element.find('.title-bar').css('display', 'none');
  game.element.appendTo('#main-board-area');
  game.board.set({ coordinates: true }); 
}

export function maximizeGame(game: Game) {
  if(getMainGame() !== game) {
    animateBoundingRects(game.element, $('#main-board-area'), game.element.css('--border-expand-color'), game.element.css('--border-expand-width'));

    // Move currently maximized game card to secondary board area
    var prevMaximized = getMainGame();
    if(prevMaximized) 
      makeSecondaryBoard(prevMaximized);
    else
      $('#main-board-area').empty();
    // Move card to main board area
    makeMainBoard(game);
    setPanelSizes();
    setFontSizes();
  }
  scrollToBoard(game);
}

function animateBoundingRects(fromElement: any, toElement: any, color: string = '#000000', width: string = '1px', numRects: number = 3) {
  var fromTop = fromElement.offset().top;
  var fromLeft = fromElement.offset().left;
  var fromWidth = fromElement.outerWidth();
  var fromHeight = fromElement.outerHeight();
  
  var toTop = toElement.offset().top;
  var toLeft = toElement.offset().left;
  var toWidth = toElement.outerWidth();
  var toHeight = toElement.outerHeight();

  var distance = Math.sqrt((toTop - fromTop) ** 2 + (toLeft - fromLeft) ** 2);
  var speed = 0.015 * Math.sqrt(distance); 
  
  // Create bounding div
  var boundingDiv = $('<div></div>');
  boundingDiv.css({
    position: 'absolute',
    top: fromTop,
    left: fromLeft,
    width: fromWidth,
    height: fromHeight,
    zIndex: 3,
    'transition-property': 'width, height, top, left',
    'transition-duration': speed + 's',
    'transition-timing-function': 'ease'
  });
  boundingDiv.appendTo($('body'));

  // Create animated rects
  var rect = boundingDiv;
  for(let i = 0; i < numRects; i++) {
    var childRect = $('<div></div>');
    childRect.css({
      width: '100%',
      height: '100%',
      padding: 'calc(50% / ' + (numRects - i) + ')',
      border: width + ' solid ' + color
    });
    var rect = childRect.appendTo(rect);
  }

  boundingDiv.one('transitionend', () => {
    boundingDiv.remove();
  });
  setTimeout(() => { 
    boundingDiv.css({
      top: toTop,
      left: toLeft,
      width: toWidth,
      height: toHeight
    }); 
  }, 0);
}

function closeGameDialog(game: Game) {
  (window as any).closeGameClickHandler = (event) => {
    if(game)
      closeGame(game);
  };

  var headerTitle = 'Close Game';
  var bodyText = 'Really close game?';
  var button1 = [`closeGameClickHandler(event)`, 'OK'];
  var button2 = ['', 'Cancel']; 
  var showIcons = true;
  showFixedDialog({type: headerTitle, msg: bodyText, btnFailure: button2, btnSuccess: button1, icons: showIcons});
}

function closeGame(game: Game) {
  if(!games.includes(game))
    return;

  if(game.isObserving() || game.isExamining())
    gameExitPending.push(game.id);
  
  if(game.isObserving()) 
    session.send('unobs ' + game.id);
  else if(game.isExamining())
    session.send('unex');
  removeGame(game);    
}

function getMainGame(): Game {
  return games.find(g => g.element.parent().is('#main-board-area'));
}

function getPlayingExaminingGame(): Game {
  return games.find(g => g.isPlayingOnline() || g.isExamining());
}

function getFreeGame(): Game {
  var game = getMainGame();
  if(game.role === Role.NONE && !game.preserved && !game.history?.editMode)
    return game;

  return games.find(g => g.role === Role.NONE && !g.preserved && !g.history?.editMode);
}

function getComputerGame(): Game {
  return games.find(g => g.role === Role.PLAYING_COMPUTER);
}

function getMostImportantGame(): Game {
  // find most important board 
  // out of playing/examining game, then computer game, then observed game on main board, then other observed game
  var game = getPlayingExaminingGame();
  if(!game)
    game = getComputerGame();
  if(!game) {
    var mainGame = getMainGame();
    if(mainGame && mainGame.isObserving())
      game = mainGame;
  }
  if(!game)
    game = games.find(g => g.isObserving());
  if(!game)
    game = mainGame;
  if(!game)
    game = games[0];

  return game;
}

function removeGame(game: Game) {
  // remove game from games list
  let index = games.indexOf(game);
  if(index !== -1) 
    games.splice(index, 1);

  // if we are removing the main game, choose the most important secondary game to maximize
  if(game.element.parent().is('#main-board-area')) {
    var newMainGame = getMostImportantGame();
    maximizeGame(newMainGame);
  }

  // If game currently had the focus, switch focus to the main game
  if(game === gameWithFocus)
    setGameWithFocus(getMainGame());

  cleanupGame(game);

  // Remove game's html elements from the DOM
  game.element.remove();
  game.moveTableElement.remove();
  game.moveListElement.remove();
  game.statusElement.remove();
 
  // clean up circular references
  game.history = null;
  game.clock = null;

  if(!$('#secondary-board-area').children().length) {
    $('#secondary-board-area').hide();
    $('#collapse-chat-arrow').hide();
  }
  setRightColumnSizes();

  if(games.length === 1) 
    $('#game-tools-close').parent().hide();
}

export function findGame(id: number): Game {
  return games.find(element => element.id === id);
}

export function setGameWithFocus(game: Game) {
  if(game !== gameWithFocus) {
    if(gameWithFocus) {
      gameWithFocus.element.removeClass('game-focused');
      gameWithFocus.moveTableElement.hide();
      gameWithFocus.moveListElement.hide();
      gameWithFocus.statusElement.hide();
      gameWithFocus.board.setAutoShapes([]);
    }
    
    game.moveTableElement.show();
    game.moveListElement.show();
    game.statusElement.show();

    if(game.element.parent().attr('id') === 'secondary-board-area')
      game.element.addClass('game-focused');  

    gameWithFocus = game;

    setMovelistViewMode();
    initGameControls(game);
  
    updateBoard(game);
  }
}

function initGameControls(game: Game) {
  if(game !== gameWithFocus)
    return; 

  safeRemove($('.context-menu'));
  initAnalysis(game);
  initGameTools(game);

  if(game.historyList.length > 1) {
    $('#game-list-button > .label').text(getGameListDescription(game.history, false));
    $('#game-list-button').show();
  }
  else
    $('#game-list-button').hide();

  if(!game.history || !game.history.hasSubvariation())
    $('#exit-subvariation').hide();

  if(game.isPlaying()) {
    $('#viewing-game-buttons').hide();
    $('#playing-game-buttons').show();
  }
  else {
    $('#playing-game-buttons').hide();
    $('#viewing-game-buttons').show();
  }

  $('#takeback').prop('disabled', game.role === Role.PLAYING_COMPUTER);

  if((game.isExamining() || game.isObserving()) && !isSmallWindow())       
    showLeftPanelHeader2();
  else
    hideLeftPanelHeader2();

  if(game.isExamining()) 
    showButton($('#stop-examining'));
  else if(game.isObserving()) 
    showButton($('#stop-observing'));
  
  if(!game.isExamining())
    hideButton($('#stop-examining'));
  if(!game.isObserving())
    hideButton($('#stop-observing'));

  if(game.isPlaying())
    showStatusPanel();
  else
    initStatusPanel();
}

// tooltip overlays are used for elements such as dropdowns and collapsables where we usually
// want to hide the tooltip when the button is clicked
$(document).on('click', '.tooltip-overlay', (event) => {
  $(event.target).tooltip('hide');
});

// Used to keep track of the mouse coordinates for displaying menus at the mouse
$(document).on('mouseup mousedown touchend touchcancel', (event) => {
  lastPointerCoords = getTouchClickCoordinates(event);
});
document.addEventListener('touchstart', (event) => {
  lastPointerCoords = getTouchClickCoordinates(event);
}, {passive: true});

// Keeps track of whether a touch is currently in progress. Used by createContextMenu.
document.addEventListener('touchstart', (event) => {
  touchStarted = true;
}, {capture: true, passive: true});
document.addEventListener('touchend', (event) => {
  touchStarted = false;
}, {capture: true});
document.addEventListener('touchcancel', (event) => {
  touchStarted = false;
}, {capture: true});

// If a tooltip is marked as 'hover only' then only show it on mouseover not on touch
document.addEventListener('touchstart', (event) => {
  var tooltipTrigger = $(event.target).closest('[data-tooltip-hover-only]');
  tooltipTrigger.tooltip('disable');
  setTimeout(() => { tooltipTrigger.tooltip('enable'); }, 1000);
}, {passive: true});

// Enable tooltips. 
// Specify fallback placements for tooltips.
// Make tooltips stay after click/focus on mobile, but only when hovering on desktop.
// Allow the creation of "descriptive" tooltips
export function createTooltip(element: JQuery<HTMLElement>) {
  var fallbacksStr = element.attr('data-fallback-placements');
  if(fallbacksStr)
    var fallbackPlacements = fallbacksStr.split(',').map(part => part.trim());
  
  var title = element.attr('title') || element.attr('data-bs-original-title');

  var description = element.attr('data-description');
  if(description) 
    title = `<b>` + title + `</b><hr class="tooltip-separator"><div>` + description + `</div>`; 

  element.tooltip('dispose').tooltip({
    trigger: (isSmallWindow() ? 'hover focus' : 'hover'), // Tooltips stay visible after element is clicked on mobile, but only when hovering on desktop 
    title: title, 
    ...fallbackPlacements && {fallbackPlacements: fallbackPlacements},
    html: !!description,
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
  hideLeftPanelHeader2();
  createTooltips();
  layout = Layout.Mobile;
}

function useDesktopLayout() {
  swapLeftRightPanelHeaders();
  $('#chat-maximize-btn').show();
  $('#stop-observing').appendTo($('#left-panel-header-2').last());
  $('#stop-examining').appendTo($('#left-panel-header-2').last());
  if(gameWithFocus.isObserving() || gameWithFocus.isExamining())
    showLeftPanelHeader2();

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
    $('#menus-toggle-btn').appendTo($('#left-panel-header .btn-toolbar').last());
  }
  else {
    $('#chat-toggle-btn').appendTo($('#right-panel-header .btn-toolbar').last());
    $('#menus-toggle-btn').appendTo($('#navigation-toolbar').last());
  }
}

function setGameCardSize(game: Game, cardMaxWidth?: number, cardMaxHeight?: number) {
  var card = game.element;
  var roundingCorrection = (card.hasClass('game-card-sm') ? 0.032 : 0.1);

  if(cardMaxWidth !== undefined || cardMaxHeight !== undefined) {
    var cardBorderWidth = card.outerWidth() - card.width();
    var boardMaxWidth = cardMaxWidth - cardBorderWidth;  
    var cardBorderHeight = card.outerHeight() - card.height();
    
    // Get height of card headers/footers
    var siblings = card.find('.card-body').siblings();
    var siblingsHeight = 0;
    siblings.each((index, element) => {
      if($(element).is(':visible'))
        siblingsHeight += $(element).outerHeight();
    });

    var boardMaxHeight = cardMaxHeight - cardBorderHeight - siblingsHeight;

    if(!cardMaxWidth)
      boardMaxWidth = boardMaxHeight;
    if(!cardMaxHeight)
      boardMaxHeight = boardMaxWidth;

    var cardWidth: any = Math.min(boardMaxWidth, boardMaxHeight) - (2 * roundingCorrection); // Subtract small amount for rounding error
  }
  else {
    card.css('width', '');
    var cardWidth = card.width();
  }

  // Recalculate the width of the board so that the squares align to integer pixel boundaries, this is to match 
  // what chessground does internally
  cardWidth = (Math.floor((cardWidth * window.devicePixelRatio) / 8) * 8) / window.devicePixelRatio + roundingCorrection;

  // Set card width
  card.width(cardWidth);
  game.board.redrawAll();
}

function setPanelSizes() {
  // Reset player status panels that may have been previously slimmed down on single column screen
  var maximizedGame = getMainGame();
  var maximizedGameCard = maximizedGame.element;

  if(!isSmallWindow() && prevSizeCategory === SizeCategory.Small) {
    maximizedGameCard.find('.top-panel').css('height', '');
    maximizedGameCard.find('.bottom-panel').css('height', '');
  }

  // Make sure the board is smaller than the window height and also leaves room for the other columns' min-widths
  if(!isSmallWindow()) {
    // Create a temporary hidden element in order to measure its scrollbar width.
    if(!$('#scrollbar-measure').length)
      $('body').append(`<div id="scrollbar-measure" style="position: absolute; top: -9999px; overflow: scroll"></div>`);
    var scrollBarWidth = $('#scrollbar-measure')[0].offsetWidth - $('#scrollbar-measure')[0].clientWidth;

    // Set board width a bit smaller in order to leave room for a scrollbar on <body>. This is because 
    // we don't want to resize all the panels whenever a dropdown or something similar overflows the body.   
    if(isMediumWindow()) // display 2 columns on md (medium) display
      var cardMaxWidth = window.innerWidth - $('#left-col').outerWidth() - scrollBarWidth;
    else
      var cardMaxWidth = window.innerWidth - $('#left-col').outerWidth() - parseFloat($('#right-col').css('min-width')) - scrollBarWidth;    
    
    var feature3Border = $('.feature3').outerHeight(true) - $('.feature3').height();
    var cardMaxHeight = $(window).height() - feature3Border;
    setGameCardSize(maximizedGame, cardMaxWidth, cardMaxHeight);
  }
  else 
    setGameCardSize(maximizedGame);

  // Set the height of dynamic elements inside left and right panel collapsables.
  // Try to do it in a robust way that won't break if we add/remove elements later.

  // Get and store the height of the address bar in mobile browsers.
  if(addressBarHeight === undefined)
    addressBarHeight = $(window).height() - window.innerHeight;

  // On mobile, slim down player status panels in order to fit everything within window height
  if(isSmallWindow()) {
    const originalStatusHeight = $('#left-panel-header').height();
    const cardBorders = maximizedGameCard.outerHeight() - maximizedGameCard.height()
      + Math.round(parseFloat($('#left-card').css('border-bottom-width')))
      + Math.round(parseFloat($('#right-card').css('border-top-width')));
    const playerStatusBorder = maximizedGameCard.find('.top-panel').outerHeight() - maximizedGameCard.find('.top-panel').height();
    var playerStatusHeight = ($(window).height() - addressBarHeight - $('#board-card').outerHeight() - $('#left-panel-footer').outerHeight() - $('#right-panel-header').outerHeight() - cardBorders) / 2 - playerStatusBorder;
    playerStatusHeight = Math.min(Math.max(playerStatusHeight, originalStatusHeight - 20), originalStatusHeight);

    maximizedGameCard.find('.top-panel').height(playerStatusHeight);
    maximizedGameCard.find('.bottom-panel').height(playerStatusHeight);
  }

  setLeftColumnSizes();
  setRightColumnSizes();

  // Adjust Notifications drop-down width
  if(isSmallWindow() && prevSizeCategory !== SizeCategory.Small) 
    $('#notifications').css('width', '100%');
  else if(isMediumWindow() && prevSizeCategory !== SizeCategory.Medium) 
    $('#notifications').css('width', '50%');
  else if(isLargeWindow()) 
    $('#notifications').width($(document).outerWidth(true) - $('#left-col').outerWidth(true) - $('#mid-col').outerWidth(true));
}

function setLeftColumnSizes() {
  const boardHeight = $('#main-board-area .board').innerHeight();

  // set height of left menu panel inside collapsable
  if (boardHeight) {
    if($('#left-panel').height() === 0)
      $('#left-panel-bottom').css('height', '');

    var siblingsHeight = 0;
    var siblings = $('#collapse-menus').siblings();
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
}

function setRightColumnSizes() {
  const boardHeight = $('#main-board-area .board').innerHeight();
   // Set chat panel height to 0 before resizing everything so as to remove scrollbar on window caused by chat overflowing
  if(isLargeWindow())
    $('#chat-panel').height(0);

  // Set width and height of game cards in the right board area
  var numCards = $('#secondary-board-area').children().length;
  if(numCards > 2) 
    $('#secondary-board-area').css('overflow-y', 'scroll');
  else 
    $('#secondary-board-area').css('overflow-y', 'hidden');
  
  games.forEach((game) => {
    if(game.element.parent().is($('#secondary-board-area'))) {
      if(isLargeWindow()) {
        var cardsPerRow = Math.min(2, numCards);
        var cardHeight: any = boardHeight * 0.6;
      }
      else {
        var cardsPerRow = 2;
        var cardHeight = null;
      }

      var boardAreaScrollbarWidth = $('#secondary-board-area')[0].offsetWidth - $('#secondary-board-area')[0].clientWidth; 
      var innerWidth = $('#secondary-board-area').width() - boardAreaScrollbarWidth - 1;
      setGameCardSize(game, innerWidth / cardsPerRow - parseInt($('#secondary-board-area').css('gap')) * (cardsPerRow - 1) / cardsPerRow, cardHeight);
    }
  });
  if(isSmallWindow())
    $('#secondary-board-area').css('height', '');
  else
    $('#secondary-board-area').height($('#secondary-board-area > :first-child').outerHeight());

  // set height of right panel inside collapsable
  var siblingsHeight = 0;
  var siblings = $('#collapse-chat').siblings();
  siblings.each(function() {
    if($(this).is(':visible'))
      siblingsHeight += $(this).outerHeight();
  });
  const chatBodyBorder = $('#chat-panel .card-body').outerHeight() - $('#chat-panel .card-body').innerHeight();

  if(!isLargeWindow() || !boardHeight) {
    var feature3Border = $('.feature3').outerHeight(true) - $('.feature3').height();
    var rightCardBorder = $('#right-card').outerHeight(true) - $('#right-card').height();
    var borders = chatBodyBorder + rightCardBorder + feature3Border + addressBarHeight;
    var headerHeight = (siblingsHeight ? 0 : $('#right-panel-header').outerHeight()); // If there are game boards in the right column, then don't try to fit the header and chat into the same screen height
    $('#chat-panel').height($(window).height() - borders - headerHeight);
  }
  else 
    $('#chat-panel').height(boardHeight + $('#left-panel-footer').outerHeight() - chatBodyBorder - siblingsHeight);
    
  adjustInputTextHeight();
  if(chat)
    chat.fixScrollPosition();
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

async function getOpening(game: Game) {
  var historyItem = game.history.current();
  
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
  game.history.updateOpeningMetatags();
}

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
  var game = gameWithFocus;

  if(!game.isPlaying()) {
    showStatusMsg(game, 'You are not playing a game.');
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
      score: scoreStr,
      message: gameStr + ' ' + reasonStr + ' ' + scoreStr
    };
    messageHandler(gameEndData);  
  }
  else 
    session.send('resign');
});

$('#abort').on('click', (event) => {
  var game = gameWithFocus;

  if(!game.isPlaying()) {
    showStatusMsg(game, 'You are not playing a game.');
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
      score: '*',
      message: gameStr + ' ' + reasonStr + ' *'
    };
    messageHandler(gameEndData);  
  }
  else 
    session.send('abort');
});

$('#takeback').on('click', (event) => {
  var game = gameWithFocus;

  if (game.chess !== null) {
    if (game.chess.turn() === game.color)
      session.send('take 2');
    else
      session.send('take 1');
  } else {
    showStatusMsg(game, 'You are not playing a game.');
  }
});

$('#draw').on('click', (event) => {
  var game = gameWithFocus;

  if(game.chess !== null) {
    if(game.role === Role.PLAYING_COMPUTER) {
      // Computer accepts a draw if they're behind or it's dead equal and the game is on move 30 or beyond
      var gameEval = game.lastComputerMoveEval;
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
          score: scoreStr,
          message: gameStr + ' ' + reasonStr + ' ' + scoreStr
        };
        messageHandler(gameEndData);  
      }
      else 
        showBoardDialog({type: 'Draw Offer Declined', msg: 'Computer declines the draw offer'});
    }
    else
      session.send('draw');
  } else {
    showStatusMsg(game, 'You are not playing a game.');
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
  var mainGame = getPlayingExaminingGame();
  if(mainGame && mainGame.isExamining())
    session.send('unex'); 
  session.send(cmd + ' ' + min + ' ' + sec + ' ' + ratedUnrated + ' ' + color + newGameVariant);
}
(window as any).getGame = getGame;

function clearMatchRequests() {
  matchRequested = 0;
  $('#sent-offers-status').html('');
  $('#sent-offers-status').hide();
}

$('#quick-game').on('click', (event) => {
  if(!getPlayingExaminingGame())
    session.send('getga');
});

$('#stop-observing').on('click', (event) => {
  session.send('unobs ' + gameWithFocus.id);
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

function bufferedCurrentMove(game: Game) {
  return game.bufferedHistoryEntry || game.history.current();
}

function fastBackward() {
  gotoMove(gameWithFocus.history.first());
  showTab($('#pills-game-tab'));
}

$('#backward').off('click');
$('#backward').on('click', () => {
  backward();
});

function backward() {
  gotoMove(bufferedCurrentMove(gameWithFocus).prev)
  showTab($('#pills-game-tab'));
}

$('#forward').off('click');
$('#forward').on('click', () => {
  forward();
});

function forward() {
  gotoMove(bufferedCurrentMove(gameWithFocus).next, true)
  showTab($('#pills-game-tab'));
}

$('#fast-forward').off('click');
$('#fast-forward').on('click', () => {
  fastForward();
});

function fastForward() {
  gotoMove(gameWithFocus.history.last());
  showTab($('#pills-game-tab'));
}

$('#exit-subvariation').off('click');
$('#exit-subvariation').on('click', () => {
  exitSubvariation();
});

function exitSubvariation() {
  var curr = bufferedCurrentMove(gameWithFocus);

  var prev = curr.first.prev;
  gotoMove(prev);
  showTab($('#pills-game-tab'));
}

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
  updateBoard(gameWithFocus);
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

$('#multiboard-toggle').prop('checked', multiboardToggle);
$('#multiboard-toggle').on('click', (event) => {
  multiboardToggle = !multiboardToggle;
  if(!multiboardToggle) {
    // close all games except one
    var game = getMostImportantGame();
    setGameWithFocus(game);
    maximizeGame(game);
  
    // close all games in the secondary board area
    for(let i = games.length - 1; i >= 0; i--) {
      if(games[i].element.parent().is('#secondary-board-area')) 
        closeGame(games[i]);
    }
  }
  initGameTools(gameWithFocus);
  Cookies.set('multiboard', String(multiboardToggle), { expires: 365 })
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
  if (session && session.isConnected() && user === session.getUser()) {
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
  $('#login-user').removeClass('is-invalid');
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

export function isSmallWindow() {
  return !window.matchMedia("(min-width: 768px)").matches;
}

export function isMediumWindow() {
  return !isSmallWindow() && !isLargeWindow();
}

export function isLargeWindow() {
  return window.matchMedia("(min-width: 992px)").matches;
}

export function getSizeCategory() {
  if(isLargeWindow())
    return SizeCategory.Large;
  else if(isSmallWindow())
    return SizeCategory.Small;
  else
    return SizeCategory.Medium;
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

  prevSizeCategory = getSizeCategory();  

  if(evalEngine)
    evalEngine.redraw();
});

function setFontSizes() {
  setTimeout(() => {
    // Resize fonts for player and opponent name to fit
    $('.status').each((index, element) => {
      var nameElement = $(element).find('.name');
      var ratingElement = $(element).find('.rating');
      var nameRatingElement = $(element).find('.name-rating');

      nameElement.css('font-size', ''); 
      ratingElement.css('width', '');

      var nameBorderWidth = nameElement.outerWidth() - nameElement.width();
      var nameMaxWidth = nameRatingElement.width() - ratingElement.outerWidth() - nameBorderWidth;
      var fontSize = calculateFontSize(nameElement, nameMaxWidth);
      nameElement.css('font-size', fontSize + 'px');

      // Hide rating badge if partially clipped
      if(nameElement.outerWidth() + ratingElement.outerWidth() > nameRatingElement.width()) {
        ratingElement.width(0);
        ratingElement.css('visibility', 'hidden');
      }
      else 
        ratingElement.css('visibility', 'visible');
    });
  });
}

function initDropdownSubmenus() {
  // stop dropdown disappearing when submenu opened
  $('.dropdown-submenu').prev().on('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    $(e).next().show();
  });
}

/**
 * Displays a custom context menu (right-click menu)  
 * @param menu dropdown-menu element to display
 * @param x x-coordinate the menu appears at (often at the mouse pointer)
 * @param y y-coordinate the menu appears at
 * @param itemSelectedCallback Function called when a menu item is selected
 * @param menuClosedCallback Function called when the user hides the menu by clicking outside it etc
 * @param placement Popper placement of the menu relative to x, y ('top-left', 'bottom-left' etc)
 * @param fallbackPlacements Backup popper placements 
 */
function createContextMenu(menu: JQuery<HTMLElement>, x: number, y: number, itemSelectedCallback?: (event: any) => void, menuClosedCallback?: (event: any) => void, placement?: Placement, fallbackPlacements?: Placement[]) {
  // Use Popper.js to position the context menu dynamically
  menu.css({
    'position': 'fixed',
    'display': 'block',
  });
  $('body').append(menu);

  createPopper({
    getBoundingClientRect: () => ({ // Position the menu relative to a virtual element
      x: x,
      y: y,
      width: 0,
      height: 0,
      top: y,
      left: x,
      right: x,
      bottom: y,
      toJSON: () => ({})
    }),
    contextElement: document.documentElement
  }, menu[0], {
    placement: placement || 'top-start',
    modifiers: [
      {
        name: 'flip',
        options: {
          fallbackPlacements: fallbackPlacements || ['top-end', 'bottom-start', 'bottom-end']
        }
      },
      {
        name: 'preventOverflow',
        options: {
          boundary: 'viewport'
        }
      }
    ]
  });
  
  /** Triggered when menu item is selected */
  menu.find('.dropdown-item').on('click contextmenu', function(event) {  
    // Allow native context menu to be displayed when right clicking with modifier key
    if(event.type === 'contextmenu' && ((event.button === 2 && event.ctrlKey) 
        || event.shiftKey || event.altKey || event.metaKey))
      return; 

    safeRemove(menu);

    $(document).off('wheel.closeMenu mousedown.closeMenu keydown.closeMenu touchend.closeMenu touchmove.closeMenu');
    if(itemSelectedCallback)
      itemSelectedCallback(event);
    event.stopPropagation();
    event.preventDefault();
  });

  // Handle event listeners for the user to close the context menu, either by pressing escape, 
  // or clicking outside it, or scrolling the mouse wheel. 
  var closeMenuEventHandler = function(event) {
    if(event.type === 'touchstart') // Allow simulated mousedown events again (these were blocked by the touchend handler)
      $(document).off('touchend.closeMenu');
    if(event.type === 'mousedown' && touchStarted) // If a touch is in progress then ignore simulated mousedown events
      return;

    if(((event.type === 'touchstart' || event.type === 'mousedown') && !$(event.target).closest('.dropdown-menu').length)
        || (event.type === 'keydown' && event.key === 'Escape')
        || event.type === 'wheel' || event.type === 'touchmove') {
      safeRemove(menu);
      $(document).off('wheel.closeMenu mousedown.closeMenu keydown.closeMenu touchend.closeMenu touchmove.closeMenu'); 
      document.removeEventListener('touchstart', closeMenuEventHandler);
      if(menuClosedCallback)
        menuClosedCallback(event);
    }
  }

  $(document).on('touchmove.closeMenu', function(event) {
    // We close the context menu when the user scrolls. However browsers on iOS have very sensitive 
    // touchmove events. So we define a movement threshold of 15px before acknowledging a touchmove.
    var coords = getTouchClickCoordinates(event);
    if(Math.abs(coords.x - x) > 15 || Math.abs(coords.y - y) > 15) 
      closeMenuEventHandler(event);
  });

  // Browsers will often send a simulated 'mousedown' event when the user lifts their finger from a touch. 
  // However we also use 'mousedown' to detect when the user closes the context menu by clicking outside it.
  // Therefore we need to prevent simulated mousedown events directly after menu creation so that it doesn't 
  // close the menu right after opening it.
  $(document).one('touchend.closeMenu', function(event) {
    $(document).off('touchmove.closeMenu'); // No longer need to check for scrolling
    event.preventDefault(); // Stops 'mousedown' event being triggered
  });

  // Close the menu when clicking outside it, scrolling the mouse wheel or pressing escape key
  $(document).on('wheel.closeMenu mousedown.closeMenu keydown.closeMenu', closeMenuEventHandler);
  document.addEventListener('touchstart', closeMenuEventHandler, {passive: true});
}

/**
 * Helper function which creates the right-click and long press (on touch devices) events used to trigger
 * a context menu.  
 * @param isTriggered Callback function which returns true if this event (event.target) should trigger the context menu, otherwise false 
 * @param triggerHandler Callback function that creates the context menu
 */
function createContextMenuTrigger(isTriggered: (event: any) => boolean, triggerHandler: (event: any) => void) {  
  /** 
   * Event handler to display context menu when right clicking on an element.  
   * Note: We don't use 'contextmenu' for long press on touch devices. This is because for contextmenu
   * events the user has to touch exactly on the element, but for 'touchstart' the browsers are more tolerant
   * and allow the user to press _near_ the element. The browser guesses which element you are trying to press.
   */
  $(document).on('contextmenu', function(event) {
    if(!isTriggered(event))
      return;

    if((event.button === 2 && event.ctrlKey) || event.shiftKey || event.altKey || event.metaKey)
      return; // Still allow user to display native context menu if holding down a modifier key
  
    event.preventDefault();
    if(!touchStarted) // right click only, we handle long press seperately.
      triggerHandler(event);
  });

  /** 
   * Event handler to display context menu when long-pressing an element (on touch devices). 
   * We use 'touchstart' instead of 'contextmenu' because it still triggers even if the user 
   * slightly misses the element with their finger. 
   */ 
  document.addEventListener('touchstart', function(event) {
    if(!isTriggered(event))
      return;

    var longPressTimeout = setTimeout(() => {
      $(document).off('touchend.longPress touchcancel.longPress touchmove.longPress wheel.longPress');
      triggerHandler(event);
    }, 500);

    // Don't show the context menu if the user starts scrolling during the long press.
    // iOS is very sensitive to inadvertant finger movements, so we don't acknowledge a touchmove unless
    // the movement is greater than 15px.
    var startCoords = getTouchClickCoordinates(event);
    $(document).on('touchmove.longPress', function(event) {
      var coords = getTouchClickCoordinates(event);
      if(Math.abs(coords.x - startCoords.x) > 15 || Math.abs(coords.y - startCoords.y) > 15)
        clearTimeout(longPressTimeout);
    });

    $(document).one('touchend.longPress touchcancel.longPress wheel.longPress', function(event) {
      clearTimeout(longPressTimeout);
      $(document).off('touchmove.longPress');
    });
  }, {passive: true});
}

/**
 * Removes an element from the DOM but also removes any tooltips associated with it
 */
function safeRemove(element: JQuery<HTMLElement>) {
  element.find('[data-bs-toggle="tooltip"]').tooltip('dispose');
  element.remove();
}

/**
 * Breaks up a string at the specified maximum line lengths
 */
function breakAtMaxLength(input: string, maxLength: number) {
  const regex = new RegExp(`(.{1,${maxLength}})(?:\\s|$)`, 'g');
  return input.match(regex).join('\n');
}

/** 
 * General purpose debounce function. E.g. If a function created by debounce() is called multiple times 
 * in quick succession only the final call will be executed after the specified wait time (from the final call).
 */
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function getHistory(user: string) {
  if (session && session.isConnected()) {
    user = user.trim().split(/\s+/)[0];
    if(user.length === 0)
      user = session.getUser();
    $('#history-username').val(user);
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
  if($('#collapse-menus').hasClass('show'))
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
  if (!$('#pills-history').hasClass('active')) {
    return;
  }

  $('#history-pane-status').hide();
  $('#history-table').html('');

  const exUser = getValue('#history-username');
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
  var game = getPlayingExaminingGame();
  if(game && game.isExamining())
    session.send('unex');
  session.send('ex ' + user + ' ' + id);
};

$(document).on('shown.bs.tab', 'button[data-bs-target="#pills-history"]', (e) => {
  initHistoryPane();
});

function initHistoryPane() {
  historyRequested = 0;
  $('#history-table').html('');
  let username = getValue('#history-username');
  if (username === undefined || username === '') {
    if (session) {
      username = session.getUser();
      $('#history-username').val(username);
    }
  }
  getHistory(username);
}

$('#history-user').on('submit', (event) => {
  event.preventDefault();
  $('#history-go').trigger('focus');
  const username = getValue('#history-username');
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
    var match = g.match(/\s*(\d+)\s+(\(Exam\.\s+)?(\S+)\s+(\w+)\s+(\S+)\s+(\w+)\s*(\)\s+)?(\[\s*)(\w+)(.*)/);
    if(match) {
      var id = match[1];

      if(match[9].startsWith('p')) // Don't list private games
        continue;

      computerList.forEach(comp => {
        if(comp === match[4] || (match[4].length >= 10 && comp.startsWith(match[4])))
          match[4] += '(C)';
        if(comp === match[6] || (match[6].length >= 10 && comp.startsWith(match[6])))
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
    session.send('games /bslunzwLB');
  }
}

$(document).on('show.bs.tab', 'button[data-bs-target="#pills-game"]', (e) => {
  if($('#game-list-view').is(':checked')) 
    $('#left-panel').addClass('list-view-showing');
});

$(document).on('hide.bs.tab', 'button[data-bs-target="#pills-game"]', (e) => {
  $('#left-panel').removeClass('list-view-showing');
});

$('#puzzlebot').on('click', (event) => {
  session.send('t puzzlebot getmate');
  showTab($('#pills-game-tab'));
});

$('#left-panel-bottom').on('shown.bs.tab', '.nav-link', (e) => {
  gameWithFocus.currentStatusTab = $(e.target);

  if($(e.target).attr('id') === 'eval-graph-tab') {
    if(!evalEngine)
      createEvalEngine(gameWithFocus);
    
    if(evalEngine)
      evalEngine.redraw();
  }
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
  var game = getPlayingExaminingGame();
  if(!session || !session.isConnected())
    $('#lobby').hide();
  else if(game && (game.isExamining() || game.isPlayingOnline())) {
    if(game.isExamining())
      $('#lobby-pane-status').text('Can\'t enter lobby while examining a game.');
    else
      $('#lobby-pane-status').text('Can\'t enter lobby while playing a game.');
    $('#lobby-pane-status').show();
    $('#lobby').hide();
  }
  else {
    $('#lobby-pane-status').hide();
    if(session.isRegistered()) 
      $('#lobby-show-unrated').parent().show();
    else 
      $('#lobby-show-unrated').parent().hide();

    if(lobbyShowComputersToggle) {
      $('#lobby-show-computers-icon').removeClass('fa-eye-slash');
      $('#lobby-show-computers-icon').addClass('fa-eye');
    }
    else {
      $('#lobby-show-computers-icon').removeClass('fa-eye');
      $('#lobby-show-computers-icon').addClass('fa-eye-slash');
    }
    
    if(lobbyShowUnratedToggle) {
      $('#lobby-show-unrated-icon').removeClass('fa-eye-slash');
      $('#lobby-show-unrated-icon').addClass('fa-eye');
    }
    else {
      $('#lobby-show-unrated-icon').removeClass('fa-eye');
      $('#lobby-show-unrated-icon').addClass('fa-eye-slash');
    }

    $('#lobby-show-computers').prop('checked', lobbyShowComputersToggle);
    $('#lobby-show-unrated').prop('checked', lobbyShowUnratedToggle);
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

$('#lobby-show-unrated').on('change', function (e) {
  lobbyShowUnratedToggle = $(this).is(':checked');
  Cookies.set('lobbyshowunrated', String(lobbyShowUnratedToggle), { expires: 365 });
  initLobbyPane();
});

function formatLobbyEntry(seek: any): string {
  var title = (seek.title !== '' ? '(' + seek.title + ')' : '');
  var color = (seek.color !== '?' ? ' ' + seek.color : '');
  var rating = (seek.rating !== '' ? '(' + seek.rating + ')' : '');
  return seek.toFrom + title + rating + ' ' + seek.initialTime + ' ' + seek.increment + ' ' 
      + seek.ratedUnrated + ' ' + seek.category + color;
}

$(document).on('keydown', (e) => {
  if(e.key === 'Enter') {
    var blurElement = $(e.target).closest('.blur-on-enter');
    if(blurElement.length) {
      blurElement.trigger('blur');
      e.preventDefault();
      return;
    } 
  }
  
  if($(e.target).closest('input, textarea, [contenteditable]')[0]) 
    return;
  
  if(e.key === 'ArrowLeft')
    backward();

  else if(e.key === 'ArrowRight')
    forward();
});

/****************************
 **  GAME PANEL FUNCTIONS  **  
 ****************************/

/** 
 * Create right-click and long press trigger events for displaying the context menu when right clicking a move
 * in the move list.
 */
createContextMenuTrigger(function(event) {
  var target = $(event.target);
  return !!(target.closest('.selectable').length || target.closest('.move').length 
      || (target.closest('.comment').length && event.type === 'contextmenu'));
}, createMoveContextMenu);

/**
 * Create context menu after a move (or associated comment) is right-clicked, with options for adding 
 * comments / annotations, deleting the move (and all following moves in that variation), promoting the 
 * variation etc.
 */
function createMoveContextMenu(event: any) {
  var contextMenu = $(`<ul class="context-menu dropdown-menu"></ul>`);
  if($(event.target).closest('.comment-before').length)
    var moveElement = $(event.target).next();
  else if($(event.target).closest('.comment-after').length)
    var moveElement = $(event.target).prev();
  else if($(event.target).closest('.outer-move').length)
    var moveElement = $(event.target).closest('.outer-move');
  else
    var moveElement = $(event.target).closest('.selectable');

  moveElement.find('.move').addClass('hovered'); // Show the :hovered style while menu is displayed

  var hEntry = moveElement.data('hEntry');
  var game = gameWithFocus;

  if(hEntry === hEntry.first || (!hEntry.parent && hEntry.prev === hEntry.first)) {
    // If this is the first move in a subvariation, allow user to add a comment both before and after the move.
    // The 'before comment' allows the user to add a comment for the subvariation in general.
    contextMenu.append(`<li><a class="dropdown-item noselect" data-action="edit-comment-before">Edit Comment Before</a></li>`);
    contextMenu.append(`<li><a class="dropdown-item noselect" data-action="edit-comment-after">Edit Comment After</a></li>`);
  }
  else
    contextMenu.append(`<li><a class="dropdown-item noselect" data-action="edit-comment-after">Edit Comment</a></li>`);
  if(hEntry.nags.length)
    contextMenu.append(`<li><a class="dropdown-item noselect" data-action="delete-annotation">Delete Annotation</a></li>`);
  if(!game.isObserving() && !game.isPlaying()) {
    contextMenu.append(`<li><a class="dropdown-item noselect" data-action="delete-move">Delete Move</a></li>`);
    if(hEntry.parent)
      contextMenu.append(`<li><a class="dropdown-item noselect" data-action="promote-variation">Promote Variation</a></li>`);
    else if(hEntry.prev !== hEntry.first)
      contextMenu.append(`<li><a class="dropdown-item noselect" data-action="make-continuation">Make Continuation</a></li>`);
  }
  contextMenu.append(`<li><a class="dropdown-item noselect" data-action="clear-all-analysis">Clear All Analysis</a></li>`);
  contextMenu.append(`<li><hr class="dropdown-divider"></li>`);
  var annotationsHtml = `<div class="annotations-menu annotation">`;
  for(let a of History.annotations)
    annotationsHtml += `<li><a class="dropdown-item noselect" data-bs-toggle="tooltip" data-nags="` + a.nags + `" title="` + a.description + `">` + a.symbol + `</a></li>`;
  annotationsHtml += `</div>`;
  contextMenu.append(annotationsHtml);
  contextMenu.find('[data-bs-toggle="tooltip"]').each((index, element) => {
    createTooltip($(element));
  });

  /** Called when menu item is selected */
  var moveContextMenuItemSelected = (event: any) => {
    moveElement.find('.move').removeClass('hovered');
    var target = $(event.target);
    var nags = target.attr('data-nags');
    if(nags)
      game.history.setAnnotation(hEntry, nags);
    else {
      var action = target.attr('data-action');
      switch(action) {
        case 'edit-comment-before': 
          setViewModeList(); // Switch to List View so the user can edit the comment in-place. 
          gotoMove(hEntry);
          game.history.editCommentBefore(hEntry);
          break;
        case 'edit-comment-after':
          setViewModeList();
          gotoMove(hEntry);
          game.history.editCommentAfter(hEntry);
          break;
        case 'delete-annotation':
          game.history.removeAnnotation(hEntry);
          break;
        case 'delete-move':
          deleteMove(game, hEntry);
          break;
        case 'promote-variation': 
          if(game.isExamining() && !game.history.scratch() && hEntry.depth() === 1) {
            // If we are promoting a subvariation to the mainline, we need to 'commit' the new mainline 
            var current = game.history.current();
            gotoMove(hEntry.last);
            session.send('commit');
          }
          game.history.promoteSubvariation(hEntry);
          if(current)
            gotoMove(current);

          updateEditMode(game, true);
          if(!game.history.hasSubvariation())
            $('#exit-subvariation').hide(); 
          break;
        case 'make-continuation':
          if(game.isExamining() && !game.history.scratch() && hEntry.depth() === 0) {
            var current = game.history.current();
            gotoMove(hEntry.prev);
            session.send('truncate');
          }
          game.history.makeContinuation(hEntry);
          if(current)
            gotoMove(current);
          updateEditMode(game, true);
          $('#exit-subvariation').show(); 
          break;
        case 'clear-all-analysis':
          clearAnalysisDialog(game);
          break;
      }
    }
  };
  
  var moveContextMenuClose = (event: any) => {
    moveElement.find('.move').removeClass('hovered');
  }

  var coords = getTouchClickCoordinates(event);
  createContextMenu(contextMenu, coords.x, coords.y, moveContextMenuItemSelected, moveContextMenuClose);
}

/** 
 * Removes a move (and all following moves) from the move list / move table 
 */
function deleteMove(game: Game, entry: HEntry) {
  if(game.isExamining() && game.history.current().isPredecessor(entry)) {
    // If the current move is on the line we are just about to delete, we need to back out of it first
    // before deleting the line. 
    gotoMove(entry.prev);
    game.removeMoveRequested = entry;
  }
  else {
    game.history.remove(entry);
    game.history.display();
    if(!game.history.hasSubvariation())
      $('#exit-subvariation').hide();
  }
}

/**
 * Removes all sub-variations, comments and annotations from the move-list / move-table
 */
function clearAnalysisDialog(game: Game) {
  (window as any).clearAnalysisClickHandler = (event) => {
    if(game) {
      // Delete all subvariations from the main line
      var hEntry = game.history.first();
      while(hEntry) {
        for(let i = hEntry.subvariations.length - 1; i >= 0; i--)
          deleteMove(game, hEntry.subvariations[i]);
        hEntry = hEntry.next;
      }
      game.history.removeAllAnnotations();
      game.history.removeAllComments();
    }
  };

  var headerTitle = 'Clear All Analysis';
  var bodyText = 'Really clear all analysis?';
  var button1 = [`clearAnalysisClickHandler(event)`, 'OK'];
  var button2 = ['', 'Cancel']; 
  var showIcons = true;
  showFixedDialog({type: headerTitle, msg: bodyText, btnFailure: button2, btnSuccess: button1, icons: showIcons});
}

/** GAME PANEL TOOLBAR AND TOOL MENU FUNCTIONS **/

/** 
 * Initializes the controls in the Game Panel toolbar and tool menu when a game gains the focus
 * or when a game starts or ends
 */
function initGameTools(game: Game) {
  if(game === gameWithFocus) {
    updateGamePreserved(game);
    updateEditMode(game);
    $('#game-tools-clone').parent().toggle(multiboardToggle); // Only show 'Duplicate GAme' option in multiboard mode
    $('#game-tools-clone').toggleClass('disabled', game.isPlaying()); // Don't allow cloning of a game while playing (could allow cheating)

    var mainGame = getPlayingExaminingGame();
    $('#game-tools-examine').toggleClass('disabled', (mainGame && mainGame.isPlayingOnline()) || game.isPlaying() || game.isExamining() 
        || game.category === 'wild/fr' || game.category === 'wild/0' // Due to a bug in 'bsetup' it's not possible to convert some wild variants to examine mode
        || game.category === 'wild/1' || game.category === 'bughouse');
  }
}

/** Triggered when Table View button is toggled on/off */
$('#game-table-view').on('change', function() {
  if($('#game-table-view').is(':checked')) 
    setViewModeTable();
});

/** Triggered when List View button is toggled on/off */
$('#game-list-view').on('change', function() {
  if($('#game-list-view').is(':checked')) 
    setViewModeList();
});

/** 
 * Stops the Table View / List View radio buttons from stealing left-arrow key / right-arrow key
 * input from the move-list 
 */
$('#game-table-view, #game-list-view').on('keydown', function(event) {
  if(event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    $(document).trigger($.Event('keydown', {
      key: event.key,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey
    }));
  }
});

/**
 * Set move list view mode to Table View
 */
function setViewModeTable() {
  $('#left-panel').removeClass('list-view-showing');
  $('#movelists').hide();
  $('#move-table').show();
  $('#game-table-view').prop('checked', true);
  gameWithFocus.history.highlightMove();
}

/**
 * Set move list view mode to List View
 */
function setViewModeList() {
  if($('#pills-game').is(':visible'))
    $('#left-panel').addClass('list-view-showing');
  $('#move-table').hide();
  $('#movelists').show();
  $('#game-list-view').prop('checked', true);
  gameWithFocus.history.highlightMove();
}

/**
 * Sets the move list view mode based on which toggle button is currently selected 
 */
function setMovelistViewMode() {
  if($('#game-table-view').is(':checked')) 
    setViewModeTable();
  else
    setViewModeList();
}

/** Triggered when Edit Mode toggle button is toggled on/off */
$('#game-edit-mode').on('change', function (e) {
  updateEditMode(gameWithFocus, $(this).is(':checked'));
});

/**
 * Updates Edit Mode toggle button based on game setting
 */
function updateEditMode(game: Game, editMode?: boolean) {
  if(!game.history)
    return;

  if(editMode !== undefined)
    game.history.editMode = editMode;
  $('#game-edit-mode').prop('checked', game.history.editMode);
}

/** Triggered when Game Preserved toggle button is toggled on/off */
$('#game-preserved').on('change', function (e) {
  updateGamePreserved(gameWithFocus, $(this).is(':checked'));
});

/**
 * Updates Game Preserved toggle button based on game setting 
 */
function updateGamePreserved(game: Game, preserved?: boolean) {
  if(preserved !== undefined)
    game.preserved = preserved;

  var label = $('label[for="game-preserved"]');  
  if(multiboardToggle) {
    $('#game-preserved').show();
    label.show();
    $('#game-preserved').attr('aria-checked', String(game.preserved));
    $('#game-preserved').prop('checked', game.preserved);
    if(game.preserved) 
      label.find('span').removeClass('fa-unlock').addClass('fa-lock');
    else 
      label.find('span').removeClass('fa-lock').addClass('fa-unlock');
  }
  else {
    $('#game-preserved').hide();
    label.hide();
  }
}

/** New Game menu item selected */
$('#game-tools-new').on('click', (event) => {
  newGameDialog();
});

/** New Variant Game menu item selected */
$('#new-variant-game-submenu a').on('click', (event) => {
  var category = $(event.target).text();
  if(category === 'Chess960')
    category = 'wild/fr';

  category = category.toLowerCase();
  newGameDialog(category);
});

/**
 * When creating a new (empty game), shows a dialog asking if the user wants to Overwrite the 
 * current game or open a New Board. For Chess960, also lets select Chess960 starting position
 */
function newGameDialog(category: string = 'untimed') {
  var bodyText = '';

  if(category === 'wild/fr') {
    var bodyText = 
      `<label for"chess960idn">Chess960 Starting Position ID</label>
      <input type="number" min="0" max="959" placeholder="0-959" class="form-control text-center chess960idn"><br>`;
  }

  var overwriteHandler = function(event) {
    if(category === 'wild/fr')
      var chess960idn = this.closest('.toast').querySelector('.chess960idn').value;
    newGame(false, category, null, chess960idn);
  };

  var newBoardHandler = function(event) {
    if(category === 'wild/fr')
      var chess960idn = this.closest('.toast').querySelector('.chess960idn').value;
    newGame(true, category, null, chess960idn);
  };

  var button1: any, button2: any;
  if(gameWithFocus.role === Role.NONE || (category === 'wild/fr' && multiboardToggle)) {
    var headerTitle = 'Create new game';
    var bodyTitle = '';
    if(gameWithFocus.role === Role.NONE && multiboardToggle) {
      var bodyText = bodyText + 'Overwrite existing game or open new board?';
      button1 = [overwriteHandler, 'Overwrite'];
      button2 = [newBoardHandler, 'New Board'];
      var showIcons = false;
    }
    else if(gameWithFocus.role === Role.NONE) {
      var bodyText = bodyText + 'This will clear the current game.';
      button1 = [overwriteHandler, 'OK'];
      button2 = ['', 'Cancel']; 
      var showIcons = true;
    }
    else if(category === 'wild/fr' && multiboardToggle) {
      button1 = [newBoardHandler, 'OK'];
      button2 = ['', 'Cancel']; 
      var showIcons = true;
    }
    showFixedDialog({type: headerTitle, title: bodyTitle, msg: bodyText, btnFailure: button2, btnSuccess: button1, icons: showIcons});
  }
  else if(multiboardToggle)
    newGame(true, category);
}

/**
 * Creates a new (empty) game. 
 * @param createNewBoard If false, will clear the move-list of the existing game and start over. If true
 * will open a new board when in multiboard mode.
 * @param category The category (variant) for the new game
 * @param fen The starting position for the new game (used for Chess960)
 * @param chess960idn Alternatively the starting IDN for Chess960
 */
function newGame(createNewBoard: boolean, category: string = 'untimed', fen?: string, chess960idn?: string): Game {
  if(createNewBoard)
    var game = createGame();
  else {
    var game = gameWithFocus;
    cleanupGame(game);
  }

  if(category === 'wild/fr' && !fen) 
    var fen = generateChess960FEN(chess960idn ? +chess960idn : null);
  
  if(!fen) 
    fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  var data = {
    fen: fen,                               // game state
    turn: 'W',                              // color whose turn it is to move ("B" or "W")
    id: -1,                                 // The game number
    wname: '',                              // White's name
    bname: '',                              // Black's name
    wrating: '',                            // White's rating
    brating: '',                            // Black's rating
    role: Role.NONE,                        // my relation to this game
    time: 0,                                // initial time in seconds         
    inc: 0,                                 // increment per move in seconds
    wtime: 0,                               // White's remaining time
    btime: 0,                               // Black's remaining time
    moveNo: 1,                              // the number of the move about to be made
    move: 'none',                           // pretty notation for the previous move ("none" if there is none)
    flip: false,                            // whether game starts with board flipped
    category: category,                     // game variant or type
  }
  Object.assign(game, data);
  game.statusElement.find('.game-status').html('');
  gameStart(game);

  return game;
};

/** 
 * Triggered when 'Open Game PGN' menu option is selected 
 * Displays an Open File(s) dialog. Then after user selects PGN file(s) to open, displays 
 * a dialog asking if they want to overwrite current gmae or open new board. 
 */
$('#game-tools-open-pgn').on('click', (event) => {
  var fileInput = $('<input type="file" style="display: none" multiple/>');
  fileInput.appendTo('body');
  fileInput.trigger('click');

  fileInput.one('change', function(event) {
    fileInput.remove();
    const target = event.target as HTMLInputElement;
    openPGNDialog(target.files);
  });
});

/**
 * When opening PGN file(s), hows a dialog asking if the user wants to Overwrite the 
 * current game or open a New Board. 
 */
function openPGNDialog(files: any) {
  var bodyText = '';

  var overwriteHandler = function(event) {
    openPGNFiles(files, false);
  };

  var newBoardHandler = function(event) {
    openPGNFiles(files, true);
  };

  var button1: any, button2: any;
  if(gameWithFocus.role === Role.NONE) {
    if(gameWithFocus.history.length()) {
      var headerTitle = 'Open PGN';
      var bodyTitle = '';
      if(gameWithFocus.role === Role.NONE && multiboardToggle) {
        var bodyText = bodyText + 'Overwrite existing game or open new board?';
        button1 = [overwriteHandler, 'Overwrite'];
        button2 = [newBoardHandler, 'New Board'];
        var showIcons = false;
      }
      else if(gameWithFocus.role === Role.NONE) {
        var bodyText = bodyText + 'This will clear the current game.';
        button1 = [overwriteHandler, 'OK'];
        button2 = ['', 'Cancel']; 
        var showIcons = true;
      }
      showFixedDialog({type: headerTitle, title: bodyTitle, msg: bodyText, btnFailure: button2, btnSuccess: button1, icons: showIcons});
    }
    else
      openPGNFiles(files, false);
  }
  else if(multiboardToggle)
    openPGNFiles(files, true);
}

/**
 * Creates a new Game object and loads the games from the given PGN file(s) into it.
 * Each game from the PGN files is stored as a separate History object in game.historyList.
 * For PGNs with multiple games, only the first game is fully parsed. The rest are lazy loaded, 
 * i.e. only the PGN metatags are parsed whereas the moves are simply stored as a string in history.pgn 
 * and parsed when the game is selected from the game list. PGN files are parsed using @mliebelt/pgn-parser
 * @param files FileList object
 * @param createNewBoard If false, overwrites existing game, otherwise opens new board when in multiboard mode
 */
async function openPGNFiles(files: any, createNewBoard: boolean = false) {
  var game = newGame(createNewBoard);

  // Wait for all selected files to be read before displaying the first game
  for(const file of Array.from<File>(files)) {
    var readFile = async function(): Promise<void> { 
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async function(e) {
          const fileContent = e.target?.result as string;
          if(fileContent)
            await parsePGNFile(game, fileContent);
          resolve();
        };
        reader.onerror = function(e) {
          const error = e.target?.error;
          let errorMessage = 'An unknown error occurred';
          if (error)
            errorMessage = error.name + ' - ' + error.message;
          showFixedDialog({type: 'Failed to open PGN file', msg: errorMessage, btnSuccess: ['', 'OK']}); 
          reject(error);
        };
        reader.readAsText(file);
      });
    };
    await readFile();
  }

  if(game.historyList.length) {
    updateGamePreserved(game, true);
    setCurrentHistory(game, 0); // Display the first game from the PGN file(s)
  }
}

/**
 * Takes a string containing one or more PGN games, splits up the games and creates a History 
 * object for each one. Then parses the metatags for each game.
 */
async function parsePGNFile(game: Game, pgnStr: string) {
  var regex = /((?:\[[^\]]+\]\s+)+)([^\[]+)/g; // Splits up the games in the PGN string
  var match;
  var chunkSize = 200;
  var done = false;
  while(!done) {
    // Parse games in chunks so as not to tie up the event loop
    await new Promise<void>(resolve => {
      setTimeout(() => {
        for(let i = 0; i < chunkSize; i++) {
          if((match = regex.exec(pgnStr)) === null) {
            done = true;
            break;
          }
          var history = new History(game);
          history.pgn = match[2];
          var metatags = parsePGNMetadata(match[1]);
          if(metatags) { 
            history.setMetatags(metatags, true);
            game.historyList.push(history);
          }
        }
        resolve(); 
      }, 0);
    });
  }
}

/**
 * Parse a string of PGN metatags 
 */
 function parsePGNMetadata(pgnStr: string) {
  try {
    var pgn = PgnParser.parse(pgnStr, {startRule: "tags"}) as PgnParser.ParseTree;
  }
  catch(err) {
    showFixedDialog({type: 'Failed to parse PGN', msg: err.message, btnSuccess: ['', 'OK']});
    return;
  } 
  return pgn.tags;
}

/**
 * Parse a string containing a PGN move list
 */
async function parsePGNMoves(game: Game, pgnStr: string) {
  try {
    var pgn = PgnParser.parse(pgnStr, {startRule: "pgn"}) as PgnParser.ParseTree;
  }
  catch(err) {
    showFixedDialog({type: 'Failed to parse PGN', msg: err.message, btnSuccess: ['', 'OK']});
    return;
  }

  parsePGNVariation(game, pgn.moves);
  game.history.goto(game.history.first());
}

/** 
 * Imports a list of moves (and all subvariations recursively) from a @mliebelt/pgn-parser object  
 * and puts them in the provided Game's History object
 */
function parsePGNVariation(game: Game, variation: any) {
  var prevHEntry = game.history.current();
  var newSubvariation = !!prevHEntry.next; 

  for(let move of variation) {
    var parsedMove = parseMove(game, prevHEntry.fen, move.notation.notation);
    if(!parsedMove)
      break;
    
    if(newSubvariation && prevHEntry.next && prevHEntry.next.fen === parsedMove.fen) {
      prevHEntry = prevHEntry.next;
      continue;
    }
    
    var currHEntry = game.history.add(parsedMove.move, parsedMove.fen, newSubvariation);
    game.history.setCommentBefore(currHEntry, move.commentMove);
    game.history.setCommentAfter(currHEntry, move.commentAfter);
    if(move.nag) 
      move.nag.forEach((nag) => game.history.setAnnotation(currHEntry, nag));
    getOpening(game);
    updateVariantMoveData(game);
    newSubvariation = false;

    for(let subvariation of move.variations) {
      game.history.editMode = true;
      game.history.goto(prevHEntry);    
      parsePGNVariation(game, subvariation);
    }
    game.history.goto(currHEntry);    
    prevHEntry = currHEntry;
  }
}

/**
 * Displays the specified History by building its HTML move list / move table. E.g. when a game 
 * is selected from the game list after being loaded from a PGN. If this is the first time a History has 
 * been displayed, this will first parse the PGN move list. 
 */
function setCurrentHistory(game: Game, historyIndex: number) {
  game.history = game.historyList[historyIndex];
  $('#game-list-button > .label').text(getGameListDescription(game.history, false));
  game.moveTableElement.empty();
  game.moveListElement.empty();
  game.statusElement.find('.game-status').html('');
  updateGameFromMetatags(game);

  if(game.history.pgn) { // lazy load game
    var tags = game.history.metatags;
    if(tags.SetUp === '1' && tags.FEN) 
      game.history.first().fen = tags.FEN;
    parsePGNMoves(game, game.history.pgn);
    game.history.pgn = null;
  }
  else 
    game.history.addAllMoveElements();
  initGameControls(game);
  game.history.display();
  if(game.isExamining())
    setupGameInExamineMode(game);
}

/**
 * Sets a Game object's data based on the PGN metatags in its History, e.g. set game.wname from metatags.White
 */
function updateGameFromMetatags(game: Game) {
  if(game.role === Role.NONE || game.isExamining()) { // Don't allow user to change the game's attributes while the game is in progress
    var metatags = game.history.metatags;
    var whiteName = metatags.White.slice(0, 17).trim().replace(/[^\w]+/g, '_'); // Convert multi-word names into a single word format that FICS can handle
    var blackName = metatags.Black.slice(0, 17).trim().replace(/[^\w]+/g, '_');
    var whiteStatus = game.element.find(game.color === 'w' ? '.player-status' : '.opponent-status');
    var blackStatus = game.element.find(game.color === 'b' ? '.player-status' : '.opponent-status');
    if(whiteName !== game.wname) {
      game.wname = whiteName;
      if(game.isExamining())
        session.send('wname ' + whiteName);
      whiteStatus.find('.name').text(metatags.White);
    }
    if(blackName !== game.bname) {
      game.bname = blackName;
      if(game.isExamining())
        session.send('bname ' + blackName);
      blackStatus.find('.name').text(metatags.Black);
    }

    var whiteElo = metatags.WhiteElo;
    if(whiteElo && whiteElo !== '0' && whiteElo !== '-' && whiteElo !== '?')
      game.wrating = whiteElo;
    else
      game.wrating = '';
    whiteStatus.find('.rating').text(game.wrating);

    var blackElo = metatags.BlackElo;
    if(blackElo && blackElo !== '0' && blackElo !== '-' && blackElo !== '?')
      game.brating = blackElo;
    else
      game.brating = '';
    blackStatus.find('.rating').text(game.brating);

    var supportedVariants = ['losers', 'suicide', 'crazyhouse', 'bughouse', 'atomic', 'chess960',
      'blitz', 'lightning', 'untimed', 'standard', 'nonstandard'];
    var variant = metatags.Variant?.toLowerCase();
    if(variant && (supportedVariants.includes(variant) || variant.startsWith('wild'))) {
      if(variant === 'chess960')
        game.category = 'wild/fr';
      else
        game.category = variant;
    }
    else
      game.category = 'untimed';

    // Set the status panel text
    if(!game.statusElement.find('.game-status').html()) {
      if(!metatags.White && !metatags.Black)
        var status = '';
      else {
        var status = (metatags.White || 'Unknown') + ' (' + (metatags.WhiteElo || '?') + ') ' 
            + (metatags.Black || 'Unknown') + ' (' + (metatags.BlackElo || '?') + ')'
            + (metatags.Variant ? ' ' + metatags.Variant : '');

        if(metatags.TimeControl) {
          if(metatags.TimeControl === '-')
            status += ' untimed';
          else {
            var match = metatags.TimeControl.match(/^(\d+)(?:\+(\d+))?$/);
            if(match)  
              status += ' ' + (+match[1] / 60) + ' ' + (match[2] || '0');
          }
        }
      }
    
      game.statusElement.find('.game-status').text(status);
    }
  }
}

/** 
 * Display the game list when game list dropdown button clicked. The game list button is displayed when
 * multiple games are opened from PGN(s) at once. 
 */
$('#game-list-button').on('show.bs.dropdown', function(event) {
  var game = gameWithFocus;
  if(game.historyList.length > 1) {   
    $('#game-list-filter').val(game.gameListFilter);
    addGameListItems(game);
  }
});

/** 
 * Filters the game list with the text in the filter input. Uses a debounce function to delay
 * updating the list, so that it doesn't update every time a character is typed, which would 
 * be performance intensive
 */
var gameListFilterHandler = debounce((event) => {
  var game = gameWithFocus;
  game.gameListFilter = $(event.target).val() as string;
  addGameListItems(game);
}, 500);
$('#game-list-filter').on('input', gameListFilterHandler);

/** 
 * Create the game list dropdown 
 */
function addGameListItems(game: Game) {
  $('#game-list-menu').remove();
  var listElements = '';
  for(let i = 0; i < game.historyList.length; i++) {
    var h = game.historyList[i];
    var description = getGameListDescription(h, true);
    if(description.toLowerCase().includes(game.gameListFilter.toLowerCase()))
      listElements += `<li style="width: max-content;" class="game-list-item"><a class="dropdown-item" data-index="` + i + `">` + description + `</a></li>`
  }
  $('#game-list-dropdown').append(`<ul id="game-list-menu">` + listElements + `</ul>`);
}

/**
 * Get the text to be displayed for an item in the game list or in the game list dropdown button 
 * @param longDescription the long description is used in the list itself, the short version is used
 * in the dropdown button text
 */
function getGameListDescription(history: History, longDescription: boolean = false) {
  var tags = history.metatags;
  if(!tags)
    return '';

  var dateTimeStr = (tags.Date || tags.UTCDate || '');
  if(tags.Time || tags.UTCTime)
    dateTimeStr += (tags.Date || tags.UTCDate ? ' - ' : '') + (tags.Time || tags.UTCTime);

  if(tags.White || tags.Black) {
    var description = tags.White || 'unknown';
    if(tags.WhiteElo && tags.WhiteElo !== '0' && tags.WhiteElo !== '-' && tags.WhiteElo !== '?')
      description += ' (' + tags.WhiteElo + ')';
    description += ' - ' + tags.Black || 'unknown';
    if(tags.BlackElo && tags.BlackElo !== '0' && tags.BlackElo !== '-' && tags.BlackElo !== '?')
      description += ' (' + tags.BlackElo + ')';
    if(tags.Result)
      description += ' [' + tags.Result + ']'; 
  }
  else {
    description = tags.Event || 'Analysis';
    if(!longDescription)
      description += ' ' + dateTimeStr;
  }

  if(longDescription) {
    if(dateTimeStr)
      description += ', ' + dateTimeStr;
    if(tags.ECO || tags.Opening || tags.Variation || tags.SubVariation) {
      description += ',';
      if(tags.ECO)
        description += ' [' + tags.ECO + ']';
      if(tags.Opening)
        description += ' ' + tags.Opening;
      else if(tags.Variation) 
        description += ' ' + tags.Variation + (tags.SubVariation ? ': ' + tags.SubVariation : ''); 
    }
  }

  return description;
}

/** 
 * Clear the game list after it's closed, since it can take up a lot of memory, e.g. if it contains 
 * 10000s of games. In future this should probably be displayed using a virtual scrolling library
 */
$('#game-list-button').on('hidden.bs.dropdown', function(event) {
  $('#game-list-menu').html('');
});

/** Triggered when a game is selected from the game list */
$('#game-list-dropdown').on('click', '.dropdown-item', (event) => {
  var index = +$(event.target).attr('data-index');
  setCurrentHistory(gameWithFocus, index);
});

/** Triggered when 'Save Game PGN' menu option is selected */ 
$('#game-tools-save-pgn').on('click', (event) => {
  savePGN(gameWithFocus);
});

/**
 * Saves game to a .pgn file 
 */
function savePGN(game: Game) {
  var metatags = game.history.metatags;
  var movesStr = breakAtMaxLength(game.history.movesToString(), 80);
  var pgnStr = game.history.metatagsToString() + '\n\n' + movesStr + ' ' + metatags.Result;
  var wname = metatags.White;
  var bname = metatags.Black;
  var event = metatags.Event;
  var date = metatags.Date;
  var time = metatags.Time;
  if(date) {
    date = date.replace(/\./g, '-');
    var match = date.match(/^\d+(-\d+)?(-\d+)?/);
    date = (match ? match[0] : null);
  }
  if(time) {
    time = time.replace(/:/g, '.');
    match = time.match(/^\d+(.\d+)?(.\d+)?/);
    time = (match ? match[0] : null);
  }

  if(wname || bname)
    var filename = (wname || 'unknown') + '_vs_' + (bname || 'unknown') + (date ? '_' + date : '') + (time ? '_' + time : '') + '.pgn';
  else {
    var filename = (event || 'Analysis') + (date ? '_' + date : '') + (time ? '_' + time : '') + '.pgn';
  }

  const data = new Blob([pgnStr], { type: 'text/plain' });
  const url = window.URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

/** Triggered when the 'Duplicate Game' menu option is selected */ 
$('#game-tools-clone').on('click', (event) => {
  cloneGame(gameWithFocus);
});

/** 
 * Make an exact copy of a game with its own board, move list and status panels. 
 * The clone will not be in examine or observe mode, regardless of the original.
*/
function cloneGame(game: Game): Game {
  var clonedGame = createGame();

  // Copy GameData properties
  var gameData = new GameData(); // Create temp instance in order to iterate its proeprties
  for(const key of Object.keys(gameData)) 
    clonedGame[key] = game[key];
  
  clonedGame.id = -1;
  clonedGame.role = Role.NONE;
  clonedGame.history = game.history.clone(clonedGame);
  clonedGame.history.display();
  clonedGame.statusElement.find('.game-watchers').empty();
  clonedGame.statusElement.find('.game-id').remove();
  clonedGame.element.find('.title-bar-text').empty();
  
  clonedGame.board.set({ orientation: game.board.state.orientation });
  scrollToBoard(clonedGame);
  return clonedGame;
}

/** Triggered when the 'Examine Mode (Shared)' menu option is selected */ 
$('#game-tools-examine').on('click', (event) => {
  examineModeRequested = gameWithFocus;
  var mainGame = getPlayingExaminingGame();
  if(mainGame && mainGame.isExamining())
    session.send('unex'); 
  session.send('ex');
});

/** 
 * Convert a game to examine mode by using bsetup and then commiting the movelist 
 */
function setupGameInExamineMode(game: Game) {
  /** Setup the board */
  
  var fenWords = splitFEN(game.history.first().fen);
  
  // starting FEN
  session.send('bsetup fen ' + fenWords.board);

  // game rules
  // Note bsetup for fr and wild are currently broken on FICS and there is no option for bughouse 
  if(game.category === 'wild/fr')
    session.send('bsetup fr');
  else if(game.category.startsWith('wild'))
    session.send('bsetup wild');
  else if(game.category === 'losers' || game.category === 'crazyhouse' || game.category === 'atomic' || game.category === 'suicide')
    session.send('bsetup ' + game.category);

  // turn color
  session.send('bsetup tomove ' + (fenWords.color === 'w' ? 'white' : 'black'));

  // castling rights
  var castlingRights = fenWords.castlingRights;
  if(castlingRights.includes('K') && castlingRights.includes('Q'))
    var wcastling = 'both';
  else if(castlingRights.includes('K'))
    var wcastling = 'kside';
  else if(castlingRights.includes('Q'))
    var wcastling = 'qside';
  else
    var wcastling = 'none';
  if(castlingRights.includes('k') && castlingRights.includes('q'))
    var bcastling = 'both';
  else if(castlingRights.includes('k'))
    var bcastling = 'kside';
  else if(castlingRights.includes('q'))
    var bcastling = 'qside';
  else
    var bcastling = 'none';    
  session.send('bsetup wcastle ' + wcastling);
  session.send('bsetup bcastle ' + bcastling);

  // en passant rights
  var enPassant = fenWords.enPassant;
  if(enPassant !== '-')
    session.send('bsetup eppos ' + enPassant[0]);

  session.send('bsetup done');
  session.send('wname ' + game.wname);
  session.send('bname ' + game.bname);

  // Send and commit move list
  game.commitingMovelist = true;
  if(game.history.current() !== game.history.last())
    var currMove = game.history.current();
  game.history.goto(game.history.first());
  var hEntry = game.history.first();
  while(hEntry) {
    if(hEntry.move)
      sendMove(hEntry.move);
    session.send('wclock ' + Clock.MSToHHMMSS(hEntry.wtime));
    session.send('bclock ' + Clock.MSToHHMMSS(hEntry.btime));
    var hEntry = hEntry.next;
  }
  if(!game.history.scratch() && game.history.length())  
    session.send('commit');
  game.history.goto(game.history.last());

  // Navigate back to current move
  if(currMove) {
    gotoMove(currMove);
    game.history.goto(currMove);
  }

  // This is a hack just to indicate we are done
  session.send('done');

  if(!game.statusElement.find('.game-status').html()) {
    game.gameStatusRequested = true;
    session.send('moves ' + game.id);
  }
}

/** 
 * Triggered when the 'Game Properties' menu item is selected.
 * Displays the PGN metatags associated with the game which can then be modified.
 * The game state is updated to reflect the modified metatags.
 */
$('#game-tools-properties').on('click', (event) => {
  var okHandler = function(event) {
    var metatagsStr = this.closest('.toast').querySelector('.game-properties-input').value;
    try {
      var pgn = PgnParser.parse(metatagsStr, {startRule: "tags"}) as PgnParser.ParseTree;
    }
    catch(err) {
      showFixedDialog({type: 'Failed to update properties', msg: err.message, btnSuccess: ['', 'OK']});
      return;
    }
    gameWithFocus.history.setMetatags(pgn.tags, true);
    updateGameFromMetatags(gameWithFocus);
  }; 

  var headerTitle = 'Game Properties';
  var bodyText = `<textarea style="resize: none" class="form-control game-properties-input" rows="10" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">`
      + gameWithFocus.history.metatagsToString() + `</textarea>`;
  var button1 = [okHandler, 'OK'];
  var button2 = ['', 'Cancel']; 
  showFixedDialog({type: headerTitle, msg: bodyText, btnFailure: button2, btnSuccess: button1, htmlMsg: true});
});

/** 
 * Triggered when the 'Close Game' menu item is selected.
 * Closes the game.
 */
$('#game-tools-close').on('click', (event) => {
  var game = gameWithFocus;
  if(game.preserved || game.history.editMode)
    closeGameDialog(game);
  else
    closeGame(game);
});