import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Chunk, decodeChunk, type Dimension } from "@flatcraft/sim";

/**
 * Chunk terrain storage: a directory of small binary "region" files
 * instead of one giant JSON blob for the whole world. Each region file
 * holds an REGION_SIZE x REGION_SIZE grid of chunks (Minecraft's .mca
 * files are the same idea) - splitting the world this way means an
 * autosave only has to touch the handful of files that actually changed,
 * a corrupt file only costs one small area instead of the whole world,
 * and a chunk can be loaded on demand (World.setChunkLoader) by reading
 * one small file rather than the entire save.
 *
 * Only chunks with an actual edit ever get written (see
 * World.serializeChunks/Chunk.dirty) - unmodified terrain simply isn't
 * present in any region file and regenerates identically from the seed,
 * so a long play session's disk footprint tracks how much was actually
 * built/mined, not how much was ever walked past.
 */

/** Chunks per axis in one region file (64 chunks/file, 256x256 tiles). */
export const REGION_SIZE = 8;

const MAGIC = 0x46435231; // ASCII "FCR1" - format tag + version, read as one big-endian uint32
const HEADER_BYTES = 4;
const SLOT_COUNT = REGION_SIZE * REGION_SIZE;
/** Fixed offset table right after the header: one (uint32 offset, uint32
 * length) pair per chunk slot, in a known position independent of which
 * slots are actually populated - this is what lets a single chunk be
 * read without parsing the rest of the file. */
const TABLE_BYTES = SLOT_COUNT * 8;

export interface DirtyChunkRuns {
  cx: number;
  cy: number;
  /** Run-length-encoded, as produced by World.serializeChunks() (which
   * always populates both - `walls` is optional here only to match
   * SimSave's own type, which also has to describe legacy saves from
   * before the wall layer existed). */
  tiles: number[];
  walls?: number[];
}

function regionCoords(cx: number, cy: number): { rx: number; ry: number; slot: number } {
  const rx = Math.floor(cx / REGION_SIZE);
  const ry = Math.floor(cy / REGION_SIZE);
  const slot = (cy - ry * REGION_SIZE) * REGION_SIZE + (cx - rx * REGION_SIZE);
  return { rx, ry, slot };
}

function regionFilePath(worldDir: string, dim: Dimension, rx: number, ry: number): string {
  return join(worldDir, dim, `r.${rx}.${ry}.bin`);
}

function packRuns(runs: readonly number[]): Buffer {
  const buf = Buffer.alloc(runs.length * 2);
  for (let i = 0; i < runs.length; i++) buf.writeUInt16LE(runs[i]!, i * 2);
  return buf;
}

function unpackRuns(buf: Buffer): number[] {
  const count = buf.length / 2;
  const runs: number[] = new Array(count);
  for (let i = 0; i < count; i++) runs[i] = buf.readUInt16LE(i * 2);
  return runs;
}

/** One chunk's payload: a 4-byte tile-byte-length prefix, then the tile
 * run bytes, then the wall run bytes - lets one slot hold both arrays
 * without needing a second offset-table entry per chunk. */
function encodeChunkPayload(tiles: readonly number[], walls: readonly number[]): Buffer {
  const tileBytes = packRuns(tiles);
  const wallBytes = packRuns(walls);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(tileBytes.length, 0);
  return Buffer.concat([header, tileBytes, wallBytes]);
}

function decodeChunkPayload(buf: Buffer): { tiles: number[]; walls: number[] } {
  const tileByteLength = buf.readUInt32LE(0);
  return {
    tiles: unpackRuns(buf.subarray(4, 4 + tileByteLength)),
    walls: unpackRuns(buf.subarray(4 + tileByteLength)),
  };
}

/** Packs every chunk in `chunks` (all assumed to belong to the same
 * region - the caller buckets by rx/ry first) into one region file
 * buffer. Slots with no dirty chunk get a zeroed table entry. */
function encodeRegionFile(chunks: readonly DirtyChunkRuns[]): Buffer {
  const payloads: Array<Buffer | undefined> = new Array(SLOT_COUNT);
  for (const c of chunks) {
    payloads[regionCoords(c.cx, c.cy).slot] = encodeChunkPayload(c.tiles, c.walls ?? []);
  }
  const table = Buffer.alloc(TABLE_BYTES);
  const parts: Buffer[] = [];
  let offset = HEADER_BYTES + TABLE_BYTES;
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const payload = payloads[slot];
    if (!payload) continue; // table entry stays (0, 0) - "nothing here"
    table.writeUInt32LE(offset, slot * 8);
    table.writeUInt32LE(payload.length, slot * 8 + 4);
    parts.push(payload);
    offset += payload.length;
  }
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32BE(MAGIC, 0);
  return Buffer.concat([header, table, ...parts]);
}

/** Reads one chunk slot out of an already-loaded region file buffer,
 * without touching any other slot's bytes. Returns undefined for a
 * missing/zeroed slot, a truncated buffer, or a bad magic number -
 * never throws, so a corrupt region file degrades to "regenerate this
 * chunk" instead of crashing the server. */
function readSlot(buf: Buffer, slot: number): { tiles: number[]; walls: number[] } | undefined {
  if (buf.length < HEADER_BYTES + TABLE_BYTES || buf.readUInt32BE(0) !== MAGIC) return undefined;
  const tableOffset = HEADER_BYTES + slot * 8;
  const offset = buf.readUInt32LE(tableOffset);
  const length = buf.readUInt32LE(tableOffset + 4);
  if (length === 0 || offset + length > buf.length) return undefined;
  return decodeChunkPayload(buf.subarray(offset, offset + length));
}

/**
 * Owns the `<dataDir>/world/<dimension>/r.<rx>.<ry>.bin` files for one
 * world directory. `load` is meant to be wired into World.setChunkLoader
 * (synchronous, on-demand, and safe to call from the simulation's hot
 * path - see world.ts's ensureChunk doc comment - because each region
 * file is only actually read from disk once per process lifetime; every
 * chunk in it is resident in memory from then on, same as generation).
 */
export class RegionStore {
  /** Region file path -> its bytes, or null if missing/unreadable. Once a
   * region is read, every chunk in it is served from this buffer without
   * touching disk again - repeat lookups (a player exploring within one
   * region) cost nothing beyond decoding the target slot. */
  private readonly cache = new Map<string, Buffer | null>();

  constructor(private readonly worldDir: string) {}

  load(dim: Dimension, cx: number, cy: number, remap: ReadonlyMap<number, number> | null): Chunk | undefined {
    const { rx, ry, slot } = regionCoords(cx, cy);
    const filePath = regionFilePath(this.worldDir, dim, rx, ry);
    let buf = this.cache.get(filePath);
    if (buf === undefined) {
      buf = this.readFileSafely(filePath);
      this.cache.set(filePath, buf);
    }
    if (!buf) return undefined;
    const entry = readSlot(buf, slot);
    if (!entry) return undefined;
    // An empty walls run-set means "nothing was ever stored" (defensive
    // only - the dedicated writer always populates walls); decodeChunk
    // treats undefined, not [], as "default to all-air".
    return decodeChunk(cx, cy, entry.tiles, entry.walls.length > 0 ? entry.walls : undefined, remap);
  }

  private readFileSafely(filePath: string): Buffer | null {
    if (!existsSync(filePath)) return null;
    try {
      return readFileSync(filePath);
    } catch {
      // Corrupt/unreadable region: that terrain regenerates fresh instead
      // of taking the whole server down over one damaged file.
      return null;
    }
  }

  /** Buckets `chunks` (every currently-dirty chunk for one dimension,
   * i.e. World.serializeChunks()'s output) by region and (re)writes every
   * region that has at least one, atomically per file (tmp + rename, same
   * as the world.json meta file). A region is rewritten in full whenever
   * any chunk in it is dirty, even if that specific chunk hasn't changed
   * since the last save - simpler than tracking "changed since last
   * save" separately, and cheap enough given region files are at most a
   * few dozen KB. */
  write(dim: Dimension, chunks: readonly DirtyChunkRuns[]): void {
    const byRegion = new Map<string, DirtyChunkRuns[]>();
    for (const c of chunks) {
      const { rx, ry } = regionCoords(c.cx, c.cy);
      const key = `${rx},${ry}`;
      const list = byRegion.get(key);
      if (list) list.push(c);
      else byRegion.set(key, [c]);
    }
    for (const [key, list] of byRegion) {
      const [rxStr, ryStr] = key.split(",");
      const filePath = regionFilePath(this.worldDir, dim, Number(rxStr), Number(ryStr));
      mkdirSync(dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      writeFileSync(tmp, encodeRegionFile(list));
      renameSync(tmp, filePath);
      this.cache.delete(filePath); // next load() picks up what was just written
    }
  }
}
