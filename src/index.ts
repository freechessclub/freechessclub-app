// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import * as Chess from 'chess.js';
import * as Cookies from 'js-cookie';
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

// pending takeback requests
let pendingTakeback = 0;

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

  board.set({
    turnColor: toColor(game.chess),
    movable,
  });
  board.playPremove();
  game.history.add(move, game.chess.fen());

  if (move.captured) {
    showCapturePiece(move.color, move.captured);
  }

  if (inCheck(move.san)) {
    board.set({
      check: true,
    });
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
  movePieceAfter(move);
}

function showStatusMsg(msg: string) {
  $('#game-status').html(msg + '<br/>');
  $('#left-panel').scrollTop(document.getElementById('left-panel').scrollHeight);
}

function showGameReq(type: string, title: string, msg: string, btnFailure: string[], btnSuccess: string[]) {
  let req = `
  <div class="card text-center mt-3" id="match-request">
    <p class="card-header p-0">` + type + ` Request</p>
    <div class="card-block p-2">
      <p class="card-title text-primary">` + title +
      `</p><p class="card-text">` + msg + `</p>`;

  if (btnSuccess !== undefined) {
    req += `<button type="button" id="` + btnSuccess[0] + `" class="btn btn-sm btn-outline-success mr-2">
        <span class="fa fa-check-circle-o" aria-hidden="false"></span> ` + btnSuccess[1] + `</button>`;
  }

  if (btnFailure !== undefined) {
    req += `<button type="button" id="` + btnFailure[0] + `" class="btn btn-sm btn-outline-danger">
        <span class="fa fa-times-circle-o" aria-hidden="false"></span> ` + btnFailure[1] + `</button>`;
  }

  req += `</div></div>`;
  $('#game-requests').html(req);
  $('#left-panel').scrollTop(document.getElementById('left-panel').scrollHeight);
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
        chat = new Chat(session.getUser());
        session.send('=ch');
      } else if (data.command === 2) {
        if (session.isConnected()) {
          session.disconnect();
        }
        session.reset(undefined);
        showStatusMsg(data.control);
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
        board.set({
          fen: game.chess.fen(),
          orientation: data.role === -1 ? 'black' : 'white',
          turnColor: 'white',
          movable: {
            free: false,
            dests: data.role === -1 || data.role === 1 ? toDests(game.chess) : undefined,
            color: movableColor,
            events: {
              after: movePiece,
            }
          }
        });
        game.history = new History(board);
        game.playerCaptured = {};
        game.oppCaptured = {};
        $('#player-captured').text('');
        $('#opponent-captured').text('');
        showStatusMsg('');
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
            const fen = data.fen + ' ' + (data.turn === 'W' ? 'w' : 'b') + ' KQkq - 0 1';
            const loaded = game.chess.load(fen);
            board.set({ fen: game.chess.fen() });
            game.history = new History(board);
            if (data.role === 2) {
              game.examine = true;
              $('#new-game').text('Unexamine game');
            } else {
              game.obs = true;
              $('#new-game').text('Unobserve game');
            }
            $('#new-game-menu').prop('disabled', true);
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
        if (data.move !== 'none') {
          const move = game.chess.move(data.move);
          if (move !== null) {
            movePieceAfter(move);
          } else {
            board.set({ fen: data.fen });
          }
        } else {
          board.set({ fen: data.fen });
          game.chess.reset();
        }
      }
      break;
    case MessageType.GameStart:
      const user = session.getUser();
      if (data.player_one === user) {
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
      break;
    case MessageType.Unknown:
    default:
      let takeBacker = null;
      let action = null;
      if (pendingTakeback) {
        let takebackMatches = data.message.match(/(\w+) (\w+) the takeback request\./);
        if (takebackMatches !== null && takebackMatches.length > 1) {
          takeBacker = takebackMatches[1];
          action = takebackMatches[2];
        } else {
          takebackMatches = data.message.match(/You (\w+) the takeback request from (\w+)\./);
          if (takebackMatches !== null && takebackMatches.length > 1) {
            takeBacker = takebackMatches[2];
            action = takebackMatches[1];
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

      const takebackReq = data.message.match(/(\w+) would like to take back (\d+) half move\(s\)\./);
      if (takebackReq != null && takebackReq.length > 1) {
        if (takebackReq[1] === $('#opponent-name').text()) {
          pendingTakeback = Number(takebackReq[2]);
          showGameReq('Takeback', takebackReq[1], 'would like to take back ' + takebackReq[2] + ' half move(s).',
            ['decline', 'Decline'], ['accept', 'Accept']);
        }
        return;
      }

      const gameCreateMsg =
        data.message.match(/(Creating|Game\s\d*): (\w+) \(([\d\+\-\s]{4})\) (\w+) \(([\d\-\+\s]{4})\).+/);
      if (gameCreateMsg != null && gameCreateMsg.length > 4) {
        if (gameCreateMsg[2] === session.getUser() || gameCreateMsg[1].startsWith('Game')) {
          if (!isNaN(gameCreateMsg[3])) {
            $('#player-rating').text(gameCreateMsg[3]);
          } else {
            $('#player-rating').text('');
          }
          if (!isNaN(gameCreateMsg[5])) {
            $('#opponent-rating').text(gameCreateMsg[5]);
          } else {
            $('#opponent-rating').text('');
          }
        } else if (gameCreateMsg[4] === session.getUser()) {
          if (!isNaN(gameCreateMsg[3])) {
            $('#opponent-rating').text(gameCreateMsg[3]);
          } else {
            $('#opponent-rating').text('');
          }
          if (!isNaN(gameCreateMsg[5])) {
            $('#player-rating').text(gameCreateMsg[5]);
          } else {
            $('#player-rating').text('');
          }
        }
        return;
      }

      const challengeMsg = data.message.match(
        // tslint:disable-next-line:max-line-length
        /Challenge: (\w+) \(([\d\+\-\s]{4})\) (\w+) \(([\d\-\+\s]{4})\)\s((?:.+[\.\r\n])+)You can "accept" or "decline", or propose different parameters./m);
      if (challengeMsg != null && challengeMsg.length > 3) {
        const [opponentName, opponentRating] = (challengeMsg[1] === session.getUser()) ?
          challengeMsg.slice(3, 5) : challengeMsg.slice(1, 3);
        showGameReq('Match', opponentName + '(' + opponentRating + ')',
          challengeMsg[5], ['decline', 'Decline'], ['accept', 'Accept']);
        return;
      }

      const abortMsg = data.message.match(
        /(\w+) would like to abort the game; type "abort" to accept./);
      if (abortMsg != null && abortMsg.length > 1) {
        if (abortMsg[1] === $('#opponent-name').text()) {
          showGameReq('Abort', abortMsg[1], 'would like to abort the game.',
            ['decline', 'Decline'], ['accept', 'Accept']);
        }
        return;
      }

      const drawMsg = data.message.match(
        /(\w+) offers you a draw./);
      if (drawMsg != null && drawMsg.length > 1) {
        if (drawMsg[1] === $('#opponent-name').text()) {
          showGameReq('Draw', drawMsg[1], 'offers you a draw.',
            ['decline', 'Decline'], ['accept', 'Accept']);
        }
        return;
      }

      const unobsMsg = data.message.match(/Removing game (\d+) from observation list./);
      if (unobsMsg != null && unobsMsg.length > 1) {
        $('#new-game').text('Start a new game');
        $('#new-game-menu').prop('disabled', false);
        clearInterval(game.wclock);
        clearInterval(game.bclock);
        delete game.chess;
        game.chess = null;
        game.obs = false;
      }

      const unexMsg = data.message.match(/You are no longer examining game (\d+)./);
      if (unexMsg != null && unexMsg.length > 1) {
        $('#new-game').text('Start a new game');
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
      }

      const chListMatches = data.message.match(/-- channel list: \d+ channels --(?:\n)([\d\s]*)/);
      if (chListMatches !== null && chListMatches.length > 1) {
        return chat.addChannels(chListMatches[1].split(/\s+/));
      }

      if (
        data.message === 'Style 12 set.' ||
        data.message === 'You will not see seek ads.' ||
        data.message === 'You will now hear communications echoed.'
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

$('body').on('click', '#accept', (event) => {
  session.send('accept');
  $('#game-requests').html('');
});

$('body').on('click', '#decline', (event) => {
  session.send('decline');
  $('#game-requests').html('');
});

$('body').on('click', '#close-request', (event) => {
  $('#game-requests').html('');
});

$('body').on('click', '#abort', (event) => {
  session.send('abort');
  $('#game-requests').html('');
});

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
      text = 't ' + tab + ' ' + val;
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
  if (user !== undefined && pass !== undefined) {
    session = new Session(messageHandler, user, atob(pass));
  } else {
    session = new Session(messageHandler);
  }

  $('#opponent-time').text('00:00');
  $('#player-time').text('00:00');
  $('.chat-text').height($('#board').height() - 85);
  $('#left-panel').height($('#board').height() - 90);
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
    showStatusMsg('You are not playing a game');
  }
});

$('#abort').on('click', (event) => {
  if (game.chess !== null) {
    session.send('abort');
  } else {
    showStatusMsg('You are not playing a game');
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
    showStatusMsg('You are not playing a game');
  }
});

$('#draw').on('click', (event) => {
  if (game.chess !== null) {
    session.send('draw');
  } else {
    showStatusMsg('You are not playing a game');
  }
});

function getGame(opponent: string, min: string, sec: string) {
  if (game.chess === null) {
    const cmd: string = (opponent !== '') ? 'match ' + opponent : 'seek';
    session.send(cmd + ' ' + min + ' ' + sec);
  }
}

$('#new-game').on('click', (event) => {
  if (game.chess === null) {
    session.send('getga');
  } else if (game.obs) {
    session.send('unobs');
  } else if (game.examine) {
    session.send('unex');
  }
});

$('#onezero').on('click', (event) => {
  getGame(getValue('#opponent-player-name'), '1', '0');
});

$('#threezero').on('click', (event) => {
  getGame(getValue('#opponent-player-name'), '3', '0');
});

$('#threetwo').on('click', (event) => {
  getGame(getValue('#opponent-player-name'), '3', '2');
});

$('#fivezero').on('click', (event) => {
  getGame(getValue('#opponent-player-name'), '5', '0');
});

$('#fivefive').on('click', (event) => {
  getGame(getValue('#opponent-player-name'), '5', '5');
});

$('#tenfive').on('click', (event) => {
  getGame(getValue('#opponent-player-name'), '10', '5');
});

$('#fifteenzero').on('click', (event) => {
  getGame(getValue('#opponent-player-name'), '15', '0');
});

$('#custom-control').on('click', (event) => {
  if (game.chess === null) {
    const min: string = getValue('#custom-control-min');
    const sec: string = getValue('#custom-control-sec');
    getGame(getValue('#opponent-player-name'), min, sec);
  }
});

$('#fast-backward').off('click');
$('#fast-backward').on('click', () => {
  if (game.examine) {
    game.chess.reset();
    game.history.removeAll();
    session.send('back 999');
  } else {
    game.history.beginning();
  }
});

$('#backward').off('click');
$('#backward').on('click', () => {
  if (game.examine) {
    game.chess.undo();
    game.history.removeLast();
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
  session.disconnect();
  session = null;
});

$('#login').on('click', (event) => {
  const user: string = getValue('#login-user');
  const pass: string = getValue('#login-pass');
  if (!session) {
    session = new Session(messageHandler, user, pass);
  } else {
    if (!session.isConnected()) {
      session.connect(user, pass);
    }
  }
  if ($('#remember-me').prop('checked')) {
    Cookies.set('user', user, { expires: 365 });
    Cookies.set('pass', btoa(pass), { expires: 365 });
  } else {
    Cookies.remove('user');
    Cookies.remove('pass');
  }
  $('#login-screen').modal('hide');
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

$('#connect-user').on('click', (event) => {
  if (session && session.isConnected()) {
    session.disconnect();
    session = null;
  }

  $('#login-screen').modal('show');
});

$('#connect-guest').on('click', (event) => {
  if (!session) {
    session = new Session(messageHandler);
  } else {
    if (!session.isConnected()) {
      session.connect();
    }
  }
});

$(window).on('resize', () => {
  $('.chat-text').height($('#board').height() - 85);
  $('#left-panel').height($('#board').height() - 90);
});

// prompt before unloading page if in a game
$(window).on('beforeunload', () => {
  if (game.chess) {
    return true;
  }
});
