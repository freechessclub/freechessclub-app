// Copyright 2022 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import Chess from 'chess.js';
import Cookies from 'js-cookie';
import { Chessground } from 'chessground';
import { Color, Key } from 'chessground/types';

import Chat from './chat';
import * as clock from './clock';
import game from './game';
import History from './history';
import { GetMessageType, MessageType, Session } from './session';
import * as Sounds from './sounds';
import './ui';

let session: Session;
let chat: Chat;

// toggle game sounds
let soundToggle: boolean = (Cookies.get('sound') !== 'false');

let pendingTakeback = 0;
let historyRequested = false;
let gamesRequested = false;
let movelistRequested = false;
let lobbyRequested = false;

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
  board.move(move.from, move.to);
  if (move.flags !== 'n') {
    board.set({ fen: game.chess.fen() });
  }

  let movable : any = {};
  if (game.examine) {
    movable = {
      color: 'both',
      dests: toDests(game.chess)
    };
  } else if (!game.obs) {
    movable = {
      color: game.color === 'w' ? 'white' : 'black',
      dests: toDests(game.chess)
    };
  }

  const check = inCheck(move.san);
  board.set({
    turnColor: toColor(game.chess),
    movable,
    check,
  });
  board.playPremove();
  game.history.add(move, game.chess.fen());

  if (move.captured) {
    showCapturePiece(move.color, move.captured);
  }

  if (check) {
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

  if (game.examine || game.chess.turn() === game.color) {
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
  let req = `
  <div class="toast" data-bs-autohide="false" role="status" aria-live="polite" aria-atomic="true">
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
  $('.toast').toast('show');
}

export function parseMovelist(movelist: string) {
  const moves = [];
  let found : string[] & { index?: number } = [''];
  let n = 1;
  const chess = Chess();
  while (found !== null) {
    found = movelist.match(new RegExp(n + '\\.\\s*(\\w*)\\s*(?:\\(\\d+:\\d+\\))\\s*(\\w*)\\s*(?:\\(\\d+:\\d+\\))?.*', 'm'));
    if (found !== null && found.length > 1) {
      const m1 = found[1].trim();
      moves.push({move: m1, fen: chess.fen()});
      chess.move(m1);
      if (found.length > 2 && found[2] !== null) {
        const m2 = found[2].trim();
        moves.push({move: m2, fen: chess.fen()});
        chess.move(m2);
      }
      n++;
      movelist += movelist[found.index];
    }
  }
  game.history.addPrev(moves);
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
      game.btime = data.black_time;
      game.wtime = data.white_time;
      game.moveNo = data.move_no;

      if (game.chess === null) {
        game.chess = Chess();
        let movableColor : any;
        if (data.role === -1) {
          movableColor = 'black';
        } else if (data.role === 1) {
          movableColor = 'white';
        } else if (data.role === 2) {
          movableColor = 'both';
        }

        const fen = data.fen + ' ' + (data.turn === 'W' ? 'w' : 'b') + ' KQkq - 0 1';
        const loaded = game.chess.load(fen);
        board.set({
          fen: game.chess.fen(),
          orientation: data.role === -1 ? 'black' : 'white',
          turnColor: 'white',
          movable: {
            free: false,
            dests: (data.role === -1 || data.role === 1 || data.role === 2) ? toDests(game.chess) : undefined,
            color: movableColor,
            events: {
              after: movePiece,
            }
          },
          blockTouchScroll: true,
        });
        game.history = new History(game.moveNo, board);
        if (game.moveNo > 1) {
          movelistRequested = true;
          session.send('moves ' + data.game_id);
        }
        game.playerCaptured = {};
        game.oppCaptured = {};
        $('#player-captured').text('');
        $('#opponent-captured').text('');
        $('#player-status').css('background-color', '');
        $('#opponent-status').css('background-color', '');

        // role 0: I am observing
        // role 1: I am playing and it is NOW my move
        if (data.role !== -1) {
          game.color = 'w';
          if (data.role !== 2 || data.role !== -2 || data.role !== -3) {
            game.wclock = clock.startWhiteClock(game, $('#player-time'));
            game.bclock = clock.startBlackClock(game, $('#opponent-time'));
          }
          $('#player-name').text(data.white_name);
          $('#opponent-name').text(data.black_name);
          if (data.role === undefined || data.role === 0 || data.role === 2 || data.role === -2) {
            if (data.role === 2) {
              game.examine = true;
              $('#new-game').text('Unexamine game');
            } else {
              game.obs = true;
              $('#new-game').text('Unobserve game');
              if (game.id === 0) {
                game.id = data.game_id;
              }
            }
            $('#new-game-menu').prop('disabled', true);
            $('#playing-game').hide();
            $('#pills-game-tab').tab('show');
          }
        // role -1: I am playing and it is NOW my opponent's move
        } else {
          game.color = 'b';
          game.bclock = clock.startBlackClock(game, $('#player-time'));
          game.wclock = clock.startWhiteClock(game, $('#opponent-time'));
          $('#player-name').text(data.black_name);
          $('#opponent-name').text(data.white_name);
        }
      }

      if (data.role === undefined || data.role >= 0) {
        let move = null;
        if (data.move !== 'none') {
          move = game.chess.move(data.move);
          if (move !== null) {
            movePieceAfter(move);
          }
        }
        if (data.move === 'none' || move === null) {
          const fen = data.fen + ' ' + (data.turn === 'W' ? 'w' : 'b') + ' KQkq - 0 1';
          const loaded = game.chess.load(fen);
          board.set({
            fen: data.fen,
          });

          if (!game.obs) {
            board.set({
              turnColor: data.turn === 'W' ? 'white' : 'black',
              movable: {
                color: data.turn === 'W' ? 'white' : 'black',
                dests: toDests(game.chess),
              },
            });
          }
        }
      }
      break;
    case MessageType.GameStart:
      $('#game-requests').empty();
      $('#playing-game').hide();
      $('#pills-game-tab').tab('show');
      const user = session.getUser();
      if (data.player_one === user) {
        chat.createTab(data.player_two);
      } else {
        chat.createTab(data.player_one);
      }
      game.id = +data.game_id;
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
      showModal('Match Request', '', data.message, examine, rematch);
      clearInterval(game.wclock);
      clearInterval(game.bclock);
      clearInterval(game.watchers);
      game.watchers = null;
      $('#game-watchers').empty();
      game.id = 0;
      delete game.chess;
      game.chess = null;
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
      let takeBacker = null;
      let action = null;
      let match = null;
      if (pendingTakeback) {
        match = msg.match(/(\w+) (\w+) the takeback request\./);
        if (match !== null && match.length > 1) {
          takeBacker = match[1];
          action = match[2];
        } else {
          match = msg.match(/You (\w+) the takeback request from (\w+)\./);
          if (match !== null && match.length > 1) {
            takeBacker = match[2];
            action = match[1];
          }
        }

        if (takeBacker !== null && action !== null) {
          if (takeBacker === $('#opponent-name').text()) {
            if (action.startsWith('decline')) {
              pendingTakeback = 0;
              return;
            }
            for (let i = 0; i < pendingTakeback; i++) {
              if (game.chess) {
                game.chess.undo();
              }
              if (game.history) {
                game.history.removeLast();
              }
            }
            pendingTakeback = 0;
            return;
          }
        }
      }

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
          pendingTakeback = Number(match[2]);
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
        showHistory(match[1], data.message);
        if (!historyRequested) {
          chat.newMessage('console', data);
        } else {
          historyRequested = false;
        }
        return;
      }

      match = msg.match(/^Movelist for game (\d+):.*/m);
      if (match != null && match.length > 1) {
        if (+match[1] === game.id) {
          parseMovelist(match[0]);
          if (!movelistRequested) {
            chat.newMessage('console', data);
          } else {
            movelistRequested = false;
          }

        }
        return;
      }

      match = msg.match(/Game\s\d+: \w+ backs up (\d+) moves?\./);
      if (match != null && match.length > 1) {
        const numMoves: number = +match[1];
        if (numMoves > game.history.length()) {
          if (game.chess) {
            game.chess.reset();
          }
          if (game.history) {
            game.history.removeAll();
          }
        } else {
          for (let i = 0; i < numMoves; i++) {
            if (game.chess) {
              game.chess.undo();
            }
            if (game.history) {
              game.history.removeLast();
            }
          }
        }
        return;
      }

      match = msg.match(/(Creating|Game\s(\d+)): (\w+) \(([\d\+\-\s]+)\) (\w+) \(([\d\-\+\s]+)\).+/);
      if (match != null && match.length > 4) {
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
        /Challenge: (\w+) \(([\d\+\-\s]{4})\) (\w+) \(([\d\-\+\s]{4})\)\s((?:.+[\.\r\n])+)You can "accept" or "decline", or propose different parameters./m);
      if (match != null && match.length > 3) {
        const [opponentName, opponentRating] = (match[1] === session.getUser()) ?
          match.slice(3, 5) : match.slice(1, 3);
        showModal('Match Request', opponentName + '(' + opponentRating + ')',
          match[5], ['decline', 'Decline'], ['accept', 'Accept']);
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
        $('#new-game').text('New game');
        $('#new-game-menu').prop('disabled', false);
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
        game.obs = false;
        return;
      }

      match = msg.match(/You are no longer examining game (\d+)./);
      if (match != null && match.length > 1) {
        $('#new-game').text('New game');
        $('#new-game-menu').prop('disabled', false);
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
        game.examine = false;
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
        msg.startsWith('No one is observing game ')
      ) {
        return;
      }

      chat.newMessage('console', data);
      break;
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
  } else if (cmd.length > 1 && cmd[0].startsWith('ta') && (/^\d+$/.test(cmd[1]))) {
    pendingTakeback = parseInt(cmd[1], 10);
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

  $('#opponent-time').text('00:00');
  $('#player-time').text('00:00');
  const boardHeight = $('#board').height();
  if (boardHeight) {
    $('.chat-text').height(boardHeight - 90);
    $('#left-panel').height(boardHeight - 152);
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
    if (game.chess.turn() === game.color) {
      pendingTakeback = 2;
      session.send('take 2');
    } else {
      pendingTakeback = 1;
      session.send('take 1');
    }
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
  } else if (game.obs) {
    session.send('unobs');
  } else if (game.examine) {
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
  if (game.examine) {
    session.send('back 999');
  } else {
    game.history.beginning();
  }
});

$('#backward').off('click');
$('#backward').on('click', () => {
  if (game.examine) {
    session.send('back');
  } else {
    game.history.backward();
  }
});

$('#forward').off('click');
$('#forward').on('click', () => {
  if (game.examine) {
    session.send('for');
  } else {
    game.history.forward();
  }
});

$('#fast-forward').off('click');
$('#fast-forward').on('click', () => {
  if (game.examine) {
    session.send('for 999');
  } else {
    game.history.end();
  }
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
  } else {
    Cookies.remove('proxy');
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
  const boardHeight = $('#board').height();
  if (boardHeight) {
    $('.chat-text').height(boardHeight - 90);
    $('#left-panel').height(boardHeight - 215);
  }
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