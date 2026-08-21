import { loadContentPackage } from "@flatcraft/sim";

/**
 * Loads flatcraft's own content package (block/item/mob/... registries)
 * in the browser, before anything else touches them - the client-side
 * counterpart to @flatcraft/dedicated's server.ts ensureBaseContentLoaded.
 * The actual JSON lives at content/flatcraft/ (repo root, shared with the
 * dedicated server); vite.config.ts's flatcraftContentManifest plugin
 * bundles it into one fetchable file (see that file's doc comment for
 * why one file, not a glob-import per JSON file).
 */
export async function loadBundledFlatcraftContent(): Promise<void> {
  const response = await fetch("/content/flatcraft-manifest.json", { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`failed to fetch flatcraft content manifest: ${response.status}`);
  }
  const manifest = (await response.json()) as Record<string, unknown>;
  const encoder = new TextEncoder();
  const files = new Map<string, Uint8Array>();
  for (const [path, value] of Object.entries(manifest)) {
    files.set(path, encoder.encode(JSON.stringify(value)));
  }
  await loadContentPackage({ id: "flatcraft", files });
}

/** Every OTHER content package a connected server has discovered
 * (content/<pkg>/ directories besides "flatcraft" itself, which this
 * client already has bundled - see loadBundledFlatcraftContent above) -
 * the client-side counterpart to @flatcraft/dedicated's server.ts
 * serving them, already parsed, via /api/content. Replaces the old
 * server-datapack sync (DATA_DIR/datapack/{blocks,items,mobs} + /api/
 * datapack): that mechanism only ever covered three content types and
 * bypassed loadContentPackage entirely; every content package - and
 * every type it can declare, not just blocks/items/mobs - reaches the
 * client through this one call now, the exact same async loader path
 * every host uses. Call after loadBundledFlatcraftContent (flatcraft's
 * own blocks/items/etc. need to exist first for any cross-package ref
 * to resolve) and before running that server's scripts (a script may
 * reference this content). */
export async function loadServerContentPackages(): Promise<void> {
  const response = await fetch("/api/content", { headers: { accept: "application/json" } });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("application/json")) return;
  const packages = (await response.json()) as Record<string, Record<string, unknown>>;
  const encoder = new TextEncoder();
  for (const [packageId, filesJson] of Object.entries(packages)) {
    const files = new Map<string, Uint8Array>();
    for (const [path, value] of Object.entries(filesJson)) {
      files.set(path, encoder.encode(JSON.stringify(value)));
    }
    await loadContentPackage({ id: packageId, files });
  }
}
