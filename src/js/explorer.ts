// Copyright 2023 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { idbStorage } from './storage';
import { zobrist128 } from './zobrist';
import { parseMove } from './chess-helper';

interface ExplorerDatabase {
  metadata: ExplorerMetadata;
  index: ArrayBuffer;
  data: ArrayBuffer;
}

interface ExplorerMetadata {
  magicNumber: string,
  formatVersion: number,
  revisionNumber: bigint,
  numEntries: number,
  baseYear: number,
}

interface ExplorerStats {
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
  lastYear: number,
  stats: ExplorerStats
}

class Explorer {
  private database: ExplorerDatabase;
  private abortDownload: AbortController;
  private initPromise?: Promise<void>;
  private _ready: boolean = false;
  private readonly MAGIC_NUMBER = 'FCOE';
  private readonly MAGIC_NUMBER_SIZE = 4;
  private readonly FORMAT_VERSION_SIZE = 2;
  private readonly REVISION_NUMBER_SIZE = 8;
  private readonly NUM_ENTRIES_SIZE = 4;
  private readonly BASE_YEAR_SIZE = 2;
  private readonly HEADER_SIZE = this.MAGIC_NUMBER_SIZE + this.FORMAT_VERSION_SIZE + this.REVISION_NUMBER_SIZE + this.NUM_ENTRIES_SIZE + this.BASE_YEAR_SIZE;
  private readonly KEY_SIZE = 8;
  private readonly OFFSET_SIZE = 4;
  private readonly INDEX_ENTRY_SIZE = this.KEY_SIZE + this.OFFSET_SIZE;
  private readonly NUM_MOVES_SIZE = 1;
  private readonly UCI_MOVE_SIZE = 2;
  
  public ready(): boolean {
    return this._ready;
  }

  public async init(): Promise<void> {
    if(this.initPromise)
      return this.initPromise;
    
    let fileBuffer: ArrayBuffer | undefined;

    this.initPromise = (async () => {
      const url = 'assets/data/masters.oe';

      const oldMetadata = await this.loadMetadata('masters');
      if(oldMetadata) {
        const newMetadata = await this.fetchHeader(`${url}.00`);

        if(oldMetadata.revisionNumber === newMetadata.revisionNumber) {
          this.database = await this.load('masters');
          this._ready = true;
          return;
        }
      }

      this.database = await this.fetchData([
        `${url}.00`,
        `${url}.01`,
        `${url}.02`,
        `${url}.03`
      ]);

      this._ready = true;
    })().catch(err => {
      this.initPromise = null;
      throw err;
    });

    return this.initPromise;
  }

  private async fetchHeader(url: string): Promise<ExplorerMetadata> {
    const response = await fetch(url, {
      headers: {
        Range: `bytes=0-${this.HEADER_SIZE - 1}`
      },
    });
    if(!response.ok)
      throw new Error(`Failed to load metadata from ${url}`);

    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while(total < this.HEADER_SIZE) {
      const { done, value } = await reader.read();
      if(done) break;

      chunks.push(value);
      total += value.length;
    }
    await reader.cancel();

    const header = new Uint8Array(total);
    let offset = 0;

    for(const chunk of chunks) {
      header.set(chunk, offset);
      offset += chunk.length;
    }

    const result = this.readHeader(header);
    if(!result)
      throw new Error(`Invalid opening explorer file: ${url}`);

    return result.value;
  }

  private readHeader(srcBytes: Uint8Array, offset = 0): { value: ExplorerMetadata, offset: number } | undefined {
    const srcView = new DataView(srcBytes.buffer);

    // 4-byte magic number
    const magicBytes = srcBytes.subarray(offset, offset + this.MAGIC_NUMBER_SIZE);
    const magicNumber = String.fromCharCode(...magicBytes);
    offset += this.MAGIC_NUMBER_SIZE;

    if(magicNumber !== this.MAGIC_NUMBER) {
      console.error('Not an opening explorer file.')
      return;
    }

    // 2-byte format version
    const formatVersion = srcView.getUint16(offset, true);
    offset += this.FORMAT_VERSION_SIZE;

    if(formatVersion !== 1) {
      console.error('Unsupported opening explorer file format.')
      return;
    }

    // 8-byte revision number
    const revisionNumber = srcView.getBigUint64(offset, true);
    offset += this.REVISION_NUMBER_SIZE;

    // 4-byte Number of entries
    const numEntries = srcView.getUint32(offset, true);
    offset += this.NUM_ENTRIES_SIZE;

    // 2-byte base year
    const baseYear = srcView.getUint16(offset, true);
    offset += this.BASE_YEAR_SIZE;

    const value = {
      magicNumber,
      formatVersion,
      revisionNumber,
      numEntries,
      baseYear
    };

    return { value, offset }; 
  }

  private async fetchData(urls: string[]): Promise<ExplorerDatabase> {
    this.abortDownload = new AbortController();

    try {
      const parts = await Promise.all(
        urls.map(url =>
          fetch(url, { signal: this.abortDownload!.signal })
            .then(r => {
              if(!r.ok) {
                throw new Error(`Failed to fetch ${url}: ${r.status}`);
              }
              return r.arrayBuffer();
            })
        )
      );

      const totalSize = parts.reduce((sum, part) => sum + part.byteLength, 0);

      const merged = new Uint8Array(totalSize);

      let offset = 0;
      for(const part of parts) {
        merged.set(new Uint8Array(part), offset);
        offset += part.byteLength;
      }
      parts.length = null;

      return this.index(merged.buffer);
    } catch (e) {
      this.abortDownload.abort();
      throw e;
    }
  }

  private index(srcBuffer: ArrayBuffer): ExplorerDatabase | undefined {
    const srcBytes = new Uint8Array(srcBuffer);
    const srcView = new DataView(srcBuffer);

    let srcOffset = 0;

    const result = this.readHeader(srcBytes, srcOffset);
    if(!result)
      return;

    const headerSize = srcOffset = result.offset;
    const header = result.value;

    const numEntries = header.numEntries;
    const totalKeySizes = numEntries * this.KEY_SIZE;
    const indexSize = numEntries * this.INDEX_ENTRY_SIZE;
    const indexBuffer = new ArrayBuffer(indexSize);
    const indexBytes = new Uint8Array(indexBuffer);
    const indexView = new DataView(indexBuffer);
    let indexOffset = 0;

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

        const lastYearSize = this.readUint(srcBytes, srcOffset).offset - srcOffset;
        dstBytes.set(srcBytes.subarray(srcOffset, srcOffset + lastYearSize), dstOffset);
        srcOffset += lastYearSize;
        dstOffset += lastYearSize;

        const statsSize = this.getStatsSize(srcBytes, srcOffset);
        dstBytes.set(srcBytes.subarray(srcOffset, srcOffset + statsSize), dstOffset);
        srcOffset += statsSize;
        dstOffset += statsSize;      
      }
    }

    this.save('masters', header, indexBuffer, dstBuffer);
    return { metadata: header, index: indexBuffer, data: dstBuffer }
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
    if(!moves)
      return;

    for(let moveEntry of moves) {
      const { move } = parseMove(fen, moveEntry.move, 'explorer');
      if(!move) 
        return; 

      moveEntry.move = move;
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

    while(low <= high) {
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
      return this.readMoves(new Uint8Array(this.database.data), offset, this.database.metadata.baseYear).value;
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

  private async loadMetadata(databaseName: string): Promise<ExplorerMetadata> {
    try {
      return idbStorage.get<ExplorerMetadata>(
        'explorer',
        `${databaseName}:metadata`
      );
    }
    catch {
      return undefined;
    }
  }

  private readUint(bytes: Uint8Array, offset: number): { value: number; offset: number } {
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

    // first stats value (compressed cases)
    const first = this.readUint(bytes, offset);
    offset = first.offset;

    if(first.value <= 5) {
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
    let value = null;
    let white = 0, black = 0, draws = 0;

    // first stats value (compressed cases)
    ({ value, offset } = this.readUint(bytes, offset));
    const first = value;

    if(first <= 5) {
      const special = [
        [2, 0, 0],
        [0, 2, 0],
        [0, 0, 2],
        [1, 1, 0],
        [1, 0, 1],
        [0, 1, 1],
      ];
      
      [white, draws, black] = special[first];
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

    return { 
      value: { total, white, draws, black },
      offset  
    }
  }

  private readLastYear(dataBytes: Uint8Array, offset: number, baseYear: number): { value: number, offset: number } {
    let value: number;
    ({ value, offset } = this.readUint(dataBytes, offset));
    return { value: baseYear - value, offset };
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

  private readMoves(dataBytes: Uint8Array, offset: number, baseYear: number): { value: ExplorerMove[], offset: number } {
    const dataView = new DataView(dataBytes.buffer);

    const numMoves = dataView.getUint8(offset);
    offset += this.NUM_MOVES_SIZE;

    const moves: ExplorerMove[] = [];
    for(let i = 0; i < numMoves; i++) {
      let value = null;

      ({ value, offset} = this.readUCIMove(dataBytes, offset));
      const move = value;

      ({ value, offset} = this.readLastYear(dataBytes, offset, baseYear));
      const lastYear = value;

      ({ value, offset} = this.readStats(dataBytes, offset));
      const stats = value;

      moves.push({ move, lastYear, stats });
    }

    moves.sort((a, b) => b.stats.total - a.stats.total);
    return { value: moves, offset };
  }
}

export let explorer: Explorer;
export function createExplorer() {
  explorer = new Explorer();
}

export default Explorer;