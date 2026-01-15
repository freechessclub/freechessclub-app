// Copyright 2023 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

// style sheets that need webpack file hashing and HMR 
import 'assets/css/application.css'; 

import { Chessground } from 'chessground';
import { Polyglot } from 'cm-polyglot/src/Polyglot.js';
import * as PgnParser from '@mliebelt/pgn-parser';
import NoSleep from '@uriopass/nosleep.js'; // Prevent screen dimming
import * as Utils from './utils';
import * as ChessHelper from './chess-helper';
import * as Dialogs from './dialogs';
import Tournaments from './tournaments';
import Users from './users';
import Chat from './chat';
import { Clock } from './clock';
import { Engine, EvalEngine } from './engine';
import { Game, GameData, Role, NewVariationMode, games } from './game';
import { History, HEntry } from './history';
import { GetMessageType, MessageType, Session } from './session';
import * as Sounds from './sounds';
import { storage, CredentialStorage, awaiting } from './storage';
import { settings } from './settings';
import { Reason } from './parser';
import { getShortcuts } from './ui';
import './ui';
import packageInfo from '../../package.json';

export const enum Layout {
  Desktop = 0,
  Mobile,
  ChatMaximized
}

// The game categories (variants) that we support independantly of FICS, i.e. for offline analysis
// Currently the only FICS variants we don't support are Atomic and Suicide
// For unsupported categories, chess.js and toDests() are not used, the board is put into 'free' mode,
// and a move is not added to the move list unless it is verified by the server.
const SupportedCategories = ['blitz', 'lightning', 'untimed', 'standard', 'nonstandard', 'crazyhouse', 'bughouse', 'losers', 'wild/fr', 'wild/0', 'wild/1', 'wild/2', 'wild/3', 'wild/4', 'wild/5', 'wild/8', 'wild/8a'];

let session: Session;
let chat: Chat;
let tournaments: Tournaments;
let users: Users;
let engine: Engine | null;
let evalEngine: EvalEngine | null;
let playEngine: Engine | null;
let userVariables: any = {};
let pendingTells: any[] = [];
let gameExitPending = [];
let examineModeRequested: Game | null = null;
let mexamineRequested: Game | null = null;
let mexamineGame: Game | null = null;
let rematchUser = '';
let computerList = [];
let oldEngineName: string = '';
let oldEngineMaxTime: number;
let oldEngineThreads: number;
let oldEngineMemory: number;
let lastOpponent: string = ''; // The opponent of the current or last game played 
let prevSizeCategory = null;
let layout = Layout.Desktop;
let keepAliveTimer; // Stop FICS auto-logout after 60 minutes idle
let soundTimer;
let showSentOffersTimer; // Delay showing new offers until the user has finished clicking buttons
let activeTab;
let newTabShown = false;
let newGameVariant = '';
const lobbyEntries = new Map();
let lobbyScrolledToBottom;
const noSleep = new NoSleep(); // Prevent screen dimming
let openings; // Opening names with corresponding moves
let fetchOpeningsPromise = null;
let book; // Opening book used in 'Play Computer' mode
let isRegistered = false;
let lastComputerGame = null; // Attributes of the last game played against the Computer. Used for Rematch and alternating colors each game.
let partnerGameId = null;
let lastPointerCoords = {x: 0, y: 0}; // Stores the pointer coordinates from the last touch/mouse event
let credential: CredentialStorage = null; // The persistently stored username/password
let gameListVirtualScroller = null;
const mainBoard: any = createBoard($('#main-board-area').children().first().find('.board'));

/**
 * Used to call session.send() from inline JS.
 */
(window as any).sessionSend = (cmd: string) => {
  session.send(cmd);
};

/** *********************************************
 * INITIALIZATION AND TOP LEVEL EVENT LISTENERS *
 ************************************************/

// Stop browser trying to restore scroll position after refresh
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

jQuery(() => {
  if ((window as any).cordova !== undefined) {
    document.addEventListener('deviceready', onDeviceReady, false);
  } else {
    onDeviceReady();
  }
});

async function onDeviceReady() {
  cleanup();

  await storage.init();
  initSettings();


  chat = new Chat();
  tournaments = new Tournaments();
  users = new Users();
  
  const game = createGame();
  game.role = Role.NONE;
  game.category = 'untimed';
  game.history = new History(game);
  setGameWithFocus(game);

  // Initialize popovers
  $('[data-bs-toggle="popover"]').popover();

  bootstrap.Collapse.getOrCreateInstance($('#collapse-menus')[0], { toggle: false });
  bootstrap.Collapse.getOrCreateInstance($('#collapse-chat')[0], { toggle: false });
  
  if(Utils.isSmallWindow()) {
    $('#collapse-chat').collapse('hide');
    $('#collapse-menus').collapse('hide');
    setViewModeList();
  }
  else {
    Utils.createTooltips();
    showAnalyzeButton();
    $('#pills-play-tab').tab('show');
    $('#collapse-menus').removeClass('collapse-init');
    $('#collapse-chat').removeClass('collapse-init');
    $('#chat-toggle-btn').toggleClass('toggle-btn-selected');
    $('body').removeClass('chat-hidden');
  }

  $('input, [data-select-on-focus]').each(function() {
    Utils.selectOnFocus($(this));
  });

  // Change layout for mobile or desktop and resize panels
  // Split it off into a timeout so that onDeviceReady doesn't take too long.
  setTimeout(() => { 
    $(window).trigger('resize'); 
    $('#left-panel-header').css('visibility', 'visible');
    $('#right-panel-header').css('visibility', 'visible');
  }, 0);

  Utils.initDropdownSubmenus();

  credential = new CredentialStorage();
  if(settings.rememberMeToggle) {
     // Get the username/password from secure storage (if the user has previously ticked Remember Me)
    credential.retrieve().then(() => {
      if(credential.username != null && credential.password != null) 
        session = new Session(messageHandler, credential.username, credential.password);
      else 
        session = new Session(messageHandler);
    });
  }
  else {
    $('#login-user').val('');
    $('#login-pass').val('');
    session = new Session(messageHandler);
  }
}

$(window).on('load', async () => {
  if('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
    navigator.serviceWorker.register(`./service-worker.js?env=${Utils.isCapacitor() || Utils.isElectron() ? 'app' : 'web'}`)
      .then((registration) => {  
        navigator.serviceWorker.ready.then(preload); // Fetch assets into the run-time cache

        if(navigator.serviceWorker.controller) { // Check this is an update and not first time install       
          // If service worker is updated (due to files changing) then refresh the page so new files are loaded.
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
          });
        }
      });
  }
});

/** Preload assets into the run-time cache */
function preload() {
  // Pre-fetch Stockfish from the CDN
  Engine.load(settings.analyzeEngineName).catch(err => {}); 
}

/** Prompt before unloading page if in a game */
$(window).on('beforeunload', () => {
  const game = games.getPlayingExaminingGame();
  if(game && game.isPlaying())
    return true;
});

// Prevent screen dimming, must be enabled in a user input event handler
$(document).one('click', () => {
  if(settings.wakelockToggle) {
    noSleep.enable();
  }
});

// Used to keep track of the mouse coordinates for displaying menus at the mouse
$(document).on('mouseup mousedown touchend touchcancel', (event) => {
  lastPointerCoords = Utils.getTouchClickCoordinates(event);
});
document.addEventListener('touchstart', (event) => {
  lastPointerCoords = Utils.getTouchClickCoordinates(event);
}, {passive: true});

// Hide popover if user clicks anywhere outside
$('body').on('click', (e) => {
  if(!$('#rated-unrated-menu').is(e.target)
      && $('#rated-unrated-menu').has(e.target).length === 0
      && $('.popover').has(e.target).length === 0)
    $('#rated-unrated-menu').popover('dispose');
});

$(document).on('keydown', (e) => {
  if(e.key === 'Enter') {
    const blurElement = $(e.target).closest('.blur-on-enter');
    if(blurElement.length) {
      blurElement.trigger('blur');
      e.preventDefault();
      return;
    }
  }

  if(e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if($(e.target).closest('.modal, textarea, [contenteditable]')[0]) 
      return;
    
    const inputElem = $(e.target).closest('input');
    const textInputTypes = ['text', 'password', 'email', 'search', 'tel', 'url', 'number'];
    if(inputElem.length && textInputTypes.includes(inputElem.attr('type')))
      return;

    if(e.key === 'ArrowLeft')
      backward();

    else if(e.key === 'ArrowRight')
      forward();

    e.preventDefault();
  }
});

/** Handle keyboard shortcuts */
$(document).on("keydown", (e) => {
  const user = session?.getUser() || '';
  const gameID = games.getPlayingExaminingGame()?.id.toString() || '';
  const shortcuts = getShortcuts();
  shortcuts.forEach(shortcut => {
    if(e.code === shortcut.code 
        && e.ctrlKey === shortcut.ctrlKey
        && e.metaKey === shortcut.metaKey
        && e.shiftKey === shortcut.shiftKey
        && e.altKey === shortcut.altKey) {
      const commands = shortcut.commands;
      if(commands) {
        e.preventDefault(); // prevent default browser behavior
        commands.forEach((c: string) => {
          c = c.replace(/%user%/gi, user);
          c = c.replace(/%opponent%/gi, lastOpponent);
          c = c.replace(/%game%/gi, gameID);
          (window as any).sessionSend(c);
        });
      }
    }
  });    
});

/**
 * Fix scroll position when focusing input-text on mobile.
 * When the on-screen keyboard pops up, the scroll position gets incorrectly changed
 */
let lastViewPortHeight = window.visualViewport.height;
let inputTextFocused = false;
window.visualViewport.addEventListener('resize', () => {
  const newHeight = window.visualViewport.height;
  const heightDiff = newHeight - lastViewPortHeight;
  if(Utils.isSmallWindow()) {
    if(heightDiff < -100) {
      setTimeout(() => {
        if($('#input-text').is(':focus')) {
          inputTextFocused = true;
          $('body').css('padding-bottom', 0);   
          setTimeout(() => {
            $('#right-panel-footer')[0].scrollIntoView({ behavior: 'instant', block: 'end' });
          }, 0);
        }
      }, 50);  
    }  
    else if(heightDiff > 100) {
      if(inputTextFocused) {
        inputTextFocused = false;
        $('body').css('padding-bottom', '');
        setRightColumnSizes();
        setTimeout(() => {
          $(document.scrollingElement).scrollTop(document.scrollingElement.scrollHeight);
        }, 50);
      }
    }
  }
  lastViewPortHeight = newHeight;
});

/**
 * Temporary fix for a bug in bootstrap when closing modals. Bootstrap sets aria-hidden on the modal
 * before removing focus from it, which causes warnings in Dev tools
 */
$(document).on('hide.bs.modal', '.modal', () => {
  $(document.activeElement).trigger('blur');
});

/** Cancel multiple premoves on right click */
$(document).on('mousedown', '.board', (event) => {
  if(event.button === 2) {
    const element = $(event.target).closest('.game-card');
    for(const g of games) {
      if(g.element.is(element) && g.premoves.length) {
        cancelMultiplePremoves(g);
        updateBoard(g, false, true, false);
      }
    }  
  }
});

/**
 * Override console.log in order to suppress annoying messages from node modules
 */
// eslint-disable-next-line no-console
const originalConsoleLog = console.log;
// eslint-disable-next-line no-console
console.log = (...args) => {
  const annoyingMessages = [
    'Wake Lock active.',
    'Wake Lock released.'
  ];

  if(args.some(arg => annoyingMessages.includes(arg)))
    return;

  originalConsoleLog.apply(console, args);
}

/** ****************************
 * RESIZE AND LAYOUT FUNCTIONS *
 *******************************/

$(window).on('resize', () => {
  if(!$('#mid-col').is(':visible'))
    layout = Layout.ChatMaximized;
  else if(layout === Layout.ChatMaximized)
    layout = Layout.Desktop;

  if(Utils.isSmallWindow() && layout === Layout.Desktop)
    useMobileLayout();
  else if(!Utils.isSmallWindow() && layout === Layout.Mobile)
    useDesktopLayout();

  setPanelSizes();
  updateBoardStatusText();

  prevSizeCategory = Utils.getSizeCategory();

  if(evalEngine)
    evalEngine.redraw();
});

function setPanelSizes() {
  // Reset player status panels that may have been previously slimmed down on single column screen
  const maximizedGame = games.getMainGame();
  const maximizedGameCard = maximizedGame.element;
  const topPanel = maximizedGameCard.find('.top-panel');
  const bottomPanel = maximizedGameCard.find('.bottom-panel');

  if(!Utils.isSmallWindow() && prevSizeCategory === Utils.SizeCategory.Small) {
    topPanel.css('height', '');
    bottomPanel.css('height', '');
  }

  // Make sure the board is smaller than the window height and also leaves room for the other columns' min-widths
  if(!Utils.isSmallWindow()) {
    const scrollBarWidth = Utils.getScrollbarWidth();
    const scrollBarVisible = (window.innerWidth - window.visualViewport.width) > 1;
    const scrollBarReservedArea = (scrollBarVisible ? 0 : scrollBarWidth);
    const viewportWidth = window.visualViewport.width;

    // Set board width a bit smaller in order to leave room for a scrollbar on <body>. This is because
    // we don't want to resize all the panels whenever a dropdown or something similar overflows the body.
    const rightColWidth = ($('#right-col').is(':visible') && !$('body').hasClass('chat-hidden'))
      ? parseFloat($('#right-col').css('min-width')) : 0;
    const cardMaxWidth = Utils.isMediumWindow() // display 2 columns on md (medium) display
      ? viewportWidth - $('#left-col').outerWidth() - scrollBarReservedArea
      : viewportWidth - $('#left-col').outerWidth() - rightColWidth - scrollBarReservedArea;

    const cardMaxHeight = $(window).height() - Utils.getRemainingHeight(maximizedGameCard);
    setGameCardSize(maximizedGame, cardMaxWidth, cardMaxHeight);
  }
  else
    setGameCardSize(maximizedGame);

  // Set the height of dynamic elements inside left and right panel collapsables.
  // Try to do it in a robust way that won't break if we add/remove elements later.

  // On mobile, slim down player status panels in order to fit everything within window height
  if(Utils.isSmallWindow()) {
    const originalStatusHeight = $('#left-panel-header').height();
    const cardBorders = maximizedGameCard.outerHeight() - maximizedGameCard.height()
      + Math.round(parseFloat($('#left-card').css('border-bottom-width')))
      + Math.round(parseFloat($('#right-card').css('border-top-width')));
    const playerStatusBorder = maximizedGameCard.find('.top-panel').outerHeight() - maximizedGameCard.find('.top-panel').height();
    const safeAreas = $('body').innerHeight() - $('body').height();
    let playerStatusHeight = ($(window).height() - safeAreas - $('#board-card').outerHeight(true) - $('#left-panel-footer').outerHeight() - $('#right-panel-header').outerHeight() - cardBorders) / 2 - playerStatusBorder;
    playerStatusHeight = Math.min(Math.max(playerStatusHeight, originalStatusHeight - 20), originalStatusHeight);

    topPanel.height(playerStatusHeight);
    bottomPanel.height(playerStatusHeight);
  }

  // These variables are used to resize status panel elements based on the width / height of the panel using CSS
  topPanel.css('--panel-height', topPanel.css('height'));
  topPanel.css('--panel-width', topPanel.css('width'));
  bottomPanel.css('--panel-height', bottomPanel.css('height'));
  bottomPanel.css('--panel-width', bottomPanel.css('width'));

  setLeftColumnSizes();
  setRightColumnSizes();

  // Adjust Notifications drop-down width
  if(Utils.isSmallWindow())
    $('#notifications').css('width', '100%');
  else if(Utils.isMediumWindow() || !$('#collapse-chat').hasClass('show'))
    $('#notifications').css('width', '50%');
  else if(Utils.isLargeWindow())
    $('#notifications').width($(document).outerWidth(true) - $('#left-col').outerWidth(true) - $('#mid-col').outerWidth(true));
}

function setLeftColumnSizes() {
  const boardHeight = $('#main-board-area .board').innerHeight();

  // set height of left menu panel inside collapsable
  if (boardHeight) {
    if($('#left-panel').height() === 0)
      $('#left-panel-bottom').css('height', '');

    if(Utils.isSmallWindow())
      $('#left-panel').css('height', ''); // Reset back to CSS defined height
    else {
      const remHeight = Utils.getRemainingHeight($('#left-panel'), $('#inner-left-panels'));
      const leftPanelBorder = $('#left-panel').outerHeight(true) - $('#left-panel').height();
      const leftPanelHeight = boardHeight - remHeight - leftPanelBorder;
      $('#left-panel').height(Math.max(leftPanelHeight, 0));
      // If we've made the left panel height as small as possible, reduce size of status panel instead
      // Note leftPanelHeight is negative in that case
      if(leftPanelHeight < 0)
        $('#left-panel-bottom').height($('#left-panel-bottom').height() + leftPanelHeight);
    }
  }
}

function setGameCardSize(game: Game, cardMaxWidth?: number, cardMaxHeight?: number, useRoundingCorrection = true) {
  const card = game.element;
  let boardWidth: number;
  
  let roundingCorrection = (card.hasClass('game-card-sm') ? 0.032 : 0.1);

  const remainingWidth = Utils.getRemainingWidth(card.find('.board-container'), card);
  const remainingHeight = Utils.getRemainingHeight(card.find('.board-container'), card);

  if(cardMaxWidth !== undefined || cardMaxHeight !== undefined) {
    let boardMaxWidth = cardMaxWidth - remainingWidth;
    let boardMaxHeight = cardMaxHeight - remainingHeight;

    if(!cardMaxWidth)
      boardMaxWidth = boardMaxHeight;
    if(!cardMaxHeight)
      boardMaxHeight = boardMaxWidth;

    boardWidth = Math.min(boardMaxWidth, boardMaxHeight) - (useRoundingCorrection ? roundingCorrection : 0);
  }
  else {
    card.css('width', '');
    boardWidth = card.width() - remainingWidth;
  }

  // Recalculate the width of the board so that the squares align to integer pixel boundaries, this is to match
  // what chessground does internally
  boardWidth = (Math.floor((boardWidth * window.devicePixelRatio) / 8) * 8) / window.devicePixelRatio + roundingCorrection;

  const cardWidth = boardWidth + remainingWidth;
  const cardHeight = boardWidth + remainingHeight;

  // Set card width
  const cardBorderWidth = card.outerWidth() - card.width();
  card.width(cardWidth - cardBorderWidth);
  game.board.redrawAll();

  return { width: cardWidth, height: cardHeight }
}

function setRightColumnSizes() {
  const chatVisible = !$('body').hasClass('chat-hidden') && $('#collapse-chat').hasClass('show');
  const boardHeight = $('#main-board-area .board').innerHeight();

  // Set chat panel height to 0 before resizing everything so as to remove scrollbar on window caused by chat overflowing
  if(Utils.isLargeWindow() && chatVisible)
    $('#chat-panel').height(0);

  // Set width and height of game cards in the right board area
  const numCards = $('#secondary-board-area').children().length;
  if(numCards > 2)
    $('#secondary-board-area').css('overflow-y', 'scroll');
  else
    $('#secondary-board-area').css('overflow-y', 'hidden');

  let boardAreaHeight = 0;
  if(numCards > 0) {
    const cardsPerRow = Utils.isLargeWindow() ? Math.min(2, numCards) : 2;
    const cardHeight = Utils.isLargeWindow() ? boardHeight * 0.6 : null;
    const boardAreaScrollbarWidth = $('#secondary-board-area')[0].offsetWidth - $('#secondary-board-area')[0].clientWidth;
    const innerWidth = $('#secondary-board-area').width() - boardAreaScrollbarWidth - 1;
    const cardWidth = innerWidth / cardsPerRow - parseInt($('#secondary-board-area').css('gap'), 10) * (cardsPerRow - 1) / cardsPerRow;

    // Set the size of any card with an eval bar showing first, and its sibling on the same row (to match heights)
    let evalGame = null;
    let evalGameAdjacent = null;
    if(isSecondaryBoard(games.focused)) {
      const evalCard = games.focused.element;
      const evalBar = evalCard.find('.eval-bar');
      const index = evalCard.index();
      const adjacentCard = (index % 2 === 0 ? evalCard.next() : evalCard.prev());
      if(evalBar.is(':visible') && adjacentCard.length) {
        evalGame = games.focused;
        evalGameAdjacent = Array.from(games).find(g => g.element.is(adjacentCard));
        const evalBarCardWidth = cardWidth + evalBar.outerWidth() / 2; // Add some more width since the eval bar will cause the board to be smaller
        boardAreaHeight = setGameCardSize(evalGame, evalBarCardWidth, cardHeight).height;
        setGameCardSize(evalGameAdjacent, evalBarCardWidth, boardAreaHeight, false); // Last parameter is false in order to match heights exactly
      }
    }

    // Set the size of the other secondary game cards
    for(const game of games) {
      if(isSecondaryBoard(game) && game !== evalGame && game !== evalGameAdjacent)
        boardAreaHeight = setGameCardSize(game, cardWidth, cardHeight).height; 
    }
  }

  for(const game of games) {
    if(isSecondaryBoard(game)) {
      // These variables are used to resize status panel elements based on the width / height of the panel
      const topPanel = game.element.find('.top-panel');
      topPanel.css('--panel-height', topPanel.css('height'));
      topPanel.css('--panel-width', topPanel.css('width'));
      const bottomPanel = game.element.find('.bottom-panel');
      bottomPanel.css('--panel-height', bottomPanel.css('height'));
      bottomPanel.css('--panel-width', bottomPanel.css('width'));
    }
  }

  if(Utils.isSmallWindow())
    $('#secondary-board-area').css('height', '');
  else
    $('#secondary-board-area').height(boardAreaHeight);

  if(chatVisible) {
    if(!Utils.isLargeWindow() || !boardHeight) {
      const hasSiblings = $('#collapse-chat').siblings(':visible').length > 0; // If there are game boards in the right column, then don't try to fit the header and chat into the same screen height
      const border = $('#chat-panel').outerHeight(true) - $('#chat-panel').height();
      $('#chat-panel').height($(window).height() - Utils.getRemainingHeight($('#chat-panel'), $('body'), `#collapse-chat ${hasSiblings ? ', #inner-right-panels' : ''}`) - border);
    }
    else {
      const remHeight = Utils.getRemainingHeight($('#chat-panel'), $('#inner-right-panels'));
      const chatPanelBorder = $('#chat-panel').outerHeight(true) - $('#chat-panel').height();
      $('#chat-panel').height(boardHeight + $('#left-panel-footer').outerHeight() - remHeight - chatPanelBorder);
    }

    adjustInputTextHeight();
    if(chat)
      chat.fixScrollPosition();
  }
}

function calculateFontSize(container: any, containerMaxWidth: number, minWidth?: number, maxWidth?: number) {
  if(minWidth === undefined)
    minWidth = +$('body').css('font-size').replace('px', '');
  if(maxWidth === undefined)
    maxWidth = +container.css('font-size').replace('px', '');

  const fontFamily = container.css('font-family');
  const fontWeight = container.css('font-weight');

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  const getTextWidth = (text, font) => {
    context.font = font;
    const metrics = context.measureText(text);
    return metrics.width;
  }

  let fontSize = maxWidth + 1; // Initial font size
  let textWidth: number;
  do {
    fontSize--;
    textWidth = getTextWidth(container.text(), `${fontWeight} ${fontSize}px ${fontFamily}`);
  } while (textWidth > containerMaxWidth && fontSize > minWidth);
  return fontSize;
}

// If on small screen device displaying 1 column, move the navigation buttons so they are near the board
function useMobileLayout() {
  swapLeftRightPanelHeaders();
  moveLeftPanelSetupBoard();

  $('#chat-toggle-btn').removeAttr('data-bs-toggle');

  $('#viewing-games-buttons:visible:last').removeClass('me-0');
  $('#stop-observing').appendTo($('#viewing-game-buttons').last());
  $('#stop-examining').appendTo($('#viewing-game-buttons').last());
  $('#viewing-games-buttons:visible:last').addClass('me-0'); // This is so visible buttons in the btn-toolbar center properly
  hidePanel('#left-panel-header-2');
  $('#input-text').attr('placeholder', 'Type message here and press Enter');

  Utils.createTooltips();
  layout = Layout.Mobile;
}

function useDesktopLayout() {
  swapLeftRightPanelHeaders();
  moveLeftPanelSetupBoard();

  $('#chat-toggle-btn').attr('data-bs-toggle', 'dropdown');
  
  $('#stop-observing').appendTo($('#left-panel-header-2').last());
  $('#stop-examining').appendTo($('#left-panel-header-2').last());
  if(games.focused.isObserving() || games.focused.isExamining())
    showPanel('#left-panel-header-2');
  $('#input-text').attr('placeholder', 'Type message here and press Enter to send!');

  Utils.createTooltips();
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

  if(Utils.isSmallWindow()) 
    $('#chat-toggle-btn').parent().appendTo($('#chat-collapse-toolbar').last());
  else
    $('#chat-toggle-btn').parent().appendTo($('#right-panel-header .btn-toolbar').last());
}

/** ******************************************
 * MAIN MESSAGE PUMP                         *
 * Process messages received from the server *
 *********************************************/
function messageHandler(data: any) {
  if(data == null)
    return;

  const type = GetMessageType(data);
  switch (type) {
    case MessageType.Control:
      if(data.command === 1 && !session.isConnected()) { // Connected
        session.setUser(data.control);
        session.send('set seek 0');
        session.send('set echo 1');
        session.send('set style 12');
        session.send(`set interface Free Chess Club (${packageInfo.version})`);
        session.send('iset defprompt 1'); // Force default prompt. Used for splitting up messages
        session.send('iset nowrap 1'); // Stop chat messages wrapping which was causing spaces to get removed erroneously
        session.send('iset pendinfo 1'); // Receive detailed match request info (both that we send and receive)
        session.send('iset ms 1'); // Style12 receives clock times with millisecond precision
        session.send('=ch');
        awaiting.set('channel-list');
        session.send('=computer'); // get Computers list, to augment names in Observe panel
        awaiting.set('computer-list');
        session.send('variables'); // Get user's variables (mostly for tzone)
        awaiting.set('user-variables');
        session.send('date'); // Get the server's timezone for time conversions
        awaiting.set('date');
        chat.connected(data.control);
        tournaments.connected(session);

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

        keepAliveTimer = setInterval(() => {
          awaiting.set('ping');
          session.send('ping');  
        }, 59 * 60 * 1000);

        session.sendPostConnectCommands();
        $('#sign-in-alert').removeClass('show');

        users.connected(session, chat);

        settings.visited = true;
        storage.set('visited', String(settings.visited)); 
      }
      else if(data.command === 2) { // Login error
        session.disconnect();
        $('#session-status').popover({
          animation: true,
          content: data.control,
          placement: 'top',
        });
        $('#session-status').popover('show');
      }
      else if(data.command === 3) { // Disconnected
        cleanup();
        const panelHtml = `<div class="not-signed-in-notice">Not signed in. <a href="javascript:void(0)">Sign in</a></div>`;
        $('#chat-panel .nav-tabs').append(panelHtml);
        $('#pills-lobby').append(panelHtml);
        $('#pills-tournaments').append(panelHtml);
        $('.not-signed-in-notice a').one('click', () => {
          session?.reconnect();
        });
        $('#sign-in-alert').removeClass('show');
      }
      else if(data.command === 4) { // Connecting
        $('#game-requests').empty();
        $('.not-signed-in-notice').remove();
      }
      break;
    case MessageType.ChannelTell:
      chat.newMessage(data.channel, data);
      break;
    case MessageType.PrivateTell:
      chat.newMessage(data.user, data);
      break;
    case MessageType.Messages:
      if(data.type === 'online') // message received while online, put it immediately into a chat tab 
        chat.newMessage(data.messages[0].user, data.messages[0]);
      else if(data.type === 'unread' && awaiting.resolve('unread-messages')) {
        data.messages.forEach(msg => chat.newMessage(msg.user, msg));
        if($('#collapse-chat').hasClass('show'))
          chat.scrollToChat();
        else
          $('#collapse-chat').collapse('show');
        chat.showTab(data.messages[0].user);
        return;
      }
      chat.newMessage('console', { message: data.raw });
      break;
    case MessageType.GameMove:
      gameMove(data);
      break;
    case MessageType.GameStart:
      break;
    case MessageType.GameEnd:
      gameEnd(data);
      break;
    case MessageType.GameHoldings:
      const game = games.findGame(data.game_id);
      if(!game)
        return;
      game.history.current().variantData.holdings = data.holdings;
      showCapturedMaterial(game);
      break;
    case MessageType.Offers:
      handleOffers(data.offers);
      if(data.raw) 
        chat.newMessage('console', { message: data.raw });
      break;
    case MessageType.Unknown:
    default:
      handleMiscMessage(data);
      break;
  }
}

function gameMove(data: any) {
  if(gameExitPending.includes(data.id))
    return;

  let game: Game;

  // If in single-board mode, check we are not examining/observing another game already
  if(!settings.multiboardToggle) {
    game = games.getMainGame();
    if(game.isPlayingOnline() && game.id !== data.id) {
      if(data.role === Role.OBSERVING || data.role === Role.OBS_EXAMINED)
        session.send(`unobs ${data.id}`);
      return;
    }
    else if((game.isExamining() || game.isObserving()) && game.id !== data.id) {
      if(game.isExamining()) {
        session.send('unex');
      }
      else if(game.isObserving())
        session.send(`unobs ${game.id}`);

      if(data.role === Role.PLAYING_COMPUTER)
        cleanupGame(game);
      else {
        gameExitPending.push(game.id);
        return;
      }
    }
    else if(game.role === Role.PLAYING_COMPUTER && data.role !== Role.PLAYING_COMPUTER)
      cleanupGame(game); // Allow player to imemediately play/examine/observe a game at any time while playing the Computer. The Computer game will simply be aborted.
  }

  let prevRole: number;
  if((examineModeRequested || mexamineRequested) && data.role === Role.EXAMINING) {
    // Converting a game to examine mode
    game = examineModeRequested || mexamineRequested;
    if(game.role !== Role.NONE && settings.multiboardToggle)
      game = cloneGame(game);
    game.id = data.id;
    if(!game.wname)
      game.wname = data.wname;
    if(!game.bname)
      game.bname = data.bname;
    game.role = Role.EXAMINING;
    if(examineModeRequested)
      game.flip = false;
  }
  else {
    if(settings.multiboardToggle) {
      // Get game object
      game = games.findGame(data.id);
      if(!game)
        game = games.getFreeGame();
      if(!game)
        game = createGame();
    }

    prevRole = game.role;
    Object.assign(game, data);
  }

  // New game
  if(examineModeRequested || mexamineRequested || prevRole === Role.NONE)
    gameStart(game);

  // Make move
  if(game.setupBoard && !game.commitingMovelist) {
    updateSetupBoard(game, game.fen, true);
  }
  else if(game.role === Role.NONE || game.role >= -2 || game.role === Role.PLAYING_COMPUTER) {
    // This is to allow multiple fast 'forward' or 'back' button presses in examine mode before the command reaches the server
    if(game.pendingMoves.length) {
      const lastPending = game.pendingMoves.shift();

      if(lastPending.fen === game.fen) { // Expected move so ignore it
        game.restoreMove = lastPending;
        if(game.removeMoveRequested && !game.pendingMoves.length) {
          if(!game.history.current().isPredecessor(game.removeMoveRequested)) {
            game.history.remove(game.removeMoveRequested);
            if(game === games.focused && !game.history.hasSubvariation())
              $('#exit-subvariation').hide();
          }
          game.removeMoveRequested = null;
        }
        return;
      }
      game.history.goto(game.restoreMove); // Unexpected move from server, roll back pending moves
      game.pendingMoves = [];
      game.removeMoveRequested = null; // Cancel move removal because we were interrupted while trying to leave line being removed
    }

    const lastFen = currentGameMove(game).fen;
    const lastPly = ChessHelper.getPlyFromFEN(lastFen);
    const thisPly = ChessHelper.getPlyFromFEN(game.fen);

    if(game.move !== 'none' && thisPly === lastPly + 1) { // make sure the move no is right
      const parsedMove = parseGameMove(game, lastFen, game.move);
      movePieceAfter(game, (parsedMove ? parsedMove.move : game.moveVerbose), game.fen, true);
    }
    else
      updateHistory(game, null, game.fen, true);

    hitClock(game, true);
  }
}

function gameStart(game: Game) {
  hidePromotionPanel(game);
  game.board.cancelMove();
  if(game === games.focused && (!game.history || !game.history.hasSubvariation()))
    $('#exit-subvariation').hide();

  // for bughouse set game.color of partner to opposite of us
  const mainGame = games.getPlayingExaminingGame();
  const partnerColor = (mainGame && mainGame.partnerGameId === game.id && mainGame.color === 'w' ? 'b' : 'w');

  // Determine the player's color
  const amIwhite = game.wname === session.getUser();
  const amIblack = (game.role === Role.PLAYING_COMPUTER && game.color === 'b') || game.bname === session.getUser();

  if((!amIblack || amIwhite) && partnerColor !== 'b')
    game.color = 'w';
  else
    game.color = 'b';

  if(game.isPlayingOnline()) {
    lastOpponent = game.color === 'w' ? game.bname : game.wname;
  }

  // Set game board text
  const whiteStatus = game.element.find('.white-status');
  const blackStatus = game.element.find('.black-status');
  whiteStatus.find('.name').text(game.wname.replace(/_/g, ' '));
  blackStatus.find('.name').text(game.bname.replace(/_/g, ' '));
  if(!game.wrating)
    whiteStatus.find('.rating').text('');
  if(!game.brating)
    blackStatus.find('.rating').text('');

  if(game.isPlayingOnline() || game.isExamining() || game.isObserving()) {
    let gameType: string;
    if(game.isPlayingOnline())
      gameType = 'Playing';
    else if(game.isExamining())
      gameType = 'Examining';
    else if(game.isObserving())
      gameType = 'Observing';
    game.element.find('.title-bar-text').text(`Game ${game.id} (${gameType})`);
    const gameStatus = game.statusElement.find('.game-status');
    if(gameStatus.text())
      gameStatus.prepend(`<span class="game-id">Game ${game.id}: </span>`);
  }
  else if(game.role === Role.PLAYING_COMPUTER)
    game.element.find('.title-bar-text').text('Computer (Playing)');

  updateBoardStatusText();

  // Set board orientation
  const flipped = blackStatus.parent().hasClass('bottom-panel'); // Is the board currently flipped to black at the bottom?
  // Check if server flip variable is set and flip board if necessary
  const vFlip = game.isPlaying() ? (game.color === 'b') !== game.flip : game.flip;
  if((game.color === 'b' !== flipped) !== vFlip)
    flipBoard(game);

  // Reset HTML elements
  game.element.find('.white-status .captured').text('');
  game.element.find('.black-status .captured').text('');
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
    Dialogs.hideAllNotifications();
  }

  if(game.role !== Role.PLAYING_COMPUTER && game.role !== Role.NONE) {
    session.send(`allobs ${game.id}`);
    awaiting.set('allobs');
    if(game.isPlaying()) {
      game.watchersInterval = setInterval(() => {
        const time = game.color === 'b' ? game.btime : game.wtime;
        if (time > 20000) {
          session.send(`allobs ${game.id}`);
          awaiting.set('allobs');
        }
      }, 30000);
    }
    else {
      game.watchersInterval = setInterval(() => {
        session.send(`allobs ${game.id}`);
        awaiting.set('allobs');
      }, 5000);
    }
  }

  if(game === games.focused) 
    stopEvalEngine();
 
  if(!examineModeRequested && !mexamineRequested) {
    game.historyList.length = 0;
    game.gameListFilter = '';
    $('#game-list-button').hide();
    game.history = new History(game, game.fen, game.time * 60000, game.time * 60000);
    updateEditMode(game);
    game.analyzing = false;
    if(game.setupBoard)
      leaveSetupBoard(game, true);
  }

  if(game.isPlayingOnline())
    game.element.find($('[title="Close"]')).css('visibility', 'hidden');

  let focusSet = false;
  if(!game.isObserving() || games.getMainGame().role === Role.NONE) {
    if(game !== games.focused) {
      setGameWithFocus(game);
      focusSet = true;
    }
    maximizeGame(game);
  }
  if(!focusSet) {
    if(game === games.focused)
      initGameControls(game);
    updateBoard(game);
  }

  // Close old unused private chat tabs
  if(chat)
    chat.closeUnusedPrivateTabs();

  // Open chat tabs
  if(game.isPlayingOnline()) {
    if(game.category === 'bughouse' && partnerGameId !== null)
      chat.createTab(`Game ${game.id} and ${partnerGameId}`); // Open chat room for all bughouse participants
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
      chat.createTab(`Game ${game.id}`);
  }

  if(game.isPlaying() || game.isObserving()) {
    // Adjust settings for game category (variant)
    // When examining we do this after requesting the movelist (since the category is told to us by the 'moves' command)
    if(game.isPlaying()) {
      if(settings.soundToggle) {
        Sounds.startSound.play();
      }

      if(game.role === Role.PLAYING_COMPUTER) { // Play Computer mode
        const options = getPlayComputerEngineOptions(game);
        
        const engineName = options.hasOwnProperty('UCI_Variant')
          ? settings.variantsEngineName
          : settings.playEngineName;

        playEngine = new Engine(game, playComputerBestMove, null, engineName, options, getPlayComputerMoveParams(game));
        if(game.turn !== game.color)
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
      if(awaiting.resolve('setup-board')) {
        setupBoard(game, true);
      }

      if(!game.setupBoard) {
        if(mexamineRequested) {
          const hEntry = game.history.find(game.fen);
          if(hEntry)
            game.history.display(hEntry);

          const moves = [];
          let curr = game.history.current();
          while(curr.move) {
            moves.push(ChessHelper.moveToCoordinateString(curr.move));
            curr = curr.prev;
          }
          game.mexamineMovelist = moves.reverse();
        }

        if(game.move !== 'none')
          session.send('back 999');
        session.send('for 999');
      }
    }

    if(!game.setupBoard && (game.isExamining() || ((game.isObserving() || game.isPlayingOnline()) && game.move !== 'none'))) {
      game.movelistRequested++;
      session.send('iset startpos 1'); // Show the initial board position before the moves list
      session.send(`moves ${game.id}`);
      session.send('iset startpos 0');
    }

    game.history.initMetatags();

    if(mexamineRequested)
      mexamineRequested = null;
  }

  if(game === games.focused) {
    showTab($('#pills-game-tab'));
    if(game.role !== Role.NONE)
      showStatusPanel();
  }

  if(!mainGame || game.id !== mainGame.partnerGameId)
    scrollToBoard(game);
}

function gameEnd(data: any) {
  const game = games.findGame(data.game_id);
  if(!game)
    return;

  game.clock.stopClocks();
  // Set clock time to the time that the player resigns/aborts etc.
  game.history.updateClockTimes(game.history.last(), game.clock.getWhiteTime(), game.clock.getBlackTime());

  const whiteStatus = game.element.find('.white-status');
  const blackStatus = game.element.find('.black-status');
  if(data.reason <= 5) {
    const winner = whiteStatus.find('.name').text() === data.winner ?
      'w' : 'b';
    whiteStatus.parent().css('--bs-card-cap-bg', winner === 'w' ? 'var(--game-win-color)' : 'var(--game-lose-color)');
    blackStatus.parent().css('--bs-card-cap-bg', winner === 'b' ? 'var(--game-win-color)' : 'var(--game-lose-color)');    
  
    if(game === games.focused && settings.soundToggle) {
      if(winner === game.color)
        Sounds.winSound.play();
      else
        Sounds.loseSound.play();
    }
  } 
  else {
    // tie
    whiteStatus.parent().css('--bs-card-cap-bg', 'var(--game-tie-color)');
    blackStatus.parent().css('--bs-card-cap-bg', 'var(--game-tie-color)');
  }

  const status = data.message.replace(/Game \d+ /, '');
  showStatusMsg(game, status);

  if(game.isPlaying()) {
    let rematch = [];
    let analyze = [];
    let dialogText = data.message;
    if(data.reason !== Reason.Disconnect && data.reason !== Reason.Adjourn && data.reason !== Reason.Abort) {
      if(data.extraText)
        dialogText += `\n\n${data.extraText}`;
      
      if(game.role === Role.PLAYING_COMPUTER) 
        rematch = ['rematchComputer();', 'Rematch'];
      else 
        rematch = ['sessionSend(\'rematch\')', 'Rematch']
    }
    if(data.reason !== Reason.Adjourn && data.reason !== Reason.Abort && game.history.length()) 
      analyze = ['analyze();', 'Analyze'];

    Dialogs.showBoardDialog({type: 'Match Result', msg: dialogText, btnFailure: rematch, btnSuccess: analyze, icons: false});
    if(data.extraText)
      chat.newMessage('console', { message: data.extraText });
    cleanupGame(game);
  }
  
  game.history.setMetatags({Result: data.score, Termination: data.reason});
}

function handleOffers(offers: any[]) {
  tournaments?.handleOffers(offers);

  // Clear the lobby
  if(offers[0]?.type === 'sc')
    $('#lobby-table').html('');

  // Add seeks to the lobby
  const seeks = offers.filter((item) => item.type === 's');
  if(seeks.length && awaiting.has('lobby')) {
    seeks.forEach((item) => {
      if(!settings.lobbyShowComputersToggle && item.title === 'C')
        return;
      if(!settings.lobbyShowUnratedToggle && item.ratedUnrated === 'u')
        return;

      const lobbyEntryText = formatLobbyEntry(item);
      $('#lobby-table').append(
        `<button type="button" data-offer-id="${item.id}" class="btn btn-outline-secondary lobby-entry"`
          + ` onclick="acceptSeek(${item.id});">${lobbyEntryText}</button>`);
    });

    if(lobbyScrolledToBottom) {
      const container = $('#lobby-table-container')[0];
      container.scrollTop = container.scrollHeight;
    }
  }

  // Add our own seeks and match requests to the top of the Play pairing pane
  const sentOffers = offers.filter((item) => (item.type === 'sn'
    || (item.type === 'pt' && (item.subtype === 'partner' || item.subtype === 'match')))
    && !$(`.sent-offer[data-offer-id="${item.id}"]`).length);
  
  sentOffers.forEach((item) => {
    awaiting.resolve('match');
    if(item.adjourned)
      removeAdjournNotification(item.opponent);
  });
  showSentOffers(sentOffers);
  $('#pairing-pane-status').hide();

  // Offers received from another player
  const otherOffers = offers.filter((item) => item.type === 'pf');
  otherOffers.forEach((item) => {
    let headerTitle = '';
    let bodyTitle = '';
    let bodyText = '';
    let displayType = '';
    switch(item.subtype) {
      case 'match':
        displayType = 'notification';
        const time = !isNaN(item.initialTime) ? ` ${item.initialTime} ${item.increment}` : '';
        bodyText = `${item.ratedUnrated} ${item.category}${time}`;
        if(item.adjourned) {
          headerTitle = 'Resume Adjourned Game Request';
          removeAdjournNotification(item.opponent);
        }
        else
          headerTitle = 'Match Request';
        bodyTitle = `${item.opponent} (${item.opponentRating})${item.color ? ` [${item.color}]` : ''}`;
        $('.notification').each((index, element) => {
          const headerTextElement = $(element).find('.header-text');
          const bodyTextElement = $(element).find('.body-text');
          if(headerTextElement.text() === 'Match Request' && bodyTextElement.text().startsWith(`${item.opponent}(`)) {
            $(element).attr('data-offer-id', item.id);
            bodyTextElement.text(`${bodyTitle} ${bodyText}`);
            const btnSuccess = $(element).find('.button-success');
            const btnFailure = $(element).find('.button-failure');
            btnSuccess.attr('onclick', `sessionSend('accept ${item.id}');`);
            btnFailure.attr('onclick', `sessionSend('decline ${item.id}');`);
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
        bodyText = `would like to take back ${item.parameters} half move(s).`;
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
      let dialog: JQuery<HTMLElement>;
      if(displayType === 'notification')
        dialog = Dialogs.createNotification({type: headerTitle, title: bodyTitle, msg: bodyText, btnFailure: [`decline ${item.id}`, 'Decline'], btnSuccess: [`accept ${item.id}`, 'Accept'], useSessionSend: true});
      else if(displayType === 'dialog')
        dialog = Dialogs.showBoardDialog({type: headerTitle, title: bodyTitle, msg: bodyText, btnFailure: [`decline ${item.id}`, 'Decline'], btnSuccess: [`accept ${item.id}`, 'Accept'], useSessionSend: true});
      dialog.attr('data-offer-id', item.id);
    }
  });

  // Remove match requests and seeks. Note our own seeks are removed in the MessageType.Unknown section
  // since <sr> info is only received when we are in the lobby.
  const removals = offers.filter((item) => item.type === 'pr' || item.type === 'sr');
  removals.forEach((item) => {
    item.ids.forEach((id) => {
      Dialogs.removeNotification($(`.notification[data-offer-id="${id}"]`)); // If match request was not ours, remove the Notification
      $(`.board-dialog[data-offer-id="${id}"]`).toast('hide'); // if in-game request, hide the dialog
      $(`.sent-offer[data-offer-id="${id}"]`).remove(); // If offer, match request or seek was sent by us, remove it from the Play pane
      $(`.lobby-entry[data-offer-id="${id}"]`).remove(); // Remove seek from lobby
    });
    
    if(item.type === 'sr' && !item.ids.length) // remove all seeks
      $('.sent-offer[data-offer-type="sn"]').remove();
    else if(item.type === 'pr' && !item.ids.length) { // remove all our sent match requests
      awaiting.remove('match');
      $('.sent-offer[data-offer-type="pt"]').remove();
    }
      
    if(!$('#sent-offers-status').children().length)
      $('#sent-offers-status').hide();
  });
}

function showSentOffers(offers: any) {
  if(!offers.length)
    return;

  let requestsHtml = '';
  offers.forEach((offer) => {
    requestsHtml += `<div class="sent-offer" data-offer-type="${offer.type}" data-offer-id="${offer.id}" style="display: none">`;
    requestsHtml += '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>&nbsp;&nbsp;';

    let removeCmd: string;
    if(offer.type === 'pt') {
      if(offer.subtype === 'partner') {
        requestsHtml += `Making a partnership offer to ${offer.toFrom}.`;
        removeCmd = `withdraw ${offer.id}`;
      }
      else if(offer.subtype === 'match') {
        // convert match offers to the same format as seeks
        let color = '';
        if(offer.color === 'black')
          color = ' B';
        else if(offer.color === 'white')
          color = ' W';

        // Display 'u' if we are a registered user playing an unrated game.
        const unrated = session.isRegistered() && offer.ratedUnrated === 'unrated' && offer.category !== 'untimed' ? 'u ' : '';
        const time = offer.category !== 'untimed' ? `${offer.initialTime} ${offer.increment} ` : '';

        const adjourned = (offer.adjourned ? ' (adjourned)' : '');

        requestsHtml += `Challenging ${offer.opponent} to ${time === '' ? 'an ' : 'a '}`
          + `${time}${unrated}${offer.category}${color} game${adjourned}.`;
        removeCmd = `withdraw ${offer.id}`;
      }
    }
    else if(offer.type === 'sn') {
      // Display 'u' if we are a registered user playing an unrated game.
      const unrated = session.isRegistered() && offer.ratedUnrated === 'u' && offer.category !== 'untimed' ? 'u ' : '';
      // Change 0 0 to 'untimed'
      const time = offer.category !== 'untimed' ? `${offer.initialTime} ${offer.increment} ` : '';
      const color = (offer.color !== '?' ? offer.color : '');

      requestsHtml += `Seeking ${time === '' ? 'an ' : 'a '}${time}${unrated}${offer.category}${color} game.`;
      removeCmd = `unseek ${offer.id}`;
    }

    const lastIndex = requestsHtml.lastIndexOf(' ') + 1;
    const lastWord = requestsHtml.slice(lastIndex);
    requestsHtml = requestsHtml.substring(0, lastIndex);
    requestsHtml += `<span style="white-space: nowrap">${lastWord}<span class="fa fa-times-circle btn btn-default `
      + `btn-sm" onclick="sessionSend('${removeCmd}')" aria-hidden="false"></span></span></div>`;
  });

  $('#sent-offers-status').append(requestsHtml);

  clearTimeout(showSentOffersTimer);
  showSentOffersTimer = setTimeout(() => {
    const sentOfferElements = $('.sent-offer');
    if(sentOfferElements.length) {
      sentOfferElements.show();
      $('#sent-offers-status').show();
      if($('#pills-pairing').hasClass('active'))
        $('#play-pane-subcontent')[0].scrollTop = 0;
    }
  }, 1000);
}

/**
 * Remove an adjourned game notification if the players are already attempting to resume their match
 */
function removeAdjournNotification(opponent: string) {
  const n1 = $(`.notification[data-adjourned-arrived="${opponent}"]`);
  Dialogs.removeNotification(n1);

  const n2 = $('.notification[data-adjourned-list="true"]');
  if(n2.length) {
    const bodyTextElement = n2.find('.body-text');
    const bodyText = bodyTextElement.html();
    const match = bodyText.match(/^\d+( players?, who (?:has|have) an adjourned game with you, (?:is|are) online:<br>)(.*)/);
    if(match && match.length > 2) {
      const msg = match[1];
      let players = match[2].trim().split(/\s+/);
      players = players.filter(item => item !== opponent);
      if(!players.length)
        Dialogs.removeNotification(n2);
      else
        bodyTextElement.html(`${players.length}${msg}${players.join(' ')}`);
    }
  }
}

function handleMiscMessage(data: any) {
  let msg = data.message;

  let match = msg.match(/^No one is observing game (\d+)\./m);
  if(match != null && match.length > 1) {
    if(awaiting.resolve('allobs')) 
      return;
    chat.newMessage('console', data);
    return;
  }

  match = msg.match(/^(?:Observing|Examining)\s+(\d+) [\(\[].+[\)\]]: (.+) \(\d+ users?\)/m);
  if (match != null && match.length > 1) {
    if(awaiting.resolve('allobs')) {
      const game = games.findGame(+match[1]);
      if(!game)
        return;

      game.statusElement.find('.game-watchers').empty();
      match[2] = match[2].replace(/\(U\)/g, '');
      const watchers = match[2].split(' ');
      game.watchers = watchers.filter(item => item.replace('#', '') !== session.getUser());
      const chatTab = chat.getTabFromGameID(game.id);
      if(chatTab)
        chat.updateWatchers(chatTab);
      let req = '';
      let numWatchers = 0;
      for(let i = 0; i < watchers.length; i++) {
        if(watchers[i].replace('#', '') === session.getUser())
          continue;
        numWatchers++;
        if(numWatchers === 1)
          req = 'Watchers:';
        req += `<span class="ms-1 badge clickable-user rounded-pill bg-secondary noselect">${watchers[i]}</span>`;
        if(numWatchers > 5) {
          req += ` + ${watchers.length - i} more.`;
          break;
        }
      }
      game.statusElement.find('.game-watchers').html(req);
      return;
    }
    chat.newMessage('console', data);
    return;
  }

  match = msg.match(/^Channel (\d+).*?: (.*)/m);
  if(match && awaiting.resolve('inchannel')) {
    const chNum = match[1];
    const members = match[2].replace(/\(U\)/g, '').split(' ');
    chat.updateMembers(chNum, members);
    return;
  }

  match = msg.match(/(?:^|\n)\s*\d+\s+(\(Exam\.\s+)?[0-9\+\-]+\s\w+\s+[0-9\+\-]+\s\w+\s*(\)\s+)?\[[\w\s]+\]\s+[\d:]+\s*\-\s*[\d:]+\s\(\s*\d+\-\s*\d+\)\s+[BW]:\s+\d+\s*\d+ games? displayed/);
  if(match != null && match.length > 0 && awaiting.resolve('games')) {
    showGames(msg);
    return;
  }

  match = msg.match(/^You have (\d+) messages? \((\d+) unread\)./m);
  if(match) {
    const numMessages = +match[1];
    const numUnread = +match[2];
    if(numUnread > 0) {
      if(settings.chattabsToggle) {
        const okHandler = () => {
          awaiting.set('unread-messages');
          session.send('messages u');
        };
        const headerTitle = `Unread Message${numUnread > 1 ? 's' : ''}`;
        const bodyText = `You have ${numUnread} unread message${numUnread > 1 ? 's' : ''}.<br><br>Tip: To send a reply message in a chat tab, prefix it with "m;"`;
        const button1 = [okHandler, 'View in Chat Tabs'];
        const button2 = ['', 'Not now'];
        Dialogs.createNotification({type: headerTitle, msg: bodyText, btnFailure: button2, btnSuccess: button1});
      }
    }
    else if(numMessages >= 35) { 
      const button2Handler = () => {
        storage.set('ignore-message-box-full', 'true');
      };
      if(!storage.get('ignore-message-box-full')) {
        const headerTitle = 'Message Box Alert';
        const bodyText = `Your message box is ${numMessages < 40 ? 'almost ' : ''} full.<br><br>Would you like to clear your message box? (clearmessages *)`;
        const button1 = ['clearmessages *', 'Clear ENTIRE message box'];
        const button2 = [button2Handler, 'Not now'];
        Dialogs.createNotification({type: headerTitle, msg: bodyText, btnFailure: button2, btnSuccess: button1, useSessionSend: true});   
      }
    }
  }

  match = msg.match(/^Messages cleared./m);
  if(match) {
    storage.remove('ignore-message-box-full');
    chat.newMessage('console', data);
    return;
  }

  match = msg.match(/^\(told (.+)\)/m);
  if(match) {
    const index = pendingTells.findIndex(item => item.recipient.toLowerCase() === match[1].trim().toLowerCase());
    if(index !== -1) 
      pendingTells.splice(index, 1);
    return;
  }

  match = msg.match(/^(\w+) is not logged in./m);
  if(match) {
    const index = pendingTells.findIndex(item => item.recipient.toLowerCase() === match[1].toLowerCase());
    if(index !== -1) {
      // User has tried to send a tell to an offline user. Ask if they want to send it as a message isntead
      const tell = pendingTells.splice(index, 1)[0];
      const message = tell.message; 
      const okHandler = () => {
        session.send(`message ${tell.recipient} ${message}`);
      };
      const headerTitle = 'Send as message';
      const bodyText = `${tell.recipient} is not logged in. Send as message instead?`;
      const button1 = [okHandler, 'Yes'];
      const button2 = ['', 'No'];
      Dialogs.showFixedDialog({type: headerTitle, msg: bodyText, btnFailure: button2, btnSuccess: button1});
      return;
    }
  }

  match = msg.match(/^Game (\d+): (\S+) has lagged for 30 seconds\./m);
  if(match) {
    const game = games.findGame(+match[1]);
    if(game && game.isPlaying()) {
      const bodyText = `${match[2]} has lagged for 30 seconds.<br>You may courtesy adjourn the game.<br><br>If you believe your opponent has intentionally disconnected, you can request adjudication of an adjourned game. Type 'help adjudication' in the console for more info.`;
      const dialog = Dialogs.showBoardDialog({type: 'Opponent Lagging', msg: bodyText, btnFailure: ['', 'Wait'], btnSuccess: ['adjourn', 'Adjourn'], useSessionSend: true});
      dialog.attr('data-game-id', game.id);
    }
    chat.newMessage('console', data);
    return;
  }

  match = msg.match(/^History for (\w+):.*/m);
  if(match != null && match.length > 1) {
    if(awaiting.resolve('history')) {
      if(!awaiting.has('history')) {
        $('#history-username').val(match[1]);
        showHistory(match[1], data.message);
      }
    }
    else if(awaiting.resolve('history-rematch')) {
      // Manually perform a rematch for a user who is in our match history (last 10 games)
      const history = parseHistory(msg);
      for(let i = history.length - 1; i >= 0; i--) {
        const m = history[i].match(/^\s*(?:\S+\s+){5}(\w+)\s+\[\s*(\w)(\w)\s+(\d+)\s+(\d+)/);
        const name = m[1];
        if(rematchUser.toLowerCase() === name.toLowerCase()) {
          if(i === history.length - 1) {
            session.send('rematch'); // User was the last opponent we played so we can use the server's 'rematch' command instead
            return;
          }
          else {
            const type = m[2];
            const ratedUnrated = m[3];
            const min = m[4];
            const inc = m[5];
            const typeNames = {
              z: 'crazyhouse',
              B: 'bughouse',
              S: 'suicide',
              L: 'losers',
              x: 'atomic'
            }
            if(type !== 'w') { // Don't send rematch if the last match was wild, since we won't be able to determine the board type
              const typeStr = typeNames[type] ? ` ${typeNames[type]}` : '';
              session.send(`match ${name} ${ratedUnrated} ${min} ${inc}${typeStr}`);
              return;
            }
          }
          break;
        }
      }
      Dialogs.showFixedDialog({type: 'Unable to Rematch', msg: `Couldn't determine the last type of match played against ${rematchUser}. Use 'Challenge' instead.`, btnSuccess: ['', 'OK']});
    }
    else
      chat.newMessage('console', data);

    return;
  }

  if((msg.startsWith('Finger of') || msg.startsWith('There is no (registered )?player matching the name') || /^'\S+' is not a valid handle/.test(msg)) && awaiting.resolve('info-finger')) {
    Dialogs.showInfoDialog('Finger Info', msg);
    return;
  }

  if((msg.startsWith('Record for') || msg.startsWith('There is no (registered )?player matching the name') || msg === 'No player game stats to show.' || /^'\S+' is not a valid handle/.test(msg)) && awaiting.resolve('info-pstat')) {
    Dialogs.showInfoDialog('Head to Head', msg);
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
  if(match && (awaiting.has('history') || awaiting.has('obs') || awaiting.has('match') || awaiting.has('allobs'))) {
    let status: JQuery<HTMLElement>;
    if(awaiting.has('history'))
      status = $('#history-pane-status');
    else if(awaiting.has('obs'))
      status = $('#observe-pane-status');
    else if(awaiting.has('match'))
      status = $('#pairing-pane-status');

    if(awaiting.resolve('history')) {
      if(awaiting.has('history'))
        return;

      $('#history-table').html('');
    }
    else if(awaiting.resolve('obs')) {
      if(awaiting.has('obs'))
        return;
    }
    else if(!awaiting.resolve('match') && match[0] === 'There is no such game.')
      awaiting.resolve('allobs');

    if(status) {
      if(match[0].startsWith('Ambiguous name'))
        status.text(`There is no player matching the name ${match[1]}.`);
      else if(match[0].includes('is not open for bughouse.'))
        status.text(`${match[0]} Ask them to 'set bugopen 1' in the Console.`);
      else if(match[0] === 'You cannot seek bughouse games.')
        status.text('You must specify an opponent for bughouse.');
      else if(match[0].includes('no partner for bughouse.'))
        status.text(`${match[0]} Get one by using 'partner <username>' in the Console.`);
      else
        status.text(match[0]);

      status.show();
    }
    return;
  }

  match = msg.match(/(?:^|\n)(\d+ players?, who (?:has|have) an adjourned game with you, (?:is|are) online:)\n(.*)/);
  if(match && match.length > 2) {
    const n = Dialogs.createNotification({type: 'Resume Game', title: `${match[1]}<br>${match[2]}`, btnSuccess: ['resume', 'Resume Game'], useSessionSend: true});
    n.attr('data-adjourned-list', 'true');
  }
  match = msg.match(/^Notification: ((\S+), who has an adjourned game with you, has arrived\.)/m);
  if(match && match.length > 2) {
    if(!$(`.notification[data-adjourned-arrived="${match[2]}"]`).length) {
      const n = Dialogs.createNotification({type: 'Resume Game', title: match[1], btnSuccess: [`resume ${match[2]}`, 'Resume Game'], useSessionSend: true});
      n.attr('data-adjourned-arrived', match[2]);
    }
    return;
  }
  
  match = msg.match(/^\w+ is not logged in./m);
  if(!match)
    match = msg.match(/^Player [a-zA-Z\"]+ is censoring you./m);
  if(!match)
    match = msg.match(/^There is no player matching the name \S+/m);
  if(!match)
    match = msg.match(/^Sorry the message is too long./m);
  if(!match)
    match = msg.match(/^You are muted./m);
  if(!match)
    match = msg.match(/^Only registered players may whisper to others' games./m);
  if(!match) 
    match = msg.match(/^\S+ message box is full./m);
  if(!match)
    match = msg.match(/^You cannot send any more messages to \S+ at present \(24hr limit reached\)./m);
  if(!match)
    match = msg.match(/^A message cannot be received as your message box is full./m);
  if(!match)
    match = msg.match(/^Only registered players can have messages./m);
  if(!match)
    match = msg.match(/^Notification: .*/m);
  if(match && match.length > 0) {
    if(/^The following message was emailed to/m.test(msg)) {
      if(chat.currentTab() !== 'console')
        chat.newNotification(`${match[0]} Message sent as email.`);
      chat.newMessage('console', data);
      return;
    }
    chat.newNotification(match[0]);
    return;
  }

  match = msg.match(/^The following message was (sent(?: and emailed)?)/m);
  if(match && chat.currentTab() !== 'console') {
    chat.newNotification(`Message ${match[1]}.`);
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
    const headerTitle = 'Partnership Declined';
    const bodyTitle = match[1];
    Dialogs.createNotification({type: headerTitle, title: bodyTitle, useSessionSend: true});
  }
  match = msg.match(/^(\w+ agrees to be your partner\.)/m);
  if(match && match.length > 1) {
    const headerTitle = 'Partnership Accepted';
    const bodyTitle = match[1];
    Dialogs.createNotification({type: headerTitle, title: bodyTitle, useSessionSend: true});
  }

  match = msg.match(/^(All players must be registered to adjourn a game.  Use "abort".)/m);
  if(match && match.length > 1) {
    Dialogs.showBoardDialog({type: 'Can\'t Adjourn', msg: match[1]});
    return;
  }

  match = msg.match(/^(Issuing match request since the seek was set to manual\.)/m);
  if(match && match.length > 1 && awaiting.has('lobby')) {
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

  match = msg.match(/(?:^|\n)\s*Movelist for game (\d+):\s+(\S+) \((\d+|UNR)\) vs\. (\S+) \((\d+|UNR)\)[^\n]+\s+(\w+) (\S+) match, initial time: (\d+) minutes, increment: (\d+) seconds\./);
  if (match != null && match.length > 9) {
    const game = games.findGame(+match[1]);
    if(game && (game.movelistRequested || game.gameStatusRequested)) {
      if(game.isExamining()) {
        const id = match[1];
        const wname = match[2];
        let wrating = game.wrating = match[3];
        const bname = match[4];
        let brating = game.brating = match[5];
        const rated = match[6].toLowerCase();
        game.category = match[7];
        const initialTime = match[8];
        const increment = match[9];

        if(wrating === 'UNR') {
          game.wrating = '';
          if(/^Guest[A-Z]{4}$/.test(wname))
            wrating = '++++';
          else wrating = '----';
        }
        if(brating === 'UNR') {
          game.brating = '';
          if(/^Guest[A-Z]{4}$/.test(bname))
            brating = '++++';
          else brating = '----';
        }

        game.element.find('.white-status .rating').text(game.wrating);
        game.element.find('.black-status .rating').text(game.brating);

        const time = initialTime === '0' && increment === '0' ? '' : ` ${initialTime} ${increment}`;

        const statusMsg = `<span class="game-id">Game ${id}: </span>${wname} (${wrating}) ${bname} (${brating}) `
          + `${rated} ${game.category}${time}`;
        showStatusMsg(game, statusMsg);

        const tags = game.history.metatags;
        game.history.setMetatags({
          ...(!('WhiteElo' in tags) && { WhiteElo: game.wrating || '-' }),
          ...(!('BlackElo' in tags) && { BlackElo: game.brating || '-' }),
          ...(!('Variant' in tags) && { Variant: game.category })
        });
        const chatTab = chat.getTabFromGameID(game.id);
        if(chatTab)
          chat.updateGameDescription(chatTab);
        initAnalysis(game);
        initGameTools(game);
      }

      game.gameStatusRequested = false;
      if(game.movelistRequested) {
        game.movelistRequested--;
        const categorySupported = SupportedCategories.includes(game.category);
        if(categorySupported)
          parseMovelist(game, msg);

        if(game.isExamining()) {
          if(game.history.length() || !categorySupported)
            session.send('back 999');
          if(!game.history.length || !categorySupported)
            game.history.scratch(true);

          if(game.mexamineMovelist) { // Restore current move after retrieving move list in mexamine mode
            if(categorySupported) {
              let curr = game.history.first().next;
              let forwardNum = 0;
              for(const move of game.mexamineMovelist) {
                if(curr && ChessHelper.moveToCoordinateString(curr.move) === move) {
                  forwardNum++;
                  curr = curr.next;
                }
                else {
                  curr = null;
                  if(forwardNum) {
                    session.send(`forward ${forwardNum}`);
                    forwardNum = 0;
                  }
                  session.send(move);
                }
              }
              if(forwardNum)
                session.send(`forward ${forwardNum}`);
            }
            game.mexamineMovelist = null;
          }
        }
        else
          game.history.display();
      }
      updateBoardStatusText();
      return;
    }
    else {
      chat.newMessage('console', data);
      return;
    }
  }

  match = msg.match(/^Your partner is playing game (\d+)/m);
  if (match != null && match.length > 1) {
    if(settings.multiboardToggle)
      session.send('pobserve');

    partnerGameId = +match[1];
    const mainGame = games.getPlayingExaminingGame();
    if(mainGame) {
      mainGame.partnerGameId = partnerGameId;
      chat.createTab(`Game ${mainGame.id} and ${partnerGameId}`);
    }
  }

  match = msg.match(/^(Creating|Game\s(\d+)): (\S+) \(([\d\+\-\s]+)\) (\S+) \(([\d\-\+\s]+)\) \S+ (\S+).+/m);
  if(match != null && match.length > 7) {
    let game: Game;
    if(!settings.multiboardToggle)
      game = games.getMainGame();
    else {
      game = games.findGame(+match[2]);
      if(!game)
        game = games.getFreeGame();
      if(!game)
        game = createGame();
    }

    if(settings.multiboardToggle || !game.isPlaying() || +match[2] === game.id) {
      game.wrating = (isNaN(match[4]) || match[4] === '0') ? '' : match[4];
      game.brating = (isNaN(match[6]) || match[6] === '0') ? '' : match[6];
      game.category = match[7];

      let status = match[0].substring(match[0].indexOf(':') + 1);
      if(game.role !== Role.NONE)
        status = `<span class="game-id">Game ${game.id}: </span>${status}`;
      showStatusMsg(game, status);

      if(game.history)
        game.history.initMetatags();

      game.element.find('.white-status .rating').text(game.wrating);
      game.element.find('.black-status .rating').text(game.brating);
    }
    data.message = msg = Utils.removeLine(msg, match[0]); // remove the matching line
    if(!msg)
      return;
  }

  match = msg.match(/^You are now observing game \d+\./m);
  if(match) {
    if(awaiting.resolve('obs')) {
      $('#observe-pane-status').hide();
      return;
    }

    chat.newMessage('console', data);
    return;
  }

  /* Parse score and termination reason for examined games */
  match = msg.match(/^Game (\d+): ([a-zA-Z]+)(?:' game|'s)?\s([^\d\*]+)\s([012/]+-[012/]+)/m);
  if(match != null && match.length > 3) {
    const game = games.findGame(+match[1]);
    if(game && game.history) {
      const who = match[2];
      const action = match[3];
      const score = match[4];
      const [, , reason] = session.getParser().getGameResult(game.wname, game.bname, who, action);
      game.history.setMetatags({Result: score, Termination: reason});
      return;
    }
  }

  match = msg.match(/^Removing game (\d+) from observation list./m);
  if(!match)
    match = msg.match(/^You are no longer examining game (\d+)./m);
  if(match != null && match.length > 1) {
    const game = games.findGame(+match[1]);
    if(game) {
      mexamineGame = game; // Stores the game in case a 'mexamine' is about to be issued.
      if(game === games.focused)
        stopEngine();
      else
        game.engineRunning = false;
      cleanupGame(game);
    }

    const index = gameExitPending.indexOf(+match[1]);
    if(index !== -1) {
      gameExitPending.splice(index, 1);
      if(!gameExitPending.length && !settings.multiboardToggle)
        session.send('refresh');
    }
    return;
  }

  match = msg.match(/(?:^|\n)-- channel list: \d+ channels --\s*([\d\s]*)/);
  if(match !== null && match.length > 1) {
    if(!awaiting.resolve('channel-list'))
      chat.newMessage('console', data);

    return chat.addChannelList(match[1].split(/\s+/));
  }
  match = msg.match(/^\[(\d+)\] added to your channel list\./m);
  if(match != null && match.length > 1) {
    chat.addChannel(match[1]);
    chat.newMessage('console', data);
    return;
  }
  match = msg.match(/^\[(\d+)\] removed from your channel list\./m);
  if(match != null && match.length > 1) {
    chat.removeChannel(match[1]);
    chat.newMessage('console', data);
    return;
  }

  match = msg.match(/(?:^|\n)-- computer list: \d+ names --([\w\s]*)/);
  if(match !== null && match.length > 1) {
    if(!awaiting.resolve('computer-list'))
      chat.newMessage('console', data);

    computerList = match[1].split(/\s+/);
    return;
  }
  
  let variablesReceived = false;
  match = msg.match(/(?:^|\n)Variable settings of \S+\s+((?:\w+=\w+\s+)+)/);
  if(match && awaiting.has('user-variables')) {
    const varStrings = match[1].split(/\s+/);
    userVariables = Object.fromEntries(varStrings.map(val => val.split('='))); 
    Utils.setDefaultTimezone(userVariables.tzone);
    variablesReceived = true;
  }
  match = msg.match(/^Interface: /m);
  if(match && awaiting.resolve('user-variables')) {
    $('#formula-toggle').prop('disabled', !/^Formula: /m.test(msg));
    return;
  }
  if(variablesReceived)
    return;

  match = msg.match(/^Server time[^:]+:\d+\s+(\w+)/m);
  if(match && awaiting.resolve('date')) {
    Utils.setServerTimezone(match[1]);
    return;
  }

  if(msg.startsWith('Formula unset.'))
    $('#formula-toggle').prop('disabled', true);
  if(msg.startsWith('Formula set to'))
    $('#formula-toggle').prop('disabled', false);
  
  // Suppress messages when 'moves' command issued internally
  match = msg.match(/^You're at the (?:beginning|end) of the game\./m);
  if(match) {
    for(const game of games) {
      if(game.movelistRequested) {
        return;
      }
    }
  }

  /** Cancel premoves when illegal move made */
  match = msg.match(/^Illegal move \(\S+\)\./m);
  if(match) {
    const game = games.getPlayingExaminingGame();
    if(game && game.isPlaying() && game.premoves.length) {
      cancelMultiplePremoves(game);
      updateBoard(game, false, true, false);
    }
  }

  // Enter setup mode when server (other user or us) issues 'bsetup' command
  match = msg.match(/^Entering setup mode\./m);
  if(!match)
    match = msg.match(/^Game (\d+): \w+ enters setup mode\./m);
  if(match) {
    const game = match.length > 1 ? games.findGame(+match[1]) : games.getPlayingExaminingGame();
    if(game) {
      if(!game.commitingMovelist && !game.setupBoard)
        setupBoard(game, true);
    }
    else
      awaiting.set('setup-board'); // user issued 'bsetup' before 'examine'
  }
  // Leave setup mode when server (other user or us) issues 'bsetup done' command
  match = msg.match(/^Game is validated - entering examine mode\./m);
  if(!match)
    match = msg.match(/^Game (\d+): \w+ has validated the position. Entering examine mode\./m);
  if(match) {
    const game = match.length > 1 ? games.findGame(+match[1]) : games.getPlayingExaminingGame();
    if(game && !game.commitingMovelist && game.setupBoard)
      leaveSetupBoard(game, true);
  }

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
    const game = games.getPlayingExaminingGame();
    if(game && game.commitingMovelist) {
      if(match[0] === 'done: Command not found.') // This was sent by us to indicate when we are done
        game.commitingMovelist = false;
      return;
    }
  }

  // Support for multiple examiners, we need to handle other users commiting or truncating moves from the main line
  match = msg.match(/^Game (\d+): \w+ commits the subvariation\./m);
  if(match) {
    const game = games.findGame(+match[1]);
    if(game) {
      // An examiner has commited the current move to the mainline. So we need to also make it the mainline.
      game.history.scratch(false);
      const curr = game.history.current();
      while(curr.depth() > 0)
        game.history.promoteSubvariation(curr);
      // Make the moves following the commited move a continuation (i.e. not mainline)
      if(curr.next)
        game.history.makeContinuation(curr.next);
    }
  }
  match = msg.match(/^Game (\d+): \w+ truncates the game at halfmove (\d+)\./m);
  if(match) {
    const game = games.findGame(+match[1]);
    if(game) {
      const index = +match[2];
      if(index === 0)
        game.history.scratch(true); // The entire movelist was truncated so revert back to being a scratch game
      else {
        const entry = game.history.getByIndex(index)
        if(entry && entry.next)
          game.history.makeContinuation(entry.next);
      }
    }
  }

  match = msg.match(/^\w+ has made you an examiner of game \d+\./m);
  if(match) {
    mexamineRequested = mexamineGame;
    return;
  }
  
  match = msg.match(/^\s*\d+ players displayed \(of \d+\)\. \(\*\) indicates system administrator\./m);
  if(match && awaiting.resolve('userlist')) {
    users.userList = parseUserList(msg);
    users.updateUsers();
    chat.updateUserList(users.userList);
    return;
  }

  match = msg.match(/Blitz\s+Standard\s+Lightning/m);
  if(match && awaiting.resolve('hbest')) {
    users.parseBest(msg);
    users.updateUsers();
    return;
  }

  match = msg.match(/^Starting a game in examine \(scratch\) mode\./m);
  if(match && examineModeRequested)
    return;

  match = msg.match(/^Game\s\d+: \w+ backs up \d+ moves?\./m);
  if(!match)
    match = msg.match(/^Game\s\d+: \w+ goes forward \d+ moves?\./m);
  if(match)
    return;

  match = msg.match(/^Average ping time for \S+ is \d+ms\./m);
  if(match && awaiting.resolve('ping')) 
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
    msg.startsWith('<12>') // Discard malformed style 12 messages (sometimes the server sends them split in two etc).
  ) {
    return;
  }

  if(tournaments.handleMessage(msg))
    return;

  chat.newMessage('console', data);
}

export function cleanup() {
  chat?.cleanup();
  tournaments?.cleanup();
  awaiting.clearAll();
  partnerGameId = null;
  userVariables = {};
  pendingTells = [];
  examineModeRequested = null;
  mexamineRequested = null;
  gameExitPending = [];
  clearMatchRequests();
  Dialogs.clearNotifications();
  for(const game of games) {
    if(game.role !== Role.PLAYING_COMPUTER)
      cleanupGame(game);
  }
  clearInterval(keepAliveTimer);
}

/**
 * Parse the result from the server 'who' command into a structured user list 
 */
function parseUserList(msg: string): any[] {
  const users: object[] = [];
  for(let line of msg.split('\n').slice(0, -2)) {
    const userStrings = line.split(/ {2,}/);
    userStrings.forEach((val) => {
      const match = val.match(/([-+\d]+)(.)([^(]+)(.*)/);
      if(match) {
        users.push({
          rating: match[1],
          status: match[2],
          name: match[3],
          title: match[4]
        });
      }
    });
  }
  return users;
}

/** *******************************************************
 * GAME BOARD PANEL FUNCTIONS                             *
 * Including player/opponent status panels and game board *
 **********************************************************/

/** PLAYER/OPPONENT STATUS PANEL FUNCTIONS **/

function updateBoardStatusText() {
  setTimeout(() => {
    // Resize fonts for player and opponent name to fit
    $('.status').each((index, element) => {
      const nameElement = $(element).find('.name');
      const ratingElement = $(element).find('.rating');
      const nameRatingElement = $(element).find('.name-rating');

      const name = nameElement.text();
      nameElement.toggleClass('clickable-user', name && name !== 'Computer' && name !== session?.getUser() && !name.includes(' '));

      nameElement.css('font-size', '');
      ratingElement.css('width', '');

      const nameBorderWidth = nameElement.outerWidth() - nameElement.width();
      const nameMaxWidth = nameRatingElement.width() - ratingElement.outerWidth() - nameBorderWidth;
      const fontSize = calculateFontSize(nameElement, nameMaxWidth);
      nameElement.css('font-size', `${fontSize}px`);

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

function showCapturedMaterial(game: Game) {
  const captured = {
    P: 0, R: 0, B: 0, N: 0, Q: 0, K: 0, p: 0, r: 0, b: 0, n: 0, q: 0, k: 0
  };

  let holdings: { [key: string]: number };
  if(game.category === 'crazyhouse' || game.category === 'bughouse') {
    // for crazyhouse/bughouse we display the held pieces
    holdings = game.history.current().variantData.holdings;
    if(!holdings)
      holdings = captured;
  }
  else {
    const material = { ...captured }; // otherwise we display the material difference

    const pos = game.history.current().fen.split(/\s+/)[0];
    for(const ch of pos) {
      if(material.hasOwnProperty(ch))
        material[ch]++;
    }

    // Get material difference between white and black, represented as "captured pieces"
    // e.g. if black is 2 pawns up on white, then 'captured' will contain P: 2 (two white pawns).
    const pieces = Object.keys(material).filter(key => key === key.toUpperCase());
    for(const whitePiece of pieces) {
      const blackPiece = whitePiece.toLowerCase();
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

  const whitePanel = game.element.find('.white-status .captured');
  const blackPanel = game.element.find('.black-status .captured');
  whitePanel.empty();
  blackPanel.empty();
  Object.entries(holdings || captured).forEach(([key, value]) => {
    if(value > 0) {
      const color = key === key.toUpperCase() ? 'w' : 'b';
      const piece = `${color}${key.toUpperCase()}`;
      const num = value;
      const panel = (!holdings && color === 'b') || (holdings && color === 'w')
        ? whitePanel : blackPanel;
      const pieceElement = $(`<span class="captured-piece" data-drag-piece="${piece}"><span class="captured-piece-img" style="background-image: url('assets/css/images/pieces/merida/${piece}.svg')"></span><small>${num}</small></span>`);
      panel.append(pieceElement);

      if(holdings) {
        pieceElement[0].addEventListener('touchstart', dragPiece, {passive: false});
        pieceElement[0].addEventListener('mousedown', dragPiece);
      }
    }
  });
}

function dragPiece(event: any) {
  const game = games.focused;
  const id = $(event.target).closest('[data-drag-piece]').attr('data-drag-piece');
  const color = id.charAt(0);
  const type = id.charAt(1);

  const piece = {
    role: ChessHelper.shortToLongPieceName(type.toLowerCase()),
    color: (color === 'w' ? 'white' : 'black')
  };

  if((game.isPlaying() && game.color === color) || game.isExamining() || game.role === Role.NONE) {
    Utils.lockOverflow(); // Stop scrollbar appearing due to player dragging piece below the visible window
    game.board.dragNewPiece(piece, event);
    event.preventDefault();
  }
}

function setClocks(game: Game) {
  const hEntry = (game.isPlaying() || game.role === Role.OBSERVING ? game.history?.last() : game.history?.current());

  if(!game.isPlaying() && game.role !== Role.OBSERVING) {
    game.clock.setWhiteClock(hEntry.wtime);
    game.clock.setBlackClock(hEntry.btime);
  }

  // Add my-turn highlighting to clock
  const whiteClock = game.element.find('.white-status .clock');
  const blackClock = game.element.find('.black-status .clock');

  const turnColor = hEntry.turnColor;
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
function hitClock(game: Game, bSetClocks = false) {
  if(!game.isPlaying() && game.role !== Role.OBSERVING)
    return;

  let ply = game.history.last().ply;
  let turnColor = game.history.last().turnColor;
  if(!bSetClocks) { 
    // Note if hitClock() is called from movePiece() then we haven't yet added the move 
    // to the history yet.
    ply++;
    turnColor = turnColor === 'w' ? 'b' : 'w';
  }

  // If a move was received from the server, set the clocks to the updated times
  // Note: When in examine mode this is handled by setClocks() instead
  if(bSetClocks) { // Get remaining time from server message
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
    if(turnColor === 'w' && ply >= 5) 
      game.clock.setBlackClock(game.clock.getBlackTime() + game.inc * 1000);
    else if(turnColor === 'b' && ply >= 4) 
      game.clock.setWhiteClock(game.clock.getWhiteTime() + game.inc * 1000);
  }

  if((ply >= 3 || game.category === 'bughouse') && turnColor === 'w')
    game.clock.startWhiteClock();
  else if((ply >= 4 || game.category === 'bughouse') && turnColor === 'b')
    game.clock.startBlackClock();
}

/** GAME BOARD FUNCTIONS **/

function createBoard(element: any): any {
  return Chessground(element[0], {
    disableContextMenu: true,
    movable: {
      events: {
        after: movePiece,
        afterNewPiece: movePiece,
      }
    },
    premovable: {
      events: {
        set: preMovePiece,
        unset: cancelPremove,
      }
    },
    predroppable: {
      events: {
        set: preDropPiece
      }
    },
    events: {
      change: boardChanged,
      select: squareSelected
    },
  });
}

export function updateBoard(game: Game, playSound = false, setBoard = true, animate = true) {
  if(!game.history)
    return;

  const move = game.history.current().move;
  let fen = game.history.current().fen;
  const color = (ChessHelper.getTurnColorFromFEN(fen) === 'w' ? 'white' : 'black');

  setClocks(game);

  const premoveSquares = new Map();

  if((setBoard || game.setupBoard) && game.element.find('.promotion-panel').is(':visible')) {
    game.board.cancelPremove();
    hidePromotionPanel(game);
  }

  if(setBoard && !game.setupBoard) {   
    // Display premoves (when multiple premoves setting enabled)
    if(game.premoves.length && game.history.current() === game.history.last()) {
      fen = game.premovesFen;

      for(let i = 0; i < game.premoves.length; i++) {
        const premove = game.premoves[i];
        // Set premove square highlighting and numbering classes
        if(premove.from && !premoveSquares.get(premove.from))
          premoveSquares.set(premove.from, 'current-premove');
        premoveSquares.set(premove.to, `current-premove premove-target premove-square-${premove.to}`);
      }
    }   

    if(!animate)
      game.board.set({ animation: { enabled: false }});
  
    game.board.set({ fen });
  
    if(!animate)
      game.board.set({ animation: { enabled: true }});
  }

  const categorySupported = SupportedCategories.includes(game.category);

  if(move && move.from && move.to)
    game.board.set({ lastMove: [move.from, move.to] });
  else if(move && move.to)
    game.board.set({ lastMove: [move.to] });
  else
    game.board.set({ lastMove: false });

  let dests: Map<string, string[]> | undefined;
  let movableColor: string | undefined;
  let turnColor: string | undefined;

  if(game.isPlaying()) {
    movableColor = (game.color === 'w' ? 'white' : 'black');
    dests = gameToDests(game);
    turnColor = color;
  }
  else if(game.setupBoard || (!categorySupported && game.role === Role.NONE)) {
    movableColor = 'both';
  }
  else {
    movableColor = color;
    dests = gameToDests(game);
    turnColor = color;
  }

  let movable: any = {};
  movable = {
    color: movableColor,
    dests,
    showDests: settings.highlightsToggle,
    rookCastle: game.category === 'wild/fr',
    free: game.setupBoard || !categorySupported
  };

  game.board.set({
    turnColor,
    movable,
    draggable: {
      deleteOnDropOff: game.setupBoard
    },
    highlight: {
      lastMove: settings.highlightsToggle,
      check: settings.highlightsToggle,
      custom: premoveSquares
    },
    predroppable: { enabled: game.category === 'crazyhouse' || game.category === 'bughouse' },
    check: !game.setupBoard && /[+#]/.test(move?.san) ? color : false,
    blockTouchScroll: game.isPlaying(),
    autoCastle: !game.setupBoard && (categorySupported || game.category === 'atomic'),
    drawable: { enabled: !game.premoves.length } 
  });

  showCapturedMaterial(game);
  showOpeningName(game);
  updateBoardStatusText();

  if(playSound && settings.soundToggle && game === games.focused) {
    clearTimeout(soundTimer);
    soundTimer = setTimeout(() => {
      if(/[+#]/.test(move?.san)) {
        Sounds.checkSound.pause();
        Sounds.checkSound.currentTime = 0;
        Sounds.checkSound.play();
      }
      else if(move?.san.includes('x')) {
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

  if(game === games.focused) {
    if(game.history.current().isSubvariation()) {
      $('#exit-subvariation').removeClass('disabled');
      $('#exit-subvariation').show();
    }
    else
      $('#exit-subvariation').addClass('disabled');
  }
}

function boardChanged() {
  const game = games.focused;
  if(game.setupBoard) {
    const fen = getSetupBoardFEN(game);

    if(ChessHelper.splitFEN(fen).board === ChessHelper.splitFEN(game.fen).board)
      return;

    if(game.isExamining())
      session.send(`bsetup fen ${game.board.getFen()}`);

    // Remove castling rights if king or rooks move from initial position
    const newFEN = ChessHelper.adjustCastlingRights(fen, game.fen, game.category);
    if(newFEN !== fen)
      setupBoardCastlingRights(game, ChessHelper.splitFEN(newFEN).castlingRights);

    game.fen = newFEN;
    updateEngine();
  }
}

/**
 * Triggered when a square is clicked on the board
 * @param square the square's coordinates
 */
function squareSelected(square: string) {
  const game = games.focused;

  clearPremoveDests(game); // Clear custom premove dests from the previously selected square

  const prevPieceSelected = game.pieceSelected; // was a piece selected prior to this click?
  game.pieceSelected = game.board.state.selected; // is a piece being selected now?

  const prevPremoveSet = game.premoveSet; // did this click cancel a chessground premove?
  game.premoveSet = game.board.state.premovable.current; // did this click set a chessground premove?

  let cancellingPremove = (prevPremoveSet && !settings.multiplePremovesToggle) 
      || game.element.find('.promotion-panel').is(':visible');

  // If the user clicks the same square twice quickly, without selecting a piece, then cancel multiple premoves
  const prevSquareSelectedTime = game.squareSelectedTime;
  game.squareSelectedTime = Date.now();
  const prevSquareSelected = game.squareSelected;
  game.squareSelected = square;
  const prevSmartMove = game.smartMove;
  game.smartMove = null;

  if(!prevPieceSelected && (!game.pieceSelected || prevSmartMove) && prevSquareSelected === square && prevSquareSelectedTime && game.squareSelectedTime - prevSquareSelectedTime < 300) {
    cancellingPremove = true;
    cancelMultiplePremoves(game);
    updateBoard(game, false, true, false);
  }
  
  // Don't play smart move if the user is setting/cancelling a previous premove or selecting/unselecting a piece
  if(!cancellingPremove && !game.premoveSet && !prevPieceSelected && !game.pieceSelected) {
    const boardRect = game.element.find('.board')[0].getBoundingClientRect();
    const orientation = game.board.state.orientation === 'white' ? 'w' : 'b';
    const squareRect = ChessHelper.getSquareRect(boardRect, square, orientation);
    const coords = lastPointerCoords;
    const edgeDistance = 10;
    if(coords.x >= squareRect.left + edgeDistance && coords.x <= squareRect.right - edgeDistance
        && coords.y >= squareRect.top + edgeDistance && coords.y <= squareRect.bottom - edgeDistance)
      playSmartMove(game, square);
  }

  setPremoveDests(game, square); // Set custom dests for premove (correct castling dests for variants)
}

/**
 * Scroll to the game board which currently has focus
 */
export function scrollToBoard(game?: Game) {
  if(Utils.isSmallWindow()) {
    if(!game || game.element.parent().attr('id') === 'main-board-area') {
      if($('#collapse-chat').hasClass('show')) {
        $('#collapse-chat').collapse('hide'); // this will scroll to board after hiding chat
        return;
      }
      const windowHeight = window.visualViewport ? window.visualViewport.height : $(window).height();
      Utils.safeScrollTo($('#right-panel-header').offset().top + $('#right-panel-header').outerHeight() + parseFloat($('body').css('padding-bottom')) - windowHeight);
    }
    else
      Utils.safeScrollTo(game.element.offset().top);
  }
}

export function movePiece(source: any, target: any, metadata: any, pieceRole?: string, promotePiece?: string) {
  const game = games.focused;

  if(game.isPlaying() && game.history.current() !== game.history.last()) {
    game.history.display(game.history.last(), false);
    return;
  }

  // Show 'Analyze' button once any moves have been made on the board
  showAnalyzeButton();

  if(game.setupBoard)
    return;

  const prevHEntry = game.isPlaying() ? game.history.last() : game.history.current(); 
  const pieces = game.board.state.pieces;
  const targetPiece = pieces.get(target);
  
  if(!pieceRole)
    pieceRole = targetPiece ? ChessHelper.longToShortPieceName(targetPiece.role) : undefined;

  let pieceColor: string;
  if(game.isPlaying())
    pieceColor = game.color;
  else
    pieceColor = targetPiece ? (targetPiece.color === 'white' ? 'w' : 'b') : undefined;

  const isSourcePieceName = !!ChessHelper.longToShortPieceName(source);

  let promote = false;
  if(pieceRole === 'p' && !isSourcePieceName && target.charAt(1) === (pieceColor === 'w' ? '8' : '1')) 
    promote = true;

  const inMove = {
    from: (!isSourcePieceName ? source : ''),
    to: target,
    promotion: promotePiece || (promote ? 'q' : ''),
    piece: isSourcePieceName ? pieceRole : undefined,
  };

  const parsedMove = parseGameMove(game, prevHEntry.fen, inMove);
  const fen = parsedMove ? parsedMove.fen : null;
  const move = parsedMove ? parsedMove.move : inMove;

  if(!parsedMove && SupportedCategories.includes(game.category)) {
    cancelMultiplePremoves(game);
    updateBoard(game, false, true, false);
    return;
  }

  game.movePieceSource = source;
  game.movePieceTarget = target;
  game.movePieceMetadata = metadata;
  game.movePiecePromotion = promotePiece;
  const nextMove = game.history.next();

  if(promote && !promotePiece && !settings.autoPromoteToggle) {
    showPromotionPanel(game);
    game.board.set({ movable: { color: undefined } });
    return;
  }

  if(parsedMove) {
    if(game.history.editMode && game.newVariationMode === NewVariationMode.ASK && nextMove && (!game.isObserving() || game.history.current().parent)) {
      let subFound = false;
      for(const sub of nextMove.subvariations) {
        if(sub.fen === fen)
          subFound = true;
      }
      if(nextMove.fen !== fen && !subFound) {
        createNewVariationMenu(game);
        return;
      }
    }
  }

  if(game.isPlayingOnline() && prevHEntry.turnColor === game.color) 
    sendMove(move);

  if(game.isExamining()) {
    let nextMoveMatches = false;
    if(nextMove
        && ((!move.from && !nextMove.from && move.piece === nextMove.piece) || move.from === nextMove.from)
        && move.to === nextMove.to
        && move.promotion === nextMove.promotion)
      nextMoveMatches = true;

    if(!game.pendingMoves.length)
      game.restoreMove = game.history.current();

    if(nextMoveMatches && !nextMove.isSubvariation && !game.history.scratch())
      session.send('for');
    else
      sendMove(move);
  }

  if(!game.isObserving()) {
    hitClock(game, false);
    game.wtime = game.clock.getWhiteTime();
    game.btime = game.clock.getBlackTime();
  }

  if(parsedMove && parsedMove.move) {
    movePieceAfter(game, move, fen, false);
    if(game.isExamining()) 
      game.pendingMoves.push(game.history.current());
  }

  if(game.role === Role.PLAYING_COMPUTER) // Send move to engine in Play Computer mode
    getComputerMove(game);

  showTab($('#pills-game-tab'));
}

function movePieceAfter(game: Game, move: any, fen: string, serverIssued: boolean) {
  let analyzing = false;
  if(game.isPlaying() && game.history.current() !== game.history.last()) 
    game.history.display(game.history.last()); // go to current position if user is looking at earlier move in the move list
  
  if(fen)
    checkPremoves(game, fen); // For multiple premoves, prunes premoves that are no longer possible (e.g. the piece was captured)

  updateHistory(game, move, fen, serverIssued);
  playPremove(game);
  checkGameEnd(game); // Check whether game is over when playing against computer (offline mode)
}

function preDropPiece(role: string, key: string) {
  if(settings.multiplePremovesToggle) {
    const game = games.focused;   
    addPremove(game, {to: key, piece: ChessHelper.longToShortPieceName(role)});
  }
}

function preMovePiece(source: any, target: any, metadata: any) {
  const game = games.focused;

  if(game.history.current() !== game.history.last()) {
    game.board.cancelPremove();
    game.history.display(game.history.last(), false);
    return;
  }

  if(ChessHelper.longToShortPieceName(source)) // piece drop rather than move
    return;

  const pieces = game.board.state.pieces;
  const sourcePiece = pieces.get(source);
  const pieceRole = sourcePiece ? ChessHelper.longToShortPieceName(sourcePiece.role) : undefined;
  const pieceColor = sourcePiece ? sourcePiece.color : undefined;
  const promote = (pieceRole === 'p' && target.charAt(1) === (pieceColor === 'white' ? '8' : '1'));

  if(promote && !settings.autoPromoteToggle) {  
    game.movePieceSource = source;
    game.movePieceTarget = target;
    game.movePieceMetadata = metadata;
    showPromotionPanel(game);

    if(settings.multiplePremovesToggle) {   
      // Temporarily make premove on the board while waiting for user to select piece from promotion panel
      game.board.set({ animation: { enabled: false }});
      game.board.setPieces([
        [source, null],
        [target, sourcePiece]
      ]);
      game.board.set({ animation: { enabled: true } });
    }
  }
  else if(settings.multiplePremovesToggle) {     
    const move = {
      from: source,
      to: target,
      promotion: promote && settings.autoPromoteToggle ? 'q' : null
    }
    addPremove(game, move);
  }
}

/**
 * In multiple premoves mode, check if the premove is possible then add it to the premove list
 * Update the final premove FEN and display it on the board
 * @move a move object (with to, from, piece, promotion etc)
 */
function addPremove(game: Game, move: any) {
  const fen = game.premoves.length ? game.premovesFen : currentGameMove(game).fen;
  let moveFen = parseGameMove(game, fen, move, true);
  if(moveFen) { 
    if(!game.premoves.length) 
      createPremovesObserver(game); // Tracks chessground square DOM elements to add premove numbers to the squares

    game.premovesFen = moveFen.fen; // Update final premove FEN position
    game.premoves.push(move);
  }
  updateBoard(game, false, true, false);
}

/**
 * Removes any impossible premove and all premoves following it
 * @fen the starting position that premoves are checked from
 */
function checkPremoves(game: Game, fen: string) {
  if(currentGameMove(game).turnColor !== game.color) // Only check premoves after the opponent moves
    return;

  for(let i = 0; i < game.premoves.length; i++) {
    const premove = game.premoves[i];
    let moveFen = parseGameMove(game, fen, premove, true);
    if(!moveFen) { // Remove impossible premove and all following premoves
      game.premoves.splice(i);
      if(!game.premoves.length)
        cancelMultiplePremoves(game);
      break;
    }
    fen = moveFen.fen;
  }

  if(game.premoves.length)
    game.premovesFen = fen; // Update final premove FEN
}

/**
 * Play a premove
 */
function playPremove(game: Game) {
  if(settings.multiplePremovesToggle) {
    if(currentGameMove(game).turnColor === game.color) {
      const premove = game.premoves.shift();
      if(premove) {
        if(!game.premoves.length) 
          cancelMultiplePremoves(game);
        else
          $('.premove-target').each(function() { 
            assignPremoveOrder(game, this) // Update premove order numbers on squares
          });
          
        movePiece(premove.from || ChessHelper.shortToLongPieceName(premove.piece), premove.to, null, premove.piece, premove.promotion);
      }
    }
  }
  else {
    game.board.playPremove();
    game.board.playPredrop(() => true);    
  }
}

/**
 * Create a MutationObserver which adds premove data to chessground 'square' HTML elements after they are 
 * added to the DOM. This allows us to display premove order numbers on the squares.
 */
function createPremovesObserver(game: Game) {
  game.premovesObserver = new MutationObserver((mutations) => {
    for(const mutation of mutations) {
      for(const node of mutation.addedNodes) {
        const elem = node as Element;
        if(elem.nodeType === 1 && elem.classList.contains('premove-target')) {
          assignPremoveOrder(game, elem);
        }
      }
    }
  });
  game.premovesObserver.observe(game.element.find('.board')[0], { childList: true, subtree: true });
}

/**
 * Sets the 'data-order' attribute on a chessground square HTML element to show its premove order
 * when multiple premoves is enabled. 
 */
function assignPremoveOrder(game: Game, elem: any) {
  for(let i = 0; i < game.premoves.length; i++) {   
    if(game.premoves[i].to === elem.cgKey) {
      $(elem).attr('data-order', i + 1);
      break;  
    }
  }
}

/**
 * Hides the promotion panel when the premove is cancelled
 */
function cancelPremove() {
  const game = games.focused;
  const promotionPanel = game.element.find('.promotion-panel');
  if(promotionPanel.length) {
    hidePromotionPanel(game);
    updateBoard(game, false, true, false);
  } 
}

/**
 * Cancels all premoves when multiple premoves mode is enabled 
 * Triggered by right mouse click or long press on touch screen
 */
function cancelMultiplePremoves(game: Game) {
  game.premoves = [];
  game.premovesObserver?.disconnect();
  game.premovesObserver = null;
  game.board.cancelPremove();
  game.board.cancelPredrop();
  game.board.cancelMove();
}

/**
 * Show the correct premove dests for castling when the king is selected (wild variants)
 * @square the square selected 
 */
function setPremoveDests(game: Game, square: string) {
  if(game.isPlaying() && currentGameMove(game).turnColor !== game.color && game.category.startsWith('wild')) {
    /** Correct castling dests for premove */
    const pieces = game.board.state.pieces;
    const piece = pieces.get(square);
    if(piece && piece.role === 'king' && piece.color[0] === game.color) {
      // If there are multiple premoves, use the final premove position 
      let fen = (game.premoves.length ? game.premovesFen : currentGameMove(game).fen);
      fen = ChessHelper.setFENTurnColor(fen, game.color);
      let kingDests = game.board.state.premovable.dests;
      kingDests = ChessHelper.adjustKingDests(kingDests, fen, game.history.first().fen, game.category, true);
      const dests = new Map<string, string[]>();
      dests.set(square, kingDests);
      game.board.set({ 
        premovable: { customDests: dests }
      });
    }
  }
}

/**
 * Clear custom premove dests when a new square is selected
 * @param game 
 */
function clearPremoveDests(game: Game) {
  if(game.board.state.premovable.customDests)
    game.board.set({ 
      premovable: { customDests: null }
    });
}

/**
 * Allows a move to be made by clicking only the destination square. Checks that there is only one piece
 * which can move to that square, otherwise no move is played. 
 * @param square the destination square
 */
function playSmartMove(game: Game, square: string) {
  if(!settings.smartmoveToggle)
    return;

  const pieces = game.board.state.pieces;

  // If there are multiple premoves, check valid premoves from the final premove position
  // Note the new premoves are checked as regualar moves (full validation) 
  let fen = (game.premoves.length ? game.premovesFen : currentGameMove(game).fen);
  if(game.isPlaying() && ChessHelper.getTurnColorFromFEN(fen) !== game.color) {
    const fenWords = ChessHelper.splitFEN(fen);
    fenWords.color = game.color; // Check the move from the perspective of the player's color
    fenWords.enPassant = '-'; // Remove en passant from premove FEN (or chess.js will flag the position as invalid)
    fen = ChessHelper.joinFEN(fenWords);
  }

  let validMove = null;
  for(const [key, value] of pieces) { // Check all pieces to see if they can be moved to the destination square
    const move = {
      from: key,
      to: square,
      piece: ChessHelper.longToShortPieceName(value.role),
      promotion: 'q'
    }
    
    if(parseGameMove(game, fen, move, false)) {
      if(validMove) {
        validMove = null; // Multiple valid source pieces, cancel smart move
        break;
      }             
      validMove = move;
    }
  }
  if(validMove) {
    game.board.set({ events: { select: null } }); // Disable squareSelected event to stop potential infinite loop (just in case)
    game.board.selectSquare(validMove.from); // Play the move/premove by selecting source and destination square
    game.board.selectSquare(validMove.to);
    game.board.set({ events: { select: squareSelected } });  
    game.smartMove = true;    
  }
}

function showPromotionPanel(game: Game) {
  const source = game.movePieceSource;
  const target = game.movePieceTarget;
  const metadata = game.movePieceMetadata;
  const showKing = !SupportedCategories.includes(game.category) && game.category !== 'atomic';
  const premove = game.isPlaying() && game.color !== game.turn;

  const orientation = game.board.state.orientation;
  const color = (target.charAt(1) === '8' ? 'white' : 'black');
  const fileNum = target.toLowerCase().charCodeAt(0) - 97;

  hidePromotionPanel(game);
  const promotionPanel = $('<div class="cg-wrap promotion-panel"></div>');
  promotionPanel.appendTo(game.element.find('.board-container'));
  promotionPanel.css({
    left: `calc(12.5% * ${orientation === 'white' ? fileNum : 7 - fileNum})`,
    height: showKing ? '62.5%' : '50%',
    top: orientation === color ? '0' : '50%',
    display: 'flex'
  });
  if(orientation === color) {
    promotionPanel.html(`
      <piece data-piece="q" class="promotion-piece queen ${color}"></piece>
      <piece data-piece="n" class="promotion-piece knight ${color}"></piece>
      <piece data-piece="r" class="promotion-piece rook ${color}"></piece>
      <piece data-piece="b" class="promotion-piece bishop ${color}"></piece>
      ${showKing ? `<piece data-piece="k" class="promotion-piece king ${color}"></piece>` : ''}
    `);
  }
  else {
    promotionPanel.html(`
      ${showKing ? `<piece data-piece="k" class="promotion-piece king ${color}"></piece>` : ''}
      <piece data-piece="b" class="promotion-piece bishop ${color}"></piece>
      <piece data-piece="r" class="promotion-piece rook ${color}"></piece>
      <piece data-piece="n" class="promotion-piece knight ${color}"></piece>
      <piece data-piece="q" class="promotion-piece queen ${color}"></piece>
    `);
  }

  $('.promotion-piece').on('click', (event) => {
    hidePromotionPanel();
    const promotePiece = $(event.target).attr('data-piece');
    if(!premove)
      movePiece(source, target, metadata, 'p', promotePiece);
    else if(settings.multiplePremovesToggle) 
      addPremove(game, {from: source, to: target, promotion: promotePiece});
  });
}

function hidePromotionPanel(game?: Game) {
  if(!game)
    game = games.focused;

  game.element.find('.promotion-panel').remove();
}

/**
 * When in Edit Mode, if a move is made on the board, display a menu asking if the user wishes to
 * create a new variation or overwrite the existing variation.
 */
function createNewVariationMenu(game: Game) {
  const menu = $(`
    <ul class="context-menu dropdown-menu">
      <li><a class="dropdown-item noselect" data-action="overwrite">Overwrite variation</a></li>
      <li><a class="dropdown-item noselect" data-action="new">New variation</a></li>
    </ul>`);

  const closeMenuCallback = () => {
    updateBoard(game);
  }

  const itemSelectedCallback = (event: any) => {
    const action = $(event.target).data('action');
    if(action === 'new')
      game.newVariationMode = NewVariationMode.NEW_VARIATION;
    else
      game.newVariationMode = NewVariationMode.OVERWRITE_VARIATION;
    movePiece(game.movePieceSource, game.movePieceTarget, game.movePieceMetadata, null, game.movePiecePromotion);
  }

  const x = lastPointerCoords.x;
  const y = (Utils.isSmallWindow() ? lastPointerCoords.y : lastPointerCoords.y + 15);

  Utils.createContextMenu(menu, x, y, itemSelectedCallback, closeMenuCallback, 'top', ['top-start', 'top-end', 'bottom-start', 'bottom-end']);
}

function flipBoard(game: Game) {
  game.board.toggleOrientation();

  // Flip eval bar
  game.element.find('.eval-bar-segment:first-child').appendTo(game.element.find('.eval-bar'));

  // If pawn promotion dialog is open, redraw it in the correct location
  if(game.element.find('.promotion-panel').is(':visible'))
    showPromotionPanel(game);

  // Swap player and opponent status panels
  if(game.element.find('.white-status').parent().hasClass('top-panel')) {
    game.element.find('.white-status').appendTo(game.element.find('.bottom-panel'));
    game.element.find('.black-status').appendTo(game.element.find('.top-panel'));
  }
  else {
    game.element.find('.white-status').appendTo(game.element.find('.top-panel'));
    game.element.find('.black-status').appendTo(game.element.find('.bottom-panel'));
  }

  // Swap pieces in Setup Board panel
  if(game.element.find('.setup-board-white').parent().hasClass('setup-board-top')) {
    game.element.find('.setup-board-white').appendTo(game.element.find('.setup-board-bottom'));
    game.element.find('.setup-board-black').appendTo(game.element.find('.setup-board-top'));
  }
  else {
    game.element.find('.setup-board-white').appendTo(game.element.find('.setup-board-top'));
    game.element.find('.setup-board-black').appendTo(game.element.find('.setup-board-bottom'));
  }
}

/** ***********************
 * MOVE PARSING FUNCTIONS *
 **************************/

/** Wrapper function for parseMove */
function parseGameMove(game: Game, fen: string, move: any, premove = false) {
  if(premove) 
    fen = ChessHelper.setFENTurnColor(fen, game.color);
  
  return ChessHelper.parseMove(fen, move, game.history.first().fen, game.category, game.history.current().variantData, premove);
}

/** Wrapper function for toDests */
function gameToDests(game: Game) {
  const hEntry = game.history.current();
  return ChessHelper.toDests(hEntry.fen, game.history.first().fen, game.category, hEntry.variantData);
}

/** Wrapper function for updateVariantMoveData */
function updateGameVariantMoveData(game: Game) {
  game.history.current().variantData = ChessHelper.updateVariantMoveData(game.history.prev().fen, game.history.current().move, game.history.prev().variantData, game.category);
}

export function parseMovelist(game: Game, movelist: string) {
  let found: RegExpMatchArray | null;
  let n = 1;
  let wtime = game.time * 60000;
  let btime = game.time * 60000;
  let fen: string;

  // We've set 'iset startpos 1' so that the 'moves' command also returns the start position in style12 in cases
  // where the start position is non-standard, e.g. fischer random.
  const match = movelist.match(/^<12>.*/m);
  if(match) {
    // FICS sets the role parameter (my relation to this game) in the style12 to -4, which the parser
    // doesn't parse by default, since we want it to be parsed together with the movelist.
    // Change the role to -3 so it won't get ignored by the parser this time.
    const s = match[0].replace(/(<12> (\S+\s){18})([-\d]+)/, '$1-3');
    const startpos = session.getParser().parse(s);
    fen = startpos.fen;
    game.history.setMetatags({SetUp: '1', FEN: fen});
  }
  else
    fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  game.history.reset(fen, wtime, btime);
  while(found !== null) {
    found = movelist.match(new RegExp(n + '\\.\\s*(\\S*)\\s*\\((\\d+):(\\d+)\.(\\d+)\\)\\s*(?:(\\S*)\\s*\\((\\d+):(\\d+)\.(\\d+)\\))?.*', 'm'));
    if (found !== null && found.length > 4) {
      const m1 = found[1].trim();
      if(m1 !== '...') {
        wtime += (n === 1 ? 0 : game.inc * 1000) - (+found[2] * 60000 + +found[3] * 1000 + +found[4]);
        const parsedMove = parseGameMove(game, fen, m1);
        if(!parsedMove)
          break;
        fen = parsedMove.fen;
        game.history.add(parsedMove.move, parsedMove.fen, false, wtime, btime);
        getOpening(game);
        updateGameVariantMoveData(game);
      }
      if(found.length > 5 && found[5]) {
        const m2 = found[5].trim();
        btime += (n === 1 ? 0 : game.inc * 1000) - (+found[6] * 60000 + +found[7] * 1000 + +found[8]);
        const parsedMove = parseGameMove(game, fen, m2);
        if(!parsedMove)
          break;
        fen = parsedMove.fen;
        game.history.add(parsedMove.move, parsedMove.fen, false, wtime, btime);
        getOpening(game);
        updateGameVariantMoveData(game);
      }
      n++;
    }
  }
}

function updateHistory(game: Game, move?: any, fen?: string, serverIssued = true) {
  // If currently commiting a move list in examine mode. Don't display moves until we've finished
  // sending the move list and then navigated back to the current move.
  if(game.commitingMovelist)
    return;

  if(!fen)
    fen = game.history.last().fen;

  const hEntry = game.history.find(fen);
  let sameMove = false;

  if(!hEntry) {
    if(game.movelistRequested)
      return;

    if(move) {
      let newSubvariation = false;

      if(game.role === Role.NONE || game.isExamining() || (game.isObserving() && !serverIssued)) {
        if(game.history.length() === 0)
          game.history.scratch(true);

        if(game.newVariationMode === NewVariationMode.NEW_VARIATION)
          newSubvariation = true;
        else if(game.newVariationMode === NewVariationMode.OVERWRITE_VARIATION)
          newSubvariation = false;
        else {
          newSubvariation = (!game.history.scratch() && !game.history.current().isSubvariation()) || // Make new subvariation if new move is on the mainline and we're not in scratch mode
              (game.history.editMode && game.history.current() !== game.history.current().last); // Make new subvariation if we are in edit mode and receive a new move from the server. Note: we never overwrite in edit mode unless the user explicitly requests it.
        }

        game.newVariationMode = NewVariationMode.ASK;
      }
      
      let currMove = null;
      if(game.isObserving() && game.history.current() !== game.history.last() && serverIssued) {
        currMove = game.history.current();
        game.history.goto(game.history.last());     
      }

      game.history.add(move, fen, newSubvariation, game.wtime, game.btime);
      getOpening(game);
      updateGameVariantMoveData(game);

      if(currMove) 
        game.history.goto(currMove);   

      $('#game-pane-status').hide();
    }
    else {
      // move not found, request move list
      if(SupportedCategories.includes(game.category)) {
        game.movelistRequested++;
        session.send('iset startpos 1'); // Show the initial board position before the moves list
        session.send(`moves ${game.id}`);
        session.send('iset startpos 0');
      }
      else
        game.history.reset(game.fen, game.wtime, game.btime);
    }
  }
  else {
    if(!game.movelistRequested && game.role !== Role.NONE)
      game.history.updateClockTimes(hEntry, game.wtime, game.btime);

    if(hEntry === game.history.current())
      sameMove = true;

    else if(game.isPlaying() || (game.isObserving() && serverIssued)) {
      if(hEntry !== game.history.last()) 
        cancelMultiplePremoves(game);
      
      while(hEntry !== game.history.last())
        game.history.removeLast(); // move is earlier, we need to take-back
    }
  }

  if(game.isObserving() && game.history.current() !== game.history.last() && serverIssued) {
    game.history.highlightMove();
    updateBoard(game, false, false);
    return; // User is currently viewing an earlier move in the move list, so don't display the new move
  }

  game.history.display(hEntry, move && !sameMove);
  if(!sameMove)
    updateEngine();
}

/** ***************
 * GAME FUNCTIONS *
 ******************/

function createGame(): Game {
  const game = new Game();
  if(!games.length) {
    games.add(game);
    game.element = $('#main-board-area').children().first();
    game.statusElement = $('#game-status-list > :first-child');
    game.moveTableElement = $('#move-table > :first-child');
    game.moveListElement = $('#movelists > :first-child');
    game.board = mainBoard;
  }
  else {
    games.add(game);
    game.element = $('#main-board-area').children().first().clone();
    game.board = createBoard(game.element.find('.board'));
    const orientation = game.element.find('.black-status').parent().hasClass('bottom-panel') ? 'black' : 'white';
    game.board.set({ orientation });
    leaveSetupBoard(game);
    makeSecondaryBoard(game);
    game.element.find('.eval-bar').hide();
    $(window).trigger('resize');
    game.element.find($('[title="Close"]')).css('visibility', 'visible');
    $('#secondary-board-area').css('display', 'flex');
    $('#collapse-chat-arrow').show();
    game.element.find('[data-bs-toggle="tooltip"]').each(function() {
      Utils.createTooltip($(this));
    });

    game.statusElement = games.focused.statusElement.clone();
    game.statusElement.css('display', 'none');
    game.statusElement.appendTo($('#game-status-list'));

    game.moveTableElement = games.focused.moveTableElement.clone();
    game.moveTableElement.css('display', 'none');
    game.moveTableElement.appendTo($('#move-table'));

    game.moveListElement = games.focused.moveListElement.clone();
    game.moveListElement.css('display', 'none');
    game.moveListElement.appendTo($('#movelists'));

    $('#secondary-board-area')[0].scrollTop = $('#secondary-board-area')[0].scrollHeight; // Scroll secondary board area to the bottom
    $('#game-tools-close').parent().show();
  }

  // Event triggered when the game's panel (the board etc) is clicked
  const gameTouchHandler = (event) => {
    if($(event.target).closest('[title="Close"],[title="Maximize"]').length)
      return;

    $(':focus').trigger('blur');
    setGameWithFocus(game); 
    // Status flags that need to be set prior to squareSelected event being called (used by smart move)
    game.pieceSelected = game.board.state.selected; // Tracks whether a piece was currently selected prior to another square being clicked
    game.premoveSet = game.board.state.premovable.current; // Tracks whether the premove was set prior to a square being clicked
  }
  game.element[0].addEventListener('touchstart', gameTouchHandler, {capture: true, passive: true});
  game.element[0].addEventListener('mousedown', gameTouchHandler, {capture: true}); // Use capture to intercept event before chessground does

  game.element.on('click', '[title="Close"]', (event) => {
    if(game.preserved || game.history.editMode)
      closeGameDialog(game);
    else
      closeGame(game);
    event.stopPropagation();
  });

  game.element.on('click', '[title="Maximize"]', () => {
    setGameWithFocus(game);
    maximizeGame(game);
  });

  game.element.on('dblclick', () => {
    if(games.getMainGame() === game)
      return;

    setGameWithFocus(game);
    maximizeGame(game);
  });

  game.clock = new Clock(game, checkGameEnd);
  setRightColumnSizes();

  return game;
}

export function setGameWithFocus(game: Game) {
  if(game !== games.focused) {
    if(games.focused) {
      games.focused.element.removeClass('game-focused');
      games.focused.moveTableElement.hide();
      games.focused.moveListElement.hide();
      games.focused.statusElement.hide();
      games.focused.board.setAutoShapes([]);
    }

    game.moveTableElement.show();
    game.moveListElement.show();
    game.statusElement.show();

    if(game.element.parent().attr('id') === 'secondary-board-area')
      game.element.addClass('game-focused');

    if(games.focused) {
      const engineRunning = games.focused.engineRunning;
      stopEngine();
      games.focused.engineRunning = engineRunning;
    }

    games.focused = game;

    setMovelistViewMode();
    initGameControls(game);

    updateBoard(game);

    if(game.analyzing && game.engineRunning)
      startEngine();
  }
}

function initGameControls(game: Game) {
  if(game !== games.focused)
    return;

  Utils.removeWithTooltips($('.context-menu'));
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

    // show Adjourn button for standard time controls or slower
    if(game.isPlayingOnline() && (game.time + game.inc * 2/3 >= 15 || (!game.time && !game.inc)))
      $('#adjourn').show();
    else
      $('#adjourn').hide();
    $('#playing-game-buttons').show();
  }
  else {
    $('#playing-game-buttons').hide();
    $('#viewing-game-buttons').show();
  }

  $('#takeback').prop('disabled', game.role === Role.PLAYING_COMPUTER);

  if((game.isExamining() || game.isObserving()) && !Utils.isSmallWindow())
    showPanel('#left-panel-header-2');
  else
    hidePanel('#left-panel-header-2');

  if(game.setupBoard)
    showPanel('#left-panel-setup-board');
  else
    hidePanel('#left-panel-setup-board');

  if(game.isExamining())
    Utils.showButton($('#stop-examining'));
  else if(game.isObserving())
    Utils.showButton($('#stop-observing'));

  if(!game.isExamining())
    Utils.hideButton($('#stop-examining'));
  if(!game.isObserving())
    Utils.hideButton($('#stop-observing'));

  if(game.isPlaying())
    showStatusPanel();
  else
    initStatusPanel();
}

function makeMainBoard(game: Game) {
  game.element.detach();
  game.element.removeClass('game-card-sm');
  game.element.removeClass('game-focused');
  game.element.find('.title-bar').css('display', 'none');
  game.element.appendTo('#main-board-area');
  game.board.set({ coordinates: true });
}

function makeSecondaryBoard(game: Game) {
  game.element.detach();
  game.element.find('.top-panel, .bottom-panel').css('height', '');
  game.element.addClass('game-card-sm');
  game.element.find('.title-bar').css('display', 'block');
  game.element.appendTo('#secondary-board-area');
  game.board.set({ coordinates: false });
  if(!Utils.isSmallWindow()) {
    $('body').removeClass('chat-hidden');
  }
}

export function maximizeGame(game: Game) {
  if(games.getMainGame() !== game) {
    Utils.animateBoundingRects(game.element, $('#main-board-area'), game.element.css('--border-expand-color'), game.element.css('--border-expand-width'));

    // Move currently maximized game card to secondary board area
    const prevMaximized = games.getMainGame();
    if(prevMaximized)
      makeSecondaryBoard(prevMaximized);
    else
      $('#main-board-area').empty();
    // Move card to main board area
    makeMainBoard(game);
    setPanelSizes();
    updateBoardStatusText();
  }
  scrollToBoard(game);
}

function isSecondaryBoard(game: Game) {
  return game.element.parent().is($('#secondary-board-area'));
}

function closeGameDialog(game: Game) {
  (window as any).closeGameClickHandler = () => {
    if(game)
      closeGame(game);
  };

  const headerTitle = 'Close Game';
  const bodyText = 'Really close game?';
  const button1 = ['closeGameClickHandler(event)', 'OK'];
  const button2 = ['', 'Cancel'];
  const showIcons = true;
  Dialogs.showFixedDialog({type: headerTitle, msg: bodyText, btnFailure: button2, btnSuccess: button1, icons: showIcons});
}

function closeGame(game: Game) {
  if(!games.includes(game))
    return;

  if(game.isObserving() || game.isExamining())
    gameExitPending.push(game.id);

  if(game.isObserving())
    session.send(`unobs ${game.id}`);
  else if(game.isExamining())
    session.send('unex');
  removeGame(game);
}

function removeGame(game: Game) {
  // remove game from games list
  games.remove(game);

  // if we are removing the main game, choose the most important secondary game to maximize
  if(game.element.parent().is('#main-board-area')) {
    const newMainGame = games.getMostImportantGame();
    maximizeGame(newMainGame);
  }

  // If game currently had the focus, switch focus to the main game
  if(game === games.focused)
    setGameWithFocus(games.getMainGame());

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
    if(!$('#collapse-chat').hasClass('show') && !Utils.isSmallWindow()) {
      $('body').addClass('chat-hidden');
      $(window).trigger('resize');
    }
  }
  setRightColumnSizes();

  if(games.length === 1)
    $('#game-tools-close').parent().hide();
}

function cleanupGame(game: Game) {
  if(playEngine && game.role === Role.PLAYING_COMPUTER) {
    playEngine.terminate();
    playEngine = null;
  }

  game.role = Role.NONE;

  if(game === games.focused) {
    Utils.hideButton($('#stop-observing'));
    Utils.hideButton($('#stop-examining'));
    hidePanel('#left-panel-header-2');
    $('#takeback').prop('disabled', false);
    $('#play-computer').prop('disabled', false);
    $('#playing-game-buttons').hide();
    $('#viewing-game-buttons').show();
    $('#lobby-pane-status').hide();
  }

  game.element.find($('[title="Close"]')).css('visibility', 'visible');
  game.element.find('.title-bar-text').text('');
  game.statusElement.find('.game-id').remove();
  $(`.board-dialog[data-game-id="${game.id}"]`).toast('hide');

  if(chat)
    chat.closeGameTab(game.id);
  hidePromotionPanel(game);
  cancelMultiplePremoves(game);
  game.clock.stopClocks();

  if(game.watchersInterval)
    clearInterval(game.watchersInterval);
  game.watchersInterval = null;
  game.watchers = [];
  game.statusElement.find('.game-watchers').empty();

  game.id = null;
  game.partnerGameId = null;
  game.commitingMovelist = false;
  game.movelistRequested = 0;
  game.mexamineMovelist = null;
  game.gameStatusRequested = false;
  game.board.cancelMove();
  updateBoard(game);
  initStatusPanel();
  initGameTools(game);

  if($('#pills-play').hasClass('active') && $('#pills-lobby').hasClass('active'))
    initLobbyPane();

  game.removeMoveRequested = null;
  game.pendingMoves = [];
  game.restoreMove = null;
}

async function getOpening(game: Game) {
  const historyItem = game.history.current();

  const fetchOpenings = async () => {
    const inputFilePath = 'assets/data/openings.tsv';
    openings = new Map();
    await fetch(inputFilePath)
      .then(response => response.text())
      .then(data => {
        const rows = data.split('\n');
        for(const row of rows) {
          const cols = row.split('\t');
          if(cols.length === 4 && cols[2].startsWith('1.')) {
            const eco = cols[0];
            const name = cols[1];
            const moves = cols[2];
            const fen = cols[3];
            const fenNoPlyCounts = fen.split(' ').slice(0, -2).join(' ');
            openings.set(fenNoPlyCounts, {eco, name, moves});
          }
        }
      })
      .catch(error => {
        Utils.logError('Couldn\'t fetch opening:', error);
      });
  };

  if(!openings && !fetchOpeningsPromise) {
    fetchOpeningsPromise = fetchOpenings();
  }
  await fetchOpeningsPromise;

  const shortFen = historyItem.fen.split(' ').slice(0, -2).join(' '); // Remove ply counts
  const opening = ['blitz', 'lightning', 'untimed', 'standard', 'nonstandard'].includes(game.category)
    ? openings.get(shortFen) : null;
  historyItem.opening = opening;
  game.history.updateOpeningMetatags();
}

/** *********************
 * NAVIGATION FUNCTIONS *
 ************************/

$('#fast-backward').off('click');
$('#fast-backward').on('click', () => {
  fastBackward();
});

function fastBackward() {
  const game = games.focused;
  gotoMove(game.history.first());
  if(!SupportedCategories.includes(game.category) && game.isExamining())
    session.send('back 999');
  showTab($('#pills-game-tab'));
}

$('#backward').off('click');
$('#backward').on('click', () => {
  backward();
});

function backward() {
  const game = games.focused;
  const move = game.history.prev();

  if(move)
    gotoMove(move);
  else if(!SupportedCategories.includes(game.category) && game.isExamining())
    session.send('back');

  showTab($('#pills-game-tab'));
}

$('#forward').off('click');
$('#forward').on('click', () => {
  forward();
});

function forward() {
  const game = games.focused;
  const move = game.history.next();

  if(move)
    gotoMove(move, true);
  else if(!SupportedCategories.includes(game.category) && game.isExamining())
    session.send('forward');

  showTab($('#pills-game-tab'));
}

$('#fast-forward').off('click');
$('#fast-forward').on('click', () => {
  fastForward();
});

function fastForward() {
  const game = games.focused;
  gotoMove(game.history.last());
  if(!SupportedCategories.includes(game.category) && game.isExamining())
    session.send('forward 999');

  showTab($('#pills-game-tab'));
}

$('#exit-subvariation').off('click');
$('#exit-subvariation').on('click', () => {
  exitSubvariation();
});

function exitSubvariation() {
  const curr = games.focused.history.current();
  const prev = curr.first.prev;
  gotoMove(prev);
  showTab($('#pills-game-tab'));
}

export function gotoMove(to: HEntry, playSound = false) {
  const game = games.focused;

  if(!to && to !== game.history.current())
    return;

  if(game.isExamining() && !game.setupBoard) {
    let from = game.history.current();

    if(!game.pendingMoves.length)
      game.restoreMove = from;
    
    let curr = from;
    let index = 0;
    while(curr) {
      curr.visited = index;
      curr = curr.prev;
      index++;
    }
    const path = [];
    curr = to;
    while(curr && curr.visited === undefined) {
      path.push(curr);
      curr = curr.prev;
    }

    const backNum = curr.visited;
    if(backNum > 0) {
      session.send(`back ${backNum}`);
      game.pendingMoves.push(curr);
    }

    while(from) {
      from.visited = undefined;
      from = from.prev;
    }

    let forwardNum = 0;
    if(!game.history.scratch()) {
      for(let i = path.length - 1; i >= 0; i--) {
        if(path[i].isSubvariation())
          break;
        curr = path[i];
        forwardNum++;
      }
      if(forwardNum > 0) {
        session.send(`for ${forwardNum}`);
        game.pendingMoves.push(curr);
      }
    }

    for(let i = path.length - forwardNum - 1; i >= 0; i--) {
      sendMove(path[i].move);
      game.pendingMoves.push(path[i]);
    }
  }

  game.history.display(to, playSound);
  updateEngine();
  if(game.setupBoard)
    updateSetupBoard(game);
}

function sendMove(move: any) {
  session.send(ChessHelper.moveToCoordinateString(move));
}

/**
 * Returns the game's current position. I.e. the move where new moves will be added from
 * This is different to game.history.current() which returns the move currently being viewed.
 */
function currentGameMove(game: Game): HEntry {
  return (game.isPlaying() || game.isObserving() ? game.history?.last() : game.history?.current());
}

/** *********************
 * LEFT MENUS FUNCTIONS *
 ************************/

$('#collapse-menus').on('hidden.bs.collapse', () => {
  activeTab = $('#pills-tab button').filter('.active');
  $('#pills-placeholder-tab').tab('show'); // switch to a hidden tab in order to hide the active one

  $('#collapse-menus').removeClass('collapse-init');
});

$('#collapse-menus').on('show.bs.collapse', () => {
  Utils.scrollToTop();

  if(activeTab.attr('id') === 'pills-placeholder-tab')
    activeTab = $('#pills-play-tab');

  activeTab.tab('show');
});

$('#collapse-menus').on('shown.bs.collapse', () => {
  setLeftColumnSizes();
});

$('#pills-tab button').on('shown.bs.tab', function() {
  if($(this).attr('id') !== 'pills-placeholder-tab')
    activeTab = $(this);

  newTabShown = true;
  setTimeout(() => { newTabShown = false; }, 0);
});

$('#pills-tab button').on('click', function() {
  if(!newTabShown)
    $('#collapse-menus').collapse('hide');
  else {
    activeTab = $(this);
    $('#collapse-menus').collapse('show');
    Utils.scrollToTop();
  }
});

export function showTab(tab: any) {
  if($('#collapse-menus').hasClass('show'))
    tab.tab('show');
  else
    activeTab = tab;
}

function showPanel(id: string) {
  const elem = $(id);
  elem.show();

  if(elem.closest('#left-col'))
    setLeftColumnSizes();
  else if(elem.closest('#right-col'))
    setRightColumnSizes();
  else
    setPanelSizes();
}

function hidePanel(id: string) {
  const elem = $(id);
  elem.hide();

  if(elem.closest('#left-col'))
    setLeftColumnSizes();
  else if(elem.closest('#right-col'))
    setRightColumnSizes();
  else
    setPanelSizes();
}

$('#stop-observing').on('click', () => {
  session.send(`unobs ${games.focused.id}`);
});

$('#stop-examining').on('click', () => {
  session.send('unex');
});

/** ********************
 * PLAY PANEL FUCTIONS *
 ***********************/

$(document).on('shown.bs.tab', 'button[data-bs-target="#pills-play"]', () => {
  if($('#pills-lobby').hasClass('active'))
    initLobbyPane();
  else if($('#pills-pairing').hasClass('active'))
    initPairingPane();
});

$(document).on('hidden.bs.tab', 'button[data-bs-target="#pills-play"]', () => {
  $('#play-computer-modal').modal('hide');
  leaveLobbyPane();
});

$('#quick-game').on('click', () => {
  if(!games.getPlayingExaminingGame())
    session.send('getga');
});

/** PLAY COMPUTER FUNCTIONS **/

$('#play-computer-modal').on('show.bs.modal', () => {
  $('#play-computer-start-from-pos').removeClass('is-invalid');
});

$('#play-computer-form').on('submit', (event) => {
  event.preventDefault();

  const params = {
    playerColorOption: $('[name="play-computer-color"]:checked').next().text(),
    playerColor: '',
    playerTime: +$('#play-computer-min').val(),
    playerInc: +$('#play-computer-inc').val(),
    gameType: $('[name="play-computer-type"]:checked').next().text(),
    difficulty: $('[name="play-computer-level"]:checked').next().text(),
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  };

  if($('#play-computer-start-from-pos').prop('checked')) {
    const game = games.focused;
    if(game.setupBoard)
      params.fen = getSetupBoardFEN(game);
    else {
      const fen = game.history.current().fen;
      const fenWords = ChessHelper.splitFEN(fen);
      fenWords.plyClock = '0';
      fenWords.moveNo = '1';
      params.fen = ChessHelper.joinFEN(fenWords);
    }

    const category = params.gameType === 'Chess960' ? 'wild/fr' : params.gameType.toLowerCase();

    const err = ChessHelper.validateFEN(params.fen, category);
    if(err) {
      $('#play-computer-start-from-pos').addClass('is-invalid');
      return;
    }

    if(game.setupBoard && !game.isExamining())
      leaveSetupBoard(game);
  }
  else if(params.gameType === 'Chess960')
    params.fen = ChessHelper.generateChess960FEN();

  $('#play-computer-modal').modal('hide');

  if(params.playerColorOption === 'Any') {
    if(!lastComputerGame)
      params.playerColor = (Math.random() < 0.5 ? 'White' : 'Black');
    else
      params.playerColor = (lastComputerGame.playerColor === 'White' ? 'Black' : 'White');
  }
  else
    params.playerColor = params.playerColorOption;

  lastComputerGame = params;
  playComputer(params);
});

function playComputer(params: any) {
  const computerGame = games.getComputerGame();
  let game: Game;
  if(computerGame) {
    cleanupGame(computerGame);
    game = computerGame;
  }
  else if(!settings.multiboardToggle)
    game = games.getMainGame();
  else {
    game = games.getFreeGame();
    if(!game)
      game = createGame();
  }

  game.id = -1;

  const playerName = (session.isConnected() ? session.getUser() : 'Player');
  let playerTimeRemaining = params.playerTime * 60000;
  if(params.playerTime === 0) {
    if(params.playerInc === 0)
      playerTimeRemaining = null; // untimed game
    else
      playerTimeRemaining = 10000; // if initial player time is 0, player gets 10 seconds
  }

  let wname = (params.playerColor === 'White' ? playerName : 'Computer');
  let bname = (params.playerColor === 'Black' ? playerName : 'Computer');
  const category = params.gameType === 'Chess960' ? 'wild/fr' : params.gameType.toLowerCase();
  const turnColor = ChessHelper.getTurnColorFromFEN(params.fen);

  const data = {
    fen: params.fen,                        // game state
    turn: turnColor,                        // color whose turn it is to move ("B" or "W")
    id: -1,                                 // The game number
    wname,                                  // White's name
    bname,                                  // Black's name
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
    category,                               // game variant or type
    color: params.playerColor === 'White' ? 'w' : 'b',
    difficulty: params.difficulty,          // Computer difficulty level
  }

  // Show game status mmessage
  const computerName = `Computer (Lvl ${params.difficulty})`;
  if(params.playerColor === 'White')
    bname = computerName;
  else
    wname = computerName;

  const time = params.playerTime === 0 && params.playerInc === 0
    ? '' : ` ${params.playerTime} ${params.playerInc}`;
  const gameType = params.gameType !== 'Standard' ? ` ${params.gameType}` : '';

  const statusMsg = `${wname} vs. ${bname}${gameType}${time}`;
  showStatusMsg(game, statusMsg);

  messageHandler(data);
}

function getPlayComputerEngineOptions(game: Game): object {
  const skillLevels = [0, 1, 2, 3, 5, 7, 9, 11, 13, 15, 17, 20]; // Skill Level for each difficulty level

  const engineOptions = {
    ...(settings.engineThreads > 1 && { Threads: settings.engineThreads }),   
    ...(game.category === 'wild/fr' && { UCI_Chess960: true }),
    ...(game.category === 'crazyhouse' && { UCI_Variant: game.category }),
    'Skill Level': skillLevels[game.difficulty - 1],
  }

  return engineOptions;
}

function getPlayComputerMoveParams(game: Game): string {
  // Max nodes for each difficulty level. This is also used to limit the engine's thinking time
  // but in a way that keeps the difficulty the same across devices
  const maxNodes = [100000, 200000, 300000, 400000, 500000, 600000, 700000, 800000, 900000, 1000000, 1000000, 1000000];
  const moveParams = `nodes ${maxNodes[game.difficulty - 1]}`;

  return moveParams;
}

function playComputerBestMove(game: Game, bestMove: string, score = '=0.00') {
  if(!bestMove)
    return;

  const move = bestMove[1] === '@' // Crazyhouse/bughouse
    ? {
      piece: bestMove[0].toLowerCase(),
      from: null,
      to: bestMove.slice(2,4)
    }
    : {
      from: bestMove.slice(0,2),
      to: bestMove.slice(2,4),
      promotion: (bestMove.length === 5 ? bestMove[4] : undefined)
    };

  game.lastComputerMoveEval = score;

  const parsedMove = parseGameMove(game, game.history.last().fen, move);

  const moveData = {
    role: Role.PLAYING_COMPUTER,                      // game mode
    id: -1,                                           // game id, always -1 for playing computer
    fen: parsedMove.fen,                              // board/game state
    turn: ChessHelper.getTurnColorFromFEN(parsedMove.fen), // color whose turn it is to move ("B" or "W")
    wtime: game.clock.getWhiteTime(),                      // White's remaining time
    btime: game.clock.getBlackTime(),                      // Black's remaining time
    moveNo: ChessHelper.getMoveNoFromFEN(parsedMove.fen), // the number of the move about to be made
    moveVerbose: parsedMove,                          // verbose coordinate notation for the previous move ("none" if there werenone) [note this used to be broken for examined games]
    move: parsedMove.move.san,                        // pretty notation for the previous move ("none" if there is none)
  }
  messageHandler(moveData);
}

// Get Computer's next move either from the opening book or engine
async function getComputerMove(game: Game) {
  let bookMove = '';
  if(game.category === 'standard') { // only use opening book with normal chess
    const fen = game.history.last().fen;
    const moveNo = ChessHelper.getMoveNoFromFEN(fen);
    // Cool-down function for deviating from the opening book. The chances of staying in book
    // decrease with each move
    const coolDownParams = [
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
      { slope: 0.2, shift: 4.0 }, // 11
      { slope: 0.2, shift: 4.0 }, // 12
    ];
    const a = coolDownParams[game.difficulty - 1].slope;
    const b = coolDownParams[game.difficulty - 1].shift;
    const x = moveNo;
    const sigma = 1 / (1 + Math.exp(a*x - b));
    if(Math.random() < sigma) {
      // Use book move (if there is one)
      const bookMoves = await getBookMoves(fen);
      const totalWeight = bookMoves.reduce((acc, curr) => acc + curr.weight, 0);
      const rValue = Math.random();
      let probability = 0;
      for(const bm of bookMoves) {
        probability += bm.weight / totalWeight; // polyglot moves are weighted based on number of wins and draws
        if(rValue <= probability) {
          bookMove = `${bm.from}${bm.to}`;
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

async function getBookMoves(fen: string): Promise<any[]> {
  if(!book)
    book = new Polyglot('assets/data/gm2600.bin');

  const entries = await book.getMovesFromFen(fen);
  return entries;
}

(window as any).rematchComputer = () => {
  if(lastComputerGame.playerColorOption === 'Any')
    lastComputerGame.playerColor = (lastComputerGame.playerColor === 'White' ? 'Black' : 'White');
  playComputer(lastComputerGame);
};

function checkGameEnd(game: Game) {
  if(game.role !== Role.PLAYING_COMPUTER)
    return;

  const lastMove = game.history.last();
  let gameEnded = false;
  let isDraw = false;
  let winner = '';
  let loser = ''
  let reason: Reason
  let reasonStr: string;
  let scoreStr: string;
  const fen = lastMove.fen;
  const variantData = lastMove.variantData;
  const turnColor = lastMove.turnColor;
  const gameStr = `(${game.wname} vs. ${game.bname})`;

  // Check white or black is out of time
  if(game.clock.getWhiteTime() < 0 || game.clock.getBlackTime() < 0) {
    const wtime = game.clock.getWhiteTime();
    const btime = game.clock.getBlackTime();

    // Check if the side that is not out of time has sufficient material to mate, otherwise its a draw
    let insufficientMaterial = false;
    if(wtime < 0)
      insufficientMaterial = ChessHelper.insufficientMaterial(fen, variantData, 'b');
    else if(btime < 0)
      insufficientMaterial = ChessHelper.insufficientMaterial(fen, variantData, 'w');

    if(insufficientMaterial) {
      reasonStr = `${wtime < 0 ? game.wname : game.bname} ran out of time and ${wtime >= 0 ? game.wname : game.bname} has no material to mate`;
      isDraw = true;
    }
    else {
      winner = (wtime >= 0 ? game.wname : game.bname);
      loser = (wtime < 0 ? game.wname : game.bname);
      reason = Reason.TimeForfeit;
      reasonStr = `${loser} forfeits on time`;
      scoreStr = (winner === game.wname ? '1-0' : '0-1');
    }
    gameEnded = true;
  }
  else if(lastMove.move.san.includes('#')) {
    winner = (turnColor === 'w' ? game.bname : game.wname);
    loser = (turnColor === 'w' ? game.wname : game.bname);
    reason = Reason.Checkmate;
    reasonStr = `${loser} checkmated`;
    scoreStr = (winner === game.wname ? '1-0' : '0-1');

    gameEnded = true;
  }
  else if(game.history.isThreefoldRepetition()) {
    reasonStr = 'Game drawn by repetition';
    isDraw = true;
  }
  else if(ChessHelper.insufficientMaterial(fen, variantData)) {
    reasonStr = 'Neither player has mating material';
    isDraw = true;
  }
  else if(ChessHelper.stalemate(fen, variantData)) {
    reasonStr = 'Game drawn by stalemate';
    isDraw = true;
  }
  else if(ChessHelper.fiftyMoves(fen)) {
    reasonStr = 'Game drawn by the 50 move rule';
    isDraw = true;
  }

  if(isDraw) {
    reason = Reason.Draw;
    scoreStr = '1/2-1/2';
    gameEnded = true;
  }

  if(gameEnded) {
    const gameEndData = {
      game_id: -1,
      winner,
      loser,
      reason,
      score: scoreStr,
      message: `${gameStr} ${reasonStr} ${scoreStr}`
    };
    messageHandler(gameEndData);
  }
}

/** PAIRING PANE FUNCTIONS **/

$(document).on('shown.bs.tab', 'button[data-bs-target="#pills-pairing"]', () => {
  initPairingPane();
});

function initPairingPane() {
  // If user has changed from unregistered to registered or vice versa, set Rated/Unrated option
  // in pairing panel appopriately.
  if(session && isRegistered !== session.isRegistered()) {
    isRegistered = session.isRegistered();
    $('#rated-unrated-button').text((isRegistered ? 'Rated' : 'Unrated'));
  }
}

function clearMatchRequests() {
  handleOffers([{
    type: 'sr',
    ids: [],
  },
  { type: 'pt',
    ids: [],
  }]);
}

$('#custom-control').on('submit', (event) => {
  event.preventDefault();

  $('#custom-control-go').trigger('focus');
  const min: string = Utils.getValue('#custom-control-min');
  storage.set('pairing-custom-min', min);
  const inc: string = Utils.getValue('#custom-control-inc');
  storage.set('pairing-custom-inc', inc)
  getGame(+min, +inc);

  return false;
});

$('#formula-toggle').on('change', function() {
  storage.set('seeks-use-formula', String($(this).is(':checked')));
});

function getGame(min: number, sec: number) {
  let opponent = Utils.getValue('#opponent-player-name')
  opponent = opponent.trim().split(/\s+/)[0];
  $('#opponent-player-name').val(opponent);

  const useFormula = $('#formula-toggle').is(':checked') ? ' f' : ''; 
  const ratedUnrated = ($('#rated-unrated-button').text() === 'Rated' ? 'r' : 'u');
  const colorName = $('#player-color-button').text();
  let color = '';
  if(colorName === 'White')
    color = 'W ';
  else if(colorName === 'Black')
    color = 'B ';

  awaiting.set('match');

  const cmd: string = (opponent !== '') ? `match ${opponent}` : `seek${useFormula}`;
  const mainGame = games.getPlayingExaminingGame();
  if(mainGame && mainGame.isExamining())
    session.send('unex');
  session.send(`${cmd} ${min} ${sec} ${ratedUnrated} ${color}${newGameVariant}`);
}
(window as any).getGame = getGame;

(window as any).setNewGameColor = (option: string) => {
  $('#player-color-button').text(option);
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

(window as any).setNewGameVariant = (title: string, command: string) => {
  newGameVariant = command;
  $('#variants-button').text(title);
  if(command === 'bughouse')
    $('#opponent-player-name').attr('placeholder', 'Enter opponent\'s username');
  else
    $('#opponent-player-name').attr('placeholder', 'Anyone');
};

$('#puzzlebot').on('click', () => {
  session.send('t puzzlebot getmate');
  showTab($('#pills-game-tab'));
});

/** LOBBY PANE FUNCTIONS **/

$(document).on('shown.bs.tab', 'button[data-bs-target="#pills-lobby"]', () => {
  initLobbyPane();
});

function initLobbyPane() {
  const game = games.getPlayingExaminingGame();
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

    if(settings.lobbyShowComputersToggle) {
      $('#lobby-show-computers-icon').removeClass('fa-eye-slash');
      $('#lobby-show-computers-icon').addClass('fa-eye');
    }
    else {
      $('#lobby-show-computers-icon').removeClass('fa-eye');
      $('#lobby-show-computers-icon').addClass('fa-eye-slash');
    }

    if(settings.lobbyShowUnratedToggle) {
      $('#lobby-show-unrated-icon').removeClass('fa-eye-slash');
      $('#lobby-show-unrated-icon').addClass('fa-eye');
    }
    else {
      $('#lobby-show-unrated-icon').removeClass('fa-eye');
      $('#lobby-show-unrated-icon').addClass('fa-eye-slash');
    }

    $('#lobby-show-computers').prop('checked', settings.lobbyShowComputersToggle);
    $('#lobby-show-unrated').prop('checked', settings.lobbyShowUnratedToggle);
    $('#lobby').show();
    $('#lobby-table').html('');
    lobbyScrolledToBottom = true;
    awaiting.set('lobby');
    lobbyEntries.clear();
    session.send('iset seekremove 1');
    session.send('iset seekinfo 1');
  }
}

$(document).on('hidden.bs.tab', 'button[data-bs-target="#pills-lobby"]', () => {
  leaveLobbyPane();
});

function leaveLobbyPane() {
  if(awaiting.resolve('lobby')) {
    $('#lobby-table').html('');
    if(session && session.isConnected()) {
      session.send('iset seekremove 0');
      session.send('iset seekinfo 0');
    }
  }
}

$('#lobby-show-computers').on('change', function () {
  settings.lobbyShowComputersToggle = $(this).is(':checked');
  storage.set('lobbyshowcomputers', String(settings.lobbyShowComputersToggle));
  initLobbyPane();
});

$('#lobby-show-unrated').on('change', function () {
  settings.lobbyShowUnratedToggle = $(this).is(':checked');
  storage.set('lobbyshowunrated', String(settings.lobbyShowUnratedToggle));
  initLobbyPane();
});

$('#lobby-table-container').on('scroll', () => {
  const container = $('#lobby-table-container')[0];
  lobbyScrolledToBottom = container.scrollHeight - container.clientHeight < container.scrollTop + 1.5;
});

function formatLobbyEntry(seek: any): string {
  const title = (seek.title !== '' ? `(${seek.title})` : '');
  const color = (seek.color !== '?' ? ` ${seek.color}` : '');
  const rating = (seek.rating !== '' ? `(${seek.rating})` : '');
  return `${seek.toFrom}${title}${rating} ${seek.initialTime} ${seek.increment} `
    + `${seek.ratedUnrated} ${seek.category}${color}`;
}

(window as any).acceptSeek = (id: number) => {
  awaiting.set('match');
  session.send(`play ${id}`);
};

/** ************************
 * OBSERVE PANEL FUNCTIONS *
 ***************************/

$(document).on('shown.bs.tab', 'button[data-bs-target="#pills-observe"]', () => {
  initObservePane();
});

function initObservePane() {
  awaiting.remove('obs');
  $('#games-table').html('');
  if(session && session.isConnected()) {
    awaiting.set('games');
    session.send('games');
  }
}

$('#observe-user').on('submit', (event) => {
  event.preventDefault();
  $('#observe-go').trigger('focus');
  observe();
  return false;
});

(window as any).observeGame = (id: string) => {
  observe(id);
};

function observe(id?: string) {
  if(!id) {
    id = Utils.getValue('#observe-username');
    id = id.trim().split(/\s+/)[0];
    $('#observe-username').val(id);
  }
  if(id.length > 0) {
    awaiting.set('obs');
    session.send(`obs ${id}`);
  }
}

function showGames(gamesStr: string) {
  if(!$('#pills-observe').hasClass('active'))
    return;

  $('#observe-pane-status').hide();

  for(const g of gamesStr.split('\n').slice(0, -2).reverse()) {
    const match = g.match(/\s*(\d+)\s+(\(Exam\.\s+)?(\S+)\s+(\w+)\s+(\S+)\s+(\w+)\s*(\)\s+)?(\[\s*)(\w+)(.*)/);
    if(match) {
      const id = match[1];

      if(match[9].startsWith('p')) // Don't list private games
        continue;

      computerList.forEach(comp => {
        if(comp === match[4] || (match[4].length >= 10 && comp.startsWith(match[4])))
          match[4] += '(C)';
        if(comp === match[6] || (match[6].length >= 10 && comp.startsWith(match[6])))
          match[6] += '(C)';
      });

      const gg = match.slice(1).join(' ')
      $('#games-table').append(
        `<button type="button" class="w-100 btn btn-outline-secondary" onclick="observeGame('${id}');">`
          + `${gg}</button>`);
    }
  }
}

/** ************************
 * HISTORY PANEL FUNCTIONS *
 ***************************/

$(document).on('shown.bs.tab', 'button[data-bs-target="#pills-history"]', () => {
  initHistoryPane();
});

function initHistoryPane() {
  awaiting.remove('history');
  $('#history-table').html('');
  let username = Utils.getValue('#history-username');
  if(!username && session) {
    username = session.getUser();
    $('#history-username').val(username);
  }
  getHistory(username);
}

$('#history-user').on('submit', (event) => {
  event.preventDefault();
  $('#history-go').trigger('focus');
  const username = Utils.getValue('#history-username');
  getHistory(username);
  return false;
});

function getHistory(user: string) {
  if (session && session.isConnected()) {
    user = user.trim().split(/\s+/)[0];
    if(user.length === 0)
      user = session.getUser();
    $('#history-username').val(user);
    awaiting.set('history');
    session.send(`hist ${user}`);
  }
}

export function parseHistory(history: string) {
  const h = history.split('\n');
  h.splice(0, 2);
  return h;
}

function showHistory(user: string, history: string) {
  if (!$('#pills-history').hasClass('active')) {
    return;
  }

  $('#history-pane-status').hide();
  $('#history-table').html('');

  const exUser = Utils.getValue('#history-username');
  if (exUser.localeCompare(user, undefined, { sensitivity: 'accent' }) !== 0) {
    return;
  }
  const hArr = parseHistory(history);
  for(let i = hArr.length - 1; i >= 0; i--) {
    const id = hArr[i].slice(0, hArr[i].indexOf(':')).trim();
    $('#history-table').append(
      `<button type="button" class="w-100 btn btn-outline-secondary" onclick="examineGame('${user}', `
        + `'${id}');">${hArr[i]}</button>`);
  }
}

(window as any).examineGame = (user, id) => {
  const game = games.getPlayingExaminingGame();
  if(game && game.isExamining())
    session.send('unex');
  session.send(`ex ${user} ${id}`);
};

/** *********************
 * GAME PANEL FUNCTIONS *
 ************************/

$(document).on('show.bs.tab', 'button[data-bs-target="#pills-game"]', () => {
  if($('#game-list-view').is(':checked'))
    $('#left-panel').addClass('list-view-showing');
});

$(document).on('hide.bs.tab', 'button[data-bs-target="#pills-game"]', () => {
  $('#left-panel').removeClass('list-view-showing');
});

(window as any).showGameTab = () => {
  showTab($('#pills-game-tab'));
};

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

/**
 * Create right-click and long press trigger events for displaying the context menu when right clicking a move
 * in the move list.
 */
Utils.createContextMenuTrigger((event) => {
  const target = $(event.target);
  return !!(target.closest('.selectable').length || target.closest('.move').length
      || (target.closest('.comment').length && event.type === 'contextmenu'));
}, createMoveContextMenu);

/**
 * Create context menu after a move (or associated comment) is right-clicked, with options for adding
 * comments / annotations, deleting the move (and all following moves in that variation), promoting the
 * variation etc.
 */
function createMoveContextMenu(cmEvent: any) {
  const contextMenu = $('<ul class="context-menu dropdown-menu"></ul>');
  let moveElement: JQuery<HTMLElement>;
  if($(cmEvent.target).closest('.comment-before').length)
    moveElement = $(cmEvent.target).next();
  else if($(cmEvent.target).closest('.comment-after').length)
    moveElement = $(cmEvent.target).prev();
  else if($(cmEvent.target).closest('.outer-move').length)
    moveElement = $(cmEvent.target).closest('.outer-move');
  else
    moveElement = $(cmEvent.target).closest('.selectable');

  moveElement.find('.move').addClass('hovered'); // Show the :hovered style while menu is displayed

  const hEntry = moveElement.data('hEntry');
  const game = games.focused;

  if(hEntry === hEntry.first || (!hEntry.parent && hEntry.prev === hEntry.first)) {
    // If this is the first move in a subvariation, allow user to add a comment both before and after the move.
    // The 'before comment' allows the user to add a comment for the subvariation in general.
    contextMenu.append('<li><a class="dropdown-item noselect" data-action="edit-comment-before">Edit Comment Before</a></li>');
    contextMenu.append('<li><a class="dropdown-item noselect" data-action="edit-comment-after">Edit Comment After</a></li>');
  }
  else
    contextMenu.append('<li><a class="dropdown-item noselect" data-action="edit-comment-after">Edit Comment</a></li>');
  if(hEntry.nags.length)
    contextMenu.append('<li><a class="dropdown-item noselect" data-action="delete-annotation">Delete Annotation</a></li>');
  if((!game.isObserving() && !game.isPlaying()) || hEntry.parent) 
    contextMenu.append('<li><a class="dropdown-item noselect" data-action="delete-move">Delete Move</a></li>');
  if(hEntry.parent && ((!game.isObserving() && !game.isPlaying()) || hEntry.parent.parent))
    contextMenu.append('<li><a class="dropdown-item noselect" data-action="promote-variation">Promote Variation</a></li>');
  if((!game.isObserving() && !game.isPlaying()) && !hEntry.parent && hEntry.prev !== hEntry.first)
    contextMenu.append('<li><a class="dropdown-item noselect" data-action="make-continuation">Make Continuation</a></li>');
  
  contextMenu.append('<li><a class="dropdown-item noselect" data-action="clear-all-analysis">Clear All Analysis</a></li>');
  contextMenu.append('<li><hr class="dropdown-divider"></li>');
  let annotationsHtml = '<div class="annotations-menu annotation">';
  for(const a of History.annotations)
    annotationsHtml += `<li><a class="dropdown-item noselect" data-bs-toggle="tooltip" data-nags="${a.nags}" title="${a.description}">${a.symbol}</a></li>`;
  annotationsHtml += '</div>';
  contextMenu.append(annotationsHtml);
  contextMenu.find('[data-bs-toggle="tooltip"]').each((index, element) => {
    Utils.createTooltip($(element));
  });

  /** Called when menu item is selected */
  const moveContextMenuItemSelected = (event: any) => {
    moveElement.find('.move').removeClass('hovered');
    const target = $(event.target);
    const nags = target.attr('data-nags');
    if(nags) {
      game.history.setAnnotation(hEntry, nags);
      updateGamePreserved(game, true);
      if(hEntry.parent)
        updateEditMode(game, true);
    }
    else {
      const action = target.attr('data-action');
      switch(action) {
        case 'edit-comment-before':
          setViewModeList(); // Switch to List View so the user can edit the comment in-place.
          gotoMove(hEntry);
          game.history.editCommentBefore(hEntry);
          updateGamePreserved(game, true);
          if(hEntry.parent)
            updateEditMode(game, true);
          break;
        case 'edit-comment-after':
          setViewModeList();
          gotoMove(hEntry);
          game.history.editCommentAfter(hEntry);
          updateGamePreserved(game, true);
          if(hEntry.parent)
            updateEditMode(game, true);
          break;
        case 'delete-annotation':
          game.history.removeAnnotation(hEntry);
          break;
        case 'delete-move':
          deleteMove(game, hEntry);
          break;
        case 'promote-variation':
          let pCurrent: HEntry;
          if(game.isExamining() && !game.history.scratch() && hEntry.depth() === 1) {
            // If we are promoting a subvariation to the mainline, we need to 'commit' the new mainline
            pCurrent = game.history.current();
            gotoMove(hEntry.last);
            session.send('commit');
          }
          game.history.promoteSubvariation(hEntry);
          if(pCurrent)
            gotoMove(pCurrent);

          updateEditMode(game, true);
          if(!game.history.hasSubvariation())
            $('#exit-subvariation').hide();
          break;
        case 'make-continuation':
          let cCurrent: HEntry;
          if(game.isExamining() && !game.history.scratch() && hEntry.depth() === 0) {
            cCurrent = game.history.current();
            gotoMove(hEntry.prev);
            session.send('truncate');
          }
          game.history.makeContinuation(hEntry);
          if(cCurrent)
            gotoMove(cCurrent);
          updateEditMode(game, true);
          $('#exit-subvariation').show();
          break;
        case 'clear-all-analysis':
          clearAnalysisDialog(game);
          break;
      }
    }
  };

  const moveContextMenuClose = () => {
    moveElement.find('.move').removeClass('hovered');
  }

  const coords = Utils.getTouchClickCoordinates(cmEvent);
  Utils.createContextMenu(contextMenu, coords.x, coords.y, moveContextMenuItemSelected, moveContextMenuClose);
}

/**
 * Removes a move (and all following moves) from the move list / move table
 */
function deleteMove(game: Game, entry: HEntry) {
  if(game.history.current().isPredecessor(entry)) {
    // If the current move is on the line we are just about to delete, we need to back out of it first
    // before deleting the line.
    gotoMove(entry.prev);
    if(game.isExamining()) {
      game.removeMoveRequested = entry;
      return;
    }
  }

  game.history.remove(entry);
  evalEngine?.evaluate();
  if(!game.history.hasSubvariation())
    $('#exit-subvariation').hide();
}

/**
 * Removes all sub-variations, comments and annotations from the move-list / move-table
 */
function clearAnalysisDialog(game: Game) {
  (window as any).clearAnalysisClickHandler = () => {
    if(game) {
      // Delete all subvariations from the main line
      let hEntry = game.history.first();
      while(hEntry) {
        for(let i = hEntry.subvariations.length - 1; i >= 0; i--)
          deleteMove(game, hEntry.subvariations[i]);
        hEntry = hEntry.next;
      }
      game.history.removeAllAnnotations();
      game.history.removeAllComments();
    }
  };

  const headerTitle = 'Clear All Analysis';
  const bodyText = 'Really clear all analysis?';
  const button1 = ['clearAnalysisClickHandler(event)', 'OK'];
  const button2 = ['', 'Cancel'];
  const showIcons = true;
  Dialogs.showFixedDialog({type: headerTitle, msg: bodyText, btnFailure: button2, btnSuccess: button1, icons: showIcons});
}

/** GAME PANEL TOOLBAR AND TOOL MENU FUNCTIONS **/

/**
 * Initializes the controls in the Game Panel toolbar and tool menu when a game gains the focus
 * or when a game starts or ends
 */
function initGameTools(game: Game) {
  if(game === games.focused) {
    updateGamePreserved(game);
    updateEditMode(game);
    $('#game-tools-clone').parent().toggle(settings.multiboardToggle); // Only show 'Duplicate GAme' option in multiboard mode
    $('#game-tools-clone').toggleClass('disabled', game.isPlaying()); // Don't allow cloning of a game while playing (could allow cheating)

    const mainGame = games.getPlayingExaminingGame();
    $('#game-tools-examine').toggleClass('disabled', (mainGame && mainGame.isPlayingOnline()) || game.isPlaying() || game.isExamining()
        || game.category === 'wild/fr' || game.category === 'wild/0' // Due to a bug in 'bsetup' it's not possible to convert some wild variants to examine mode
        || game.category === 'wild/1' || game.category === 'bughouse');

    $('#game-tools-setup-board').toggleClass('disabled', game.setupBoard || game.isPlaying() || game.isObserving()
        || (game.isExamining() && (game.category === 'wild/fr' || game.category === 'wild/0'
        || game.category === 'wild/1' || game.category === 'bughouse')));
  }
}

/** Triggered when Table View button is toggled on/off */
$('#game-table-view').on('change', () => {
  if($('#game-table-view').is(':checked'))
    setViewModeTable();
});

/** Triggered when List View button is toggled on/off */
$('#game-list-view').on('change', () => {
  if($('#game-list-view').is(':checked'))
    setViewModeList();
});

/**
 * Set move list view mode to Table View
 */
function setViewModeTable() {
  $('#left-panel').removeClass('list-view-showing');
  $('#movelists').hide();
  $('#move-table').show();
  $('#game-table-view').prop('checked', true);
  games.focused.history.highlightMove();
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
  games.focused.history.highlightMove();
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
$('#game-edit-mode').on('change', function() {
  updateEditMode(games.focused, $(this).is(':checked'));
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
$('#game-preserved').on('change', function() {
  updateGamePreserved(games.focused, $(this).is(':checked'));
});

/**
 * Updates Game Preserved toggle button based on game setting
 */
function updateGamePreserved(game: Game, preserved?: boolean) {
  if(preserved !== undefined)
    game.preserved = preserved;

  const label = $('label[for="game-preserved"]');
  if(settings.multiboardToggle) {
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
$('#game-tools-new').on('click', () => {
  newGameDialog(games.focused);
});

/** New Variant Game menu item selected */
$('#new-variant-game-submenu a').on('click', (event) => {
  let category = $(event.target).text();
  if(category === 'Chess960')
    category = 'wild/fr';

  category = category.toLowerCase();
  newGameDialog(games.focused, category);
});

/**
 * When creating a new (empty game), shows a dialog asking if the user wants to Overwrite the
 * current game or open a New Board. For Chess960, also lets select Chess960 starting position
 */
function newGameDialog(game: Game, category = 'untimed') {
  let bodyText = '';

  if(category === 'wild/fr') {
    bodyText = `<label for"chess960idn">Chess960 Starting Position ID (Optional)</label>
        <input type="number" min="0" max="959" placeholder="0-959" class="form-control text-center chess960idn"><br>`;
  }

  const overwriteHandler = function() {
    const chess960idn = category === 'wild/fr'
      ? this.closest('.toast').querySelector('.chess960idn').value
      : undefined;

    if(games.includes(game))
      newGame(false, game, category, null, chess960idn);
  };

  const newBoardHandler = function() {
    const chess960idn = category === 'wild/fr'
      ? this.closest('.toast').querySelector('.chess960idn').value
      : undefined;
    newGame(true, game, category, null, chess960idn);
  };

  if(game.role === Role.NONE || (category === 'wild/fr' && settings.multiboardToggle)) {
    const headerTitle = 'Create new game';
    const bodyTitle = '';
    let showIcons = false;
    let button1: any;
    let button2: any;
    if(game.role === Role.NONE && settings.multiboardToggle) {
      bodyText = `${bodyText}Overwrite existing game or open new board?`;
      button1 = [overwriteHandler, 'Overwrite'];
      button2 = [newBoardHandler, 'New Board'];
      showIcons = false;
    }
    else if(game.role === Role.NONE) {
      bodyText = `${bodyText}This will clear the current game.`;
      button1 = [overwriteHandler, 'OK'];
      button2 = ['', 'Cancel'];
      showIcons = true;
    }
    else if(category === 'wild/fr' && settings.multiboardToggle) {
      button1 = [newBoardHandler, 'OK'];
      button2 = ['', 'Cancel'];
      showIcons = true;
    }
    Dialogs.showFixedDialog({type: headerTitle, title: bodyTitle, msg: bodyText, btnFailure: button2, btnSuccess: button1, icons: showIcons});
  }
  else if(settings.multiboardToggle)
    newGame(true, game, category);
}

/**
 * Creates a new (empty) game.
 * @param createNewBoard If false, will clear the move-list of the existing game and start over. If true
 * will open a new board when in multiboard mode.
 * @param game The game to overwrite if createNewBoard is false
 * @param category The category (variant) for the new game
 * @param fen The starting position for the new game (used for Chess960)
 * @param chess960idn Alternatively the starting IDN for Chess960
 */
function newGame(createNewBoard: boolean, game?: Game, category = 'untimed', fen?: string, chess960idn?: string): Game {
  if(createNewBoard)
    game = createGame()
  else if(!game || !games.includes(game))
    return;

  if(!createNewBoard)
    cleanupGame(game);

  if(category === 'wild/fr' && !fen)
    fen = ChessHelper.generateChess960FEN(chess960idn ? +chess960idn : null);
  if(!fen)
    fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const data = {
    fen,                                    // game state
    color: 'w',                             // The side of the board to view from
    turn: 'w',                              // color whose turn it is to move ("B" or "W")
    id: null,                               // The game number
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
    category,                               // game variant or type
  }
  Object.assign(game, data);
  game.statusElement.find('.game-status').html('');
  gameStart(game);

  return game;
}

/** Triggered when the 'Open Games' modal is shown */
$('#open-games-modal').on('show.bs.modal', () => {
  $('#add-games-input').val('');
});

/**
 * Triggered when user clicks 'Open Files(s)' button from Open Games modal.
 * Displays an Open File(s) dialog. Then after user selects PGN file(s) to open, displays
 * a dialog asking if they want to overwrite current gmae or open new board.
 */
$('#open-files').on('click', () => {
  // Create file selector dialog
  const fileInput = $('<input type="file" style="display: none" multiple/>');
  fileInput.appendTo('body');
  fileInput.trigger('click');

  fileInput.one('change', async (event) => {
    $('#open-games-modal').modal('hide');
    fileInput.remove();
    const target = event.target as HTMLInputElement;
    const gameFileStrings = await openGameFiles(target.files);
    openGamesOverwriteDialog(games.focused, gameFileStrings);
  });
});

$('#add-games-button').on('click', () => {
  let inputStr = $('#add-games-input').val() as string;
  inputStr = inputStr.trim();
  if(inputStr) {
    $('#open-games-modal').modal('hide');
    openGamesOverwriteDialog(games.focused, [inputStr]);
  }
});

/**
 * When opening PGN file(s), shows a dialog asking if the user wants to Overwrite the
 * current game or open a New Board.
 *
 * @param fileStrings an array of strings representing each opened PGN file (or the Add Games textarea)
 */
function openGamesOverwriteDialog(game: Game, fileStrings: string[]) {
  const overwriteHandler = () => {
    if(games.includes(game))
      parseGameFiles(game, fileStrings, false);
  };

  const newBoardHandler = () => {
    parseGameFiles(game, fileStrings, true);
  };

  if(game.role === Role.NONE) {
    if(game.history.length()) {
      let bodyText = '';
      let button1: any;
      let button2: any;
      let showIcons = false;
      const headerTitle = 'Open Games';
      const bodyTitle = '';
      if(game.role === Role.NONE && settings.multiboardToggle) {
        bodyText = `${bodyText}Overwrite existing game or open new board?`;
        button1 = [overwriteHandler, 'Overwrite'];
        button2 = [newBoardHandler, 'New Board'];
        showIcons = false;
      }
      else if(game.role === Role.NONE) {
        bodyText = `${bodyText}This will clear the current game.`;
        button1 = [overwriteHandler, 'OK'];
        button2 = ['', 'Cancel'];
        showIcons = true;
      }
      Dialogs.showFixedDialog({type: headerTitle, title: bodyTitle, msg: bodyText, btnFailure: button2, btnSuccess: button1, icons: showIcons});
    }
    else
      parseGameFiles(game, fileStrings, false);
  }
  else if(settings.multiboardToggle)
    parseGameFiles(game, fileStrings, true);
}

/**
 * Open the given files and store their contents in strings
 * @param files FileList object
 */
async function openGameFiles(files: any): Promise<string[]> {
  const fileStrings = [];

  // Wait for all selected files to be read before displaying the first game
  for(const file of Array.from<File>(files)) {
    const readFile = async (): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
          const fileContent = e.target?.result as string;
          resolve(fileContent);
        };
        reader.onerror = (e) => {
          const error = e.target?.error;
          const errorMessage = error ? `${error.name} - ${error.message}` : 'An unknown error occurred';
          Dialogs.showFixedDialog({type: 'Failed to open game file', msg: errorMessage, btnSuccess: ['', 'OK']});
          reject(error);
        };
        reader.readAsText(file);
      });
    };
    const fileStr = await readFile();
    if(fileStr)
      fileStrings.push(fileStr);
  }

  return fileStrings;
}

/**
 * Creates a new Game object and loads the games from the given PGN/FEN file strings into it.
 * Each game from the string is stored as a separate History object in game.historyList.
 * For PGNs with multiple games, only the first game is fully parsed. The rest are lazy loaded,
 * i.e. only the PGN metatags are parsed whereas the moves are simply stored as a string in history.pgn
 * and parsed when the game is selected from the game list. PGNs are parsed using @mliebelt/pgn-parser
 * For each file string containing one or more PGN games or FEN lines, splits up the games and creates a History
 * object for each one. Then parses the metatags for each game.
 *
 * @param createNewBoard If false, overwrites existing game, otherwise opens new board when in multiboard mode
 */
async function parseGameFiles(game: Game, gameFileStrings: string[], createNewBoard = false) {
  game = newGame(createNewBoard, game);

  for(const gameStr of gameFileStrings) {
    const regex = /(((?:\s*\[[^\]]+\]\s+)+)([^\[]+?(?=\n\s*(?:[\w]+\/){7}[\w-]+|\[|$))|\s*(?:[\w]+\/){7}[^\n]+)/g; // Splits up the PGN games or FENs in the string (yes there is probably a less ghastly way to do this than a big regex)
    const chunkSize = 200;
    let done = false;
    let fenCount = 1;
    while(!done) {
      // Parse games in chunks so as not to tie up the event loop
      await new Promise<void>(resolve => {
        setTimeout(async () => {
          for(let i = 0; i < chunkSize; i++) {
            const match = regex.exec(gameStr);
            if(!match) {
              done = true;
              break;
            }
            else if(match.length > 3 && match[2] && match[3]) { // match is a PGN
              const history = new History(game);
              history.pgn = match[3];
              const metatags = await parsePGNMetadata(match[2]);
              if(metatags) {
                history.setMetatags(metatags, true);
                game.historyList.push(history);
              }
            }
            else { // match is a FEN
              const fen = match[1].trim();
              const err = ChessHelper.validateFEN(fen);
              if(!err) {
                const history = new History(game, fen);
                history.setMetatags({Event: `FEN ${fenCount}`});
                game.historyList.push(history);
                fenCount++;
              }
              else {
                Dialogs.showFixedDialog({type: 'Invalid FEN', msg: err, btnSuccess: ['', 'OK']});
                return;
              }
            }
          }
          resolve();
        }, 0);
      });
    }
  }

  if(game.historyList.length) {
    updateGamePreserved(game, true);
    setCurrentHistory(game, 0); // Display the first game from the PGN file(s)
  }
}

/**
 * Parse a string of PGN metatags
 */
async function parsePGNMetadata(pgnStr: string) {
  const PgnParser = await import('@mliebelt/pgn-parser');
  try {
    const pgn = PgnParser.parse(pgnStr, {startRule: 'tags'}) as PgnParser.ParseTree;
    return pgn.tags;
  }
  catch(err) {
    Dialogs.showFixedDialog({type: 'Failed to parse PGN', msg: err.message, btnSuccess: ['', 'OK']});
  }
}

/**
 * Parse a string containing a PGN move list
 */
async function parsePGNMoves(game: Game, pgnStr: string) {
  const PgnParser = await import('@mliebelt/pgn-parser');
  try {
    const pgn = PgnParser.parse(pgnStr, {startRule: 'pgn'}) as PgnParser.ParseTree;
    parsePGNVariation(game, pgn.moves);
    game.history.goto(game.history.first());
  }
  catch(err) {
    Dialogs.showFixedDialog({type: 'Failed to parse PGN', msg: err.message, btnSuccess: ['', 'OK']});
  }
}

/**
 * Imports a list of moves (and all subvariations recursively) from a @mliebelt/pgn-parser object
 * and puts them in the provided Game's History object
 */
function parsePGNVariation(game: Game, variation: any) {
  let prevHEntry = game.history.current();
  let newSubvariation = !!prevHEntry.next;

  for(const move of variation) {
    const parsedMove = parseGameMove(game, prevHEntry.fen, move.notation.notation);
    if(!parsedMove)
      break;

    if(newSubvariation && prevHEntry.next && prevHEntry.next.fen === parsedMove.fen) {
      prevHEntry = prevHEntry.next;
      continue;
    }

    const currHEntry = game.history.add(parsedMove.move, parsedMove.fen, newSubvariation);
    game.history.setCommentBefore(currHEntry, move.commentMove);
    game.history.setCommentAfter(currHEntry, move.commentAfter);
    if(move.nag)
      move.nag.forEach((nag) => game.history.setAnnotation(currHEntry, nag));
    getOpening(game);
    updateGameVariantMoveData(game);
    newSubvariation = false;

    for(const subvariation of move.variations) {
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
async function setCurrentHistory(game: Game, historyIndex: number) {
  game.history = game.historyList[historyIndex];
  $('#game-list-button > .label').text(getGameListDescription(game.history, false));
  game.moveTableElement.empty();
  game.moveListElement.empty();
  game.statusElement.find('.game-status').html('');
  updateGameFromMetatags(game);

  if(game.history.pgn) { // lazy load game
    const tags = game.history.metatags;
    if(tags.SetUp === '1' && tags.FEN)
      game.history.first().fen = tags.FEN;
    await parsePGNMoves(game, game.history.pgn);
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
    const metatags = game.history.metatags;
    const whiteName = metatags.White.slice(0, 17).trim().replace(/[^\w]+/g, '_'); // Convert multi-word names into a single word format that FICS can handle
    const blackName = metatags.Black.slice(0, 17).trim().replace(/[^\w]+/g, '_');
    const whiteStatus = game.element.find('.white-status');
    const blackStatus = game.element.find('.black-status');
    if(whiteName !== game.wname) {
      game.wname = whiteName;
      if(game.isExamining())
        session.send(`wname ${whiteName}`);
      whiteStatus.find('.name').text(metatags.White);
    }
    if(blackName !== game.bname) {
      game.bname = blackName;
      if(game.isExamining())
        session.send(`bname ${blackName}`);
      blackStatus.find('.name').text(metatags.Black);
    }

    const whiteElo = metatags.WhiteElo;
    if(whiteElo && whiteElo !== '0' && whiteElo !== '-' && whiteElo !== '?')
      game.wrating = whiteElo;
    else
      game.wrating = '';
    whiteStatus.find('.rating').text(game.wrating);

    const blackElo = metatags.BlackElo;
    if(blackElo && blackElo !== '0' && blackElo !== '-' && blackElo !== '?')
      game.brating = blackElo;
    else
      game.brating = '';
    blackStatus.find('.rating').text(game.brating);

    const supportedVariants = ['losers', 'suicide', 'crazyhouse', 'bughouse', 'atomic', 'chess960',
      'blitz', 'lightning', 'untimed', 'standard', 'nonstandard'];
    const variant = metatags.Variant?.toLowerCase();
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
      let status = '';
      if(metatags.White || metatags.Black) {
        status = `${metatags.White || 'Unknown'} (${metatags.WhiteElo || '?'}) `
            + `${metatags.Black || 'Unknown'} (${metatags.BlackElo || '?'})`
            + `${metatags.Variant ? ` ${metatags.Variant}` : ''}`;

        if(metatags.TimeControl) {
          if(metatags.TimeControl === '-')
            status += ' untimed';
          else {
            const match = metatags.TimeControl.match(/^(\d+)(?:\+(\d+))?$/);
            if(match)
              status += ` ${+match[1] / 60} ${match[2] || '0'}`;
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
$('#game-list-button').on('show.bs.dropdown', async () => {
  const game = games.focused;
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
const gameListFilterHandler = Utils.debounce((event) => {
  const game = games.focused;
  game.gameListFilter = $(event.target).val() as string;
  addGameListItems(game);
}, 500);
$('#game-list-filter').on('input', gameListFilterHandler);

/**
 * Create the game list dropdown
 */
async function addGameListItems(game: Game) {
  let listItems = [];
  for(let i = 0; i < game.historyList.length; i++) {
    const h = game.historyList[i];
    const description = getGameListDescription(h, true);
    if(description.toLowerCase().includes(game.gameListFilter.toLowerCase()))
      listItems.push([i, description]);
  }

  if(!gameListVirtualScroller) {
    const { default: VirtualScroller } = await import('virtual-scroller/dom');
    gameListVirtualScroller = new VirtualScroller($('#game-list-menu')[0], listItems, (item: [number, string]) => {
      const elem = $(`<li style="width: max-content;" class="game-list-item"><a class="dropdown-item" data-index="${item[0]}">${item[1]}</a></li>`);
      return elem[0];
    }, {
      scrollableContainer: $('#game-list-scroll-container')[0],
    });
  }
  else {
    gameListVirtualScroller.setItems(listItems);
    $('#game-list-scroll-container')[0].scrollTop = 0;
  }
}

/**
 * Get the text to be displayed for an item in the game list or in the game list dropdown button
 * @param longDescription the long description is used in the list itself, the short version is used
 * in the dropdown button text
 */
function getGameListDescription(history: History, longDescription = false) {
  const tags = history.metatags;
  let description = '';

  if(/FEN \d+/.test(tags.Event)) {
    description = tags.Event;
    if(longDescription)
      description += `, ${history.first().fen}`;
    return description;
  }

  let dateTimeStr = (tags.Date || tags.UTCDate || '');
  if(tags.Time || tags.UTCTime)
    dateTimeStr += `${tags.Date || tags.UTCDate ? ' - ' : ''}${tags.Time || tags.UTCTime}`;

  if(tags.White || tags.Black) {
    description = tags.White || 'unknown';
    if(tags.WhiteElo && tags.WhiteElo !== '0' && tags.WhiteElo !== '-' && tags.WhiteElo !== '?')
      description += ` (${tags.WhiteElo})`;
    description += ` - ${tags.Black || 'unknown'}`;
    if(tags.BlackElo && tags.BlackElo !== '0' && tags.BlackElo !== '-' && tags.BlackElo !== '?')
      description += ` (${tags.BlackElo})`;
    if(tags.Result)
      description += ` [${tags.Result}]`;
  }
  else {
    description = tags.Event || 'Analysis';
    if(!longDescription)
      description += ` ${dateTimeStr}`;
  }

  if(longDescription) {
    if(dateTimeStr)
      description += `, ${dateTimeStr}`;
    if(tags.ECO || tags.Opening || tags.Variation || tags.SubVariation) {
      description += ',';
      if(tags.ECO)
        description += ` [${tags.ECO}]`;
      if(tags.Opening)
        description += ` ${tags.Opening}`;
      else if(tags.Variation)
        description += ` ${tags.Variation}${tags.SubVariation ? `: ${tags.SubVariation}` : ''}`;
    }
  }

  return description;
}

/**
 * Clear the game list after it's closed
 */
$('#game-list-button').on('hidden.bs.dropdown', () => {
  gameListVirtualScroller?.stop();
  gameListVirtualScroller = null;
  $('#game-list-menu').html('');
});

/** Triggered when a game is selected from the game list */
$('#game-list-dropdown').on('click', '.dropdown-item', (event) => {
  const index = +$(event.target).attr('data-index');
  setCurrentHistory(games.focused, index);
});

$('#save-game-modal').on('show.bs.modal', () => {
  const fenOutput = $('#save-fen-output');
  fenOutput.val('');
  fenOutput.val(games.focused.history.current().fen);

  const pgn = gameToPGN(games.focused);
  const pgnOutput = $('#save-pgn-output');
  pgnOutput.val('');
  pgnOutput.val(pgn);

  let numRows = 1;
  for(const ch of pgn) {
    if(ch === '\n')
      numRows++;
  }
  pgnOutput.css('padding-right', '');
  if(numRows > +pgnOutput.attr('rows')) {
    const scrollbarWidth = Utils.getScrollbarWidth();
    const padding = pgnOutput.css('padding-right');
    pgnOutput.css('padding-right', `calc(${padding} + ${scrollbarWidth}px)`);
    $('#save-pgn-copy').css('right', `${scrollbarWidth}px`);
  }
});

/** Triggered when user clicks the FEN 'copy to clipboard' button in the 'Save Game' modal */
$('#save-fen-copy').on('click', (event) => {
  Utils.copyToClipboard($('#save-fen-output'), $(event.currentTarget));
});

/** Triggered when user clicks the PGN 'copy to clipboard' button in the 'Save Game' modal */
$('#save-pgn-copy').on('click', (event) => {
  Utils.copyToClipboard($('#save-pgn-output'), $(event.currentTarget));
});

/**
 * Takes a game object and returns the game in PGN format
 */
function gameToPGN(game: Game): string {
  const movesStr = Utils.breakAtMaxLength(game.history.movesToString(), 80);
  return `${game.history.metatagsToString()}\n\n${movesStr ? `${movesStr} ` : ''}${game.history.metatags.Result}`;
}

/** Triggered when 'Save PGN' menu option is selected */
$('#save-pgn-button').on('click', () => {
  savePGN(games.focused, $('#save-pgn-output').val() as string);
});

/**
 * Saves game to a .pgn file
 */
function savePGN(game: Game, pgn: string) {
  // Construct file name
  const metatags = game.history.metatags;
  const wname = metatags.White;
  const bname = metatags.Black;
  let event = metatags.Event;
  let date = metatags.Date;
  let time = metatags.Time;
  if(date) {
    date = date.replace(/\./g, '-');
    const match = date.match(/^\d+(-\d+)?(-\d+)?/);
    date = (match ? match[0] : null);
  }
  if(time) {
    time = time.replace(/:/g, '.');
    const match = time.match(/^\d+(.\d+)?(.\d+)?/);
    time = (match ? match[0] : null);
  }

  let filename: string;
  if(wname || bname)
    filename = `${wname || 'unknown'}_vs_${bname || 'unknown'}${date ? `_${date}` : ''}${time ? `_${time}` : ''}.pgn`;
  else {
    event = event.replace(/^FEN (\d+)$/, 'Analysis-$1');
    filename = `${event || 'Analysis'}${date ? `_${date}` : ''}${time ? `_${time}` : ''}.pgn`;
  }

  // Save file
  const data = new Blob([pgn], { type: 'text/plain' });
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
$('#game-tools-clone').on('click', () => {
  cloneGame(games.focused);
});

/**
 * Make an exact copy of a game with its own board, move list and status panels.
 * The clone will not be in examine or observe mode, regardless of the original.
 */
function cloneGame(game: Game): Game {
  const clonedGame = createGame();

  // Copy GameData properties
  const gameData = new GameData(); // Create temp instance in order to iterate its proeprties
  for(const key of Object.keys(gameData))
    clonedGame[key] = game[key];

  clonedGame.id = null;
  clonedGame.role = Role.NONE;
  clonedGame.history = game.history.clone(clonedGame);
  clonedGame.history.display();
  clonedGame.statusElement.find('.game-watchers').empty();
  clonedGame.statusElement.find('.game-id').remove();
  clonedGame.element.find('.title-bar-text').empty();

  scrollToBoard(clonedGame);
  return clonedGame;
}

/** Triggered when the 'Examine Mode (Shared)' menu option is selected */
$('#game-tools-examine').on('click', () => {
  examineModeRequested = games.focused;
  const mainGame = games.getPlayingExaminingGame();
  if(mainGame && mainGame.isExamining())
    session.send('unex');
  session.send('ex');
});

/**
 * Convert a game to examine mode by using bsetup and then commiting the movelist
 */
function setupGameInExamineMode(game: Game) {
  /** Setup the board */
  const fen = game.setupBoard ? getSetupBoardFEN(game) : game.history.first().fen;
  const fenWords = ChessHelper.splitFEN(fen);

  game.commitingMovelist = true;

  // starting FEN
  session.send(`bsetup fen ${fenWords.board}`);

  // game rules
  // Note bsetup for fr and wild are currently broken on FICS and there is no option for bughouse
  if(game.category === 'wild/fr')
    session.send('bsetup fr');
  else if(game.category.startsWith('wild'))
    session.send('bsetup wild');
  else if(game.category === 'losers' || game.category === 'crazyhouse' || game.category === 'atomic' || game.category === 'suicide')
    session.send(`bsetup ${game.category}`);

  // turn color
  session.send(`bsetup tomove ${fenWords.color === 'w' ? 'white' : 'black'}`);

  // castling rights
  const castlingRights = fenWords.castlingRights;
  sendWhiteCastlingRights(castlingRights);
  sendBlackCastlingRights(castlingRights);

  // en passant rights
  const enPassant = fenWords.enPassant;
  if(enPassant !== '-')
    session.send(`bsetup eppos ${enPassant[0]}`);

  session.send(`wname ${game.wname}`);
  session.send(`bname ${game.bname}`);

  if(!game.setupBoard) {
    session.send('bsetup done');

    // Send and commit move list
    const currMove = game.history.current() !== game.history.last() ? game.history.current() : null;
    game.history.goto(game.history.first());
    let hEntry = game.history.first();
    while(hEntry) {
      if(hEntry.move)
        sendMove(hEntry.move);
      session.send(`wclock ${Clock.MSToHHMMSS(hEntry.wtime)}`);
      session.send(`bclock ${Clock.MSToHHMMSS(hEntry.btime)}`);
      hEntry = hEntry.next;
    }
    if(!game.history.scratch() && game.history.length())
      session.send('commit');
    game.history.goto(game.history.last());

    // Navigate back to current move
    if(currMove) {
      gotoMove(currMove);
      game.history.goto(currMove);
    }
  }

  // This is a hack just to indicate we are done
  session.send('done');

  if(!game.statusElement.find('.game-status').html()) {
    game.gameStatusRequested = true;
    session.send(`moves ${game.id}`);
  }
}

/**
 * In 'bsetup' mode, sends white's castling rights to the server.
 * @param castlingRights castling rights string in typical FEN format e.g. 'KQkq'
 */
function sendWhiteCastlingRights(castlingRights: string) {
  let wcastling: string;
  if(castlingRights.includes('K') && castlingRights.includes('Q'))
    wcastling = 'both';
  else if(castlingRights.includes('K'))
    wcastling = 'kside';
  else if(castlingRights.includes('Q'))
    wcastling = 'qside';
  else
    wcastling = 'none';
  session.send(`bsetup wcastle ${wcastling}`);
}

/**
 * In 'bsetup' mode, sends black's castling rights to the server.
 * @param castlingRights castling rights string in typical FEN format e.g. 'KQkq'
 */
function sendBlackCastlingRights(castlingRights: string) {
  let bcastling: string;
  if(castlingRights.includes('k') && castlingRights.includes('q'))
    bcastling = 'both';
  else if(castlingRights.includes('k'))
    bcastling = 'kside';
  else if(castlingRights.includes('q'))
    bcastling = 'qside';
  else
    bcastling = 'none';
  session.send(`bsetup bcastle ${bcastling}`);
}

/** ***************************
 * SETUP BOARD MODE FUNCTIONS *
 ******************************/

/** Triggered when 'Setup Board' menu option is selected */
$('#game-tools-setup-board').on('click', () => {
  setupBoard(games.focused);
  scrollToBoard();
});

/**
 * Enters setup board mode.
 * @param serverIssued True if someone (us or another examiner) sent the 'bsetup' command, false if we are entering
 * setup mode via the Game Tools menu.
 */
function setupBoard(game: Game, serverIssued = false) {
  game.setupBoard = true;
  game.element.find('.status').hide(); // Hide the regular player status panels
  stopEngine();
  if(game.isExamining() && !serverIssued)
    session.send('bsetup');
  updateSetupBoard(game);
  // Display the Setup Board panels above and below the chess board
  game.element.find('.setup-board-top').css('display', 'flex');
  game.element.find('.setup-board-bottom').css('display', 'flex');
  showPanel('#left-panel-setup-board'); // Show the left panel for leaving/cancelling setup mode
  initGameTools(game);
  updateBoard(game, false, false);
}

function leaveSetupBoard(game: Game, serverIssued = false) {
  game.setupBoard = false;
  game.element.find('.setup-board-top').hide();
  game.element.find('.setup-board-bottom').hide();
  game.element.find('.status').css('display', 'flex');
  hidePanel('#left-panel-setup-board');
  initGameTools(game);
  updateEngine();
  updateBoard(game);
  if(game.isExamining() && !serverIssued)
    session.send('bsetup done');
}

/**
 * In setup board mode, initializes or updates the board and setup board controls based on the given FEN.
 * Or if no fen is specified, uses the current move in the move list.
 * @param serverIssued True if the new FEN was received from the server (for example from another examiner).
 * False if the new FEN is a result of the user moving a piece on the board etc.
 */
function updateSetupBoard(game: Game, fen?: string, serverIssued = false) {
  const oldFen = getSetupBoardFEN(game);

  if(!fen)
    fen = game.history.current().fen;

  game.fen = fen; // Since setup mode doesn't use the move list, we store the current position in game.fen
  if(fen === oldFen)
    return;

  const fenWords = ChessHelper.splitFEN(fen);
  if(ChessHelper.splitFEN(oldFen).board !== fenWords.board) {
    game.board.set({ fen });
    if(game.isExamining() && !serverIssued)
      session.send(`bsetup fen ${fenWords.board}`); // Transmit the board position to the server when in examine mode
  }

  setupBoardColorToMove(game, fenWords.color, serverIssued); // Update the color to move control
  setupBoardCastlingRights(game, fenWords.castlingRights, serverIssued); // Update the castling rights controls
  updateEngine(); // If the engine is running, analyze the current position shown on the board
}

/**
 * Triggered when the user clicks the 'Reset Board' button when in Setup Board mode.
 * Resets the board to the first move in the move list
 */
$(document).on('click', '.reset-board', () => {
  const game = games.focused;
  let fen = game.history.first().fen;
  if(fen === '8/8/8/8/8/8/8/8 w - - 0 1') // No initial position because user sent 'bsetup' without first examining a game
    fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  updateSetupBoard(game, fen);
});

/** Triggered when the user clicks the 'Clear Board' button when in Setup Board mode. */
$(document).on('click', '.clear-board', () => {
  updateSetupBoard(games.focused, '8/8/8/8/8/8/8/8 w - - 0 1');
});

/** Triggered when user checks/unchecks the castling rights controls in Setup Board mode */
$(document).on('change', '.can-kingside-castle-white, .can-queenside-castle-white, .can-kingside-castle-black, .can-queenside-castle-black', (event) => {
  const game = games.focused;
  const castlingRights = ChessHelper.splitFEN(getSetupBoardFEN(game)).castlingRights;
  if(game.isExamining()) {
    if($(event.target).hasClass('can-queenside-castle-white') || $(event.target).hasClass('can-kingside-castle-white'))
      sendWhiteCastlingRights(castlingRights);
    else
      sendBlackCastlingRights(castlingRights);
  }
  game.fen = getSetupBoardFEN(game);
  updateEngine();
});

/** Sets the color to move using the Setup Board dropdown button */
(window as any).setupBoardColorToMove = (color: string) => {
  const game = games.focused;
  setupBoardColorToMove(game, color);
  game.fen = getSetupBoardFEN(game);
  updateEngine();
};
function setupBoardColorToMove(game: Game, color: string, serverIssued = false) {
  const oldColor = ChessHelper.splitFEN(getSetupBoardFEN(game)).color;
  const colorName = (color === 'w' ? 'White' : 'Black');
  const label = Utils.isSmallWindow() ? `${colorName}'s move` : `${colorName} to move`;

  const button = game.element.find('.color-to-move-button');
  button.text(label);
  button.attr('data-color', color);

  if(game.isExamining() && !serverIssued && oldColor !== color)
    session.send(`bsetup tomove ${colorName}`);
}

function setupBoardCastlingRights(game: Game, castlingRights: string, serverIssued = false) {
  const oldCastlingRights = ChessHelper.splitFEN(getSetupBoardFEN(game)).castlingRights;

  game.element.find('.can-kingside-castle-white').prop('checked', castlingRights.includes('K'));
  game.element.find('.can-queenside-castle-white').prop('checked', castlingRights.includes('Q'));
  game.element.find('.can-kingside-castle-black').prop('checked', castlingRights.includes('k'));
  game.element.find('.can-queenside-castle-black').prop('checked', castlingRights.includes('q'));

  if(game.isExamining() && !serverIssued) {
    if(oldCastlingRights.includes('K') !== castlingRights.includes('K')
        || oldCastlingRights.includes('Q') !== castlingRights.includes('Q'))
      sendWhiteCastlingRights(castlingRights);
    if(oldCastlingRights.includes('k') !== castlingRights.includes('k')
        || oldCastlingRights.includes('q') !== castlingRights.includes('q'))
      sendBlackCastlingRights(castlingRights);
  }
}

document.addEventListener('touchstart', dragSetupBoardPiece, {passive: false});
document.addEventListener('mousedown', dragSetupBoardPiece);
function dragSetupBoardPiece(event: any) {
  if(!$(event.target).hasClass('setup-board-piece'))
    return;
  dragPiece(event);
}

/** Triggered when user clicks the 'Setup Done' button */
$('#setup-done').on('click', () => {
  setupDone(games.focused);
});

/**
 * Leave setup board mode and reset the move list with the current board position as the starting position
 */
function setupDone(game: Game) {
  const fen = getSetupBoardFEN(game);

  const err = ChessHelper.validateFEN(fen, game.category);
  if(err) {
    Dialogs.showFixedDialog({type: 'Invalid Position', msg: err, btnSuccess: ['', 'OK']});
    return;
  }

  game.history.reset(fen);
  $('#game-pane-status').hide();
  leaveSetupBoard(game);
}

/** Triggered when user clicks the 'Cancel Setup' button */
$('#cancel-setup').on('click', () => {
  cancelSetup(games.focused);
});

/**
 * Leave setup board mode and return to the current move in the move list.
 */
function cancelSetup(game: Game) {
  if(game.isExamining())
    session.send('bsetup start'); // Reset board so that it passes validation when sending 'bsetup done'
  leaveSetupBoard(game);
  // FICS doesn't have a 'bsetup cancel' command, so in order to cancel the setup we need to manually
  // reconstruct the move list (on the server), from before 'bsetup' was entered.
  if(game.isExamining())
    setupGameInExamineMode(game);
}

/**
 * On mobile the buttons for 'Setup Done' and 'Cancel Setup' are shown in a panel just above the board.
 * Whereas on desktop, they are shown in the top left just below the navigation buttons.
 */
function moveLeftPanelSetupBoard() {
  const setupBoardPanel = $('#left-panel-setup-board');
  if(Utils.isSmallWindow()) {
    setupBoardPanel.removeClass('card-header');
    setupBoardPanel.addClass('card-footer');
    setupBoardPanel.removeClass('top-panel');
    setupBoardPanel.addClass('bottom-panel');
    $('#left-panel-footer').after(setupBoardPanel);
  }
  else {
    setupBoardPanel.removeClass('card-footer');
    setupBoardPanel.addClass('card-header');
    setupBoardPanel.removeClass('bottom-panel');
    setupBoardPanel.addClass('top-panel');
    $('#left-panel-header-2').before(setupBoardPanel);
  }
}

/**
 * In setup board mode, return a FEN generated from the current board position, color to move
 * and castling rights controls.
 */
function getSetupBoardFEN(game: Game): string {
  const colorToMove = game.element.find('.color-to-move-button').attr('data-color');
  const wK = (game.element.find('.can-kingside-castle-white').is(':checked') ? 'K' : '');
  const wQ = (game.element.find('.can-queenside-castle-white').is(':checked') ? 'Q' : '');
  const bK = (game.element.find('.can-kingside-castle-black').is(':checked') ? 'k' : '');
  const bQ = (game.element.find('.can-queenside-castle-black').is(':checked') ? 'q' : '');
  const castlingRights = `${wK}${wQ}${bK}${bQ}` || '-';
  return `${game.board.getFen()} ${colorToMove} ${castlingRights} - 0 1`;
}

/**
 * Triggered when the 'Game Properties' menu item is selected.
 * Displays the PGN metatags associated with the game which can then be modified.
 * The game state is updated to reflect the modified metatags.
 */
$('#game-tools-properties').on('click', () => {
  const okHandler = async function() {
    const PgnParser = await import('@mliebelt/pgn-parser');
    const metatagsStr = this.closest('.toast').querySelector('.game-properties-input').value;
    try {
      const pgn = PgnParser.parse(metatagsStr, {startRule: 'tags'}) as PgnParser.ParseTree;
      games.focused.history.setMetatags(pgn.tags, true);
      updateGameFromMetatags(games.focused);
    }
    catch(err) {
      Dialogs.showFixedDialog({type: 'Failed to update properties', msg: err.message, btnSuccess: ['', 'OK']});
      return;
    }
  };

  const headerTitle = 'Game Properties';
  const bodyText = '<textarea style="resize: none" class="form-control game-properties-input" rows="10" type="text" '
      + 'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">'
      + `${games.focused.history.metatagsToString()}</textarea>`;
  const button1 = [okHandler, 'Keep Changes'];
  const button2 = ['', 'Cancel'];
  Dialogs.showFixedDialog({type: headerTitle, msg: bodyText, btnFailure: button2, btnSuccess: button1, htmlMsg: true});
});

/**
 * Triggered when the 'Close Game' menu item is selected.
 * Closes the game.
 */
$('#game-tools-close').on('click', () => {
  const game = games.focused;
  if(game.preserved || game.history.editMode)
    closeGameDialog(game);
  else
    closeGame(game);
});

/** **********************************
 * STATUS / ANALYSIS PANEL FUNCTIONS *
 *************************************/

function initStatusPanel() {
  if(games.focused.isPlaying()) {
    $('#close-status').hide();
    hideAnalysis();
  }
  else if($('#left-panel-bottom').is(':visible')) {
    if(games.focused.analyzing)
      showAnalysis();
    else
      hideAnalysis();

    showAnalyzeButton();
    if($('#engine-tab').is(':visible') && evalEngine)
      evalEngine.evaluate();
    $('#close-status').show();
  }
}

function showStatusPanel() {
  showPanel('#left-panel-bottom');
  initStatusPanel();
}

function hideStatusPanel() {
  $('#show-status-panel').text('Status/Analysis');
  $('#show-status-panel').attr('title', 'Show Status Panel');
  $('#show-status-panel').show();
  stopEngine();
  hidePanel('#left-panel-bottom');
}

/**
 * Scroll to the status/analysis panel
 */
function scrollToLeftPanelBottom() {
  if(Utils.isSmallWindow())
    Utils.safeScrollTo($('#left-panel-bottom').offset().top);
}

$('#left-panel-bottom').on('shown.bs.tab', '.nav-link', (e) => {
  games.focused.currentStatusTab = $(e.target);

  if($(e.target).attr('id') === 'eval-graph-tab') {
    if(!evalEngine)
      createEvalEngine(games.focused);

    if(evalEngine)
      evalEngine.redraw();
  }
});

$('#left-bottom-tabs .closeTab').on('click', (event) => {
  const id = $(event.target).parent().siblings('.nav-link').attr('id');
  if(id === 'engine-tab' || id === 'eval-graph-tab')
    hideAnalysis();
});

function openLeftBottomTab(tab: any) {
  tab.parent().show();
  $('#left-bottom-tabs').css('visibility', 'visible');
  tab.tab('show');
}

function closeLeftBottomTab(tab: any) {
  $('#status-tab').tab('show');
  tab.parent().hide();
  if($('#left-bottom-tabs li:visible').length === 1)
    $('#left-bottom-tabs').css('visibility', 'hidden');
}

function showStatusMsg(game: Game, msg: string) {
  if(game === games.focused)
    showStatusPanel();
  if(msg)
    game.statusElement.find('.game-status').html(msg);
}

async function showOpeningName(game: Game) {
  await fetchOpeningsPromise; // Wait for the openings file to be loaded

  if(!game.history)
    return;

  let hEntry = game.history.current();
  if(!hEntry.move)
    hEntry = game.history.last();

  while(!hEntry.opening) {
    if(!hEntry.move) {
      game.statusElement.find('.opening-name').text('');
      game.statusElement.find('.opening-name').hide();
      return;
    }
    hEntry = hEntry.prev;
  }

  game.statusElement.find('.opening-name').text(hEntry.opening.name);
  game.statusElement.find('.opening-name').show();
}

/** ANALYSIS FUNCTIONS **/

(window as any).analyze = () => {
  showAnalysis();
  showStatusPanel();
  scrollToLeftPanelBottom();
};

function showAnalysis() {
  const game = games.focused;
  const currentStatusTab = game.currentStatusTab;

  openLeftBottomTab($('#engine-tab'));
  openLeftBottomTab($('#eval-graph-tab'));

  $('#engine-pvs').empty();
  for(let i = 0; i < settings.engineLines; i++)
    $('#engine-pvs').append('<li>&nbsp;</li>');
  $('#engine-pvs').css('white-space', (settings.engineLines === 1 ? 'normal' : 'nowrap'));
  games.focused.analyzing = true;

  if(currentStatusTab && currentStatusTab.attr('id') !== 'eval-graph-tab')
    currentStatusTab.tab('show');
}

function hideAnalysis() {
  stopEngine();
  stopEvalEngine();
  closeLeftBottomTab($('#engine-tab'));
  closeLeftBottomTab($('#eval-graph-tab'));
  showAnalyzeButton();
  games.focused.analyzing = false;
  games.focused.currentStatusTab = null;
}

function initAnalysis(game: Game) {
  // Check if game category (variant) is supported by Engine
  if(game === games.focused) {
    stopEvalEngine();

    if(game.category) {
      if(Engine.categorySupported(game.category)) {
        if(game.id || game.history.length())
          showAnalyzeButton();
      }
      else
        hideAnalysis();
    }

    if($('#eval-graph-panel').is(':visible'))
      createEvalEngine(game);
  }
}

$('#start-engine').on('click', () => {
  if(!engine)
    startEngine();
  else
    stopEngine();
});

function startEngine() {
  const game = games.focused;

  if(Engine.categorySupported(game.category)) {
    $('#start-engine').text('Stop');

    $('#engine-pvs').empty();
    for(let i = 0; i < settings.engineLines; i++)
      $('#engine-pvs').append('<li>&nbsp;</li>');

    const options = {
      Hash: settings.engineMemory,    
      ...(settings.engineLines > 1 && { MultiPV: settings.engineLines }),
      ...(settings.engineThreads > 1 && { Threads: settings.engineThreads }),     
      ...(game.category === 'wild/fr' && { UCI_Chess960: true }),
      ...(game.category === 'crazyhouse' && { UCI_Variant: game.category }),
    };

    const moveParams = settings.engineMaxTime !== Infinity
      ? `movetime ${settings.engineMaxTime}`
      : null;

    const engineName = options.hasOwnProperty('UCI_Variant')
      ? settings.variantsEngineName
      : settings.analyzeEngineName;
   
    if(!engine)
      engine = new Engine(game, null, displayEnginePV, engineName, options, moveParams);
    
    if(game.setupBoard)
      engine.evaluateFEN(getSetupBoardFEN(game));
    else if(!game.movelistRequested)
      engine.move(game.history.current());

    if(settings.evalBarToggle)
      game.element.find('.eval-bar').css('display', 'flex');
    setPanelSizes();

    game.engineRunning = true;
  }
  else 
    game.engineRunning = false;
}

function stopEngine(temporary = false) {
  const game = games.focused;

  $('#start-engine').text('Go');

  if(engine) {
    // For engines that support the 'stop' command we send it. Otherwise (e.g. single threaded engines) 
    // if the engine is still 'thinking' we must terminate the Worker and re-create it.
    if(temporary && engine.hasStop()) 
      engine.stop();
    else if(!temporary || engine.thinking) {
      engine.terminate();
      engine = null;
    }

    game.board.setAutoShapes([]); 
    game.board.redrawAll();
    
    if(!temporary) {
      game.element.find('.eval-bar').hide();
      game.engineRunning = false;
    }
    
    setPanelSizes();
  }
}

function updateEngine() {
  if(engine) {
    stopEngine(true); // For multithreaded stockfish we send 'stop' command, for single threaded we must terminate the Worker and re-create it.
    startEngine();
  }
  if(evalEngine)
    evalEngine.evaluate();
}

$('#add-pv').on('click', () => {
  settings.engineLines++;
  storage.set('engine-lines', String(settings.engineLines));
  $('#engine-pvs').css('white-space', (settings.engineLines === 1 ? 'normal' : 'nowrap'));
  $('#engine-pvs').append('<li>&nbsp;</li>');
  if(engine) {
    stopEngine(true);
    if(engine)
      engine.setNumPVs(settings.engineLines);
    startEngine();
  }
});

$('#remove-pv').on('click', () => {
  if(settings.engineLines === 1)
    return;

  settings.engineLines--;
  storage.set('engine-lines', String(settings.engineLines));
  $('#engine-pvs').css('white-space', (settings.engineLines === 1 ? 'normal' : 'nowrap'));
  $('#engine-pvs li').last().remove();
  
  if(engine) {
    stopEngine(true);
    if(engine)
      engine.setNumPVs(settings.engineLines);
    startEngine();
  }
});

function displayEnginePV(game: Game, pvNum: number, pvEval: string, pvMoves: string) {
  $('#engine-pvs li').eq(pvNum - 1).html(`<b>(${pvEval})</b> ${pvMoves}<b/>`);

  if(pvNum === 1 && pvMoves) {
    const words = pvMoves.split(/\s+/);
    const san = words[0].split(/\.+/)[1];
    const fen = game.setupBoard ? getSetupBoardFEN(game) : game.history.current().fen; 
    const parsed = parseGameMove(game, fen, san);
    if(settings.bestMoveArrowToggle) {
      game.board.setAutoShapes([{
        orig: parsed.move.from || parsed.move.to, // For crazyhouse, just draw a circle on dest square
        dest: parsed.move.to,
        brush: 'yellow',
      }]);
    }
    updateEvalBar(game, pvEval);
  }
}

/** Engine Settings button in engine panel */
$('#engine-settings-btn').on('click', () => {
  $('#engine-settings-modal').modal('show');
});

/** Opening Engine Settings panel */
$('#engine-settings-modal').on('show.bs.modal', () => {
  const deviceMemory = (navigator as any).deviceMemory || 4; // GB
  const isMobile = Utils.isMobile();

  oldEngineName = settings.analyzeEngineName;
  $('#engine-selector-btn').text(settings.analyzeEngineName);

  const engineMenu = $('#engine-selector-menu');
  engineMenu.html('');
  if(!isMobile || deviceMemory >= 8)
    engineMenu.append('<li><a class="dropdown-item" href="#">Stockfish 17.1 (75MB download)</a></li>');
  if(!isMobile || deviceMemory >= 4)
    engineMenu.append('<li><a class="dropdown-item" href="#">Stockfish 17.1 Lite</a></li>');
  engineMenu.append('<li><a class="dropdown-item" href="#">Stockfish MV 2019</a></li>');

  oldEngineMaxTime = settings.engineMaxTime;
  const maxTimeSteps = [3000, 5000, 10000, 20000, 30000, Infinity]; // Slider steps in powers of 2
  $('#engine-max-time-slider').attr('max', maxTimeSteps.length - 1);
  $('#engine-max-time-slider').val(maxTimeSteps.indexOf(settings.engineMaxTime));
  $('#engine-max-time-value').text(settings.engineMaxTime === Infinity ? '∞' : `${settings.engineMaxTime / 1000}s`);

  oldEngineThreads = settings.engineThreads;
  let maxThreads;
  if(!isMobile)
    maxThreads = navigator.hardwareConcurrency - 1;
  else if(deviceMemory >= 4)
    maxThreads = navigator.hardwareConcurrency - 2;
  else
    maxThreads = 1;
  $('#engine-threads-slider').parent().css('display', Utils.hasMultiThreading() && maxThreads > 1 ? 'flex' : 'none');
  $('#engine-threads-slider').val(settings.engineThreads);
  $('#engine-threads-slider').attr('max', maxThreads);
  $('#engine-threads-value').text(`${settings.engineThreads} / ${maxThreads}`);

  
  oldEngineMemory = settings.engineMemory;
  // Only allow a smaller max memory on mobile, since we don't want to crash their phone
  let maxMemory;
  if(!isMobile || deviceMemory >= 8)
    maxMemory = 512;
  else if(deviceMemory >= 4)
    maxMemory = 64;
  else
    maxMemory = 16;

  const memorySteps = [16, 32, 64, 128, 256, 512];
  $('#engine-memory-slider').parent().css('display', maxMemory > 16 ? 'flex' : 'none');
  $('#engine-memory-slider').attr('max', memorySteps.indexOf(maxMemory));
  $('#engine-memory-slider').val(memorySteps.indexOf(settings.engineMemory));
  $('#engine-memory-value').text(`${settings.engineMemory}MB`);
});

/** Closing Engine Settings panel */
$('#engine-settings-modal').on('hide.bs.modal', () => {
  if(oldEngineName !== settings.analyzeEngineName && !evalEngine && !engine) {
    // The Engine has changed, pre-fetch the new one
    Engine.load(settings.analyzeEngineName).catch(err => {}); 
  }
  else if(oldEngineName !== settings.analyzeEngineName 
      || oldEngineThreads !== settings.engineThreads 
      || oldEngineMemory !== settings.engineMemory
      || oldEngineMaxTime !== settings.engineMaxTime) {
    // If engine settings have changed, terminate any analysis engines running and restart them.
    if(evalEngine) {
      stopEvalEngine();
      createEvalEngine(games.focused);
      evalEngine.evaluate();
    }
    if(engine) {
      stopEngine();
      startEngine();
    }
  }
});

/** New engine selected */
$('#engine-selector-menu').on('click', '.dropdown-item', (event) => {
  const item = $(event.currentTarget);
  settings.analyzeEngineName = item.text().split('(')[0].trim();
  $('#engine-selector-btn').text(settings.analyzeEngineName);
  storage.set('analyze-engine-name', settings.analyzeEngineName);
});

/** Engine threads changed */
$('#engine-threads-slider').on('input', (event) => {
  settings.engineThreads = +$(event.target).val();
  const maxThreads = navigator.hardwareConcurrency - (Utils.isMobile() ? 2 : 1);
  $('#engine-threads-value').text(`${settings.engineThreads} / ${maxThreads}`);
  storage.set('engine-threads', String(settings.engineThreads));
});

/** Engine hash memory changed */
$('#engine-memory-slider').on('input', (event) => {
  const memorySteps = [16, 32, 64, 128, 256, 512];
  settings.engineMemory = memorySteps[+$(event.target).val()];
  $('#engine-memory-value').text(`${settings.engineMemory}MB`);
  storage.set('engine-memory', String(settings.engineMemory));
});

/** Engine max time changed */
$('#engine-max-time-slider').on('input', (event) => {
  const maxTimeSteps = [3000, 5000, 10000, 20000, 30000, Infinity]; 
  settings.engineMaxTime = maxTimeSteps[+$(event.target).val()];
  $('#engine-max-time-value').text(settings.engineMaxTime === Infinity ? '∞' : `${settings.engineMaxTime / 1000}s`);
  storage.set('engine-max-time', String(settings.engineMaxTime));
});

/**
 * Update the engine eval bar for game, based on the specified eval string, e.g. '-3.21', '-#12' 
 */
function updateEvalBar(game: Game, pvEval: string) {
  let barEvalPercentage: number;
  let barEvalLabel: string;
  if(pvEval.includes('#')) {
    // It's a mate so set the bar all the way to the top or bottom
    if(pvEval.includes('-'))
      barEvalPercentage = 0;
    else
      barEvalPercentage = 100;
    barEvalLabel = pvEval.replace('#', 'M').replace('-', '');
  }
  else {
    let barEval = +pvEval.replace(/[+=]/g,'');
    // An eval of 1.0 is one square up from the middle, 2.0 is two squares up etc
    // The bar stops going up at eval 3.6 then it leaves a small amount at the top/bottom to distinguish from a mate
    barEvalPercentage = Math.max(-45, Math.min(45, barEval * 12.5)) + 50;
    barEvalLabel = (+pvEval.replace(/[-+=]/, '')).toFixed(1).toString(); 
  }

  const evalBarWhite = game.element.find('.eval-bar-white');

  const sideAhead = barEvalPercentage >= 50 ? 'white' : 'black';
  updateEvalBarText(game, barEvalLabel, sideAhead);
  evalBarWhite.css('height', `${barEvalPercentage}%`); // Set the height of the white bar, the black bar stretches to fill remaining space
}

/**
 * Add the eval as text on the Eval Bar. If white is ahead, it adds it to the white segment, otherwise to the black
 * segment. We debounce this function to stop the text flickering quickly between segments when the engine first 
 * starts up, before it stabilizes.
 */
const updateEvalBarText = Utils.debounce((game: Game, label: string, sideAhead: string) => {
  if(game === games.focused) {
    game.element.find('.eval-bar-white .eval-bar-text').toggleClass('side-ahead', sideAhead === 'white');
    game.element.find('.eval-bar-black .eval-bar-text').toggleClass('side-ahead', sideAhead === 'black');
    game.element.find('.side-ahead').text(label);
  }
}, 250);

function createEvalEngine(game: Game) {
  if(game.category && Engine.categorySupported(game.category)) {
    // Configure for variants
    const options = {
      Hash: settings.engineMemory,
      ...(settings.engineThreads > 1 && { Threads: settings.engineThreads }),   
      ...(game.category === 'wild/fr' && { UCI_Chess960: true }),
      ...(game.category === 'crazyhouse' && { UCI_Variant: game.category }),
    };

    const engineName = options.hasOwnProperty('UCI_Variant')
      ? settings.variantsEngineName
      : settings.analyzeEngineName;
    
    evalEngine = new EvalEngine(game, engineName, options);
  }
}

function stopEvalEngine() {
  evalEngine?.terminate();
  evalEngine = null;
}

/** STATUS PANEL SHOW/HIDE BUTTON **/

$('#show-status-panel').on('click', () => {
  if($('#show-status-panel').text() === 'Analyze')
    showAnalysis();
  showStatusPanel();
  scrollToLeftPanelBottom();
});

$('#close-status').on('click', () => {
  hideStatusPanel();
});

function showAnalyzeButton() {
  if($('#left-panel-bottom').is(':visible')) {
    $('#show-status-panel').text('Analyze');
    $('#show-status-panel').attr('title', 'Analyze Game');
  }

  if(!$('#engine-tab').is(':visible') && Engine.categorySupported(games.focused.category))
    $('#show-status-panel').show();
  else if($('#left-panel-bottom').is(':visible'))
    $('#show-status-panel').hide();
}

/** ****************************
 * PLAYING-GAME ACTION BUTTONS *
 *******************************/

$('#resign').on('click', () => {
  const game = games.focused;
  if(!game.isPlaying()) {
    showStatusMsg(game, 'You are not playing a game.');
    return;
  }

  if(game.role === Role.PLAYING_COMPUTER) {
    const winner = (game.color === 'w' ? game.bname : game.wname);
    const loser = (game.color === 'w' ? game.wname : game.bname);
    const gameStr = `(${game.wname} vs. ${game.bname})`;
    const reasonStr = `${loser} resigns`;
    const scoreStr = (winner === game.wname ? '1-0' : '0-1');
    const gameEndData = {
      game_id: -1,
      winner,
      loser,
      reason: Reason.Resign,
      score: scoreStr,
      message: `${gameStr} ${reasonStr} ${scoreStr}`
    };
    messageHandler(gameEndData);
  }
  else
    session.send('resign');
});

$('#adjourn').on('click', () => {
  session.send('adjourn');
});

$('#abort').on('click', () => {
  const game = games.focused;
  if(!game.isPlaying()) {
    showStatusMsg(game, 'You are not playing a game.');
    return;
  }

  if(game.role === Role.PLAYING_COMPUTER) {
    const gameStr = `(${game.wname} vs. ${game.bname})`;
    const reasonStr = 'Game aborted';
    const gameEndData = {
      game_id: -1,
      winner: '',
      loser: '',
      reason: Reason.Abort,
      score: '*',
      message: `${gameStr} ${reasonStr} *`
    };
    messageHandler(gameEndData);
  }
  else
    session.send('abort');
});

$('#takeback').on('click', () => {
  const game = games.focused;
  if(game.isPlaying()) {
    if(game.history.last().turnColor === game.color)
      session.send('take 2');
    else
      session.send('take 1');
  } else {
    showStatusMsg(game, 'You are not playing a game.');
  }
});

$('#draw').on('click', () => {
  const game = games.focused;
  if(game.isPlaying()) {
    if(game.role === Role.PLAYING_COMPUTER) {
      // Computer accepts a draw if they're behind or it's dead equal and the game is on move 30 or beyond
      let gameEval = game.lastComputerMoveEval;
      if(gameEval === null)
        gameEval = '';
      gameEval = gameEval.replace(/[#+=]/, '');
      if(gameEval !== '' && game.history.length() >= 60 && (game.color === 'w' ? +gameEval >= 0 : +gameEval <= 0)) {
        const gameStr = `(${game.wname} vs. ${game.bname})`;
        const reasonStr = 'Game drawn by mutual agreement';
        const scoreStr = '1/2-1/2';
        const gameEndData = {
          game_id: -1,
          winner: '',
          loser: '',
          reason: Reason.Draw,
          score: scoreStr,
          message: `${gameStr} ${reasonStr} ${scoreStr}`
        };
        messageHandler(gameEndData);
      }
      else
        Dialogs.showBoardDialog({type: 'Draw Offer Declined', msg: 'Computer declines the draw offer'});
    }
    else
      session.send('draw');
  } else {
    showStatusMsg(game, 'You are not playing a game.');
  }
});

/** **********************
 * RIGHT PANEL FUNCTIONS *
 *************************/

/** CONNECT BUTTON FUNCTIONS **/

$('#login-form').on('submit', (event) => {
  const user: string = Utils.getValue('#login-user');
  if(session && session.isConnected() && user === session.getUser()) {
    $('#login-user').addClass('is-invalid');
    event.preventDefault();
    return false;
  }
  const pass: string = Utils.getValue('#login-pass');
  if(session) {
    session.disconnect();
    session.destroy();
  }
  session = new Session(messageHandler, user, pass);
  settings.rememberMeToggle = $('#remember-me').prop('checked');
  storage.set('rememberme', String(settings.rememberMeToggle));
  if(settings.rememberMeToggle)
    credential.set(user, pass);
  else
    credential.clear();

  $('#login-screen').modal('hide');
  event.preventDefault();
  return false;
});

$('#sign-in').on('click', () => {
  $('#login-screen').modal('show');
});

$('#connect-user').on('click', () => {
  $('#login-screen').modal('show');
});

$('#login-screen').on('show.bs.modal', async () => {
  if(credential.username)
    $('#login-user').val(credential.username);
  if(credential.password)
    $('#login-pass').val(credential.password);

  $('#remember-me').prop('checked', settings.rememberMeToggle);
  $('#login-user').removeClass('is-invalid');
});

$('#login-screen').on('hidden.bs.modal', async () => {
  $('#login-pass').val(''); // clear the password field when form not visible
});

$('#login-user').on('change', () => {
  $('#login-user').removeClass('is-invalid');
});

/**
 * This detects whether the browser's password manager has autofilled the login/password form when it's
 * invisible. For example, in Firefox after the user enters their Master Password.
 */
$('#login-pass').on('change', () => {
  if(!$('#login-form').is(':visible') && $('#login-pass').val() as string) {
    if(settings.rememberMeToggle && credential && credential.password == null) {
      credential.set($('#login-user').val() as string, $('#login-pass').val() as string);
      if(session) {
        session.disconnect();
        session.destroy();
        session = new Session(messageHandler, credential.username, credential.password);
      }
    }
    $('#login-user').val('');
    $('#login-pass').val('');
  }
});

$('#connect-guest').on('click', () => {
  if(session) {
    session.disconnect();
    session.destroy();
  }
  session = new Session(messageHandler);
});

$('#login-as-guest').on('click', () => {
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

$('#disconnect').on('click', () => {
  if (session)
    session.disconnect();
});

/** *******************
 * SETTINGS FUNCTIONS *
 **********************/

/**
 * Load in settings from persistent storage and initialize settings controls.
 * This must be done after 'storage' is initialised in onDeviceReady
 */
function initSettings() {
  settings.visited = (storage.get('visited') === 'true');

  settings.soundToggle = (storage.get('sound') !== 'false');
  updateDropdownSound();

  settings.autoPromoteToggle = (storage.get('autopromote') === 'true');
  $('#autopromote-toggle').prop('checked', settings.autoPromoteToggle);

  settings.notificationsToggle = (storage.get('notifications') !== 'false');
  $('#notifications-toggle').prop('checked', settings.notificationsToggle);

  settings.highlightsToggle = (storage.get('highlights') !== 'false');
  $('#highlights-toggle').prop('checked', settings.highlightsToggle);

  settings.wakelockToggle = (storage.get('wakelock') !== 'false');
  $('#wakelock-toggle').prop('checked', settings.wakelockToggle);

  settings.multiboardToggle = (storage.get('multiboard') !== 'false');
  $('#multiboard-toggle').prop('checked', settings.multiboardToggle);

  settings.multiplePremovesToggle = (storage.get('multiplepremoves') === 'true');
  $('#multiple-premoves-toggle').prop('checked', settings.multiplePremovesToggle);

  settings.smartmoveToggle = (storage.get('smartmove') === 'true');
  $('#smartmove-toggle').prop('checked', settings.smartmoveToggle);

  settings.evalBarToggle = (storage.get('evalbar') !== 'false');
  $('#eval-bar-toggle').prop('checked', settings.evalBarToggle);
  $('#eval-bar-toggle-icon').toggleClass('fa-eye', settings.evalBarToggle);
  $('#eval-bar-toggle-icon').toggleClass('fa-eye-slash', !settings.evalBarToggle);

  settings.bestMoveArrowToggle = (storage.get('bestmovearrow') !== 'false');
  $('#best-move-arrow-toggle').prop('checked', settings.bestMoveArrowToggle);
  $('#best-move-arrow-toggle-icon').toggleClass('fa-eye', settings.bestMoveArrowToggle);
  $('#best-move-arrow-toggle-icon').toggleClass('fa-eye-slash', !settings.bestMoveArrowToggle);

  const engineName = storage.get('analyze-engine-name');
  if(engineName)
    settings.analyzeEngineName = engineName;

  const engineLines = storage.get('engine-lines');
  if(engineLines)
    settings.engineLines = +engineLines;

  const engineMaxTime = storage.get('engine-max-time');
  if(engineMaxTime)
    settings.engineMaxTime = +engineMaxTime;

  const engineThreads = storage.get('engine-threads');
  if(engineThreads)
    settings.engineThreads = +engineThreads;

  const engineMemory = storage.get('engine-memory');
  if(engineMemory)
    settings.engineMemory = +engineMemory;

  settings.rememberMeToggle = (storage.get('rememberme') === 'true');
  $('#remember-me').prop('checked', settings.rememberMeToggle);

  settings.lobbyShowComputersToggle = (storage.get('lobbyshowcomputers') === 'true');
  settings.lobbyShowUnratedToggle = (storage.get('lobbyshowunrated') !== 'false');

  $('#formula-toggle').prop('checked', (storage.get('seeks-use-formula') === 'true'));
  $('#custom-control-min').val(storage.get('pairing-custom-min') || '0');
  $('#custom-control-inc').val(storage.get('pairing-custom-inc') || '0');

  History.initSettings();
}

$('#flip-toggle').on('click', () => {
  flipBoard(games.focused);
});

$('#sound-toggle').on('click', () => {
  settings.soundToggle = !settings.soundToggle;
  updateDropdownSound();
  storage.set('sound', String(settings.soundToggle));
});
function updateDropdownSound() {
  const iconClass = `dropdown-icon fa fa-volume-${settings.soundToggle ? 'up' : 'off'}`;
  $('#sound-toggle').html(`<span id="sound-toggle-icon" class="${iconClass}" aria-hidden="false"></span>`
      + `Sounds ${settings.soundToggle ? 'ON' : 'OFF'}`);
}

$('#notifications-toggle').on('click', () => {
  settings.notificationsToggle = !settings.notificationsToggle;
  storage.set('notifications', String(settings.notificationsToggle));
});

$('#autopromote-toggle').on('click', () => {
  settings.autoPromoteToggle = !settings.autoPromoteToggle;
  storage.set('autopromote', String(settings.autoPromoteToggle));
});

$('#highlights-toggle').on('click', () => {
  settings.highlightsToggle = !settings.highlightsToggle;
  updateBoard(games.focused, false, false);
  storage.set('highlights', String(settings.highlightsToggle));
});

$('#wakelock-toggle').on('click', () => {
  settings.wakelockToggle = !settings.wakelockToggle;
  if(settings.wakelockToggle)
    noSleep.enable();
  else
    noSleep.disable();
  storage.set('wakelock', String(settings.wakelockToggle));
});

$('#multiboard-toggle').on('click', () => {
  settings.multiboardToggle = !settings.multiboardToggle;
  if(!settings.multiboardToggle) {
    // close all games except one
    const game = games.getMostImportantGame();
    setGameWithFocus(game);
    maximizeGame(game);

    // close all games in the secondary board area
    for(const g of [...games]) {
      if(g.element.parent().is('#secondary-board-area'))
        closeGame(g);
    }
  }
  initGameTools(games.focused);
  storage.set('multiboard', String(settings.multiboardToggle));
});

$('#multiple-premoves-toggle').on('click', () => {
  settings.multiplePremovesToggle = !settings.multiplePremovesToggle;
  if(!settings.multiplePremovesToggle) {
    for(const g of games) {
      if(g.premoves.length) {
        cancelMultiplePremoves(g);
        updateBoard(g, false, true, false);
      }
    }
  }
  storage.set('multiplepremoves', String(settings.multiplePremovesToggle));
});

$('#smartmove-toggle').on('click', () => {
  settings.smartmoveToggle = !settings.smartmoveToggle;
  storage.set('smartmove', String(settings.smartmoveToggle));
});

$('#eval-bar-toggle').on('change', () => {
  settings.evalBarToggle = !settings.evalBarToggle;

  $('#eval-bar-toggle-icon').toggleClass('fa-eye');
  $('#eval-bar-toggle-icon').toggleClass('fa-eye-slash');

  const game = games.focused;
  if(game.engineRunning) {
    if(settings.evalBarToggle)
      game.element.find('.eval-bar').css('display', 'flex');
    else
      game.element.find('.eval-bar').hide();
    setPanelSizes();
  }
  storage.set('evalbar', String(settings.evalBarToggle));
});

$('#best-move-arrow-toggle').on('change', () => {
  settings.bestMoveArrowToggle = !settings.bestMoveArrowToggle;

  $('#best-move-arrow-toggle-icon').toggleClass('fa-eye');
  $('#best-move-arrow-toggle-icon').toggleClass('fa-eye-slash');

  if(settings.bestMoveArrowToggle) 
    updateEngine();
  else {
    if(games.focused.engineRunning) {
      games.focused.board.setAutoShapes([]); 
      games.focused.board.redrawAll();
    }
  }
  
  storage.set('bestmovearrow', String(settings.bestMoveArrowToggle));
});

/** *****************************
 * CONSOLE/CHAT INPUT FUNCTIONS *
 ********************************/

$('#input-form').on('submit', (event) => {
  event.preventDefault();
  let text: string;
  let val = Utils.getValue('#input-text');
  val = val.replace(/[“‘”]/g, "'");
  val = val.replace(/[^\S ]/g, ' '); // replace other whitespace chars with space
  val = val.replace(/[\x00-\x1F\x7F-\x9F]/g, ''); // Strip out ascii and unicode control chars
  if(val === '' || val === '\n') {
    return;
  }

  const tab = chat.currentTab();
  if(val.charAt(0) === '@')
    text = val.substring(1);
  else if(tab !== 'console') {
    if(tab.startsWith('game-')) {
      const gameNum = tab.split('-')[1];
      const game = games.findGame(+gameNum);
      const xcmd = game && game.role === Role.OBSERVING ? 'xwhisper' : 'xkibitz';
      text = `${xcmd} ${gameNum} ${val}`;
    }
    else if(val.startsWith('m;') && !/^\d+$/.test(tab)) { // Use "m;" prefix to send message
      // Display message in chat tab
      const msg = val.substring(2).trim();
      chat.newMessage(tab, {
        type: MessageType.PrivateTell,
        user: session.getUser(),
        message: msg,
      });
      text = `message ${tab} ${msg}`;
    }
    else {
      if(/^\d+$/.test(tab))
        text = `t ${tab} ${val}`;
      else {
        const name = $(`#tab-${tab}`).text();
        text = `t ${name} ${val}`;
      }
    }
  }
  else
    text = val;

  // Check if input is a chat command, and if so do processing on the message before sending
  let chatCmd: string;
  let recipient: string;
  let message: string;
  let match = text.match(/^\s*(\S+)\s+(\S+)\s+(.+)$/);
  if(match && match.length === 4 &&
      ('tell'.startsWith(match[1]) ||
      (('xwhisper'.startsWith(match[1]) || 'xkibitz'.startsWith(match[1]) || 'xtell'.startsWith(match[1])) && match[1].length >= 2))) {
    chatCmd = match[1];
    recipient = match[2];
    message = match[3];
  }
  else {
    match = text.match(/^\s*([.,])\s*(.+)$/);
    if(!match)
      match = text.match(/^\s*(\S+)\s+(.+)$/);
    if(match && match.length === 3 &&
        ('kibitz'.startsWith(match[1]) || '.,'.includes(match[1]) ||
        (('whisper'.startsWith(match[1]) || 'say'.startsWith(match[1]) || 'ptell'.startsWith(match[1])) && match[1].length >= 2))) {
      chatCmd = match[1];
      message = match[2];
    }
  }

  if(chatCmd) {
    const isPrivateTell = ('xtell'.startsWith(chatCmd) || 'tell'.startsWith(chatCmd)) && !/^\d+$/.test(recipient);

    if(isPrivateTell && session.getUser().toLowerCase() !== recipient.toLowerCase() 
        && session.isRegistered() && !/^Guest[A-Z]{4}$/i.test(recipient)) 
      pendingTells.push({ recipient, message: Utils.splitText(plainText(message), 997)[0] });

    const maxLength = (session.isRegistered() ? 400 : 200);
    if(message.length > maxLength)
      message = message.slice(0, maxLength);

    message = plainText(message);
    const messages = Utils.splitText(message, maxLength); // if message is now bigger than maxLength chars due to html encoding split it

    for(const msg of messages) {
      if(isPrivateTell) {
        chat.newMessage(recipient, {
          type: MessageType.PrivateTell,
          user: session.getUser(),
          message: msg,
        });
      }
      session.send(`${chatCmd} ${recipient ? `${recipient} ` : ''}${msg}`);
    }
  }
  else {
    if(/^[\x00-\x7F]/.test(text)) 
      session.send(plainText(text));
    else 
      chat.newNotification('Invalid command.');
  }

  $('#input-text').val('');
  updateInputText();
});

function plainText(text: string) {
  text = chat.unemojify(text);
  return Utils.unicodeToHTMLEncoding(text);
}

$('#input-text').on('input', () => {
  updateInputText();
});

$('#input-text').on('keydown', (event) => {
  if(event.key === 'Enter') {
    event.preventDefault();
    $('#input-form').trigger('submit');
  }
});

$(document).on('shown.bs.tab', '#tabs button[data-bs-toggle="tab"]', () => {
  updateInputText();
});

function updateInputText() {
  const element = $('#input-text')[0] as HTMLTextAreaElement;
  const start = element.selectionStart;
  const end = element.selectionEnd;

  let val = element.value as string;
  val = val.replace(/[^\S ]/g, ' '); // replace all whitespace chars with spaces

  // Stop the user being able to type more than max length characters
  const tab = chat.currentTab();
  let maxLength: number;
  if(val.charAt(0) === '@')
    maxLength = 1024;
  else if(tab === 'console')
    maxLength = 1023;
  else if(val.startsWith('m;')) // User is sending a 'message' from chat tab
    maxLength = 999;
  else if(!session.isRegistered()) // Guests are limited to half the tell length
    maxLength = 200;
  else
    maxLength = 400;

  // Convert emoji unicode chars to shortcodes in order to test the length then convert them back
  // Note: as a side effect of this, it will convert shortcodes typed in the input in real time
  val = chat.unemojify(val);
  if(val.length > maxLength) {
    val = Utils.splitText(val, maxLength)[0];
    // Flash text area when max characters reached
    $('#fake-input-text').addClass('flash');
    $('#fake-input-text').one('animationend', () => {
      $('#fake-input-text').removeClass('flash');
    });
  }
  val = chat.emojify(val);

  if(val !== element.value as string) {
    element.value = val;
    element.setSelectionRange(start, end);
  }

  adjustInputTextHeight(); // Resize text area
}

function adjustInputTextHeight() {
  const inputElem = $('#input-text');
  const oldLines = +inputElem.attr('rows');
  inputElem.attr('rows', 1);
  inputElem.css('overflow', 'hidden');

  const lineHeight = parseFloat(inputElem.css('line-height'));
  const maxLines = 0.33 * $('#chat-panel').height() / lineHeight;
  let numLines = Math.floor(inputElem[0].scrollHeight / lineHeight);
  if(numLines > maxLines)
    numLines = maxLines;

  inputElem.attr('rows', numLines);
  inputElem.css('overflow', '');

  const heightDiff = (numLines - 1) * lineHeight;
  $('#right-panel-footer').height($('#left-panel-footer').height() + heightDiff);

  if(numLines !== oldLines && chat)
    chat.fixScrollPosition();
}

export function setRematchUser(user: string) {
  rematchUser = user;
}




