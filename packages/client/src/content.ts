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
