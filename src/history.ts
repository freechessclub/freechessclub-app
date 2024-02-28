// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { gotoMove, updateBoard } from './index';
import * as d3 from 'd3';

export class History {
  private board: any;
  private moves: any[];
  private id: number;
  private _scratch: boolean;

  constructor(fen: string, board: any, wtime: number = 0, btime: number = 0) {
    this.board = board;
    this.moves = [];
    this.id = -1;
    this._scratch = false;

    $('#move-history').empty();

    $('#collapse-history').on('hidden.bs.collapse', () => {
      $('#history-toggle-icon').removeClass('fa-toggle-up').addClass('fa-toggle-down');
    });
    $('#collapse-history').on('shown.bs.collapse', () => {
      $('#history-toggle-icon').removeClass('fa-toggle-down').addClass('fa-toggle-up');
    });

    this.add(undefined, fen, false, wtime, btime);
  }

  public reset(fen: string, wtime: number, btime: number) {
    this.moves = [];
    this.id = -1;
    $('#move-history').empty();
    this.add(undefined, fen, false, wtime, btime);
  }

  public updateClockTimes(index: number, wtime: number, btime: number) {
    if(index === undefined)
      index = this.id;
    
    // if subvariation, use clock times from last mainline move
    var i = index;
    while(this.moves[i].subvariation) {
      i = this.prev(i);
      wtime = this.moves[i].wtime;
      btime = this.moves[i].btime;
    }

    if(this.scratch()) 
      wtime = btime = 0;
    
    this.moves[index].wtime = wtime;
    this.moves[index].btime = btime;    
  }

  public add(move: any, fen: string, subvariation: boolean = false, wtime: number = 0, btime: number = 0, score?: number): void {
    if(subvariation) {
      if(this.moves[this.id].subvariation) {
        while(this.id < this.length() && this.moves[this.id + 1].subvariation)
          this.remove(this.id + 1);
      }
      else
        this.removeSubvariation();

      if(this.id < this.length() && !this.moves[this.id].subvariation)
        this.id++;
    }
    else {
      while(this.id < this.length())
        this.remove(this.id + 1);
    }

    this.id++;

    this.moves.splice(this.id, 0, {move, fen, subvariation, opening: null});
    this.updateClockTimes(this.id, wtime, btime);

    if(move)
      this.addTableItem(move.san, History.getPlyFromFEN(fen), subvariation, this.id, score);
  }

  public scratch(_scratch?: boolean):  any {
    if(_scratch !== undefined)
      this._scratch = _scratch;

    return this._scratch;
  }

  public highlightMove() {
    $('#move-history a').each(function () {
      $(this).removeClass('selected');
    });

    if(this.id !== 0) {
      const cellText = $('#move-history a').eq(this.id - 1);
      cellText.addClass('selected');

      this.scrollParentToChild($('#pills-game'), cellText.parent());
    }
    else $('#pills-game').scrollTop(0);
  }

  public scrollParentToChild(parent: any, child: any) {
    parent = parent[0];
    child = child[0];

    // Where is the parent on page
    const parentRect = parent.getBoundingClientRect();
    // What can you see?
    const parentViewableArea = {
      height: parent.clientHeight,
      width: parent.clientWidth
    };

    // Where is the child
    const childRect = child.getBoundingClientRect();
    // Is the child viewable?
    const isViewable = (childRect.top >= parentRect.top) && (childRect.bottom <= parentRect.top + parentViewableArea.height);

    // if you can't see the child try to scroll parent
    if (!isViewable) {
      // Should we scroll using top or bottom? Find the smaller ABS adjustment
      const scrollTop = childRect.top - parentRect.top;
      const scrollBot = childRect.bottom - parentRect.bottom;
      if (Math.abs(scrollTop) < Math.abs(scrollBot)) {
        // we're near the top of the list
        parent.scrollTop += scrollTop;
      } else {
        // we're near the bottom of the list
        parent.scrollTop += scrollBot;
      }
    }
  }

  public removeSubvariation() {
    let inSub = false;

    for(let i = this.length(); i > 0; i--) {
      const move = this.moves[i];
      if(move.subvariation) {
        if(this.id === i)
          inSub = true;
        this.remove(i);
      }
    }

    if(inSub)
      this.display(this.id);
  }

  public remove(id: number): void {
    if(this.id === id)
      this.id = this.prev(id);
    else if(this.id > id)
      this.id--;

    this.moves.splice(id, 1);

    if(id > 0)
      this.removeTableItem(id);
  }

  public removeLast(): void {
    this.remove(this.length());
  }

  public removeAll(): void {
    $('#move-history').empty();
    this.id = 0;
    this.moves = [ {move: null, fen: this.board.getFen(), subvariation: false} ];
  }

  public length(): number {
    return this.moves.length - 1;
  }

  public goto(id?: number) {
    if (id !== undefined) {
      this.id = id;
    }    
    return this.moves[this.id];
  }

  public display(id?: number, playSound = false): any {
    if (id !== undefined) {
      this.id = id;
    }

    if (this.id >= 0 && this.id < this.moves.length)
      updateBoard(playSound);

    this.highlightMove();

    return this.moves[this.id];
  }

  public find(fen: string): number {
    // Search forward and back through the current line we're in (mainline or subvariation)
    let i = this.id;
    do {
      if(this.moves[i].fen === fen)
        return i;
      i = this.next(i);
    } while(i !== undefined);

    i = this.id;
    do {
      if(this.moves[i].fen === fen)
        return i;
      i = this.prev(i);
    } while(i !== undefined);

    // Check whether the move is in a subvariation directly following the current mainline move
    if(this.id < this.length()) {
      if(this.moves[this.id + 1].fen === fen)
        return this.id + 1;

      if(this.id + 1 < this.length()) {
        if(this.moves[this.id + 2].fen === fen)
          return this.id + 2;
      }
    }

    return;
  }

  public get(id?: number): any {
    if(id === undefined)
      return this.moves[this.id];
    return this.moves[id];
  }

  public index(): number {
    return this.id;
  }

  public ply(id?: number): number {
    if(id === undefined)
      id = this.id;

    return History.getPlyFromFEN(this.moves[id].fen);
  }

  public moveNo(id?: number): number {
    if(id === undefined)
      id = this.id;

    return History.getMoveNoFromFEN(this.moves[id].fen);
  }

  public static getPlyFromFEN(fen: string) {
    const turnColor = fen.split(/\s+/)[1];
    const moveNo = +fen.split(/\s+/).pop();
    const ply = moveNo * 2 - (turnColor === 'w' ? 1 : 0);

    return ply;
  }

  public static getMoveNoFromFEN(fen: string): number {
    return +fen.split(/\s+/).pop();
  }

  public static getTurnColorFromFEN(fen: string): string {
    return fen.split(/\s+/)[1];
  }

  public first(): any {
    return 0;
  }

  public beginning(): any {
    this.display(this.first());
    return this.moves[this.id];
  }

  public backward(): any {
    const index = this.prev();
    if(index !== undefined) {
      this.display(index);
      return this.moves[index];
    }
    return;
  }

  public prev(id?: number): any {
    if(id === undefined)
      id = this.id;

    if (id === 0)
      return;

    if(this.moves[id].subvariation) {
      if(History.getTurnColorFromFEN(this.moves[id].fen) === History.getTurnColorFromFEN(this.moves[id - 1].fen))
        return id - 2;
      else
        return id - 1;
    }
    else {
      for(let i = id - 1; i >= 0; i--) {
        if(!this.moves[i].subvariation)
          return i;
      }
    }

    return;
  }

  public forward(): any {
    const index = this.next();
    if(index !== undefined) {
      this.display(index, true);
      return this.moves[index];
    }
    return;
  }

  public next(id?: number): any {
    if(id === undefined)
      id = this.id;

    if (id === this.length())
      return;

    const index = undefined;

    if(this.moves[id].subvariation) {
      if(this.moves[id + 1].subvariation)
        return id + 1;
    }
    else {
      for(let i = id + 1; i <= this.length(); i++) {
        if(!this.moves[i].subvariation)
          return i;
      }
    }

    return;
  }

  public last(): any {
    for(let i = this.length(); i >= 0; i--)
    {
      if(!this.moves[i].subvariation)
        return i;
    }
    return;
  }

  public end(): any {
    const index = this.last();
    if(index !== undefined) {
      this.display(index);
      return this.moves[index];
    }
    return;
  }

  public undo(): void {
    if(this.id > 0) {
      if (this.id === this.length())
        this.display(this.prev());
      this.moves.pop();
    }
  }

  private removeTableItem(id: number) {
    const cell = $('#move-history .selectable').eq(id - 1);
    if(cell.next('.selectable').length !== 0 || cell.prev('.selectable').length !== 0) {
      cell.html('');
      cell.removeClass('selectable');
    }
    else {
      const prevRow = cell.parent().prev();
      if(prevRow.length !== 0)
        var prevCell = prevRow.children('td').last();
      const nextRow = cell.parent().next();
      if(nextRow.length !== 0)
        var nextCell = nextRow.children('td').first();

      if(prevCell && !prevCell.hasClass('selectable') && !prevRow.hasClass('subvariation')
          && nextCell && !nextCell.hasClass('selectable') && !nextRow.hasClass('subvariation')) {
        prevCell.html(nextCell.next().html());
        prevCell.attr('class', nextCell.next().attr('class'));
        nextRow.remove();
      }

      cell.parent().remove();
    }
  }

  private addTableItem(move: string, ply: number, subvariation: boolean, id?: number, score?: number): void {
    if (id === undefined) {
      id = this.length();
    }

    let scoreStr = '';
    if (score !== undefined) {
      scoreStr = ' (' + score + ')';
    }

    const moveNo = Math.floor(ply / 2);
    const cellBody = '<a href="javascript:void(0);">' + move + '</a>' + scoreStr;

    const prevCell = $('#move-history .selectable').eq(id - 2);

    if(prevCell.length === 0) {
      if(ply % 2 == 0) 
        $('#move-history').append('<tr><th scope="row">' + moveNo + '</th><td class="selectable">' + cellBody + '</td><td></td></tr>');
      else
        $('#move-history').append('<tr><th scope="row">' + moveNo + '</th><td></td><td class="selectable">' + cellBody + '</td></tr>');
    }
    else if(subvariation && !prevCell.parent().hasClass('subvariation')) {
      if(ply % 2 == 0) {
        prevCell.parent().after('<tr class="subvariation"><th scope="row">' + moveNo + '</th><td class="selectable">' + cellBody + '</td><td></td></tr>');

        if(id !== this.length()) {
          prevCell.parent().next().after('<tr><th scope="row">' + moveNo + '</th><td></td><td class="selectable">' + prevCell.next().html() + '</td></tr>');
          prevCell.next().html('');
          prevCell.next().removeClass('selectable');
        }
      }
      else {
        prevCell.parent().after('<tr class="subvariation"><th scope="row">' + moveNo + '</th><td></td><td class="selectable">' + cellBody + '</td></tr>');
      }
    }
    else {
      const cell = prevCell.next();

      if(!cell.length) {
        prevCell.parent().after('<tr><th scope="row">' + moveNo + '</th><td class="selectable">' + cellBody + '</td><td></td></tr>');
        if(subvariation)
          prevCell.parent().next().addClass('subvariation');
      }
      else {
        cell.html(cellBody);
        cell.addClass('selectable');
        if(subvariation)
          cell.parent().addClass('subvariation');
      }
    }
  }

  public isThreefoldRepetition(id?: number): boolean {
    if(id === undefined)
      id = this.id;
      
    var currFen = this.get(id).fen;
    var words = currFen.split(/\s+/);
    words.splice(4,2);
    currFen = words.join(' ');

    var repeats = 1;

    id = this.prev(id);
    while(id) {
      var fen = this.get(id).fen;
      var words = fen.split(/\s+/);
      words.splice(4,2);
      fen = words.join(' ');
      if(fen === currFen)
        repeats++;

      if(repeats === 3)
        return true;

      id = this.prev(id);
    }

    return false;
  }

  public showMoveTimes() {
    if(this.length() === 0 || !$('#move-times-panel').is(':visible'))
      return;

    $('#move-times-container').html('');
    this.drawGraph();
  }

  private drawGraph() {
    const dataset = [];
    let currIndex;
    const that = this;

    for(let i = 0, hIndex = 0; hIndex !== undefined; i++) {
      if(hIndex === this.index())
        currIndex = i;

      const move = this.get(hIndex);
      dataset.push({y1: move.wtime/1000, y2: -move.btime/1000});
      hIndex = this.next(hIndex);
    }

    const container = $('#move-times-container');
    container.show();

    const margin = {top: 6, right: 6, bottom: 6, left: 24}
      ; const width = container.width() - margin.left - margin.right // Use the window's width
      ; const height = container.height() - margin.top - margin.bottom; // Use the window's height

    // Prepare data set
    const n = dataset.length;

    // Define x and y scales
    const xScale = d3.scaleLinear()
      .domain([0, n-1]) // input
      .range([0, width]); // output

    const yScale = d3.scaleLinear()
      .domain([d3.min(dataset, d => Math.min(d.y1, d.y2)), d3.max(dataset, d => Math.max(d.y1, d.y2))]) // input
      .range([height, 0]); // output

    // Line generator
    const line1 = d3.line()
    .x(function(d, i) { return xScale(i); })
    .y(function(d) { return yScale(d.y1); });

    const line2 = d3.line()
    .x(function(d, i) { return xScale(i); })
    .y(function(d) { return yScale(d.y2); });

    // Add SVG to panel
    const svg = d3.select(container[0]).append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .style('cursor', 'pointer')
      .on('mousemove', function() {
        const mousePosition = d3.pointer(event);
        const xPos = mousePosition[0] - margin.left;
        const yPos = mousePosition[1] - margin.top;
        const getDistanceFromPos = (d) => Math.abs(d - xScale.invert(xPos));
        const closestIndex = d3.scan(
          d3.range(n),
          (a, b) => getDistanceFromPos(a) - getDistanceFromPos(b)
        );

        hoverLine
          .attr('x', xScale(closestIndex))
          .style('opacity', 1);

        const oldIndex1 = Math.round(xScale.invert($('#hover-circle1').attr('cx')));
        const oldIndex2 = Math.round(xScale.invert($('#hover-circle2').attr('cx')));

        hoverCircle1
          .attr('cx', xScale(closestIndex))
          .attr('cy', yScale(dataset[closestIndex].y1))
          .attr('title', dataset[closestIndex].y1)
          .attr('data-bs-original-title', dataset[closestIndex].y1)
          .style('opacity', 1);

        hoverCircle2
          .attr('cx', xScale(closestIndex))
          .attr('cy', yScale(dataset[closestIndex].y2))
          .attr('title', dataset[closestIndex].y2)
          .attr('data-bs-original-title', dataset[closestIndex].y2)
          .style('opacity', 1);

        if(oldIndex1 !== closestIndex) {
          $('#hover-circle1')
            .tooltip('dispose')
            .tooltip({
              container: '#move-times-container',
              placement: 'auto',
              trigger: 'manual'
            });
          $('#hover-circle1').tooltip('show');
          $('.tooltip').css('pointer-events', 'none');
        }

        if(oldIndex2 !== closestIndex) {
          $('#hover-circle2')
            .tooltip('dispose')
            .tooltip({
              container: '#move-times-container',
              placement: 'auto',
              trigger: 'manual'
            });
          $('#hover-circle2').tooltip('show');
          $('.tooltip').css('pointer-events', 'none');
        }
      })
      .on('mouseleave', function() {
        hoverLine.style('opacity', 0);
        hoverCircle1.style('opacity', 0)
          .attr('cx', -1);
        hoverCircle2.style('opacity', 0)
          .attr('cx', -1);
        $('#hover-circle1').tooltip('dispose');
        $('#hover-circle2').tooltip('dispose');
      })
      .on('click', function(event) {
        const mousePosition = d3.pointer(event);
        const xPos = mousePosition[0] - margin.left;
        const getDistanceFromPos = (d) => Math.abs(d - xScale.invert(xPos));
        const closestIndex = d3.scan(
          d3.range(n),
          (a, b) => getDistanceFromPos(a) - getDistanceFromPos(b)
        );

        let historyIndex = 0;
        for(let i = 0; i < closestIndex; i++)
          historyIndex = that.next(historyIndex);
        gotoMove(historyIndex);

        if(historyIndex) {
          selectCircle1
            .attr('cx', xScale(closestIndex))
            .attr('cy', yScale(dataset[closestIndex].y1))
            .style('opacity', 1);
          selectCircle2
            .attr('cx', xScale(closestIndex))
            .attr('cy', yScale(dataset[closestIndex].y2))
            .style('opacity', 1);
        }
        else {
          selectCircle1.style('opacity', 0);
          selectCircle2.style('opacity', 0);
        }
      })
      .append('g')
      .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    // Render y-axis
    const yAxis = svg.append('g')
      .attr('class', 'eval-axis y-axis noselect')
      .call(d3.axisLeft(yScale).tickSize(-width, 0, 0)); // Create an axis component with d3.axisLeft
    yAxis.select('.domain').remove();

    svg.append('path')
      .datum(dataset)
      .attr('class', 'eval-line-above')
      .attr('d', line1);

    svg.append('path')
      .datum(dataset)
      .attr('class', 'eval-line-below')
      .attr('d', line2);

    const hoverLine = svg.append('g')
      .append('rect')
      .attr('class', 'eval-hover-line')
      .attr('stroke-width', '1px')
      .attr('width', '.5px')
      .attr('height', height)
      .style('opacity', 0);

    const hoverCircle1 = svg.append('g')
      .append('circle')
      .attr('id', 'hover-circle1')
      .attr('class', 'eval-circle')
      .attr('r', 3)
      .style('opacity', 0);

    const hoverCircle2 = svg.append('g')
      .append('circle')
      .attr('id', 'hover-circle2')
      .attr('class', 'eval-circle')
      .attr('r', 3)
      .style('opacity', 0);

    const selectCircle1 = svg.append('g')
      .append('circle')
      .attr('class', 'eval-circle')
      .attr('id', 'select-circle1')
      .attr('r', 4)
      .style('opacity', 0);

    const selectCircle2 = svg.append('g')
      .append('circle')
      .attr('class', 'eval-circle')
      .attr('id', 'select-circle2')
      .attr('r', 4)
      .style('opacity', 0);

    const currMoveCircle1 = $('#select-circle1');
    if(currMoveCircle1) {
      if(currIndex)
        currMoveCircle1
          .attr('cx', xScale(currIndex))
          .attr('cy', yScale(dataset[currIndex].y1))
          .css('opacity', 1);
      else
        currMoveCircle1
          .css('opacity', 0);
    }
    const currMoveCircle2 = $('#select-circle2');
    if(currMoveCircle2) {
      if(currIndex)
        currMoveCircle2
          .attr('cx', xScale(currIndex))
          .attr('cy', yScale(dataset[currIndex].y2))
          .css('opacity', 1);
      else
        currMoveCircle2
          .css('opacity', 0);
    }
  }

}

export default History;
