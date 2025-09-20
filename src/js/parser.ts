// Copyright 2023 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import Session from './session';
import { parseDate } from './utils';

export enum Reason {
  Unknown = 0,
  Resign,
  Disconnect,
  Checkmate,
  TimeForfeit,
  Draw,
  Adjourn,
  Abort,
  PartnerWon,
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

    match = msg.match(/Sorry, names may be at most 17 characters long\.\s+Try again\./m);
    if(!match)
      match = msg.match(/Sorry, names can only consist of lower and upper case letters\.\s+Try again\./m);
    if (match != null) {
      return {
        command: 2,
        control: match[0],
      };
    }

    match = msg.match(/login:/);
    if (match != null) {
      this.session.setRegistered(false);
      this.session.send(this.user, false);
      return null;
    }

    match = msg.match(/Press return to enter the server as/);
    if (match != null) {
      this.pass = '';
      this.session.send('', false);
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
      this.session.send(this.pass, false);
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

  public getGameResult(p1: string, p2: string, who: string, action: string) {
    if(who === 'White')
      who = p1;
    else if(who === 'Black')
      who = p2;

    action = action.trim();
    switch (action) {
      case 'resigns':
        if (p1 === who) {
          return [p2, p1, Reason.Resign];
        } else if (p2 === who) {
          return [p1, p2, Reason.Resign];
        }
      case 'partner won':
        if (p1 === who) {
          return [p1, p2, Reason.PartnerWon];
        } else if (p2 === who) {
          return [p2, p1, Reason.PartnerWon];
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
      case 'aborted':
      case 'lost connection and too few moves; game aborted':
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
      case 'drawn':
        return [p1, p2, Reason.Draw];
      case 'adjourned':
      case 'adjourned by mutual agreement':
      case `courtesyadjourned by ${p1}`:
      case `courtesyadjourned by ${p2}`:
      case 'lost connection; game adjourned':
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
    if(msgs.length > 1) {
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

    msg = msg.replace(/\[G\]\0/g, () => {
      this.session.send(String.fromCharCode(...[0x02, 0x39]), false);
      return '';
    });
    msg = msg.replace(/\u0007/g, '');
    msg = msg.replace(/\x00/g, '');
    msg = msg.replace(/\x01/g, '');
    msg = msg.replace(/\\   /g, '');
    msg = msg.replace(/\r/g, '');
    msg = msg.trim();

    // FICS uses 'fics%' to separate multiple multi-line messages when sent together
    const msgs = this.splitMessage(msg, /fics%/);
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

    // Ignore text in help files
    if(/^\[?Last Modified/m.test(msg))
      return { message: msg };

    // game move
    match = msg.match(/(?:^|\n)<12>\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([rnbqkpRNBQKP\-]{8})\s([BW\-])\s(\-?[0-7])\s([01])\s([01])\s([01])\s([01])\s([0-9]+)\s([0-9]+)\s(\S+)\s(\S+)\s(\-?[0-3])\s([0-9]+)\s([0-9]+)\s([0-9]+)\s([0-9]+)\s(\-?[0-9]+)\s(\-?[0-9]+)\s([0-9]+)\s(\S+)\s\(([0-9]+)\:([0-9]+)\.([0-9]+)\)\s(\S+)\s([01])\s([0-9]+)\s([0-9]+)\s*/);
    if(match != null && match.length >= 34) {
      const gMsgs = this.splitMessage(msg);
      if(gMsgs)
        return gMsgs;

      let fen = '';
      for (let i = 1; i < 8; i++) {
        fen += this.style12ToFEN(match[i]);
        fen += '/';
      }
      fen += this.style12ToFEN(match[8]);

      // color whose turn it is to move ("B" or "W")
      fen += ` ${match[9].toLowerCase()}`;
      // castling state
      let castleStr = '';
      castleStr += (+match[11] === 1 ? 'K' : ''); // can White still castle short? (0=no, 1=yes)
      castleStr += (+match[12] === 1 ? 'Q' : ''); // can White still castle long?
      castleStr += (+match[13] === 1 ? 'k' : ''); // can Black still castle short?
      castleStr += (+match[14] === 1 ? 'q' : ''); // can Black still castle long?
      fen += ` ${castleStr === '' ? '-' : castleStr}`;
      // -1 if the previous move was NOT a double pawn push, otherwise the chess board file  (numbered 0--7 for a--h) in which the double push was made
      fen += ` ${+match[10] === -1 ? '-' : `${String.fromCharCode('a'.charCodeAt(0) + +match[10])}${match[9] === 'W' ? '6' : '3'}`}`;
      // the number of moves made since the last irreversible move.
      // FICS sometimes erroneously sets this to 1 when the starting player is black on move 1.
      fen += ` ${match[31] === 'none' ? '0' : match[15]}`;
      // the full move number
      fen += ` ${match[26]}`;

      // Parse move in long format (from, to, promotion)
      const moveMatches = match[27].match(/(\S+)\/(\S{2})-(\S{2})=?(\S?)/);
      let moveVerbose: any;
      if(moveMatches) {
        moveVerbose = {
          piece: moveMatches[1].toLowerCase(),
          from: (moveMatches[2] !== '@@' ? moveMatches[2] : null),
          to: moveMatches[3],
          promotion: moveMatches[4].toLowerCase(),
          san: match[31]
        };
      }
      else if(match[31] === 'O-O' || match[31] === 'O-O-O') {
        moveVerbose = {
          piece: 'k',
          from: `e${match[9] === 'W' ? '8' : '1'}`,
          to: `${match[31] === 'O-O' ? 'g' : 'c'}${match[9] === 'W' ? '8' : '1'}`,
          promotion: undefined,
          san: match[31]
        }
      }

      return {
        fen,                                  // game state
        turn: match[9].toLowerCase(),         // color whose turn it is to move ("b" or "w")
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
        moveVerbose,                          // verbose coordinate notation for the previous move ("none" if there were none)
        prevMoveTime: {minutes: match[28], seconds: match[29], milliseconds: match[30]}, // time taken to make previous move "(min:sec)".
        move: match[31],                      // pretty notation for the previous move ("none" if there is none)
        flip: match[32] === '1'               // flip field for board orientation: 1 = Black at bottom, 0 = White at bottom.
      };
    }

    // held pieces (Crazyhouse/Bughouse)
    match = msg.match(/^<b1> game (\d+) white \[(\w*)\] black \[(\w*)\](?: <- (\w+))?/m);
    if (match != null && match.length > 3) {
      const holdings = {P: 0, R: 0, B: 0, N: 0, Q: 0, K: 0, p: 0, r: 0, b: 0, n: 0, q: 0, k: 0};

      for(const piece of match[2])
        holdings[piece.toUpperCase()]++;

      for(const piece of match[3])
        holdings[piece.toLowerCase()]++;

      return {
        game_id: +match[1],
        holdings,
        new_holding: match[4],
      };
    }

    // game start
    match = msg.match(/(?:^|\n)\s*\{Game\s([0-9]+)\s\(([a-zA-Z]+)\svs\.\s([a-zA-Z]+)\)\s(?:Creating|Continuing)[^\}]*\}.*/s);
    if (match != null && match.length > 2) {
      return {
        game_id: +match[1],
        player_one: match[2],
        player_two: match[3],
      };
    }

    // game end
    match = msg.match(/(?:^|\n)[^\(\):]*(?:Game\s[0-9]+:.*)?\{Game\s([0-9]+)\s\(([a-zA-Z]+)\svs\.\s([a-zA-Z]+)\)\s([a-zA-Z]+)(?:' game|'s)?\s([^\}]+)\}\s(\*|[012/]+-[012/]+).*/s);
    if (match != null && match.length > 5) {
      const gMsgs = this.splitMessage(msg);
      if(gMsgs)
        return gMsgs;

      const p1 = match[2];
      const p2 = match[3];
      const who = match[4];
      const action = match[5];
      const score = match[6];

      const [winner, loser, reason] = this.getGameResult(p1, p2, who, action);
      return {
        game_id: +match[1],
        winner,
        loser,
        reason,
        score,
        message: msg,
      };
    }

    // channel tell
    match = msg.match(/(?:^|\n)([a-zA-Z]+)(?:\([A-Z\*]+\))*\(([0-9]+)\):\s+(.*)/);
    if (match != null && match.length > 3) {
      return {
        channel: match[2],
        user: match[1],
        message: match[3],
      };
    }

    // private tell
    match = msg.match(/(?:^|\n)([a-zA-Z]+)(?:[\(\[][A-Z0-9\*\-]+[\)\]])* (?:tells you|says):\s+(.*)/);
    if (match != null && match.length > 2) {
      return {
        user: match[1],
        message: match[2],
      };
    }

    // kibitz/whispers
    match = msg.match(/(?:^|\n)([a-zA-Z]+)(?:\([A-Z0-9\*\-]+\))*\[([0-9]+)\] (kibitzes|whispers):\s+(.*)(?:\n(.+))?/);
    if (match != null && match.length > 4) {
      const type = match[3] === 'kibitzes' ? 'kibitz' : 'whisper';
      return {
        channel: `Game ${match[2]}`,
        user: match[1],
        type,
        message: match[4].replace(/\n/g, ''),
        suffix: match[5]
      };
    }

    // messages (from 'message' command etc)
    match = msg.match(/^(Messages:|Messages from \w+:|Unread messages:|The following message was received|The following message was emailed:)[\s\S]+/m);
    if(match) {
      const lines = match[0].split('\n').slice(1);
      const messages = lines.map(line => {
        const lineMatch = line.match(/(?:(\d+)\. )?(\w+) at (\w+) (\w+)\s+(\d+), (\d{2}):(\d{2}) ([\w\?]+) (\d+): (.+)/); 
        if(lineMatch) {
          const dateTime = {
            weekday: lineMatch[3],
            month: lineMatch[4],
            day: lineMatch[5],
            hour: lineMatch[6],
            minute: lineMatch[7],
            timezone: lineMatch[8],
            year: lineMatch[9]
          }

          return {
            type: 'message',
            id: lineMatch[1],
            user: lineMatch[2],
            datetime: parseDate(dateTime),
            message: lineMatch[10],
            raw: msg
          };
        }
      });

      let type = '';
      if(match[1] === 'Messages:')
        type = 'all';
      else if(match[1] === 'Unread messages:')
        type = 'unread';
      else if(match[1].startsWith('Messages from'))
        type = 'sender';
      else if(match[1] === 'The following message was received' || match[1] === 'The following message was emailed:')
        type = 'online';

      return {
        type,
        messages,
        raw: msg
      }
    }

    // offers info (seekinfo and pendinfo)
    const index = msg.search(/^<(pt|pf|pr|s|sc|sn|sr)>/m)
    if(index !== -1) {
      // if plain text componenet, split into 2 messages
      const plainText = msg.slice(0, index).trim();
      if(plainText)
        return [this._parse(plainText), this._parse(msg.slice(index))];

      const offers = [];
      const lines = msg.split('\n');
      for(let line of lines) {
        line = line.trim();
        // parse pendinfo
        match = line.match(/^<(pt|pf)> (\d+) w=(\S+) t=(\S+) p=((\S+)(?: \(\s*(\S+)\)(?: \[(black|white)\])? (\S+) \(\s*(\S+)\) (rated|unrated) (\S+)(?: (\d+) (\d+))?(?: Loaded from (\S+))?( \(adjourned\))?)?)/);
        if(match) {
          const type = match[1];
          const subtype = match[4];

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
              adjourned: !!match[16]
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
        offers,
      }
    }

    match = msg.match(/^Your seeks have been removed\./m);
    if(!match)
      match = msg.match(/^Your seek (\d+) has been removed\./m);
    if(match) {
      const ids = match.length > 1 ? [match[1]] : [];
      return {
        offers: [{
          type: 'sr',
          ids: ids,
        }],
        raw: msg
      };
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
