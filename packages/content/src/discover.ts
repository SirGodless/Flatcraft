import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { parseContentManifest, type ContentPackage } from "./manifest.js";
import { unzipToFileTree } from "./zip.js";

/**
 * Node-only: walks a content/ directory on disk into ContentPackages.
 * Deliberately isolated in its own module (the only one here touching
 * node:fs/node:path) so the browser client - which will eventually reuse
 * manifest.ts/zip.ts for a local "install from a downloaded zip" flow via
 * the File API, never a directory listing - never has a reason to import
 * this file and pull Node builtins into its bundle.
 */

function readDirRecursive(dir: string, base: string): Map<string, Uint8Array> {
  const tree = new Map<string, Uint8Array>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [path, data] of readDirRecursive(full, base)) tree.set(path, data);
    } else if (entry.isFile()) {
      tree.set(relative(base, full).replaceAll("\\", "/"), readFileSync(full));
    }
  }
  return tree;
}

function manifestFrom(files: Map<string, Uint8Array>, source: string): { id: string; version: string } {
  const bytes = files.get("content.json");
  if (!bytes) throw new Error(`content package "${source}" is missing content.json`);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch (err) {
    throw new Error(`content package "${source}": content.json is not valid JSON (${(err as Error).message})`);
  }
  return parseContentManifest(raw, source);
}

/**
 * Every package directly under `dir`: a subdirectory is a loose package
 * (read recursively), a `*.zip` file is an archived package (unzipped in
 * memory). Anything else directly under `dir` (e.g. a stray README) is
 * ignored. Sorted by directory-entry name for deterministic load order,
 * matching the existing `datapack/{blocks,items,mobs}` loader's
 * `readdirSync(...).sort()` convention (packages/dedicated/src/server.ts).
 * Throws - never silently skips - on a missing/invalid manifest or a
 * duplicate package id, consistent with every other "bad content" path
 * in this codebase (parseX/registerX functions throw with the source
 * named, rather than returning an error a caller might forget to check).
 */
export function discoverContentDir(dir: string): ContentPackage[] {
  if (!existsSync(dir)) return [];
  const packages: ContentPackage[] = [];
  const seenIds = new Map<string, string>();
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const source = `content/${entry.name}`;
    let files: Map<string, Uint8Array>;
    if (entry.isDirectory()) {
      files = readDirRecursive(full, full);
    } else if (entry.isFile() && entry.name.endsWith(".zip")) {
      files = unzipToFileTree(readFileSync(full));
    } else {
      continue;
    }
    const manifest = manifestFrom(files, source);
    const existing = seenIds.get(manifest.id);
    if (existing) {
      throw new Error(`content package id "${manifest.id}" is used by both "${existing}" and "${source}"`);
    }
    seenIds.set(manifest.id, source);
    packages.push({ id: manifest.id, version: manifest.version, source, files });
  }
  return packages;
}
