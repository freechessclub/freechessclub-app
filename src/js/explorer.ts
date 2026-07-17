// Copyright 2023 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { idbStorage } from './storage';
import { zobrist128 } from './zobrist';
import Chess from 'chess.js';

interface ExplorerDatabase {
  metadata: ExplorerMetadata;
  index: ArrayBuffer;
  data: ArrayBuffer;
}

interface ExplorerMetadata {
  revision: bigint;
  formatVersion: number;
}

interface ExplorerStats {
  ratingSum: number,
  ratingAvg: number,
  total: number,
  white: number,
  draws: number,
  black: number  
}

interface ExplorerMove {
  move: {
    from?: string,
    to: string,
    piece?: string,
    promotion?: string,
    flags?: string,
    san?: string,
  },
  stats: ExplorerStats
}

class Explorer {
  private database: ExplorerDatabase;
  private abortDownload: AbortController;
  private initPromise?: Promise<void>;
  private readonly MAGIC_NUMBER = 'FCOE';
  private readonly MAGIC_NUMBER_SIZE = 4;
  private readonly FORMAT_VERSION_SIZE = 2;
  private readonly REVISION_NUMBER_SIZE = 8;
  private readonly NUM_ENTRIES_SIZE = 4;
  private readonly KEY_SIZE = 12;
  private readonly OFFSET_SIZE = 4;
  private readonly INDEX_ENTRY_SIZE = this.KEY_SIZE + this.OFFSET_SIZE;
  private readonly NUM_MOVES_SIZE = 1;
  private readonly UCI_MOVE_SIZE = 2;
  
  public async init(): Promise<void> {
    if(this.initPromise) 
      return this.initPromise;

    this.initPromise = (async () => {
      const url = 'assets/data/masters.oe';
      this.abortDownload = new AbortController();
      const signal = this.abortDownload.signal;
      const srcBuffer = await (await fetch(url, { signal })).arrayBuffer();
      this.index(srcBuffer);
    })();

    return this.initPromise;
  }

  private index(srcBuffer: ArrayBuffer) {
    const srcBytes = new Uint8Array(srcBuffer);
    const srcView = new DataView(srcBuffer);

    let srcOffset = 0;

    // 4-byte magic number
    const magicBytes = new Uint8Array(srcBuffer, srcOffset, 4);
    const magic = String.fromCharCode(...magicBytes);
    srcOffset += this.MAGIC_NUMBER_SIZE;

    if(magic !== this.MAGIC_NUMBER) {
      console.error('Not an opening explorer file.')
      return;
    }

    // 2-byte format version
    const formatVersion = srcView.getUint16(srcOffset, true);
    srcOffset += this.FORMAT_VERSION_SIZE;

    if(formatVersion !== 1) {
      console.error('Unsupported opening explorer file format.')
      return;
    }

    // 8-byte revision number
    const revision = srcView.getBigUint64(srcOffset, true);
    srcOffset += this.REVISION_NUMBER_SIZE;

    // 4-byte Number of entries
    const numEntries = srcView.getUint32(srcOffset, true);
    srcOffset += this.NUM_ENTRIES_SIZE;

    const totalKeySizes = numEntries * this.KEY_SIZE;
    const indexSize = numEntries * this.INDEX_ENTRY_SIZE;
    const indexBuffer = new ArrayBuffer(indexSize);
    const indexBytes = new Uint8Array(indexBuffer);
    const indexView = new DataView(indexBuffer);
    let indexOffset = 0;

    const headerSize = srcOffset;
    const dstBuffer = new ArrayBuffer(srcBytes.length - totalKeySizes - headerSize);
    const dstBytes = new Uint8Array(dstBuffer);
    const dstView = new DataView(dstBuffer);
    let dstOffset = 0;

    for(let entry = 0; entry < numEntries; entry++) {
      indexBytes.set(srcBytes.subarray(srcOffset, srcOffset + this.KEY_SIZE), indexOffset);
      srcOffset += this.KEY_SIZE;
      indexOffset += this.KEY_SIZE;

      indexView.setUint32(indexOffset, dstOffset, true);
      indexOffset += this.OFFSET_SIZE;

      const numMoves = srcView.getUint8(srcOffset);
      dstView.setUint8(dstOffset, numMoves);
      srcOffset += this.NUM_MOVES_SIZE;
      dstOffset += this.NUM_MOVES_SIZE;

      for(let move = 0; move < numMoves; move++) {
        dstBytes.set(srcBytes.subarray(srcOffset, srcOffset + this.UCI_MOVE_SIZE), dstOffset);
        srcOffset += this.UCI_MOVE_SIZE;
        dstOffset += this.UCI_MOVE_SIZE;

        const statsSize = this.getStatsSize(srcBytes, srcOffset);
        dstBytes.set(srcBytes.subarray(srcOffset, srcOffset + statsSize), dstOffset);
        srcOffset += statsSize;
        dstOffset += statsSize;      
      }
    }

    const metadata = { revision, formatVersion };
    this.save('masters', metadata, indexBuffer, dstBuffer);
    this.database = { metadata, index: indexBuffer, data: dstBuffer }
  }

  public zobristToKey(hash: bigint): Uint8Array {
    const bytes = new Uint8Array(this.KEY_SIZE);
    for (let i = 0; i < this.KEY_SIZE; i++) 
      bytes[i] = Number((hash >> BigInt(i * 8)) & 0xffn);
    
    return bytes;
  }

  public async findPosition(fen: string): Promise<ExplorerMove[] | undefined> {
    if(!this.initPromise)
      return;
    await this.initPromise;

    const key = this.zobristToKey(zobrist128(fen));    
    const moves = this.findPositionByKey(key);
    const chess = new Chess(fen);
    for(let moveEntry of moves) {
      const outMove = chess.move(moveEntry.move);
      if(outMove) {
        moveEntry.move = outMove;
        chess.undo();
      }
    }
    return moves;
  }

  private findPositionByKey(key: Uint8Array): ExplorerMove[] | undefined {
    const indexBuffer = this.database.index;
    const view = new DataView(indexBuffer);
    const numEntries = indexBuffer.byteLength / this.INDEX_ENTRY_SIZE;
    let offset = undefined;

    let low = 0;
    let high = numEntries - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const entryOffset = mid * this.INDEX_ENTRY_SIZE;

      let cmp = 0;

      // Compare key
      for(let i = 0; i < this.KEY_SIZE; i++) {
        const a = view.getUint8(entryOffset + i);
        const b = key[i];

        if (a < b) {
          cmp = -1;
          break;
        }

        if (a > b) {
          cmp = 1;
          break;
        }
      }

      if(cmp === 0) {
        // key found, read the data offset
        offset = view.getUint32(entryOffset + this.KEY_SIZE, true);
      }

      if (cmp < 0) 
        low = mid + 1;
      else 
        high = mid - 1;
    }

    if(offset != null) {
      return this.readMoves(new Uint8Array(this.database.data), offset).value;
    }

    return undefined;
  }

  private async save(databaseName: string, metadata: ExplorerMetadata, indexBuffer: ArrayBuffer, dataBuffer: ArrayBuffer): Promise<void> {
    await idbStorage.putMany('explorer', [
      [`${databaseName}:metadata`, metadata],
      [`${databaseName}:index`, new Blob([indexBuffer])],
      [`${databaseName}:data`, new Blob([dataBuffer])]
    ]); 
  }

  private async load(databaseName: string): Promise<ExplorerDatabase> {
    const [metadata, indexBlob, dataBlob] = await idbStorage.getMany<[
      ExplorerMetadata, Blob, Blob]>(
      'explorer',
      [`${databaseName}:metadata`, `${databaseName}:index`, `${databaseName}:data`]
    );

    return {
      metadata,
      index: await indexBlob.arrayBuffer(),
      data: await dataBlob.arrayBuffer()
    };
  }

  public readUint(bytes: Uint8Array, offset: number): { value: number; offset: number } {
    let value = 0;
    let shift = 0;

    while (true) {
      const b = bytes[offset++];

      value += (b & 127) * Math.pow(2, shift);

      if ((b & 128) === 0) 
          break;

      shift += 7;
    }

    return { value, offset };
  }

  private getStatsSize(bytes: Uint8Array, offset: number): number {
    const startOffset = offset;

    // rating_sum
    offset = this.readUint(bytes, offset).offset;

    // first stats value (compressed cases)
    const first = this.readUint(bytes, offset);
    offset = first.offset;

    if(first.value <= 2) {
      // white=1,draws=0,black=0
      // white=0,draws=0,black=1
      // white=0,draws=1,black=0
      return offset - startOffset;
    }

    // normal case:
    // draws
    offset = this.readUint(bytes, offset).offset;

    // black
    offset = this.readUint(bytes, offset).offset;

    return offset - startOffset;
  }

  private readStats(bytes: Uint8Array, offset: number): { value: ExplorerStats, offset: number } {
    const startOffset = offset;
    let value = null;
    let white = 0, black = 0, draws = 0;

    // rating_sum
    ({ value, offset } = this.readUint(bytes, offset));
    const ratingSum = value;

    // first stats value (compressed cases)
    ({ value, offset } = this.readUint(bytes, offset));
    const first = value;

    if(first <= 2) {
      if(first === 0)
        white = 1;
      else if(first === 1)
        black = 1;
      else if(first === 2)
        draws = 1;
    }
    else {
      // normal case:
      white = first - 3;
    
      // draws
      ({value, offset} = this.readUint(bytes, offset));
      draws = value;

      // black
      ({value, offset} = this.readUint(bytes, offset));  
      black = value;  
    }

    const total = white + draws + black;

    const ratingAvg = total ? Math.round(ratingSum / total) : undefined;

    return { 
      value: { ratingSum, ratingAvg, total, white, draws, black },
      offset  
    }
  }

  private readUCIMove(dataBytes: Uint8Array, offset: number): { value: string, offset: number } {
    const squareToString = (square: number): string => {
      const file = square & 7;
      const rank = (square >> 3) + 1;
      return String.fromCharCode(97 + file) + rank;
    }

    const pieceToString = (piece: number): string => {
      switch(piece) {
        case 0: 'p';
        case 1: 'n';
        case 2: 'b';
        case 3: 'r';
        case 4: 'q';
        case 5: 'k';
        default: return undefined;
      }
    }

    const dataView = new DataView(dataBytes.buffer);
    const packed = dataView.getUint16(offset, true);
    offset += this.UCI_MOVE_SIZE;

    const from = squareToString(packed & 63);
    const to = squareToString((packed >> 6) & 63);
    const piece = pieceToString(packed >> 12);

    let move = null;
    if(from === to) {
      move = piece !== undefined
        ? { piece, to }
        : { to };
    }
    else 
      move = {
        from,
        to,
        ...(piece !== undefined && { promotion: piece })
      };
      
    return {
      value: move,
      offset
    };
  }

  private readMoves(dataBytes: Uint8Array, offset: number): { value: ExplorerMove[], offset: number } {
    const dataView = new DataView(dataBytes.buffer);

    const numMoves = dataView.getUint8(offset);
    offset += this.NUM_MOVES_SIZE;

    const moves: ExplorerMove[] = [];
    for(let i = 0; i < numMoves; i++) {
      let value = null;

      ({ value, offset} = this.readUCIMove(dataBytes, offset));
      const move = value;

      ({ value, offset} = this.readStats(dataBytes, offset));
      const stats = value;

      moves.push({ move, stats });
    }

    return { value: moves, offset };
  }
}

export let explorer: Explorer;
export function createExplorer() {
  explorer = new Explorer();
}

export default Explorer;