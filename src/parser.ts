// Copyright 2023 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import Session from './session';

export enum Reason {
  Unknown = 0,
  Resign,
  Disconnect,
  Checkmate,
  TimeForfeit,
  Draw,
  Adjourn,
  Abort,
}

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

    msg = msg.replace(/\uFFFD/g, '');

    match = msg.match(/Sorry, names may be at most 17 characters long\.\s+Try again./m);
    if (match != null) {
      return {
        command: 2,
        control: match[0],
      }; 
    }

    match = msg.match(/login:/);
    if (match != null) {
      this.session.setRegistered(false);
      this.session.send(this.user);
      return null;
    }

    match = msg.match(/Press return to enter the server as/);
    if (match != null) {
      this.pass = '';
      this.session.send('');
      return null;
    }

    match = msg.match(/password:/);
    if (match != null) {
      if(this.pass.length === 0) {
        return {
          command: 2,
          control: msg.replace(/password:/, ''),
        };
      }
      this.session.setRegistered(true);
      this.session.send(this.pass);
      return null;
    }

    match = msg.match(/\*\*\*\* Starting FICS session as ([a-zA-Z]+)(?:\(.*\))? \*\*\*\*/);
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

  private splitMessage(msg: string, pattern: any = /\n/) {
    const msgs = msg.split(new RegExp(pattern, 'g')).filter(Boolean);
    if (msgs.length > 1) {
      const parsedMsgs = [];
      for (const m of msgs) {
        if (m.length > 0) {
          parsedMsgs.push(this._parse(m));
        }
      }
      return parsedMsgs.flat();
    }

    return undefined;
  }

  public parse(data: any) {
    let msg : string;
    if (data instanceof ArrayBuffer) 
      msg = this.ab2str(data);
    else 
      msg = data;
      
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
    msg = msg.replace(/\x01/g, '');
    msg = msg.replace(/\\   /g, '');
    msg = msg.replace(/\r/g, '');
    msg = msg.trim();

    // FICS uses 'fics%' to separate multiple multi-line messages when sent together
    msgs = this.splitMessage(msg, /fics%/);
    if(msgs) 
      return msgs;

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
    match = msg.match(/<12>\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([BW\-])\s(\-?[0-7])\s([01])\s([01])\s([01])\s([01])\s([0-9]+)\s([0-9]+)\s([a-zA-Z]+)\s([a-zA-Z]+)\s(\-?[0-3])\s([0-9]+)\s([0-9]+)\s([0-9]+)\s([0-9]+)\s(\-?[0-9]+)\s(\-?[0-9]+)\s([0-9]+)\s(\S+)\s\(([0-9]+)\:([0-9]+)\.([0-9]+)\)\s(\S+)\s([01])\s([0-9]+)\s([0-9]+)\s*/);
    if (match != null && match.length >= 34) {
      var msgs = this.splitMessage(msg);
      if(msgs)
        return msgs;

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
      let castleStr = '';
      castleStr += (+match[11] === 1 ? 'K' : ''); // can White still castle short? (0=no, 1=yes)
      castleStr += (+match[12] === 1 ? 'Q' : ''); // can White still castle long?
      castleStr += (+match[13] === 1 ? 'k' : ''); // can Black still castle short?
      castleStr += (+match[14] === 1 ? 'q' : ''); // can Black still castle long?
      fen += ' ' + (castleStr === '' ? '-' : castleStr);
      // -1 if the previous move was NOT a double pawn push, otherwise the chess board file  (numbered 0--7 for a--h) in which the double push was made
      fen += ' ' + (+match[10] === -1 ? '-' : String.fromCharCode('a'.charCodeAt(0) + +match[10]) + (match[9] === 'W' ? '6' : '3'));
      // the number of moves made since the last irreversible move.
      fen += ' ' + match[15];
      // the full move number
      fen += ' ' + match[26];

      // Parse move in long format (from, to, promotion)
      const moveMatches = match[27].match(/\S+\/(\S{2})-(\S{2})=?(\S?)/);
      let moveVerbose;
      if(moveMatches) {
        moveVerbose = {
          from: moveMatches[1],
          to: moveMatches[2],
          promotion: moveMatches[3],
          san: match[31]
        };
      }
      else if(match[31] === 'O-O' || match[31] === 'O-O-O') {
        moveVerbose = {
          from: 'e' + (match[9] === 'W' ? '8' : '1'),
          to: (match[31] === 'O-O' ? 'g' : 'c') + (match[9] === 'W' ? '8' : '1'),
          promotion: undefined,
          san: match[31]
        }
      }

      return {
        fen,                                  // game state
        turn: match[9],                       // color whose turn it is to move ("B" or "W")
        id: +match[16],                       // The game number
        wname: match[17],                     // White's name
        bname: match[18],                     // Black's name
        role: +match[19],                     // my relation to this game
        time: +match[20],                     // initial time (in seconds) of the match
        inc: +match[21],                      // increment In seconds) of the match
        wstrength: +match[22],                // White material strength
        bstrength: +match[23],                // Black material strength
        wtime: +match[24],                    // White's remaining time in milliseconds
        btime: +match[25],                    // Black's remaining time in milliseconds
        moveNo: +match[26],                   // the number of the move about to be made
        moveVerbose,                          // verbose coordinate notation for the previous move ("none" if there werenone) [note this used to be broken for examined games]
        prevMoveTime: {minutes: match[28], seconds: match[29], milliseconds: match[30]}, // time taken to make previous move "(min:sec)".
        move: match[31],                      // pretty notation for the previous move ("none" if there is none)
        flip: match[32] === '1'               // flip field for board orientation: 1 = Black at bottom, 0 = White at bottom.
      };
    }

    // held pieces (Crazyhouse/Bughouse)
    match = msg.match(/^<b1> game (\d+) white \[(\w*)\] black \[(\w*)\](?: <- (\w+))?/m);
    if (match != null && match.length > 3) {
      var holdings = {P: 0, R: 0, B: 0, N: 0, Q: 0, K: 0, p: 0, r: 0, b: 0, n: 0, q: 0, k: 0};

      for(const piece of match[2]) 
        holdings[piece.toLowerCase()]++;
      
      for(const piece of match[3])
        holdings[piece.toUpperCase()]++;

      return {
        game_id: match[1],
        holdings: holdings,
        new_holding: match[4],
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
      var msgs = this.splitMessage(msg);
      if(msgs)
        return msgs;

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

    // offers info (seekinfo and pendinfo)
    var index = msg.search(/^<(pt|pf|pr|s|sc|sn|sr)>/m)
    if(index !== -1) {
      // if plain text componenet, split into 2 messages
      let plainText = msg.slice(0, index).trim();
      if(plainText) 
        return [this._parse(plainText), this._parse(msg.slice(index))];

      let offers = [];
      let lines = msg.split('\n');
      for(let line of lines) {
        line = line.trim();
        // parse pendinfo
        match = line.match(/^<(pt|pf)> (\d+) w=(\S+) t=(\S+) p=((\S+)(?: \((\S+)\)(?: \[(black|white)\])? (\S+) \((\S+)\) (rated|unrated) (\S+)(?: (\d+) (\d+))?(?: Loaded from (\S+))?)?)/);
        if(match) {
          let type = match[1];
          let subtype = match[4];

          if(subtype === 'match') {
            offers.push({
              type: match[1],
              id: match[2],
              toFrom: match[3],
              subtype: match[4],
              asString: match[5],
              player: (type === 'pt' ? match[6] : match[9]),
              playerRating: (type === 'pt' ? match[7] : match[10]),
              opponent: (type === 'pt' ? match[9] : match[6]),
              opponentRating: (type === 'pt' ? match[10] : match[7]),
              color: match[8],
              ratedUnrated: match[11],
              category: match[15] || match[12],
              initialTime: +match[13],
              increment: +match[14],
            });
          }
          else {
            offers.push({
              type: match[1],
              id: match[2],
              toFrom: match[3],
              subtype: match[4],
              parameters: match[5]
            });
          }
          continue;
        }   
        // parse seekinfo
        if(line === '<sc>') {
          offers.push({ type: 'sc' });
          continue;
        }
        match = line.match(/^<(s|sn)> (\d+) w=(\S+) ti=(\d+) rt=(\S+)\s+t=(\d+) i=(\d+) r=(\S+) tp=(\S+) c=(\S+) rr=(\S+) a=(\S+) f=(\S+)/);
        if(match) {
          offers.push({
            type: match[1],
            id: match[2],
            toFrom: match[3],
            title: titleToString[+match[4]],
            rating: (match[5] === '0P' ? '' : match[5]),
            initialTime: +match[6],
            increment: +match[7],
            ratedUnrated: match[8],
            category: match[9],
            color: match[10],
            ratingRange: match[11],
            automatic: match[12] === 't',
            formula: match[13] === 't'
          });
          continue;
        }
        match = line.match(/^<(pr|sr)> (.+)/);
        if(match) {
          offers.push({
            type: match[1],
            ids: match[2].split(' ')
          });
        }
      }
      return {
        offers: offers,
      }
    }

    return { message: msg };
  }
}

const titleToString = {
  0x0 : '',
  0x1 : 'U',
  0x2 : 'C',
  0x4 : 'GM',
  0x8 : 'IM',
  0x10 : 'FM',
  0x20 : 'WGM',
  0x40 : 'WIM',
  0x80 : 'WFM',
};

export default Parser;
