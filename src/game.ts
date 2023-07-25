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
  NONE: -999                // I am not in any game state
};

class GameData {
  fen: string;                          // game position
  turn: string;                         // color whose turn it is to move ("B" or "W")
  id: number;                           // The game number
  wname: string;                        // White's name
  bname: string;                        // Black's name
  role: number;                         // my relation to this game
  time: number;                         // initial time (in seconds) of the match
  inc: number;                          // increment In seconds) of the match
  wstrength: number;                    // White material strength
  bstrength: number;                    // Black material strength
  wtime: number;                        // White's remaining time
  btime: number;                        // Black's remaining time
  moveNo: number;                       // the number of the move about to be made
  moveVerbose: {                        // verbose coordinate notation for the previous move
    from: string,                       // from square
    to: string,                         // to square
    promotion: string,                  // promotion piece
    san: string,                        // move in algebraec form
  };
  prevMoveTime: {                       // time taken to make previous move
    minutes: number,
    seconds: number,
  };
  move: string;                         // pretty notation for the previous move ("none" if there is none)
  flip: boolean;                        // flip field for board orientation: 1 = Black at bottom, 0 = White at bottom.
  wrating: string                       // white's rating
  brating: string                       // black's rating
  category: string                      // category or variant

  public isPlaying() { return this.role === Role.MY_MOVE || this.role === Role.OPPONENTS_MOVE; }
  public isExamining() { return this.role === Role.EXAMINING; }
  public isObserving() { return this.role === Role.OBSERVING || this.role === Role.OBS_EXAMINED; }
}

// An online chess game
class Game extends GameData {
  playerCaptured: any = {};
  oppCaptured: any = {};
  chess: any = null;
  color = 'w';
  history: any = null;
  bclock: any = null;
  wclock: any = null;
  watchers: any = null;
}

export const game = new Game();

export default game;

