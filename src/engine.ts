// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { Chessground } from "chessground";
import Chess from 'chess.js';

export class Engine {
  private board: any;
  private stockfish: any;
  private numPVs: number;
  private fen: string;

  constructor(board: any, numPVs: number = 1) {
    this.numPVs = numPVs;
    this.board = board;
    this.fen = '';
    var wasmSupported = typeof WebAssembly === 'object' && WebAssembly.validate(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));
    if(wasmSupported) {
      new URL('stockfish.js/stockfish.wasm', import.meta.url); // Get webpack to copy the file from node_modules
      this.stockfish = new Worker(new URL('stockfish.js/stockfish.wasm.js', import.meta.url)); 
    }
    else
      this.stockfish = new Worker(new URL('stockfish.js/stockfish.js', import.meta.url));


    this.stockfish.onmessage = (response) => {
      if (response.data.startsWith('info')) {      
        let info = response.data.substring(5, response.data.length);

        const infoArr: string[] = info.trim().split(/\s+/);      

        let bPV = false;
        const pvArr = [];
        var scoreStr;
        var bestMove = false;
        var pvNum = 1;
        for(let i = 0; i < infoArr.length; i++) {
          if(infoArr[i] === 'lowerbound' || infoArr[i] === 'upperbound')
            return;
          if(infoArr[i] === 'multipv') {
            pvNum = +infoArr[i + 1];
            if(pvNum === 1)
              bestMove = true;
            else if(pvNum > this.numPVs)
              return;
          } 
          if(infoArr[i] === 'score') {
            var score = +infoArr[i + 2];
            var turn = this.fen.split(/\s+/)[1];
            
            if(score > 0 && turn === 'w' || score < 0 && turn === 'b') {
              var prefix = '+';
            }
            else if(score == 0) 
              var prefix = '=';
            else 
              var prefix = '-';
            score = (score < 0 ? -score : score);
           
            if(infoArr[i+1] === 'mate') {
              if(prefix === '+') 
                prefix = '';
              else if(prefix === '=') {
                if(turn === 'w')
                  prefix = '-';
                else prefix = '';
              }

              scoreStr = prefix + '#' + score;
            }
            else
              scoreStr = prefix + (score / 100).toFixed(2);
          }
          else if(infoArr[i] === 'pv') {
            bPV = true;
          }
          else if(bPV) {
            pvArr.push(infoArr[i]);
          }        
        }

        if(pvArr.length) {
          var pvChess = new Chess(this.fen); 
          for(let move of pvArr)
            pvChess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: (move.length == 5 ? move.charAt(4) : undefined)});    
          var pv = pvChess.pgn();
          let index = pv.indexOf(']', pv.indexOf(']') + 1);
          pv = (index >= 0 ? pv.slice(index + 2) : pv);
          pv = pv.replace(/\. /g, '.');

          var pvStr = '<b>(' + scoreStr + ')</b> ' + pv + '<b/>';
          $('#engine-pvs li').eq(pvNum - 1).html(pvStr);

          if(bestMove) {
            this.board.setAutoShapes([{
              orig: pvArr[0].slice(0, 2),
              dest: pvArr[0].slice(2, 4),
              brush: 'yellow',
            }]);
          }
        }
        // mate in 0
        else if(scoreStr === '#0' || scoreStr === '-#0') {
          var pvStr = '<b>(' + scoreStr + ')</b>';
          $('#engine-pvs li').eq(0).html(pvStr);  
        }
      } 
    };
    this.uci('uci');
    this.uci('setoption name MultiPV value ' + this.numPVs);
    this.uci('ucinewgame');
    this.uci('isready');
  }

  public terminate() {
    this.stockfish.terminate();
  }

  public move(fen: string) {
    this.fen = fen;
    this.uci('position fen ' + fen);
    this.uci('go infinite');
  }

  public setNumPVs(num : any = 1) {
    this.numPVs = num;
    this.uci('setoption name MultiPV value ' + this.numPVs);
  }

  private uci(cmd: string, ports?: any) {
    return this.stockfish.postMessage(cmd, ports)
  }
}

export default Engine;
