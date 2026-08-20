import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { unzipToFileTree } from "../src/zip.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("unzipToFileTree", () => {
  it("round-trips a flat archive", () => {
    const zipped = zipSync({
      "content.json": enc('{"id":"acme","version":"1.0.0"}'),
      "blocks/ruby_ore.json": enc('{"id":"ruby_ore"}'),
    });
    const tree = unzipToFileTree(zipped);
    expect(new TextDecoder().decode(tree.get("content.json")!)).toBe('{"id":"acme","version":"1.0.0"}');
    expect(new TextDecoder().decode(tree.get("blocks/ruby_ore.json")!)).toBe('{"id":"ruby_ore"}');
    expect(tree.size).toBe(2);
  });

  it("drops directory marker entries", () => {
    const zipped = zipSync({
      "blocks/": new Uint8Array(0),
      "blocks/ruby_ore.json": enc("{}"),
    });
    const tree = unzipToFileTree(zipped);
    expect([...tree.keys()]).toEqual(["blocks/ruby_ore.json"]);
  });
});
