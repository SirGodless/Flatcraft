/**
 * One-shot bake: render every block/item/mob's declared procedural
 * fallback (visual.fallback in content/flatcraft/{blocks,items,mobs}/
 * *.json) into a real PNG under public/sprites/<type>/, using the same
 * pixel math the live client draws with (blockPixels.ts/itemPixels.ts's
 * renderBlockPixels/renderItemPixels - byte-identical to the live canvas
 * draw; mobPixels.ts's renderMobPixels is a close raster approximation,
 * since the live mob fallback draws vector rects with Pixi's Graphics
 * API, not a canvas - see that file's own doc comment) - a format
 * change, not new art. The procedural fallback code itself is untouched
 * and stays live for all three: a baked sprite file simply takes
 * precedence over it at runtime (see textures.ts's createBlockTextures,
 * icons.ts's itemTexture, entitySprites.ts's entityTexture), so it
 * remains available as a reference/fallback for any block/item/mob that
 * ends up without a sprite file (e.g. a mod's content that ships none).
 * Skips any target PNG that already exists, so a later re-run (e.g.
 * after adding new content) never clobbers a hand-edited sprite. Run via
 * (from packages/client):
 *   npx esbuild scripts/bake-sprites.ts --bundle --platform=node \
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
import { allBlocks, allItems, allMobs, BlockId, loadContentPackage, localName, sizeOf } from "@flatcraft/sim";
import { renderBlockPixels, TILE_PX } from "../src/render/blockPixels.js";
import { renderItemPixels } from "../src/render/itemPixels.js";
import { renderMobPixels } from "../src/render/mobPixels.js";

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

// --- bake one key (base path, no extension) to a PNG, unless it's
// already there - shared by all three content types below. ---

let written = 0;
let skipped = 0;
function bake(key: string, pixels: Uint8ClampedArray, width: number, height: number): void {
  const filePath = join(spritesDir, `${key}.png`);
  if (existsSync(filePath)) {
    skipped++;
    return;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, encodePng(pixels, width, height));
  written++;
}

/** "sprites/block/x.png" (a def's own `sprite` override) or the
 * convention path `<type>/<localName>` - same key derivation every
 * *Texture() lookup (createBlockTextures, itemTexture, entityTexture)
 * uses, so a baked file lands exactly where the live code looks for it.
 * `idOrQualifiedName` is whichever field actually holds the qualified
 * "<pkg>:<type>:<name>" id for that def - for blocks that's (confusingly)
 * `.name` (registerBlockJson sets it to json.id, see block.ts), for
 * items/mobs it's `.id` (`.name` there is the human display name
 * instead, e.g. "Golden Shovel" - see items.ts/mobs.ts). */
function baseKey(sprite: string | undefined, type: string, idOrQualifiedName: string): string {
  return sprite ? sprite.replace(/^sprites\//, "").replace(/\.[a-z0-9]+$/i, "") : `${type}/${localName(idOrQualifiedName)}`;
}

// --- blocks: every declared visual.fallback, TILE_PXxTILE_PX ---

for (const def of allBlocks()) {
  if (def.id === BlockId.Air) continue;
  const fallback = def.visual?.fallback;
  if (!fallback) continue;
  const key = baseKey(def.sprite, "block", def.name);
  const variantCount = def.visual?.variants ?? 1;
  for (let i = 0; i < variantCount; i++) {
    bake(variantCount > 1 ? `${key}_${i}` : key, renderBlockPixels(def.id, fallback, i), TILE_PX, TILE_PX);
  }
}

// --- items: every declared visual.fallback (block items reuse the
// block's own texture already, nothing to bake for those), TILE_PXxTILE_PX ---

for (const def of allItems()) {
  const fallback = def.visual?.fallback;
  if (!fallback) continue;
  const key = baseKey(def.sprite, "item", def.id);
  const variantCount = def.visual?.variants ?? 1;
  for (let i = 0; i < variantCount; i++) {
    // Items have no per-variant procedural seed (unlike blocks) - the
    // hand-drawn art is the same pixels for every declared variant, see
    // icons.ts's itemTexture picking a random *sprite file* variant only.
    bake(variantCount > 1 ? `${key}_${i}` : key, renderItemPixels(fallback), TILE_PX, TILE_PX);
  }
}

// --- mobs: every declared visual.fallback, sized to the mob's own
// tile-unit bounding box (sizeOf) rather than a fixed TILE_PXxTILE_PX -
// mob sprites are stretched to fit like items, not grid-tiled like
// blocks, so there's no fixed-size requirement (see entitySprites.ts). ---

for (const def of allMobs()) {
  const fallback = def.visual?.fallback;
  if (!fallback) continue;
  const key = baseKey(def.sprite, "mob", def.id);
  const size = sizeOf(def.id);
  const widthPx = Math.max(1, Math.round(size.width * TILE_PX));
  const heightPx = Math.max(1, Math.round(size.height * TILE_PX));
  const variantCount = def.visual?.variants ?? 1;
  for (let i = 0; i < variantCount; i++) {
    bake(variantCount > 1 ? `${key}_${i}` : key, renderMobPixels(fallback, TILE_PX, widthPx, heightPx), widthPx, heightPx);
  }
}

console.log(`baked ${written} sprite(s) into ${spritesDir} (${skipped} already existed, left untouched)`);
