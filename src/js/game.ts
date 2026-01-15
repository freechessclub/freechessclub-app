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
  fen = '';                     // game position
  turn = 'w';                   // color whose turn it is to move ("B" or "W")
  id: number = null;                      // The game number
  wname = '';                   // White's name
  bname = '';                   // Black's name
  role = Role.NONE;             // my relation to this game
  time = 0;                     // initial time (in seconds) of the match
  inc = 0;                      // increment In seconds) of the match
  wstrength = 0;                // White material strength
  bstrength = 0;                // Black material strength
  wtime = 0;                    // White's remaining time in milliseconds
  btime = 0;                    // Black's remaining time in milliseconds
  moveNo =  1;                  // the number of the move about to be made
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
  move = '';                    // pretty notation for the previous move ("none" if there is none)
  flip = false;                // flip field for board orientation: 1 = Black at bottom, 0 = White at bottom.
  wrating = '';                 // white's rating
  brating = '';                 // black's rating
  category = '';                // category or variant
  color = 'w';
  difficulty = 0;               // computer difficulty level
 
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
  history: any = null;
  historyList: any = [];
  clock: any = null;
  board: any = null;
  watchers: any = [];
  watchersInterval: any = null;
  
  // Smart move and premove state flags
  premoves: any = []; // List of premoves for multiple premoves mode
  premovesFen: string = ''; // The position after the final premove (multiple premoves)
  premovesObserver: any; // MutationObserver for adding numbers to premove squares (multiple premoves)
  premoveSet: string[] = null; // Status flag that keeps track of whether a Chessground premove is currently set
  pieceSelected: string = null; // Status flag that keeps track of whether a piece is currently selected 
  squareSelected: string = null; // The last square selected (used to cancel multiple premoves)
  squareSelectedTime: number = null; // The time the last square was selected (used to cancel multiple premoves)
  smartMove: boolean = false;

  // HTML elements associated with this Game
  element: any = null; // The main game card including the board
  moveTableElement: any = null; // The move list (in 2 column table form)
  moveListElement: any = null; // The move list (in PGN form)
  statusElement: any = null; // The status panel

  // Keep track of which analysis tab is showing
  analyzing = false;
  engineRunning = false;
  currentStatusTab: any = null;

  // Store parameters to movePiece temporarily while handling any intermediate popups, e.g. promotion dialog or new variation menu
  movePieceSource;
  movePieceTarget;
  movePieceMetadata;
  movePiecePromotion;

  // Used to buffer navigation buttons when in examine mode
  pendingMoves: any[] = [];            // In examine mode, store played moves until server confirms the move
  restoreMove: any;                    // in examine mode, if a sequence of moves gets interrupted (from a move played by another examiner) then roll back to the point of the interruption 
  removeMoveRequested: any = null;     // In examine mode, store a move to be deleted from the move-list until after we have navigated away from it

  gameStatusRequested = false;         // Sends the 'moves' command in order to retrieve the game info to display in teh status panel
  lastComputerMoveEval: string = null; // Keeps track of the current eval for a game against the Computer. Used for draw offers
  partnerGameId: number = null;        // bughouse partner's game id
  newVariationMode = NewVariationMode.ASK;
  preserved = false;                   // if true, prevents a game/board from being overwritten
  setupBoard = false;                  // in setup-board mode or not
  commitingMovelist = false;           // Used when entering examine mode and using 'commit' to submit a move list
  movelistRequested = 0;               // Used to keep track of move list requests
  mexamineMovelist: string[] = null;   // Used to restore the current move after retrieving the move list when given mexamine privilages
  gameListFilter = ''                  // Stores the filter text for the game selector menu (when loading a PGN with multiple games)
}

export class GameList {
  private gamelist: Game[] = [];
  private gameWithFocus: Game = null;

  public get focused(): Game {
    return this.gameWithFocus;
  }

  public set focused(game: Game) {
    this.gameWithFocus = game;
  }

  public get length(): number {
    return this.gamelist.length;
  }

  public includes(game: Game): boolean {
    return this.gamelist.includes(game);
  }

  public add(game: Game) {
    this.gamelist.push(game);
  }

  public remove(game: Game) {
    const index = this.gamelist.indexOf(game);
    if(index !== -1)
      this.gamelist.splice(index, 1);
  }

  [Symbol.iterator](): Iterator<Game> {
    let index = 0;
    const items = this.gamelist;

    return {
      next: (): IteratorResult<Game> => {
        if (index < items.length)
          return { value: items[index++], done: false };
        else
          return { value: undefined, done: true };
      },
    };
  }

  public findGame(id: number): Game {
    return this.gamelist.find(item => item.id === id);
  }

  public getMainGame(): Game {
    return this.gamelist.find(g => g.element.parent().is('#main-board-area'));
  }

  public getPlayingExaminingGame(): Game {
    return this.gamelist.find(g => g.isPlayingOnline() || g.isExamining());
  }

  public getFreeGame(): Game {
    const game = this.getMainGame();
    if(game.role === Role.NONE && !game.preserved && !game.history?.editMode && !game.setupBoard)
      return game;

    return this.gamelist.find(g => g.role === Role.NONE && !g.preserved && !g.history?.editMode && !g.setupBoard);
  }

  public getComputerGame(): Game {
    return this.gamelist.find(g => g.role === Role.PLAYING_COMPUTER);
  }

  public getMostImportantGame(): Game {
    // find most important board
    // out of playing/examining game, then computer game, then observed game on main board, then other observed game
    let game = this.getPlayingExaminingGame();
    if(!game)
      game = this.getComputerGame();
    if(!game) {
      const mainGame = this.getMainGame();
      if(mainGame && mainGame.isObserving())
        game = mainGame;
    }
    if(!game)
      game = this.gamelist.find(g => g.isObserving());
    if(!game)
      game = this.getMainGame();
    if(!game)
      game = this.gamelist[0];

    return game;
  }
}

export const games = new GameList();