import { describe, expect, it } from "vitest";
import { parseEnchant } from "../src/enchants.js";
import { allContentTypeIds, contentTypeDecl, registerContentType, validateContentInstance } from "../src/registry/generic.js";
import sharpnessJson from "../src/data/enchants/sharpness.json";
import efficiencyJson from "../src/data/enchants/efficiency.json";

describe("generic content-type engine", () => {
  it("registers a type and rejects a duplicate id", () => {
    registerContentType({ id: "test_widget", fields: { id: { kind: "id", required: true } } }, "test");
    expect(contentTypeDecl("test_widget")).toBeDefined();
    expect(allContentTypeIds()).toContain("test_widget");
    expect(() => registerContentType({ id: "test_widget", fields: {} }, "test")).toThrow(/already registered/);
  });

  it("validates scalar, enum, and ref fields", () => {
    registerContentType(
      {
        id: "test_gadget",
        fields: {
          id: { kind: "id", required: true },
          rarity: { kind: "enum", values: ["common", "rare"], required: true },
          uses: { kind: "number", min: 0, max: 100 },
          reusable: { kind: "boolean" },
          crafted_from: { kind: "ref", ref_type: "item" },
        },
      },
      "test",
    );
    const out = validateContentInstance("test_gadget", { id: "widget", rarity: "rare", uses: 5, reusable: true, crafted_from: "stick" }, "test");
    expect(out).toEqual({ id: "widget", rarity: "rare", uses: 5, reusable: true, crafted_from: "stick" });

    expect(() => validateContentInstance("test_gadget", { id: "widget", rarity: "legendary" }, "test")).toThrow(/must be one of/);
    expect(() => validateContentInstance("test_gadget", { rarity: "common" }, "test")).toThrow(/"\(root\)\.id" is required/);
    expect(() => validateContentInstance("test_gadget", { id: "widget", rarity: "common", nope: 1 }, "test")).toThrow(/unknown field/);
  });

  it("strips an optional flatcraft: prefix on instance refs, but keeps handler refs verbatim", () => {
    // Regression test: an earlier version stripped "flatcraft:" from
    // handler refs too, which broke dimension.ts's generator/spawns/
    // arrival lookups - those registries are keyed by the full
    // "flatcraft:overworld"-style modname:funktion string, not the
    // stripped tail (see world/dimension.ts and world/gen.ts).
    registerContentType(
      {
        id: "test_ref_kinds",
        fields: {
          instance_ref: { kind: "ref", ref_type: "item", required: true },
          handler_ref: { kind: "ref", ref_type: "some_handler", ref_kind: "handler", required: true },
        },
      },
      "test",
    );
    const out = validateContentInstance("test_ref_kinds", { instance_ref: "flatcraft:stick", handler_ref: "flatcraft:overworld" }, "test");
    expect(out).toEqual({ instance_ref: "stick", handler_ref: "flatcraft:overworld" });
  });

  it("validates nested object/array/record/oneOf fields", () => {
    registerContentType(
      {
        id: "test_container",
        fields: {
          id: { kind: "id", required: true },
          tags: { kind: "array", items: { kind: "string" } },
          counts: { kind: "record", values: { kind: "number", min: 0, max: 10 } },
          slot: {
            kind: "object",
            fields: { x: { kind: "number", min: 0, max: 10, required: true }, y: { kind: "number", min: 0, max: 10, required: true } },
          },
          drop: {
            kind: "oneOf",
            variants: [{ kind: "literal", value: "none" }, { kind: "object", fields: { item: { kind: "ref", ref_type: "item", required: true } } }],
          },
        },
      },
      "test",
    );
    const out = validateContentInstance(
      "test_container",
      { id: "chest", tags: ["storage", "wood"], counts: { red: 3, blue: 7 }, slot: { x: 1, y: 2 }, drop: "none" },
      "test",
    );
    expect(out).toEqual({ id: "chest", tags: ["storage", "wood"], counts: { red: 3, blue: 7 }, slot: { x: 1, y: 2 }, drop: "none" });

    const out2 = validateContentInstance("test_container", { id: "chest", drop: { item: "stick" } }, "test");
    expect(out2["drop"]).toEqual({ item: "stick" });

    expect(() => validateContentInstance("test_container", { id: "chest", drop: "invalid" }, "test")).toThrow(/matched none of 2 variants/);
  });

  it("rejects an unregistered type id", () => {
    expect(() => validateContentInstance("nonexistent:type", { id: "x" }, "test")).toThrow(/is not registered/);
  });
});

// Type declaration ids are plain snake_case for now, same as every other
// registry in this codebase today - the full `<pkg>:<type>:<name>`
// namespacing scheme is a later stage's concern (it needs this generic
// engine to exist first, since `<type>` only becomes resolvable once
// there's an open type registry to resolve it against).
//
// enchants.ts registers "enchant" for real at module load (imported
// above via parseEnchant) - this is no longer a side-by-side pilot but
// the actual production path, so this just confirms parseEnchant (now
// backed by the generic engine) still produces the right values for the
// real enchant JSON files.
describe("enchants.ts's parseEnchant, now backed by the generic engine", () => {
  it.each([
    ["sharpness", sharpnessJson],
    ["efficiency", efficiencyJson],
  ])("produces the same fields as parseEnchant for %s", (id, json) => {
    const generic = validateContentInstance("enchant", json, `flatcraft/enchants/${id}.json`);
    const handWritten = parseEnchant(id, json);
    expect(generic["id"]).toBe(handWritten.id);
    expect(generic["effect"]).toBe(handWritten.effect);
    expect(generic["per_level"]).toBe(handWritten.perLevel);
  });
});
