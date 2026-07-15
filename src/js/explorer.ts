// Copyright 2023 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { INDEXED_DB_NAME, INDEXED_DB_VERSION } from './settings';

interface ExplorerMetadata {
  revision: bigint;
  formatVersion: number;
}

class Explorer {
  private abortDownload: AbortController;

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
    srcOffset += 4;

    if(magic !== 'FCOE') {
      console.error('Not an opening explorer file.')
      return;
    }

    // 2-byte format version
    const formatVersion = srcView.getUint16(srcOffset, true);
    srcOffset += 2;

    if(formatVersion !== 1) {
      console.error('Unsupported opening explorer file format.')
      return;
    }

    // 8-byte revision number
    const revision = srcView.getBigUint64(srcOffset, true);
    srcOffset += 8;

    // 4-byte Number of entries
    const numEntries = srcView.getUint32(srcOffset, true);
    srcOffset += 4;

    const totalHashSizes = numEntries * 12;
    const indexSize = numEntries * 16;
    const indexBuffer = new ArrayBuffer(indexSize);
    const indexBytes = new Uint8Array(indexBuffer);
    const indexView = new DataView(indexBuffer);
    let indexOffset = 0;

    const headerSize = srcOffset;
    const dstBuffer = new ArrayBuffer(srcBytes.length - totalHashSizes - headerSize);
    const dstBytes = new Uint8Array(dstBuffer);
    const dstView = new DataView(dstBuffer);
    let dstOffset = 0;

    console.log('num entries:', numEntries);
    console.log('index length:', indexBytes.length);
    console.log('src length:', srcBytes.length);
    console.log('dst length:', dstBytes.length);

    for(let entry = 0; entry < numEntries; entry++) {
      indexBytes.set(srcBytes.subarray(srcOffset, srcOffset + 12), indexOffset);
      srcOffset += 12;
      indexOffset += 12;

      indexView.setUint32(indexOffset, dstOffset, true);
      indexOffset += 4;

      const numMoves = srcView.getUint8(srcOffset);
      dstView.setUint8(dstOffset, numMoves);
      srcOffset += 1;
      dstOffset += 1;

      for(let move = 0; move < numMoves; move++) {
        dstBytes.set(srcBytes.subarray(srcOffset, srcOffset + 2), dstOffset);
        srcOffset += 2;
        dstOffset += 2;

        const statsSize = this.getStatsSize(srcBytes, srcOffset);
        if(dstOffset + statsSize > dstBytes.length) {
          console.log('entry #:', entry);
        }

        dstBytes.set(srcBytes.subarray(srcOffset, srcOffset + statsSize), dstOffset);
        srcOffset += statsSize;
        dstOffset += statsSize;      
      }
    }

    this.save('masters', { revision, formatVersion }, indexBuffer, dstBuffer);
  }

  private save(databaseName: string, metadata: ExplorerMetadata, indexBuffer: ArrayBuffer, dataBuffer: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains("explorer")) {
          db.createObjectStore("explorer");
        }
      };

      request.onsuccess = () => {
        const db = request.result;

        const tx = db.transaction("explorer", "readwrite");
        const store = tx.objectStore("explorer");

        store.put(
          metadata,
          `${databaseName}:metadata`
        );

        store.put(
          new Blob([indexBuffer]),
          `${databaseName}:index`
        );

        store.put(
          new Blob([dataBuffer]),
          `${databaseName}:data`
        );

        tx.oncomplete = () => {
          db.close();
          resolve();
        };

        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
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