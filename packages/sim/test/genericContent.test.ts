import { describe, expect, it } from "vitest";
import { enchantDef } from "../src/enchants.js";
import { allContentTypeIds, contentTypeDecl, registerContentType, validateContentInstance } from "../src/registry/generic.js";
import sharpnessJson from "../../../content/flatcraft/enchants/sharpness.json";
import efficiencyJson from "../../../content/flatcraft/enchants/efficiency.json";

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
    const out = validateContentInstance(
      "test_gadget",
      { id: "widget", rarity: "rare", uses: 5, reusable: true, crafted_from: "flatcraft:item:stick" },
      "test",
    );
    expect(out).toEqual({ id: "widget", rarity: "rare", uses: 5, reusable: true, crafted_from: "flatcraft:item:stick" });

    expect(() => validateContentInstance("test_gadget", { id: "widget", rarity: "legendary" }, "test")).toThrow(/must be one of/);
    expect(() => validateContentInstance("test_gadget", { rarity: "common" }, "test")).toThrow(/"\(root\)\.id" is required/);
    expect(() => validateContentInstance("test_gadget", { id: "widget", rarity: "common", nope: 1 }, "test")).toThrow(/unknown field/);
  });

  it("keeps both instance and handler refs verbatim as fully-qualified ids", () => {
    // Regression test: under the uniform "package:type:name" namespacing
    // scheme, both ref kinds are fully-qualified ids and neither is
    // stripped down to a bare tail - the dimension.ts generator/spawns/
    // arrival registries and block/item drop lookups are keyed by the
    // full qualified string (see world/dimension.ts and world/gen.ts).
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
    const out = validateContentInstance(
      "test_ref_kinds",
      { instance_ref: "flatcraft:item:stick", handler_ref: "flatcraft:dimension_generator:overworld" },
      "test",
    );
    expect(out).toEqual({ instance_ref: "flatcraft:item:stick", handler_ref: "flatcraft:dimension_generator:overworld" });
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

    const out2 = validateContentInstance("test_container", { id: "chest", drop: { item: "flatcraft:item:stick" } }, "test");
    expect(out2["drop"]).toEqual({ item: "flatcraft:item:stick" });

    expect(() => validateContentInstance("test_container", { id: "chest", drop: "invalid" }, "test")).toThrow(/matched none of 2 variants/);
  });

  it("rejects an unregistered type id", () => {
    expect(() => validateContentInstance("nonexistent:type", { id: "x" }, "test")).toThrow(/is not registered/);
  });
});

// enchants.ts's registerEnchantJson is backed by this same generic engine
// (see enchants.ts) and is the actual production path - test/setup.ts
// already loaded content/flatcraft/enchants/*.json for real before this
// file's tests run, so this just confirms the generic validator produces
// the same fields the already-registered EnchantDef holds, for the real
// enchant JSON files (re-registering here would throw "already
// registered").
describe("enchants.ts's registerEnchantJson, backed by the generic engine", () => {
  it.each([
    ["flatcraft:enchant:sharpness", sharpnessJson],
    ["flatcraft:enchant:efficiency", efficiencyJson],
  ])("produces the same fields as the registered EnchantDef for %s", (id, json) => {
    const generic = validateContentInstance("enchant", json, `flatcraft/enchants/${id}.json`);
    const registered = enchantDef(id)!;
    expect(generic["id"]).toBe(registered.id);
    expect(generic["effect"]).toBe(registered.effect);
    expect(generic["per_level"]).toBe(registered.perLevel);
  });
});
