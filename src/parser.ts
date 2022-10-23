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

    if (this.user === 'guest' || this.pass.length === 0) {
      match = msg.match(/Press return to enter the server as/);
      if (match != null) {
        this.session.send('');
        return null;
      }
      match = msg.match(/password:/);
      if (match != null && this.pass.length === 0) {
        return {
          command: 2,
          control: msg,
        };
      }
    } else {
      match = msg.match(/password:/);
      if (match != null) {
        this.session.send(this.pass);
        return null;
      }
    }

    match = msg.match(/\*\*\*\* Starting FICS session as ([a-zA-Z]+)(?:\(U\))? \*\*\*\*/);
    if (match != null && match.length > 1) {
      this.loggedin = true;
      return [{
        command: 1,
        control: match[1],
      }, {
        message: msg,
      }];
    }

    match = msg.match(/\*\*\*\* Invalid password! \*\*\*\*.*/);
    if (match != null) {
      return {
        command: 2,
        control: msg,
      };
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

    if (action.match(/ran out of time and ([a-zA-Z]+) has no material to mate/) != null) {
      return [p1, p2, Reason.Draw];
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

    console.log(msg);

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
    match = msg.match(/<12>\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([BW\-])\s(\-?[0-7])\s([01])\s([01])\s([01])\s([01])\s([0-9]+)\s([0-9]+)\s([a-zA-Z]+)\s([a-zA-Z]+)\s(\-?[0-3])\s([0-9]+)\s([0-9]+)\s([0-9]+)\s([0-9]+)\s(\-?[0-9]+)\s(\-?[0-9]+)\s([0-9]+)\s(\S+)\s\(([0-9]+)\:([0-9]+)\)\s(\S+)\s([01])\s([0-9]+)\s([0-9]+)\s*/);
    if (match != null && match.length >= 33) {
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
      // Parse the rest of the data, we should make use of all the game state info. 

      // color whose turn it is to move ("B" or "W")
      fen += ' ' + match[9].toLowerCase();
      // castling state
      var castleStr = '';
      castleStr += (+match[11] === 1 ? 'K' : ''); // can White still castle short? (0=no, 1=yes)
      castleStr += (+match[12] === 1 ? 'Q' : ''); // can White still castle long?
      castleStr += (+match[13] === 1 ? 'k' : ''); // can Black still castle short?
      castleStr += (+match[14] === 1 ? 'q' : ''); // can Black still castle long?
      fen += ' ' + (castleStr === '' ? '-' : castleStr);
      // -1 if the previous move was NOT a double pawn push, otherwise the chess board file  (numbered 0--7 for a--h) in which the double push was made   
      fen += ' ' + (+match[10] === -1 ? '-' : String.fromCharCode("a".charCodeAt(0) + +match[10]) + (match[9] === 'W' ? '6' : '3')); 
      // the number of moves made since the last irreversible move.  
      fen += ' ' + match[15];
      // the full move number
      fen += ' ' + match[26]; 

      // Parse move in long format (from, to, promotion)
      var move_matches = match[27].match(/\S+\/(\S{2})-(\S{2})=?(\S?)/);  
      var move_verbose;
      if(move_matches) {
        move_verbose = {
          from: move_matches[1], 
          to: move_matches[2], 
          promotion: move_matches[3],
          san: match[30]
        };  
      }
      else if(match[30] === 'O-O' || match[30] === 'O-O-O') {
        move_verbose = {
          from: 'e' + (match[9] === 'W' ? '8' : '1'),
          to: (match[30] === 'O-O' ? 'g' : 'c') + (match[9] === 'W' ? '8' : '1'),
          promotion: undefined,
          san: match[30]
        }
      }

      return {
        fen,                                  // game state
        turn: match[9],                       // color whose turn it is to move ("B" or "W")
        game_id: +match[16],                  // The game number
        white_name: match[17],                // White's name
        black_name: match[18],                // Black's name
        role: +match[19],                     // my relation to this game
        time: +match[20],                     // initial time (in seconds) of the match
        inc: +match[21],                      // increment In seconds) of the match
        white_material_strength: +match[22],  // White material strength
        black_material_strength: +match[23],  // Black material strength
        white_time: +match[24],               // White's remaining time
        black_time: +match[25],               // Black's remaining time
        move_no: +match[26],                  // the number of the move about to be made 
        move_verbose: move_verbose,           // verbose coordinate notation for the previous move ("none" if there werenone) [note this used to be broken for examined games]
        time_prev_move: {minutes: match[28], seconds: match[29]}, // time taken to make previous move "(min:sec)".
        move: match[30],                      // pretty notation for the previous move ("none" if there is none)
        flip: match[31] === '1'               // flip field for board orientation: 1 = Black at bottom, 0 = White at bottom.
      };
    }

    // game start
    match = msg.match(/^\s*\{Game\s([0-9]+)\s\(([a-zA-Z]+)\svs\.\s([a-zA-Z]+)\)\sCreating.*\}.*/s);
    if (match != null && match.length > 2) {
      return {
        game_id: match[1],
        player_one: match[2],
        player_two: match[3],
      };
    }

    // game end
    match = msg.match(/^[^\(\):]*(?:Game\s[0-9]+:.*)?\{Game\s([0-9]+)\s\(([a-zA-Z]+)\svs\.\s([a-zA-Z]+)\)\s([a-zA-Z]+)\s([a-zA-Z0-9\s]+)\}\s(?:[012/]+-[012/]+)?.*/s);
    if (match != null && match.length > 4) {
      const p1 = match[2];
      const p2 = match[3];
      const who = match[4];
      const action = match[5];

      const [winner, loser, reason] = this.getGameResult(p1, p2, who, action);
      return {
        game_id: +match[1],
        winner,
        loser,
        reason,
        message: msg,
      };
    }

    // channel tell
    match = msg.match(/^([a-zA-Z]+)(?:\([A-Z\*]+\))*\(([0-9]+)\):\s+([\s\S]*)/s);
    if (match != null && match.length > 3) {
      return {
        channel: match[2],
        user: match[1],
        message: match[3].replace(/\n/g, ''),
      };
    }

    // private tell
    match = msg.match(/^([a-zA-Z]+)(?:[\(\[][A-Z0-9\*\-]+[\)\]])* (?:tells you|says):\s+([\s\S]*)/s);
    if (match != null && match.length > 2) {
      return {
        user: match[1],
        message: match[2].replace(/\n/g, ''),
      };
    }

    // kibitz/whispers
    match = msg.match(/^([a-zA-Z]+)(?:\([A-Z0-9\*\-]+\))*\[([0-9]+)\] (?:kibitzes|whispers):\s+([\s\S]*)/s);
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
