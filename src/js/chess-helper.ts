// Copyright 2024 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import Chess from 'chess.js';

/** FEN and chess helper functions **/

export interface VariantData {
  holdings: object,
  promoted: string[],
}

export interface Piece {
  type: 'k' | 'q' | 'r' | 'b' | 'n' | 'p',
  color: 'w' | 'b'
}

/**
 * Represents a chess position as an 8x8 array of Piece objects.
 */
export class Position {
  private board: (Piece | null)[][];

  public static SQUARES = [
    'a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8',
    'a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7',
    'a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6',
    'a5', 'b5', 'c5', 'd5', 'e5', 'f5', 'g5', 'h5',
    'a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4',
    'a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3', 'h3',
    'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2',
    'a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1'
  ];

  constructor(fen?: string) {
    if(!fen)
      fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

    this.board = [];
    const rows = fen.split(' ')[0].split('/'); // Only take the board layout part of the FEN
    rows.forEach(row => {
      const boardRow = [];
      for(const char of row) {
        if(/\d/.test(char))
          boardRow.push(...Array(parseInt(char, 10)).fill(null));
        else {
          const color = char === char.toLowerCase() ? 'b' : 'w';
          const type = char.toLowerCase() as 'k' | 'q' | 'r' | 'b' | 'n' | 'p';
          boardRow.push({ type, color });
        }
      }
      this.board.push(boardRow);
    });
  }

  public get(square: string): Piece | null {
    const file = square[0];
    const rank = square[1];
    const colIndex = file.charCodeAt(0) - 'a'.charCodeAt(0);
    const rowIndex = 8 - parseInt(rank, 10);
    return this.board[rowIndex][colIndex];
  }

  public set(square: string, piece: Piece | null) {
    const file = square[0];
    const rank = square[1];
    const colIndex = file.charCodeAt(0) - 'a'.charCodeAt(0);
    const rowIndex = 8 - parseInt(rank, 10);
    this.board[rowIndex][colIndex] = piece;
  }

  public remove(square: string) {
    this.set(square, null);
  }
}

/**
 * Checks if the position specified by fen is in stalemate for the plyaer to move.
 * For Crazyhouse/bughouse this takes into account captured/held pieces
 * @param variantData Used by crazyhouse/bughouse
 * @returns true if player is in stalemate, otherwise false
 */
export function stalemate(fen: string, variantData?: VariantData): boolean {
  if(variantData && variantData.holdings) {
    const turnColor = getTurnColorFromFEN(fen);
    const holdings = variantData.holdings;
    for(const [key, value] of Object.entries(holdings)) {
      // Can't be in stalemate if the player has holdings (captured pieces) in crazyhouse/bughouse
      if((key.toUpperCase() === key && turnColor === 'w') || (key.toLowerCase() === key && turnColor === 'b')
          && value)
        return false;
    }
  }

  const chess = new Chess(fen);
  return chess.in_stalemate();
}

/**
 * Returns true if the position is a 50 moves draw
 */
export function fiftyMoves(fen: string): boolean {
  const fenWords = splitFEN(fen);
  return +fenWords.plyClock >= 50;
}

/**
 * Checks if there is insufficient material to mate
 * @param variantData Used by crazyhouse/bughouse
 * @param color Color can be 'w', 'b' or undefined. If the color is not specified then the function
 * only returns true if both sides have insufficient material to mate
 * @returns true if insufficient material to mate, otherwise false
 */
export function insufficientMaterial(fen: string, variantData?: VariantData, color?: string): boolean {
  let whiteWeight = 0;
  let blackWeight = 0;

  if(variantData && variantData.holdings) {
    const holdings = variantData.holdings;
    Object.entries(holdings).forEach(([key, value]) => {
      const weight = (key.toLowerCase() === 'n' || key.toLowerCase() === 'b') ? 0.5 * value : value;
      if(key === key.toUpperCase())
        whiteWeight += weight;
      else
        blackWeight += weight;
    });
  }

  const material = {
    P: 0, R: 0, Bw: 0, Bb: 0, N: 0, Q: 0, K: 0, p: 0, r: 0, bw: 0, bb: 0, n: 0, q: 0, k: 0
  };

  const pos = new Position(fen);
  for(const sq of Position.SQUARES) {
    const piece = pos.get(sq);
    if(piece && (!color || color === piece.color)) {
      const pieceColorType = piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
      if(piece.type === 'b') {
        const fileNum = sq[0].charCodeAt(0) - 'a'.charCodeAt(0) + 1;
        const rankNum = +sq[1];
        const squareColor = (fileNum + rankNum) % 2 === 0 ? 'b' : 'w';
        material[`${pieceColorType}${squareColor}`] = 1;
      }
      else
        material[pieceColorType]++;
    }
  }

  Object.entries(material).forEach(([key, value]) => {
    const lowKey = key.toLowerCase();
    const weight = (lowKey === 'n' || lowKey === 'bw' || lowKey === 'bb') ? 0.5 * value : value;
    if(key[0] === key[0].toUpperCase())
      whiteWeight += weight;
    else
      blackWeight += weight;
  });

  return (color === 'w' && whiteWeight < 2) || (color === 'b' && blackWeight < 2) || (!color && whiteWeight < 2 && blackWeight < 2);
}

export function parseMove(fen: string, move: any, startFen: string, category: string, variantData?: Partial<VariantData>, premove=false) {
  // Check to see if the dest square is reachable from source square  
  // Basic, fast initial check for performance reasons
  if(move && typeof move === 'object' && move.from && move.to && move.piece 
      && !isReachable(move.from, move.to, move.piece, getTurnColorFromFEN(fen)))
    return null;

  const standardCategories = ['blitz', 'lightning', 'untimed', 'standard', 'nonstandard'];

  // Parse variant move or premove
  if(!standardCategories.includes(category) || premove)
    return parseVariantMove(fen, move, startFen, category, variantData, premove);

  // Parse standard move
  const chess = new Chess(fen);
  const outMove = chess.move(move);
  const outFen = chess.fen();

  if(!outMove || !outFen)
    return null;

  return { fen: outFen, move: outMove };
}

function parseVariantMove(fen: string, move: any, startFen: string, category: string, variantData?: Partial<VariantData>, premove=false) {
  const supportedCategories = ['crazyhouse', 'bughouse', 'losers', 'wild/fr', 'wild/0', 'wild/1', 'wild/2', 'wild/3', 'wild/4', 'wild/5', 'wild/8', 'wild/8a'];
  if(!supportedCategories.includes(category) && !premove)
    return null;

  // clear en passant from FEN for premove since it confuses chess.js (and doesn't make sense for a premove)
  if(premove) {
    const fenWords = splitFEN(fen);
    fenWords.enPassant = '-';
    fen = joinFEN(fenWords);
  }

  let chess = new Chess(fen);
  let san = '';

  // Convert algebraic coordinates to SAN for non-standard moves
  if(typeof move !== 'string') {
    const fromPiece = move.from ? chess.get(move.from) : undefined;
    const toPiece = chess.get(move.to);

    if(!move.from)
      san = `${move.piece.toUpperCase()}@${move.to}`; // Crazyhouse/bughouse piece placement

    if(fromPiece && fromPiece.type === 'k') {
      if((toPiece && toPiece.type === 'r' && toPiece.color === chess.turn()) // rook castling
          || (Math.abs(move.to.charCodeAt(0) - move.from.charCodeAt(0)) > 1)) { // Normal castling (king moved 2 or more squares) 
        if(move.to.charCodeAt(0) - move.from.charCodeAt(0) > 0)
          san = (category === 'wild/fr' || move.from[0] === 'e' ? 'O-O' : 'O-O-O'); // King moved towards the h-file
        else
          san = (category === 'wild/fr' || move.from[0] === 'e' ? 'O-O-O' : 'O-O'); // King moved towards the a-file
      }
    }
    if(san)
      move = san;
  }
  else
    san = move;

  // Pre-processing of FEN before calling chess.move()
  const beforePre = splitFEN(fen); // Stores FEN components from before pre-processing of FEN starts
  const afterPre = Object.assign({}, beforePre); // Stores FEN components for after pre-procesisng is finished

  let opponentRights: string;
  if(category.startsWith('wild')) {
    // Remove opponent's castling rights since it confuses chess.js
    let castlingRights: string;
    if(beforePre.color === 'w') {
      opponentRights = beforePre.castlingRights.replace(/[KQ-]/g,'');
      castlingRights = beforePre.castlingRights.replace(/[kq]/g,'');
    }
    else {
      opponentRights = beforePre.castlingRights.replace(/[kq-]/g,'');
      castlingRights = beforePre.castlingRights.replace(/[KQ]/g,'');
    }
    if(castlingRights === '')
      castlingRights = '-';

    afterPre.castlingRights = castlingRights;
    fen = joinFEN(afterPre);
    chess.load(fen);
  }

  /** Try to make standard move **/
  let outMove = chess.move(move);
  let outFen = chess.fen();

  /** Manually update FEN for non-standard moves **/
  if(!outMove || premove 
      || (category.startsWith('wild') && san.toUpperCase().startsWith('O-O'))) {
    san = san.replace(/[+#]/, ''); // remove check and checkmate, we'll add it back at the end

    chess = new Chess(fen);

    const board = afterPre.board;
    const color = afterPre.color;
    const castlingRights = afterPre.castlingRights;
    const plyClock = afterPre.plyClock;
    const moveNo = afterPre.moveNo;

    let boardAfter = board;
    let colorAfter = (color === 'w' ? 'b' : 'w');
    let castlingRightsAfter = castlingRights;
    const enPassantAfter = '-';
    let plyClockAfter = +plyClock + 1;
    const moveNoAfter = (colorAfter === 'w' ? +moveNo + 1 : moveNo);

    outMove = {color, san};

    if(san.includes('@')) {
      // Parse crazyhouse or bughouse piece placement
      outMove.piece = san.charAt(0).toLowerCase();
      outMove.to = san.substring(2);

      // Can't place a pawn on the 1st or 8th rank
      const rank = outMove.to.charAt(1);
      if(outMove.piece === 'p' && (rank === '1' || rank === '8'))
        return null;

      chess.put({type: outMove.piece, color}, outMove.to);

      // Piece placement didn't block check/checkmate
      if(chess.in_check() || chess.in_checkmate())
        return null;

      outMove.flags = 'z';
      plyClockAfter = 0;
    }
    else if(san.toUpperCase() === 'O-O' || san.toUpperCase() === 'O-O-O') {
      // Parse irregular castling moves for fischer random and wild variants
      const rank = (color === 'w' ? '1' : '8');
      const cPieces = getCastlingPieces(startFen, color, category);
      const kingFrom = cPieces.king;
      const leftRook = cPieces.leftRook;
      const rightRook = cPieces.rightRook;
      let kingTo: string;
      let rookFrom: string;
      let rookTo: string;

      if(san.toUpperCase() === 'O-O') {
        if(category === 'wild/fr') {
          // fischer random
          kingTo = `g${rank}`;
          rookFrom = rightRook;
          rookTo = `f${rank}`;
        }
        else {
          // wild/0, wild/1 etc
          if(kingFrom[0] === 'e') {
            kingTo = `g${rank}`;
            rookFrom = rightRook;
            rookTo = `f${rank}`;
          }
          else {
            kingTo = `b${rank}`;
            rookFrom = leftRook;
            rookTo = `c${rank}`;
          }
        }
      }
      else if(san.toUpperCase() === 'O-O-O') {
        if(category === 'wild/fr') {
          kingTo = `c${rank}`;
          rookFrom = leftRook;
          rookTo = `d${rank}`;
        }
        else {
          // wild/0, wild/1
          if(kingFrom[0] === 'e') {
            kingTo = `c${rank}`;
            rookFrom = leftRook;
            rookTo = `d${rank}`;
          }
          else {
            kingTo = `f${rank}`;
            rookFrom = rightRook;
            rookTo = `e${rank}`;
          }
        }
      }

      if(rookFrom === leftRook) {
        // Do we have castling rights?
        if(!castlingRights.includes(color === 'w' ? 'Q' : 'q'))
          return null;

        outMove.flags = 'q';
      }
      else {
        if(!castlingRights.includes(color === 'w' ? 'K' : 'k'))
          return null;

        outMove.flags = 'k';
      }

      // Check castling is legal
      if(!premove) {
        // Can king pass through all squares between start and end squares?
        let startCode: number;
        let endCode: number;
        if(kingFrom.charCodeAt(0) < kingTo.charCodeAt(0)) {
          startCode = kingFrom.charCodeAt(0);
          endCode = kingTo.charCodeAt(0);
        }
        else {
          startCode = kingTo.charCodeAt(0);
          endCode = kingFrom.charCodeAt(0);
        }
        for(let code = startCode; code <= endCode; code++) {
          const square = `${String.fromCharCode(code)}${kingFrom[1]}`;
          // square blocked?
          if(square !== kingFrom && square !== rookFrom && chess.get(square))
            return null;
          // square under attack?
          if(isAttacked(fen, square, color))
            return null;
        }
        // Can rook pass through all squares between start and end squares?
        if(rookFrom.charCodeAt(0) < rookTo.charCodeAt(0)) {
          startCode = rookFrom.charCodeAt(0);
          endCode = rookTo.charCodeAt(0);
        }
        else {
          startCode = rookTo.charCodeAt(0);
          endCode = rookFrom.charCodeAt(0);
        }
        for(let code = startCode; code <= endCode; code++) {
          const square = `${String.fromCharCode(code)}${rookFrom[1]}`;
          // square blocked?
          if(square !== rookFrom && square !== kingFrom && chess.get(square))
            return null;
        }
      }

      chess.remove(kingFrom);
      chess.remove(rookFrom);
      chess.put({type: 'k', color}, kingTo);
      chess.put({type: 'r', color}, rookTo);

      castlingRightsAfter = castlingRights;
      if(rookFrom === leftRook)
        castlingRightsAfter = castlingRightsAfter.replace((color === 'w' ? 'Q' : 'q'), '');
      else
        castlingRightsAfter = castlingRightsAfter.replace((color === 'w' ? 'K' : 'k'), '');

      // On FICS there is a weird bug (feature?) where as long as the king hasn't moved after castling,
      // you can castle again!
      if(kingFrom !== kingTo) {
        if(rookFrom === leftRook)
          castlingRightsAfter = castlingRightsAfter.replace((color === 'w' ? 'K' : 'k'), '');
        else
          castlingRightsAfter = castlingRightsAfter.replace((color === 'w' ? 'Q' : 'q'), '');
      }

      if(castlingRightsAfter === '')
        castlingRightsAfter = '-';

      outMove.piece = 'k';
      outMove.from = kingFrom;

      if(category === 'wild/fr')
        outMove.to = rookFrom; // Fischer random specifies castling to/from coorindates using 'rook castling'
      else
        outMove.to = kingTo;
    }
    else if(premove) {
      // Perform very limited validation for premove, simply make sure the piece exists
      const piece = chess.get(move.from);
      if(!piece || piece.color !== color) 
        return null;

      if(piece.type === 'k' && !isReachable(move.from, move.to, piece.type, color, false))
        return null;

      outMove.from = move.from;
      outMove.to = move.to;
      outMove.piece = piece.type;
      outMove.promotion = move.promotion;

      if(move.promotion)
        piece.type = move.promotion;
      chess.remove(move.from);
      chess.put(piece, move.to);
    }

    boardAfter = chess.fen().split(/\s+/)[0];
    outFen = `${boardAfter} ${colorAfter} ${castlingRightsAfter} ${enPassantAfter} ${plyClockAfter} ${moveNoAfter}`;

    chess.load(outFen);
    if(chess.in_checkmate()) 
      outMove.san += '#';
    else if(chess.in_check())
      outMove.san += '+';
  }

  // Post-processing on FEN after calling chess.move()
  const beforePost = splitFEN(outFen); // Stores FEN components before post-processing starts
  const afterPost = Object.assign({}, beforePost); // Stores FEN components after post-processing is completed

  if(category === 'crazyhouse' || category === 'bughouse') {
    afterPost.plyClock = '0'; // FICS doesn't use the 'irreversable moves count' for crazyhouse/bughouse, so set it to 0

    // Check if it's really mate, i.e. player can't block with a held piece
    // (Yes this is a lot of code for something so simple)
    if(chess.in_checkmate()) {
      // Get square of king being checkmated
      let kingSquare: string;
      for(const s of chess.SQUARES) {
        const piece = chess.get(s);
        if(piece && piece.type === 'k' && piece.color === chess.turn()) {
          kingSquare = s;
          break;
        }
      }
      // place a pawn on every adjacent square to the king and check if it blocks the checkmate
      // If so the checkmate can potentially be blocked by a held piece
      const adjacent = getAdjacentSquares(kingSquare);
      let blockingSquare = null;
      for(const adj of adjacent) {
        if(!chess.get(adj)) {
          chess.put({type: 'p', color: chess.turn()}, adj);
          if(!chess.in_check()) {
            blockingSquare = adj;
            break;
          }
          chess.remove(adj);
        }
      }
      if(blockingSquare) {
        let canBlock = false;
        if(category === 'crazyhouse') {
          // check if we have a held piece capable of occupying the blocking square
          for(const k in variantData?.holdings) {
            if(variantData.holdings[k] === 0)
              continue;

            if((chess.turn() === 'w' && k.toUpperCase() !== k) ||
                (chess.turn() === 'b' && k.toLowerCase() !== k))
              continue;

            // held pawns can't be placed on the 1st or 8th rank
            const rank = blockingSquare.charAt(1);
            if(k.toLowerCase() !== 'p' || (rank !== '1' && rank !== '8'))
              canBlock = true;
          }
        }
        // If playing a bughouse game, and the checkmate can be blocked in the future, then it's not checkmate
        if(category === 'bughouse' || canBlock)
          outMove.san = outMove.san.replace('#', '+');
      }
    }
  }
  if(category.startsWith('wild') || premove) {
    if(!san.toUpperCase().startsWith('O-O')) {
      // Restore castling rights which chess.js erroneously removes
      afterPost.castlingRights = afterPre.castlingRights;
      outFen = joinFEN(afterPost);
      // Adjust castling rights after rook or king move (not castling)
      outFen = adjustCastlingRights(outFen, startFen, category);
      afterPost.castlingRights = splitFEN(outFen).castlingRights;
    }
    if(opponentRights) {
      // Restore opponent's castling rights (which were removed at the start so as not to confuse chess.js)
      let castlingRights = afterPost.castlingRights;
      if(castlingRights === '-')
        castlingRights = '';
      if(afterPost.color === 'w')
        afterPost.castlingRights = `${opponentRights}${castlingRights}`;
      else
        afterPost.castlingRights = `${castlingRights}${opponentRights}`;
    }
  }
  outFen = joinFEN(afterPost);

  // Move was not made, something went wrong
  if(afterPost.board === beforePre.board)
    return null;

  if(!outMove || !outFen)
    return null;

  return {fen: outFen, move: outMove};
}

export function toDests(fen: string, startFen: string, category: string, variantData?: Partial<VariantData>): Map<string, string[]> {
  const standardCategories = ['blitz', 'lightning', 'untimed', 'standard', 'nonstandard', 'crazyhouse', 'bughouse'];
  if(!standardCategories.includes(category))
    return variantToDests(fen, startFen, category, variantData);

  const dests = new Map();
  const chess = new Chess(fen);
  chess.SQUARES.forEach(s => {
    const ms = chess.moves({square: s, verbose: true});
    if(ms.length)
      dests.set(s, ms.map(m => m.to));
  });

  return dests;
}

function variantToDests(fen: string, startFen: string, category: string, variantData?: Partial<VariantData>): Map<string, string[]> {
  const supportedCategories = ['crazyhouse', 'bughouse', 'losers', 'wild/fr', 'wild/0', 'wild/1', 'wild/2', 'wild/3', 'wild/4', 'wild/5', 'wild/8', 'wild/8a'];
  if(!supportedCategories.includes(category))
    return null;

  const chess = new Chess(fen);

  // In 'losers' variant, if a capture is possible then include only captures in dests
  let dests: Map<any, any>;
  if(category === 'losers') {
    dests = new Map();
    chess.SQUARES.forEach(s => {
      const ms = chess.moves({square: s, verbose: true}).filter((m) => {
        return /[ec]/.test(m.flags);
      });
      if(ms.length)
        dests.set(s, ms.map(m => m.to));
    });
  }

  if(!dests || !dests.size) {
    dests = new Map();
    chess.SQUARES.forEach(s => {
      const ms = chess.moves({square: s, verbose: true});
      if(ms.length)
        dests.set(s, ms.map(m => m.to));
    });
  }

  // Add irregular castling moves for wild variants
  const cPieces = getCastlingPieces(startFen, getTurnColorFromFEN(fen), category);
  const kingSquare = cPieces.king;
  const piece = chess.get(kingSquare);
  if(piece && piece.type === 'k' && piece.color === getTurnColorFromFEN(fen)) {
    let kingDests = dests.get(kingSquare);
    if(kingDests)
      kingDests = adjustKingDests(kingDests, fen, startFen, category);
    dests.set(kingSquare, kingDests);    
  }
  return dests;
}

/** Correct the castling dests for wild variants 
 * @dests initial array of dests for the king
 * @param fen the current position
 * @param startFen the starting position of the game.
 * @returns dests modified with correct castling dests
 * @premove are these dests for a premove or regular move (less castling validation for premove)
 */
export function adjustKingDests(dests: string[], fen: string, startFen: string, category: string, premove = false) { 
  if(category.startsWith('wild')) {
    if(!dests)
      dests = [];
    
    const cPieces = getCastlingPieces(startFen, getTurnColorFromFEN(fen), category);
    const king = cPieces.king;
    const leftRook = cPieces.leftRook;
    const rightRook = cPieces.rightRook;
  
    // Remove any castling moves already in dests
    if(dests) {
      dests.filter((dest) => {
        return Math.abs(dest.charCodeAt(0) - king.charCodeAt(0)) > 1;
      }).forEach((dest) => {
        dests.splice(dests.indexOf(dest), 1);
      });
    }

    let parsedMove = parseMove(fen, 'O-O', startFen, category, null, premove);
    if(parsedMove) {
      const to = category === 'wild/fr' ? rightRook : parsedMove.move.to;
      dests.push(to);
    }
    parsedMove = parseMove(fen, 'O-O-O', startFen, category, null, premove);
    if(parsedMove) {
      const to = category === 'wild/fr' ? leftRook : parsedMove.move.to;
      dests.push(to);
    }
  }

  if(dests && !dests.length)
    dests = null;

  return dests;
}

export function updateVariantMoveData(fen: string, move: any, prevVariantData: Partial<VariantData>, category: string): Partial<VariantData> {
  // Maintain map of captured pieces for crazyhouse variant
  const currVariantData: Partial<VariantData> = {};

  if(category === 'crazyhouse' || category === 'bughouse') {
    if(prevVariantData.holdings === undefined)
      prevVariantData.holdings = {P: 0, R: 0, B: 0, N: 0, Q: 0, K: 0, p: 0, r: 0, b: 0, n: 0, q: 0, k: 0};

    const holdings = { ...prevVariantData.holdings };

    if(category === 'crazyhouse') {
      if(prevVariantData.promoted === undefined)
        prevVariantData.promoted = [];

      let promoted = prevVariantData.promoted.slice();

      if(move.flags && move.flags.includes('c')) {
        const chess = new Chess(fen);
        const piece = chess.get(move.to);
        let pieceType = (promoted.indexOf(move.to) !== -1 ? 'p' : piece.type);
        pieceType = (piece.color === 'w' ? pieceType.toLowerCase() : pieceType.toUpperCase());
        holdings[pieceType]++;
      }
      else if(move.flags && move.flags.includes('e')) {
        const color = getTurnColorFromFEN(fen);
        const pieceType = (color === 'w' ? 'P' : 'p');
        holdings[pieceType]++;
      }

      promoted = updatePromotedList(move, promoted);
      currVariantData.promoted = promoted;
    }

    if(move.san && move.san.includes('@')) {
      const color = getTurnColorFromFEN(fen);
      const pieceType = (color === 'w' ? move.piece.toUpperCase() : move.piece.toLowerCase());
      holdings[pieceType]--;
    }

    currVariantData.holdings = holdings;
  }

  return currVariantData;
}

// Maintain a list of the locations of pieces which were promoted
// This is used by crazyhouse and bughouse variants, since capturing a promoted piece only gives you a pawn
function updatePromotedList(move: any, promoted: any) {
  // Remove captured piece
  let index = promoted.indexOf(move.to);
  if(index !== -1)
    promoted.splice(index, 1);
  // Update piece's location
  if(move.from) {
    index = promoted.indexOf(move.from);
    if(index !== -1)
      promoted[index] = move.to;
  }
  // Add newly promoted piece to the list
  if(move.promotion)
    promoted.push(move.to);

  return promoted;
}

/**
 * Split a FEN into its component parts
 */
export function splitFEN(fen: string) {
  const words = fen.split(/\s+/);
  return {
    board: words[0],
    color: words[1],
    castlingRights: words[2],
    enPassant: words[3],
    plyClock: words[4],
    moveNo: words[5]
  };
}

/**
 * Create a FEN from an object containing its component parts
 */
export function joinFEN(obj: any): string {
  return Object.keys(obj).map(key => obj[key]).join(' ');
}

export function getPlyFromFEN(fen: string): number {
  const turnColor = fen.split(/\s+/)[1];
  const moveNo = +fen.split(/\s+/).pop();
  const ply = moveNo * 2 - (turnColor === 'w' ? 1 : 0);

  return ply;
}

export function getMoveNoFromFEN(fen: string): number {
  return +fen.split(/\s+/).pop();
}

export function getTurnColorFromFEN(fen: string): string {
  return fen.split(/\s+/)[1];
}

export function setFENTurnColor(fen: string, color: string): string {
  return fen.replace(` ${getTurnColorFromFEN(fen)} `, ` ${color} `);
}

export function longToShortPieceName(longName: string): string {
  const names = {pawn: 'p', rook: 'r', knight: 'n', bishop: 'b', queen: 'q', king: 'k'};
  return names[longName];
}

export function shortToLongPieceName(shortName: string): string {
  const names = {p: 'pawn', r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king'};
  return names[shortName];
}

/**
 * Checks if a fen is in a valid format and represents a valid position.
 * @returns null if fen is valid, otherwise an error string
 */
export function validateFEN(fen: string, category?: string): string {
  const chess = new Chess(fen);
  if(!chess)
    return 'Invalid FEN format.';

  const fenWords = splitFEN(fen);
  const color = fenWords.color;
  const board = fenWords.board;
  const castlingRights = fenWords.castlingRights;

  const oppositeColor = color === 'w' ? 'b' : 'w';
  const tempFen = fen.replace(` ${color} `, ` ${oppositeColor} `);
  chess.load(tempFen);
  if(chess.in_check()) {
    if(color === 'w')
      return 'White\'s turn but black is in check.';
    else
      return 'Black\'s turn but white is in check.';
  }
  chess.load(fen);

  if(!board.includes('K') || !board.includes('k'))
    return 'Missing king.';

  if(/(K.*K|k.*k)/.test(board))
    return 'Too many kings.';

  const match = board.match(/(\w+)(?:\/\w+){6}\/(\w+)/);
  const rank8 = match[1];
  const rank1 = match[2];
  if(/[pP]/.test(rank1) || /[pP]/.test(rank8))
    return 'Pawn on 1st or 8th rank.';

  // Check castling rights
  if(castlingRights.includes('K') || castlingRights.includes('Q')) {
    const castlingPieces = getCastlingPieces(fen, 'w', category);
    if(!castlingPieces.king
        || (!castlingPieces.leftRook && castlingRights.includes('Q'))
        || (!castlingPieces.rightRook && castlingRights.includes('K')))
      return 'White\'s king or rooks aren\'t in valid locations for castling.';
  }
  if(castlingRights.includes('k') || castlingRights.includes('q')) {
    const castlingPieces = getCastlingPieces(fen, 'b', category);
    if(!castlingPieces.king
        || (!castlingPieces.leftRook && castlingRights.includes('q'))
        || (!castlingPieces.rightRook && castlingRights.includes('k')))
      return 'Black\'s king or rooks aren\'t in valid locations for castling.';
  }

  return null;
}

/**
 * Gets the positions of the 'castle-able' kings and rooks from the starting position for the given color.
 * @param fen starting position
 * @param color 'w' or 'b'
 * @returns An object in the form { king: '<square>', leftRook: '<square>', rightRook: '<square>' }
 */
export function getCastlingPieces(fen: string, color: string, category?: string): { [key: string]: string } {
  const chess = new Chess(fen);

  const oppositeColor = (color === 'w' ? 'b' : 'w');
  const rank = (color === 'w' ? '1' : '8');
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  let leftRook = '';
  let rightRook = '';
  let king = '';
  for(const file of files) {
    const square = `${file}${rank}`;
    const p = chess.get(square);
    if(p && p.type === 'r' && p.color === color) { // Get starting location of rooks
      if(category === 'wild/fr') {
        // Note in weird cases where the starting position has more than 2 rooks on the back row
        // We try to guess which are the real castling rooks. If a rook has an opposite coloured rook in
        // the equivalent position on the other side of the board, then it's more likely to be a genuine
        // castling rook. Otherwise we use the rook which is closest to the king on either side.
        let hasOppositeRook = false;
        let oppositeLeftRookFound = false;
        let oppositeRightRookFound = false;
        const opSquare = `${file}${rank === '1' ? '8' : '1'}`;
        const opP = chess.get(opSquare);
        if(opP && opP.type === 'r' && p.color === oppositeColor)
          hasOppositeRook = true;

        if(!king && (hasOppositeRook || !oppositeLeftRookFound)) {
          leftRook = square;
          if(hasOppositeRook)
            oppositeLeftRookFound = true;
        }
        else if(!rightRook || (hasOppositeRook && !oppositeRightRookFound)) {
          rightRook = square;
          if(hasOppositeRook)
            oppositeRightRookFound = true;
        }
      }
      else {
        if(file === 'a')
          leftRook = square;
        else if(file === 'h')
          rightRook = square;
      }
    }
    else if(p && p.type === 'k' && p.color === color) { // Get starting location of king
      if(category === 'wild/fr'
          || (category === 'wild/0' && ((color === 'w' && file === 'e') || (color === 'b' && file === 'd')))
          || (category === 'wild/1' && (file === 'd' || file === 'e'))
          || file === 'e')
        king = square;
    }
  }

  return {king, leftRook, rightRook};
}

/**
 * Determines if castling rights need to be removed for a given fen, based on
 * the initial positions of the kings and rooks from the starting position. I.e. If the king or
 * rooks are no longer in their starting positions.
 * @param fen the fen being inspected
 * @param startFen the starting position of the game.
 * @returns the fen with some castling rights possibly removed
 */
export function adjustCastlingRights(fen: string, startFen: string, category?: string): string {
  const fenWords = splitFEN(fen);
  let castlingRights = fenWords.castlingRights;
  const chess = new Chess(fen);
  if(!chess)
    return fen;

  let cp = getCastlingPieces(startFen, 'w', category); // Gets the initial locations of the 'castle-able' king and rooks
  if(cp.king) {
    const piece = chess.get(cp.king);
    if(!piece || piece.type !== 'k' || piece.color !== 'w')
      castlingRights = castlingRights.replace(/[KQ]/g, '');
  }
  if(cp.leftRook) {
    const piece = chess.get(cp.leftRook);
    if(!piece || piece.type !== 'r' || piece.color !== 'w')
      castlingRights = castlingRights.replace('Q', '');
  }
  if(cp.rightRook) {
    const piece = chess.get(cp.rightRook);
    if(!piece || piece.type !== 'r' || piece.color !== 'w')
      castlingRights = castlingRights.replace('K', '');
  }

  cp = getCastlingPieces(startFen, 'b', category);
  if(cp.king) {
    const piece = chess.get(cp.king);
    if(!piece || piece.type !== 'k' || piece.color !== 'b')
      castlingRights = castlingRights.replace(/[kq]/g, '');
  }
  if(cp.leftRook) {
    const piece = chess.get(cp.leftRook);
    if(!piece || piece.type !== 'r' || piece.color !== 'b')
      castlingRights = castlingRights.replace('q', '');
  }
  if(cp.rightRook) {
    const piece = chess.get(cp.rightRook);
    if(!piece || piece.type !== 'r' || piece.color !== 'b')
      castlingRights = castlingRights.replace('k', '');
  }

  if(!castlingRights)
    castlingRights = '-';

  fenWords.castlingRights = castlingRights;
  return joinFEN(fenWords);
}

export function swapColor(color: string): string {
  return (color === 'w') ? 'b' : 'w';
}

export function inCheck(san: string) {
  return (san.slice(-1) === '+');
}

// Check if square is under attack. We can remove this after upgrading to latest version of chess.js,
// since it has its own version of the function
export function isAttacked(fen: string, square: string, color: string) : boolean {
  const oppositeColor = color === 'w' ? 'b' : 'w';

  // Switch to the right turn
  if(getTurnColorFromFEN(fen) !== color)
    fen = fen.replace(` ${oppositeColor} `, ` ${color} `);

  const chess = new Chess(fen);

  // Find king and replace it with a placeholder pawn
  for(const s of chess.SQUARES) {
    const piece = chess.get(s);
    if(piece && piece.type === 'k' && piece.color === color) {
      chess.remove(s);
      chess.put({type: 'p', color}, s);
      break;
    }
  }

  // Place king on square we want to test and see if it's in check
  chess.remove(square);
  chess.put({type: 'k', color}, square);
  return chess.in_check() ? true : false;
}

// Helper function which returns an array of square coordinates which are adjacent (including diagonally) to the given square
export function getAdjacentSquares(square: string) : string[] {
  const adjacent = [];
  const file = square[0];
  const rank = square[1];
  if(rank !== '1')
    adjacent.push(`${file}${+rank - 1}`);
  if(rank !== '8')
    adjacent.push(`${file}${+rank + 1}`);
  if(file !== 'a') {
    const prevFile = String.fromCharCode(file.charCodeAt(0) - 1);
    adjacent.push(`${prevFile}${rank}`);
    if(rank !== '1')
      adjacent.push(`${prevFile}${+rank - 1}`);
    if(rank !== '8')
      adjacent.push(`${prevFile}${+rank + 1}`);
  }
  if(file !== 'h') {
    const nextFile = String.fromCharCode(file.charCodeAt(0) + 1);
    adjacent.push(`${nextFile}${rank}`);
    if(rank !== '1')
      adjacent.push(`${nextFile}${+rank - 1}`);
    if(rank !== '8')
      adjacent.push(`${nextFile}${+rank + 1}`);
  }
  return adjacent;
}

/** 
 * Basic check to see if a piece can reach the dest square from the source on
 * an empty board.
 * @param includeCastling if true the king can reach any back row square from any other square on the same row.
 * This is to account for all kinds of castling such as fischer random etc. If false, dest square must be 
 * adjacent to source square.
 */
export function isReachable(source: string, dest: string, pieceType: string, pieceColor: string, includeCastling = true): boolean {
  const sCol = source.charCodeAt(0) - 'a'.charCodeAt(0) + 1; 
  const sRow = +source[1];
  const dCol = dest.charCodeAt(0) - 'a'.charCodeAt(0) + 1; 
  const dRow = +dest[1];

  switch(pieceType) {
    case 'r': 
      return sRow === dRow || sCol === dCol;
    case 'q': 
      return sRow === dRow || sCol === dCol || Math.abs(sRow - dRow) === Math.abs(sCol - dCol);
    case 'b':
      return Math.abs(sRow - dRow) === Math.abs(sCol - dCol);
    case 'n':
      return (Math.abs(sRow - dRow) === 2 && Math.abs(sCol - dCol) === 1)
        || (Math.abs(sRow - dRow) === 1 && Math.abs(sCol - dCol) === 2);
    case 'p': 
      return (((pieceColor === 'w' && dRow - sRow === 1) || (pieceColor === 'b' && sRow - dRow === 1))
          && (dCol === sCol || Math.abs(dCol - sCol) === 1))
        || (dCol === sCol && ((pieceColor === 'w' && sRow === 2 && dRow === 4) || (pieceColor === 'b' && sRow === 7 && dRow === 5)));
    case 'k': 
      return (Math.abs(sCol - dCol) <= 1 && Math.abs(sRow - dRow) <= 1)
        || (includeCastling && ((pieceColor === 'w' && sRow === 1 && dRow === 1)
        || (pieceColor === 'b' && sRow === 8 && dRow === 8)));
  }

  return false;
}

export function generateChess960FEN(idn?: number): string {
  // Generate random Chess960 starting position using Scharnagl's method.

  const kingsTable = {
    0: 'QNNRKR',   192: 'QNRKNR',   384: 'QRNNKR',   576: 'QRNKRN',   768: 'QRKNRN',
    16: 'NQNRKR',   208: 'NQRKNR',   400: 'RQNNKR',   592: 'RQNKRN',   784: 'RQKNRN',
    32: 'NNQRKR',   224: 'NRQKNR',   416: 'RNQNKR',   608: 'RNQKRN',   800: 'RKQNRN',
    48: 'NNRQKR',   240: 'NRKQNR',   432: 'RNNQKR',   624: 'RNKQRN',   816: 'RKNQRN',
    64: 'NNRKQR',   256: 'NRKNQR',   448: 'RNNKQR',   640: 'RNKRQN',   832: 'RKNRQN',
    80: 'NNRKRQ',   272: 'NRKNRQ',   464: 'RNNKRQ',   656: 'RNKRNQ',   848: 'RKNRNQ',
    96: 'QNRNKR',   288: 'QNRKRN',   480: 'QRNKNR',   672: 'QRKNNR',   864: 'QRKRNN',
    112: 'NQRNKR',  304: 'NQRKRN',  496: 'RQNKNR',   688: 'RQKNNR',   880: 'RQKRNN',
    128: 'NRQNKR',  320: 'NRQKRN',  512: 'RNQKNR',   704: 'RKQNNR',   896: 'RKQRNN',
    144: 'NRNQKR',  336: 'NRKQRN',  528: 'RNKQNR',   720: 'RKNQNR',   912: 'RKRQNN',
    160: 'NRNKQR',  352: 'NRKRQN',  544: 'RNKNQR',   736: 'RKNNQR',   928: 'RKRNQN',
    176: 'NRNKRQ',  368: 'NRKRNQ',  560: 'RNKNRQ',   752: 'RKNNRQ',   944: 'RKRNNQ'
  };

  const bishopsTable = [
    ['B', 'B', '-', '-', '-', '-', '-', '-'],
    ['B', '-', '-', 'B', '-', '-', '-', '-'],
    ['B', '-', '-', '-', '-', 'B', '-', '-'],
    ['B', '-', '-', '-', '-', '-', '-', 'B'],
    ['-', 'B', 'B', '-', '-', '-', '-', '-'],
    ['-', '-', 'B', 'B', '-', '-', '-', '-'],
    ['-', '-', 'B', '-', '-', 'B', '-', '-'],
    ['-', '-', 'B', '-', '-', '-', '-', 'B'],
    ['-', 'B', '-', '-', 'B', '-', '-', '-'],
    ['-', '-', '-', 'B', 'B', '-', '-', '-'],
    ['-', '-', '-', '-', 'B', 'B', '-', '-'],
    ['-', '-', '-', '-', 'B', '-', '-', 'B'],
    ['-', 'B', '-', '-', '-', '-', 'B', '-'],
    ['-', '-', '-', 'B', '-', '-', 'B', '-'],
    ['-', '-', '-', '-', '-', 'B', 'B', '-'],
    ['-', '-', '-', '-', '-', '-', 'B', 'B']
  ];

  if(!(idn >= 0 && idn <= 959))
    idn = Math.floor(Math.random() * 960); // Get random Chess960 starting position identification number
  const kIndex = idn - idn % 16; // Index into King's Table
  const bIndex = idn - kIndex; // Index into Bishop's Table
  const kEntry = kingsTable[kIndex];

  // Fill in empty spots in the row from Bishop's Table with pieces from the row in King's Table
  const backRow = [...bishopsTable[bIndex]]; // Copy row from array
  let p = 0;
  for(let sq = 0; sq < 8; sq++) {
    if(backRow[sq] === '-') {
      backRow[sq] = kEntry[p];
      p++;
    }
  }

  const whiteBackRow = backRow.join('');
  const blackBackRow = whiteBackRow.toLowerCase();
  const fen = `${blackBackRow}/pppppppp/8/8/8/8/PPPPPPPP/${whiteBackRow} w KQkq - 0 1`;

  return fen;
}

/**
 * Returns move as a string in coordinate form (e.g a1-d4)
 */
export function moveToCoordinateString(move: any): string {
  let moveStr = '';
  if(move.san && move.san.startsWith('O-O')) // support for variants
    moveStr = move.san;
  else if(!move.from)
    moveStr = `${move.piece}@${move.to}`; // add piece in crazyhouse or bsetup mode
  else if(!move.to)
    moveStr = `x${move.from}`; // remove piece in bsetup mode
  else
    moveStr = `${move.from}-${move.to}${move.promotion ? '=' + move.promotion : ''}`;

  return moveStr;
}

/**
 * Given a board element's bounding rect, returns a given square's rect
 * @param boardRect The board element's bounding rect
 * @param the square coordinates, e.g "e4"
 * @param orientation the way the board is facing, "w" or "b"
 * @returns the square's bounding rect 
 */
export function getSquareRect(boardRect: DOMRect, square: string, orientation: string): DOMRect {
  const file = square.charAt(0).toLowerCase();
  const rank = square.charAt(1);
  const colIndex = orientation === 'w' ? file.charCodeAt(0) - 'a'.charCodeAt(0) : 7 - (file.charCodeAt(0) - 'a'.charCodeAt(0));
  const rowIndex = orientation === 'w' ? 8 - parseInt(rank, 10) : parseInt(rank, 10) - 1;
  const squareSize = boardRect.width / 8;
  const top = boardRect.top + squareSize * rowIndex;
  const left = boardRect.left + squareSize * colIndex;
  return new DOMRect(left, top, squareSize, squareSize);
}