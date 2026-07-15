// Copyright 2023 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { idbStorage } from './storage';

interface ExplorerDatabase {
  metadata: ExplorerMetadata;
  index: ArrayBuffer;
  data: ArrayBuffer;
}

interface ExplorerMetadata {
  revision: bigint;
  formatVersion: number;
}

class Explorer {
  private database: ExplorerDatabase;
  private abortDownload: AbortController;
  private readonly MAGIC_NUMBER = 'FCOE';
  private readonly MAGIC_NUMBER_SIZE = 4;
  private readonly FORMAT_VERSION_SIZE = 2;
  private readonly REVISION_NUMBER_SIZE = 8;
  private readonly NUM_ENTRIES_SIZE = 4;
  private readonly HASH_SIZE = 12;
  private readonly OFFSET_SIZE = 4;
  private readonly INDEX_ENTRY_SIZE = this.HASH_SIZE + this.OFFSET_SIZE;
  private readonly NUM_MOVES_SIZE = 1;
  private readonly MOVE_UCI_SIZE = 2;
  
  public async download() {
    const url = 'assets/data/masters.oe';
    this.abortDownload = new AbortController();
    const signal = this.abortDownload.signal;
    const srcBuffer = await (await fetch(url, { signal })).arrayBuffer();
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

    const totalHashSizes = numEntries * this.HASH_SIZE;
    const indexSize = numEntries * this.INDEX_ENTRY_SIZE;
    const indexBuffer = new ArrayBuffer(indexSize);
    const indexBytes = new Uint8Array(indexBuffer);
    const indexView = new DataView(indexBuffer);
    let indexOffset = 0;

    const headerSize = srcOffset;
    const dstBuffer = new ArrayBuffer(srcBytes.length - totalHashSizes - headerSize);
    const dstBytes = new Uint8Array(dstBuffer);
    const dstView = new DataView(dstBuffer);
    let dstOffset = 0;

    for(let entry = 0; entry < numEntries; entry++) {
      indexBytes.set(srcBytes.subarray(srcOffset, srcOffset + this.HASH_SIZE), indexOffset);
      srcOffset += this.HASH_SIZE;
      indexOffset += this.HASH_SIZE;

      indexView.setUint32(indexOffset, dstOffset, true);
      indexOffset += this.OFFSET_SIZE;

      const numMoves = srcView.getUint8(srcOffset);
      dstView.setUint8(dstOffset, numMoves);
      srcOffset += this.NUM_MOVES_SIZE;
      dstOffset += this.NUM_MOVES_SIZE;

      for(let move = 0; move < numMoves; move++) {
        dstBytes.set(srcBytes.subarray(srcOffset, srcOffset + this.MOVE_UCI_SIZE), dstOffset);
        srcOffset += this.MOVE_UCI_SIZE;
        dstOffset += this.MOVE_UCI_SIZE;

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

  public findPosition(fen: string) {
    const hash = someFunc(fen);    
    this.findEntryByHash(hash);
  }

  private findEntryByHash(hash: Uint8Array): number | undefined {
    const indexBuffer = this.database.index;
    const view = new DataView(indexBuffer);
    const numEntries = indexBuffer.byteLength / this.INDEX_ENTRY_SIZE;

    let low = 0;
    let high = numEntries - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const entryOffset = mid * this.INDEX_ENTRY_SIZE;

      let cmp = 0;

      // Compare hash
      for(let i = 0; i < this.HASH_SIZE; i++) {
        const a = view.getUint8(entryOffset + i);
        const b = hash[i];

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
        // Hash found, read the data offset
        return view.getUint32(
          entryOffset + this.HASH_SIZE,
          true
        );
      }

      if (cmp < 0) 
        low = mid + 1;
      else 
        high = mid - 1;
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
      value |= (b & 127) << shift;
      if ((b & 128) === 0) {
        break;
      }
      shift += 7;
    }

    return { value, offset };
  }

  public writeUint(bytes: Uint8Array, offset: number, n: number): number {
    while (n > 127) {
      bytes[offset++] = (n & 127) | 128;
      n >>= 7;
    }

    bytes[offset++] = n;
    return offset;
  }

  private getStatsSize(bytes: Uint8Array, offset: number): number {
    const startOffset = offset;

    // rating_sum
    offset = this.readUint(bytes, offset).offset;

    // first stats value (compressed cases)
    const first = this.readUint(bytes, offset);
    offset = first.offset;

    if (first.value <= 2) {
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
}

export let explorer: Explorer;
export function createExplorer() {
  explorer = new Explorer();
}

export default Explorer;