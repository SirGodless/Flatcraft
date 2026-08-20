import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { allDimensionIds, Chunk, decodeChunk, type Dimension, type FurnaceState, type ItemStack } from "@flatcraft/sim";

/**
 * Chunk terrain storage: one small binary file per *modified* chunk
 * (dataDir/world/<dimension>/c.<cx>.<cy>.bin), not one file for the whole
 * world and not grouped "region" files either. A chunk that was only ever
 * visited, never edited, has no file at all and regenerates identically
 * from the seed (see Chunk.dirty / World.serializeChunks).
 *
 * One file per chunk (rather than grouping several chunks per file, as an
 * earlier version of this did) was a deliberate choice: with a shared
 * file, a header/table hit by corruption or a failed read takes out every
 * chunk in that file, not just one. Since only edited chunks get files at
 * all, file *count* tracks how much was actually built/mined, not how
 * much was explored, so grouping's main upside (fewer files) isn't
 * actually needed here - one file per chunk gets full fault isolation for
 * free: a damaged file can, by construction, only ever affect the one
 * chunk it belongs to.
 *
 * Each file also carries the chest/furnace state anchored within that
 * chunk (see ChunkExtra) - block-anchored inventories are permanently
 * tied to one tile, exactly like the chunk's terrain, so keeping them in
 * the same file makes a chunk's file a single consistent unit: losing it
 * loses that chunk's terrain and its containers' contents together,
 * never a mismatched half of one without the other.
 */

const MAGIC = 0x46434331; // ASCII "FCC1" - "Flatcraft Chunk", format version 1

export interface ChunkExtra {
  chests: Array<{ x: number; y: number; slots: (ItemStack | null)[] }>;
  furnaces: FurnaceState[];
}

export interface DecodedChunkFile {
  tileRuns: number[];
  wallRuns: number[];
  extra: ChunkExtra;
}

function chunkFilePath(worldDir: string, dim: Dimension, cx: number, cy: number): string {
  return join(worldDir, dim, `c.${cx}.${cy}.bin`);
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

/**
 * Encodes one chunk's full file: magic, then three length-prefixed
 * sections (tile runs, wall runs, extra state). Item stacks (chest/
 * furnace contents) can carry nested, evolving structure (ItemStack.data
 * - e.g. a backpack's own inventory), so unlike the fixed-shape terrain
 * runs, `extra` is plain UTF-8 JSON rather than a hand-rolled binary
 * layout - it's always small (a handful of item stacks at most), so the
 * simplicity/robustness of reusing JSON there outweighs any size gain
 * from a custom binary format that would need updating every time
 * ItemStack's shape grows.
 */
export function encodeChunkFile(tileRuns: readonly number[], wallRuns: readonly number[], extra: ChunkExtra): Buffer {
  const tileBytes = packRuns(tileRuns);
  const wallBytes = packRuns(wallRuns);
  const extraBytes = Buffer.from(JSON.stringify(extra), "utf8");
  const header = Buffer.alloc(4 + 4 + 4 + 4);
  header.writeUInt32BE(MAGIC, 0);
  header.writeUInt32LE(tileBytes.length, 4);
  header.writeUInt32LE(wallBytes.length, 8);
  header.writeUInt32LE(extraBytes.length, 12);
  return Buffer.concat([header, tileBytes, wallBytes, extraBytes]);
}

/** Decodes a chunk file's bytes. Returns undefined for a bad magic number
 * or a length that runs past the buffer - never throws, so a truncated or
 * corrupted file degrades to "nothing saved for this chunk" instead of
 * crashing whoever's reading it. */
export function decodeChunkFile(buf: Buffer): DecodedChunkFile | undefined {
  if (buf.length < 16 || buf.readUInt32BE(0) !== MAGIC) return undefined;
  const tileLen = buf.readUInt32LE(4);
  const wallLen = buf.readUInt32LE(8);
  const extraLen = buf.readUInt32LE(12);
  let offset = 16;
  if (offset + tileLen + wallLen + extraLen > buf.length) return undefined;
  const tileRuns = unpackRuns(buf.subarray(offset, offset + tileLen));
  offset += tileLen;
  const wallRuns = unpackRuns(buf.subarray(offset, offset + wallLen));
  offset += wallLen;
  let extra: ChunkExtra;
  try {
    extra = JSON.parse(buf.subarray(offset, offset + extraLen).toString("utf8")) as ChunkExtra;
  } catch {
    return undefined;
  }
  return { tileRuns, wallRuns, extra: { chests: extra.chests ?? [], furnaces: extra.furnaces ?? [] } };
}

/**
 * Owns the `<dataDir>/world/<dimension>/c.<cx>.<cy>.bin` files for one
 * world directory.
 *
 * `load` is meant to be wired into World.setChunkLoader: synchronous,
 * on-demand, safe to call from the simulation's hot path (see
 * world.ts's ensureChunk doc comment) because each file is only ever
 * actually read from disk once per process lifetime - every chunk it
 * describes is resident in memory from then on, same as generation.
 *
 * Chest/furnace hydration is deliberately *not* part of `load`: that
 * would make container ticking depend on a player having wandered near
 * enough to trigger lazy terrain loading first. Instead, scanAll() reads
 * every chunk file's small header eagerly at boot (regardless of
 * whether its terrain ever gets loaded this session) so furnaces keep
 * ticking exactly as before, independent of chunk residency - see
 * server.ts.
 */
export class ChunkFileStore {
  /** File path -> its decoded contents, or null if missing/unreadable.
   * Populated lazily by load(), and pre-warmed by scanAll() at boot so
   * the first real terrain load doesn't re-read a file already read
   * once for its chest/furnace section. */
  private readonly cache = new Map<string, DecodedChunkFile | null>();

  constructor(private readonly worldDir: string) {}

  load(dim: Dimension, cx: number, cy: number, remap: ReadonlyMap<number, number> | null): Chunk | undefined {
    const filePath = chunkFilePath(this.worldDir, dim, cx, cy);
    let decoded = this.cache.get(filePath);
    if (decoded === undefined) {
      decoded = this.readFileSafely(filePath);
      this.cache.set(filePath, decoded);
    }
    if (!decoded) return undefined;
    return decodeChunk(cx, cy, decoded.tileRuns, decoded.wallRuns, remap);
  }

  /** Reads every chunk file across every registered dimension once, for
   * the boot-time chest/furnace hydration - see the class doc comment.
   * Returns each file's dimension/coordinates/extra state; terrain
   * itself isn't decoded into a Chunk here (that stays lazy, via
   * load()). Iterates allDimensionIds() rather than a hardcoded pair so
   * a mod-registered dimension's containers get hydrated too. */
  scanAll(): Array<{ dim: Dimension; cx: number; cy: number; extra: ChunkExtra }> {
    const results: Array<{ dim: Dimension; cx: number; cy: number; extra: ChunkExtra }> = [];
    for (const dim of allDimensionIds()) {
      const dir = join(this.worldDir, dim);
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir)) {
        const match = /^c\.(-?\d+)\.(-?\d+)\.bin$/.exec(entry);
        if (!match) continue;
        const cx = Number(match[1]);
        const cy = Number(match[2]);
        const filePath = join(dir, entry);
        const decoded = this.readFileSafely(filePath);
        this.cache.set(filePath, decoded); // pre-warm - load() won't re-read this file
        if (decoded) results.push({ dim, cx, cy, extra: decoded.extra });
      }
    }
    return results;
  }

  private readFileSafely(filePath: string): DecodedChunkFile | null {
    if (!existsSync(filePath)) return null;
    try {
      return decodeChunkFile(readFileSync(filePath)) ?? null;
    } catch {
      // Corrupt/unreadable file: this one chunk regenerates fresh instead
      // of taking the whole server down over one damaged file.
      return null;
    }
  }

  /** Writes one file per dirty chunk (tmp + rename, same atomicity as
   * the world.json meta file). `extraByChunk` supplies each chunk's
   * chest/furnace state, keyed by "cx,cy" - chunks with no entry get an
   * empty extra section. */
  write(
    dim: Dimension,
    chunks: ReadonlyArray<{ cx: number; cy: number; tiles: number[]; walls?: number[] }>,
    extraByChunk: ReadonlyMap<string, ChunkExtra>,
  ): void {
    for (const c of chunks) {
      const filePath = chunkFilePath(this.worldDir, dim, c.cx, c.cy);
      mkdirSync(dirname(filePath), { recursive: true });
      const extra = extraByChunk.get(`${c.cx},${c.cy}`) ?? { chests: [], furnaces: [] };
      const data = encodeChunkFile(c.tiles, c.walls ?? [], extra);
      const tmp = `${filePath}.tmp`;
      writeFileSync(tmp, data);
      renameSync(tmp, filePath);
      this.cache.delete(filePath); // next load()/scanAll() picks up what was just written
    }
  }
}
