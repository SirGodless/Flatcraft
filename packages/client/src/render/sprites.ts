import { Texture } from "pixi.js";

/**
 * Sprite overrides: real image files replacing the procedural graphics.
 * Convention: sprites/<type>/<id>.png (e.g. sprites/item/golden_shovel.png,
 * sprites/block/stone.png, sprites/mob/zombie.png, sprites/entity/arrow.png),
 * listed in /sprites/manifest.json - served by the dedicated server from
 * a discovered content package's own sprites/ directory (a mod's sprite
 * override, in memory - see server.ts's contentSprites) or the repo-
 * shipped client build, or from the static public/ directory in
 * singleplayer. Rules: PNG, 8 bit per channel, dimensions a multiple of
 * 2, at most 128x128. Missing manifest or files simply mean: procedural
 * fallback, never an error (though a missing fallback too now shows a
 * loud magenta placeholder + console warning - see textures.ts's
 * MISSING_TEXTURE_STYLE).
 */
export const SPRITE_OVERRIDES = new Map<string, Texture>();

/** "sprites/item/x.png" -> override key "item/x". */
export function spriteKey(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  return path.replace(/^sprites\//, "").replace(/\.[a-z0-9]+$/i, "");
}

export async function loadSpriteOverrides(): Promise<void> {
  let entries: string[];
  try {
    const response = await fetch("/sprites/manifest.json", { headers: { accept: "application/json" } });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("application/json")) return;
    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) return;
    entries = body.filter((e): e is string => typeof e === "string");
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      try {
        const image = new Image();
        image.src = `/sprites/${entry}`;
        await image.decode();
        if (
          image.width === 0 ||
          image.width % 2 !== 0 ||
          image.height % 2 !== 0 ||
          image.width > 128 ||
          image.height > 128
        ) {
          console.warn(`sprite ${entry}: dimensions must be multiples of 2, max 128x128 - skipped`);
          return;
        }
        const texture = Texture.from(image);
        texture.source.scaleMode = "nearest";
        // Key without extension: "item/golden_shovel".
        SPRITE_OVERRIDES.set(entry.replace(/\.[a-z0-9]+$/i, ""), texture);
      } catch {
        console.warn(`sprite ${entry}: failed to load - skipped`);
      }
    }),
  );
}
