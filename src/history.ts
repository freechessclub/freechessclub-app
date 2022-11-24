// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { updateBoard } from "./index";

export class History {
  private board: any;
  private moves: any[];
  private id: number;
  private _scratch: boolean;

  constructor(fen: string, board: any) {
    this.board = board;
    this.moves = new Array();
    this.id = -1;
    this._scratch = false;

    $('#move-history').empty();

    $('#collapse-history').on('hidden.bs.collapse', () => {
      $('#history-toggle-icon').removeClass('fa-toggle-up').addClass('fa-toggle-down');
    });
    $('#collapse-history').on('shown.bs.collapse', () => {
      $('#history-toggle-icon').removeClass('fa-toggle-down').addClass('fa-toggle-up');
    });

    this.add(undefined, fen);
  }

  public addPrev(moves: any[]): void {
    for (let i = 0; i < moves.length; i++) {
      this.moves[i] = moves[i];
      if(moves[i].move) 
        this.addTableItem(moves[i].move.san, this.getPlyFromFEN(moves[i].fen), false, i);
    }
  }

  public add(move: any, fen: string, subvariation?: boolean, score?: number): void {     
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

    this.moves.splice(this.id, 0, {move: move, fen: fen, subvariation: subvariation});

    if(move) 
      this.addTableItem(move.san, this.getPlyFromFEN(fen), subvariation, this.id, score);
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
      var cellText = $('#move-history a').eq(this.id - 1);
      cellText.addClass('selected');

      this.scrollParentToChild($('#pills-game'), cellText.parent());  
    }
    else $('#pills-game').scrollTop(0);
  }

  public scrollParentToChild(parent: any, child: any) {
    parent = parent[0];
    child = child[0];

    // Where is the parent on page
    var parentRect = parent.getBoundingClientRect();
    // What can you see?
    var parentViewableArea = {
      height: parent.clientHeight,
      width: parent.clientWidth
    };
    
    // Where is the child
    var childRect = child.getBoundingClientRect();
    // Is the child viewable?
    var isViewable = (childRect.top >= parentRect.top) && (childRect.bottom <= parentRect.top + parentViewableArea.height);
    
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
    var inSub = false;

    for(let i = this.length(); i > 0; i--) {
      var move = this.moves[i];
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
    this.removeTableItem(id);
  }

  public removeLast(): void {
    this.undo();

    const id: number = this.length();
    if (id % 2 === 1) {
      $('#move-history tr:last td').children().last().remove();
    } else {
      $('#move-history tr:last').remove();
    }
  }

  public removeAll(): void {
    $('#move-history').empty();
    this.id = 0;
    this.moves = [ {move: null, fen: this.board.getFen(), subvariation: false} ];
  }

  public length(): number {
    return this.moves.length - 1;
  }

  public display(id?: number, playMove: boolean = false): any {
    if (id !== undefined) {
      this.id = id;
    }

    if (this.id >= 0 && this.id < this.moves.length) 
      updateBoard(playMove);

    this.highlightMove();

    return this.moves[this.id];
  }

  public find(fen: string): number {
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

    return this.getPlyFromFEN(this.moves[id].fen);
  }

  public moveNo(id?: number): number {
    if(id === undefined)
      id = this.id;

    return this.getMoveNoFromFEN(this.moves[id].fen);
  }

  public getPlyFromFEN(fen: string) {
    var turnColor = fen.split(/\s+/)[1];
    var moveNo = +fen.split(/\s+/).pop();
    var ply = moveNo * 2 - (turnColor === 'w' ? 1 : 0);
  
    return ply;
  }

  public getMoveNoFromFEN(fen: string): number {    
    return +fen.split(/\s+/).pop(); 
  }  

  public getTurnColorFromFEN(fen: string): string {
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
    var index = this.prev();
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
      if(this.getTurnColorFromFEN(this.moves[id].fen) === this.getTurnColorFromFEN(this.moves[id - 1].fen))
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
    var index = this.next();
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

    var index = undefined;

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
    var index = this.last();
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
    var cell = $('#move-history .selectable').eq(id - 1);
    if(cell.next('.selectable').length !== 0 || cell.prev('.selectable').length !== 0) {
      cell.html('');
      cell.removeClass('selectable');
    }
    else {
      var prevRow = cell.parent().prev();
      if(prevRow.length !== 0)
        var prevCell = prevRow.children('td').last();
      var nextRow = cell.parent().next();
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

    var moveNo = Math.floor(ply / 2);
    var cellBody = '<a href="javascript:void(0);">' + move + '</a>' + scoreStr;

    var prevCell = $('#move-history .selectable').eq(id - 2);
 
    if(prevCell.length === 0) 
      $('#move-history').append('<tr><th scope="row">' + moveNo + '</th><td class="selectable">' + cellBody + '</td><td></td></tr>'); 
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
      var cell = prevCell.next();

      if(!cell.length) {
        prevCell.parent().after('<tr><th scope="row">' + moveNo + '</th><td class="selectable">' + cellBody + '</td><td></td></tr>');
        if(subvariation)
          prevCell.parent().next().addClass('subvariation');
      }
      else {
        cell.html(cellBody);
        cell.addClass("selectable");
        if(subvariation)
          cell.parent().addClass("subvariation");
      }
    }
  }
}

export default History;
