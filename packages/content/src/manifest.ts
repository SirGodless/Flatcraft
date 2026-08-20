/**
 * A content package's manifest (content.json at the root of a loose
 * directory or a .zip archive under a content/ root): just enough to
 * identify the package before anything tries to interpret what's inside
 * it. What the package actually contains (block/item/mob/... JSON,
 * scripts) is meaningless to this module - see @flatcraft/sim's registry
 * layer for that. Kept deliberately small (id + version only) - this is
 * the one fixed point every future addition (dependencies, permissions,
 * ...) builds on top of, not a place to speculatively grow fields ahead
 * of an actual need.
 */

export interface ContentManifestJson {
  /** Package id, referenced as the first segment of every namespaced
   * content id it registers (e.g. "flatcraft" in "flatcraft:item:bow"). */
  id: string;
  version: string;
}

export interface ContentManifest {
  id: string;
  version: string;
}

/** A discovered content package: its manifest plus every file inside it
 * (content.json included), keyed by path relative to the package root
 * with forward slashes regardless of host OS. `source` is a human-facing
 * label (e.g. "content/flatcraft" or "content/some_mod.zip") for error
 * messages - never parsed, just displayed. */
export interface ContentPackage {
  id: string;
  version: string;
  source: string;
  files: Map<string, Uint8Array>;
}

const ID_PATTERN = /^[a-z0-9_]+$/;

export function parseContentManifest(raw: unknown, source: string): ContentManifest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`content package "${source}": content.json must be an object`);
  }
  const value = raw as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (key !== "id" && key !== "version") {
      throw new Error(`content package "${source}": unknown content.json field "${key}"`);
    }
  }
  const id = value["id"];
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new Error(`content package "${source}": content.json "id" must be a lowercase snake_case string`);
  }
  const version = value["version"];
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`content package "${source}": content.json "version" must be a non-empty string`);
  }
  return { id, version };
}
