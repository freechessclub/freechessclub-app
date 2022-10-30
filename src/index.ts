// Copyright 2022 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import Chess from 'chess.js';
import Cookies from 'js-cookie';
import { Chessground } from 'chessground';
import { Color, Key } from 'chessground/types';

import Chat from './chat';
import * as clock from './clock';
import Engine from './engine';
import { game, Role } from './game';
import History from './history';
import { GetMessageType, MessageType, Session } from './session';
import * as Sounds from './sounds';
import './ui';

let session: Session;
let chat: Chat;
let engine: Engine;

// toggle game sounds
let soundToggle: boolean = (Cookies.get('sound') !== 'false');

let historyRequested = false;
let gamesRequested = false;
let movelistRequested = 0;
let lobbyRequested = false;
let modalCounter = 0;
let gameChangePending = false;

(window as any).showMove = (n: number) => {
  if(game.isExamining()) {
    if(game.history.length() !== n)
      session.send('back ' + (game.history.length() - n));
  }
  else 
    var entry = game.history.display(n);            
};

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
        '<img id="' + piece + '" src="www/css/images/pieces/merida/' +
          piece + '.svg"/><small>' + game.playerCaptured[key] + '</small>');
    }
  }
  for (const key in game.oppCaptured) {
    if (game.oppCaptured.hasOwnProperty(key) && game.oppCaptured[key] > 0) {
      const piece = game.color + key.toUpperCase();
      $('#opponent-captured').append(
        '<img id="' + piece + '" src="www/css/images/pieces/merida/' +
          piece + '.svg"/><small>' + game.oppCaptured[key] + '</small>');
    }
  }
}

const board: any = Chessground(document.getElementById('board'), {
  movable: {
    free: false,
    color: undefined,
  },
  blockTouchScroll: false,
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

function movePieceAfter(move: any) {
  // go to current position if user is looking at earlier move in the move list
  if(game.history.ply() < game.history.length())
    board.set({ fen: game.chess.fen() });

  board.move(move.from, move.to);
  if (move.flags !== 'n') {
    board.set({ fen: game.chess.fen() });
  }

  updateHistory(move);
  updateBoardAfter();

  board.playPremove();

  if (move.captured) {
    showCapturePiece(move.color, move.captured);
  }

  if (game.chess.in_check()) {
    if (soundToggle) {
      Sounds.checkSound.play();
    }
  } else {
    if (soundToggle) {
      if (move.captured) {
        Sounds.captureSound.play();
      } else {
        Sounds.moveSound.play();
      }
    }
  }
}

export function movePiece(source: any, target: any, metadata: any) {
  if (!game.chess) {
    return;
  }

  if (game.isExamining() || game.chess.turn() === game.color) {
    session.send(source + '-' + target);
  }

  const move = game.chess.move({
    from: source,
    to: target,
    promotion: 'q', // TODO: Allow non-queen promotions
  });

  if (move !== null) {
    movePieceAfter(move);
  }
}

function showStatusMsg(msg: string) {
  $('#game-status').html(msg + '<br/>');
}

function showModal(type: string, title: string, msg: string, btnFailure: string[], btnSuccess: string[], progress: boolean = false) {
  const modalId = 'modal' + modalCounter++;
  let req = `
  <div id="` + modalId + `" class="toast" data-bs-autohide="false" role="status" aria-live="polite" aria-atomic="true">
    <div class="toast-header"><strong class="me-auto">` + type + `</strong>
    <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button></div>
    <div class="toast-body"><div class="d-flex align-items-center">
    <strong class="text-primary my-auto">` + title + ' ' + msg + `</strong>`;

  if (progress) {
    req += `<div class="spinner-border ms-auto" role="status" aria-hidden="true"></div>`;
  }

  req += `</div><div class="mt-2 pt-2 border-top center">`;

  if (btnSuccess !== undefined && btnSuccess.length === 2) {
    req += `<button type="button" id="btn-success" onclick="sessionSend('` + btnSuccess[0] + `');" class="btn btn-sm btn-outline-success me-4" data-bs-dismiss="toast">
        <span class="fa fa-check-circle-o" aria-hidden="false"></span> ` + btnSuccess[1] + `</button>`;
  }

  if (btnFailure !== undefined && btnFailure.length === 2) {
    req += `<button type="button" id="btn-failure" onclick="sessionSend('` + btnFailure[0] + `');" class="btn btn-sm btn-outline-danger" data-bs-dismiss="toast">
        <span class="fa fa-times-circle-o" aria-hidden="false"></span> ` + btnFailure[1] + `</button>`;
  }

  req += `</div></div></div>`;
  $('#game-requests').append(req);
  $('#' + modalId).toast('show');
}

export function parseMovelist(movelist: string) {
  const moves = [];
  let found : string[] & { index?: number } = [''];
  let n = 1;
  const chess = Chess();
  game.history = new History(chess.fen(), board); // Note, History now stores {move, fen} pairs 
  while (found !== null) {
    // Fixed regex to allow for O-O and other moves with symbols and fixed bug with brackets for optional 2nd column
    found = movelist.match(new RegExp(n + '\\.\\s*(\\S*)\\s*(?:\\(\\d+:\\d+\\))\\s*(?:(\\S*)\\s*(?:\\(\\d+:\\d+\\)))?.*', 'm'));
    if (found !== null && found.length > 1) {
      const m1 = found[1].trim();
      game.history.add(chess.move(m1), chess.fen());
      if (found.length > 2 && found[2]) {
        const m2 = found[2].trim();
        game.history.add(chess.move(m2), chess.fen());
      }
      n++;
      movelist += movelist[found.index];
    }
  }
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
      } else if (data.command === 2) {
        if (session.isConnected()) {
          session.disconnect();
        }
        session.reset(undefined);
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
        else if(game.isObserving()) {
          session.send('unobs ' + game.id);
        }
        gameChangePending = true;
        break;
      }

      Object.assign(game, data);
      const amIblack = game.bname === session.getUser();
      const amIwhite = game.wname === session.getUser();

      if (game.chess === null) {
        game.chess = new Chess();
        board.cancelMove();
        board.set({
          orientation: amIblack ? 'black' : 'white',
          movable: {
            free: false,
            events: {
              after: movePiece,
            }
          },
          blockTouchScroll: true,
        });

        game.playerCaptured = {};
        game.oppCaptured = {};
        $('#player-captured').text('');
        $('#opponent-captured').text('');
        $('#player-status').css('background-color', '');
        $('#opponent-status').css('background-color', '');

        if (data.role !== Role.OPPONENTS_MOVE && !amIblack) {
          game.color = 'w';
          if (!game.isExamining() || data.role !== Role.OBS_EXAMINED || data.role !== Role.ISOLATED_POS) {
            game.wclock = clock.startWhiteClock(game);
            game.bclock = clock.startBlackClock(game);
          }
          $('#player-name').text(game.wname);
          $('#opponent-name').text(game.bname);
        } else {
          game.color = 'b';
          if (!game.isExamining() || data.role !== Role.OBS_EXAMINED || data.role !== Role.ISOLATED_POS) {
            game.bclock = clock.startBlackClock(game);
            game.wclock = clock.startWhiteClock(game);
          }
          $('#player-name').text(game.bname);
          $('#opponent-name').text(game.wname);
        }

        game.history = new History(game.fen, board); 
        updateBoardAfter(); 

        if (game.role === Role.NONE || game.isObserving() || game.isExamining()) {
          if (game.isExamining()) {
            $('#new-game').text('Unexamine game');
            engine = new Engine(game.chess, board);
          }
          else 
            $('#new-game').text('Unobserve game');

          $('#new-game-menu').prop('disabled', true);
          $('#playing-game').hide();
          $('#pills-game-tab').tab('show');
        }
      }

      if (data.role === Role.NONE || data.role >= -1) {
        let move = null;
        const lastPly = getPlyFromFEN(game.chess.fen());
        const thisPly = getPlyFromFEN(data.fen);
        if (data.move !== 'none' && thisPly === lastPly + 1) { // make sure the move no is right
          move = game.chess.move(data.move);
          if (move !== null) {
            movePieceAfter(move);
          }
        }
        if (data.move === 'none' || (move === null && game.chess.fen() !== data.fen)) {
          const loaded = game.chess.load(data.fen);
          board.set({
            fen: data.fen,
          });

          updateHistory();
          updateBoardAfter();
        }
      }
      break;
    case MessageType.GameStart:
      $('#game-requests').empty();
      $('#playing-game').hide();
      $('#pills-game-tab').tab('show');
      if (data.player_one === session.getUser()) {
        chat.createTab(data.player_two);
      } else {
        chat.createTab(data.player_one);
      } 
      session.send('allobs ' + data.game_id);
      game.watchers = setInterval(() => {
        const time = game.color === 'b' ? game.btime : game.wtime;
        if (time > 60) {
          session.send('allobs ' + data.game_id);
        }
      }, 90000);
      break;
    case MessageType.GameEnd:
      $('#playing-game').show();
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
      let examine = [];
      let rematch = [];
      if ($('#player-name').text() === session.getUser()
        && data.reason !== 2 && data.reason !== 7) {
        rematch = ['rematch', 'Rematch']
      }
      if (data.reason !== 7) {
        examine = ['ex ' + data.winner + ' -1', 'Examine'];
      }
      showModal('Match Result', '', data.message, examine, rematch);
      game.role = Role.NONE;
      clearInterval(game.wclock);
      clearInterval(game.bclock);
      clearInterval(game.watchers);
      game.watchers = null;
      $('#game-watchers').empty();
      game.id = 0;
      delete game.chess;
      game.chess = null;
      board.cancelMove();
      board.set({
        movable: {
          free: false,
          color: undefined,
        },
        blockTouchScroll: false,
      });
      break;
    case MessageType.Unknown:
    default:
      const msg = data.message.replace(/\n/g, '');

      // For takebacks, board was already updated when new move received and
      // updating the history is now done more generally in updateHistory().
      let match = msg.match(/(\w+) (\w+) the takeback request\./);
      if (match !== null && match.length > 1)
        return;
      match = msg.match(/You (\w+) the takeback request from (\w+)\./);
      if (match !== null && match.length > 1) 
        return;

      match = msg.match(/(?:Observing|Examining)\s+(\d+) [\(\[].+[\)\]]: (.+) \(\d+ users?\)/);
      $('#game-watchers').empty();
      if (match != null && match.length > 1) {
        if (+match[1] === game.id) {
          match[2] = match[2].replace(/\(U\)/g, '');
          const watchers = match[2].split(' ');
          let req = 'Watchers: ';
          for (let i = 0; i < watchers.length; i++) {
            req += `<span class="badge rounded-pill bg-secondary noselect">` + watchers[i] + `</span> `;
            if (i > 5) {
              req += ` + ` + (watchers.length - i) + ` more.`;
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
        if (!historyRequested) 
          chat.newMessage('console', data);
        else {
          showHistory(match[1], data.message);
          historyRequested = false;
        }
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
              parseMovelist(match[0]);
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
        // tslint:disable-next-line:max-line-length
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
        if(gameChangePending) {
          gameChangePending = false;
          session.send('refresh');
        }
        else {
          $('#new-game').text('Quick Game');
          $('#new-game-menu').prop('disabled', false);
        }
        clearInterval(game.wclock);
        clearInterval(game.bclock);
        delete game.chess;
        game.chess = null;
        board.set({
          movable: {
            free: false,
            color: undefined,
          },
        });
        game.role = Role.NONE;
        return;
      }

      match = msg.match(/You are no longer examining game (\d+)./);
      if (match != null && match.length > 1) {
        if(gameChangePending) {
          gameChangePending = false;
          session.send("refresh");
        }
        else {
          $('#game-status').html('');
          $('#move-history').empty();
          game.history = null;
          $('#playing-game').show();
          $('#new-game').text('Quick Game');
          $('#new-game-menu').prop('disabled', false);
        }
        clearInterval(game.wclock);
        clearInterval(game.bclock);
        delete game.chess;
        game.chess = null;
        board.set({
          movable: {
            free: false,
            color: undefined,
          },
        });
        game.role = Role.NONE;
        engine.terminate();
        engine = null;
        return;
      }

      match = msg.match(/^Notification: .*/);
      if (match != null && match.length > 0) {
        chat.newNotification(match[0]);
        return;
      }
      match = msg.match(/^\w+ is not logged in./);
      if (match != null && match.length > 0) {
        chat.newNotification(match[0]);
        return;
      }
      match = msg.match(/^Player [a-zA-Z\"]+ is censoring you./);
      if (match != null && match.length > 0) {
        chat.newNotification(match[0]);
        return;
      }

      match = msg.match(/-- channel list: \d+ channels --([\d\s]*)/);
      if (match !== null && match.length > 1) {
        return chat.addChannels(match[1].split(/\s+/));
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

function getPlyFromFEN(fen: string) {
  var turn_color = fen.split(' ')[1];
  var move_no = +fen.split(' ').pop();
  var ply = move_no * 2 - (turn_color === 'w' ? 1 : 0);

  return ply;
}

function updateHistory(move?: any) {
  var ply = getPlyFromFEN(game.chess.fen());

  while(ply - 1 < game.history.length()) 
    game.history.removeLast();
    
  if(ply - 1 > game.history.length() + 1) {
    movelistRequested++;
    session.send('moves ' + game.id);
  }
  
  if(move) {
    game.history.add(move, game.chess.fen());
  } 
}

export function updateBoardAfter() {
  var move = game.history.get().move;
  var fen = game.history.get().fen;

  var localChess = new Chess(fen);

  if(move) {
    board.set({ animation: { enabled: false }});
    board.move( move.to, move.from );
    board.move( move.from, move.to );
    board.set({ animation: { enabled: true }});
  } 
  else 
    board.set({ lastMove: false });

  var dests : Map<Key, Key[]> | undefined = undefined;
  var movableColor : string | undefined = undefined;
  var turnColor : string | undefined = undefined;

  if(game.isObserving()) {
    turnColor = toColor(game.chess);
  }
  else if(game.isPlaying()) {
    movableColor = (game.color === 'w' ? 'white' : 'black');
    dests = toDests(game.chess);
    turnColor = toColor(game.chess);
  }
  else if(game.isExamining()) {
    movableColor = toColor(localChess);
    dests = toDests(localChess);
    turnColor = toColor(localChess);
  }
  else {
    // TODO: we don't support editing the board in local-mode yet!
    turnColor = toColor(localChess);
  }

  let movable : any = {};
  movable = {
    color: movableColor,
    dests: dests
  };

  board.set({
    turnColor: turnColor,
    movable: movable,
    check: localChess.in_check() 
  });
}

function getMoveNoFromFEN(fen: string) {
  return +fen.split(' ').pop();
}

$('#flip-toggle').on('click', (event) => {
  board.toggleOrientation();
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
  const user = Cookies.get('user');
  const pass = Cookies.get('pass');
  const proxy = Cookies.get('proxy');
  const enableProxy = (proxy !== undefined);
  if (user !== undefined && pass !== undefined) {
    session = new Session(messageHandler, enableProxy, user, atob(pass));
  } else {
    session = new Session(messageHandler, enableProxy);
  }

  setPanelHeights();

  $('#opponent-time').text('00:00');
  $('#player-time').text('00:00');
}

// Set the height of dynamic elements inside left and right panel collapsables.
// Try to do it in a robust way that won't break if we add/remove elements later.
function setPanelHeights() {
  const boardHeight = $('#board').innerHeight();
  if (boardHeight) {
    var siblingsHeight = 0;
    var siblings = $('#collapse-history').siblings();
    siblings.each(function() {
      siblingsHeight += $(this).outerHeight();
    });
    var leftPanelBorder = $('#left-panel').outerHeight() - $('#left-panel').height();
    $('#left-panel').height(boardHeight - leftPanelBorder - siblingsHeight);

    var siblingsHeight = 0;
    var siblings = $('#collapse-chat').siblings();
    siblings.each(function() {
      siblingsHeight += $(this).outerHeight();
    });
    var rightPanelBorder = $('#right-panel').outerHeight() - $('#right-panel').height();
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

function getGame(min: number, sec: number) {
  if (game.chess === null) {
    const opponent = getValue('#opponent-player-name')
    $('#game-requests').empty();
    showModal('Game Request', '', 'Seeking a ' + min + ' ' + sec + ' game...', ['unseek', 'Cancel'], [], true);
    const cmd: string = (opponent !== '') ? 'match ' + opponent : 'seek';
    session.send(cmd + ' ' + min + ' ' + sec);
  }
}
(window as any).getGame = getGame;

$('#input-text').on('focus', () => {
  $('#board').on('touchstart', () => {
    $('#input-text').trigger('blur');
    $('#board').off('touchstart');
  });
});

$('#new-game').on('click', (event) => {
  if (game.chess === null) {
    session.send('getga');
  } else if (game.isObserving()) {
    session.send('unobs');
  } else if (game.isExamining()) {
    session.send('unex');
  }
});

$('#custom-control').on('click', (event) => {
  if (game.chess === null) {
    const min: string = getValue('#custom-control-min');
    const sec: string = getValue('#custom-control-sec');
    getGame(+min, +sec);
  }
});

$('#fast-backward').off('click');
$('#fast-backward').on('click', () => {
  if (game.isExamining()) 
    session.send('back 999');
  else if(game.history) 
    game.history.beginning();
});

$('#backward').off('click');
$('#backward').on('click', () => {
  if (game.isExamining()) 
    session.send('back');
  else if(game.history) 
    game.history.backward();
  });

$('#forward').off('click');
$('#forward').on('click', () => {
  if (game.isExamining()) 
    session.send('for');
  else if(game.history) 
    game.history.forward();
});

$('#fast-forward').off('click');
$('#fast-forward').on('click', () => {
  if (game.isExamining()) 
    session.send('for 999');
  else if(game.history) 
    game.history.end();
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

$('#disconnect').on('click', (event) => {
  if (session) {
    session.disconnect();
    session = null;
  }
});

$('#login-user').on('change', () => $('#login-user').removeClass('is-invalid'));

$('#login-form').on('submit', (event) => {
  const user: string = getValue('#login-user');
  if (user === session.getUser()) {
    $('#login-user').addClass('is-invalid');
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const pass: string = getValue('#login-pass');
  const enableProxy = $('#enable-proxy').prop('checked');
  if (enableProxy) {
    Cookies.set('proxy', String(enableProxy), { expires: 365 });
    $('#proxy').text('Proxy: ON');
  } else {
    Cookies.remove('proxy');
    $('#proxy').text('Proxy: OFF');
  }
  session = new Session(messageHandler, enableProxy, user, pass);
  if ($('#remember-me').prop('checked')) {
    Cookies.set('user', user, { expires: 365 });
    Cookies.set('pass', btoa(pass), { expires: 365 });
  } else {
    Cookies.remove('user');
    Cookies.remove('pass');
  }
  $('#login-screen').modal('hide');
  event.preventDefault();
  event.stopPropagation();
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
  const proxy = Cookies.get('proxy');
  if (proxy !== undefined) {
    $('#enable-proxy').prop('checked', true);
  }
});

$('#sign-in').on('click', (event) => {
  $('#login-screen').modal('show');
});

$('#connect-user').on('click', (event) => {
  $('#login-screen').modal('show');
});

$('#connect-guest').on('click', (event) => {
  const proxy = Cookies.get('proxy');
  const enableProxy = (proxy !== undefined);
  session = new Session(messageHandler, enableProxy);
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

$(window).on('resize', () => {
  setPanelHeights();
});

// prompt before unloading page if in a game
$(window).on('beforeunload', () => {
  if (game.chess) {
    return true;
  }
});

function getHistory(user: string) {
  if (session && session.isConnected()) {
    historyRequested = true;
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
  const exUser = getValue('#examine-username');
  if (exUser !== user) {
    return;
  }
  for (const g of parseHistory(history)) {
    const id = g.slice(0, g.indexOf(':'));
    $('#history-table').append(
      `<button type="button" class="btn btn-outline-secondary" onclick="sessionSend('ex ` + user + ' ' +
      + id + `'); showGameTab();">` + g + `</button>`);
  }
}

$(document).on('shown.bs.tab', 'button[data-bs-target="#pills-examine"]', (e) => {
  $('#history-table').html('');
  let username = getValue('#examine-username');
  if (username === undefined || username === '') {
    if (session) {
      username = session.getUser();
      $('#examine-username').val(username);
    }
  }
  getHistory(username);
});

$('#examine-go').on('click', (event) => {
  const username = getValue('#examine-username');
  getHistory(username);
});

$('#examine-username').on('change', () => {
  $('#history-table').html('');
});

$('#observe-go').on('click', (event) => {
  const username = getValue('#observe-username');
  session.send('obs ' + username);
});

function showGames(games: string) {
  if (!$('#pills-observe').hasClass('show')) {
    return;
  }
  for (const g of games.split('\n').slice(0, -2).reverse()) {
    const gg = g.trim();
    const id = gg.split(' ')[0];
    $('#games-table').append(
      `<button type="button" class="btn btn-outline-secondary" onclick="sessionSend('obs ` +
      + id + `'); showGameTab();">` + gg + `</button>`);
  }
}

$(document).on('shown.bs.tab', 'button[data-bs-target="#pills-observe"]', (e) => {
  $('#games-table').html('');
  if (session && session.isConnected()) {
    gamesRequested = true;
    session.send('games /bsl');
  }
});

$('#puzzlebot').on('click', (event) => {
  session.send('t puzzlebot getmate');
  $('#pills-game-tab').tab('show');
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
        `<button type="button" class="btn btn-outline-secondary" onclick="sessionSend('play ` +
        + key + `'); showGameTab();">` + value + `</button>`);
    });
  }
}