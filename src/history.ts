// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { updateBoard } from './index';

export class HEntry {
  public move: any;
  public fen: string;
  public wtime: number;
  public btime: number;
  public score: string;
  public eval: string;
  public moveTableElement: any;
  public opening: string;
  public holdings: any;
  private _next: HEntry;
  private _prev: HEntry;
  private _parent: HEntry;
  private _subvariations: HEntry[];
  
  constructor(move: any, fen: string, wtime: number = 0, btime: number = 0, score?: string) {
    this.move = move;
    this.fen = fen;
    this.wtime = wtime;
    this.btime = btime;
    this.score = score;
    this._subvariations = [];
  }

  public get prev(): HEntry {
    if(this._prev)
      return this._prev;

    var parent = this.parent;
    if(parent) {
      if(History.getPlyFromFEN(parent.fen) === History.getPlyFromFEN(this.fen))
        return parent.prev; // this move was a subvariation
      else
        return parent; // this move was a continuation (at the end of the main line)
    }

    return;
  }

  public set prev(item: HEntry) {
    this._prev = item;
  }

  public get next(): HEntry {
    return this._next;
  }

  public set next(item: HEntry) {
    this._next = item;
  }

  public get parent(): HEntry {
    return this._parent;
  }

  public set parent(item: HEntry) {
    this._parent = item;
  }

  public get first(): HEntry {
    var e: HEntry | null = this;
    while(e._prev)
      e = e._prev;

    return e;
  }

  public get last(): HEntry {
    var e: HEntry | null = this;
    while(e._next)
      e = e._next;

    return e;
  }

  public get subvariations(): HEntry[] {
    return this._subvariations;
  }

  public get ply(): number {
    return History.getPlyFromFEN(this.fen);
  }

  public get moveNo(): number {
    return History.getMoveNoFromFEN(this.fen);
  }

  public get turnColor(): string {
    return History.getTurnColorFromFEN(this.fen);
  }

  public add(item: HEntry) {
    item.prev = this;
    this.next = item;
    item.parent = this.parent;
  }

  public remove() {
    if(this._prev)
      this._prev._next = null;
    else if(this._parent) {
      // Element is the first move in a subvariation, so remove that subvariation 
      var subvariations = this._parent._subvariations;
      for(let i = 0; i < subvariations.length; i++) {
        if(subvariations[i] === this)
          this._parent.removeSubvariation(i);
      }
    }
  }

  public isSubvariation(): boolean {
    return !!this.parent;
  }

  public addSubvariation(entry: HEntry) {
    entry.parent = this;
    this._subvariations.push(entry);
  }

  public removeSubvariation(index: number) {
    this._subvariations.splice(index, 1);
  }

  public getLastSubmove(): HEntry {
    if(this.subvariations.length === 0)
      return this;

    var lastSub = this.subvariations[this.subvariations.length - 1]; 
    return lastSub.last.getLastSubmove();
  }

  public depth(): number {
    var p: HEntry | null = this;
    var depth = 0;
    while(p.parent) {
      p = p.parent;
      depth++;
    }    
    return depth;
  }
}

export class History {
  private board: any;
  private firstEntry: HEntry;
  private currEntry: HEntry;
  private _scratch: boolean;

  constructor(fen: string, board: any, wtime: number = 0, btime: number = 0) {
    this.board = board;
    this._scratch = false;

    $('#collapse-history').on('hidden.bs.collapse', () => {
      $('#history-toggle-icon').removeClass('fa-toggle-up').addClass('fa-toggle-down');
    });
    $('#collapse-history').on('shown.bs.collapse', () => {
      $('#history-toggle-icon').removeClass('fa-toggle-down').addClass('fa-toggle-up');
    });

    this.reset(fen, wtime, btime);
  }

  public reset(fen: string, wtime: number, btime: number) {
    this.firstEntry = this.currEntry = new HEntry(undefined, fen);
    this.updateClockTimes(this.firstEntry, wtime, btime);
    $('#move-history').empty();
  }

  public updateClockTimes(entry: HEntry, wtime: number, btime: number) {   
    // if subvariation, use clock times from last mainline move
    var p = entry;
    while(p.isSubvariation()) {
      p = p.prev;
      wtime = p.wtime;
      btime = p.btime;
    }

    if(this.scratch()) 
      wtime = btime = 0;
    
    entry.wtime = wtime;
    entry.btime = btime;    
  }

  public add(move: any, fen: string, newSubvariation: boolean = false, wtime: number = 0, btime: number = 0, score?: string): void {
    var newEntry = new HEntry(move, fen);
    
    if(newSubvariation) {
      this.removeAllSubvariations();
      if(this.currEntry.next)
        this.currEntry.next.addSubvariation(newEntry); // Add subvariation
      else
        this.currEntry.addSubvariation(newEntry); // Add continuation
    }
    else {
      if(this.currEntry.next)
        this.remove(this.currEntry.next);
      this.currEntry.add(newEntry);
    }

    this.updateClockTimes(newEntry, wtime, btime);

    this.currEntry = newEntry;

    if(move) 
      this.addTableItem(this.currEntry);
  }

  public remove(entry: HEntry): void {
    // remove this entry and all following entries and subvariations
    var c = entry;
    while(c) {
      for(let s of c.subvariations)
        this.remove(s);

      // Check if currEntry is about to get removed
      if(c === this.currEntry)
        this.currEntry = entry.prev;

      this.removeTableItem(c);   
      c = c.next;
    }
    entry.remove();
  }

  public removeLast(): void {
    this.remove(this.last());
  }

  public removeSubvariation(entry: HEntry) {
    var first = entry.first;

    var oldCurrEntry = this.currEntry;    
    this.remove(first);
    if(oldCurrEntry !== this.currEntry) // current move was removed
      this.display();
  }

  public removeAllSubvariations() {
    var c = this.firstEntry;
    while(c) {
      for(let s of c.subvariations)
        this.removeSubvariation(s);  
      c = c.next;
    }
  }

  public length(): number {
    var count = 0;
    var entry = this.firstEntry;
    while(entry.next) {
      entry = entry.next;
      count++;
    }
    return count;
  }

  public goto(entry: HEntry) {
    this.currEntry = entry;
  }

  public display(entry?: HEntry, playSound = false) {
    if(entry) 
      this.currEntry = entry;

    updateBoard(playSound);
    this.highlightMove();
  }

  public getByIndex(id: number): HEntry {
    var c = this.firstEntry;
    var i = 0;
    while(c) {
      if(i === id)
        return c;
      i++;
      c = c.next;
    }
    return;
  }

  public current(): HEntry {
    return this.currEntry;
  }

  public index(entry: HEntry): number {
    var c = this.firstEntry;
    var i = 0;
    while(c) {
      if(c === entry)
        return i;
      i++;
      c = c.next;
    }
    return;
  }

  public first(): HEntry {
    return this.firstEntry;
  }

  public beginning(): HEntry {
    if(this.current() !== this.first())
      this.display(this.first());
    return this.first();
  }

  public backward(): HEntry {
    var entry = this.prev();
    if(entry) {
      this.display(entry);
      return entry;
    }
    return;
  }

  public prev(): HEntry {
    return this.currEntry.prev;
  }

  public forward(): any {
    var entry = this.next();
    if(entry) {
      this.display(entry, true);
      return entry;
    }
    return;
  }

  public next(): HEntry {
    return this.currEntry.next;
  }

  public last(): HEntry {
    return this.first().last;
  }

  public end(): any {
    var last = this.last();
    if(this.current() !== last)
      this.display(last);  
    return last;
  }

  public find(fen: string): HEntry {
    // Search forward and back through the current line we're in
    var c = this.currEntry;
    while(c) {
      if(c.fen === fen)
        return c;
      c = c.next;
    }

    var c = this.currEntry.prev;
    while(c) {
      if(c.fen === fen)
        return c;
      c = c.prev;
    }

    // Check whether the move is in a subvariation directly following the current move 
    if(this.currEntry.next) {
      for(let s of this.currEntry.next.subvariations) {
        if(s.fen === fen)
          return s;
      }
    }

    // Check whether the move is a continuation following the currnet move
    for(let s of this.currEntry.subvariations) {
      if(s.fen === fen)
        return s;
    }

    return; 
  }

  public ply(): number {
    return this.current().ply;
  }

  public moveNo(): number {
    return this.current().moveNo;
  }

  public turnColor(): string {
    return this.current().turnColor;
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

  public scratch(_scratch?: boolean):  any {
    if(_scratch !== undefined)
      this._scratch = _scratch;

    return this._scratch;
  }

  public highlightMove() {
    $('#move-history a').each(function () {
      $(this).removeClass('selected');
    });

    if(this.currEntry.move) {
      const cell = this.currEntry.moveTableElement;
      cell.find('a').addClass('selected');

      this.scrollParentToChild($('#pills-game'), cell);
    }
    else $('#pills-game').scrollTop(0);
  }

  private removeTableItem(entry: HEntry) {
    const cell = entry.moveTableElement;
    if(cell.next('.selectable').length !== 0 || cell.prev('.selectable').length !== 0) {
      cell.html('');
      cell.removeClass('selectable');
      cell.removeData();
    }
    else {
      const prevRow = cell.parent().prev();
      if(prevRow.length !== 0)
        var prevCell = prevRow.children('td').last();
      const nextRow = cell.parent().next();
      if(nextRow.length !== 0)
        var nextCell = nextRow.children('td').first();

      if(prevCell && !prevCell.hasClass('selectable') 
          && nextCell && !nextCell.hasClass('selectable') 
          && prevCell.prev().data('hEntry').depth() === nextCell.next().data('hEntry').depth()) {
        prevCell.html(nextCell.next().html());
        prevCell.attr('class', nextCell.next().attr('class'));
        // Fix up referencing between HEntry and table cell element
        prevCell.data('hEntry', nextCell.next().data('hEntry'));
        prevCell.data('hEntry').moveTableElement = prevCell;
        nextRow.remove();
      }

      cell.parent().remove();
    }
  }

  private addTableItem(entry: HEntry): void {
    var san = entry.move.san;
    var ply = entry.ply;
    var moveNo = moveNo = Math.floor(ply / 2);

    let scoreStr = '';
    if(entry.score !== undefined) {
      scoreStr = ' (' + entry.score + ')';
    }

    const cellBody = '<a href="javascript:void(0);">' + san + '</a>' + scoreStr;

    if(entry === entry.first) {
      // new entry is the first move in a subvariation
      var prevEntry = entry.parent;
      var numSubvariations = prevEntry.subvariations.length;
      // if entry's parent has multiple subvariations, then the previous table cell is the last move in the
      // previous subvariation, otherwise it's simply the parent
      if(numSubvariations > 1)
        prevEntry = prevEntry.subvariations[numSubvariations - 2].last.getLastSubmove();
    }
    else
      var prevEntry = entry.prev.getLastSubmove();

    const prevCell = prevEntry.moveTableElement;
    var cell;
    const prevDepth = prevEntry.depth();
    const depth = entry.depth();  
    
    if(!prevCell || prevCell.length === 0) {
      if(ply % 2 === 0) {
        $('#move-history').append('<tr><th scope="row">' + moveNo + '</th><td class="selectable">' + cellBody + '</td><td></td></tr>');
        cell = $('#move-history td:eq(0)');      
      }
      else {
        $('#move-history').append('<tr><th scope="row">' + moveNo + '</th><td></td><td class="selectable">' + cellBody + '</td></tr>');
        cell = $('#move-history td:eq(1)');   
      }
    }
    else if(depth !== prevDepth) {
      if(ply % 2 == 0) {
        prevCell.parent().after('<tr><th scope="row">' + moveNo + '</th><td class="selectable">' + cellBody + '</td><td></td></tr>');
        cell = prevCell.parent().next().find('td:eq(0)');

        if(depth > prevDepth && entry.parent.next) {
          // Split previous row into 2
          var row1 = prevCell.parent();
          cell.parent().after(row1.clone(true));       
          var row2 = cell.parent().next();
          var row2Cell1 = row2.find('td:eq(0)');
          var row2Cell2 = row2Cell1.next();
          
          // Remove first cell from row 2
          row2Cell1.html('');
          row2Cell1.removeClass('selectable');
          row2Cell1.removeData();

          entry.parent.next.moveTableElement = row2Cell2;
        
          // Remove second cell from row 1
          var row1Cell2 = prevCell.next();
          row1Cell2.html('');
          row1Cell2.removeClass('selectable');
          row1Cell2.removeData(); 
        }
      }
      else {
        prevCell.parent().after('<tr><th scope="row">' + moveNo + '</th><td></td><td class="selectable">' + cellBody + '</td></tr>');
        cell = prevCell.parent().next().find('td:eq(1)');
      }
    }
    else {
      cell = prevCell.next();

      if(!cell.length) {
        prevCell.parent().after('<tr><th scope="row">' + moveNo + '</th><td class="selectable">' + cellBody + '</td><td></td></tr>');
        cell = prevCell.parent().next().find('td:eq(0)');
      }
      else {
        cell.html(cellBody);
        cell.addClass('selectable');
      }
    }

    if(entry.isSubvariation())
      cell.parent().addClass('subvariation');

    cell.data('hEntry', entry); // Add reference to HEntry to table cell
    entry.moveTableElement = cell; // Add reference to table cell to HEntry
    // Make sure to free this circular reference properly when removing elements!
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

  public isThreefoldRepetition(entry: HEntry): boolean {
    if(!entry)
      entry = this.currEntry;
      
    var currFen = entry.fen;
    var words = currFen.split(/\s+/);
    words.splice(4,2);
    currFen = words.join(' ');

    var repeats = 1;

    entry = entry.prev;
    while(entry) {
      var fen = entry.fen;
      var words = fen.split(/\s+/);
      words.splice(4,2);
      fen = words.join(' ');
      if(fen === currFen)
        repeats++;

      if(repeats === 3)
        return true;

      entry = entry.prev;
    }

    return false;
  }  
}

export default History;
