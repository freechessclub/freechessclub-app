// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

export class Engine {
  private board: any
  private game: any
  private stockfish: any

  constructor(game: any, board: any) {
    this.game = game;
    this.board = board;
    this.stockfish = new Worker(new URL('stockfish.js/stockfish.js', import.meta.url));
    this.stockfish.onmessage = (response) => {
      if (response.data.startsWith('bestmove')) {
        const responseArr: string[] = response.data.split(' ');
        let bestMove = responseArr[1];
        this.board.setAutoShapes([{
          orig: bestMove.substring(0, 2),
          dest: bestMove.substring(2, 4),
          brush: 'yellow',
        }]);
      } else if (response.data.startsWith('info')) {
        let info = response.data.substring(5, response.data.length);
        $('#game-status').html(info + '<br/>');
      }
    };
    this.uci('uci');
    this.uci('ucinewgame');
    this.uci('isready');
  }

  public terminate() {
    this.stockfish.terminate();
  }

  public move() {
    this.uci('position startpos moves' + this.getMoves());
    this.uci("go");
  }

  private uci(cmd: string, ports?: any) {
    return this.stockfish.postMessage(cmd, ports)
  }

  private getMoves() {
    let moves = '';
    const history = this.game.history({verbose: true});
    for (let i = 0; i < history.length; ++i) {
        const move = history[i];
        moves += ' ' + move.from + move.to + (move.promotion ? move.promotion : '');
    }
    return moves;
  }
}

export default Engine;
