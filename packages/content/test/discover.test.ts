import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { discoverContentDir } from "../src/discover.js";

let dir: string | null = null;

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});

function freshDir(): string {
  dir = mkdtempSync(join(tmpdir(), "flatcraft-content-test-"));
  return dir;
}

describe("discoverContentDir", () => {
  it("returns an empty list for a directory that doesn't exist", () => {
    expect(discoverContentDir(join(freshDir(), "nope"))).toEqual([]);
  });

  it("discovers a loose-folder package", () => {
    const root = freshDir();
    const pkg = join(root, "flatcraft");
    mkdirSync(join(pkg, "blocks"), { recursive: true });
    writeFileSync(join(pkg, "content.json"), JSON.stringify({ id: "flatcraft", version: "1.0.0" }));
    writeFileSync(join(pkg, "blocks", "stone.json"), JSON.stringify({ id: "stone" }));

    const packages = discoverContentDir(root);
    expect(packages).toHaveLength(1);
    expect(packages[0]!.id).toBe("flatcraft");
    expect(packages[0]!.version).toBe("1.0.0");
    expect(new TextDecoder().decode(packages[0]!.files.get("blocks/stone.json")!)).toBe('{"id":"stone"}');
  });

  it("discovers a .zip package", () => {
    const root = freshDir();
    const zipped = zipSync({
      "content.json": new TextEncoder().encode(JSON.stringify({ id: "acme", version: "2.0.0" })),
      "items/ruby.json": new TextEncoder().encode(JSON.stringify({ id: "ruby" })),
    });
    writeFileSync(join(root, "acme.zip"), zipped);

    const packages = discoverContentDir(root);
    expect(packages).toHaveLength(1);
    expect(packages[0]!.id).toBe("acme");
    expect(packages[0]!.source).toBe("content/acme.zip");
  });

  it("ignores stray files that aren't a folder or .zip", () => {
    const root = freshDir();
    writeFileSync(join(root, "README.md"), "hello");
    expect(discoverContentDir(root)).toEqual([]);
  });

  it("throws on a package with no content.json", () => {
    const root = freshDir();
    mkdirSync(join(root, "broken"));
    writeFileSync(join(root, "broken", "stray.json"), "{}");
    expect(() => discoverContentDir(root)).toThrow(/missing content\.json/);
  });

  it("throws when two packages declare the same id", () => {
    const root = freshDir();
    for (const name of ["a", "b"]) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, "content.json"), JSON.stringify({ id: "dupe", version: "1.0.0" }));
    }
    expect(() => discoverContentDir(root)).toThrow(/content package id "dupe" is used by both/);
  });
});
