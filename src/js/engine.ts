// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { HEntry } from './history';
import { getTurnColorFromFEN, getMoveNoFromFEN, parseMove } from './chess-helper';
import { gotoMove } from './index';
import { Game } from './game';

const SupportedCategories = ['blitz', 'lightning', 'untimed', 'standard', 'nonstandard', 'crazyhouse', 'wild/fr', 'wild/3', 'wild/4', 'wild/5', 'wild/8', 'wild/8a'];

export class Engine {
  protected stockfish: any;
  protected numPVs: number;
  protected currFen: string;
  protected currEval: string;
  protected game: Game;
  protected bestMoveCallback: (game: Game, move: string, score: string) => void;
  protected pvCallback: (game: Game, pvNum: number, pvEval: string, pvMoves: string) => void;
  protected moveParams: string;
  protected ready: boolean;

  constructor(game: Game, bestMoveCallback: (game: Game, move: string, score: string) => void, pvCallback: (game: Game, pvNum: number, pvEval: string, pvMoves: string) => void, options?: object, moveParams?: string) {
    this.numPVs = 1;
    this.moveParams = moveParams;
    this.currFen = null;
    this.game = game;
    this.bestMoveCallback = bestMoveCallback;
    this.pvCallback = pvCallback;
    this.ready = false;

    if(!this.moveParams)
      this.moveParams = 'infinite';

    const wasmSupported = typeof WebAssembly === 'object' && WebAssembly.validate(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));
    if(wasmSupported) {
      new URL('stockfish.js/stockfish.wasm', import.meta.url); // Get webpack to copy the file from node_modules
      this.stockfish = new Worker(new URL('stockfish.js/stockfish.wasm.js', import.meta.url));
    }
    else
      this.stockfish = new Worker(new URL('stockfish.js/stockfish.js', import.meta.url));

    this.stockfish.onmessage = (response) => {
      let depth0 = false;
      this.ready = true;
      
      if(response.data.startsWith('info')) {
        const fen = this.currFen;
        const info = response.data.substring(5, response.data.length);
        const infoArr: string[] = info.trim().split(/\s+/);

        let bPV = false;
        const pvArr = [];
        let scoreStr: string;
        let pvNum = 1;
        for(let i = 0; i < infoArr.length; i++) {
          if(infoArr[i] === 'lowerbound' || infoArr[i] === 'upperbound')
            return;

          if(infoArr[i] === 'depth' && infoArr[i + 1] === '0')
            depth0 = true;

          if(infoArr[i] === 'multipv') {
            pvNum = +infoArr[i + 1];
            if(pvNum > this.numPVs)
              return;
          }

          if(infoArr[i] === 'score') {
            let score = +infoArr[i + 2];
            const turn = fen.split(/\s+/)[1];

            let prefix = '';
            if(score > 0 && turn === 'w' || score < 0 && turn === 'b')
              prefix = '+';
            else if(score === 0)
              prefix = '=';
            else
              prefix = '-';
            score = (score < 0 ? -score : score);

            if(infoArr[i+1] === 'mate') {
              if(prefix === '+')
                prefix = '';
              else if(prefix === '=') {
                if(turn === 'w')
                  prefix = '-';
                else prefix = '';
              }

              scoreStr = `${prefix}#${score}`;
            }
            else
              scoreStr = `${prefix}${(score / 100).toFixed(2)}`;
          }
          else if(infoArr[i] === 'pv')
            bPV = true;
          else if(bPV)
            pvArr.push(infoArr[i]);
        }

        if(pvArr.length) {
          let pv = '';
          let currFen = fen;
          for(const move of pvArr) {
            const moveParam = move[1] === '@'
              ? move
              : {
                from: move.slice(0, 2),
                to: move.slice(2, 4),
                promotion: (move.length === 5 ? move.charAt(4) : undefined)
              };

            const parsedMove = parseMove(currFen, moveParam, game.history.first().fen, game.category);
            if(!parsedMove) {
              // Non-standard or unsupported moves were passed to Engine.
              this.terminate();
              return;
            }

            const turnColor = getTurnColorFromFEN(currFen);
            const moveNumber = getMoveNoFromFEN(currFen);
            let moveNumStr = '';
            if(turnColor === 'w')
              moveNumStr = `${moveNumber}.`;
            else if(fen === currFen && turnColor === 'b')
              moveNumStr = `${moveNumber}...`;
            pv += `${moveNumStr}${parsedMove.move.san} `;
            currFen = parsedMove.fen;
          }

          if(this.pvCallback)
            this.pvCallback(this.game, pvNum, scoreStr, pv);
        }
        // mate in 0
        else if(scoreStr === '#0' || scoreStr === '-#0') {
          if(this.pvCallback)
            this.pvCallback(this.game, 1, scoreStr, '');
        }
        this.currEval = scoreStr;

        if(depth0 && this.bestMoveCallback)
          this.bestMoveCallback(this.game, '', this.currEval);
      }
      else if(response.data.startsWith('bestmove') && this.bestMoveCallback) {
        const bestMove = response.data.trim().split(/\s+/)[1];
        this.bestMoveCallback(this.game, bestMove, this.currEval);
      }
    };

    this.uci('uci');

    // Parse options
    Object.entries(options).forEach(([key, value]) => {
      if(key === 'MultiPV')
        this.numPVs = value;

      this.uci(`setoption name ${key} value ${value}`);
    });

    this.uci('ucinewgame');
    this.uci('isready');
  }

  public static categorySupported(category: string) {
    return SupportedCategories.indexOf(category) > -1;
  }

  public terminate() {
    const worker = this.stockfish;
    if(this.ready) 
      worker.terminate();
    else { 
      // Wait for a worker to finish being created before terminating it
      // Stops an overlay error in webpack dev-server
      worker.onmessage = () => {
        worker.terminate();
      }
    }
  }

  public move(hEntry: HEntry) {
    this.currFen = hEntry.fen;

    const movesStr = this.movesToCoordinatesString(hEntry);
    this.uci(`position fen ${this.game.history.first().fen}${movesStr}`);
    this.uci(`go ${this.moveParams}`);
  }

  /**
   * Returns the list of moves from the start of the game up to this move
   * in coordinate notation as a string. Used to send the move list to Engine
   */
  public movesToCoordinatesString(hEntry: HEntry): string {
    const movelist = [];
    while(hEntry.move) {
      const move = !hEntry.move.from
        ? hEntry.move.san.replace(/[+#]/, '')
        : `${hEntry.move.from}${hEntry.move.to}${hEntry.move.promotion ? hEntry.move.promotion : ''}`;

      movelist.push(move);
      hEntry = hEntry.prev;
    }

    const movesStr = movelist.length ? ` moves ${movelist.reverse().join(' ')}` : '';
    return movesStr;
  }

  public evaluateFEN(fen: string) {
    this.currFen = fen;
    this.uci(`position fen ${fen}`);
    this.uci(`go ${this.moveParams}`);
  }

  public setNumPVs(num : any = 1) {
    this.numPVs = num;
    this.uci(`setoption name MultiPV value ${this.numPVs}`);
  }

  private uci(cmd: string, ports?: any) {
    return this.stockfish.postMessage(cmd, ports)
  }
}

export class EvalEngine extends Engine {
  private _redraw = true;
  private numGraphMoves = 0;
  private currMove: any;

  constructor(game: Game, options?: any, moveParams?: string) {
    if(!moveParams)
      moveParams = 'movetime 100';

    super(game, null, null, options, moveParams);
    this.bestMoveCallback = this.bestMove;
  }

  public bestMove(game: Game, move: string, score: string) {
    this.currMove.eval = score;
    this.currMove = undefined;
    this._redraw = true;
    this.evaluate();
  }

  public evaluate() {
    if(this._redraw)
      $('#eval-graph-container').html('');

    if(this.game.history.length() === 0 || !$('#eval-graph-panel').is(':visible'))
      return;

    if(this.currMove === undefined) {
      let total = 0; let completed = 0;
      let hEntry = this.game.history.first();
      while(hEntry) {
        if(!this.currMove && hEntry.eval == null) {
          this.currMove = hEntry;
          completed = total;
        }
        hEntry = hEntry.next;
        total++;
      }

      if(total < this.numGraphMoves) {
        this._redraw = true;
        $('#eval-graph-container').html('');
      }

      if(this.currMove) {
        this.move(this.currMove);

        const progress = Math.round(100 * completed / total);
        // update progress bar
        $('#eval-progress .progress-bar')
          .css('width', `${progress}%`)
          .text(`${progress}%`)
          .attr('aria-valuenow', progress);
        if(total > completed + 10) {
          $('#eval-graph-container').hide();
          $('#eval-progress').show();
        }
      }
      else {
        $('#eval-progress').hide();
        this.drawGraph();
      }
    }
  }

  public redraw() {
    this._redraw = true;
    this.evaluate();
  }

  private drawGraph() {
    const dataset = [];
    let currIndex: number;
    let moveEval: number;

    let hEntry = this.game.history.first();

    for(let i = 0; hEntry != null; i++) {
      if(hEntry === this.game.history.current())
        currIndex = i;

      if(hEntry.eval.includes('#')) {
        if(hEntry.eval.includes('-'))
          moveEval = -5;
        else
          moveEval = 5;
      }
      else {
        moveEval = +hEntry.eval.replace(/[+=]/g,'');
        if(moveEval > 5)
          moveEval = 5;
        else if(moveEval < -5)
          moveEval = -5;
      }
      dataset.push({evalStr: hEntry.eval, y: moveEval});
      hEntry = hEntry.next;
    }

    const container = $('#eval-graph-container');
    container.show();

    const margin = {top: 6, right: 6, bottom: 6, left: 18};
    const width = container.width() - margin.left - margin.right; // Use the window's width
    const height = container.height() - margin.top - margin.bottom; // Use the window's height

    // Prepare data set
    const n = this.numGraphMoves = dataset.length;

    // Define x and y scales
    const xScale = d3.scaleLinear()
      .domain([0, n-1]) // input
      .range([0, width]); // output

    const yScale = d3.scaleLinear()
      .domain([-5.5, 5.5]) // input
      .range([height, 0]); // output

    if(this._redraw) {
      // Fill area generator
      const area = d3.area()
        .x((d, i) => xScale(i))
        .y0(yScale(0))
        .y1((d) => yScale(d.y))
        .curve(d3.curveMonotoneX);

      // Line generator
      const line = d3.line()
        .x((d, i) => xScale(i))
        .y((d) => yScale(d.y))
        .curve(d3.curveMonotoneX);

      // Add SVG to panel
      const svg = d3.select(container[0]).append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .style('cursor', 'pointer')
        .on('mousemove', (event) => {
          const mousePosition = d3.pointer(event);
          const xPos = mousePosition[0] - margin.left;
          const getDistanceFromPos = (d) => Math.abs(d - xScale.invert(xPos));
          const closestIndex = d3.scan(
            d3.range(n),
            (a, b) => getDistanceFromPos(a) - getDistanceFromPos(b)
          );

          hoverLine
            .attr('x', xScale(closestIndex))
            .style('opacity', 1);

          const oldIndex = Math.round(xScale.invert($('#hover-circle').attr('cx')));

          hoverCircle
            .attr('cx', xScale(closestIndex))
            .attr('cy', yScale(dataset[closestIndex].y))
            .attr('title', dataset[closestIndex].evalStr)
            .attr('data-bs-original-title', dataset[closestIndex].evalStr)
            .style('opacity', 1);

          if(oldIndex !== closestIndex) {
            $('#hover-circle')
              .tooltip('dispose')
              .tooltip({
                container: '#eval-graph-container',
                placement: 'auto',
                trigger: 'manual'
              });
            $('#hover-circle').tooltip('show');
            $('.tooltip').css('pointer-events', 'none');
          }
        })
        .on('mouseleave', () => {
          hoverLine.style('opacity', 0);
          hoverCircle.style('opacity', 0)
            .attr('cx', -1);
          $('#hover-circle').tooltip('dispose');
        })
        .on('click', (event) => {
          const mousePosition = d3.pointer(event);
          const xPos = mousePosition[0] - margin.left;
          const getDistanceFromPos = (d) => Math.abs(d - xScale.invert(xPos));
          const closestIndex = d3.scan(
            d3.range(n),
            (a, b) => getDistanceFromPos(a) - getDistanceFromPos(b)
          );

          gotoMove(this.game.history.getByIndex(closestIndex));

          if(closestIndex) {
            selectCircle
              .attr('cx', xScale(closestIndex))
              .attr('cy', yScale(dataset[closestIndex].y))
              .style('opacity', 1);
          }
          else
            selectCircle.style('opacity', 0);
        })
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

      // Render y-axis
      const yAxis = svg.append('g')
        .attr('class', 'eval-axis y-axis noselect')
        .call(d3.axisLeft(yScale).tickSize(-width, 0, 0)); // Create an axis component with d3.axisLeft
      yAxis.select('.domain').remove();

      // define clipping regions for our 2 colors, above 0 and below 0
      const defs = svg.append('defs');
      defs.append('clipPath')
        .attr('id', 'clip-above')
        .append('rect')
        .attr('x', 0)
        .attr('y', yScale(5))
        .attr('width', width)
        .attr('height', height / 2)

      defs.append('clipPath')
        .attr('id', 'clip-below')
        .append('rect')
        .attr('x', 0)
        .attr('y', yScale(0))
        .attr('width', width)
        .attr('height', height / 2)

      // render fill areas
      svg.append('path')
        .datum(dataset)
        .attr('class', 'eval-area-above')
        .attr('clip-path', 'url(#clip-above)')
        .attr('d', area);

      svg.append('path')
        .datum(dataset)
        .attr('class', 'eval-area-below')
        .attr('clip-path', 'url(#clip-below)')
        .attr('d', area);

      // render lines
      svg.append('path')
        .datum(dataset)
        .attr('class', 'eval-line-above')
        .attr('clip-path', 'url(#clip-above)')
        .attr('d', line);

      svg.append('path')
        .datum(dataset)
        .attr('class', 'eval-line-below')
        .attr('clip-path', 'url(#clip-below)')
        .attr('d', line);

      const hoverLine = svg.append('g')
        .append('rect')
        .attr('class', 'eval-hover-line')
        .attr('stroke-width', '1px')
        .attr('width', '.5px')
        .attr('height', height)
        .style('opacity', 0);

      const hoverCircle = svg.append('g')
        .append('circle')
        .attr('id', 'hover-circle')
        .attr('class', 'eval-circle')
        .attr('r', 3)
        .style('opacity', 0);

      const selectCircle = svg.append('g')
        .append('circle')
        .attr('class', 'eval-circle')
        .attr('id', 'select-circle')
        .attr('r', 4)
        .style('opacity', 0);

      this._redraw = false;
    }

    const currMoveCircle = $('#select-circle');
    if(currMoveCircle) {
      if(currIndex)
        currMoveCircle
          .attr('cx', xScale(currIndex))
          .attr('cy', yScale(dataset[currIndex].y))
          .css('opacity', 1);
      else
        currMoveCircle
          .css('opacity', 0);
    }
  }
}

export default Engine;
