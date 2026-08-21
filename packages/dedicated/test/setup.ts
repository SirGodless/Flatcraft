import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverContentDir } from "@flatcraft/content";
import { loadContentPackage } from "@flatcraft/sim";

/**
 * Every test file gets its own isolated module registry (Vitest's
 * default `isolate: true`), so @flatcraft/sim's block/item/mob/...
 * registries start empty for each file. Most dedicated tests go through
 * startDedicatedServer(), which loads content itself (see server.ts's
 * ensureBaseContentLoaded) - but a test that touches @flatcraft/sim's
 * registries directly (e.g. chunkFiles.test.ts's ChunkFileStore.scanAll,
 * which walks allDimensionIds()) needs it loaded too, so every test file
 * gets it unconditionally here rather than depending on which path each
 * test happens to take.
 */
const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "../../../content");
const [flatcraft] = discoverContentDir(contentDir);
if (!flatcraft || flatcraft.id !== "flatcraft") {
  throw new Error(`expected a "flatcraft" content package under ${contentDir}`);
}
await loadContentPackage(flatcraft);
