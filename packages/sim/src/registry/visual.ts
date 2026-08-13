import type { VisualJson } from "./schema.js";

/**
 * Shared visual-component shape for items, blocks, and mobs: sprite
 * variants, sprite-sheet animation, and a named shader effect. Reused
 * as-is from the validated JSON - nothing here cross-references another
 * registry, so no id-resolution step is needed (unlike e.g. an item's
 * `places_block`, which resolves a block name to a numeric BlockId at
 * registration time).
 */
export type VisualDef = VisualJson;
