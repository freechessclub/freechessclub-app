// Copyright 2023 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

export const Role = {
  ISOLATED_POS: -3,         // isolated position, such as for "ref 3" or the "sposition" command
  OBS_EXAMINED: -2,         // I am observing game being examined
  EXAMINING: 2,             // I am the examiner of this game
  OPPONENTS_MOVE: -1,       // I am playing, it is my opponent's move
  MY_MOVE: 1,               // I am playing and it is my move
  OBSERVING: 0,             // I am observing a game being played
  NONE: -999,               // I am not in any game state
  PLAYING_COMPUTER: -998    // I am playing the Computer locally
};

export class GameData {
  fen: string = '';                     // game position
  turn: string = 'w';                   // color whose turn it is to move ("B" or "W")
  id: number = null;                      // The game number
  wname: string = '';                   // White's name
  bname: string = '';                   // Black's name
  role: number = Role.NONE;             // my relation to this game
  time: number = 0;                     // initial time (in seconds) of the match
  inc: number = 0;                      // increment In seconds) of the match
  wstrength: number = 0;                // White material strength
  bstrength: number = 0;                // Black material strength
  wtime: number = 0;                    // White's remaining time in milliseconds
  btime: number = 0;                    // Black's remaining time in milliseconds
  moveNo: number =  1;                  // the number of the move about to be made
  moveVerbose: {                        // verbose coordinate notation for the previous move
    from: string,                       // from square
    to: string,                         // to square
    promotion: string,                  // promotion piece
    san: string,                        // move in algebraec form
  } = null;
  prevMoveTime: {                       // time taken to make previous move
    minutes: number,
    seconds: number,
    milliseconds: number,
  } = null;
  move: string = '';                    // pretty notation for the previous move ("none" if there is none)
  flip: boolean = false;                // flip field for board orientation: 1 = Black at bottom, 0 = White at bottom.
  wrating: string = '';                 // white's rating
  brating: string = '';                 // black's rating
  category: string = '';                // category or variant
  color: string = 'w';
  difficulty: number = 0;               // computer difficulty level

  public isPlaying() { return this.role === Role.MY_MOVE || this.role === Role.OPPONENTS_MOVE || this.role === Role.PLAYING_COMPUTER; }
  public isPlayingOnline() { return this.role === Role.MY_MOVE || this.role === Role.OPPONENTS_MOVE; }
  public isExamining() { return this.role === Role.EXAMINING; }
  public isObserving() { return this.role === Role.OBSERVING || this.role === Role.OBS_EXAMINED; }
}

export const NewVariationMode = {
  ASK: 0,
  NEW_VARIATION: 1,
  OVERWRITE_VARIATION: 2
};

// An online chess game
export class Game extends GameData {
  chess: any = null;
  history: any = null;
  historyList: any = [];
  clock: any = null;
  board: any = null;
  watchers: any = [];
  watchersInterval: any = null;
  captured: any = {};

  // HTML elements associated with this Game
  element: any = null; // The main game card including the board
  moveTableElement: any = null; // The move list (in 2 column table form)
  moveListElement: any = null; // The move list (in PGN form)
  statusElement: any = null; // The status panel

  // Keep track of which analysis tab is showing
  analyzing: boolean = false;
  currentStatusTab: any = null;

  // Store result of promotion dialog to pass to movePiece()
  promotePiece;
  promoteIsPremove;

  // Store parameters to movePiece temporarily while handling any intermediate popups, e.g. promotion dialog or new variation menu
  movePieceSource;
  movePieceTarget;
  movePieceMetadata;

  // Used to buffer navigation buttons when in examine mode
  bufferedHistoryEntry: any = null;
  bufferedHistoryCount: number = 0;

  removeMoveRequested: any = null;     // In examine mode, store a move to be deleted from the move-list until after we have navigated away from it
  gameStatusRequested: boolean = false; // Sends the 'moves' command in order to retrieve the game info to display in teh status panel
  lastComputerMoveEval: string = null; // Keeps track of the current eval for a game against the Computer. Used for draw offers
  partnerGameId: number = null;        // bughouse partner's game id
  newVariationMode: number = NewVariationMode.ASK;
  preserved: boolean = false;          // if true, prevents a game/board from being overwritten
  setupBoard: boolean = false;         // in setup-board mode or not
  commitingMovelist = false;           // Used when entering examine mode and using 'commit' to submit a move list
  movelistRequested: number = 0;       // Used to keep track of move list requests
  mexamineMovelist: string = null;     // Used to restore the current move after retrieving the move list when given mexamine privilages
  gameListFilter: string = ''          // Stores the filter text for the game selector menu (when loading a PGN with multiple games)
}
