// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { closeSync } from 'original-fs';
import { updateBoard } from './index';
import { Role } from './game';
import { Reason } from './parser';

export class HEntry {
  public move: any;
  public fen: string;
  public wtime: number;
  public btime: number;
  public commentBefore: string;
  public commentAfter: string;
  public nags: string[];
  public score: string;
  public eval: string;
  public moveTableCellElement: any;
  public moveListCellElement: any;
  public opening: any;
  public holdings: any;
  private _next: HEntry;
  private _prev: HEntry;
  private _parent: HEntry;
  private _subvariations: HEntry[];
  
  constructor(move?: any, fen?: string, wtime: number = 0, btime: number = 0, score?: string) {
    this.move = move;
    this.fen = fen;
    this.wtime = wtime;
    this.btime = btime;
    this.score = score;
    this._subvariations = [];
    this.nags = [];
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
    if(entry.isContinuation())
      this._subvariations.push(entry);
    else {
      var i = 0;
      while(i < this._subvariations.length) {
        if(this._subvariations[i].isContinuation()) // insert subvariations before continuations
          break;
        i++;
      }
      this._subvariations.splice(i, 0, entry);
    }
  }

  public removeSubvariation(index: number) {
    this._subvariations.splice(index, 1);
  }

  public isContinuation(): boolean {
    return this.parent && this.first.ply !== this.parent.ply;
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

  public clone(): HEntry {
    var c = new HEntry();
    for (const key of Object.keys(this)) {
      if(!key.startsWith('_')) 
        c[key] = this[key];
    }
    return c;
  }

  public isPredecessor(entry: HEntry): boolean {
    var c: HEntry = this;
    while(c) {
      if(entry === c)
        return true;
      
      if(c === c.first)
        c = c.parent;
      else
        c = c.prev;
    }    
  }
}

export class History {
  private game: any;
  private firstEntry: HEntry;
  private currEntry: HEntry;
  private _scratch: boolean;
  public editMode: boolean;  // if true, allows adding multiple or nested subvariations to the move history
  public metatags: { [key: string]: any };
  public pgn: string; // The PGN associated with this History as a string, used for lazy loading the game
 
  public static annotations = [
    {nags: '$1', symbol: '!', description: 'Good move'},
    {nags: '$2', symbol: '?', description: 'Poor move'},
    {nags: '$3', symbol: '!!', description: 'Brilliant move'},
    {nags: '$4', symbol: '??', description: 'Blunder'},
    {nags: '$5', symbol: '!?', description: 'Interesting move'},
    {nags: '$6', symbol: '?!', description: 'Dubious move'},
    {nags: '$7', symbol: '&#x25A1;', description: 'Forced move'},
    {nags: '$10', symbol: '=', description: 'Drawish'},
    {nags: '$13', symbol: '&#x221E;', description: 'Unclear position'},
    {nags: '$14', symbol: '&#x2A72;', description: 'White has a slight advantage'},
    {nags: '$15', symbol: '&#x2A71;', description: 'Black has a slight advantage'},
    {nags: '$16', symbol: '&#x00B1;', description: 'White has a moderate advantage'},
    {nags: '$17', symbol: '&#x2213;', description: 'Black has a moderate advantage'},
    {nags: '$18', symbol: '+-', description: 'White has a decisive advantage'},
    {nags: '$19', symbol: '-+', description: 'Black has a decisive advantage'},
    {nags: '$22$23', symbol: '&#x2A00;', description: 'Zugzwang'},
    {nags: '$26$27', symbol: '&#x25CB;', description: 'Space advantage'},
    {nags: '$32$33', symbol: '&#x27F3;', description: 'Lead in development'},
    {nags: '$36$37', symbol: '&#x2191;', description: 'With initiative'},
    {nags: '$40$41', symbol: '&#x2192;', description: 'With an attack'},
    {nags: '$132$133', symbol: '&#x21C6;', description: 'With counterplay'},
    {nags: '$138$139', symbol: '&#x2A01;', description: 'Time trouble'},
    {nags: '$44$45', symbol: '=/&#x221E;', description: 'With compensation'},
  ];

  constructor(game: any, fen: string = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', wtime: number = 0, btime: number = 0) {
    this.game = game;
    this._scratch = false;
    this.editMode = false;
    this.metatags = {};
    this.reset(fen, wtime, btime);
    this.initMetatags();
  }

  public reset(fen: string, wtime: number, btime: number) {
    this.firstEntry = this.currEntry = new HEntry(undefined, fen);
    this.updateClockTimes(this.firstEntry, wtime, btime);
    this.game.moveTableElement.empty();
    this.game.moveListElement.empty();
    this.resetMetatags();
  }

  public updateClockTimes(entry: HEntry, wtime?: number, btime?: number) {
    if(wtime == null)
      wtime = entry.wtime;
    if(btime == null)
      btime = entry.btime;
    
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

  public add(move: any, fen: string, newSubvariation: boolean = false, wtime: number = 0, btime: number = 0, score?: string): HEntry {
    var newEntry = new HEntry(move, fen);
    
    if(newSubvariation) {
      if(!this.editMode)
        this.removeAllSubvariations();
      if(this.currEntry.next)
        this.currEntry.next.addSubvariation(newEntry); // Add subvariation
      else
        this.currEntry.addSubvariation(newEntry); // Add continuation
    }
    else {
      if(this.currEntry.next)
        this.remove(this.currEntry.next);

      for(let sub of this.currEntry.subvariations) {
        if(sub.isContinuation())
          this.remove(sub);
      }

      this.currEntry.add(newEntry);
    }

    this.updateClockTimes(newEntry, wtime, btime);
    this.currEntry = newEntry;
    this.addMoveElements(this.currEntry);

    return this.currEntry;
  }

  public addHEntry(entry: HEntry, prevEntry: HEntry, isSubvariation: boolean = false): void {
    if(isSubvariation) {
      if(prevEntry.next) 
        prevEntry.next.addSubvariation(entry);
      else 
        prevEntry.addSubvariation(entry);
    }
    else 
      prevEntry.add(entry);

    var e = entry.next;
    while(e) {
      e.parent = entry.parent;
      e = e.next;
    }

    this.traverse((c) => {
      this.addMoveElements(c);
      this.updateClockTimes(c);
    }, null, entry);

    this.updateOpeningMetatags();
  }

  public remove(entry: HEntry): void {
    this.traverse(null, (c) => {
      // Check if currEntry is about to get removed
      if(c === this.currEntry)
        this.currEntry = entry.prev;

      this.removeMoveTableElement(c);   
      this.removeMoveListElement(c);
    }, entry);

    entry.remove();

    entry.prev = null;
    while(entry) {
      entry.parent = null;
      entry = entry.next;
    }

    this.updateOpeningMetatags();
  }

  public removeLast(): void {
    this.remove(this.last());
  }

  public removeAllSubvariations() {
    var c = this.firstEntry;
    while(c) {
      for(let i = c.subvariations.length - 1; i >= 0; i--)
        this.remove(c.subvariations[i]);  
      c = c.next;
    }
  }

  public promoteSubvariation(entry: HEntry) {
    var subvar = entry.first;
    var mainvar = subvar.parent;
    var mainvarPrev = mainvar.prev;
    var current = this.currEntry;
    var isContinuation = subvar.isContinuation();
    
    if(isContinuation) {
      mainvarPrev = mainvar;

      this.remove(subvar);
      this.addHEntry(subvar, mainvarPrev);

      var mainvarSubs = [...mainvar.subvariations];
      for(let i = 0; i < mainvarSubs.length; i++) {
        if(mainvarSubs[i].isContinuation()) {
          this.remove(mainvarSubs[i]);
          this.addHEntry(mainvarSubs[i], mainvarPrev, true);
        }
      }
    }
    else {
      var last = mainvar.last;
      for(let i = 0; i < last.subvariations.length; i++) {
        if(last.subvariations[i].isContinuation()) {
          this.promoteSubvariation(last.subvariations[i]);
          break;
        }
      }

      this.remove(subvar);
      var mainvarSubs = [...mainvar.subvariations];

      for(let i = 0; i < mainvarSubs.length; i++) 
        this.remove(mainvarSubs[i]);
      this.remove(mainvar); 

      this.addHEntry(subvar, mainvarPrev);
      this.addHEntry(mainvar, mainvarPrev, true);

      for(let i = 0; i < mainvarSubs.length; i++) 
        this.addHEntry(mainvarSubs[i], mainvarPrev, true);  
    }

    this.currEntry = current;
    this.highlightMove();
    this.updateOpeningMetatags();
  }

  public makeContinuation(entry: HEntry) {
    var current = this.currEntry;
    var prev = entry.prev;

    var last = entry.last;
    for(let i = 0; i < last.subvariations.length; i++) {
      if(last.subvariations[i].isContinuation()) {
        this.promoteSubvariation(last.subvariations[i]);
        break;
      }
    }

    var subs = [...entry.subvariations];
    for(let i = 0; i < subs.length; i++) 
      this.remove(subs[i]);

    this.remove(entry);
    this.addHEntry(entry, prev, true);

    for(let i = 0; i < subs.length; i++) 
      this.addHEntry(subs[i], prev, true);
    
    this.currEntry = current;
    this.highlightMove();
    this.updateOpeningMetatags();
  }

  public clone(game: any): History {
    var hist = new History(game);
    hist._scratch = this._scratch;
    hist.editMode = this.editMode;
    hist.metatags = this.metatags;
    hist.firstEntry = this.cloneVariation(this.firstEntry, hist, null);

    return hist;
  }

  private cloneVariation(orig: HEntry, clonedHistory: History, clonedParent: HEntry) {
    var prevCloned = null;
    while(orig) {
      var cloned = orig.clone();     
      if(!prevCloned) {
        var first = cloned;
        cloned.parent = clonedParent;
      }
      else 
        prevCloned.add(cloned);

      clonedHistory.addMoveElements(cloned);
      
      for(let i = 0; i < orig.subvariations.length; i++) {
        var subVar = this.cloneVariation(orig.subvariations[i], clonedHistory, cloned);
        cloned.addSubvariation(subVar);
      }

      if(orig === this.currEntry)
          clonedHistory.currEntry = cloned;

      orig = orig.next;

      prevCloned = cloned;
    }
    return first;
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

    updateBoard(this.game, playSound);
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

  public prev(): HEntry {
    return this.currEntry.prev;
  }

  public next(): HEntry {
    return this.currEntry.next;
  }

  public last(): HEntry {
    return this.first().last;
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
  public hasSubvariation(): boolean {
    var entry = this.first();
    while(entry) {
      if(entry.subvariations.length)
        return true;
      entry = entry.next;
    }
    return false;
  }

  public hasContinuation(): boolean {
    var entry = this.last();
    for(let sub of entry.subvariations) {
      if(sub.isContinuation())
        return true;
    }
    return false;
  }

  /** 
   * Traverse the HEntry elements of the move list as a DFS and for each entry call
   * preOrderHandler before children (subvariations) are touched and postOrderHandler after children
   * are touched. entry is an optional HEntry to start traversing from, otherwise it will start traversing 
   * from the start of the move list.
   */
  public traverse(preOrderHandler: (item: HEntry) => void, postOrderHandler: (item: HEntry) => void, entry?: HEntry) {
    if(!entry)
      entry = this.first();

    while(entry) {
      if(preOrderHandler)
        preOrderHandler(entry);

      for(let sub of entry.subvariations) 
        this.traverse(preOrderHandler, postOrderHandler, sub);
      
      if(postOrderHandler)
        postOrderHandler(entry);
      entry = entry.next;
    }
  }
  
  public movesToString(): string {
    var movesStr = '';
    var showMoveNo = true;
    this.traverse((entry) => { // Pre-order. Before a move's subvariation is parsed
      if(!entry.move)
        return;

      var isContinuation = entry === entry.first && entry.isContinuation();
      if(isContinuation) {
        var parentMoveNo = History.getMoveNoFromFEN(entry.parent.fen);
        var parentTurnColor = History.getTurnColorFromFEN(entry.parent.fen);
        var parentPeriods = (parentTurnColor === 'w' ? '...' : '.');  
        movesStr += '(' + parentMoveNo + parentPeriods + entry.parent.move.san + ' ';
        showMoveNo = false;
      }

      var turnColor = History.getTurnColorFromFEN(entry.fen);
      if((entry === entry.first && !isContinuation) || showMoveNo || entry.commentBefore || turnColor === 'b') {
        if(entry === entry.first && !isContinuation) 
          movesStr += '(';      

        if(entry.commentBefore) 
          movesStr += '{' + entry.commentBefore + '} ';

        var moveNo = History.getMoveNoFromFEN(entry.fen);
        var periods = (turnColor === 'w' ? '...' : '.');
        movesStr += moveNo + periods;
        showMoveNo = false;
      }
      movesStr += entry.move.san + ' ';

      if(entry.nags.length) {
        for(let nag of entry.nags) 
          movesStr += nag + ' ';
        showMoveNo = true;
      }

      if(entry.commentAfter) {
        movesStr += '{' + entry.commentAfter + '} ';
        showMoveNo = true;
      }
    }, 
    (entry) => { // Post-order. After move's subvariations parsed
      if(entry === entry.last && entry.parent) {
        movesStr = movesStr.slice(0, -1);
        movesStr += ') ';
        showMoveNo = true;
      }
    });

    return movesStr.trim();
  }

  public highlightMove() {
    var moveTable = this.game.moveTableElement;
    moveTable.find('a').each(function () {
      $(this).removeClass('selected');
    });
    if(this.currEntry.move) {
      const cell = this.currEntry.moveTableCellElement;
      cell.find('a').addClass('selected');
      this.scrollParentToChild($('#movelist-container'), cell);
    }

    var moveList = this.game.moveListElement;
    moveList.find('.move').each(function () {
      $(this).removeClass('selected');
    });
    if(this.currEntry.move) {
      const cell = this.currEntry.moveListCellElement;
      cell.find('.move').addClass('selected');
      this.scrollParentToChild($('#movelist-container'), cell);
    }

    else $('#movelist-container').scrollTop(0);
  }

  public addMoveElements(entry: HEntry) {
    if(!entry.move)
      return;

    this.addMoveTableElement(entry);
    this.addMoveListElement(entry);
    this.setCommentBefore(entry, entry.commentBefore);
    this.setCommentAfter(entry, entry.commentAfter);
    for(let nag of entry.nags)
      this.setAnnotation(entry, nag);
  }

  public addAllMoveElements(startEntry?: HEntry) {
    this.traverse((entry) => {
      this.addMoveElements(entry);
    }, null, startEntry);
  }

  private removeMoveListElement(entry: HEntry) {
    var cell = entry.moveListCellElement;
    var parent = entry.parent;
    if(cell.parent().hasClass('subvariation'))
      var subvar = cell.parent();   

    // Also remove subvariation if this is the only move in it
    if(subvar && subvar.children('.outer-move').length === 1) {
      if(parent && parent.next) {
        var lastSub = false;
        var nextElem = subvar.next();
        var prevElem = subvar.prev();
        if(!prevElem.hasClass('subvariation') && !nextElem.hasClass('subvariation')) {
          // If parent's next move is black and there are no other subvariations, remove the move number from the start
          if(parent.next.ply % 2 === 1) {
            var parentNextCell = parent.next.moveListCellElement;
            parentNextCell.find('.moveno').remove();
          }
        }
      }
      subvar.remove();
    }
    else {
      if(cell.next().hasClass('comment-after'))
        cell.next().remove();
      if(cell.prev().hasClass('comment-before'))
        cell.prev().remove();
      cell.remove();
    }

    entry.moveListCellElement = null;
  }

  private addMoveListElement(entry: HEntry) {
    var moveList = this.game.moveListElement;
    var san = entry.move.san;
    var ply = entry.ply;
    var moveNo = Math.floor(ply / 2);

    // Find previous html element before the insertion point

    if(entry === entry.first) // First move in subvariation
      var prevEntry = entry.parent;
    else
      var prevEntry = entry.prev;

    if(prevEntry && prevEntry.move) {
      // Get previous html element before the insertion point including subvariation containers and comments
      var prevElement = prevEntry.moveListCellElement; 
      let i = 0;
      while(prevElement.next().length && !prevElement.next().hasClass('outer-move') && !prevElement.next().hasClass('comment-before')) {
        if(prevElement.next().hasClass('subvariation')) {
          if(prevEntry.subvariations[i] === entry)
            break;
          i++;
        }
        prevElement = prevElement.next();
      }
    }
    
    var cell = $('<span class="outer-move d-inline-flex"><span class="move annotation px-1">' + san + '</span></span>');
    if(ply % 2 === 0) 
      cell.prepend('<span class="moveno ms-1">' + moveNo + '.</span>'); // Prepend move number for white move

    if(!prevEntry || !prevEntry.move) { // Prepend move number if this is the first move in the move list
      if(ply % 2 === 1)
        cell.prepend('<span class="moveno ms-1">' + moveNo + '...</span>');
      moveList.append(cell);
      var moveNoElement = cell.find('moveno');
      moveNoElement.removeClass('ms-1');
    }
    else { 
      if(entry === entry.first) { // move is start of new subvariation
        var subVar = $(`<span class="subvariation ms-2 ps-2"></span>`);
        subVar.append(cell);
        prevElement.after(subVar);
      }
      else 
        prevElement.after(cell);

      // Prepend move number to a black move if it's the start of a subvariation or a move directly 
      // following a subvariation
      if(prevElement.hasClass('subvariation') || entry === entry.first) {
        if(ply % 2 == 0 && !prevElement.hasClass('subvariation') && entry.parent.next?.moveListCellElement) 
          entry.parent.next.moveListCellElement.prepend('<span class="moveno ms-1">' + moveNo + '...</span>');
        else if(ply % 2 === 1)
          cell.prepend('<span class="moveno ms-1">' + moveNo + '...</span>');
      }
    }

    cell.data('hEntry', entry); // Add reference to HEntry to element
    entry.moveListCellElement = cell; // Add reference to move html element to HEntry
    // Make sure to free this circular reference properly when removing elements!
  }

  private removeMoveTableElement(entry: HEntry) {
    const cell = entry.moveTableCellElement;
    if(cell.next('.selectable').length !== 0 || cell.prev('.selectable').length !== 0) {
      // Move element is not the only one in the table row, so just remove it
      cell.html('');
      cell.removeClass('selectable');
      cell.removeData(); // Free circular reference
    }
    else {
      // Only move in this table row
      var subvar = cell.parent().parent().closest('tr');
      if(subvar.length && subvar.find('tr').length === 1) { // move is the only move in the subvariation
        // Check if this is the only subvariation in its parent and whether the previous
        // and next moves are in the same variation. If so we join the previous and next moves back 
        // together into the same table row
        const prevRow = subvar.prev();
        if(prevRow.length !== 0 && prevRow.children('td').length === 2) 
          var prevCell = prevRow.children('td').last();
        const nextRow = subvar.next();
        if(nextRow.length !== 0 && nextRow.children('td').length === 2)
          var nextCell = nextRow.children('td').first();

        if(prevCell && !prevCell.hasClass('selectable') 
            && nextCell && !nextCell.hasClass('selectable') 
            && prevCell.prev().data('hEntry').depth() === nextCell.next().data('hEntry').depth()) {
          prevCell.html(nextCell.next().html());
          prevCell.attr('class', nextCell.next().attr('class'));
          // Fix up referencing between HEntry and table cell element
          prevCell.data('hEntry', nextCell.next().data('hEntry'));
          prevCell.data('hEntry').moveTableCellElement = prevCell;
          nextRow.remove();
        }

        // Remove empty subvariation
        subvar.remove();
      }
      else 
        cell.parent().remove(); // move is the last move in the table row so remove the row
    }

    entry.moveTableCellElement = null;
  }

  private addMoveTableElement(entry: HEntry): void {
    var moveTable = this.game.moveTableElement;
    var san = entry.move.san;
    var ply = entry.ply;
    var moveNo = moveNo = Math.floor(ply / 2);

    const cellBody = '<a class="annotation" href="javascript:void(0);">' + san + '</a>';

    // Find previous td cell before the insertion point

    if(entry === entry.first) 
      var prevEntry = entry.parent;
    else
      var prevEntry = entry.prev;

    if(prevEntry && prevEntry.move) {
      // Get previous html element including subvariation containers
      var prevCell = prevEntry.moveTableCellElement; 
      if(!prevCell.next('.selectable').length) {
        var elem = prevCell.parent().next().children().first(); // Get the first td in the next row
        let i = 0;
        // Find the last subvariation before the insertion point
        while(elem.length && elem.children('table').length && prevEntry.subvariations[i] !== entry) {
          prevCell = elem;
          elem = elem.parent().next().children().first();
          i++;
        }
      }
    }

    var cell;  
    if(!prevCell || prevCell.length === 0) { // Move is the first move in the move table
      if(ply % 2 === 0) { 
        moveTable.append('<tr><th scope="row">' + moveNo + '</th><td class="selectable">' + cellBody + '</td><td></td></tr>');
        cell = moveTable.find('td:eq(0)');      
      }
      else {
        moveTable.append('<tr><th scope="row">' + moveNo + '</th><td>...</td><td class="selectable">' + cellBody + '</td></tr>');
        cell = moveTable.find('td:eq(1)');   
      }
    }
    else if(prevCell.children('table').length || entry === entry.first) { // Move is first move in subvariation or first move following a subvariation
      if(ply % 2 == 0) { // New move is a white move (column 1)
        var newRow = $('<tr><th scope="row">' + moveNo + '</th><td class="selectable">' + cellBody + '</td><td></td></tr>');
        cell = newRow.find('td:eq(0)');

        // Add new subvariation as a nested table
        if(entry === entry.first) {
          var subVar = $('<tr class="subvariation"><td colspan="3"><table class="table-sm w-100"><tbody></tbody></table></td></tr>');
          subVar.find('tbody').append(newRow);
          prevCell.parent().after(subVar);

          if(prevEntry.moveTableCellElement.next('.selectable').length) {
            // New subvariation is splitting 2 moves from the same table row

            // Split previous row into 2
            var row1 = prevCell.parent();
            subVar.after(row1.clone(true));       
            var row2 = subVar.next();
            var row2Cell1 = row2.find('td:eq(0)');
            var row2Cell2 = row2Cell1.next();
            
            // Remove first cell from row 2
            row2Cell1.html('...');
            row2Cell1.removeClass('selectable');
            row2Cell1.removeData();

            entry.parent.next.moveTableCellElement = row2Cell2;
          
            // Remove second cell from row 1
            var row1Cell2 = prevCell.next();
            row1Cell2.html('');
            row1Cell2.removeClass('selectable');
            row1Cell2.removeData(); 
          }
        }
        else
          prevCell.parent().after(newRow);
      }
      else { // new move is a black move (column 2)
        var newRow = $('<tr><th scope="row">' + moveNo + '</th><td>...</td><td class="selectable">' + cellBody + '</td></tr>');
        cell = newRow.find('td:eq(1)');

        if(entry === entry.first) { // first move in subvariation
          var subVar = $('<tr class="subvariation"><td colspan="3"><table class="table-sm w-100"><tbody></tbody></table></td></tr>');
          subVar.find('tbody').append(newRow);
          prevCell.parent().after(subVar);
        }
        else // first move after a subvariation
          prevCell.parent().after(newRow);
      }
    }
    else { // move is not the first move in a subvariation and is not following a subvariation
      cell = prevCell.next();

      if(!cell.length) { // move is a white move (column 1)
        prevCell.parent().after('<tr><th scope="row">' + moveNo + '</th><td class="selectable">' + cellBody + '</td><td></td></tr>');
        cell = prevCell.parent().next().find('td:eq(0)');
      }
      else { // move is a black move (column 2)
        cell.html(cellBody);
        cell.addClass('selectable');
      }
    }

    cell.data('hEntry', entry); // Add reference to HEntry to table cell
    entry.moveTableCellElement = cell; // Add reference to table cell to HEntry
    // Make sure to free this circular reference properly when removing elements!
  }

  public scrollParentToChild(parent: any, child: any) {
    if(!child.is(':visible'))
      return;

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
        parent.scrollTop += scrollTop - 4;
      } else {
        // we're near the bottom of the list
        parent.scrollTop += scrollBot + 4;
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

  /************************
   * Annotation Functions *
   ************************/

  /**
   * Returns the contenteditable span for the comment before a move in the move-list.
   * Only the first move in a subvariation can have a comment before it. 
   */
  public getCommentBeforeElement(entry: HEntry): JQuery<HTMLElement> {
    if(!entry.moveListCellElement)
      return null;

    var prevElem = entry.moveListCellElement.prev();
    if(prevElem && prevElem.hasClass('comment-before'))
      return prevElem;
    return null;
  }

  /** 
   * Returns the contenteditable span for the comment after a move in the move-list.
   */
  public getCommentAfterElement(entry: HEntry): JQuery<HTMLElement> {
    if(!entry.moveListCellElement)
      return null;

    var nextElem = entry.moveListCellElement.next();
    if(nextElem && nextElem.hasClass('comment-after'))
      return nextElem;
    return null;
  }

  /** 
   * Create an empty comment HTML element before a move in the movelist 
   */
  public createCommentBeforeElement(entry: HEntry): JQuery<HTMLElement> {
    var commentElement = $(`<span class="comment comment-before ps-1" contenteditable="true" placeholder="Add Comment..." spellcheck="false"></span>`);
    entry.moveListCellElement.before(commentElement);
    return commentElement;
  }

  /** 
   * Create an empty comment HTML element after a move in the movelist 
   */
  public createCommentAfterElement(entry: HEntry): JQuery<HTMLElement> {
    var commentElement = $(`<span class="comment comment-after ps-1" contenteditable="true" placeholder="Add Comment..." spellcheck="false"></span>`);
    entry.moveListCellElement.after(commentElement);
    return commentElement;
  }

  /**
   * Give focus to the comment element before a move so the user can edit it in-place.
   * Creates an empty element if it doesn't already exist  
   */
  public editCommentBefore(entry: HEntry) {
    var element = this.getCommentBeforeElement(entry);
    if(!element) 
      element = this.createCommentBeforeElement(entry);
    element.trigger('focus');
    setCaretToEnd(element);    
  }

  /**
   * Give focus to the comment element after a move in the move-list so the user can edit it in-place.
   * Creates an empty element if it doesn't already exist.
   */
  public editCommentAfter(entry: HEntry) {
    var element = this.getCommentAfterElement(entry);
    if(!element) 
      element = this.createCommentAfterElement(entry);
    element.trigger('focus');
    setCaretToEnd(element);
  }

  /**
   * Sets the text for the comment element before a move in the move list.
   * First creates the element if it doesn't already exist.
   * If the text is set to empty string, the element is removed.
   */
  public setCommentBefore(entry: HEntry, comment: string) {
    entry.commentBefore = comment;

    var element = this.getCommentBeforeElement(entry);
    if(comment) {
      if(!element) 
        element = this.createCommentBeforeElement(entry);
      element.text(comment);
    }
    else if(element) 
      element.remove();
  }

  /**
   * Sets the text for the comment element after a move in the move list.
   * First creates the element if it doesn't already exist.
   * If the text is set to empty string, the element is removed.
   */
  public setCommentAfter(entry: HEntry, comment: string) {
    entry.commentAfter = comment;

    var element = this.getCommentAfterElement(entry);
    if(comment) {
      if(!element) 
        element = this.createCommentAfterElement(entry);
      element.text(comment);
    }
    else if(element)
      element.remove();
  }

  /** 
   * Remove all comment elements from the move-list 
   */
  public removeAllComments() {
    this.traverse(null, (entry) => {
      this.setCommentBefore(entry, '');
      this.setCommentAfter(entry, '');
    });
  }

  /**
  * Add a NAG to a move's NAG list and appends the corresponding annotation symbol to the move's HTML element 
  * in the move list and move table.
  * @param nag The NAG to be added in PGN NAG format, e.g. '$1'. Evaluation NAGs (!, !!, ?, ?? etc) are 
  * stored as the first element in the nags array. The previous evaluation NAG is replaced. Wheraeas positional 
  * NAGs are simply appended to the end of the nags array. If a pair of NAGs is specified, i.e. '$22$23'
  * then only one of them will be added, based on whether it is white or black to move. 
  */
  public setAnnotation(entry: HEntry, nag: string) {
    var nagAdded = false;
    // Find nag in the nag lookup table
    for(let i = 0; i < History.annotations.length; i++) {
      var a = History.annotations[i];
      var annListNags = a.nags.match(/\$\d+/g);
      if(a.nags === nag || annListNags.includes(nag)) {
        var nagCount = nag.match(/\$/g).length; 
        if(nagCount == 2) {
          // nags contains both white move and black move nags
          // Determine which one we should use based on which color played this move
          if(entry.turnColor === 'b') // use white nag
            var nag = annListNags[0];
          else // use black nag
            var nag = annListNags[1];
        }

        // check if nag already exists
        if(!entry.nags.includes(nag)) {
          if(i < 7) {
            // nag is an evaluation nag (!, ?, !!, etc) which we always store in the first elmeent of the nags array
            if(entry.nags.length && History.annotations.slice(0, 7).some(item => item.nags === entry.nags[0])) // entry.nags already contains an evaluation nag to replace it
              entry.nags[0] = nag;
            else 
              entry.nags.unshift(nag); // entry.nags doesn't contain an evaluation nag yet, so prepend it
          }
          else 
            entry.nags.push(nag);
        }
        var nagAdded = true;
        break;
      }
    }

    // Lookup the corresponding annotation symbol for each nag
    if(nagAdded) {
      var nagStr = '';
      for(let i = 0; i < entry.nags.length && i < 6; i++) { // Only display maximum 6 annotation symbols per move 
        var n = entry.nags[i];
        var a = History.annotations.find(item => {
          var naglist = item.nags.match(/\$\d+/g);
          return naglist.includes(n);
        });
        nagStr += (a ? a.symbol : '');
      }

      entry.moveListCellElement.find('.move').html(entry.move.san + nagStr);
      entry.moveTableCellElement.find('a').html(entry.move.san + nagStr);
    }
  }

  /** 
   * Removes all NAGs / annotation symbols from a move and its corresponding move list and move table elements 
   */
  public removeAnnotation(entry: HEntry) {
    if(entry.nags.length) {
      entry.nags = [];
      entry.moveListCellElement.find('.move').html(entry.move.san);
      entry.moveTableCellElement.find('a').html(entry.move.san);
    }
  }

  /** 
   * Remove all NAGs / annotation symbols from the move list
   */
  public removeAllAnnotations() {
    this.traverse(null, (entry) => this.removeAnnotation(entry));
  }

  /*************************
   * PGN Metatag Functions *
   *************************/

  /** 
   * Generate PGN metatags for a game from its Game object data 
   */
  public initMetatags() {
    var game = this.game;

    if(game.role === Role.PLAYING_COMPUTER)
      var event = 'Playing Computer';
    else if(game.role === Role.NONE)
      var event = 'Analysis';
    else
      var event = 'Online Game';

    let now = new Date();
    let year = now.getUTCFullYear();
    let month = String(now.getUTCMonth() + 1).padStart(2, '0'); 
    let day = String(now.getUTCDate()).padStart(2, '0'); 
    var date = year + '.' + month + '.' + day;
    let hours = String(now.getUTCHours()).padStart(2, '0');
    let minutes = String(now.getUTCMinutes()).padStart(2, '0');
    let seconds = String(now.getUTCSeconds()).padStart(2, '0');
    var time = hours + ':' + minutes + ':' + seconds;

    if(!game.time && !game.inc)
      var timeControl = '-';
    else
      var timeControl = game.time * 60 + '+' + game.inc; 

    // If we are at the start of the game and it's a non-standard position set the SetUp and FEN metatags
    var isSetupPosition = game.move === 'none' && game.fen !== 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
       
    this.setMetatags({
      Event: event,
      Site: 'https://freechess.org',
      Date: date,
      Round: '-',
      White: game.wname, 
      Black: game.bname,
      Result: '*',
      TimeControl: timeControl,
      WhiteElo: (game.wname ? game.wrating || '-' : '?'),
      BlackElo: (game.bname ? game.brating || '-' : '?'),
      Time: time,
      Variant: game.category,
      ...(isSetupPosition && { SetUp: '1', FEN: game.fen })
    }, true);
  } 

  /**
   * Add the given tags to this game's metatags after performing basic alterations
   * @param tags An object containing key / value pairs for each metatag
   * @param overwrite If true, the game's existing metatags are cleared first
   */
  public setMetatags(tags: any, overwrite: boolean = false) {
    delete tags.messages; // this tag is where @mliebelt/pgn-parser stores syntax errors/warnings when parsing

    // @mliebelt/pgn-parser parses some metatags like Date and Time into objects instead of strings 
    // Convert them back into strings
    for(let key in tags) {
      if(tags[key].value)
        tags[key] = tags[key].value;
    }

    if(tags.White)
      tags.White = tags.White.replace(/_/g, ' '); // Change underscores to spaces when converting from a FICS name to a metatag
    if(tags.Black)
      tags.Black = tags.Black.replace(/_/g, ' ');

    if(tags.WhiteElo === 0)
      tags.WhiteElo = '?';
    if(tags.BlackElo === 0)
      tags.BlackElo = '?';

    if('Termination' in tags && typeof tags.Termination === 'number') {
      switch(tags.Termination) {
        case Reason.Disconnect:
        case Reason.Abort:
          tags.Termination = 'abandoned';
          break;
        case Reason.TimeForfeit:
          tags.Termination = 'time forfeit';
          break;
        default: 
          tags.Termination = 'normal';
      }
    }

    var variants = ['losers', 'suicide', 'crazyhouse', 'bughouse', 'atomic'];
    var nonVariants = ['blitz', 'lightning', 'untimed', 'standard', 'nonstandard'];
    if(tags.Variant && (variants.includes(tags.Variant) || tags.Variant.startsWith('wild'))) {
      if(tags.Variant === 'wild/fr')
        tags.Variant = 'chess960';
    }
    else if(nonVariants.includes(tags.Variant) || tags.Variant === '')
      delete tags.Variant;

    if(overwrite)
      this.metatags = tags;
    else {
      for(let key in tags) 
        this.metatags[key] = tags[key];
    }
  }

  /** 
   * Reset move-list related metatags when the history is reset() 
   */
  public resetMetatags() {
    var tags = this.metatags;
    delete tags.Opening;
    delete tags.Variation;
    delete tags.SubVariation;
    delete tags.ECO;
    delete tags.NIC;
    tags.Result = '*';
    var fen = this.first().fen;
    if(fen !== 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') {
      tags.SetUp = '1';
      tags.FEN = fen;
    }
    else {
      delete tags.SetUp;
      delete tags.FEN;
    }
  }

  /** 
   * Converts the metatags from key/value pairs to string format 
   */
  public metatagsToString(): string {
    var tagsString = '';
    var tags = this.metatags;
    for(let key in tags) 
      tagsString += '[' + key + ' \"' + tags[key] + '\"]\n';
    tagsString = tagsString.slice(0, -1); 

    return tagsString;
  }

  /**
   * Generate the 'Opening' and 'ECO' metatags for a game.
   */
  public updateOpeningMetatags() {
    var hEntry = this.game.history.last();
    // Go through the main-line from the end to the beginning until we find the final opening name of the game
    while(!hEntry.opening) {
      if(!hEntry.move) { // We reached the starting position and no opening was found
        delete this.metatags.Opening;
        delete this.metatags.ECO;
        return;
      }
      hEntry = hEntry.prev;
    }
    this.setMetatags({Opening: hEntry.opening.name, ECO: hEntry.opening.eco});
  }
}

/** Triggered when the user clicks on a comment in the move-list to edit it in-place. */
$(document).on('focus', '.comment', function(event) {
  if(!$(event.target).text().length) {
    // Adds an invisible character to an empty comment in order to make the cursor appear even
    // when the comment is empty. 
    $(event.target).text('\u200B'); 
    // Display the placeholder text.
    $(event.target).attr('data-before-content', $(event.target).attr('placeholder'));
  }

  // Set the move's comment string after the user presses enter or clicks away from the comment element.
  $(event.target).one('blur', function(event) {
    var elem = $(event.target);
    if(elem.hasClass('comment-before')) {
      var hEntry = elem.next().data('hEntry');
      var commentBefore = true;
    }
    else {
      var hEntry = elem.prev().data('hEntry');
      var commentBefore = false;
    }
    if(elem.attr('data-before-content')) {
      // If the placeholder text is showing, i.e. the comment is empty then remove it.
      var comment: string = undefined;
      elem.remove();
    }
    else { 
      var comment = elem.text();
      elem.off('input paste keydown');
    }

    if(commentBefore)
      hEntry.commentBefore = comment;
    else
      hEntry.commentAfter = comment;

    // Unselect selected text
    if(window.getSelection) 
      window.getSelection().removeAllRanges();
  });

  $(event.target).on('keydown', function(event) {
    if(event.key === 'Enter') {
      event.preventDefault();
      $(event.target).trigger('blur');
    }
  });

  /** 
   * Remove html tags and formatting from text pasted into the comment element. Remove
   * the zero-wdith space (placeholder) character if text was pasted into an empty element. 
   */ 
  $(event.target).on('paste', function(event) {
    event.preventDefault();

    // Insert the clipboard text into the element as plain text
    const clipboardEvent = event.originalEvent as ClipboardEvent;
    const text = clipboardEvent.clipboardData?.getData('text/plain') || '';

    var sel = window.getSelection();
    if (sel.rangeCount > 0) {
      var range = sel.getRangeAt(0);
      range.deleteContents(); 
      range.insertNode(document.createTextNode(text)); 
      range.collapse(false); // Move the caret to the end of the pasted text
      sel.removeAllRanges();
      sel.addRange(range);
    }
    $(event.target).trigger('input'); // Remove the zero-width space placeholder character if it exists
  });

  /**
   * Remove the zero-width space (placeholder) character when text is entered. 
   * Adds it back when all text is deleted.
   */
  $(event.target).on('input', function(event) {
    var elem = $(event.target);
   
    if(!elem.text().length) {
      elem.text('\u200B'); // insert a zero-width space in order to make cursor appear when span is empty 
      elem.attr('data-before-content', elem.attr('placeholder'));
    }
    else if(elem.attr('data-before-content')) {
      elem.text(elem.text().replace(/\u200B/g, '')); // Remove zero-width space
      setCaretToEnd(elem);
      elem.removeAttr('data-before-content'); // Remove placeholder
    }
  });
});

/** 
 * Move caret to the end of an editable text element 
 */
function setCaretToEnd(element: JQuery<HTMLElement>) {
  // Set cursor to end of content
  var range = document.createRange();
  var sel = window.getSelection();
  range.selectNodeContents(element[0]);
  range.collapse(false); 
  sel.removeAllRanges();
  sel.addRange(range);
} 

export default History;
