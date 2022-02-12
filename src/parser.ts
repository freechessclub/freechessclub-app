// Copyright 2022 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import Session from './session';

enum Reason {
  Unknown = 0,
  Resign,
  Disconnect,
  Checkmate,
  TimeForfeit,
  Draw,
  Adjourn,
  Abort,
};

export class Parser {
  private loggedin: boolean;
  private session: Session;
  private user: string;
  private pass: string;

  constructor(session: Session, user?: string, pass?: string) {
    this.loggedin = false;
    this.session = session;
    this.user = (user === undefined) ? 'guest' : user;
    this.pass = pass;
  }

  private style12ToFEN(str: string): string {
    let fen = '';
    let count = 0;
    for (let i = 0; i < 8; i++) {
      if (str[i] === '-') {
        count++;
        if (i === 7) {
          fen += count;
        }
      } else {
        if (count > 0) {
          fen += count;
          count = 0;
        }
        fen += str[i];
      }
    }
    return fen;
  }

  private login(msg: any): any {
    let match = null;
    match = msg.match(/login:/);
    if (match != null) {
      this.session.send(this.user);
      return null;
    }
    match = msg.match(/Press return to enter the server as/);
    if (match != null) {
      this.session.send('');
      return null;
    }

    match = msg.match(/\*\*\*\* Starting FICS session as ([a-zA-Z]+)(?:\(U\)) \*\*\*\*/);
    if (match != null && match.length > 1) {
      this.loggedin = true;
      return [{
        command: 1,
        control: match[1],
      }, {
        message: msg,
      }];
    }
  }

  private getGameResult(p1: string, p2: string, who: string, action: string) {
    action = action.trim();
    switch (action) {
      case 'resigns':
        if (p1 === who) {
          return [p2, p1, Reason.Resign];
        } else if (p2 === who) {
          return [p1, p2, Reason.Resign];
        }
      case 'forfeits by disconnection':
        if (p1 === who) {
          return [p2, p1, Reason.Disconnect];
        } else if (p2 === who) {
          return [p1, p2, Reason.Disconnect];
        }
      case 'checkmated':
        if (p1 === who) {
          return [p2, p1, Reason.Checkmate];
        } else if (p2 === who) {
          return [p1, p2, Reason.Checkmate];
        }
      case 'forfeits on time':
        if (p1 === who) {
          return [p2, p1, Reason.TimeForfeit];
        } else if (p2 === who) {
          return [p1, p2, Reason.TimeForfeit];
        }
      case 'aborted on move 1':
      case 'aborted by mutual agreement':
        return [p1, p2, Reason.Abort];
      case 'drawn by mutual agreement':
      case 'drawn because both players ran out of time':
      case 'drawn by repetition':
      case 'drawn by the 50 move rule':
      case 'drawn due to length':
      case 'was drawn':
      case 'player has mating material':
      case 'drawn by adjudication':
      case 'drawn by stalemate':
        return [p1, p2, Reason.Draw];
      case 'adjourned by mutual agreement':
        return [p1, p2, Reason.Adjourn];
    }
    return [p1, p2, Reason.Unknown];
  }

  private ab2str(buf: ArrayBuffer): string {
    return String.fromCharCode.apply(null, new Uint8Array(buf));
  }

  public async parse(data: any) {
    let msg : string;
    if (data instanceof ArrayBuffer) {
      msg = this.ab2str(data);
    } else {
      msg = await data.text();
    }
    return this._parse(msg);
  }

  private _parse(msg: string) {
    if (msg.length === 0) {
      return null;
    }

    msg = msg.replace(/\[G\]\0/g, (m, offset, str) => {
      this.session.send(String.fromCharCode(...[0x02, 0x39]));
      return '';
    });
    msg = msg.replace(/\((?:told|kibitzed) .+\)/g, '');
    msg = msg.replace(/\u0007/g, '');
    msg = msg.replace(/\x00/g, '');
    msg = msg.replace(/\\   /g, '');
    msg = msg.replace(/\r/g, '');
    msg = msg.replace(/fics%/g, '');
    msg = msg.trim();
    if (msg === '' || msg === '\n') {
      return null;
    }

    if (!this.loggedin) {
      return this.login(msg);
    }

    let match = null;

    // game move
    match = msg.match(/<12>\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([BW\-])\s(?:\-?[0-7])\s(?:[01])\s(?:[01])\s(?:[01])\s(?:[01])\s(?:[0-9]+)\s([0-9]+)\s([a-zA-Z]+)\s([a-zA-Z]+)\s(\-?[0-3])\s([0-9]+)\s([0-9]+)\s(?:[0-9]+)\s(?:[0-9]+)\s(\-?[0-9]+)\s(\-?[0-9]+)\s([0-9]+)\s(?:\S+)\s\((?:[0-9]+)\:(?:[0-9]+)\)\s(\S+)\s(?:[01])\s(?:[0-9]+)\s(?:[0-9]+)\s*/);
    if (match != null && match.length >= 18) {
      const msgs = msg.split(/\n/g);
      if (msgs.length > 1) {
        const parsedMsgs = [];
        for (const m of msgs) {
          if (m.length > 0) {
            parsedMsgs.push(this._parse(m));
          }
        }
        return parsedMsgs;
      }

      let fen = '';
      for (let i = 1; i < 8; i++) {
        fen += this.style12ToFEN(match[i]);
        fen += '/';
      }
      fen += this.style12ToFEN(match[8]);
      return {
        fen,
        turn: match[9],
        game_id: match[10],
        white_name: match[11],
        black_name: match[12],
        role: match[13],
        time: match[14],
        inc: match[15],
        white_time: match[16],
        black_time: match[17],
        move_no: match[18],
        move: match[19],
      };
    }

    // game start
    match = msg.match(/^\s*\{Game\s([0-9]+)\s\(([a-zA-Z]+)\svs\.\s([a-zA-Z]+)\)\sCreating.*\}.*/);
    if (match != null && match.length > 2) {
      return {
        game_id: match[1],
        player_one: match[2],
        player_two: match[3],
      };
    }

    // game end
    match = msg.match(/^[^\(\):]*(?:Game\s[0-9]+:.*)?\{Game\s([0-9]+)\s\(([a-zA-Z]+)\svs\.\s([a-zA-Z]+)\)\s([a-zA-Z]+)\s([a-zA-Z0-9\s]+)\}\s(?:[012/]+-[012/]+)?.*/);
    if (match != null && match.length > 4) {
      const p1 = match[2];
      const p2 = match[3];
      const who = match[4];
      const action = match[5];

      const [winner, loser, reason] = this.getGameResult(p1, p2, who, action);
      return {
        game_id: match[1],
        winner,
        loser,
        reason,
        message: msg,
      };
    }

    // channel tell
    match = msg.match(/^([a-zA-Z]+)(?:\([A-Z\*]+\))*\(([0-9]+)\):\s+([\s\S]*)/);
    if (match != null && match.length > 3) {
      return {
        channel: match[2],
        user: match[1],
        message: match[3].replace(/\n/g, ''),
      };
    }

    // private tell
    match = msg.match(/^([a-zA-Z]+)(?:[\(\[][A-Z0-9\*\-]+[\)\]])* (?:tells you|says):\s+([\s\S]*)/);
    if (match != null && match.length > 2) {
      return {
        user: match[1],
        message: match[2].replace(/\n/g, ''),
      };
    }

    // kibitz/whispers
    match = msg.match(/^([a-zA-Z]+)(?:\([A-Z0-9\*\-]+\))*\[([0-9]+)\] (?:kibitzes|whispers):\s+([\s\S]*)/);
    if (match != null && match.length > 3) {
      return {
        channel: 'Game ' + match[2],
        user: match[1],
        message: match[3].replace(/\n/g, ''),
      };
    }
    return { message: msg };
  }
}

export default Parser;
