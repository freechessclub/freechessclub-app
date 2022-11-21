// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { updateBoardAfter } from "./index";

export class History {
  private board: any;
  private moves: {move: any, fen: any}[];
  private id: number;

  constructor(fen: string, board: any) {
    this.board = board;
    this.moves = new Array();
    this.id = -1;

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
        this.update(moves[i].move, i);
    }
  }

  public add(move: any, fen: string, score?: number): void {
    this.moves.push({move: move, fen: fen});
    this.id = this.moves.length - 1;

    if(move) {
      this.update(move.san, this.id, score);
      this.highlightMove();
    }
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
    this.moves = [ {move: null, fen: this.board.getFen()} ];
  }

  public length(): number {
    return this.moves.length - 1;
  }

  public display(id?: number): {move: any, fen: any} {
    if (id !== undefined) {
      this.id = id;
    }

    if (this.id >= 0 && this.id < this.moves.length) {    
      this.board.set({ 
        fen: this.moves[this.id].fen
      });
      updateBoardAfter();
    }

    this.highlightMove();

    return this.moves[this.id];
  }

  public get(id?: number): {move: any, fen: any} {
    if(id === undefined)
      return this.moves[this.id];
    return this.moves[id];
  }

  public ply(): number {
    return this.id;
  }

  public beginning(): {move: any, fen: any} {
    this.display(0);

    return this.moves[this.id];
  }

  public backward(): {move: any, fen: any} {
    if (this.id > 0) {
      this.display(this.id - 1);
    }

    return this.moves[this.id];
  }

  public forward(): {move: any, fen: any} {
    if (this.id < this.moves.length - 1) {
      this.display(this.id + 1);
    }

    return this.moves[this.id];
  }

  public end(): {move: any, fen: any} {
    this.display(this.moves.length - 1);

    return this.moves[this.id];
  }

  public undo(): void {
    if (this.id > 0) {
      this.display(this.id - 1);
      this.moves.pop();
    }
  }

  private update(move: any, id?: number, score?: number): void {
    if (id === undefined) {
      id = this.length();
    }

    let scoreStr = '';
    if (score !== undefined) {
      scoreStr = ' (' + score + ')';
    }

    if (id % 2 === 1) {
      $('#move-history').append('<tr><th scope="row">'
        + (id + 1) / 2 + '</th><td><a href="javascript:void(0);" onclick="showMove(' + id + ')">'
        + move + '</a>' + scoreStr + '</td><td></td></tr>');
      $('#pills-game').scrollTop(document.getElementById('pills-game').scrollHeight);
    } else {
      $('#move-history tr:last td').eq(1).html('<a href="javascript:void(0);" onclick="showMove(' +
        id + ')">' + move + '</a>' + scoreStr);
    }
  }
}

export default History;
