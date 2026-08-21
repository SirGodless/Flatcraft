import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverContentDir } from "@flatcraft/content";
import { loadContentPackage } from "../src/index.js";

/**
 * Every test file gets its own isolated module registry (Vitest's
 * default `isolate: true`), so @flatcraft/sim's block/item/mob/...
 * registries start empty for each file, same as a real host boot -
 * this loads every discovered content package once per test file
 * before any test runs, mirroring what @flatcraft/dedicated's server.ts
 * and @flatcraft/client's content.ts do for their own hosts. flatcraft
 * loads first - see server.ts's ensureBaseContentLoaded for why (other
 * packages' content may reference flatcraft-namespaced ids, and
 * loadContentPackage resolves cross-references eagerly, not deferred).
 */
const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "../../../content");
const packages = discoverContentDir(contentDir);
const flatcraft = packages.find((p) => p.id === "flatcraft");
if (!flatcraft) {
  throw new Error(`expected a "flatcraft" content package under ${contentDir}`);
}
await loadContentPackage(flatcraft);
for (const pkg of packages) {
  if (pkg.id === "flatcraft") continue;
  await loadContentPackage(pkg);
}
