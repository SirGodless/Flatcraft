import { unzipSync } from "fflate";

/**
 * .zip -> file tree, via fflate (pure JS/WASM-free, no native build step,
 * works identically in Node and the browser) - the same function backs
 * both the dedicated server's disk-based package discovery (discover.ts)
 * and, later, a browser-side "install this mod from a downloaded zip"
 * flow, so the two never drift into different unzip behavior.
 */
export function unzipToFileTree(bytes: Uint8Array): Map<string, Uint8Array> {
  const raw = unzipSync(bytes);
  const tree = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(raw)) {
    if (path.endsWith("/")) continue; // directory marker entry, no content
    tree.set(path, data);
  }
  return tree;
}
