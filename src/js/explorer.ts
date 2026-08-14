// Copyright 2026 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { idbStorage } from './storage';
import { zobrist128 } from './zobrist';
import { parseMove, isPromotion } from './chess-helper';
import { LichessClient } from './clients';
import { ByteReader, ByteWriter, ByteStreamReader, EndOfStreamError } from './utils';

/** Data blocks stored in indexedDB */
interface ExplorerBlock {
  blockNum: number,   // ID
  index: Uint8Array,  // Lookup table, each entry <hash><offset info data>
  data: Uint8Array,   // Position data
}

/** Metadata retrieved from the file's header */
interface ExplorerMetadata {
  magicNumber: string;        // "FCOE" for our .oe format
  formatVersion: number;      // The file format, currently version 1
  flags: number;              // Which optional fields for each entry were included in the file
  keySizeBytes: number;       // The size of the key (hash)
  revisionNumber: bigint;     // The revision number changes every time the .oe file changes. Used to check for updates
  numEntries: number;         // Number of positions
  baseYear: number;           // Basically the year the file was generated. Used to calculate the relative 'last year' field.
  includeRatingAvg: boolean;  // Whether this file includes the optional rating avg field for each move
  includeLastYear: boolean;   // Whether this file includes the optional last year field for each move
}

export interface ExplorerStats {
  ratingAvg?: number;   // The average rating of the players who played this move
  total: number;        // Total number of games
  white: number;        // Games won by white
  draws: number;        // Games drawn
  black: number;        // Games won by black
}

export interface ExplorerGame {
  id: string,
  uci?: string,
  winner?: string,
  white: {
    name: string,
    rating: string
  },
  black: {
    name: string,
    rating: string,
  },
  month?: string,
  year?: string
}

export interface ExplorerMove {
  move?: {
    from?: string,
    to: string,
    piece?: string,
    promotion?: string,
    flags?: string,
    san?: string,
  },
  lastYear?: number,
  stats: ExplorerStats,
  game?: ExplorerGame
}

export interface ExplorerPosition {
  moves: ExplorerMove[],
  games?: ExplorerGame[],
}

/**
 * Retrieves entries from an .oe (our format) opening explorer file
 */
export class Explorer {
  // To check for updates, we do a Range fetch to get the file header and check the revision number.
  // Currently doing the Range fetch from fastly because Cloudflare Range fetches are buggy.
  private metadataUrl = 'https://fastly.jsdelivr.net/gh/dhirallin/freechessclub-openingexplorer/data/masters.oe.00'; 
  // Get the whole file(s) from the regular CDN.
  private dataUrlPath = `https://cdn.jsdelivr.net/gh/dhirallin/freechessclub-openingexplorer/data/masters.oe`;
  private dataUrls: string | string[] = [`${this.dataUrlPath}.00`, `${this.dataUrlPath}.01`, `${this.dataUrlPath}.02`, `${this.dataUrlPath}.03`];    
  private explorerName = 'masters';
  private static readonly idbStorage = idbStorage;
  private metadata!: ExplorerMetadata; // metadata retrieved from the file's header
  private _abortDownload?: AbortController;
  private initPromise?: Promise<void>;
  private statusCallback?: (status: string) => void;
  private _ready: boolean = false;
  private cache = new Map<string, ExplorerPosition>(); // LRU cache for individual positions
  private readonly MAX_CACHE_SIZE = 10000;
  private readonly NUM_BUCKETS = 128; // Divide the data in indexedDB into this many data blocks for memory efficient lookup (powers of 2, max 256)
  private readonly BUCKET_BITS = Math.log2(this.NUM_BUCKETS); // Assign positions to blocks based on the first few bits of hash
  private readonly MAGIC_NUMBER = 'FCOE';
  private readonly MAGIC_NUMBER_SIZE = 4;
  private readonly FORMAT_VERSION_SIZE = 2;
  private readonly FLAGS_SIZE = 2;
  private readonly KEY_SIZE_BYTES_SIZE = 1;
  private readonly REVISION_NUMBER_SIZE = 8;
  private readonly NUM_ENTRIES_SIZE = 4;
  private readonly BASE_YEAR_SIZE = 2;
  private readonly HEADER_SIZE = this.MAGIC_NUMBER_SIZE + this.FORMAT_VERSION_SIZE + this.FLAGS_SIZE + this.KEY_SIZE_BYTES_SIZE + this.REVISION_NUMBER_SIZE + this.NUM_ENTRIES_SIZE + this.BASE_YEAR_SIZE;
  private readonly OFFSET_SIZE = 4;
  private readonly UCI_MOVE_SIZE = 2;
  private readonly FLAG_RATING_AVG = 1 << 0;
  private readonly FLAG_LAST_YEAR = 1 << 1;
  
  constructor(explorerName?: string, dataUrls?: string | string[], metadataUrl?: string) {
    if(explorerName)
      this.explorerName = explorerName;
    if(dataUrls)
      this.dataUrls = dataUrls;

    if(metadataUrl)
      this.metadataUrl = metadataUrl;

    if(!this.metadataUrl)
      this.metadataUrl = Array.isArray(this.dataUrls) ? this.dataUrls[0] : this.dataUrls;
  }

  /** Is explorer initialised */
  public ready(): boolean {
    return this._ready;
  }

  /** Fetch the opening explorer file(s), index them and store in indexedDB */
  public async init(statusCallback?: (status: string) => void): Promise<void> {
    if(this.initPromise)
      return this.initPromise;

    this.statusCallback = statusCallback;

    this.initPromise = (async () => {
      const metadata = await this.loadMetadata(this.explorerName);
      if(metadata) {
        this.metadata = metadata;
        this._ready = true;
        this.statusCallback?.('ready');

        /** Check for updates */
        this.fetchHeader(`${this.metadataUrl}`)
          .then(newMetadata => {
            if(newMetadata.revisionNumber <= this.metadata!.revisionNumber)
              return;

            this.statusCallback?.('updating');

            const oldRevision = this.metadata!.revisionNumber;

            return this.fetchData(this.dataUrls)
              .then(metadata => {
                this.metadata = metadata;
                Explorer.idbStorage.deleteByPrefix('explorer', `${this.explorerName}:${oldRevision}:`);
              });
          })
          .catch(e => {
            console.error(e);
            this.statusCallback?.('update-failed');
          });

        return;
      }

      /** 
       * Fetch opening explorer file parts 
       * Initial file was split (naively) into equal sized parts so each part is smaller than jsDelivr 
       * maximum file size (20MB). 
       */

      this.statusCallback?.('downloading');
      this.metadata = await this.fetchData(this.dataUrls);
      this._ready = true;
      this.statusCallback?.('ready');
    })().catch(err => {
      this.initPromise = undefined;
      this.statusCallback?.('download-failed');
    });

    return this.initPromise;
  }

  /**
   * Do a Range fetch of just the header from the opening explorer file.
   * This is to quickly examine the revision number and see if we need to fetch update the whole thing.
   */
  private async fetchHeader(url: string): Promise<ExplorerMetadata> {
    const response = await fetch(url, {
      headers: {
        Range: `bytes=0-${this.HEADER_SIZE - 1}`,
      },
      cache: 'no-store'
    });

    if(!response.ok)
      throw new Error(`Failed to load metadata from ${url}`);
  
    const streamReader = new ByteStreamReader([response.body!.getReader()]);
    try {
      const header = await streamReader.readBytes(this.HEADER_SIZE);
      const metadata = this.readHeader(new ByteReader(header));

      if(!metadata)
        throw new Error(`Invalid opening explorer file: ${url}`);

      return metadata;
    }
    finally {
      await streamReader.close();
    }
  }

  /** 
   * Parse the file header and return the metadata
   */ 
  private readHeader(reader: ByteReader): ExplorerMetadata {
    // 4-byte magic number
    const magicBytes = reader.readBytes(this.MAGIC_NUMBER_SIZE)!;
    const magicNumber = String.fromCharCode(...magicBytes);
    if(magicNumber !== this.MAGIC_NUMBER) 
      throw new Error('Not an opening explorer file.');

    // 2-byte format version
    const formatVersion = reader.readUint(this.FORMAT_VERSION_SIZE)!;
    if(formatVersion !== 1) 
      throw new Error('Unsupported opening explorer file format.');

    // 2-byte flags
    const flags = reader.readUint(this.FLAGS_SIZE)!;

    const includeRatingAvg = (flags & this.FLAG_RATING_AVG) !== 0;
    const includeLastYear = (flags & this.FLAG_LAST_YEAR) !== 0;

    // 1-byte key size 
    const keySizeBytes = reader.readUint(this.KEY_SIZE_BYTES_SIZE)!;

    // 8-byte revision number
    const revisionNumber = reader.readBigUint64()!;

    // 4-byte Number of entries
    const numEntries = reader.readUint(this.NUM_ENTRIES_SIZE)!;

    // 2-byte base year
    const baseYear = reader.readUint(this.BASE_YEAR_SIZE)!;

    return {
      magicNumber,
      formatVersion,
      flags,
      keySizeBytes,
      revisionNumber,
      numEntries,
      baseYear,
      includeRatingAvg,
      includeLastYear
    };
  }

  /**
   * Fetch the entries from the opening explorer file or file parts, index them and store in IndexedDB
   * @param urls a file url or an array of file part urls (make sure they are ordered sequentially)
   * @returns the file's metadata
   */
  private async fetchData(urls: string | string[]): Promise<ExplorerMetadata> {
    const urlList = Array.isArray(urls) ? urls : [urls];
    const abortController = new AbortController();
    this._abortDownload = abortController;
    let revisionNumber: bigint | null = null;

    try {
      const readers = await Promise.all(
        urlList.map(url =>
          fetch(url, { 
            signal: abortController.signal,
            cache: 'no-store'
          }).then(r => {
            if (!r.ok) {
              throw new Error(`Failed to fetch ${url}: ${r.status}`);
            }
            return r.body!.getReader();
          })
        )
      );

      // Stream the data in chunks to conserve memory.
      // ByteStreamReader automatically handles file part and chunk boundaries 

      const streamReader = new ByteStreamReader(readers);
      const header = await streamReader.readBytes(this.HEADER_SIZE);
      const metadata = this.readHeader(new ByteReader(header));
      revisionNumber = metadata.revisionNumber;
      const numEntries = metadata.numEntries;

      // The initial buffer size of the index (lookup table) for each data block stored in indexedDB (will grow if needed).
      const indexSize = Math.ceil(1.1 * numEntries * (metadata.keySizeBytes + this.OFFSET_SIZE) / this.NUM_BUCKETS);
      let indexWriter!: ByteWriter;

      // The initial buffer size of each data block stored in indexedDB (will grow if needed).
      const dataSize = Math.ceil(10 * numEntries / this.NUM_BUCKETS);
      let dataWriter!: ByteWriter;
      let dataOffset!: number;

      let lastBucket: number | undefined;
      let numRecords = 0;
            
      try {
        while (true) {
          // Get the next record (position)
          // Note: We try the synchronous (fast path) functions first to avoid overloading the microtask 
          // queue with async functions
          const recordLength = streamReader.readUintSync() ?? await streamReader.readUint();
          const record = streamReader.readBytesSync(recordLength) ?? await streamReader.readBytes(recordLength);

          const key = record.subarray(0, metadata.keySizeBytes);
          const data = record.subarray(metadata.keySizeBytes);

          // Assign the record to a data block
          const bucket = key[0] >> (8 - this.BUCKET_BITS);   

          if(bucket !== lastBucket) { // Started a new data block
            // Save the block and its index to indexedDB
            if(lastBucket !== undefined) 
              await this.saveBlock(this.explorerName, revisionNumber, { blockNum: lastBucket, index: indexWriter.getBytes(), data: dataWriter.getBytes() });

            lastBucket = bucket;
            indexWriter = new ByteWriter(indexSize);
            dataWriter = new ByteWriter(dataSize);
            dataOffset = 0;
          }

          // index entry: <key><offset>
          indexWriter.writeBytes(key);
          indexWriter.writeUint(dataOffset, this.OFFSET_SIZE);

          // data entry: <data size><data>
          const before = dataWriter.length;
          dataWriter.writeUint(data.length);
          dataWriter.writeBytes(data);
          dataOffset += dataWriter.length - before;

          numRecords++;
        }
      }
      catch(e) {
        if(!(e instanceof EndOfStreamError))
          throw e;

        if(numRecords !== metadata.numEntries)
          throw new Error(
            `Unexpected end of stream: expected ${metadata.numEntries} records, got ${numRecords}`
          );

        if(lastBucket === undefined)
          throw new Error('Opening explorer contains no records');

        // Save the final block
        await this.saveBlock(this.explorerName, revisionNumber, {
          blockNum: lastBucket,
          index: indexWriter.getBytes(),
          data: dataWriter.getBytes()
        });

        await this.saveMetadata(this.explorerName, metadata);
        return metadata;
      }
      finally {
        await streamReader.close();
      }
    } catch (e) {
      await Explorer.idbStorage.deleteByPrefix('explorer', `${this.explorerName}:${revisionNumber}:`);
      this._abortDownload?.abort();
      throw e;
    }
  }

  /** Allows the app to abort the download of the explorer files externally */
  public abortDownload() {
    this._abortDownload?.abort();
  }

  /*
   * Convert a zobrist hash (bigint) into a truncated byte array (our data key format)
   */
  public zobristToKey(hash: bigint, keySizeBytes: number): Uint8Array {
    const bytes = new Uint8Array(keySizeBytes);
    for (let i = 0; i < keySizeBytes; i++) 
      bytes[i] = Number((hash >> BigInt(i * 8)) & 0xffn);
    
    return bytes;
  }

  /**
   * Get a position from the LRU cache if it exists
   */
  private getCached(fen: string): ExplorerPosition | undefined {
    const fenWithoutPly = fen.split(' ').slice(0, -2).join(' '); 
    const position = this.cache.get(fenWithoutPly);
    if(position) {
      this.cache.delete(fenWithoutPly);
      this.cache.set(fenWithoutPly, position); // Re-cache LRU-style
      return position;
    }
  }

  /**
   * Store a position in the LRU cache
   */
  private setCached(fen: string, position: ExplorerPosition) {
    const fenWithoutPly = fen.split(' ').slice(0, -2).join(' '); 
    if(this.cache.size >= this.MAX_CACHE_SIZE) 
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(fenWithoutPly, position);
  }

  /**
   * Find a position given a fen
   */
  public async findPosition(fen: string): Promise<ExplorerPosition | undefined> {
    if(!this.initPromise)
      return;
    await this.initPromise;

    // Check the position cache
    const cachedPos = this.getCached(fen);
    if(cachedPos)
      return cachedPos;

    const key = this.zobristToKey(zobrist128(fen), this.metadata.keySizeBytes);    
    const position = await this.findPositionByKey(key);
    if(!position || !position.moves)
      return;

    for(let moveEntry of position.moves) {
      const parsed = parseMove(fen, moveEntry.move, 'explorer');
      if(!parsed) 
        return; 

      moveEntry.move = parsed.move;
    }

    this.setCached(fen, position);

    return position;
  }

  /**
   * Find a position by its database key
   * @param key truncated zobrist hash as a byte array
   * @returns 
   */
  private async findPositionByKey(key: Uint8Array): Promise<ExplorerPosition | undefined> {
    // Get data block from indexedDB
    const bucket = key[0] >> (8 - this.BUCKET_BITS);
    const block = await this.loadBlock(this.explorerName, this.metadata.revisionNumber, bucket);

    const indexBytes = block.index;
    const indexEntrySize = this.metadata.keySizeBytes + this.OFFSET_SIZE;
    const view = new DataView(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength);
    const numEntries = indexBytes.byteLength / indexEntrySize;
    let offset = undefined;

    // Binary search the index

    let low = 0;
    let high = numEntries - 1;

    while(low <= high) {
      const mid = (low + high) >>> 1;
      const entryOffset = mid * indexEntrySize;

      let cmp = 0;

      // Compare key
      for(let i = 0; i < key.length; i++) {
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
        offset = view.getUint32(entryOffset + key.length, true);
      }

      if (cmp < 0) 
        low = mid + 1;
      else 
        high = mid - 1;
    }

    if(offset != null) {
      // Parse the moves
      const reader = new ByteReader(block.data.subarray(offset));
      const moves = this.readMoves(reader, this.metadata); 
      return { moves };
    }

    return undefined;
  }

  /**
   * Construct the indexedDB key string from its components
   */
  private blockKey(databaseName: string, revisionNumber: bigint, type: string, blockNum: number): string {
    return `${databaseName}:${revisionNumber}:${type}:${blockNum.toString().padStart(3, '0')}`;
  }

  /**
   * Save a data block and its index to indexedDB 
   */
  private async saveBlock(databaseName: string, revisionNumber: bigint, block: ExplorerBlock): Promise<void> {
    await Explorer.idbStorage.putMany('explorer', [
      [this.blockKey(databaseName, revisionNumber, 'index', block.blockNum), new Blob([block.index as BlobPart])],
      [this.blockKey(databaseName, revisionNumber, 'data', block.blockNum), new Blob([block.data as BlobPart])]
    ]); 
  }

  /**
   * Load a data block and its index from indexedDB
   */
  private async loadBlock(databaseName: string, revisionNumber: bigint, blockNum: number): Promise<ExplorerBlock> {
    const [indexBlob, dataBlob] = await Explorer.idbStorage.getMany<[Blob, Blob]>(
      'explorer', [
        this.blockKey(databaseName, revisionNumber, 'index', blockNum), 
        this.blockKey(databaseName, revisionNumber, 'data', blockNum)
      ]
    );

    return {
      blockNum,
      index: new Uint8Array(await indexBlob.arrayBuffer()),
      data: new Uint8Array(await dataBlob.arrayBuffer())
    };
  }

  /**
   * Load the explorer's metadata 
   */
  private async loadMetadata(databaseName: string): Promise<ExplorerMetadata | undefined> {
    try {
      return await Explorer.idbStorage.get<ExplorerMetadata>(
        'explorer',
        `${databaseName}:metadata`
      );
    }
    catch (e) {
      if(e instanceof DOMException) {
        if(e.name === 'NotFoundError')
          return undefined;
      }
      console.error("Failed to load explorer metadata", e);
      throw e;
    }
  }

  /**
   * Save the explorer's metadata 
   */
  private async saveMetadata(databaseName: string, metadata: ExplorerMetadata): Promise<void> {
    await Explorer.idbStorage.put('explorer', `${databaseName}:metadata`, metadata);
  }

  /**
   * Read and parse a position's moves from the data buffer
   */
  private readMoves(reader: ByteReader, metadata: ExplorerMetadata): ExplorerMove[] {
    const payloadSize = reader.readUint()!;
    const endOffset = reader.position + payloadSize;
    const moves: ExplorerMove[] = [];
    while(reader.position < endOffset) {
      const move = this.readUCIMove(reader);

      let lastYear: number | undefined;
      if(metadata.includeLastYear) 
        lastYear = this.readLastYear(reader, metadata);

      const stats = this.readStats(reader, metadata);

      moves.push({ 
        move, 
        ...(lastYear !== undefined && { lastYear }), 
        stats 
      });
    }

    // Sort the moves from most played to least played
    moves.sort((a, b) => b.stats.total - a.stats.total);
    return moves;
  }

  /**
   * Read and parse a move's stats from the data buffer
   */
  private readStats(reader: ByteReader, metadata: ExplorerMetadata): ExplorerStats {
    let value = null;
    let white = 0, black = 0, draws = 0;
    let ratingAvg: number | undefined;

    if(metadata.includeRatingAvg) 
      ratingAvg = reader.readUint();

    // first stats value (compressed cases)
    const first = reader.readUint()!;

    if(first <= 5) {
      const special = [
        [2, 0, 0], // [wins, draws, losses]
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
      white = first - 6;
      draws = reader.readUint()!;
      black = reader.readUint()!;  
    }

    const total = white + draws + black;

    return { 
      ...(ratingAvg !== undefined && { ratingAvg }),
      total, 
      white, 
      draws, 
      black 
    }
  }

  /**
   * Parse a move's "last year played" from the data buffer 
   */
  private readLastYear(reader: ByteReader, metadata: ExplorerMetadata): number {
    return metadata.baseYear - reader.readUint()!; // the year is encoded relative to baseYear
  }

  /**
   * Read the UCI move string from the data buffer, e.g. 'e2e4' 
   * Note: Uses rook-castling notation, i.e. O-O is 'e1h1'
   */
  private readUCIMove(reader: ByteReader): ExplorerMove['move'] {
    const squareToString = (square: number): string => {
      const file = square & 7;
      const rank = (square >> 3) + 1;
      return String.fromCharCode(97 + file) + rank;
    }

    const pieceToString = (piece: number): string | undefined => {
      switch(piece) {
        case 0: return 'p';
        case 1: return 'n';
        case 2: return 'b';
        case 3: return 'r';
        case 4: return 'q';
        case 5: return 'k';
        default: return undefined;
      }
    }

    const packed = reader.readUint(this.UCI_MOVE_SIZE)!;

    let from = squareToString(packed & 63);
    let to = squareToString((packed >> 6) & 63);
    const piece = pieceToString(packed >> 12);

    if(from === to) {
      return piece !== undefined
        ? { piece, to }
        : { to };
    }

    return {
      from,
      to,
      ...(piece !== undefined ? { promotion: piece } : {})
    };
  }
}

interface LichessExplorerMove {
  san: string;
  averageRating: number;
  white: number;
  draws: number;
  black: number;
  game?: ExplorerGame;
}

interface LichessExplorerPosition {
  moves: LichessExplorerMove[];
  topGames: ExplorerGame[];
}

/** Get opening explorer positions and games from the Lichess Masters database  */
export class LichessExplorer {
  private client: LichessClient; // Handles Lichess OAuth and API requests
  private readonly MAX_CACHE_SIZE = 10000;
  private cache = new Map<string, ExplorerPosition>(); // Position LRU cache

  constructor(client: LichessClient) {
    this.client = client;
  }

  /**
   * Get a position from the LRU cache if it exists
   */
  private getCached(fen: string): ExplorerPosition | undefined {
    const fenWithoutPly = fen.split(' ').slice(0, -2).join(' '); 
    const position = this.cache.get(fenWithoutPly);
    if(position) {
      this.cache.delete(fenWithoutPly);
      this.cache.set(fenWithoutPly, position); // Re-cache LRU-style
      return position;
    }
  }

  /**
   * Store a position in the LRU cache
   */
  private setCached(fen: string, position: ExplorerPosition) {
    const fenWithoutPly = fen.split(' ').slice(0, -2).join(' '); 
    if(this.cache.size >= this.MAX_CACHE_SIZE) 
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(fenWithoutPly, position);
  }

  /**
   * Requets a position by FEN string 
   */
  public async findPosition(fen: string): Promise<ExplorerPosition | undefined> {
    const cachedPos = this.getCached(fen);
    if(cachedPos)
      return cachedPos;

    const url = `https://explorer.lichess.org/masters?fen=${encodeURIComponent(fen)}`;
    const response = await this.client.get(url);
    const position: LichessExplorerPosition = await response.json();

    const moves: ExplorerMove[] = [];
    for(const entry of position.moves) {
      const parsed = parseMove(fen, entry.san);
      if(!parsed) 
        return;

      moves.push({
        move: parsed.move,
        stats: {
          ratingAvg: entry.averageRating,
          total: entry.white + entry.draws + entry.black,
          white: entry.white,
          draws: entry.draws,
          black: entry.black
        },
        ...(entry.game && { game: entry.game }),
        ...(entry.game?.year !== undefined && { lastYear: Number(entry.game.year) })
      });
    } 

    const pos = {
      moves,
      games: position.topGames
    }

    this.setCached(fen, pos);

    return pos;
  }

  /**
   * Fetch a PGN by Lichess game ID
   */
  public async getGame(id: string): Promise<string> {
    const url = `https://explorer.lichess.org/masters/pgn/${id}`;
    const response = await this.client.get(url);
    return response.text();
  }
}

export default Explorer;