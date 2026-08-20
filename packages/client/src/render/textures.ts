import { Texture } from "pixi.js";
import { allBlocks, blockDef, BlockId, hash01, type BlockFallbackJson } from "@flatcraft/sim";
import { spriteKey, SPRITE_OVERRIDES } from "./sprites.js";

/** On-screen size of one tile at zoom 1, and texture resolution per block. */
export const TILE_PX = 16;

/** [r,g,b] triples come from BlockFallbackJson as `number[]` (JSON has no
 * fixed-length array type) but are validated to have exactly 3 entries at
 * content-load time (registry/schema.ts's validateColorTriple) - safe to
 * assert here rather than re-check on every pixel. */
function rgb(triple: number[]): [number, number, number] {
  return [triple[0]!, triple[1]!, triple[2]!];
}

function shapeMask(shape: NonNullable<BlockFallbackJson["shape"]>, x: number, y: number): boolean {
  switch (shape) {
    case "stairs": {
      // Steps descending to the left, 4px each.
      const step = Math.floor(x / 4);
      return y >= TILE_PX - (step + 1) * 4;
    }
    case "fence":
      return (x >= 2 && x <= 4) || (x >= 11 && x <= 13) || y === 4 || y === 5 || y === 10 || y === 11;
    case "door_open":
      return x <= 3; // swung against the left edge
    case "trapdoor_open":
      return x >= TILE_PX - 4; // folded against the right edge
  }
}

/** Tiny deterministic PRNG so textures look identical on every load. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** `variant` picks a distinct-but-still-deterministic noise seed, so a
 * block with declared visual.variants gets free procedural variety
 * even without any sprite files (createBlockTextureVariants below). */
function makeBlockTexture(id: BlockId, style: BlockFallbackJson, variant = 0): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext("2d")!;
  const rand = lcg(0xf1a7 + id * 7919 + variant * 104729);
  ctx.globalAlpha = style.alpha ?? 1;

  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      if (style.holes !== undefined && rand() < style.holes) continue;
      if (style.fill_rows !== undefined && y < TILE_PX - style.fill_rows) continue;
      if (style.shape !== undefined && !shapeMask(style.shape, x, y)) continue;
      const inTop = style.top !== undefined && y < style.top.rows;
      let [r, g, b] = inTop ? rgb(style.top!.color) : rgb(style.base);
      if (style.stripe && x % 4 < 2) {
        r *= 0.82;
        g *= 0.82;
        b *= 0.82;
      }
      const jitter = 1 - style.noise + rand() * style.noise * 2;
      ctx.fillStyle = `rgb(${Math.round(r * jitter)},${Math.round(g * jitter)},${Math.round(b * jitter)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  if (style.specks) {
    const [r, g, b] = rgb(style.specks.color);
    for (let i = 0; i < style.specks.count; i++) {
      const sx = 1 + Math.floor(rand() * (TILE_PX - 3));
      const sy = 1 + Math.floor(rand() * (TILE_PX - 3));
      const jitter = 0.9 + rand() * 0.2;
      ctx.fillStyle = `rgb(${Math.round(r * jitter)},${Math.round(g * jitter)},${Math.round(b * jitter)})`;
      ctx.fillRect(sx, sy, 2, 2);
    }
  }

  if (style.opening) {
    ctx.fillStyle = "rgb(24,22,20)";
    ctx.fillRect(4, 9, 8, 5);
    ctx.fillStyle = "rgb(230,140,40)";
    ctx.fillRect(6, 12, 4, 2);
  }

  if (style.frame) {
    const [r, g, b] = rgb(style.frame);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, TILE_PX, 1);
    ctx.fillRect(0, TILE_PX - 1, TILE_PX, 1);
    ctx.fillRect(0, 0, 1, TILE_PX);
    ctx.fillRect(TILE_PX - 1, 0, 1, TILE_PX);
  }

  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";
  return texture;
}

export function createBlockTextures(): Map<BlockId, Texture> {
  const textures = new Map<BlockId, Texture>();
  // Sprite files beat a declared procedural fallback; blocks with neither
  // (e.g. datapack blocks from a server mod that ships no visual at all)
  // get a generic texture colored from their name, so nothing ever
  // renders invisible.
  for (const def of allBlocks()) {
    if (def.id === BlockId.Air) continue;
    const key = def.sprite
      ? def.sprite.replace(/^sprites\//, "").replace(/\.[a-z0-9]+$/i, "")
      : `block/${def.name}`;
    const sprite = SPRITE_OVERRIDES.get(key);
    if (sprite) {
      textures.set(def.id, sprite);
    } else if (def.visual?.fallback) {
      textures.set(def.id, makeBlockTexture(def.id, def.visual.fallback));
    } else {
      let hash = 0;
      for (const ch of def.name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
      const base = [80 + (hash % 120), 80 + ((hash >> 7) % 120), 80 + ((hash >> 14) % 120)];
      textures.set(def.id, makeBlockTexture(def.id, { base, noise: 0.12 }));
    }
  }
  return textures;
}

/** Distinguishes this hash use from icons.ts's/entitySprites.ts's own
 * VARIANT_SALT (each only needs to be internally consistent). */
const VARIANT_SALT = 0x2;

/**
 * Per-tile texture variants for blocks whose def declares
 * `visual.variants > 1` (e.g. an ore that shouldn't look identical
 * every tile) - sparse, only block ids that opt in get an entry.
 * Blocks with a declared procedural fallback get distinctly-seeded
 * variants for free, no sprite files required; sprite-backed blocks look
 * for numbered files (block/<name>_0.png, _1.png, ...), falling back to
 * the block's single base texture for any variant whose file is missing
 * - never invisible, same rule every other sprite lookup here follows.
 */
export function createBlockTextureVariants(base: Map<BlockId, Texture>): Map<BlockId, Texture[]> {
  const variants = new Map<BlockId, Texture[]>();
  for (const def of allBlocks()) {
    const count = def.visual?.variants ?? 1;
    if (count <= 1) continue;
    const style = def.visual?.fallback;
    const key = spriteKey(def.sprite) ?? `block/${def.name}`;
    const textures: Texture[] = [];
    for (let i = 0; i < count; i++) {
      const sprite = SPRITE_OVERRIDES.get(`${key}_${i}`);
      textures.push(sprite ?? (style ? makeBlockTexture(def.id, style, i) : base.get(def.id)!));
    }
    variants.set(def.id, textures);
  }
  return variants;
}

/** The texture for one specific tile: a deterministic variant pick when
 * the block id has any (every client computes the same index from the
 * same world position, no sync needed), else the block's single base
 * texture - identical behavior to before variants existed. */
/** A block's single continuously-looping ambient clip - unlike mobs, blocks
 * have no event-driven states (hurt/death/attack), just idle motion, so
 * there's no state machine here, only the frame set to play. */
export interface BlockAnimationClip {
  frames: number;
  frameWidth: number;
  fps: number;
  loop: boolean;
  sheet: Texture;
}

/** The block's default animation clip (preferring a state named "idle",
 * else whichever comes first in visual.animation.states), if its sprite
 * sheet file (block/<name>_<state>.png) is actually present - missing file
 * or no declared animation both simply mean: no clip, caller falls back to
 * the plain per-tile texture from pickBlockTexture(). */
export function blockAnimationClip(id: BlockId): BlockAnimationClip | undefined {
  const def = blockDef(id);
  const states = def?.visual?.animation?.states;
  if (!states) return undefined;
  const baseKey = spriteKey(def!.sprite) ?? `block/${def!.name}`;
  const preferred = states["idle"] ? "idle" : Object.keys(states)[0];
  if (preferred === undefined) return undefined;
  const clip = states[preferred]!;
  const sheet = SPRITE_OVERRIDES.get(`${baseKey}_${preferred}`);
  if (!sheet) return undefined;
  return { frames: clip.frames, frameWidth: clip.frame_width, fps: clip.fps, loop: clip.loop ?? true, sheet };
}

export function pickBlockTexture(
  base: Map<BlockId, Texture>,
  variants: Map<BlockId, Texture[]>,
  id: BlockId,
  worldX: number,
  worldY: number,
): Texture | undefined {
  const textures = variants.get(id);
  if (!textures || textures.length <= 1) return base.get(id);
  const index = Math.floor(hash01(id, worldX, worldY, VARIANT_SALT) * textures.length);
  return textures[index];
}
