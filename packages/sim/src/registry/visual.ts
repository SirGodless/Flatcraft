import type { BlockFallbackJson, ItemFallbackJson, MobFallbackJson, VisualJson } from "./schema.js";

/**
 * Shared visual-component shape for items, blocks, and mobs: sprite
 * variants, sprite-sheet animation, a named shader effect, and a
 * no-sprite-file fallback look. Reused as-is from the validated JSON -
 * nothing here cross-references another registry, so no id-resolution
 * step is needed (unlike e.g. an item's `places_block`, which resolves a
 * block name to a numeric BlockId at registration time).
 */
export type VisualDef<F = unknown> = VisualJson<F>;
export type BlockVisualDef = VisualDef<BlockFallbackJson>;
export type ItemVisualDef = VisualDef<ItemFallbackJson>;
export type MobVisualDef = VisualDef<MobFallbackJson>;
