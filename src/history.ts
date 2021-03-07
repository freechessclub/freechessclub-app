// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

export class History {
  private board: any;
  private moves: string[];
  private id: number;

  constructor(board: any) {
    this.board = board;
    this.moves = [ board.getFen() ];
    this.id = 0;

    $('#move-history').empty();

    (window as any).showMove = (id: number) => {
      if (this) {
        this.display(id);
      }
    };

    $('#collapse-history').on('hidden.bs.collapse', () => {
      $('#history-toggle-icon').removeClass('fa-toggle-up').addClass('fa-toggle-down');
    });
    $('#collapse-history').on('shown.bs.collapse', () => {
      $('#history-toggle-icon').removeClass('fa-toggle-down').addClass('fa-toggle-up');
    });
  }

  public add(move: any, fen: string): void {
    this.moves.push(fen);
    this.id = this.moves.length - 1;
    this.update(move);
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
    this.moves = [ this.board.getFen() ];
  }

  public length(): number {
    return this.moves.length - 1;
  }

  public display(id?: number): void {
    if (id !== undefined) {
      this.id = id;
    }
    if (this.id >= 0 && this.id < this.moves.length) {
      this.board.set({ fen: this.moves[this.id] });
    }
  }

  public beginning(): void {
    this.display(0);
  }

  public backward(): void {
    if (this.id > 0) {
      this.display(this.id - 1);
    }
  }

  public forward(): void {
    if (this.id < this.moves.length - 1) {
      this.display(this.id + 1);
    }
  }

  public end(): void {
    this.display(this.moves.length - 1);
  }

  public undo(): void {
    if (this.id > 0) {
      this.display(this.id - 1);
      this.moves.pop();
    }
  }

  private update(move: any): void {
    const id: number = this.length();
    if (id % 2 === 1) {
      $('#move-history').append('<tr><th scope="row">'
        + (id + 1) / 2 + '</th><td><a href="javascript:void(0);" onclick="showMove(' + id + ')">'
        + move.san + '</a></td><td></td></tr>');
      $('#left-panel').scrollTop(document.getElementById('left-panel').scrollHeight);
    } else {
      $('#move-history tr:last td').eq(1).html('<a href="javascript:void(0);" onclick="showMove(' +
        id + ')">' + move.san + '</a>');
    }
  }
}

export default History;
