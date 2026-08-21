/**
 * One-shot bake: render every block's declared procedural fallback
 * (visual.fallback in content/flatcraft/blocks/*.json) into a real PNG
 * under public/sprites/block/, using the exact same pixel math the live
 * client draws with (blockPixels.ts's renderBlockPixels) - a format
 * change, not new art. The procedural fallback code itself is untouched
 * and stays live: a baked sprite file simply takes precedence over it
 * at runtime (see textures.ts's createBlockTextures), so it remains
 * available as a reference/fallback for any block that ends up without
 * a sprite file (e.g. a mod block that ships none). Skips any block
 * whose target PNG already exists, so a later re-run (e.g. after adding
 * a new block) never clobbers a hand-edited sprite. Run via (from
 * packages/client):
 *   npx esbuild scripts/bake-block-sprites.ts --bundle --platform=node \
 *     --format=esm --external:esbuild --outfile=dist-scripts/bake.mjs \
 *     && node dist-scripts/bake.mjs && rm -rf dist-scripts
 * (esbuild itself must stay external - @flatcraft/content depends on it
 * for script transpilation and it's a CJS package that can't be bundled
 * into an ESM output; everything else, including @flatcraft/sim and
 * @flatcraft/content's own TS source, bundles in fine since neither
 * ships a build output for plain Node to resolve at runtime.)
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { discoverContentDir } from "@flatcraft/content";
import { allBlocks, BlockId, loadContentPackage, localName } from "@flatcraft/sim";
import { renderBlockPixels, TILE_PX } from "../src/render/blockPixels.js";

const spritesDir = join(import.meta.dirname, "../public/sprites");

// @flatcraft/sim's block registry starts empty - boot it the same way
// @flatcraft/dedicated's server.ts and the sim test suite's setup.ts do
// (flatcraft's own content package first, since other packages may
// reference its namespaced ids and loadContentPackage resolves
// cross-references eagerly).
const contentDir = join(import.meta.dirname, "../../../content");
const packages = discoverContentDir(contentDir);
const flatcraft = packages.find((p) => p.id === "flatcraft");
if (!flatcraft) throw new Error(`expected a "flatcraft" content package under ${contentDir}`);
await loadContentPackage(flatcraft);
for (const pkg of packages) {
  if (pkg.id === "flatcraft") continue;
  await loadContentPackage(pkg);
}

// --- minimal PNG encoder (8-bit RGBA, no interlacing, one IDAT chunk) -
// small enough that pulling in a real image library isn't worth it for
// a one-shot tool with a fixed 16x16 RGBA input. ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(pixels: Uint8ClampedArray, width: number, height: number): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: truecolor + alpha
  ihdrData[10] = 0; // compression method
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace method
  // Each scanline is prefixed with a filter-type byte (0 = None).
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width * 4; x++) raw[rowStart + 1 + x] = pixels[y * width * 4 + x]!;
  }
  const idatData = deflateSync(raw);
  return Buffer.concat([signature, chunk("IHDR", ihdrData), chunk("IDAT", idatData), chunk("IEND", Buffer.alloc(0))]);
}

// --- bake every block with a declared procedural fallback ---

let written = 0;
let skipped = 0;
for (const def of allBlocks()) {
  if (def.id === BlockId.Air) continue;
  const fallback = def.visual?.fallback;
  if (!fallback) continue;
  const baseKey = def.sprite ? def.sprite.replace(/^sprites\//, "").replace(/\.[a-z0-9]+$/i, "") : `block/${localName(def.name)}`;
  const variantCount = def.visual?.variants ?? 1;
  for (let i = 0; i < variantCount; i++) {
    const key = variantCount > 1 ? `${baseKey}_${i}` : baseKey;
    const filePath = join(spritesDir, `${key}.png`);
    if (existsSync(filePath)) {
      skipped++;
      continue;
    }
    const pixels = renderBlockPixels(def.id, fallback, i);
    const png = encodePng(pixels, TILE_PX, TILE_PX);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, png);
    written++;
  }
}
console.log(`baked ${written} block sprite(s) into ${spritesDir} (${skipped} already existed, left untouched)`);
