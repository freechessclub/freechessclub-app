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

let historyRequested = 0;
let obsRequested = 0;
let gameInfoRequested = false;
let gamesRequested = false;
let movelistRequested = 0;
let lobbyRequested = false;
let channelListRequested = false;
let modalCounter = 0;
let numPVs = 1;
let gameChangePending = false;
let matchRequestList = [];
let matchRequest;
let prevWindowWidth = 0;
let addressBarHeight;
let soundTimer
let removeSubvariationRequested = false;
let prevDiff;
let activeTab;
let promotePiece;
let promoteSource;
let promoteTarget;
let promoteIsPremove;

export function cleanup() {
  historyRequested = 0;
  obsRequested = 0;
  gameInfoRequested = false;
  gamesRequested = false;
  movelistRequested = 0;
  lobbyRequested = false;
  channelListRequested = false;
  gameChangePending = false;
  removeSubvariationRequested = false;
  matchRequestList = [];
  matchRequest = undefined;

  $('#stop-observing').hide();
  $('#stop-examining').hide();
  hideCloseGamePanel();
  hidePromotionPanel();
  $('#playing-game-buttons').hide();
  $('#viewing-game-buttons').show();

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
}

export function disableOnlineInputs(disable: boolean) {
  $('#pills-play *').prop('disabled', disable);
  $('#pills-examine *').prop('disabled', disable);
  $('#pills-observe *').prop('disabled', disable);
  $('#chan-dropdown *').prop('disabled', disable);
  $('#input-form *').prop('disabled', disable);
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
    if(!$('#engine-tab').is(':visible')) {
      $('#show-status-panel').text('Analyze');
      $('#show-status-panel').attr('title', 'Analyze Game');
      $('#show-status-panel').show();
    }
    else {
      $('#show-status-panel').hide();
      evalEngine.evaluate();
    }
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
  var bgQueen = $('.cg-wrap piece.queen.' + color).css('background-image').replace(/\"/g, '\'');
  var bgKnight = $('.cg-wrap piece.knight.' + color).css('background-image').replace(/\"/g, '\'');
  var bgRook = $('.cg-wrap piece.rook.' + color).css('background-image').replace(/\"/g, '\'');
  var bgBishop = $('.cg-wrap piece.bishop.' + color).css('background-image').replace(/\"/g, '\'');
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
      session.send(iMove.move.from + iMove.move.to);
    }
    while(i < id) {
      i = game.history.next(i);
      const iMove = game.history.get(i);
      session.send(iMove.move.from + iMove.move.to);
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
  const dests = new Map();
  chess.SQUARES.forEach(s => {
    const ms = chess.moves({square: s, verbose: true});
    if (ms.length) dests.set(s, ms.map(m => m.to));
  });
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

    move = chess.move({from: source, to: target, promotion: (promotePiece ? promotePiece : 'q')});
    fen = chess.fen();

    if(!promotePiece && !autoPromoteToggle && move && move.flags.includes('p')) {
      chess.undo();
      showPromotionPanel(source, target, false);
      board.set({ movable: { color: undefined } });
      return;
    }

    var promotion = (promotePiece ? '=' + promotePiece : '');

    if (game.isPlaying() && game.chess.turn() !== game.color)
      session.send(source + '-' + target + promotion);
   
    if(game.isExamining()) {
      var nextMove = game.history.get(game.history.next());
      if(nextMove && !nextMove.subvariation && fen === nextMove.fen) 
        session.send('for');
      else
        session.send(source + '-' + target + promotion);
    }
  }

  promotePiece = null;  
  if (move !== null)
    movePieceAfter(move, fen);

  $('#pills-game-tab').tab('show');
  // Show 'Analyze' button once any moves have been made on the board
  if(!$('#engine-tab').is(':visible'))
    $('#show-status-panel').show();
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
  const modalId = 'modal' + modalCounter++;
  let req = `
  <div id="` + modalId + `" class="toast" data-bs-autohide="false" role="status" aria-live="polite" aria-atomic="true">
    <div class="toast-header"><strong class="me-auto">` + type + `</strong>
    <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button></div>
    <div class="toast-body"><div class="d-flex align-items-center">
    <strong class="text-primary my-auto">` + title + ' ' + msg + '</strong>';

  if (progress) {
    req += '<div class="spinner-border ms-auto" role="status" aria-hidden="true"></div>';
  }

  req += '</div><div class="mt-2 pt-2 border-top center">';

  let successCmd = btnSuccess[0];
  let failureCmd = btnFailure[0];
  if(useSessionSend) {
    successCmd = "sessionSend('" + btnSuccess[0] + "');";
    failureCmd = "sessionSend('" + btnFailure[0] + "');";
  }

  if (btnSuccess !== undefined && btnSuccess.length === 2) {
    req += '<button type="button" id="btn-success" onclick="' + successCmd + `" class="btn btn-sm btn-outline-success me-4" data-bs-dismiss="toast">
        <span class="fa fa-check-circle-o" aria-hidden="false"></span> ` + btnSuccess[1] + '</button>';
  }

  if (btnFailure !== undefined && btnFailure.length === 2) {
    req += '<button type="button" id="btn-failure" onclick="' + failureCmd + `" class="btn btn-sm btn-outline-danger" data-bs-dismiss="toast">
        <span class="fa fa-times-circle-o" aria-hidden="false"></span> ` + btnFailure[1] + '</button>';
  }

  req += '</div></div></div>';
  $('#game-requests').append(req);
  $('#' + modalId).toast('show');
}

export function parseMovelist(movelist: string) {
  const moves = [];
  let found : string[] & { index?: number } = [''];
  let n = 1;
  const chess = Chess();
  var wtime = game.time * 60;
  var btime = game.time * 60;
  game.history.reset(chess.fen(), wtime, btime);
  while (found !== null) {
    found = movelist.match(new RegExp(n + '\\.\\s*(\\S*)\\s*\\((\\d+):(\\d+)\\)\\s*(?:(\\S*)\\s*\\((\\d+):(\\d+)\\))?.*', 'm'));
    if (found !== null && found.length > 3) {
      const m1 = found[1].trim();
      wtime += (n === 1 ? 0 : game.inc) - (+found[2] * 60 + +found[3]);
      game.history.add(chess.move(m1), chess.fen(), false, wtime, btime);
      if (found.length > 4 && found[4]) {
        const m2 = found[4].trim();
        btime += (n === 1 ? 0 : game.inc) - (+found[5] * 60 + +found[6]);
        game.history.add(chess.move(m2), chess.fen(), false, wtime, btime);
      }
      n++;
      movelist += movelist[found.index];
    }
  }
  if(game.isExamining())
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
        session.send('=ch');
        channelListRequested = true;

        if($('#pills-observe').hasClass('show'))
          initObservePane();
        else if($('#pills-observe').hasClass('show'))
          initExaminePane();
      } else if (data.command === 2) {
        if (session.isConnected()) {
          session.disconnect();
        }
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
        board.set({
          orientation: amIblack ? 'black' : 'white',
        });

        $('#exit-subvariation').hide();
        $('#player-captured').text('');
        $('#opponent-captured').text('');
        $('#player-status').css('background-color', '');
        $('#opponent-status').css('background-color', '');

        if(game.isPlaying() || game.isExamining()) {
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

        if (data.role !== Role.OPPONENTS_MOVE && !amIblack) {
          game.color = 'w';
          $('#player-name').text(game.wname);
          $('#opponent-name').text(game.bname);
        } else {
          game.color = 'b';
          $('#player-name').text(game.bname);
          $('#opponent-name').text(game.wname);
        }

        game.history = new History(game.fen, board, game.time * 60, game.time * 60);

        evalEngine.terminate();
        evalEngine = new EvalEngine(game.history);
        updateBoard();

        if (game.role === Role.NONE || game.isObserving() || game.isExamining()) {
          if(!isSmallWindow())
            showCloseGamePanel();
          if (game.isExamining()) {
            $('#stop-examining').show();
            session.send('games ' + game.id);
            gameInfoRequested = true;
            if(game.wname === game.bname)
              game.history.scratch(true);
            else {
              if(getPlyFromFEN(game.fen) !== 1)
                session.send('back 999');
              session.send('for 999');
            }
          }
          else
            $('#stop-observing').show();

          $('#playing-game').hide();
          $('#pills-game-tab').tab('show');

          // Show analysis buttons
          $('#playing-game-buttons').hide();
          $('#viewing-game-buttons').show();
        }
        showStatusPanel();
        scrollToBoard();
      }

      if (data.role === Role.NONE || data.role >= -2) {
        let move = null;
        const lastPly = getPlyFromFEN(game.chess.fen());
        const thisPly = getPlyFromFEN(data.fen);

        if (data.move !== 'none' && thisPly === lastPly + 1) { // make sure the move no is right
          move = game.chess.move(data.move);
          if (move !== null) 
            movePieceAfter(move);
        }
        if(move === null) {
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
      matchRequestList = [];
      matchRequest = undefined;
      $('#viewing-game-buttons').hide();
      $('#game-requests').empty();
      $('#playing-game').hide();
      $('#playing-game-buttons').show();
      $('#pills-game-tab').tab('show');
      if (data.player_one === session.getUser()) {
        chat.createTab(data.player_two);
      } else {
        chat.createTab(data.player_one);
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
      cleanup();
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

      // Parse results of 'games <game #> to get game info when examining
      match = msg.match(/\d+\s+\(\s*Exam\.\s+(\d+)\s+(\w+)\s+(\d+)\s+(\w+)\s*\)\s+\[\s*p?(\w)(\w)\s+(\d+)\s+(\d+)\s*\]/);
      if(match && match.length > 8 && gameInfoRequested) {
        gameInfoRequested = false;

        let wrating = game.wrating = match[1];
        const wname = match[2];
        let brating = game.brating = match[3];
        const bname = match[4];
        const style = match[5];
        const rated = (match[6] === 'r' ? 'rated' : 'unrated');
        const initialTime = match[7];
        const increment = match[8];

        const styleNames = new Map([
          ['b', 'blitz'], ['l', 'lightning'], ['u', 'untimed'], ['e', 'examined'],
          ['s', 'standard'], ['w', 'wild'], ['x', 'atomic'], ['z', 'crazyhouse'],
          ['B', 'Bughouse'], ['L', 'losers'], ['S', 'Suicide'], ['n', 'nonstandard']
        ]);

        if(wrating === '0') wrating = '';
        if(brating === '0') brating = '';
        $('#player-rating').text(bname === session.getUser() ? brating : wrating);
        $('#opponent-rating').text(bname === session.getUser() ? wrating : brating);

        if(wrating === '') {
          match = wname.match(/Guest[A-Z]{4}/);
          if(match)
            wrating = '++++';
          else wrating = '----';
        }
        if(brating === '') {
          match = bname.match(/Guest[A-Z]{4}/);
          if(match)
            brating = '++++';
          else brating = '----';
        }

        let time = ' ' + initialTime + ' ' + increment;
        if(style === 'u')
          time = '';

        const statusMsg = wname + ' (' + wrating + ') ' + bname + ' (' + brating + ') '
          + rated + ' ' + styleNames.get(style) + time;

        showStatusMsg(statusMsg);
        return;
      }

      match = msg.match(/.*\d+\s[0-9\+]+\s\w+\s+[0-9\+]+\s\w+\s+\[\s*[bsl]r.*\]\s+\d+:\d+\s\-\s+\d+:\d+\s\(\s*\d+\-\s*\d+\)\s+[BW]:\s+\d+\s*\d+ games displayed./g);
      if (match != null && match.length > 0) {
        showGames(data.message);
        if (!gamesRequested) {
          chat.newMessage('console', data);
        } else {
          gamesRequested = false;
        }
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
      if(match != null) {
        if(historyRequested || obsRequested || matchRequest) {
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
          else if(matchRequest) {
            user = getValue('#opponent-player-name');
            status = $('#play-pane-status');
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

            status.show();
            if(match[1].startsWith('Ambiguous name'))
              status.text('There is no player matching the name ' + user + '.');
            else
              status.text(match[1]);

            matchRequest = undefined;
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
          $('#pills-game-tab').tab('show');
        }

        chat.newMessage('console', data);
        return;
      }

      match = msg.match(/^Your seek has been posted with index \d+\./m);
      if(!match)
        match = msg.match(/^Issuing: \w+ \([-\d]+\) \w+ \([-\d]+\)/m);
      if(!match)
        match = msg.match(/^Updating offer already made to "\w+"\./m);
      if(match) {
        if(matchRequest) {
          let found = false;
          for(let i = matchRequestList.length - 1; i >= 0; i--) {
            if(matchRequestList[i].opponent.localeCompare(matchRequest.opponent, undefined, { sensitivity: 'accent' }) === 0) {
              if(matchRequestList[i].min === matchRequest.min && matchRequestList[i].sec === matchRequest.sec)
                found = true;
              else if(matchRequest.opponent != '')
                matchRequestList.splice(i, 1);
            }
          }
          if(!found) {
            matchRequestList.push(matchRequest);
            $('#game-requests').empty();
            let modalText = '';
            for(const request of matchRequestList) {
              if(request.opponent.length) {
                if(request.min === 0 && request.sec === 0)
                  modalText += 'Challenging ' + request.opponent + ' to an untimed game...<br>';
                else
                  modalText += 'Challenging ' + request.opponent + ' to a ' + request.min + ' ' + request.sec + ' game...<br>';
              }
              else {
                if(request.min === 0 && request.sec === 0)
                  modalText += 'Seeking an untimed game...<br>';
                else
                  modalText += 'Seeking a ' + request.min + ' ' + request.sec + ' game...<br>';
              }
            }
            showModal('Game Request', '', modalText, ['cancelMatchRequests();', 'Cancel'], [], true, false);
          }
          matchRequest = undefined;
          $('#play-pane-status').hide();
        }

        chat.newMessage('console', data);
        return;
      }

      match = msg.match(/^Movelist for game (\d+):.*/m);
      if (match != null && match.length > 1) {
        if (+match[1] === game.id) {
          if (movelistRequested === 0) {
            chat.newMessage('console', data);
          } else {
            movelistRequested--;
            if(movelistRequested === 0)
              parseMovelist(msg);
          }
        }
        return;
      }

      // Moving backwards and forwards is now handled more generally by updateHistory()
      match = msg.match(/Game\s\d+: \w+ backs up (\d+) moves?\./);
      if (match != null && match.length > 1)
        return;
      match = msg.match(/Game\s\d+: \w+ goes forward (\d+) moves?\./);
      if (match != null && match.length > 1)
        return;

      match = msg.match(/(Creating|Game\s(\d+)): (\w+) \(([\d\+\-\s]+)\) (\w+) \(([\d\-\+\s]+)\).+/);
      if (match != null && match.length > 4) {
        game.wrating = match[4];
        game.brating = match[6];
        showStatusMsg(match[0].substring(match[0].indexOf(':')+1));
        if (match[3] === session.getUser() || match[1].startsWith('Game')) {
          if (game.id === 0) {
            game.id = +match[2];
          }
          if (!isNaN(match[4])) {
            $('#player-rating').text(match[4]);
          } else {
            $('#player-rating').text('');
          }
          if (!isNaN(match[6])) {
            $('#opponent-rating').text(match[6]);
          } else {
            $('#opponent-rating').text('');
          }
        } else if (match[5] === session.getUser()) {
          if (!isNaN(match[4])) {
            $('#opponent-rating').text(match[4]);
          } else {
            $('#opponent-rating').text('');
          }
          if (!isNaN(match[6])) {
            $('#player-rating').text(match[6]);
          } else {
            $('#player-rating').text('');
          }
        }
        return;
      }

      match = msg.match(
        /Challenge: (\w+) \(([\d\+\-\s]{4})\) (\[(?:white|black)\] )?(\w+) \(([\d\+\-\s]{4})\)\s((?:.+))You can "accept" or "decline", or propose different parameters./ms);
      if (match != null && match.length > 4) {
        const [opponentName, opponentRating] = (match[1] === session.getUser()) ?
          match.slice(4, 6) : match.slice(1, 3);
        showModal('Match Request', opponentName + '(' + opponentRating + ')' + (match[3] ? ' ' + match[3] : ''),
          match[6], ['decline', 'Decline'], ['accept', 'Accept']);
        return;
      }

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
        cleanup();
        return;
      }

      match = msg.match(/You are no longer examining game (\d+)./);
      if (match != null && match.length > 1) {
        if(gameChangePending)
          session.send('refresh');

        stopEngine();
        cleanup();
        return;
      }

      match = msg.match(/^Notification: .*/m);
      if (match != null && match.length > 0) {
        chat.newNotification(match[0]);
        return;
      }
      match = msg.match(/^\w+ is not logged in./m);
      if (match != null && match.length > 0) {
        chat.newNotification(match[0]);
        return;
      }
      match = msg.match(/^Player [a-zA-Z\"]+ is censoring you./m);
      if (match != null && match.length > 0) {
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

      match = msg.match(/^\[\d+\] (?:added to|removed from) your channel list\./m);
      if (match != null && match.length > 0) {
        session.send('=ch');
        channelListRequested = true;
        chat.newMessage('console', data);
        return;
      }

      if (lobbyRequested) {
        match = msg.match(/.*\<(s|sc|sr)\>.*/g);
        parseSeeks(data.message);
        return;
      }

      if (msg === 'You are muted.') {
        chat.newNotification(msg);
        return;
      }

      if (
        msg === 'Style 12 set.' ||
        msg === 'You will not see seek ads.' ||
        msg === 'You will now hear communications echoed.' ||
        msg === 'seekinfo unset.' ||
        msg === 'seekremove unset.' ||
        msg.startsWith('No one is observing game ')
      ) {
        return;
      }

      chat.newMessage('console', data);
      break;
  }
}

export function scrollToBoard() {
  if(isSmallWindow())
    $(document).scrollTop($('#right-panel').offset().top + $(window).height());
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
  var sameMove = false;
  
  if(!fen) 
    fen = game.chess.fen();

  const index = game.history.find(fen);

  if(move && !index) {
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
  else {
    // move is beyond the end of the move list
    if(getPlyFromFEN(fen) - 1 > game.history.length()) {
      movelistRequested++;
      session.send('moves ' + game.id);
    }

    if(!movelistRequested && game.role !== Role.NONE) 
      game.history.setClockTimes(index, game.wtime, game.btime);

    // move is already displayed
    if(index === game.history.index())
      sameMove = true;

    // move is earlier, we need to take-back
    if(game.isPlaying() || game.isObserving()) {
      while(index < game.history.length())
        game.history.removeLast();
    }
  }

  if(sameMove) {
    updateClocks();
    return;
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

export function updateBoard(playMove = false) {
  const move = game.history.get().move;
  const fen = game.history.get().fen;

  updateClocks();

  if(playMove && !$('#promotion-panel').is(':visible')) {
    board.move(move.from, move.to);
    if (move.flags !== 'n') {
      board.set({ fen });
    }
  }
  else 
    board.set({ fen });

  if($('#promotion-panel').is(':visible')) {
    board.cancelPremove();
    hidePromotionPanel();
  }

  const localChess = new Chess(fen);

  if(move) {
    board.set({ animation: { enabled: false }});
    board.move( move.to, move.from );
    board.move( move.from, move.to );
    board.set({ animation: { enabled: true }});
  }
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
    dests
  };

  board.set({
    turnColor,
    movable,
    check: localChess.in_check() ? toColor(localChess) : false,
    blockTouchScroll: (game.isPlaying() ? true : false),
  });

  showStrengthDiff(fen);

  if(playMove && soundToggle) {
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
  evalEngine.evaluate();
}

function startEngine() {
  $('#start-engine').text('Stop');

  $('#engine-pvs').empty();
  for(let i = 0; i < numPVs; i++)
    $('#engine-pvs').append('<li>&nbsp;</li>');

  engine = new Engine(board, numPVs);
  if(movelistRequested == 0)
    engine.move(game.history.get().fen);
  else
    engine.move(game.fen);
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
  $('#show-status-panel').text('Analyze');
  $('#show-status-panel').attr('title', 'Analyze Game');
  $('#show-status-panel').show();
}

function showAnalysis() {
  openLeftBottomTab($('#engine-tab'));
  openLeftBottomTab($('#eval-graph-tab'));
  $('#engine-pvs').empty();
  for(let i = 0; i < numPVs; i++)
    $('#engine-pvs').append('<li>&nbsp;</li>');
  $('#engine-pvs').css('white-space', (numPVs === 1 ? 'normal' : 'nowrap'));
  scrollToLeftPanelBottom();
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

$('#pills-tab button').on('click', (event) => {
  activeTab = $(this);
  $('#collapse-history').collapse('show');
  scrollToTop();
});

$('#flip-toggle').on('click', (event) => {
  board.toggleOrientation();

  // If pawn promotion dialog is open, redraw it in the correct location
  if($('#promotion-panel').is(':visible')) 
    showPromotionPanel(promoteSource, promoteTarget, promoteIsPremove);

  const playerName = $('#player-name').html();
  const playerRating = $('#player-rating').html();
  const playerCaptured = $('#player-captured').html();
  const playerTime = $('#player-time').html();
  const playerStatus = $('#player-status').html();

  const opponentName = $('#opponent-name').html();
  const opponentRating = $('#opponent-rating').html();
  const opponentCaptured = $('#opponent-captured').html();
  const opponentTime = $('#opponent-time').html();
  const opponentStatus = $('#opponent-status').html();

  $('#player-name').html(opponentName);
  $('#player-rating').html(opponentRating);
  $('#player-captured').html(opponentCaptured);
  $('#player-time').html(opponentTime);

  $('#opponent-name').html(playerName);
  $('#opponent-rating').html(playerRating);
  $('#opponent-captured').html(playerCaptured);
  $('#opponent-time').html(playerTime);

  $('#player-name').prop('id', 'tmp-player-name');
  $('#player-rating').prop('id', 'tmp-player-rating');
  $('#player-captured').prop('id', 'tmp-player-captured');
  $('#player-time').prop('id', 'tmp-player-time');
  $('#player-status').prop('id', 'tmp-player-status');

  $('#opponent-name').prop('id', 'player-name');
  $('#opponent-rating').prop('id', 'player-rating');
  $('#opponent-captured').prop('id', 'player-captured');
  $('#opponent-time').prop('id', 'player-time');
  $('#opponent-status').prop('id', 'player-status');

  $('#tmp-player-name').prop('id', 'opponent-name');
  $('#tmp-player-rating').prop('id', 'opponent-rating');
  $('#tmp-player-captured').prop('id', 'opponent-captured');
  $('#tmp-player-time').prop('id', 'opponent-time');
  $('#tmp-player-status').prop('id', 'opponent-status');
});

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

  prevWindowWidth = $(window).innerWidth();
  
  if(isSmallWindow()) {
    useMobileLayout();
    $('#collapse-chat').collapse('hide');
    $('#collapse-history').collapse('hide');
  }
  else {
    configureTooltips();
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

  setPanelSizes();

  // Wait for panels to resize
  game.role = Role.NONE;
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
// Allow tooltips to be added either by data-bs-toggle="tooltip" or data-bs-tooltip="true"
// in case data-bs-toggle is being used for something else, e.g. collapse or dropdown
function configureTooltips() {
  $('[data-bs-toggle="tooltip"], [data-bs-tooltip="true"]').each(function(index, element) {   
    var trigger = $(element);
    var windowWidth = $(window).width();

    var sm = trigger.attr('data-bs-placement-sm');
    var md = trigger.attr('data-bs-placement-md');
    var lg = trigger.attr('data-bs-placement-lg');
    var xl = trigger.attr('data-bs-placement-xl');
    var general = trigger.attr('data-bs-placement');

    var placement = (windowWidth >= 1200 ? xl : undefined) ||
        (windowWidth >= 992 ? lg : undefined) ||
        (windowWidth >= 768 ? md : undefined) ||
        sm || general || "top";

    trigger.tooltip('dispose').tooltip({
      placement: placement as "left" | "top" | "bottom" | "right" | "auto",
      trigger: (isSmallWindow() ? 'hover focus' : 'hover'), // Tooltips stay visible after element is clicked on mobile, but only when hovering on desktop 
    });
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

// If on small screen device displaying 1 column, move the navigation buttons so they are near the board
function useMobileLayout() {
  swapLeftRightPanelHeaders();
  $('#chat-maximize-btn').hide();
  $('#stop-observing').appendTo($('#viewing-game-buttons').last());
  $('#stop-examining').appendTo($('#viewing-game-buttons').last());
  hideCloseGamePanel();
  configureTooltips();
}

function useDesktopLayout() {
  swapLeftRightPanelHeaders();
  $('#chat-maximize-btn').show();
  $('#stop-observing').appendTo($('#close-game-panel').last());
  $('#stop-examining').appendTo($('#close-game-panel').last());
  if(game.isObserving() || game.isExamining())
    showCloseGamePanel();
  configureTooltips();
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
  matchRequest = {opponent, min, sec};
  const cmd: string = (opponent !== '') ? 'match ' + opponent : 'seek';
  session.send(cmd + ' ' + min + ' ' + sec);
}
(window as any).getGame = getGame;

(window as any).cancelMatchRequests = () => {
  session.send('unseek');
  session.send('withdraw t all');
  matchRequestList = [];
  matchRequest = undefined;
};

$('#input-text').on('focus', () => {
  $('#board').on('touchstart', () => {
    $('#input-text').trigger('blur');
    $('#board').off('touchstart');
  });
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
  if (game.isExamining())
    session.send('back 999');
  else if(game.history)
    game.history.beginning();
  $('#pills-game-tab').tab('show');
});

$('#backward').off('click');
$('#backward').on('click', () => {
  backward();
});

function backward() {
  if(game.history) {
    if(game.isExamining())
      session.send('back');
    else
      game.history.backward();
  }
  $('#pills-game-tab').tab('show');
}

$('#forward').off('click');
$('#forward').on('click', () => {
  forward();
});

function forward() {
  if(game.history) {
    if (game.isExamining()) {
      const nextIndex = game.history.next();
      if(nextIndex !== undefined) {
        const nextMove = game.history.get(nextIndex);
        if(nextMove.subvariation || game.history.scratch())
          session.send(nextMove.move.from + nextMove.move.to);
        else
          session.send('for');
      }
    }
    else
      game.history.forward();
  }
  $('#pills-game-tab').tab('show');
}

$('#fast-forward').off('click');
$('#fast-forward').on('click', () => {
  if (game.isExamining()) {
    if(!game.history.scratch()) {
      if(game.history.get().subvariation)
        session.send('back 999');
      session.send('for 999');
    }
    else {
      while(game.history.next())
        forward();
    }
  }
  else if(game.history)
    game.history.end();
  $('#pills-game-tab').tab('show');
});

$('#exit-subvariation').off('click');
$('#exit-subvariation').on('click', () => {
  if(game.isExamining()) {
    let index = game.history.index();
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
  $('#pills-game-tab').tab('show');
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

if (!soundToggle) {
  const iconClass = 'dropdown-icon fa fa-volume-off';
  $('#sound-toggle').html('<span id="sound-toggle-icon" class="' + iconClass +
    '" aria-hidden="false"></span>Sounds OFF');
}
$('#sound-toggle').on('click', (event) => {
  soundToggle = !soundToggle;
  const iconClass = 'dropdown-icon fa fa-volume-' + (soundToggle ? 'up' : 'off');
  $('#sound-toggle').html('<span id="sound-toggle-icon" class="' + iconClass +
    '" aria-hidden="false"></span>Sounds ' + (soundToggle ? 'ON' : 'OFF'));
  Cookies.set('sound', String(soundToggle), { expires: 365 })
});

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

export function isSmallWindow() {
  return window.innerWidth < 768;
}

$(window).on('resize', () => {
  if(isSmallWindow() && prevWindowWidth >= 768)
    useMobileLayout();
  else if(!isSmallWindow() && prevWindowWidth < 768)
    useDesktopLayout();

  prevWindowWidth = window.innerWidth;
  setPanelSizes();

  if(evalEngine)
    evalEngine.redraw();
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

(window as any).showGameTab = () => {
  $('#pills-game-tab').tab('show');
};

function showHistory(user: string, history: string) {
  if (!$('#pills-examine').hasClass('show')) {
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
      '<button type="button" class="w-100 btn btn-outline-secondary" onclick="sessionSend(\'ex ' + user + ' ' +
      + id + '\'); showGameTab();">' + hArr[i] + '</button>');
  }
}

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
  if (!$('#pills-observe').hasClass('show')) {
    return;
  }

  $('#observe-pane-status').hide();

  for (const g of games.split('\n').slice(0, -2).reverse()) {
    const gg = g.trim();
    const id = gg.split(' ')[0];
    const match = gg.match(/\[\s*p/); // Don't list private games
    if(!match)
      $('#games-table').append(
        '<button type="button" class="w-100 btn btn-outline-secondary" onclick="observeGame(\''
        + id + '\');">' + gg + '</button>');
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
  $('#pills-game-tab').tab('show');
});

$(document).on('shown.bs.tab', 'button[href="#eval-graph-panel"]', (e) => {
  evalEngine.redraw();
});

$('#left-bottom-tabs .closeTab').on('click', (event) => {
  var id = $(event.target).parent().siblings('.nav-link').attr('id');
  if(id === 'engine-tab' || id === 'eval-graph-tab')
    hideAnalysis();
});

$(document).on('shown.bs.tab', 'button[data-bs-target="#pills-lobby"]', (e) => {
  $('#lobby-table').html('');
  if (session && session.isConnected()) {
    lobbyRequested = true;
    session.send('iset seekremove 1');
    session.send('iset seekinfo 1');
  }
});

$(document).on('hidden.bs.tab', 'button[data-bs-target="#pills-play"]', (e) => {
  if (lobbyRequested) {
    $('#lobby-table').html('');
    session.send('iset seekremove 0');
    session.send('iset seekinfo 0');
    lobbyRequested = false;
  }
});

$(document).on('hidden.bs.tab', 'button[data-bs-target="#pills-lobby"]', (e) => {
  $('#lobby-table').html('');
  if (session && session.isConnected()) {
    session.send('iset seekremove 0');
    session.send('iset seekinfo 0');
    lobbyRequested = false;
  }
});

const seekMap = new Map();

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

function parseSeeks(msgs: string) {
  for (const msg of msgs.split('\n')) {
    const m = msg.trim();
    if (m.startsWith('<sc>')) {
      $('#lobby-table').html('');
    }
    else if (m.startsWith('<s>')) {
      const seek = m.split(' ').slice(1);
      const seekDetails = seek.slice(1).map(pair => pair.split('=')[1]).slice(0, -3);
      seekDetails[0] = seekDetails[0] + titleToString[+seekDetails[1]];
      if (seekDetails[2] !== '0P') {
        seekDetails[0] = seekDetails[0] + '(' + seekDetails[2] + ')';
      }
      seekDetails.splice(1, 2);
      seekMap.set(seek[0], seekDetails.join(' '));
    }
    else if (m.startsWith('<sr>')) {
      for (const r of m.split(' ').slice(1)) {
        seekMap.delete(r);
      }
    }
    $('#lobby-table').html('');
    seekMap.forEach((value, key) => {
      $('#lobby-table').append(
        '<button type="button" class="btn btn-outline-secondary" onclick="sessionSend(\'play ' +
        + key + '\'); showGameTab();">' + value + '</button>');
    });
  }
}
