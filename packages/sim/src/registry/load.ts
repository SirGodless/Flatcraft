import { registerBiomeJson } from "../world/biome.js";
import { registerBlockJson, resolveBlockLinks } from "../world/block.js";
import { registerDimensionJson } from "../world/dimension.js";
import { registerNetherLayerJson } from "../world/netherLayer.js";
import { registerVeinJson } from "../world/vein.js";
import { registerWoodJson } from "../world/wood.js";
import { registerEnchantJson } from "../enchants.js";
import { registerLiquidJson } from "../liquids.js";
import { registerItemJson } from "../items.js";
import { registerMobJson } from "../mobs.js";
import { registerMultiblockJson } from "../multiblock.js";
import { registerStructureJson } from "../structures/structure.js";
import { registerTradesJson } from "../trading.js";
import { syncItemRecipes } from "../crafting/registry.js";

/**
 * The generic content-package loader: the async replacement for every
 * type file's old `for (const raw of X_JSONS) registerXJson(raw)`
 * module-load-time loop. `flatcraft` (content/flatcraft/) is loaded
 * through this exact same function a third-party mod's content package
 * would go through later - no privileged shortcut for vanilla content
 * (same rule Stage 1-4 already applied to every registry).
 *
 * A host (dedicated server, client, test setup) is responsible for the
 * actual I/O - reading `content/<pkg>/**\/*.json` off disk or a bundled
 * Vite glob-import - and handing the result here as a plain
 * `Map<path, bytes>` (matching @flatcraft/content's ContentPackage.files
 * shape, structurally, without this package depending on @flatcraft/
 * content itself - @flatcraft/sim stays I/O-free by design). Declared
 * `async` even though today's implementation never actually awaits
 * anything (every step here is synchronous JSON processing) - real
 * async work (script transpilation, sandbox startup) lands in later
 * plan stages, and every caller already awaits this call so that lands
 * without another round of "make every caller async" churn.
 *
 * DIR_ORDER matters: each type's registration reads eagerly through the
 * ones before it (an item's `places_block` resolves against blockByName
 * immediately, not deferred), so a type's own directory must be fully
 * drained before anything that references it is registered - same
 * dependency order the old per-type index.ts files established
 * implicitly through their own module-import order.
 */

type Handler = (raw: unknown, source: string) => void;

const DIR_ORDER: ReadonlyArray<readonly [dir: string, handle: Handler]> = [
  ["blocks", (raw, source) => void registerBlockJson(raw, source)],
  ["items", (raw, source) => void registerItemJson(raw, source)],
  ["mobs", (raw, source) => void registerMobJson(raw, source)],
  ["enchants", (raw, source) => void registerEnchantJson(raw, source)],
  ["liquids", (raw, source) => void registerLiquidJson(raw, source)],
  ["veins", (raw, source) => void registerVeinJson(raw, source)],
  ["woods", (raw, source) => void registerWoodJson(raw, source)],
  ["nether_layers", (raw, source) => void registerNetherLayerJson(raw, source)],
  ["biomes", (raw, source) => void registerBiomeJson(raw, source)],
  ["dimensions", (raw, source) => void registerDimensionJson(raw, source)],
  ["multiblocks", (raw, source) => void registerMultiblockJson(raw, source)],
  ["structures", (raw, source) => void registerStructureJson(raw, source)],
  ["trades", (raw, source) => void registerTradesJson(raw, source)],
];

/** Post-processing that needs an entire directory drained first (deferred
 * link resolution, not per-file registration) - keyed by the dir whose
 * completion triggers it. */
const AFTER_DIR: Readonly<Record<string, () => void>> = {
  blocks: resolveBlockLinks,
  items: syncItemRecipes,
};

export interface ContentFiles {
  id: string;
  files: ReadonlyMap<string, Uint8Array>;
}

/** Package ids already loaded into this process's registries -
 * loadContentPackage is idempotent per id, so every caller (dedicated
 * server boot, client boot, test setup files) can call it unconditionally
 * without coordinating a shared "did someone else already load this"
 * flag - two hosts (or two callers within one host, e.g. a test's own
 * setup file plus startDedicatedServer()) asking for the same package id
 * just both get a no-op the second time. */
const LOADED = new Set<string>();

/** Load one content package's game-content JSON into every type's
 * registry. Files outside the known type directories (content.json, a
 * future `types/`/`scripts/` directory) are silently skipped - forward
 * compatible with what later plan stages will add there. */
export async function loadContentPackage(pkg: ContentFiles): Promise<void> {
  if (LOADED.has(pkg.id)) return;
  LOADED.add(pkg.id);
  const decoder = new TextDecoder();
  const byDir = new Map<string, Array<readonly [path: string, bytes: Uint8Array]>>();
  for (const [path, bytes] of pkg.files) {
    const slash = path.indexOf("/");
    if (slash === -1) continue; // content.json and any other package-root file
    const dir = path.slice(0, slash);
    const list = byDir.get(dir) ?? [];
    list.push([path, bytes]);
    byDir.set(dir, list);
  }
  for (const [dir, handle] of DIR_ORDER) {
    const files = (byDir.get(dir) ?? []).sort(([a], [b]) => a.localeCompare(b));
    for (const [path, bytes] of files) {
      if (!path.endsWith(".json")) continue;
      const raw: unknown = JSON.parse(decoder.decode(bytes));
      handle(raw, `${pkg.id}:${path}`);
    }
    AFTER_DIR[dir]?.();
  }
}
